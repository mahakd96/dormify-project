from collections import defaultdict
from itertools import combinations

from django.db import transaction, close_old_connections
from django.utils import timezone

from api.models import Student, Room, Bed, BedAssignment

try:
    from ortools.sat.python import cp_model
    ORTOOLS_AVAILABLE = True
except ImportError:
    ORTOOLS_AVAILABLE = False


BASE_ASSIGNMENT_SCORE = 1000
PRIORITY_SCORE = 300
WEIGHT_UNIT = 10
MAX_SOLVER_TIME_SECONDS = 250
NUM_SEARCH_WORKERS = 2
def _is_constraint_hard(config, key):
    """Return True when a constraint must be enforced as a hard rule."""
    c = config.get(key, {})
    return bool(c.get("critical")) or (bool(c.get("enabled")) and bool(c.get("strict")))


def _is_constraint_soft(config, key):
    """Return True when a constraint is enabled and should affect only the objective."""
    c = config.get(key, {})
    return bool(c.get("enabled")) and not _is_constraint_hard(config, key)


def _constraint_weight(config, key, default=0):
    """Read a numeric weight from the constraints configuration."""
    c = config.get(key, {})
    return int(c.get("weight", default) or 0)


def _safe_str(v):
    """Convert a value to a stripped string, or return an empty string for None."""
    return str(v).strip() if v is not None else ""


def _safe_lower(v):
    """Return a lowercase normalized string representation."""
    return _safe_str(v).lower()


def _parse_bool_yes(v):
    """Interpret common Hebrew/English truthy values as boolean yes."""
    return _safe_lower(v) in {"כן", "yes", "true", "1"}


def _get_student_gender(student):
    """Return the student's gender value if present."""
    return getattr(student, "gender", None)


def _get_student_priority(student):
    """Return whether the student is marked as priority."""
    return bool(getattr(student, "is_priority", False))


def _get_student_religion(student):
    """Return the student's religion or requested religion, when available."""
    return _safe_str(
        getattr(student, "religion", None)
        or getattr(student, "requested_religion", None)
    )


def _get_student_sector(student):
    """
    Return the student's placement sector in a normalized way.

    Priority:
    1. Explicit placement_sector field
    2. Older compatible sector-like fields
    3. Fallback inference from religion
    4. 'unknown' if nothing reliable exists
    """
    raw_sector = _safe_lower(
        getattr(student, "placement_sector", None)
        or getattr(student, "sector", None)
        or getattr(student, "requested_sector", None)
        or getattr(student, "requested_religion_or_sector", None)
    )

    sector_map = {
        "jewish": "jewish",
        "יהודי": "jewish",
        "arab": "arab",
        "ערבי": "arab",
        "other": "other",
        "אחר": "other",
        "unknown": "unknown",
        "לא ידוע": "unknown",
        "not_specified": "unknown",
        "לא צוין": "unknown",
    }

    if raw_sector:
        normalized_sector = sector_map.get(raw_sector, raw_sector)
        if normalized_sector != "unknown":
            return normalized_sector

    religion = _safe_lower(
        getattr(student, "requested_religion", None)
        or getattr(student, "religion", None)
    )

    religion_to_sector = {
        "jewish": "jewish",
        "יהודי": "jewish",
        "muslims": "arab",
        "muslim": "arab",
        "מוסלמי": "arab",
        "christian": "arab",
        "נוצרי": "arab",
        "druze": "arab",
        "דרוזי": "arab",
    }

    return religion_to_sector.get(religion, "unknown")


def _get_student_religious_pref(student):
    """Return the student's religious placement preference from known fields."""
    return _safe_str(
        getattr(student, "religious_for_placement", None)
        or getattr(student, "religious_preference", None)
        or getattr(student, "religious", None)
    )


def _get_student_academic_points(student):
    """Return academic points as float, using compatible field names."""
    value = (
        getattr(student, "academic_points_total", None)
        or getattr(student, "study_points", None)
    )
    try:
        return float(value) if value is not None else 0.0
    except Exception:
        return 0.0


def _get_student_year_group(student):
    """Bucket the student into the year-group logic used by the solver."""
    pts = _get_student_academic_points(student)
    if 0 <= pts <= 40:
        return "year1"
    if pts >= 60:
        return "year3_4"
    return "other"


def _collect_special_status_text(student):
    """Join special-status text fields into one normalized searchable string."""
    parts = [
        getattr(student, "special_status_1", ""),
        getattr(student, "special_status_2", ""),
        getattr(student, "special_status_3", ""),
        getattr(student, "special_status_4", ""),
    ]
    return " | ".join(_safe_lower(p) for p in parts if _safe_str(p))


def _is_atudai(student):
    """Return True when the student's special status indicates עתודאי."""
    return "עתודאי" in _collect_special_status_text(student)


def _is_hasmaha(student):
    """Return True when the student's special status indicates הסמכה."""
    return "הסמכה" in _collect_special_status_text(student)


def _normalize_roommate_identifier(value):
    """
    Normalize roommate identifiers into comparable string keys.

    The Student model stores a business student identifier in `student_id`, while
    roommate request fields may contain that identifier as text. This helper keeps
    comparisons stable and backward-compatible.
    """
    value = _safe_str(value)
    return value if value else ""


def _normalize_roommate_identifier(value):
    """Normalize roommate identifiers into comparable string keys."""
    value = _safe_str(value)
    return value if value else ""


def _get_student_identifier(student):
    """
    Return the comparable identifier used by roommate requests.
    Prefer the business student_id.
    """
    student_identifier = _normalize_roommate_identifier(getattr(student, "student_id", ""))
    if student_identifier:
        return student_identifier
    return _normalize_roommate_identifier(getattr(student, "id", ""))


