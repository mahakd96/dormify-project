from collections import defaultdict
from itertools import combinations
import re
import unicodedata

from django.db import close_old_connections, transaction
from django.utils import timezone

from api.models import Apartment, Bed, BedAssignment, Room, Student

try:
    from ortools.sat.python import cp_model
    ORTOOLS_AVAILABLE = True
except ImportError:
    ORTOOLS_AVAILABLE = False


BASE_ASSIGNMENT_SCORE = 1000
WEIGHT_UNIT = 10
MAX_SOLVER_TIME_SECONDS = 500
NUM_SEARCH_WORKERS = 2


EXCLUSIVE_HOUSING_TYPES = {
    Student.HousingType.COUPLE,
    Student.HousingType.FAMILY,
    Student.HousingType.SINGLE_IN_APARTMENT,
}


def _safe_str(value):
    return str(value).strip() if value is not None else ""


def _safe_lower(value):
    return _safe_str(value).lower()


def _parse_bool_yes(value):
    if isinstance(value, bool):
        return value
    return _safe_lower(value) in {"כן", "yes", "true", "1", "x", "v", "y"}


def _is_constraint_hard(config, key):
    constraint = config.get(key, {}) or {}
    if "critical" in constraint:
        return bool(constraint.get("critical"))
    return bool(constraint.get("enabled")) and bool(constraint.get("strict"))


def _is_constraint_soft(config, key):
    constraint = config.get(key, {}) or {}
    return bool(constraint.get("enabled")) and not _is_constraint_hard(config, key)


def _constraint_weight(config, key, default=0):
    constraint = config.get(key, {}) or {}
    try:
        return max(0, int(constraint.get("weight", default) or 0))
    except (TypeError, ValueError):
        return max(0, int(default))


def _get_student_identifier(student):
    value = _normalize_roommate_identifier(getattr(student, "student_id", ""))
    if value:
        return value
    return _normalize_roommate_identifier(getattr(student, "id", ""))


def _get_student_full_name(student):
    first_name = _normalize_roommate_identifier(getattr(student, "first_name", ""))
    last_name = _normalize_roommate_identifier(getattr(student, "last_name", ""))
    return _normalize_roommate_identifier(f"{first_name} {last_name}")


def _get_student_priority(student):
    return bool(getattr(student, "is_priority", False))


def _get_student_religion(student):
    return _safe_str(
        getattr(student, "requested_religion", None)
        or getattr(student, "religion", None)
    )


def _get_student_religious_pref(student):
    return _safe_str(
        getattr(student, "religious", None)
        or getattr(student, "religious_for_placement", None)
        or getattr(student, "religious_preference", None)
    )


