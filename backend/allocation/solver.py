from collections import defaultdict
from itertools import combinations
from django.db import transaction

from backend.api.models import Student, Room, Bed, BedAssignment

try:
    from ortools.sat.python import cp_model
    ORTOOLS_AVAILABLE = True
except ImportError:
    ORTOOLS_AVAILABLE = False

BASE_ASSIGNMENT_SCORE = 1000
PRIORITY_SCORE = 300
WEIGHT_UNIT = 10
MAX_SOLVER_TIME_SECONDS = 30
NUM_SEARCH_WORKERS = 8


def _is_constraint_hard(config, key):
    """
    Check if a constraint is enforced strictly.

    Used to decide whether the solver must block invalid assignments.
    """
    c = config.get(key, {})
    return bool(c.get("critical")) or (bool(c.get("enabled")) and bool(c.get("strict")))


def _is_constraint_soft(config, key):
    """
    Check if a constraint is a soft preference.

    Used to guide optimization without blocking assignments.
    """
    c = config.get(key, {})
    return bool(c.get("enabled")) and not _is_constraint_hard(config, key)


def _constraint_weight(config, key, default=0):
    """
    Get the weight of a soft constraint.

    Controls how strongly the solver prefers this rule.
    """
    c = config.get(key, {})
    return int(c.get("weight", default) or 0)


def _safe_str(v):
    """
    Safely convert a value to a clean string.

    Prevents issues from None or inconsistent imported values.
    """
    return str(v).strip() if v is not None else ""


def _safe_lower(v):
    """
    Safely convert a value to lowercase string.

    Used for normalized text comparisons.
    """
    return _safe_str(v).lower()


def _parse_bool_yes(v):
    """
    Parse yes-like values into boolean.

    Helps normalize imported textual flags.
    """
    return _safe_lower(v) in {"כן", "yes", "true", "1"}


def _get_student_gender(student):
    """
    Return the student's gender.

    Used in gender-based placement rules.
    """
    return getattr(student, "gender", None)


def _get_student_priority(student):
    """
    Check if the student is priority.

    Used for reserved beds and priority allocation logic.
    """
    return bool(getattr(student, "is_priority", False))


def _get_student_religion(student):
    """
    Return the student's religion value.

    Used for religion-based matching rules.
    """
    return _safe_str(
        getattr(student, "religion", None)
        or getattr(student, "requested_religion", None)
    )


def _get_student_sector(student):
    """
    Return the student's sector value.

    Used for sector-based matching rules.
    """
    return _safe_str(
        getattr(student, "sector", None)
        or getattr(student, "requested_sector", None)
        or getattr(student, "requested_religion_or_sector", None)
    )


def _get_student_religious_pref(student):
    """
    Return the student's religious placement preference.

    Used for ReligiousTogether logic.
    """
    return _safe_str(
        getattr(student, "religious_for_placement", None)
        or getattr(student, "religious_preference", None)
    )


def _get_student_academic_points(student):
    """
    Return student's academic points as float.

    Used to derive year-group rules.
    """
    value = getattr(student, "academic_points_total", None)
    try:
        return float(value) if value is not None else 0.0
    except Exception:
        return 0.0


def _get_student_year_group(student):
    """
    Convert academic points into year group.

    Used for avoidYearMix constraint.
    """
    pts = _get_student_academic_points(student)
    if 0 <= pts <= 40:
        return "year1"
    if pts >= 60:
        return "year3_4"
    return "other"


def _collect_special_status_text(student):
    """
    Merge special status fields into one normalized text.

    Used for Atudai and Hasmaha detection.
    """
    parts = [
        getattr(student, "special_status_1", ""),
        getattr(student, "special_status_2", ""),
        getattr(student, "special_status_3", ""),
        getattr(student, "special_status_4", ""),
    ]
    return " | ".join(_safe_lower(p) for p in parts if _safe_str(p))

    # 2. מיטה אחת → סטודנט אחד
    for b in candidate_beds:
        model.Add(sum(x[(s.id, b.id)] for s in students) <= 1)


def _is_atudai(student):
    """
    Check if student belongs to Atudai category.

    Used for avoidAtudaimWithHasmaha rule.
    """
    return "עתודאי" in _collect_special_status_text(student)