def _get_student_roommate_requests(student):
    """
    Return roommate requests in a backward-compatible way.

    Priority:
    1. New roommate_request_student_id_1..5 fields
    2. Fallback consolidated roommate_request_ids
    3. Fallback old roommate_request_1..5 name fields
    """
    roommate_requests = []

    new_id_pairs = [
        (
            getattr(student, "roommate_request_student_id_1", ""),
            getattr(student, "roommate_request_flag_1", False),
        ),
        (
            getattr(student, "roommate_request_student_id_2", ""),
            getattr(student, "roommate_request_flag_2", False),
        ),
        (
            getattr(student, "roommate_request_student_id_3", ""),
            getattr(student, "roommate_request_flag_3", False),
        ),
        (
            getattr(student, "roommate_request_student_id_4", ""),
            getattr(student, "roommate_request_flag_4", False),
        ),
        (
            getattr(student, "roommate_request_student_id_5", ""),
            getattr(student, "roommate_request_flag_5", False),
        ),
    ]

    has_any_new_id = any(_safe_str(value) for value, _ in new_id_pairs)

    if has_any_new_id:
        for request_value, request_flag in new_id_pairs:
            target = _normalize_roommate_identifier(request_value)
            if not target:
                continue
            roommate_requests.append({
                "target": target,
                "positive": bool(request_flag),
            })
        return roommate_requests

    roommate_ids = getattr(student, "roommate_request_ids", None)
    if roommate_ids is not None:
        if isinstance(roommate_ids, list):
            for item in roommate_ids:
                target = _normalize_roommate_identifier(item)
                if target:
                    roommate_requests.append({
                        "target": target,
                        "positive": True,
                    })
            return roommate_requests

        if isinstance(roommate_ids, str):
            raw = [x.strip() for x in roommate_ids.split(",") if x.strip()]
            for item in raw:
                target = _normalize_roommate_identifier(item)
                if target:
                    roommate_requests.append({
                        "target": target,
                        "positive": True,
                    })
            return roommate_requests

    fallback_name_pairs = [
        (
            getattr(student, "roommate_request_1", ""),
            getattr(student, "roommate_request_flag_1", False),
        ),
        (
            getattr(student, "roommate_request_2", ""),
            getattr(student, "roommate_request_flag_2", False),
        ),
        (
            getattr(student, "roommate_request_3", ""),
            getattr(student, "roommate_request_flag_3", False),
        ),
        (
            getattr(student, "roommate_request_4", ""),
            getattr(student, "roommate_request_flag_4", False),
        ),
        (
            getattr(student, "roommate_request_5", ""),
            getattr(student, "roommate_request_flag_5", False),
        ),
    ]

    for request_value, request_flag in fallback_name_pairs:
        target = _normalize_roommate_identifier(request_value)
        if not target:
            continue
        roommate_requests.append({
            "target": target,
            "positive": bool(request_flag),
        })

    return roommate_requests
def _get_student_full_name(student):
    """Return a normalized full name for fallback roommate matching."""
    first_name = _safe_str(getattr(student, "first_name", ""))
    last_name = _safe_str(getattr(student, "last_name", ""))
    return _safe_str(f"{first_name} {last_name}")


def _student_requested_roommate(student, target_student):
    """
    Return True when `student` requested `target_student`.

    Supports both:
    - student_id-based matching
    - fallback full-name matching
    """
    requests = _get_student_roommate_requests(student)
    target_identifier = _get_student_identifier(target_student)
    target_full_name = _get_student_full_name(target_student)

    for item in requests:
        req_target = _normalize_roommate_identifier(item["target"])
        if not req_target:
            continue

        if req_target == target_identifier:
            return True

        if target_full_name and req_target == target_full_name:
            return True

    return False


def _student_positive_roommate_request(student, target_student):
    """
    Return True when `student` requested `target_student`
    and marked that request as positive.
    """
    requests = _get_student_roommate_requests(student)
    target_identifier = _get_student_identifier(target_student)
    target_full_name = _get_student_full_name(target_student)

    for item in requests:
        req_target = _normalize_roommate_identifier(item["target"])
        if not req_target:
            continue

        if req_target == target_identifier or (target_full_name and req_target == target_full_name):
            return bool(item["positive"])

    return False

def _get_student_roommate_requests(student):
    """
    Return roommate requests from the current Student model in a backward-compatible way.

    Supports the real current schema first:
    - roommate_request_student_id_1..5
    - roommate_request_flag_1..5

    Then falls back to older formats:
    - roommate_request_ids
    - roommate_request_1..5
    """
    roommate_requests = []

    new_id_pairs = [
        (getattr(student, "roommate_request_student_id_1", ""), getattr(student, "roommate_request_flag_1", False)),
        (getattr(student, "roommate_request_student_id_2", ""), getattr(student, "roommate_request_flag_2", False)),
        (getattr(student, "roommate_request_student_id_3", ""), getattr(student, "roommate_request_flag_3", False)),
        (getattr(student, "roommate_request_student_id_4", ""), getattr(student, "roommate_request_flag_4", False)),
        (getattr(student, "roommate_request_student_id_5", ""), getattr(student, "roommate_request_flag_5", False)),
    ]

    if any(_safe_str(value) for value, _ in new_id_pairs):
        for request_value, request_flag in new_id_pairs:
            target = _normalize_roommate_identifier(request_value)
            if target:
                roommate_requests.append({"target": target, "positive": bool(request_flag)})
        return roommate_requests

    roommate_ids = getattr(student, "roommate_request_ids", None)
    if roommate_ids is not None:
        if isinstance(roommate_ids, list):
            for item in roommate_ids:
                target = _normalize_roommate_identifier(item)
                if target:
                    roommate_requests.append({"target": target, "positive": True})
            return roommate_requests

        if isinstance(roommate_ids, str):
            for item in [x.strip() for x in roommate_ids.split(",") if x.strip()]:
                target = _normalize_roommate_identifier(item)
                if target:
                    roommate_requests.append({"target": target, "positive": True})
            return roommate_requests

    fallback_pairs = [
        (getattr(student, "roommate_request_1", ""), getattr(student, "roommate_request_flag_1", False)),
        (getattr(student, "roommate_request_2", ""), getattr(student, "roommate_request_flag_2", False)),
        (getattr(student, "roommate_request_3", ""), getattr(student, "roommate_request_flag_3", False)),
        (getattr(student, "roommate_request_4", ""), getattr(student, "roommate_request_flag_4", False)),
        (getattr(student, "roommate_request_5", ""), getattr(student, "roommate_request_flag_5", False)),
    ]

    for request_value, request_flag in fallback_pairs:
        target = _normalize_roommate_identifier(request_value)
        if target:
            roommate_requests.append({"target": target, "positive": bool(request_flag)})

    return roommate_requests
def _get_student_roommate_request_targets(student):
    """Return the set of all roommate-request target identifiers."""
    return {
        item["target"]
        for item in _get_student_roommate_requests(student)
        if item["target"]
    }


def _get_student_positive_roommate_request_targets(student):
    """Return the set of roommate-request targets marked as positive/approved."""
    return {
        item["target"]
        for item in _get_student_roommate_requests(student)
        if item["target"] and item["positive"]
    }


def _normalize_match_text(value):
    """Normalize text for roommate name matching, including Hebrew names."""
    return " ".join(_safe_str(value).split())