def _get_student_sector(student):
    raw_sector = _safe_lower(
        getattr(student, "placement_sector", None)
        or getattr(student, "sector", None)
        or getattr(student, "requested_sector", None)
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
        normalized = sector_map.get(raw_sector, raw_sector)
        if normalized != "unknown":
            return normalized

    religion = _safe_lower(_get_student_religion(student))
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


def _get_student_academic_points(student):
    value = (
        getattr(student, "study_points", None)
        or getattr(student, "academic_points_total", None)
    )
    try:
        return float(value) if value is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def _get_student_year_group(student):
    points = _get_student_academic_points(student)
    if 0 <= points <= 40:
        return "year1"
    if points >= 60:
        return "year3_4"
    return "other"


def _collect_special_status_text(student):
    values = [
        getattr(student, "special_status_1", ""),
        getattr(student, "special_status_2", ""),
        getattr(student, "special_status_3", ""),
        getattr(student, "special_status_4", ""),
    ]
    return " | ".join(_safe_lower(value) for value in values if _safe_str(value))


def _is_atudai(student):
    return "עתודאי" in _collect_special_status_text(student)


def _is_hasmaha(student):
    return "הסמכה" in _collect_special_status_text(student)


def _needs_accessibility(student):
    return bool(
        getattr(student, "needs_accessibility", False)
        or (
            getattr(student, "is_priority", False)
            and "נגיש" in _safe_lower(getattr(student, "priority_reason", ""))
        )
    )


def _apartment_accessibility_ok(student, apartment):
    if not _needs_accessibility(student):
        return True
    if not hasattr(Apartment, "is_accessible"):
        return True
    return bool(getattr(apartment, "is_accessible", False))


def _normalize_roommate_identifier(value):
    if value is None:
        return ""

    normalized = unicodedata.normalize("NFKC", str(value))
    normalized = normalized.replace("\u200e", "").replace("\u200f", "")
    normalized = normalized.replace("\u202a", "").replace("\u202b", "")
    normalized = normalized.replace("\u202c", "").replace("\xa0", " ")
    normalized = " ".join(normalized.split()).strip()

    if re.fullmatch(r"[+-]?\d+\.0+", normalized):
        normalized = normalized.split(".", 1)[0]

    return normalized


def _normalize_match_text(value):
    normalized = _normalize_roommate_identifier(value)
    normalized = normalized.replace(",", " ").replace(";", " ")
    return " ".join(normalized.split()).strip()


def _compact_match_text(value):
    normalized = _safe_lower(_normalize_match_text(value))
    return re.sub(r"[^\w]+", "", normalized, flags=re.UNICODE)


def _roommate_target_match_keys(value):
    normalized = _normalize_match_text(value)
    if not normalized:
        return set()
    return {
        key
        for key in {
            normalized,
            _safe_lower(normalized),
            _compact_match_text(normalized),
        }
        if key
    }


def _student_roommate_match_keys(student):
    identifier = _normalize_match_text(_get_student_identifier(student))
    first_name = _normalize_match_text(getattr(student, "first_name", ""))
    last_name = _normalize_match_text(getattr(student, "last_name", ""))
    values = {
        identifier,
        _normalize_match_text(f"{first_name} {last_name}"),
        _normalize_match_text(f"{last_name} {first_name}"),
    }

    keys = set()
    for value in values:
        if not value:
            continue
        keys.add(value)
        keys.add(_safe_lower(value))
        keys.add(_compact_match_text(value))
    return keys


def _get_student_roommate_requests(student):
    current_pairs = [
        (
            getattr(student, f"roommate_request_student_id_{index}", ""),
            getattr(student, f"roommate_request_flag_{index}", False),
        )
        for index in range(1, 6)
    ]

    if any(_normalize_roommate_identifier(value) for value, _ in current_pairs):
        return [
            {
                "target": target,
                "positive": _parse_bool_yes(flag),
            }
            for value, flag in current_pairs
            if (target := _normalize_roommate_identifier(value))
        ]

    roommate_ids = getattr(student, "roommate_request_ids", None)
    if isinstance(roommate_ids, (list, tuple, set)):
        return [
            {"target": target, "positive": True}
            for value in roommate_ids
            if (target := _normalize_roommate_identifier(value))
        ]

    if isinstance(roommate_ids, str):
        return [
            {"target": target, "positive": True}
            for value in roommate_ids.split(",")
            if (target := _normalize_roommate_identifier(value))
        ]

    legacy_pairs = [
        (
            getattr(student, f"roommate_request_{index}", ""),
            getattr(student, f"roommate_request_flag_{index}", False),
        )
        for index in range(1, 6)
    ]

    return [
        {
            "target": target,
            "positive": _parse_bool_yes(flag),
        }
        for value, flag in legacy_pairs
        if (target := _normalize_roommate_identifier(value))
    ]


def _get_roommate_targets(student, positive_only=False):
    return {
        item["target"]
        for item in _get_student_roommate_requests(student)
        if item["target"] and (item["positive"] or not positive_only)
    }


def _student_requested_roommate(student, target_student, positive_only=False):
    request_keys = set()
    for target in _get_roommate_targets(student, positive_only=positive_only):
        request_keys.update(_roommate_target_match_keys(target))
    return bool(request_keys & _student_roommate_match_keys(target_student))


def _students_mutually_requested_each_other(student_1, student_2):
    return _student_requested_roommate(student_1, student_2) and _student_requested_roommate(
        student_2,
        student_1,
    )


def _students_one_sided_roommate_request(student_1, student_2):
    return _student_requested_roommate(student_1, student_2) ^ _student_requested_roommate(
        student_2,
        student_1,
    )


def _students_have_mutual_positive_roommate_request(student_1, student_2):
    return _student_requested_roommate(
        student_1,
        student_2,
        positive_only=True,
    ) and _student_requested_roommate(
        student_2,
        student_1,
        positive_only=True,
    )


def _students_have_any_positive_roommate_request(student_1, student_2):
    return _student_requested_roommate(
        student_1,
        student_2,
        positive_only=True,
    ) or _student_requested_roommate(
        student_2,
        student_1,
        positive_only=True,
    )


def _students_by_roommate_lookup(students):
    lookup = {}
    for student in students:
        for key in _student_roommate_match_keys(student):
            lookup.setdefault(key, student)
    return lookup


def _resolve_roommate_target(lookup, target):
    for key in _roommate_target_match_keys(target):
        student = lookup.get(key)
        if student is not None:
            return student
    return None


def _build_relevant_roommate_pairs(students):
    lookup = _students_by_roommate_lookup(students)
    pairs = {}
    unmatched = []

    for student in students:
        for target in _get_roommate_targets(student):
            target_student = _resolve_roommate_target(lookup, target)
            if target_student is None or target_student.id == student.id:
                if len(unmatched) < 20:
                    unmatched.append(
                        {
                            "student_id": _get_student_identifier(student),
                            "target": target,
                        }
                    )
                continue

            first_id, second_id = sorted((student.id, target_student.id))
            if first_id == student.id:
                pairs[(first_id, second_id)] = (student, target_student)
            else:
                pairs[(first_id, second_id)] = (target_student, student)

    return list(pairs.values()), unmatched


def _religious_pref_key(student):
    value = _safe_lower(unicodedata.normalize("NFKC", _get_student_religious_pref(student)))
    value = " ".join(value.replace("_", " ").split())

    if value in {
        "",
        "לא משנה",
        "ללא העדפה",
        "אין העדפה",
        "no preference",
        "not specified",
        "לא צוין",
        "unknown",
        "לא ידוע",
        "none",
    }:
        return ""

    canonical = {
        "דתי": "religious",
        "דתית": "religious",
        "דתי/ה": "religious",
        "religious": "religious",
        "חרדי": "haredi",
        "חרדית": "haredi",
        "haredi": "haredi",
        "orthodox": "haredi",
        "מסורתי": "traditional",
        "מסורתית": "traditional",
        "traditional": "traditional",
        "חילוני": "secular",
        "חילונית": "secular",
        "secular": "secular",
    }
    return canonical.get(value, value)


def _religion_key(student):
    value = _safe_lower(_get_student_religion(student))
    if value in {"", "not_specified", "לא צוין", "unknown"}:
        return ""
    return value


def _sector_key(student):
    value = _safe_lower(_get_student_sector(student))
    if value in {"", "unknown", "לא ידוע", "not_specified", "לא צוין"}:
        return ""
    return value


def _student_is_exclusive(student):
    return getattr(student, "housing_type", "") in EXCLUSIVE_HOUSING_TYPES


def _housing_matches_apartment(student, apartment):
    housing_type = getattr(student, "housing_type", "")
    apartment_type = getattr(apartment, "apartment_type", None)
    category = getattr(apartment, "category", None)

    if housing_type == Student.HousingType.SINGLE_MALE:
        return (
            apartment_type == Apartment.ApartmentType.SINGLE
            and category == Apartment.Category.MALE
        )

    if housing_type == Student.HousingType.SINGLE_FEMALE:
        return (
            apartment_type == Apartment.ApartmentType.SINGLE
            and category == Apartment.Category.FEMALE
        )

    if housing_type == Student.HousingType.COUPLE:
        return (
            apartment_type == Apartment.ApartmentType.COUPLE
            and category == Apartment.Category.MIXED
        )

    if housing_type == Student.HousingType.FAMILY:
        return (
            apartment_type == Apartment.ApartmentType.FAMILY
            and category == Apartment.Category.MIXED
        )

    if housing_type == Student.HousingType.SINGLE_IN_APARTMENT:
        return apartment_type == Apartment.ApartmentType.COUPLE

    return False


def _accepted_dorm_matches(student, apartment):
    accepted_dorm_type_id = getattr(student, "accepted_dorm_type_id", None)
    if accepted_dorm_type_id is None:
        return True
    return apartment.building.dorm_type_id == accepted_dorm_type_id


def _apartment_is_available_for_student(
    student,
    apartment,
    existing_assignments,
    existing_exclusive,
    existing_religious_preferences,
    hard_religious_together,
):
    building = apartment.building

    if not bool(getattr(building, "is_active", True)):
        return False
    if not bool(getattr(apartment, "is_active", True)):
        return False
    if getattr(apartment, "inactive_reason", "") == Apartment.InactiveReason.RESERVED:
        if not _get_student_priority(student):
            return False
    if not _accepted_dorm_matches(student, apartment):
        return False
    if not _housing_matches_apartment(student, apartment):
        return False
    if not _apartment_accessibility_ok(student, apartment):
        return False

    if _student_is_exclusive(student):
        if existing_assignments:
            return False
    elif existing_exclusive:
        return False

    if hard_religious_together:
        student_preference = _religious_pref_key(student)
        if student_preference and existing_religious_preferences:
            if existing_religious_preferences != {student_preference}:
                return False

    return True


def _ensure_beds_for_room(room):
    capacity = int(getattr(room, "capacity", 0) or 0)
    existing_beds = list(room.beds.all())
    if capacity <= len(existing_beds):
        return

    Bed.objects.bulk_create(
        [
            Bed(room=room, label=f"Bed {index}")
            for index in range(len(existing_beds) + 1, capacity + 1)
        ]
    )


def _normalize_rooms_input(rooms):
    if hasattr(rooms, "select_related"):
        return list(
            rooms.select_related(
                "apartment",
                "apartment__building",
                "apartment__building__dorm_type",
            ).prefetch_related("beds")
        )

    room_ids = [room.id for room in rooms if getattr(room, "id", None) is not None]
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
    if hasattr(students, "select_related"):
        return list(students.select_related("accepted_dorm_type"))
    return list(students)


def _prepare_inventory(rooms):
    room_ids = [room.id for room in rooms]

    active_assignments = list(
        BedAssignment.objects.filter(
            status=BedAssignment.Status.ACTIVE,
            bed__room_id__in=room_ids,
        ).select_related(
            "student",
            "bed",
            "bed__room",
            "bed__room__apartment",
        )
    )

    active_bed_ids = {assignment.bed_id for assignment in active_assignments}
    existing_assignments_by_apartment = defaultdict(list)
    existing_exclusive_by_apartment = defaultdict(bool)
    existing_religious_preferences_by_apartment = defaultdict(set)

    for assignment in active_assignments:
        apartment_id = assignment.bed.room.apartment_id
        existing_assignments_by_apartment[apartment_id].append(assignment)
        if _student_is_exclusive(assignment.student):
            existing_exclusive_by_apartment[apartment_id] = True
        preference = _religious_pref_key(assignment.student)
        if preference:
            existing_religious_preferences_by_apartment[apartment_id].add(preference)

    free_beds_by_apartment = defaultdict(list)
    free_beds_by_room = defaultdict(list)
    apartments_by_id = {}

    for room in rooms:
        if not bool(getattr(room, "is_active", True)):
            continue
        if not bool(getattr(room.apartment, "is_active", True)):
            continue
        if not bool(getattr(room.apartment.building, "is_active", True)):
            continue

        _ensure_beds_for_room(room)
        refreshed_beds = list(room.beds.all())

        for bed in refreshed_beds:
            if bed.id in active_bed_ids:
                continue
            free_beds_by_room[room.id].append(bed)
            free_beds_by_apartment[room.apartment_id].append(bed)
            apartments_by_id[room.apartment_id] = room.apartment

    return {
        "active_assignments": active_assignments,
        "existing_assignments_by_apartment": existing_assignments_by_apartment,
        "existing_exclusive_by_apartment": existing_exclusive_by_apartment,
        "existing_religious_preferences_by_apartment": existing_religious_preferences_by_apartment,
        "free_beds_by_apartment": free_beds_by_apartment,
        "free_beds_by_room": free_beds_by_room,
        "apartments_by_id": apartments_by_id,
    }


def _build_candidate_apartments(
    students,
    apartments,
    inventory,
    hard_religious_together,
):
    candidates = defaultdict(list)

    for student in students:
        for apartment in apartments:
            apartment_id = apartment.id
            if not inventory["free_beds_by_apartment"].get(apartment_id):
                continue

            if _apartment_is_available_for_student(
                student,
                apartment,
                inventory["existing_assignments_by_apartment"].get(apartment_id, []),
                inventory["existing_exclusive_by_apartment"].get(apartment_id, False),
                inventory["existing_religious_preferences_by_apartment"].get(apartment_id, set()),
                hard_religious_together,
            ):
                candidates[student.id].append(apartment_id)

    return candidates


def _link_group_used_var(model, used_var, member_vars):
    if not member_vars:
        model.Add(used_var == 0)
        return
    for variable in member_vars:
        model.Add(variable <= used_var)
    model.Add(used_var <= sum(member_vars))


def _add_hard_religious_together(
    model,
    students,
    apartments,
    assignment_vars,
    student_candidates,
):
    groups_by_apartment = defaultdict(lambda: defaultdict(list))

    for student in students:
        preference = _religious_pref_key(student)
        if not preference:
            continue
        for apartment_id in student_candidates.get(student.id, []):
            variable = assignment_vars.get((student.id, apartment_id))
            if variable is not None:
                groups_by_apartment[apartment_id][preference].append(variable)

    created = 0
    for apartment in apartments:
        used_vars = []
        for group_index, member_vars in enumerate(
            groups_by_apartment.get(apartment.id, {}).values(),
            start=1,
        ):
            used_var = model.NewBoolVar(
                f"religious_group_a{apartment.id}_{group_index}"
            )
            _link_group_used_var(model, used_var, member_vars)
            used_vars.append(used_var)
            created += 1
        if used_vars:
            model.Add(sum(used_vars) <= 1)

    return created


def _add_soft_group_compaction(
    model,
    objective_terms,
    students,
    apartments,
    assignment_vars,
    student_candidates,
    group_function,
    weight,
    label,
):
    if weight <= 0:
        return 0

    groups_by_apartment = defaultdict(lambda: defaultdict(list))

    for student in students:
        group = group_function(student)
        if not group:
            continue
        for apartment_id in student_candidates.get(student.id, []):
            variable = assignment_vars.get((student.id, apartment_id))
            if variable is not None:
                groups_by_apartment[apartment_id][group].append(variable)

    created = 0
    for apartment in apartments:
        for group_index, member_vars in enumerate(
            groups_by_apartment.get(apartment.id, {}).values(),
            start=1,
        ):
            used_var = model.NewBoolVar(
                f"{label}_group_a{apartment.id}_{group_index}"
            )
            _link_group_used_var(model, used_var, member_vars)
            objective_terms.append(used_var * (-weight * WEIGHT_UNIT))
            created += 1

    return created


def _add_soft_mix_penalty(
    model,
    objective_terms,
    students,
    apartments,
    assignment_vars,
    left_function,
    right_function,
    weight,
    label,
):
    if weight <= 0:
        return 0

    created = 0

    for apartment in apartments:
        left_vars = []
        right_vars = []

        for student in students:
            variable = assignment_vars.get((student.id, apartment.id))
            if variable is None:
                continue
            if left_function(student):
                left_vars.append(variable)
            if right_function(student):
                right_vars.append(variable)

        if not left_vars or not right_vars:
            continue

        has_left = model.NewBoolVar(f"{label}_left_a{apartment.id}")
        has_right = model.NewBoolVar(f"{label}_right_a{apartment.id}")
        mixed = model.NewBoolVar(f"{label}_mixed_a{apartment.id}")

        _link_group_used_var(model, has_left, left_vars)
        _link_group_used_var(model, has_right, right_vars)

        model.Add(mixed <= has_left)
        model.Add(mixed <= has_right)
        model.Add(mixed >= has_left + has_right - 1)
        objective_terms.append(mixed * (-weight * WEIGHT_UNIT))
        created += 1

    return created


def _add_greedy_hint(
    model,
    students,
    assignment_vars,
    student_candidates,
    free_capacity_by_apartment,
    existing_religious_preferences,
    hard_religious_together,
):
    remaining_capacity = dict(free_capacity_by_apartment)
    exclusive_apartments = set()
    apartment_preference = {
        apartment_id: next(iter(preferences))
        for apartment_id, preferences in existing_religious_preferences.items()
        if len(preferences) == 1
    }
    selected = {}

    ordered_students = sorted(
        students,
        key=lambda student: (
            not _get_student_priority(student),
            len(student_candidates.get(student.id, [])),
            _get_student_identifier(student),
            student.id,
        ),
    )

    for student in ordered_students:
        preference = _religious_pref_key(student) if hard_religious_together else ""
        is_exclusive = _student_is_exclusive(student)

        candidates = sorted(
            student_candidates.get(student.id, []),
            key=lambda apartment_id: (
                -remaining_capacity.get(apartment_id, 0),
                apartment_id,
            ),
        )

        for apartment_id in candidates:
            if remaining_capacity.get(apartment_id, 0) <= 0:
                continue
            if apartment_id in exclusive_apartments:
                continue

            current_preference = apartment_preference.get(apartment_id)
            if (
                hard_religious_together
                and preference
                and current_preference
                and current_preference != preference
            ):
                continue

            selected[student.id] = apartment_id

            if is_exclusive:
                remaining_capacity[apartment_id] = 0
                exclusive_apartments.add(apartment_id)
            else:
                remaining_capacity[apartment_id] -= 1

            if hard_religious_together and preference and not current_preference:
                apartment_preference[apartment_id] = preference
            break

    for key, variable in assignment_vars.items():
        student_id, apartment_id = key
        model.AddHint(variable, int(selected.get(student_id) == apartment_id))

    return len(selected)


def _solver_log(message, **data):
    if data:
        details = " ".join(f"{key}={value}" for key, value in data.items())
        print(f">>> SOLVER {message} {details}", flush=True)
    else:
        print(f">>> SOLVER {message}", flush=True)


def _build_assignment_payload(student, bed):
    room = bed.room
    apartment = room.apartment
    return {
        "student_db_id": student.id,
        "student_id": _get_student_identifier(student),
        "student_name": _get_student_full_name(student),
        "apartment_id": apartment.id,
        "apartment_code": _safe_str(apartment.number),
        "room_id": room.id,
        "room_code": _safe_str(room.name),
        "bed_id": bed.id,
        "bed_label": _safe_str(bed.label),
    }


def run_improved_ortools_allocation(
    students,
    rooms,
    constraints_config,
    *,
    allocation_run_id=None,
    max_seconds=None,
    solve_mode="best-effort",
    max_relative_gap=0.0,
    persist_feasible_on_timeout=False,
    log_search_progress=False,
):
    if not ORTOOLS_AVAILABLE:
        raise ImportError("OR-Tools is not installed.")

    if max_seconds is None:
        max_seconds = MAX_SOLVER_TIME_SECONDS

    try:
        max_seconds = float(max_seconds)
    except (TypeError, ValueError) as exc:
        raise ValueError("max_seconds must be a positive number.") from exc

    if max_seconds <= 0:
        raise ValueError("max_seconds must be greater than zero.")

    if solve_mode not in {"best-effort", "optimal-required"}:
        raise ValueError("solve_mode must be 'best-effort' or 'optimal-required'.")

    try:
        max_relative_gap = float(max_relative_gap or 0.0)
    except (TypeError, ValueError) as exc:
        raise ValueError("max_relative_gap must be non-negative.") from exc

    if max_relative_gap < 0:
        raise ValueError("max_relative_gap cannot be negative.")

    if solve_mode == "optimal-required" and max_relative_gap > 0:
        raise ValueError("optimal-required mode requires max_relative_gap=0.0.")

    students = _normalize_students_input(students)
    rooms = _normalize_rooms_input(rooms)

    hard_roommate_positive = _is_constraint_hard(
        constraints_config,
        "roommatePositiveOnly",
    )
    hard_religious_together = _is_constraint_hard(
        constraints_config,
        "ReligiousTogether",
    )
    use_priority_first = bool(
        (constraints_config.get("priorityFirst") or {}).get("enabled")
        or (constraints_config.get("priorityFirst") or {}).get("critical")
    )

    results = {
        "students_processed": len(students),
        "successful_assignments": 0,
        "persisted_assignments": 0,
        "roommate_matches": 0,
        "mutual_roommate_matches": 0,
        "one_sided_roommate_matches": 0,
        "conflicts": len(students),
        "solver_status": None,
        "objective_value": None,
        "best_objective_bound": None,
        "absolute_gap": None,
        "relative_gap": None,
        "optimality_proven": False,
        "solve_mode": solve_mode,
        "time_limit_seconds": max_seconds,
        "wall_time": None,
        "stopped_by_time_limit": False,
        "solution_persisted": False,
        "proposed_assignments": [],
        "assignments": [],
        "warnings": [],
        "students_with_no_feasible_beds": [],
    }

    if not students:
        results["solver_status"] = "NO_STUDENTS"
        results["conflicts"] = 0
        return results

    if not rooms:
        results["solver_status"] = "NO_ROOMS"
        results["warnings"].append("No active rooms were supplied.")
        return results

    inventory = _prepare_inventory(rooms)
    apartments = sorted(
        inventory["apartments_by_id"].values(),
        key=lambda apartment: apartment.id,
    )

    if not apartments:
        results["solver_status"] = "NO_FREE_BEDS"
        results["warnings"].append("No free beds are available.")
        return results

    free_capacity_by_apartment = {
        apartment.id: len(inventory["free_beds_by_apartment"].get(apartment.id, []))
        for apartment in apartments
    }

    student_candidates = _build_candidate_apartments(
        students,
        apartments,
        inventory,
        hard_religious_together,
    )

    for student in students:
        if not student_candidates.get(student.id):
            results["students_with_no_feasible_beds"].append(student.id)

    roommate_pairs, unmatched_roommate_targets = _build_relevant_roommate_pairs(students)
    if unmatched_roommate_targets:
        results["warnings"].append(
            f"Unresolved roommate targets: {unmatched_roommate_targets}"
        )

    model = cp_model.CpModel()

    assignment_vars = {
        (student.id, apartment_id): model.NewBoolVar(
            f"assign_s{student.id}_a{apartment_id}"
        )
        for student in students
        for apartment_id in student_candidates.get(student.id, [])
    }

    assigned_expr_by_student = {}
    for student in students:
        variables = [
            assignment_vars[(student.id, apartment_id)]
            for apartment_id in student_candidates.get(student.id, [])
            if (student.id, apartment_id) in assignment_vars
        ]
        if variables:
            model.Add(sum(variables) <= 1)
            assigned_expr_by_student[student.id] = sum(variables)
        else:
            assigned_expr_by_student[student.id] = 0

    students_by_apartment = defaultdict(list)
    shared_students_by_apartment = defaultdict(list)
    exclusive_students_by_apartment = defaultdict(list)

    students_by_id = {student.id: student for student in students}

    for (student_id, apartment_id), variable in assignment_vars.items():
        students_by_apartment[apartment_id].append(variable)
        if _student_is_exclusive(students_by_id[student_id]):
            exclusive_students_by_apartment[apartment_id].append(variable)
        else:
            shared_students_by_apartment[apartment_id].append(variable)

    for apartment in apartments:
        apartment_id = apartment.id
        capacity = free_capacity_by_apartment.get(apartment_id, 0)
        all_vars = students_by_apartment.get(apartment_id, [])
        exclusive_vars = exclusive_students_by_apartment.get(apartment_id, [])

        if not all_vars:
            continue

        if exclusive_vars:
            model.Add(sum(exclusive_vars) <= 1)
            shared_vars = shared_students_by_apartment.get(apartment_id, [])
            if shared_vars:
                model.Add(sum(shared_vars) + capacity * sum(exclusive_vars) <= capacity)
            else:
                model.Add(sum(exclusive_vars) <= 1)
        else:
            model.Add(sum(all_vars) <= capacity)

    same_apartment_vars = {}
    common_apartments_by_pair = {}

    for student_1, student_2 in roommate_pairs:
        first_id, second_id = sorted((student_1.id, student_2.id))
        common_apartments = sorted(
            set(student_candidates.get(first_id, []))
            & set(student_candidates.get(second_id, []))
        )
        common_apartments_by_pair[(first_id, second_id)] = common_apartments

        for apartment_id in common_apartments:
            variable = model.NewBoolVar(
                f"same_a_s{first_id}_s{second_id}_a{apartment_id}"
            )
            same_apartment_vars[(first_id, second_id, apartment_id)] = variable
            first_assignment = assignment_vars[(first_id, apartment_id)]
            second_assignment = assignment_vars[(second_id, apartment_id)]
            model.Add(variable <= first_assignment)
            model.Add(variable <= second_assignment)
            model.Add(variable >= first_assignment + second_assignment - 1)

    if hard_religious_together:
        _add_hard_religious_together(
            model,
            students,
            apartments,
            assignment_vars,
            student_candidates,
        )

    if hard_roommate_positive:
        for student_1, student_2 in roommate_pairs:
            first_id, second_id = sorted((student_1.id, student_2.id))
            common_apartments = common_apartments_by_pair[(first_id, second_id)]
            same_vars = [
                same_apartment_vars[(first_id, second_id, apartment_id)]
                for apartment_id in common_apartments
            ]

            if _students_have_mutual_positive_roommate_request(student_1, student_2):
                same_expression = sum(same_vars) if same_vars else 0
                model.Add(same_expression == assigned_expr_by_student[first_id])
                model.Add(same_expression == assigned_expr_by_student[second_id])
            elif _students_mutually_requested_each_other(student_1, student_2):
                for apartment_id in common_apartments:
                    model.Add(
                        assignment_vars[(first_id, apartment_id)]
                        + assignment_vars[(second_id, apartment_id)]
                        <= 1
                    )

    hinted_assignments = 0
    if not hard_roommate_positive:
        hinted_assignments = _add_greedy_hint(
            model,
            students,
            assignment_vars,
            student_candidates,
            free_capacity_by_apartment,
            inventory["existing_religious_preferences_by_apartment"],
            hard_religious_together,
        )

    soft_terms = []

    use_roommate_match = bool(
        (constraints_config.get("roommateMatch") or {}).get("enabled")
    )
    use_same_religion = _is_constraint_soft(constraints_config, "sameReligion")
    use_sector_matching = _is_constraint_soft(constraints_config, "sectorMatching")
    use_avoid_year_mix = _is_constraint_soft(
        constraints_config,
        "avoidYearMix_1_with_3_4",
    )
    use_avoid_atudaim_hasmaha = _is_constraint_soft(
        constraints_config,
        "avoidAtudaimWithHasmaha",
    )

    roommate_weight = _constraint_weight(constraints_config, "roommateMatch", 8)
    religion_weight = _constraint_weight(constraints_config, "sameReligion", 6)
    sector_weight = _constraint_weight(constraints_config, "sectorMatching", 7)
    year_weight = _constraint_weight(
        constraints_config,
        "avoidYearMix_1_with_3_4",
        4,
    )
    atudai_hasmaha_weight = _constraint_weight(
        constraints_config,
        "avoidAtudaimWithHasmaha",
        4,
    )

    roommate_positive_upper_bound = 0

    if use_roommate_match and roommate_weight > 0:
        for student_1, student_2 in roommate_pairs:
            first_id, second_id = sorted((student_1.id, student_2.id))

            if _students_have_mutual_positive_roommate_request(student_1, student_2):
                reward = roommate_weight * WEIGHT_UNIT
            elif _students_mutually_requested_each_other(student_1, student_2):
                reward = max(1, roommate_weight // 2) * WEIGHT_UNIT
            elif _students_have_any_positive_roommate_request(student_1, student_2):
                reward = max(1, roommate_weight // 2) * WEIGHT_UNIT
            elif _students_one_sided_roommate_request(student_1, student_2):
                reward = max(1, roommate_weight // 3) * WEIGHT_UNIT
            else:
                reward = 0

            roommate_positive_upper_bound += reward

            for apartment_id in common_apartments_by_pair[(first_id, second_id)]:
                variable = same_apartment_vars.get((first_id, second_id, apartment_id))
                if variable is not None and reward > 0:
                    soft_terms.append(variable * reward)

    religion_group_vars = 0
    if use_same_religion:
        religion_group_vars = _add_soft_group_compaction(
            model,
            soft_terms,
            students,
            apartments,
            assignment_vars,
            student_candidates,
            _religion_key,
            religion_weight,
            "religion",
        )

    sector_group_vars = 0
    if use_sector_matching:
        sector_group_vars = _add_soft_group_compaction(
            model,
            soft_terms,
            students,
            apartments,
            assignment_vars,
            student_candidates,
            _sector_key,
            sector_weight,
            "sector",
        )

    year_mix_vars = 0
    if use_avoid_year_mix:
        year_mix_vars = _add_soft_mix_penalty(
            model,
            soft_terms,
            students,
            apartments,
            assignment_vars,
            lambda student: _get_student_year_group(student) == "year1",
            lambda student: _get_student_year_group(student) == "year3_4",
            year_weight,
            "year",
        )

    atudai_hasmaha_mix_vars = 0
    if use_avoid_atudaim_hasmaha:
        atudai_hasmaha_mix_vars = _add_soft_mix_penalty(
            model,
            soft_terms,
            students,
            apartments,
            assignment_vars,
            _is_atudai,
            _is_hasmaha,
            atudai_hasmaha_weight,
            "atudai_hasmaha",
        )

    soft_range = roommate_positive_upper_bound
    soft_range += religion_group_vars * religion_weight * WEIGHT_UNIT
    soft_range += sector_group_vars * sector_weight * WEIGHT_UNIT
    soft_range += year_mix_vars * year_weight * WEIGHT_UNIT
    soft_range += atudai_hasmaha_mix_vars * atudai_hasmaha_weight * WEIGHT_UNIT

    assignment_score = max(BASE_ASSIGNMENT_SCORE, soft_range + 1)
    priority_score = 0

    if use_priority_first:
        priority_score = len(students) * assignment_score + soft_range + 1

    objective_terms = list(soft_terms)

    for student in students:
        expression = assigned_expr_by_student[student.id]
        if not student_candidates.get(student.id):
            continue
        objective_terms.append(expression * assignment_score)
        if use_priority_first and _get_student_priority(student):
            objective_terms.append(expression * priority_score)

    if objective_terms:
        model.Maximize(sum(objective_terms))
    else:
        model.Maximize(0)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max_seconds
    solver.parameters.num_search_workers = NUM_SEARCH_WORKERS
    solver.parameters.log_search_progress = bool(log_search_progress)
    solver.parameters.cp_model_presolve = True
    solver.parameters.symmetry_level = 2
    solver.parameters.random_seed = 1

    if max_relative_gap > 0:
        solver.parameters.relative_gap_limit = max_relative_gap

    _solver_log(
        "solve_start",
        students=len(students),
        apartments=len(apartments),
        variables=len(assignment_vars),
        roommate_pairs=len(roommate_pairs),
        hinted_assignments=hinted_assignments,
    )

    status = solver.Solve(model)
    wall_time = float(solver.WallTime())

    status_map = {
        cp_model.OPTIMAL: "OPTIMAL",
        cp_model.FEASIBLE: "FEASIBLE",
        cp_model.INFEASIBLE: "INFEASIBLE",
        cp_model.MODEL_INVALID: "MODEL_INVALID",
        cp_model.UNKNOWN: "UNKNOWN",
    }

    try:
        status_name = solver.StatusName(status)
    except Exception:
        status_name = status_map.get(status, str(status))

    results["solver_status"] = status_name
    results["wall_time"] = wall_time
    results["assignment_score"] = assignment_score
    results["priority_score"] = priority_score
    results["greedy_hint_assignments"] = hinted_assignments
    results["stopped_by_time_limit"] = bool(
        status in {cp_model.FEASIBLE, cp_model.UNKNOWN}
        and wall_time >= max_seconds * 0.99
    )

    if status not in {cp_model.OPTIMAL, cp_model.FEASIBLE}:
        if results["students_with_no_feasible_beds"]:
            results["warnings"].append(
                "Students with no feasible beds: "
                f"{results['students_with_no_feasible_beds']}"
            )
        return results

    objective_value = float(solver.ObjectiveValue())
    best_objective_bound = float(solver.BestObjectiveBound())
    absolute_gap = max(0.0, best_objective_bound - objective_value)
    relative_gap = absolute_gap / max(1.0, abs(objective_value))

    results["objective_value"] = objective_value
    results["best_objective_bound"] = best_objective_bound
    results["absolute_gap"] = absolute_gap
    results["relative_gap"] = relative_gap
    results["optimality_proven"] = bool(
        status == cp_model.OPTIMAL and absolute_gap <= 1e-9
    )

    selected_apartment_by_student = {}

    for student in students:
        for apartment_id in student_candidates.get(student.id, []):
            variable = assignment_vars.get((student.id, apartment_id))
            if variable is not None and solver.Value(variable) == 1:
                selected_apartment_by_student[student.id] = apartment_id
                break

    selected_students_by_apartment = defaultdict(list)
    for student_id, apartment_id in selected_apartment_by_student.items():
        selected_students_by_apartment[apartment_id].append(student_id)

    selected_bed_by_student = {}

    for apartment_id, student_ids in selected_students_by_apartment.items():
        ordered_student_ids = sorted(
            student_ids,
            key=lambda student_id: (
                _get_student_identifier(students_by_id[student_id]),
                student_id,
            ),
        )
        available_beds = sorted(
            inventory["free_beds_by_apartment"].get(apartment_id, []),
            key=lambda bed: (
                _safe_str(bed.room.name),
                _safe_str(bed.label),
                bed.id,
            ),
        )

        if len(available_beds) < len(ordered_student_ids):
            raise RuntimeError(
                f"Apartment {apartment_id} has insufficient free beds during persistence."
            )

        for student_id, bed in zip(ordered_student_ids, available_beds):
            selected_bed_by_student[student_id] = bed

    proposed_assignments = [
        _build_assignment_payload(students_by_id[student_id], bed)
        for student_id, bed in sorted(selected_bed_by_student.items())
    ]

    results["proposed_assignments"] = proposed_assignments
    results["assignments"] = proposed_assignments
    results["successful_assignments"] = len(proposed_assignments)
    results["conflicts"] = len(students) - len(proposed_assignments)

    should_persist = solve_mode == "best-effort" or results["optimality_proven"]
    if status == cp_model.FEASIBLE and persist_feasible_on_timeout:
        should_persist = True

    if should_persist and selected_bed_by_student:
        close_old_connections()
        now = timezone.now()
        selected_student_ids = list(selected_bed_by_student)
        selected_bed_ids = [bed.id for bed in selected_bed_by_student.values()]

        with transaction.atomic():
            locked_bed_ids = list(
                Bed.objects.filter(id__in=selected_bed_ids)
                .order_by("pk")
                .select_for_update()
                .values_list("id", flat=True)
            )

            if len(locked_bed_ids) != len(set(selected_bed_ids)):
                raise RuntimeError(
                    "One or more selected beds no longer exist during persistence."
                )

            occupied_selected_beds = set(
                BedAssignment.objects.filter(
                    bed_id__in=selected_bed_ids,
                    status=BedAssignment.Status.ACTIVE,
                ).values_list("bed_id", flat=True)
            )

            if occupied_selected_beds:
                raise RuntimeError(
                    "One or more selected beds became occupied before persistence: "
                    f"{sorted(occupied_selected_beds)}"
                )

            BedAssignment.objects.filter(
                student_id__in=selected_student_ids,
                status=BedAssignment.Status.ACTIVE,
            ).update(
                status=BedAssignment.Status.ENDED,
                ended_at=now,
            )

            assignments_to_create = []
            students_to_update = []

            for student_id, bed in selected_bed_by_student.items():
                student = students_by_id[student_id]
                assignments_to_create.append(
                    BedAssignment(
                        student=student,
                        bed=bed,
                        status=BedAssignment.Status.ACTIVE,
                        assignment_type=BedAssignment.AssignmentType.INITIAL,
                        allocation_run_id=allocation_run_id,
                    )
                )
                student.assigned_room_id = bed.room_id
                if hasattr(student, "updated_at"):
                    student.updated_at = now
                students_to_update.append(student)

            BedAssignment.objects.bulk_create(assignments_to_create, batch_size=500)

            update_fields = ["assigned_room"]
            if hasattr(Student, "updated_at"):
                update_fields.append("updated_at")

            Student.objects.bulk_update(
                students_to_update,
                update_fields,
                batch_size=500,
            )

        results["solution_persisted"] = True
        results["persisted_assignments"] = len(selected_bed_by_student)
    elif should_persist:
        results["solution_persisted"] = True
    else:
        results["warnings"].append(
            "A feasible solution was found but was not persisted because exact optimality was not proven."
        )

    mutual_matches = 0
    one_sided_matches = 0

    for student_1, student_2 in roommate_pairs:
        apartment_1 = selected_apartment_by_student.get(student_1.id)
        apartment_2 = selected_apartment_by_student.get(student_2.id)

        if apartment_1 is None or apartment_1 != apartment_2:
            continue

        if _students_have_mutual_positive_roommate_request(student_1, student_2):
            mutual_matches += 1
        elif (
            _students_mutually_requested_each_other(student_1, student_2)
            or _students_one_sided_roommate_request(student_1, student_2)
        ):
            one_sided_matches += 1

    results["mutual_roommate_matches"] = mutual_matches
    results["one_sided_roommate_matches"] = one_sided_matches
    results["roommate_matches"] = mutual_matches + one_sided_matches

    if results["students_with_no_feasible_beds"]:
        results["warnings"].append(
            "Students with no feasible beds: "
            f"{results['students_with_no_feasible_beds']}"
        )

    _solver_log(
        "solve_end",
        status=status_name,
        assignments=results["successful_assignments"],
        conflicts=results["conflicts"],
        wall_time=wall_time,
    )

    return results