def _is_hasmaha(student):
    """
    Check if student belongs to Hasmaha category.

    Used for avoidAtudaimWithHasmaha rule.
    """
    return "הסמכה" in _collect_special_status_text(student)


def _get_student_roommate_ids(student):
    """
    Return normalized roommate request ids.

    Used for roommate matching logic.
    """
    roommate_ids = getattr(student, "roommate_request_ids", None)
    if roommate_ids is None:
        return []
    if isinstance(roommate_ids, list):
        return roommate_ids
    return []


def _students_mutually_requested_each_other(s1, s2):
    """
    Check if both students requested each other.

    Used for strong roommate pairing.
    """
    s1_requests = set(_get_student_roommate_ids(s1))
    s2_requests = set(_get_student_roommate_ids(s2))
    return s2.id in s1_requests and s1.id in s2_requests


def _students_one_sided_roommate_request(s1, s2):
    """
    Check if only one student requested the other.

    Used for softer roommate preference tracking.
    """
    s1_requests = set(_get_student_roommate_ids(s1))
    s2_requests = set(_get_student_roommate_ids(s2))
    return (s2.id in s1_requests) ^ (s1.id in s2_requests)


def _needs_accessibility(student):
    """
    Check if student needs accessible housing.

    Used to filter invalid apartment choices.
    """
    return bool(getattr(student, "needs_accessibility", False))


def _apartment_is_accessible(apartment):
    """
    Check if apartment is accessible.

    Used for accessibility compatibility.
    """
    return bool(getattr(apartment, "is_accessible", False))


def _apartment_allows_gender(apartment, student):
    """
    Validate gender compatibility with apartment.

    Prevents invalid gender assignments.
    """
    category = _safe_str(getattr(apartment, "category", ""))
    gender = _get_student_gender(student)

    if hasattr(Student, "Gender"):
        female_value = getattr(Student.Gender, "FEMALE", "female")
        male_value = getattr(Student.Gender, "MALE", "male")
    else:
        female_value = "female"
        male_value = "male"

    if category == "בנות" and gender != female_value:
        return False
    if category == "בנים" and gender != male_value:
        return False

    return True


def _room_reserved_ok(room, student):
    """
    Check if student may use a reserved room.

    Blocks non-priority students from reserved apartments.
    """
    apartment = getattr(room, "apartment", None)
    if apartment and bool(getattr(apartment, "is_reserved", False)) and not _get_student_priority(student):
        return False
    return True


def _students_same_requested_religious_pref(s1, s2):
    """
    Check if students share compatible religious preference.

    Used for ReligiousTogether constraint.
    """
    p1 = _get_student_religious_pref(s1)
    p2 = _get_student_religious_pref(s2)

    if not p1 or not p2:
        return True
    if p1 == "לא משנה" or p2 == "לא משנה":
        return True
    return p1 == p2

            # reserved
    if apt.is_reserved and not s.is_priority:
        model.Add(x[(s.id, b.id)] == 0)


def _students_same_religion(s1, s2):
    """
    Check if students share the same religion.

    Used for sameReligion preference.
    """
    r1 = _get_student_religion(s1)
    r2 = _get_student_religion(s2)
    return bool(r1) and bool(r2) and r1 == r2


def _students_same_sector(s1, s2):
    """
    Check if students share the same sector.

    Used for sectorMatching preference.
    """
    sec1 = _get_student_sector(s1)
    sec2 = _get_student_sector(s2)
    return bool(sec1) and bool(sec2) and sec1 == sec2


def _should_avoid_year_mix(s1, s2):
    """
    Check if students create forbidden year mix.

    Used for avoidYearMix rule.
    """
    return {_get_student_year_group(s1), _get_student_year_group(s2)} == {"year1", "year3_4"}


def _should_avoid_atudaim_hasmaha_mix(s1, s2):
    """
    Check if students create forbidden status mix.

    Used for avoidAtudaimWithHasmaha rule.
    """
    return (_is_atudai(s1) and _is_hasmaha(s2)) or (_is_atudai(s2) and _is_hasmaha(s1))