def _compact_match_text(value):
    """Compact name key: remove spaces and lowercase. Useful for Hebrew name spacing differences."""
    return _safe_lower(_normalize_match_text(value)).replace(" ", "")


def _roommate_target_match_keys(value):
    """Return lookup keys for a raw roommate request target value."""
    normalized = _normalize_match_text(value)
    if not normalized:
        return set()
    return {
        normalized,
        _safe_lower(normalized),
        _compact_match_text(normalized),
    }


def _student_roommate_match_keys(student):
    """
    Return all safe keys that may identify a student in roommate request fields.

    The Excel data stores roommate names as last-name-first-name in many rows,
    while Student.full_name is first-name-last-name. So we index both orders,
    plus compact no-space versions, and the business student_id.
    """
    keys = set()

    identifier = _normalize_match_text(_get_student_identifier(student))
    first_name = _normalize_match_text(getattr(student, "first_name", ""))
    last_name = _normalize_match_text(getattr(student, "last_name", ""))
    first_last = _normalize_match_text(f"{first_name} {last_name}")
    last_first = _normalize_match_text(f"{last_name} {first_name}")

    for value in [identifier, first_last, last_first]:
        if not value:
            continue
        keys.add(value)
        keys.add(_safe_lower(value))
        keys.add(_compact_match_text(value))

    return keys


def _student_requested_roommate(student, target_student):
    """Return True when student requested target_student by ID or by name in either order."""
    request_keys = set()
    for target in _get_student_roommate_request_targets(student):
        request_keys.update(_roommate_target_match_keys(target))

    if not request_keys:
        return False

    return bool(request_keys & _student_roommate_match_keys(target_student))


def _student_positive_roommate_request(student, target_student):
    """Return True when student requested target_student and the positive/approved flag is set."""
    request_keys = set()
    for target in _get_student_positive_roommate_request_targets(student):
        request_keys.update(_roommate_target_match_keys(target))

    if not request_keys:
        return False

    return bool(request_keys & _student_roommate_match_keys(target_student))
def _students_mutually_requested_each_other(s1, s2):
    """
    Return True when both students requested each other as roommates.

    This compatibility rule follows the actual Student schema by comparing
    `student_id`-style identifiers rather than database primary keys.
    """
    return _student_requested_roommate(s1, s2) and _student_requested_roommate(s2, s1)


def _students_one_sided_roommate_request(s1, s2):
    """Return True when exactly one student requested the other."""
    return _student_requested_roommate(s1, s2) ^ _student_requested_roommate(s2, s1)


def _students_have_mutual_positive_roommate_request(s1, s2):
    """
    Return True when both students requested each other and both sides are positive.

    This is the correct hard-rule interpretation for the current model when the
    client requires only positive roommate matches to be enforced.
    """
    return _student_positive_roommate_request(s1, s2) and _student_positive_roommate_request(s2, s1)


def _students_have_any_positive_roommate_request(s1, s2):
    """Return True when at least one side requested the other positively."""
    return _student_positive_roommate_request(s1, s2) or _student_positive_roommate_request(s2, s1)


def _needs_accessibility(student):
    """Return True when the student requires accessibility."""
    return bool(
        getattr(student, "needs_accessibility", False)
        or (
            getattr(student, "is_priority", False)
            and "נגיש" in _safe_lower(getattr(student, "priority_reason", ""))
        )
    )


def _apartment_is_accessible(apartment):
    """Return whether the apartment is marked as accessible."""
    return bool(getattr(apartment, "is_accessible", False))


def _apartment_allows_gender(apartment, student):
    """Return whether the apartment category is compatible with the student's gender."""
    category = _safe_str(getattr(apartment, "category", ""))
    gender = _get_student_gender(student)

    if hasattr(Student, "Gender"):
        female_value = getattr(Student.Gender, "FEMALE", "female")
        male_value = getattr(Student.Gender, "MALE", "male")
    else:
        female_value = "female"
        male_value = "male"

    female_labels = {"בנות", "female", str(female_value)}
    male_labels = {"בנים", "male", str(male_value)}

    if category in female_labels and gender != female_value:
        return False
    if category in male_labels and gender != male_value:
        return False

    return True


def _room_reserved_ok(room, student):
    """Return whether the room/apartment reservation status allows this student."""
    apartment = getattr(room, "apartment", None)

    apartment_is_reserved = bool(getattr(apartment, "is_reserved", False))
    inactive_reason = _safe_str(getattr(apartment, "inactive_reason", ""))

    if apartment_is_reserved:
        return _get_student_priority(student)

    if inactive_reason == "reserved" and not _get_student_priority(student):
        return False

    if not bool(getattr(room, "is_active", True)):
        return False

    if apartment and not bool(getattr(apartment, "is_active", True)):
        return False

    return True


def _students_same_requested_religious_pref(s1, s2):
    """Return whether students are compatible under the religious-preference rule."""
    p1 = _get_student_religious_pref(s1)
    p2 = _get_student_religious_pref(s2)

    if not p1 or not p2:
        return True
    if p1 == "לא משנה" or p2 == "לא משנה":
        return True
    return p1 == p2


def _students_same_religion(s1, s2):
    """Return whether students share the same religion."""
    r1 = _get_student_religion(s1)
    r2 = _get_student_religion(s2)
    return bool(r1) and bool(r2) and r1 == r2


def _students_same_sector(s1, s2):
    """Return whether students share the same sector-like attribute."""
    sec1 = _get_student_sector(s1)
    sec2 = _get_student_sector(s2)
    return bool(sec1) and bool(sec2) and sec1 == sec2


def _should_avoid_year_mix(s1, s2):
    """Return True when the pair is year-1 mixed with year-3/4."""
    return {_get_student_year_group(s1), _get_student_year_group(s2)} == {"year1", "year3_4"}


def _should_avoid_atudaim_hasmaha_mix(s1, s2):
    """Return True when the pair should be penalized under the עתודאים/הסמכה rule."""
    return (_is_atudai(s1) and _is_hasmaha(s2)) or (_is_atudai(s2) and _is_hasmaha(s1))


def _ensure_beds_for_room(room):
    """Ensure that the room has Bed rows up to its declared capacity."""
    existing_beds = list(room.beds.all())
    capacity = int(getattr(room, "capacity", 0) or 0)

    if capacity <= 0:
        return

    if len(existing_beds) >= capacity:
        return

    missing = capacity - len(existing_beds)
    start_index = len(existing_beds)

    Bed.objects.bulk_create(
        [Bed(room=room, label=f"Bed {start_index + i + 1}") for i in range(missing)]
    )


