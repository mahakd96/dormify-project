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

    The solver supports:
    1. A consolidated `roommate_request_ids` field when present.
    2. The schema fields `roommate_request_1..5`.
    3. Optional positive-response flags `roommate_request_flag_1..5`.

    Each returned item is a dict:
    {
        "target": "<normalized requested student identifier>",
        "positive": <bool>
    }
    """
    roommate_requests = []

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

    fallback_pairs = [
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

    for request_value, request_flag in fallback_pairs:
        target = _normalize_roommate_identifier(request_value)
        if not target:
            continue

        roommate_requests.append({
            "target": target,
            "positive": bool(request_flag),
        })

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


def _student_requested_roommate(student, target_student):
    """Return True when `student` requested `target_student` in any roommate slot."""
    target_identifier = _get_student_identifier(target_student)
    return target_identifier in _get_student_roommate_request_targets(student)


def _student_positive_roommate_request(student, target_student):
    """Return True when `student` requested `target_student` and marked it positive."""
    target_identifier = _get_student_identifier(target_student)
    return target_identifier in _get_student_positive_roommate_request_targets(student)


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
    if _needs_accessibility(student) and not _apartment_is_accessible(apartment):
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


def run_improved_ortools_allocation(students, rooms, constraints_config):
    """
    Run the OR-Tools-based dorm allocation.

    The solver performs three phases:
    1. Normalize and prepare the input data.
    2. Build and solve the CP-SAT model entirely in memory.
    3. Reconnect safely to the database and persist assignments in a short transaction.

    This design avoids keeping a long-lived database transaction open during the solve,
    which is especially important when using hosted Postgres connections such as Neon.
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

    if not students or not rooms:
        results["conflicts"] = len(students)
        return results

    candidate_beds, room_by_bed, apartment_by_bed, beds_by_room, beds_by_apartment = _prepare_candidate_beds(rooms)

    if not candidate_beds:
        results["conflicts"] = len(students)
        results["warnings"].append("No free beds available.")
        return results

    hard_same_gender = _is_constraint_hard(constraints_config, "sameGender")
    hard_priority_first = _is_constraint_hard(constraints_config, "priorityFirst")
    hard_roommate_positive = _is_constraint_hard(constraints_config, "roommatePositiveOnly")
    hard_religious_together = _is_constraint_hard(constraints_config, "ReligiousTogether")

    student_candidate_beds, feasible_x_keys = _build_feasible_bed_maps(
        students,
        candidate_beds,
        room_by_bed,
        apartment_by_bed,
        hard_same_gender,
    )

    for s in students:
        if not student_candidate_beds[s.id]:
            results["students_with_no_feasible_beds"].append(s.id)

    student_candidate_rooms, student_candidate_apartments = _build_room_and_apartment_maps(
        students,
        rooms,
        apartments,
        student_candidate_beds,
        beds_by_room,
        beds_by_apartment,
    )

    student_pairs, pair_apartment_keys = _build_feasible_pair_apartment_keys(
        students,
        apartments,
        student_candidate_apartments,
        hard_same_gender,
    )
    model = cp_model.CpModel()
    x = {}
    for s_id, bed_id in feasible_x_keys:
        x[(s_id, bed_id)] = model.NewBoolVar(f"x_s{s_id}_b{bed_id}")

    r = {}
    for s in students:
        for room_id in student_candidate_rooms[s.id]:
            r[(s.id, room_id)] = model.NewBoolVar(f"r_s{s.id}_room{room_id}")

    a = {}
    for s in students:
        for apt_id in student_candidate_apartments[s.id]:
            a[(s.id, apt_id)] = model.NewBoolVar(f"a_s{s.id}_apt{apt_id}")

    same_apartment = {}
    for s1_id, s2_id, apt_id in pair_apartment_keys:
        same_apartment[(s1_id, s2_id, apt_id)] = model.NewBoolVar(
            f"same_apt_s{s1_id}_s{s2_id}_a{apt_id}"
        )

    for s in students:
        student_x_vars = [x[(s.id, bed_id)] for bed_id in student_candidate_beds[s.id]]
        if student_x_vars:
            model.Add(sum(student_x_vars) <= 1)

    for bed in candidate_beds:
        bed_vars = [x[(s.id, bed.id)] for s in students if (s.id, bed.id) in x]
        if bed_vars:
            model.Add(sum(bed_vars) <= 1)

    for s in students:
        for room_id in student_candidate_rooms[s.id]:
            room_beds = [b.id for b in beds_by_room.get(room_id, []) if (s.id, b.id) in x]
            if room_beds:
                model.Add(sum(x[(s.id, bed_id)] for bed_id in room_beds) == r[(s.id, room_id)])
            else:
                model.Add(r[(s.id, room_id)] == 0)

    apartment_rooms = defaultdict(list)
    for room in rooms:
        apartment_rooms[room.apartment.id].append(room.id)

    for s in students:
        for apt_id in student_candidate_apartments[s.id]:
            candidate_room_ids = [
                room_id for room_id in apartment_rooms.get(apt_id, [])
                if (s.id, room_id) in r
            ]
            if candidate_room_ids:
                model.Add(sum(r[(s.id, room_id)] for room_id in candidate_room_ids) == a[(s.id, apt_id)])
            else:
                model.Add(a[(s.id, apt_id)] == 0)

    for s1_id, s2_id, apt_id in pair_apartment_keys:
        z = same_apartment[(s1_id, s2_id, apt_id)]
        model.Add(z <= a[(s1_id, apt_id)])
        model.Add(z <= a[(s2_id, apt_id)])
        model.Add(z >= a[(s1_id, apt_id)] + a[(s2_id, apt_id)] - 1)

    if hard_religious_together:
        for s1, s2 in student_pairs:
            if not _students_same_requested_religious_pref(s1, s2):
                common_apartments = set(student_candidate_apartments[s1.id]) & set(student_candidate_apartments[s2.id])
                for apt_id in common_apartments:
                    model.Add(a[(s1.id, apt_id)] + a[(s2.id, apt_id)] <= 1)

    if hard_roommate_positive:
        for s1, s2 in student_pairs:
            if _students_mutually_requested_each_other(s1, s2) and not _students_have_mutual_positive_roommate_request(s1, s2):
                common_apartments = set(student_candidate_apartments[s1.id]) & set(student_candidate_apartments[s2.id])
                for apt_id in common_apartments:
                    model.Add(a[(s1.id, apt_id)] + a[(s2.id, apt_id)] <= 1)

            if _students_have_mutual_positive_roommate_request(s1, s2):
                common_apartments = set(student_candidate_apartments[s1.id]) & set(student_candidate_apartments[s2.id])
                if common_apartments:
                    model.Add(
                        sum(same_apartment[(s1.id, s2.id, apt_id)] for apt_id in common_apartments) ==
                        sum(a[(s1.id, apt_id)] for apt_id in student_candidate_apartments[s1.id])
                    )
                    model.Add(
                        sum(same_apartment[(s1.id, s2.id, apt_id)] for apt_id in common_apartments) ==
                        sum(a[(s2.id, apt_id)] for apt_id in student_candidate_apartments[s2.id])
                    )

    if hard_priority_first:
        priority_students = [s for s in students if _get_student_priority(s)]
        if priority_students:
            if _priority_students_have_enough_supply(priority_students, student_candidate_beds):
                for s in priority_students:
                    feasible_vars = [x[(s.id, bed_id)] for bed_id in student_candidate_beds[s.id]]
                    if feasible_vars:
                        model.Add(sum(feasible_vars) == 1)
            else:
                results["warnings"].append(
                    "Priority bed shortage detected. Hard priority rule was relaxed to avoid infeasibility."
                )

    objective_terms = []

    for s in students:
        for bed_id in student_candidate_beds[s.id]:
            objective_terms.append(x[(s.id, bed_id)] * BASE_ASSIGNMENT_SCORE)

    for s in students:
        if _get_student_priority(s):
            for bed_id in student_candidate_beds[s.id]:
                objective_terms.append(x[(s.id, bed_id)] * PRIORITY_SCORE)

    use_same_religion = _is_constraint_soft(constraints_config, "sameReligion")
    use_roommate_match = _is_constraint_soft(constraints_config, "roommateMatch")
    use_sector_matching = _is_constraint_soft(constraints_config, "sectorMatching")
    use_avoid_year_mix = _is_constraint_soft(constraints_config, "avoidYearMix_1_with_3_4")
    use_avoid_atudaim_hasmaha = _is_constraint_soft(constraints_config, "avoidAtudaimWithHasmaha")

    same_religion_w = _constraint_weight(constraints_config, "sameReligion", 5)
    roommate_match_w = _constraint_weight(constraints_config, "roommateMatch", 8)
    sector_matching_w = _constraint_weight(constraints_config, "sectorMatching", 5)
    avoid_year_mix_w = _constraint_weight(constraints_config, "avoidYearMix_1_with_3_4", 6)
    avoid_atudaim_hasmaha_w = _constraint_weight(constraints_config, "avoidAtudaimWithHasmaha", 6)

    for s1, s2 in student_pairs:
        common_apartments = set(student_candidate_apartments[s1.id]) & set(student_candidate_apartments[s2.id])

        for apt_id in common_apartments:
            z = same_apartment[(s1.id, s2.id, apt_id)]

            if use_roommate_match and _students_have_mutual_positive_roommate_request(s1, s2):
                objective_terms.append(z * roommate_match_w * WEIGHT_UNIT)

            elif use_roommate_match and _students_mutually_requested_each_other(s1, s2):
                objective_terms.append(z * max(1, roommate_match_w // 2) * WEIGHT_UNIT)

            elif use_roommate_match and _students_have_any_positive_roommate_request(s1, s2):
                objective_terms.append(z * max(1, roommate_match_w // 2) * WEIGHT_UNIT)

            elif use_roommate_match and _students_one_sided_roommate_request(s1, s2):
                objective_terms.append(z * max(1, roommate_match_w // 3) * WEIGHT_UNIT)

            if use_same_religion and _students_same_religion(s1, s2):
                objective_terms.append(z * same_religion_w * WEIGHT_UNIT)

            if use_sector_matching and _students_same_sector(s1, s2):
                objective_terms.append(z * sector_matching_w * WEIGHT_UNIT)

            if use_avoid_year_mix and _should_avoid_year_mix(s1, s2):
                objective_terms.append(z * (-avoid_year_mix_w * WEIGHT_UNIT))

            if use_avoid_atudaim_hasmaha and _should_avoid_atudaim_hasmaha_mix(s1, s2):
                objective_terms.append(z * (-avoid_atudaim_hasmaha_w * WEIGHT_UNIT))

    if objective_terms:
        model.Maximize(sum(objective_terms))
    else:
        model.Maximize(0)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = MAX_SOLVER_TIME_SECONDS
    solver.parameters.num_search_workers = NUM_SEARCH_WORKERS

    status = solver.Solve(model)

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

    # Important: refresh any stale DB connection before the persistence phase.
    close_old_connections()

    # Persist assignments in a short transaction after the solve completes.
    with transaction.atomic():
        for s in students:
            for bed_id in student_candidate_beds[s.id]:
                if solver.Value(x[(s.id, bed_id)]) == 1:
                    bed = candidate_bed_by_id.get(bed_id)
                    if bed is not None:
                        _assign_student_to_bed(s, bed)
                        assigned_students.add(s.id)
                        results["successful_assignments"] += 1
                    break

    mutual_roommate_matches = 0
    one_sided_roommate_matches = 0

    for s1, s2 in student_pairs:
        common_apartments = set(student_candidate_apartments[s1.id]) & set(student_candidate_apartments[s2.id])
        same_apartment_any = any(
            solver.Value(same_apartment[(s1.id, s2.id, apt_id)]) == 1
            for apt_id in common_apartments
        ) if common_apartments else False

        if same_apartment_any:
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

    return results