def _ensure_beds_for_room(room):
    """
    Create missing beds for a room if needed.

    Keeps room capacity aligned with actual bed objects.
    """
    existing_beds = list(room.beds.all())
    if existing_beds:
        return

    capacity = int(getattr(room, "capacity", 0) or 0)
    if capacity <= 0:
        return

    Bed.objects.bulk_create(
        [Bed(room=room, label=f"Bed {i + 1}") for i in range(capacity)]
    )


def _assign_student_to_bed(student, bed):
    """
    Create an active bed assignment for a student.

    Used to save final solver results.
    """
    return BedAssignment.objects.create(
        student=student,
        bed=bed,
        status=BedAssignment.Status.ACTIVE,
        assignment_type=getattr(BedAssignment.AssignmentType, "ALLOCATION", "allocation"),
    )


def _can_student_use_bed(student, bed, room, apartment, hard_same_gender):
    """
    Check if a bed is feasible for a student.

    Used to remove invalid bed choices before modeling.
    """
    if hard_same_gender and not _apartment_allows_gender(apartment, student):
        return False
    if not _room_reserved_ok(room, student):
        return False
    if _needs_accessibility(student) and not _apartment_is_accessible(apartment):
        return False
    return True


def _build_feasible_bed_maps(students, candidate_beds, room_by_bed, apartment_by_bed, hard_same_gender):
    """
    Build feasible bed lists per student.

    Used to reduce model size and prevent invalid variables.
    """
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
    """
    Build feasible room/apartment maps per student.

    Used to define linking variables efficiently.
    """
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
    """
    Build feasible same-apartment pair keys only when needed.

    Used to reduce pair-variable explosion.
    """
    pair_apartment_keys = []
    student_pairs = list(combinations(students, 2))

    for s1, s2 in student_pairs:
        common_apartments = set(student_candidate_apartments[s1.id]) & set(student_candidate_apartments[s2.id])
        for apt_id in common_apartments:
            pair_apartment_keys.append((s1.id, s2.id, apt_id))

    return student_pairs, pair_apartment_keys


def _collect_active_bed_ids():
    """
    Return all currently active occupied bed ids.

    Used to filter unavailable beds before solving.
    """
    return set(
        BedAssignment.objects.filter(
            status=BedAssignment.Status.ACTIVE
        ).values_list("bed_id", flat=True)
    )


def _prepare_candidate_beds(rooms):
    """
    Load all available candidate beds from rooms.

    Used as the physical allocation pool.
    """
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
    """
    Check if priority students have enough distinct feasible beds.

    Used before enforcing hard priority assignment.
    """
    distinct_beds = set()
    for s in priority_students:
        distinct_beds.update(student_candidate_beds[s.id])
    return len(distinct_beds) >= len(priority_students)


@transaction.atomic
def run_improved_ortools_allocation(students, rooms, constraints_config):
    """
    Run the dorm allocation solver using apartment-based logic.

    Creates feasible assignments while respecting hard constraints
    and optimizing soft preferences.
    """
    if not ORTOOLS_AVAILABLE:
        raise ImportError("OR-Tools is not installed.")

    students = list(students)
    rooms = list(rooms.select_related("apartment").prefetch_related("beds"))
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
            if _students_mutually_requested_each_other(s1, s2):
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

            if use_roommate_match and _students_mutually_requested_each_other(s1, s2):
                objective_terms.append(z * roommate_match_w * WEIGHT_UNIT)

            if use_roommate_match and _students_one_sided_roommate_request(s1, s2):
                objective_terms.append(z * max(1, roommate_match_w // 2) * WEIGHT_UNIT)

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

    assigned_students = set()

    for s in students:
        for bed_id in student_candidate_beds[s.id]:
            if solver.Value(x[(s.id, bed_id)]) == 1:
                bed = next((b for b in candidate_beds if b.id == bed_id), None)
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
            if _students_mutually_requested_each_other(s1, s2):
                mutual_roommate_matches += 1
            elif _students_one_sided_roommate_request(s1, s2):
                one_sided_roommate_matches += 1

    results["mutual_roommate_matches"] = mutual_roommate_matches
    results["one_sided_roommate_matches"] = one_sided_roommate_matches
    results["conflicts"] = len(students) - len(assigned_students)

    if results["students_with_no_feasible_beds"]:
        results["warnings"].append(
            f"Students with no feasible beds: {results['students_with_no_feasible_beds']}"
        )

    return results