def _assign_student_to_bed(student, bed):
    """
    Persist a student's assignment to the selected bed.

    This function closes any previous active bed assignment for the student,
    creates a new active assignment, and updates `student.assigned_room`.
    """
    BedAssignment.objects.filter(
        student=student,
        status=BedAssignment.Status.ACTIVE
    ).update(
        status=BedAssignment.Status.ENDED,
        ended_at=timezone.now()
    )

    assignment = BedAssignment.objects.create(
        student=student,
        bed=bed,
        status=BedAssignment.Status.ACTIVE,
        assignment_type=BedAssignment.AssignmentType.INITIAL,
    )

    if hasattr(student, "assigned_room"):
        student.assigned_room = bed.room
        update_fields = ["assigned_room"]
        if hasattr(student, "updated_at"):
            update_fields.append("updated_at")
        student.save(update_fields=update_fields)

    return assignment


def _can_student_use_bed(student, bed, room, apartment, hard_same_gender):
    """Return whether the bed is feasible for the student under hard feasibility rules."""
    if hard_same_gender and not _apartment_allows_gender(apartment, student):
        return False
    if not _room_reserved_ok(room, student):
        return False
    return True


def _build_feasible_bed_maps(students, candidate_beds, room_by_bed, apartment_by_bed, hard_same_gender):
    """Build feasible student-to-bed relationships for the CP model."""
    student_candidate_beds = {}
    feasible_x_keys = []

    for s in students:
        allowed_beds = []
        for bed in candidate_beds:
            room = room_by_bed[bed.id]
            apartment = apartment_by_bed[bed.id]
            if _can_student_use_bed(s, bed, room, apartment, hard_same_gender):
                allowed_beds.append(bed.id)
                feasible_x_keys.append((s.id, bed.id))
        student_candidate_beds[s.id] = allowed_beds

    return student_candidate_beds, feasible_x_keys


def _build_room_and_apartment_maps(students, rooms, apartments, student_candidate_beds, beds_by_room, beds_by_apartment):
    """Build feasible student-to-room and student-to-apartment relationships."""
    student_candidate_rooms = defaultdict(list)
    student_candidate_apartments = defaultdict(list)

    for s in students:
        allowed_beds = set(student_candidate_beds[s.id])

        for room in rooms:
            room_bed_ids = [b.id for b in beds_by_room.get(room.id, [])]
            if any(bed_id in allowed_beds for bed_id in room_bed_ids):
                student_candidate_rooms[s.id].append(room.id)

        for apartment in apartments:
            apt_bed_ids = [b.id for b in beds_by_apartment.get(apartment.id, [])]
            if any(bed_id in allowed_beds for bed_id in apt_bed_ids):
                student_candidate_apartments[s.id].append(apartment.id)

    return student_candidate_rooms, student_candidate_apartments


def _build_feasible_pair_apartment_keys(students, apartments, student_candidate_apartments, hard_same_gender):
    """Build pair/apartment combinations used for shared-apartment logic."""
    pair_apartment_keys = []
    student_pairs = list(combinations(students, 2))

    for s1, s2 in student_pairs:
        common_apartments = set(student_candidate_apartments[s1.id]) & set(student_candidate_apartments[s2.id])
        for apt_id in common_apartments:
            pair_apartment_keys.append((s1.id, s2.id, apt_id))

    return student_pairs, pair_apartment_keys


def _collect_active_bed_ids():
    """Return the set of bed ids currently occupied by active assignments."""
    return set(
        BedAssignment.objects.filter(
            status=BedAssignment.Status.ACTIVE
        ).values_list("bed_id", flat=True)
    )


def _prepare_candidate_beds(rooms):
    """Prepare free-bed candidates and supporting lookup maps."""
    candidate_beds = []
    room_by_bed = {}
    apartment_by_bed = {}
    beds_by_room = defaultdict(list)
    beds_by_apartment = defaultdict(list)

    active_bed_ids = _collect_active_bed_ids()

    for room in rooms:
        _ensure_beds_for_room(room)
        free_beds = [b for b in room.beds.all() if b.id not in active_bed_ids]

        apartment = room.apartment

        for bed in free_beds:
            candidate_beds.append(bed)
            room_by_bed[bed.id] = room
            apartment_by_bed[bed.id] = apartment
            beds_by_room[room.id].append(bed)
            beds_by_apartment[apartment.id].append(bed)

    return candidate_beds, room_by_bed, apartment_by_bed, beds_by_room, beds_by_apartment


def _priority_students_have_enough_supply(priority_students, student_candidate_beds):
    """Check whether enough feasible bed supply exists for all priority students."""
    distinct_beds = set()
    for s in priority_students:
        distinct_beds.update(student_candidate_beds[s.id])
    return len(distinct_beds) >= len(priority_students)


def _normalize_rooms_input(rooms):
    """
    Accept a queryset or a list and return rooms with apartment and beds loaded.
    """
    if hasattr(rooms, "select_related"):
        return list(
            rooms.select_related(
                "apartment",
                "apartment__building",
                "apartment__building__dorm_type",
            ).prefetch_related("beds")
        )

    room_ids = [r.id for r in rooms if getattr(r, "id", None) is not None]
    if not room_ids:
        return []

    return list(
        Room.objects.filter(id__in=room_ids)
        .select_related(
            "apartment",
            "apartment__building",
            "apartment__building__dorm_type",
        )
        .prefetch_related("beds")
    )


def _normalize_students_input(students):
    """
    Accept a queryset or a list and return a materialized student list.
    """
    if hasattr(students, "select_related"):
        return list(students)
    return list(students)


def _allocation_solver_log(message, **data):
    """Print compact solver progress into Docker logs."""
    if data:
        details = " ".join(f"{key}={value}" for key, value in data.items())
        print(f">>> SOLVER {message} {details}", flush=True)
    else:
        print(f">>> SOLVER {message}", flush=True)


def _room_free_capacity_from_beds(beds_by_room):
    return {room_id: len(beds) for room_id, beds in beds_by_room.items() if len(beds) > 0}


def _student_religious_pref_key(student):
    value = _safe_lower(_get_student_religious_pref(student))
    if value in {"", "לא משנה", "no_preference", "not_specified", "לא צוין", "unknown"}:
        return ""
    return value


def _student_religion_key(student):
    value = _safe_lower(_get_student_religion(student))
    if value in {"", "not_specified", "לא צוין", "unknown"}:
        return ""
    return value


def _student_sector_key(student):
    value = _safe_lower(_get_student_sector(student))
    if value in {"", "unknown", "לא ידוע", "not_specified", "לא צוין"}:
        return ""
    return value


def _students_by_roommate_lookup(students):
    """Build lookup by student_id, first-last, last-first, lower, and compact name keys."""
    lookup = {}
    collisions = defaultdict(list)

    for student in students:
        for key in _student_roommate_match_keys(student):
            if not key:
                continue
            if key in lookup and lookup[key].id != student.id:
                collisions[key].append(student.id)
                continue
            lookup[key] = student

    if collisions:
        _allocation_solver_log(
            "roommate_lookup_collisions",
            collision_keys=len(collisions),
        )

    return lookup


def _resolve_roommate_target(lookup, target):
    """Resolve a raw roommate target string using all normalized name/id variants."""
    for key in _roommate_target_match_keys(target):
        target_student = lookup.get(key)
        if target_student:
            return target_student
    return None


def _count_positive_roommate_flags(students):
    """Count populated positive roommate flags in the active solver population."""
    count = 0
    for student in students:
        for item in _get_student_roommate_requests(student):
            if item.get("target") and item.get("positive"):
                count += 1
    return count


def _build_relevant_roommate_pairs(students):
    """
    Return only pairs that matter for roommate logic.

    This replaces the old all-pairs combinations(students, 2) behavior. With 718 students,
    the old code starts with 257,403 pairs before multiplying by apartments. Here the upper
    bound is roughly 5 requests per student.
    """
    lookup = _students_by_roommate_lookup(students)
    pairs_by_key = {}
    raw_targets = 0
    matched_targets = 0
    unmatched_targets = 0

    for student in students:
        for target in _get_student_roommate_request_targets(student):
            raw_targets += 1
            target_student = _resolve_roommate_target(lookup, target)
            if not target_student or target_student.id == student.id:
                unmatched_targets += 1
                continue

            matched_targets += 1
            low_id, high_id = sorted([student.id, target_student.id])
            pairs_by_key[(low_id, high_id)] = (student, target_student) if student.id == low_id else (target_student, student)

    _allocation_solver_log(
        "roommate_target_resolution",
        raw_targets=raw_targets,
        matched_targets=matched_targets,
        unmatched_targets=unmatched_targets,
        unique_pairs=len(pairs_by_key),
    )

    return list(pairs_by_key.values())


def _build_room_level_candidate_maps(students, rooms, beds_by_room, hard_same_gender):
    """Build feasible student-room and student-apartment maps using free room capacity."""
    student_candidate_rooms = defaultdict(list)
    student_candidate_apartments = defaultdict(list)
    candidate_room_ids_by_apartment = defaultdict(list)

    candidate_rooms = [room for room in rooms if beds_by_room.get(room.id)]
    for room in candidate_rooms:
        if room.id not in candidate_room_ids_by_apartment[room.apartment.id]:
            candidate_room_ids_by_apartment[room.apartment.id].append(room.id)

    for student in students:
        seen_apartments = set()
        for room in candidate_rooms:
            free_beds = beds_by_room.get(room.id, [])
            if not free_beds:
                continue

            probe_bed = free_beds[0]
            apartment = room.apartment
            if _can_student_use_bed(student, probe_bed, room, apartment, hard_same_gender):
                student_candidate_rooms[student.id].append(room.id)
                if apartment.id not in seen_apartments:
                    student_candidate_apartments[student.id].append(apartment.id)
                    seen_apartments.add(apartment.id)

    return student_candidate_rooms, student_candidate_apartments, candidate_room_ids_by_apartment


def _link_group_used_var(model, used_var, member_vars):
    """Set used_var to OR(member_vars) with linear constraints."""
    if not member_vars:
        model.Add(used_var == 0)
        return
    for var in member_vars:
        model.Add(var <= used_var)
    model.Add(used_var <= sum(member_vars))


def _add_soft_group_compaction(model, objective_terms, students, apartments, a, student_candidate_apartments, group_fn, weight):
    """
    Scalable replacement for global pair scoring such as sameReligion / sectorMatching.

    Instead of creating a variable for every same-group student pair in every apartment,
    create one small boolean per apartment/group and penalize many distinct groups in the
    same apartment. BASE_ASSIGNMENT_SCORE still dominates, so this improves quality without
    sacrificing assignment count.
    """
    if weight <= 0:
        return 0

    groups = defaultdict(lambda: defaultdict(list))
    for student in students:
        group = group_fn(student)
        if not group:
            continue
        for apt_id in student_candidate_apartments[student.id]:
            key = (student.id, apt_id)
            if key in a:
                groups[apt_id][group].append(a[key])

    created = 0
    for apartment in apartments:
        apt_groups = groups.get(apartment.id, {})
        for group, member_vars in apt_groups.items():
            used = model.NewBoolVar(f"used_group_a{apartment.id}_{abs(hash(group)) % 1000000}")
            _link_group_used_var(model, used, member_vars)
            objective_terms.append(used * (-weight * WEIGHT_UNIT))
            created += 1
    return created


def _add_hard_single_religious_pref_per_apartment(model, students, apartments, a, student_candidate_apartments):
    """Hard scalable version of ReligiousTogether: at most one strict religious preference per apartment."""
    pref_vars_by_apartment = defaultdict(dict)

    for student in students:
        pref = _student_religious_pref_key(student)
        if not pref:
            continue

        for apt_id in student_candidate_apartments[student.id]:
            key = (student.id, apt_id)
            if key not in a:
                continue
            pref_vars_by_apartment[apt_id].setdefault(pref, []).append(a[key])

    used_count = 0
    for apartment in apartments:
        used_pref_vars = []
        for pref, member_vars in pref_vars_by_apartment.get(apartment.id, {}).items():
            used = model.NewBoolVar(f"used_relig_pref_a{apartment.id}_{abs(hash(pref)) % 1000000}")
            _link_group_used_var(model, used, member_vars)
            used_pref_vars.append(used)
            used_count += 1

        if used_pref_vars:
            model.Add(sum(used_pref_vars) <= 1)

    return used_count


def _add_soft_mix_penalty(model, objective_terms, students, apartments, a, student_candidate_apartments, left_fn, right_fn, weight, label):
    """Add scalable apartment-level penalty when two incompatible groups appear in same apartment."""
    if weight <= 0:
        return 0

    created = 0
    for apartment in apartments:
        left_vars = []
        right_vars = []

        for student in students:
            key = (student.id, apartment.id)
            if key not in a:
                continue
            if left_fn(student):
                left_vars.append(a[key])
            if right_fn(student):
                right_vars.append(a[key])

        if not left_vars or not right_vars:
            continue

        has_left = model.NewBoolVar(f"has_{label}_left_a{apartment.id}")
        has_right = model.NewBoolVar(f"has_{label}_right_a{apartment.id}")
        mixed = model.NewBoolVar(f"mixed_{label}_a{apartment.id}")
        _link_group_used_var(model, has_left, left_vars)
        _link_group_used_var(model, has_right, right_vars)
        model.Add(mixed <= has_left)
        model.Add(mixed <= has_right)
        model.Add(mixed >= has_left + has_right - 1)
        objective_terms.append(mixed * (-weight * WEIGHT_UNIT))
        created += 1

    return created


def run_improved_ortools_allocation(students, rooms, constraints_config):
    """
    Scalable OR-Tools dorm allocation.

    Key change: the model assigns students to rooms, not directly to every possible bed,
    and it only creates same-apartment pair variables for explicit roommate-request pairs.
    This avoids the student-pair explosion that made 718-student regional allocation unsafe.
    """
    if not ORTOOLS_AVAILABLE:
        raise ImportError("OR-Tools is not installed.")

    students = _normalize_students_input(students)
    rooms = _normalize_rooms_input(rooms)
    apartments = list({room.apartment for room in rooms if getattr(room, "apartment", None) is not None})

    results = {
        "students_processed": len(students),
        "successful_assignments": 0,
        "mutual_roommate_matches": 0,
        "one_sided_roommate_matches": 0,
        "conflicts": 0,
        "solver_status": None,
        "objective_value": None,
        "wall_time": None,
        "warnings": [],
        "students_with_no_feasible_beds": [],
    }

    _allocation_solver_log("input", students=len(students), rooms=len(rooms), apartments=len(apartments))

    if not students or not rooms:
        results["conflicts"] = len(students)
        return results

    candidate_beds, room_by_bed, apartment_by_bed, beds_by_room, beds_by_apartment = _prepare_candidate_beds(rooms)
    free_capacity_by_room = _room_free_capacity_from_beds(beds_by_room)
    candidate_rooms = [room for room in rooms if free_capacity_by_room.get(room.id, 0) > 0]

    _allocation_solver_log(
        "candidate_supply",
        candidate_beds=len(candidate_beds),
        candidate_rooms=len(candidate_rooms),
        free_capacity=sum(free_capacity_by_room.values()),
    )

    if not candidate_beds or not candidate_rooms:
        results["conflicts"] = len(students)
        results["warnings"].append("No free beds available.")
        return results

    hard_same_gender = True  # Safety rule: apartment gender category should never be softened.
    hard_priority_first = _is_constraint_hard(constraints_config, "priorityFirst")
    hard_roommate_positive = _is_constraint_hard(constraints_config, "roommatePositiveOnly")
    hard_religious_together = _is_constraint_hard(constraints_config, "ReligiousTogether")

    positive_roommate_flag_count = _count_positive_roommate_flags(students)
    if hard_roommate_positive and positive_roommate_flag_count == 0:
        # The current Excel import stores roommate names but does not populate the positive flags.
        # If we enforce positive-only with zero flags, every matched roommate request becomes
        # impossible to satisfy. Treat the requests as ordinary preferences until import maps flags.
        hard_roommate_positive = False
        results["warnings"].append(
            "roommatePositiveOnly was requested, but no positive roommate flags exist in this batch; treating roommate requests as preferences."
        )
        _allocation_solver_log("roommate_positive_only_disabled", reason="no_positive_flags")

    student_candidate_rooms, student_candidate_apartments, candidate_room_ids_by_apartment = _build_room_level_candidate_maps(
        students,
        candidate_rooms,
        beds_by_room,
        hard_same_gender,
    )

    feasible_y_keys = []
    for student in students:
        if not student_candidate_rooms[student.id]:
            results["students_with_no_feasible_beds"].append(student.id)
        for room_id in student_candidate_rooms[student.id]:
            feasible_y_keys.append((student.id, room_id))

    roommate_pairs = _build_relevant_roommate_pairs(students)
    pair_apartment_keys = []
    for s1, s2 in roommate_pairs:
        common_apartments = set(student_candidate_apartments[s1.id]) & set(student_candidate_apartments[s2.id])
        for apt_id in common_apartments:
            pair_apartment_keys.append((s1.id, s2.id, apt_id))

    _allocation_solver_log(
        "model_size_before_build",
        feasible_assignment_vars=len(feasible_y_keys),
        roommate_pairs=len(roommate_pairs),
        pair_apartment_keys=len(pair_apartment_keys),
        no_feasible=len(results["students_with_no_feasible_beds"]),
    )
    model = cp_model.CpModel()

    y = {}
    for s_id, room_id in feasible_y_keys:
        y[(s_id, room_id)] = model.NewBoolVar(f"y_s{s_id}_room{room_id}")

    a = {}
    for student in students:
        for apt_id in student_candidate_apartments[student.id]:
            a[(student.id, apt_id)] = model.NewBoolVar(f"a_s{student.id}_apt{apt_id}")

    same_apartment = {}
    for s1_id, s2_id, apt_id in pair_apartment_keys:
        same_apartment[(s1_id, s2_id, apt_id)] = model.NewBoolVar(
            f"same_apt_s{s1_id}_s{s2_id}_a{apt_id}"
        )

    # Each student can be assigned to at most one room.
    for student in students:
        vars_for_student = [y[(student.id, room_id)] for room_id in student_candidate_rooms[student.id]]
        if vars_for_student:
            model.Add(sum(vars_for_student) <= 1)

    # Room capacity is based on actual currently free beds.
    students_by_room = defaultdict(list)
    for student in students:
        for room_id in student_candidate_rooms[student.id]:
            students_by_room[room_id].append(y[(student.id, room_id)])

    for room in candidate_rooms:
        room_vars = students_by_room.get(room.id, [])
        if room_vars:
            model.Add(sum(room_vars) <= free_capacity_by_room[room.id])

    # Link room assignment to apartment assignment.
    for student in students:
        for apt_id in student_candidate_apartments[student.id]:
            candidate_room_ids = [
                room_id for room_id in candidate_room_ids_by_apartment.get(apt_id, [])
                if (student.id, room_id) in y
            ]
            if candidate_room_ids:
                model.Add(sum(y[(student.id, room_id)] for room_id in candidate_room_ids) == a[(student.id, apt_id)])
            else:
                model.Add(a[(student.id, apt_id)] == 0)

    # Same-apartment variables only for explicit roommate-request pairs.
    for s1_id, s2_id, apt_id in pair_apartment_keys:
        z = same_apartment[(s1_id, s2_id, apt_id)]
        model.Add(z <= a[(s1_id, apt_id)])
        model.Add(z <= a[(s2_id, apt_id)])
        model.Add(z >= a[(s1_id, apt_id)] + a[(s2_id, apt_id)] - 1)

    if hard_religious_together:
        used_pref_count = _add_hard_single_religious_pref_per_apartment(
            model,
            students,
            apartments,
            a,
            student_candidate_apartments,
        )
        _allocation_solver_log("hard_religious_together_added", used_pref_vars=used_pref_count)

    if hard_roommate_positive:
        pair_apartment_lookup = defaultdict(list)
        for s1_id, s2_id, apt_id in pair_apartment_keys:
            pair_apartment_lookup[(s1_id, s2_id)].append(apt_id)

        for s1, s2 in roommate_pairs:
            key = tuple(sorted([s1.id, s2.id]))
            common_apartments = pair_apartment_lookup.get(key, [])

            if _students_mutually_requested_each_other(s1, s2) and not _students_have_mutual_positive_roommate_request(s1, s2):
                for apt_id in common_apartments:
                    model.Add(a[(s1.id, apt_id)] + a[(s2.id, apt_id)] <= 1)

            if _students_have_mutual_positive_roommate_request(s1, s2) and common_apartments:
                model.Add(
                    sum(same_apartment[(key[0], key[1], apt_id)] for apt_id in common_apartments) ==
                    sum(a[(s1.id, apt_id)] for apt_id in student_candidate_apartments[s1.id])
                )
                model.Add(
                    sum(same_apartment[(key[0], key[1], apt_id)] for apt_id in common_apartments) ==
                    sum(a[(s2.id, apt_id)] for apt_id in student_candidate_apartments[s2.id])
                )

    if hard_priority_first:
        priority_students = [student for student in students if _get_student_priority(student)]
        if priority_students:
            priority_room_ids = set()
            for student in priority_students:
                priority_room_ids.update(student_candidate_rooms[student.id])
            priority_supply = sum(free_capacity_by_room.get(room_id, 0) for room_id in priority_room_ids)

            if priority_supply >= len(priority_students):
                for student in priority_students:
                    feasible_vars = [y[(student.id, room_id)] for room_id in student_candidate_rooms[student.id]]
                    if feasible_vars:
                        model.Add(sum(feasible_vars) == 1)
            else:
                results["warnings"].append(
                    "Priority bed shortage detected. Hard priority rule was relaxed to avoid infeasibility."
                )

    objective_terms = []

    for student in students:
        for room_id in student_candidate_rooms[student.id]:
            objective_terms.append(y[(student.id, room_id)] * BASE_ASSIGNMENT_SCORE)

    for student in students:
        if _get_student_priority(student):
            for room_id in student_candidate_rooms[student.id]:
                objective_terms.append(y[(student.id, room_id)] * PRIORITY_SCORE)

    use_same_religion = _is_constraint_soft(constraints_config, "sameReligion")
    # Roommate matching must still influence the objective even if the frontend sends strict=True.
    # Making every request hard can make large regional allocation infeasible, so strict means
    # high-priority preference here unless positive-only flags are actually populated.
    use_roommate_match = bool((constraints_config.get("roommateMatch") or {}).get("enabled"))
    use_sector_matching = _is_constraint_soft(constraints_config, "sectorMatching")
    use_avoid_year_mix = _is_constraint_soft(constraints_config, "avoidYearMix_1_with_3_4")
    use_avoid_atudaim_hasmaha = _is_constraint_soft(constraints_config, "avoidAtudaimWithHasmaha")

    same_religion_w = _constraint_weight(constraints_config, "sameReligion", 5)
    roommate_match_w = _constraint_weight(constraints_config, "roommateMatch", 8)
    sector_matching_w = _constraint_weight(constraints_config, "sectorMatching", 5)
    avoid_year_mix_w = _constraint_weight(constraints_config, "avoidYearMix_1_with_3_4", 6)
    avoid_atudaim_hasmaha_w = _constraint_weight(constraints_config, "avoidAtudaimWithHasmaha", 6)

    if use_roommate_match:
        for s1, s2 in roommate_pairs:
            key = tuple(sorted([s1.id, s2.id]))
            common_apartments = set(student_candidate_apartments[s1.id]) & set(student_candidate_apartments[s2.id])
            for apt_id in common_apartments:
                z = same_apartment.get((key[0], key[1], apt_id))
                if z is None:
                    continue

                if _students_have_mutual_positive_roommate_request(s1, s2):
                    objective_terms.append(z * roommate_match_w * WEIGHT_UNIT)
                elif _students_mutually_requested_each_other(s1, s2):
                    objective_terms.append(z * max(1, roommate_match_w // 2) * WEIGHT_UNIT)
                elif _students_have_any_positive_roommate_request(s1, s2):
                    objective_terms.append(z * max(1, roommate_match_w // 2) * WEIGHT_UNIT)
                elif _students_one_sided_roommate_request(s1, s2):
                    objective_terms.append(z * max(1, roommate_match_w // 3) * WEIGHT_UNIT)

    soft_group_vars = 0
    if use_same_religion:
        soft_group_vars += _add_soft_group_compaction(
            model, objective_terms, students, apartments, a, student_candidate_apartments,
            _student_religion_key, same_religion_w,
        )

    if use_sector_matching:
        soft_group_vars += _add_soft_group_compaction(
            model, objective_terms, students, apartments, a, student_candidate_apartments,
            _student_sector_key, sector_matching_w,
        )

    soft_mix_vars = 0
    if use_avoid_year_mix:
        soft_mix_vars += _add_soft_mix_penalty(
            model,
            objective_terms,
            students,
            apartments,
            a,
            student_candidate_apartments,
            lambda s: _get_student_year_group(s) == "year1",
            lambda s: _get_student_year_group(s) == "year3_4",
            avoid_year_mix_w,
            "year",
        )

    if use_avoid_atudaim_hasmaha:
        soft_mix_vars += _add_soft_mix_penalty(
            model,
            objective_terms,
            students,
            apartments,
            a,
            student_candidate_apartments,
            _is_atudai,
            _is_hasmaha,
            avoid_atudaim_hasmaha_w,
            "atudai_hasmaha",
        )

    _allocation_solver_log(
        "model_features",
        y_vars=len(y),
        apartment_vars=len(a),
        same_apartment_vars=len(same_apartment),
        soft_group_vars=soft_group_vars,
        soft_mix_vars=soft_mix_vars,
        objective_terms=len(objective_terms),
    )

    if objective_terms:
        model.Maximize(sum(objective_terms))
    else:
        model.Maximize(0)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = MAX_SOLVER_TIME_SECONDS
    solver.parameters.num_search_workers = NUM_SEARCH_WORKERS

    _allocation_solver_log("cp_sat_solve_start", max_seconds=MAX_SOLVER_TIME_SECONDS, workers=NUM_SEARCH_WORKERS)
    status = solver.Solve(model)
    _allocation_solver_log("cp_sat_solve_end", raw_status=status, wall_time=solver.WallTime())

    status_map = {
        cp_model.OPTIMAL: "OPTIMAL",
        cp_model.FEASIBLE: "FEASIBLE",
        cp_model.INFEASIBLE: "INFEASIBLE",
        cp_model.MODEL_INVALID: "MODEL_INVALID",
        cp_model.UNKNOWN: "UNKNOWN",
    }

    results["solver_status"] = status_map.get(status, str(status))
    results["wall_time"] = solver.WallTime()

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        results["conflicts"] = len(students)
        if results["students_with_no_feasible_beds"]:
            results["warnings"].append(
                f"Students with no feasible beds: {results['students_with_no_feasible_beds']}"
            )
        return results

    try:
        results["objective_value"] = solver.ObjectiveValue()
    except Exception:
        results["objective_value"] = None

    candidate_bed_by_id = {b.id: b for b in candidate_beds}
    assigned_students = set()
    selected_room_by_student_id = {}

    _allocation_solver_log(
        "extract_selected_assignments_start",
        students=len(students),
        candidate_assignment_vars=len(y),
    )

    for student in students:
        for room_id in student_candidate_rooms[student.id]:
            if solver.Value(y[(student.id, room_id)]) == 1:
                selected_room_by_student_id[student.id] = room_id
                assigned_students.add(student.id)
                break

    _allocation_solver_log(
        "extract_selected_assignments_end",
        selected_students=len(selected_room_by_student_id),
    )

    used_free_bed_index_by_room = defaultdict(int)
    assignments_to_create = []
    students_to_update = []
    selected_student_ids = []

    _allocation_solver_log("prepare_bulk_persist_start")

    now = timezone.now()
    has_student_updated_at = hasattr(Student, "updated_at")

    for student in students:
        room_id = selected_room_by_student_id.get(student.id)
        if room_id is None:
            continue

        free_beds = beds_by_room.get(room_id, [])
        next_index = used_free_bed_index_by_room[room_id]

        if next_index >= len(free_beds):
            # Defensive guard; should not happen because of room capacity constraints.
            results["warnings"].append(f"No free bed left while persisting room {room_id}.")
            assigned_students.discard(student.id)
            continue

        bed = free_beds[next_index]
        used_free_bed_index_by_room[room_id] += 1

        assignments_to_create.append(
            BedAssignment(
                student=student,
                bed=bed,
                status=BedAssignment.Status.ACTIVE,
                assignment_type=BedAssignment.AssignmentType.INITIAL,
            )
        )

        if hasattr(student, "assigned_room_id"):
            student.assigned_room_id = room_id
        elif hasattr(student, "assigned_room"):
            # Fallback for unusual model variants.
            student.assigned_room = next((room for room in candidate_rooms if room.id == room_id), None)

        if has_student_updated_at:
            student.updated_at = now

        students_to_update.append(student)
        selected_student_ids.append(student.id)

    _allocation_solver_log(
        "prepare_bulk_persist_end",
        assignments_to_create=len(assignments_to_create),
        students_to_update=len(students_to_update),
    )

    # Important: refresh any stale DB connection before the persistence phase.
    close_old_connections()

    _allocation_solver_log("db_bulk_persist_start")

    student_update_fields = ["assigned_room"]
    if has_student_updated_at:
        student_update_fields.append("updated_at")

    # Persist assignments in one short database transaction. This avoids the slow
    # per-student update/create/save loop that can hang with remote Neon/Postgres.
    with transaction.atomic():
        if selected_student_ids:
            BedAssignment.objects.filter(
                student_id__in=selected_student_ids,
                status=BedAssignment.Status.ACTIVE,
            ).update(
                status=BedAssignment.Status.ENDED,
                ended_at=now,
            )

        if assignments_to_create:
            BedAssignment.objects.bulk_create(
                assignments_to_create,
                batch_size=500,
            )

        if students_to_update:
            Student.objects.bulk_update(
                students_to_update,
                student_update_fields,
                batch_size=500,
            )

    results["successful_assignments"] = len(assignments_to_create)

    _allocation_solver_log(
        "db_bulk_persist_end",
        successful_assignments=results["successful_assignments"],
    )

    mutual_roommate_matches = 0
    one_sided_roommate_matches = 0

    for s1, s2 in roommate_pairs:
        if s1.id not in assigned_students or s2.id not in assigned_students:
            continue

        room1_id = selected_room_by_student_id.get(s1.id)
        room2_id = selected_room_by_student_id.get(s2.id)
        if room1_id is None or room2_id is None:
            continue

        room1 = next((room for room in candidate_rooms if room.id == room1_id), None)
        room2 = next((room for room in candidate_rooms if room.id == room2_id), None)
        if not room1 or not room2 or room1.apartment_id != room2.apartment_id:
            continue

        if _students_have_mutual_positive_roommate_request(s1, s2):
            mutual_roommate_matches += 1
        elif _students_mutually_requested_each_other(s1, s2) or _students_one_sided_roommate_request(s1, s2):
            one_sided_roommate_matches += 1

    results["mutual_roommate_matches"] = mutual_roommate_matches
    results["one_sided_roommate_matches"] = one_sided_roommate_matches
    results["conflicts"] = len(students) - len(assigned_students)

    if results["students_with_no_feasible_beds"]:
        results["warnings"].append(
            f"Students with no feasible beds: {results['students_with_no_feasible_beds']}"
        )

    _allocation_solver_log(
        "result",
        students_processed=results["students_processed"],
        successful_assignments=results["successful_assignments"],
        conflicts=results["conflicts"],
        mutual_roommate_matches=results["mutual_roommate_matches"],
        one_sided_roommate_matches=results["one_sided_roommate_matches"],
    )

    return results
