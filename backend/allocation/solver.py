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


# ---------------------------------------------------------------------------
# Hasmaha Village / building-179 exclusive-group policy
#
# Building 179 belongs specifically to כפר הסמכה, whose DormType.code is 15.
# The rule must therefore be identified by BOTH:
#   1. Building.number == 179
#   2. Building.dorm_type.code == 15
#
# DormType.code 15 belongs to עליון עמים and must not activate the building-179
# Anier policy. No region-name fallback is used, because the region is broader
# than the specific dorm type and could incorrectly include other Upper Dorm
# Office dormitories.
# ---------------------------------------------------------------------------
BUILDING_179_NUMBER = 179
HASMAHA_DORM_TYPE_CODE = 15
PRIORITY_BUILDING_CLUSTER_WEIGHT = 3


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


def _has_anier_special_status(student):
    """
    Return True when the student carries the אנייר marker in any imported
    special-status field. The Excel upload normalizes the dedicated Anier
    indication into special_status_1..4, so this is the single source of
    truth for the building-179 policy.
    """
    return "אנייר" in _collect_special_status_text(student)

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


def _is_religious_jewish(student):
    """True when the student is both Jewish and observant at the RELIGIOUS level."""
    return (
        _religion_key(student) == _safe_lower(Student.Religion.Jewish)
        and _religious_pref_key(student) == "religious"
    )


def _student_religious_state(student):
    """
    Returns the religion-restriction state this student imposes on their apartment,
    or None if the student has no restriction (not RELIGIOUS).

      ("rj",)         — Religious Jewish: apartment must contain only Jewish+RELIGIOUS
      ("religion", r) — Religious non-Jewish (religion key r): apartment must contain
                        only students with religion r (any observance level)
      None            — not RELIGIOUS; student imposes no restriction
    """
    if _religious_pref_key(student) != "religious":
        return None
    r = _religion_key(student)
    if r == _safe_lower(Student.Religion.Jewish):
        return ("rj",)
    return ("religion", r) if r else None


def _sector_key(student):
    value = _safe_lower(_get_student_sector(student))
    if value in {"", "unknown", "לא ידוע", "not_specified", "לא צוין"}:
        return ""
    return value


def _student_is_exclusive(student):
    return getattr(student, "housing_type", "") in EXCLUSIVE_HOUSING_TYPES


def _effective_apartment_category(apartment):
    """
    Apartment.category, unless the apartment's BUILDING has a
    gender_restriction set — in which case the building-wide restriction
    is authoritative and overrides a possibly wrong/conflicting individual
    apartment category (shared-facility buildings with shared bathrooms).
    """
    restriction = _get_building_gender_restriction(apartment.building)
    if restriction == _safe_lower(Student.Gender.MALE):
        return Apartment.Category.MALE
    if restriction == _safe_lower(Student.Gender.FEMALE):
        return Apartment.Category.FEMALE
    return getattr(apartment, "category", None)


def _housing_matches_apartment(student, apartment):
    housing_type = getattr(student, "housing_type", "")
    apartment_type = getattr(apartment, "apartment_type", None)
    category = _effective_apartment_category(apartment)

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


def _get_building_gender_restriction(building):
    """
    Building.gender_restriction ('male'/'female'/'') is a BUILDING-level
    hard restriction for shared-facility buildings (shared bathrooms),
    distinct from Apartment.category. Returns None for ordinary buildings
    (blank/unset), in which case existing apartment-category behavior is
    unaffected.
    """
    value = _safe_lower(getattr(building, "gender_restriction", "") or "")
    if value in {_safe_lower(Student.Gender.MALE), _safe_lower(Student.Gender.FEMALE)}:
        return value
    return None


def _may_enter_building_due_to_gender_restriction(student, apartment):
    """
    When a building has a gender_restriction set, EVERY room in it is
    restricted to that gender, regardless of any individual apartment's
    (possibly conflicting/mislabeled) category — this overrides
    _housing_matches_apartment's apartment-level check for that building.
    Ordinary buildings (no restriction) are entirely unaffected.
    """
    restriction = _get_building_gender_restriction(apartment.building)
    if restriction is None:
        return True

    student_gender = _safe_lower(getattr(student, "gender", "") or "")
    if not student_gender:
        return True

    return student_gender == restriction


def _building_gender_conflict_ids(apartments, existing_assignments_by_apartment):
    """
    Building ids where gender_restriction is set AND at least one existing
    ACTIVE occupant's gender conflicts with it. Adding a new student of
    either gender to such a building cannot fix the inconsistency (a
    matching-gender addition still leaves it mixed because of the
    conflicting occupant) — these buildings must be entirely frozen for
    NEW assignments until staff resolve it manually (see
    _gender_restricted_building_existing_occupant_warnings).
    """
    conflict_ids = set()
    for apartment in apartments:
        building_id = apartment.building_id
        if building_id in conflict_ids:
            continue
        restriction = _get_building_gender_restriction(apartment.building)
        if restriction is None:
            continue
        for assignment in existing_assignments_by_apartment.get(apartment.id, []):
            occupant_gender = _safe_lower(getattr(assignment.student, "gender", "") or "")
            if occupant_gender and occupant_gender != restriction:
                conflict_ids.add(building_id)
                break
    return conflict_ids


def _normalized_building_number(building):
    """
    Building.number may arrive as an int (DB default) or a str (data coming
    from imports/tests) — normalize before comparing so '179' == 179.
    """
    value = getattr(building, "number", None)
    if value is None:
        return None
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _is_building_179(building):
    return _normalized_building_number(building) == BUILDING_179_NUMBER


def _get_apartment_dorm_type(apartment):
    building = getattr(apartment, "building", None)
    return getattr(building, "dorm_type", None)


def _is_hasmaha_dorm_type(dorm_type):
    """
    Return True only for כפר הסמכה, whose confirmed DormType.code is 15.
    DormType.code 15 is עליון עמים and must not activate this policy.
    """
    if dorm_type is None:
        return False
    return getattr(dorm_type, "code", None) == HASMAHA_DORM_TYPE_CODE


def _apartment_in_hasmaha(apartment):
    """True only when the apartment belongs to כפר הסמכה (DormType.code == 15)."""
    return _is_hasmaha_dorm_type(_get_apartment_dorm_type(apartment))


def _is_building_179_hasmaha(apartment):
    """
    True only for building 179 inside כפר הסמכה.
    Building number 179 in any other dorm type is treated as an ordinary building.
    """
    building = getattr(apartment, "building", None)
    return _is_building_179(building) and _apartment_in_hasmaha(apartment)


def _is_anier_exclusive_student(student):
    """
    Every student carrying the אנייר special-status marker belongs to the
    building-179 exclusive group.

    Priority and a separate הסמכה marker are deliberately NOT required:
    according to the confirmed business rule, the אנייר marker itself is
    sufficient. This check stays apartment-independent; the apartment-side
    building-179/Upper-Dorm-Office validation is handled separately.
    """
    return _has_anier_special_status(student)


def _is_building_179_exclusive_student(student, apartment):
    """
    True when the student carries the אנייר marker and this apartment is
    in building 179 of כפר הסמכה (DormType.code == 15).
    """
    return _is_anier_exclusive_student(student) and _is_building_179_hasmaha(apartment)


def _may_enter_building_179(student, apartment):
    """
    Building 179 in כפר הסמכה is exclusive to students carrying the אנייר marker:

      • Anier students may be assigned only to building 179 in כפר הסמכה.
      • Non-Anier students may never be assigned to that building.
      • A building numbered 179 in any other DormType is ordinary and is not
        affected by this rule.
    """
    is_reserved_destination = _is_building_179_hasmaha(apartment)
    is_anier_student = _is_anier_exclusive_student(student)

    if is_anier_student:
        return is_reserved_destination
    return not is_reserved_destination


def _should_enforce_accepted_dorm_type(student):
    """
    Ordinary non-priority students must respect the imported
    accepted_dorm_type restriction.

    Priority students keep the existing bypass. Anier students also bypass
    this check because their mandatory destination is enforced separately:
    they may enter only building 179, and no ordinary building.
    """
    return (
        not _get_student_priority(student)
        and not _is_anier_exclusive_student(student)
    )


def _accepted_dorm_matches(student, apartment):
    if not _should_enforce_accepted_dorm_type(student):
        return True
    accepted_dorm_type_id = getattr(student, "accepted_dorm_type_id", None)
    if accepted_dorm_type_id is None:
        return True
    return apartment.building.dorm_type_id == accepted_dorm_type_id


def _building_179_existing_occupant_warnings(apartments, existing_assignments_by_apartment):
    """
    Diagnostic only: existing active assignments are never modified. If
    building 179 (כפר הסמכה) already has an occupant who is not
    part of the exclusive group, surface a clear warning instead of
    silently producing a misleading allocation.
    """
    warnings = []
    for apartment in apartments:
        if not _is_building_179_hasmaha(apartment):
            continue

        for assignment in existing_assignments_by_apartment.get(apartment.id, []):
            occupant = assignment.student
            if not _is_building_179_exclusive_student(occupant, apartment):
                warnings.append(
                    "Building 179 (כפר הסמכה) apartment "
                    f"{_safe_str(apartment.number)} already has an existing "
                    f"occupant (student_id={_get_student_identifier(occupant)}) "
                    "who does not belong to the exclusive group; the existing "
                    "assignment was preserved unchanged."
                )
    return warnings


def _anier_building_179_diagnostics(students, apartments, student_candidates, free_capacity_by_apartment):
    """
    Diagnostic counters for the building-179 / כפר הסמכה Anir
    (אנייר) policy, computed on every solver run so a broken upload
    mapping or a missing/misconfigured reserved building shows up
    immediately instead of silently producing zero Anir assignments:

      imported_anier_students             — students in this run carrying
                                             the אנייר special status.
      eligible_anier_students              — every imported student carrying
                                             the אנייר marker; no separate
                                             priority or הסמכה marker is
                                             required.
      reserved_building_found              — whether an apartment matching
                                             building 179 in the Upper Dorm
                                             Office actually exists in this
                                             run's room inventory.
      reserved_building_available_beds     — free beds in that building.
      eligible_anier_students_sent_to_solver — eligible students who
                                             actually have that building
                                             as a CP-SAT candidate (i.e.
                                             both the upload mapping AND
                                             the building/region match
                                             connected end-to-end).
    """
    imported_anier_students = [
        student for student in students if _has_anier_special_status(student)
    ]
    eligible_anier_students = list(imported_anier_students)

    reserved_building_179_apartment_ids = {
        apartment.id
        for apartment in apartments
        if _is_building_179_hasmaha(apartment)
    }
    reserved_building_available_beds = sum(
        free_capacity_by_apartment.get(apartment_id, 0)
        for apartment_id in reserved_building_179_apartment_ids
    )

    eligible_anier_sent_to_solver = [
        student for student in eligible_anier_students
        if reserved_building_179_apartment_ids & set(student_candidates.get(student.id, []))
    ]

    return {
        "imported_anier_students": len(imported_anier_students),
        "eligible_anier_students": len(eligible_anier_students),
        "reserved_building_found": bool(reserved_building_179_apartment_ids),
        "reserved_building_available_beds": reserved_building_available_beds,
        "eligible_anier_students_sent_to_solver": len(eligible_anier_sent_to_solver),
    }


def _gender_restricted_building_existing_occupant_warnings(apartments, existing_assignments_by_apartment):
    """
    Diagnostic only: existing active assignments are never modified. If a
    building's gender_restriction was set/changed after some students were
    already housed there (e.g. legacy occupants of the now-restricted-out
    gender), surface a clear warning instead of silently producing a
    misleading allocation. The building is frozen for ALL new assignments
    (see _building_gender_conflict_ids) until staff resolve the
    inconsistency manually — adding even a matching-gender student would
    not fix an already-mixed building.
    """
    warnings = []
    for apartment in apartments:
        restriction = _get_building_gender_restriction(apartment.building)
        if restriction is None:
            continue

        for assignment in existing_assignments_by_apartment.get(apartment.id, []):
            occupant = assignment.student
            occupant_gender = _safe_lower(getattr(occupant, "gender", "") or "")
            if occupant_gender and occupant_gender != restriction:
                warnings.append(
                    f"Building {_safe_str(apartment.building.number)} is restricted to "
                    f"{restriction} students, but already has an existing occupant "
                    f"(student_id={_get_student_identifier(occupant)}) of a different "
                    "gender; the existing assignment was preserved unchanged, and this "
                    "building is frozen for new solver assignments until staff resolve "
                    "the inconsistency manually."
                )
    return warnings


def _apartment_is_available_for_student(
    student,
    apartment,
    existing_assignments,
    existing_exclusive,
    hard_religious_together,
    existing_rj=False,
    existing_non_rj=False,
    existing_restricted_religions=frozenset(),
    existing_religion_set=frozenset(),
    frozen_gender_conflict_building_ids=frozenset(),
):
    """
    Return True when the apartment is a feasible candidate for this student.

    When hard_religious_together is True the rule works symmetrically:

    Direction 1 — existing RELIGIOUS occupants restrict the apartment:
      • If a Religious Jewish occupant is present, only Jewish+RELIGIOUS students
        may enter.
      • If a Religious non-Jewish occupant of religion R is present, only students
        with religion R (any observance level) may enter.

    Direction 2 — the new student's own restriction must not conflict with existing
    occupants:
      • A Religious Jewish student blocks entry unless all existing occupants are
        also Religious Jewish (existing_non_rj must be False).
      • A Religious non-Jewish student of religion R blocks entry unless all existing
        occupants also have religion R (existing_religion_set ⊆ {R}).

    An empty apartment is always available to any student.
    """
    building = apartment.building

    if not bool(getattr(building, "is_active", True)):
        return False
    if not bool(getattr(apartment, "is_active", True)):
        return False
    if getattr(apartment, "inactive_reason", "") == Apartment.InactiveReason.RESERVED:
        # Reserved apartments normally require priority status. Building-179
        # Anier students are an explicit exception: the confirmed business
        # rule makes the אנייר marker itself sufficient for entry.
        if not (
            _get_student_priority(student)
            or _is_anier_exclusive_student(student)
        ):
            return False
    if not _may_enter_building_179(student, apartment):
        return False
    if apartment.building_id in frozen_gender_conflict_building_ids:
        # An existing occupant already conflicts with this building's
        # gender_restriction; adding anyone new (either gender) cannot fix
        # that, so the whole building is frozen for new assignments until
        # staff resolve it manually.
        return False
    if not _may_enter_building_due_to_gender_restriction(student, apartment):
        return False
    if not _accepted_dorm_matches(student, apartment):
        return False
    if not _housing_matches_apartment(student, apartment):
        return False

    if _student_is_exclusive(student):
        # Exclusive housing types (Z3 couple / Z4 family / Z6 single-in-
        # apartment) each represent one COMPLETE application, not one
        # household member. An apartment with any existing active
        # assignment is unavailable to every additional exclusive-type
        # applicant, unconditionally — there is no second Student record
        # to ever admit alongside it.
        if existing_assignments:
            return False
    elif existing_exclusive:
        return False

    if hard_religious_together:
        s_state = _student_religious_state(student)
        s_religion = _religion_key(student)

        # Direction 1: existing RELIGIOUS occupants restrict the apartment
        if existing_rj and not _is_religious_jewish(student):
            return False
        for r in existing_restricted_religions:
            if s_religion != r:
                return False

        # Direction 2: this student's restriction must not conflict with existing occupants
        if s_state is not None:
            if s_state[0] == "rj":
                if existing_non_rj:
                    return False
            elif s_state[0] == "religion":
                r = s_state[1]
                if existing_religion_set - {r}:
                    return False

    return True


def _rooms_by_apartment_id(rooms):
    grouped = defaultdict(list)
    for room in rooms:
        grouped[room.apartment_id].append(room)
    return grouped


def _room_capacity(room):
    try:
        return int(getattr(room, "capacity", 0) or 0)
    except (TypeError, ValueError):
        return 0


def _apartment_uses_room_pairing(apartment_id, rooms_by_apartment):
    """
    Shared-facility apartments contain more than one room, with at least
    one room holding more than a single student (e.g. two 2-bed bedrooms
    sharing one apartment/kitchen). For these apartments, hard/soft
    compatibility (religion, roommate requests, sector, academic-year
    preference, special-status preference) must be evaluated for the
    actual pair sharing a specific ROOM, not for the apartment as a whole.

    Apartments with a single room (any capacity) are left on the existing
    apartment-level path — room == apartment there, so behavior does not
    change. Apartments with several single-bed rooms (the existing
    "apartment as shared living/common-space unit, private bedrooms"
    pattern already used throughout the test suite) are also left
    unchanged, since no two students can ever occupy the same room there.
    """
    apartment_rooms = rooms_by_apartment.get(apartment_id, [])
    if len(apartment_rooms) <= 1:
        return False
    return any(_room_capacity(room) > 1 for room in apartment_rooms)


def _build_candidate_rooms(
    students,
    room_pairing_rooms,
    student_apartment_candidates,
    inventory,
    hard_religious_together,
):
    """
    Room-level candidate generation for shared-facility (room-pairing)
    apartments only. Gender/housing/accepted-dorm-type/building-179/
    RESERVED-priority eligibility was already verified at the apartment
    level (student_apartment_candidates); this only adds the room-specific
    free-bed and existing-occupant religion checks, mirroring the same
    two-directional logic used by _apartment_is_available_for_student but
    scoped to the actual room instead of the whole apartment.
    """
    candidates = defaultdict(list)

    for student in students:
        apartment_ids = set(student_apartment_candidates.get(student.id, []))
        if not apartment_ids:
            continue

        s_state = _student_religious_state(student) if hard_religious_together else None
        s_religion = _religion_key(student) if hard_religious_together else ""

        for room in room_pairing_rooms:
            if room.apartment_id not in apartment_ids:
                continue
            if not inventory["free_beds_by_room"].get(room.id):
                continue

            if hard_religious_together:
                if room.id in inventory["existing_rj_rooms"] and not _is_religious_jewish(student):
                    continue

                conflict = False
                for r in inventory["existing_restricted_religion_by_room"].get(room.id, frozenset()):
                    if s_religion != r:
                        conflict = True
                        break
                if conflict:
                    continue

                if s_state is not None:
                    if s_state[0] == "rj" and room.id in inventory["existing_non_rj_rooms"]:
                        continue
                    if s_state[0] == "religion":
                        r = s_state[1]
                        if inventory["existing_religion_set_by_room"].get(room.id, frozenset()) - {r}:
                            continue

            candidates[student.id].append(room.id)

    return candidates


def _ensure_beds_for_room(room):
    """
    Auto-create any Bed rows missing relative to Room.capacity (a data-
    entry gap between the recorded room capacity and the actual Bed rows).

    Callers pass rooms with .prefetch_related("beds") (see
    _normalize_rooms_input), so room.beds.all() may be served from
    Django's prefetch cache. Without invalidating that cache after
    bulk_create, the very same solver run would still see the OLD bed
    count when _prepare_inventory immediately re-reads room.beds.all() —
    silently undoing this auto-repair for the run that needed it.
    """
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

    prefetch_cache = getattr(room, "_prefetched_objects_cache", None)
    if prefetch_cache is not None:
        prefetch_cache.pop("beds", None)


def _normalize_rooms_input(rooms):
    if hasattr(rooms, "select_related"):
        return list(
            rooms.select_related(
                "apartment",
                "apartment__building",
                "apartment__building__dorm_type",
                "apartment__building__dorm_type__region",
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
            "apartment__building__dorm_type__region",
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
    # Per-apartment religion tracking for the ReligiousTogether hard constraint:
    #   existing_rj_apartments        — apt_ids with ≥1 Religious Jewish occupant
    #   existing_non_rj_apartments    — apt_ids with ≥1 non-Religious-Jewish occupant
    #   existing_restricted_religion_by_apartment — religion keys of RELIGIOUS non-Jewish occupants
    #   existing_religion_set_by_apartment        — religion keys of ALL occupants
    existing_rj_apartments = set()
    existing_non_rj_apartments = set()
    existing_restricted_religion_by_apartment = defaultdict(set)
    existing_religion_set_by_apartment = defaultdict(set)

    # Same tracking again, but keyed by room_id — used for the room-pairing
    # (shared-facility, multi-room, 2-per-room) hard-religion check, which
    # must evaluate the actual room-sharing pair, not the whole apartment.
    existing_rj_rooms = set()
    existing_non_rj_rooms = set()
    existing_restricted_religion_by_room = defaultdict(set)
    existing_religion_set_by_room = defaultdict(set)

    for assignment in active_assignments:
        apartment_id = assignment.bed.room.apartment_id
        room_id = assignment.bed.room_id
        existing_assignments_by_apartment[apartment_id].append(assignment)
        if _student_is_exclusive(assignment.student):
            existing_exclusive_by_apartment[apartment_id] = True
        if _is_religious_jewish(assignment.student):
            existing_rj_apartments.add(apartment_id)
            existing_rj_rooms.add(room_id)
        else:
            existing_non_rj_apartments.add(apartment_id)
            existing_non_rj_rooms.add(room_id)
        state = _student_religious_state(assignment.student)
        if state is not None and state[0] == "religion":
            existing_restricted_religion_by_apartment[apartment_id].add(state[1])
            existing_restricted_religion_by_room[room_id].add(state[1])
        r = _religion_key(assignment.student)
        if r:
            existing_religion_set_by_apartment[apartment_id].add(r)
            existing_religion_set_by_room[room_id].add(r)

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
        "existing_rj_apartments": existing_rj_apartments,
        "existing_non_rj_apartments": existing_non_rj_apartments,
        "existing_restricted_religion_by_apartment": existing_restricted_religion_by_apartment,
        "existing_religion_set_by_apartment": existing_religion_set_by_apartment,
        "existing_rj_rooms": existing_rj_rooms,
        "existing_non_rj_rooms": existing_non_rj_rooms,
        "existing_restricted_religion_by_room": existing_restricted_religion_by_room,
        "existing_religion_set_by_room": existing_religion_set_by_room,
        "free_beds_by_apartment": free_beds_by_apartment,
        "free_beds_by_room": free_beds_by_room,
        "apartments_by_id": apartments_by_id,
    }


def _build_candidate_apartments(
    students,
    apartments,
    inventory,
    hard_religious_together,
    room_pairing_apartment_ids=frozenset(),
    frozen_gender_conflict_building_ids=frozenset(),
):
    """
    For apartments using room-pairing (see _apartment_uses_room_pairing),
    the apartment-wide existing-occupant religion check is skipped here —
    it is re-evaluated per ROOM in _build_candidate_rooms instead. Without
    this, a single existing occupant in one room would incorrectly block a
    student from every OTHER, unrelated room in the same apartment.
    """
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
                    hard_religious_together,
                    existing_rj=(
                            apartment_id in inventory["existing_rj_apartments"]
                    ),
                    existing_non_rj=(
                            apartment_id in inventory["existing_non_rj_apartments"]
                    ),
                    existing_restricted_religions=(
                            inventory["existing_restricted_religion_by_apartment"].get(
                                apartment_id,
                                frozenset(),
                            )
                    ),
                    existing_religion_set=(
                            inventory["existing_religion_set_by_apartment"].get(
                                apartment_id,
                                frozenset(),
                            )
                    ),
                    frozen_gender_conflict_building_ids=frozen_gender_conflict_building_ids,
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
    """
    Enforce the ReligiousTogether hard rule for students in this CP-SAT run.

    Two constraint families are added per apartment:

    Constraint A — RJ isolation:
      has_rj is True iff any Religious Jewish student is assigned.
      When has_rj is True, every non-Religious-Jewish variable is forced to 0.

    Constraint B — per-religion isolation (one per non-Jewish religion that has
      at least one RELIGIOUS candidate):
      has_rel_<r> is True iff any RELIGIOUS student of religion r is assigned.
      When has_rel_<r> is True, every student whose religion != r is forced to 0.

    Together these rules ensure:
      • Religious Jewish students share only with other Religious Jewish students.
      • Religious non-Jewish students of religion R share only with students who
        also have religion R (any observance level).
      • Two RELIGIOUS students of different religions cannot share — the constraints
        block each other symmetrically.
      • Unrestricted (non-RELIGIOUS) students of any mix of religions may share
        freely as long as no RELIGIOUS student is present.
    """
    created = 0
    for apartment in apartments:
        apt_id = apartment.id

        rj_vars = []
        non_rj_vars = []
        religious_non_jewish_by_religion = defaultdict(list)
        all_vars_by_religion = defaultdict(list)

        for student in students:
            if apt_id not in student_candidates.get(student.id, []):
                continue
            variable = assignment_vars.get((student.id, apt_id))
            if variable is None:
                continue

            state = _student_religious_state(student)
            r = _religion_key(student)

            if _is_religious_jewish(student):
                rj_vars.append(variable)
            else:
                non_rj_vars.append(variable)

            if state is not None and state[0] == "religion":
                religious_non_jewish_by_religion[state[1]].append(variable)

            all_vars_by_religion[r].append(variable)

        # Constraint A: RJ isolation
        if rj_vars and non_rj_vars:
            has_rj = model.NewBoolVar(f"has_rj_a{apt_id}")
            _link_group_used_var(model, has_rj, rj_vars)
            for v in non_rj_vars:
                model.Add(has_rj + v <= 1)
            created += 1

        # Constraint B: per-religion isolation for Religious non-Jewish students
        for rel_r, rel_vars in religious_non_jewish_by_religion.items():
            other_vars = [
                v
                for other_r, var_list in all_vars_by_religion.items()
                if other_r != rel_r
                for v in var_list
            ]
            if rel_vars and other_vars:
                has_rel_r = model.NewBoolVar(f"has_rel_{rel_r}_a{apt_id}")
                _link_group_used_var(model, has_rel_r, rel_vars)
                for v in other_vars:
                    model.Add(has_rel_r + v <= 1)
                created += 1

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


def _add_priority_building_clustering(
    model,
    objective_terms,
    students,
    apartments,
    assignment_vars,
    student_candidates,
    weight,
):
    """
    Soft rule: prefer clustering non-exclusive priority students (priority
    students who are NOT part of the building-179 exclusive group) into as
    few distinct buildings as reasonably possible. Grouping is decided by
    building_id, not dorm type or apartment id.

    One boolean "building used by this group" variable is created per
    building actually reachable by an eligible student — O(number of
    buildings) extra variables — instead of comparing every pair of
    students against every building (which would be an uncontrolled
    O(students^2 x buildings) formulation).

    This must never affect feasibility: it is only ever added as a soft
    objective term, dominated by the base assignment score and, when
    priorityFirst is enabled, by the priority assignment score (see
    run_improved_ortools_allocation).
    """
    if weight <= 0:
        return 0

    apartment_by_id = {apartment.id: apartment for apartment in apartments}
    building_vars = defaultdict(list)

    for student in students:
        if not _get_student_priority(student):
            continue
        for apartment_id in student_candidates.get(student.id, []):
            apartment = apartment_by_id.get(apartment_id)
            if apartment is None:
                continue

            if _is_building_179_exclusive_student(student, apartment):
                # Exclusive-group students are governed entirely by the
                # building-179 hard rule; they never participate in the
                # "spread across as few buildings as possible" preference.
                continue

            variable = assignment_vars.get((student.id, apartment_id))
            if variable is not None:
                building_vars[apartment.building_id].append(variable)

    created = 0
    for building_id, member_vars in building_vars.items():
        used_var = model.NewBoolVar(f"priority_building_used_b{building_id}")
        _link_group_used_var(model, used_var, member_vars)
        objective_terms.append(used_var * (-weight * WEIGHT_UNIT))
        created += 1

    return created


def _add_greedy_hint(
    model,
    students,
    assignment_vars,
    student_candidates,
    free_capacity_by_apartment,
    existing_rj_apartments,
    existing_non_rj_apartments,
    existing_restricted_religion_by_apartment,
    existing_religion_set_by_apartment,
    hard_religious_together,
):
    """
    Provide a warm-start hint to CP-SAT using a greedy assignment pass.

    When hard_religious_together is True the hint replicates the same two-directional
    compatibility check used by the real constraint and candidate filtering, tracking
    per apartment:
      apt_rj_set               — apt_ids that have ≥1 Religious Jewish occupant
      apt_non_rj_set           — apt_ids that have ≥1 non-RJ occupant
      apt_restricted_religions — religion keys of RELIGIOUS non-Jewish occupants
      apt_religion_set         — all religion keys of occupants placed so far
    """
    remaining_capacity = dict(free_capacity_by_apartment)
    exclusive_apartments = set()

    apt_rj_set = set(existing_rj_apartments)
    apt_non_rj_set = set(existing_non_rj_apartments)
    apt_restricted_religions = defaultdict(set)
    for apt_id, rel_set in existing_restricted_religion_by_apartment.items():
        apt_restricted_religions[apt_id] = set(rel_set)
    apt_religion_set = defaultdict(set)
    for apt_id, rel_set in existing_religion_set_by_apartment.items():
        apt_religion_set[apt_id] = set(rel_set)

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

            if hard_religious_together:
                s_state = _student_religious_state(student)
                s_religion = _religion_key(student)

                # Direction 1: existing restriction blocks student
                if apartment_id in apt_rj_set and not _is_religious_jewish(student):
                    continue
                conflict = False
                for r in apt_restricted_religions.get(apartment_id, set()):
                    if s_religion != r:
                        conflict = True
                        break
                if conflict:
                    continue

                # Direction 2: student's restriction blocks existing occupants
                if s_state is not None:
                    if s_state[0] == "rj" and apartment_id in apt_non_rj_set:
                        continue
                    if s_state[0] == "religion":
                        r = s_state[1]
                        if apt_religion_set.get(apartment_id, set()) - {r}:
                            continue

            selected[student.id] = apartment_id

            if is_exclusive:
                remaining_capacity[apartment_id] = 0
                exclusive_apartments.add(apartment_id)
            else:
                remaining_capacity[apartment_id] -= 1

            if hard_religious_together:
                s_state = _student_religious_state(student)
                s_religion = _religion_key(student)
                if _is_religious_jewish(student):
                    apt_rj_set.add(apartment_id)
                else:
                    apt_non_rj_set.add(apartment_id)
                if s_state is not None and s_state[0] == "religion":
                    apt_restricted_religions[apartment_id].add(s_state[1])
                if s_religion:
                    apt_religion_set[apartment_id].add(s_religion)

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
        "anier_building_179_diagnostics": {
            "imported_anier_students": 0,
            "eligible_anier_students": 0,
            "reserved_building_found": False,
            "reserved_building_available_beds": 0,
            "eligible_anier_students_sent_to_solver": 0,
        },
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

    all_apartments_by_id = {room.apartment_id: room.apartment for room in rooms}
    results["warnings"].extend(
        _building_179_existing_occupant_warnings(
            all_apartments_by_id.values(),
            inventory["existing_assignments_by_apartment"],
        )
    )
    results["warnings"].extend(
        _gender_restricted_building_existing_occupant_warnings(
            all_apartments_by_id.values(),
            inventory["existing_assignments_by_apartment"],
        )
    )
    frozen_gender_conflict_building_ids = _building_gender_conflict_ids(
        all_apartments_by_id.values(),
        inventory["existing_assignments_by_apartment"],
    )

    if not apartments:
        results["solver_status"] = "NO_FREE_BEDS"
        results["warnings"].append("No free beds are available.")
        return results

    free_capacity_by_apartment = {
        apartment.id: len(inventory["free_beds_by_apartment"].get(apartment.id, []))
        for apartment in apartments
    }

    # Shared-facility (room-pairing) apartments: apartments with more than
    # one room where at least one room holds more than a single student.
    # Hard/soft compatibility for these apartments is evaluated per ROOM
    # further below; ordinary apartments are completely unaffected.
    rooms_by_apartment_id_map = _rooms_by_apartment_id(rooms)
    room_pairing_apartment_ids = {
        apartment.id
        for apartment in apartments
        if _apartment_uses_room_pairing(apartment.id, rooms_by_apartment_id_map)
    }
    ordinary_apartments = [
        apartment for apartment in apartments
        if apartment.id not in room_pairing_apartment_ids
    ]

    student_candidates = _build_candidate_apartments(
        students,
        apartments,
        inventory,
        hard_religious_together,
        room_pairing_apartment_ids=room_pairing_apartment_ids,
        frozen_gender_conflict_building_ids=frozen_gender_conflict_building_ids,
    )

    for student in students:
        if not student_candidates.get(student.id):
            results["students_with_no_feasible_beds"].append(student.id)

    results["anier_building_179_diagnostics"] = _anier_building_179_diagnostics(
        students, apartments, student_candidates, free_capacity_by_apartment,
    )
    _solver_log(
        "anier_building_179_diagnostics",
        **results["anier_building_179_diagnostics"],
    )

    roommate_pairs, unmatched_roommate_targets = _build_relevant_roommate_pairs(students)
    if unmatched_roommate_targets:
        results["warnings"].append(
            f"Unresolved roommate targets: {unmatched_roommate_targets}"
        )

    # Z3/Z4/Z6 Student records each represent one COMPLETE, independent
    # application (couple/family/single-in-apartment), never one member of
    # a shared household. A roommate request referencing another exclusive-
    # type student therefore has no meaning and must never combine two such
    # records, or feed the general same-apartment/roommate-match machinery
    # below — otherwise a stray mutual request between two unrelated
    # exclusive applicants could incorrectly cap them at one combined
    # assignment (since they can never legally share an apartment).
    roommate_pairs = [
        (student_1, student_2)
        for student_1, student_2 in roommate_pairs
        if not (_student_is_exclusive(student_1) or _student_is_exclusive(student_2))
    ]

    model = cp_model.CpModel()

    assignment_vars = {
        (student.id, apartment_id): model.NewBoolVar(
            f"assign_s{student.id}_a{apartment_id}"
        )
        for student in students
        for apartment_id in student_candidates.get(student.id, [])
    }

    # Room-level layer for shared-facility (room-pairing) apartments only.
    # Ordinary apartments (single room, or several 1-bed rooms) are
    # entirely unaffected — no room_assignment_vars are created for them,
    # and their students/apartments keep using the apartment-level path
    # above exactly as before.
    room_pairing_rooms = [
        room for room in rooms
        if room.apartment_id in room_pairing_apartment_ids
        and inventory["free_beds_by_room"].get(room.id)
    ]
    student_room_candidates = _build_candidate_rooms(
        students,
        room_pairing_rooms,
        student_candidates,
        inventory,
        hard_religious_together,
    )
    room_assignment_vars = {
        (student.id, room_id): model.NewBoolVar(
            f"assign_s{student.id}_r{room_id}"
        )
        for student in students
        for room_id in student_room_candidates.get(student.id, [])
    }

    # Link: a student present in a room-pairing apartment must occupy
    # exactly one of its candidate rooms; absent from the apartment means
    # absent from all of its rooms.
    for student in students:
        for apartment_id in student_candidates.get(student.id, []):
            if apartment_id not in room_pairing_apartment_ids:
                continue
            apartment_room_ids = [
                room.id for room in rooms_by_apartment_id_map.get(apartment_id, [])
            ]
            member_room_vars = [
                room_assignment_vars[(student.id, room_id)]
                for room_id in apartment_room_ids
                if (student.id, room_id) in room_assignment_vars
            ]
            model.Add(
                assignment_vars[(student.id, apartment_id)]
                == (sum(member_room_vars) if member_room_vars else 0)
            )

    students_by_room = defaultdict(list)
    for (student_id, room_id), variable in room_assignment_vars.items():
        students_by_room[room_id].append(variable)

    for room in room_pairing_rooms:
        capacity = len(inventory["free_beds_by_room"].get(room.id, []))
        room_vars_list = students_by_room.get(room.id, [])
        if room_vars_list:
            model.Add(sum(room_vars_list) <= capacity)

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
            # Exclusive housing types (Z3 couple / Z4 family / Z6 single-
            # in-apartment) each represent one COMPLETE application, not
            # one household member — a matching Student row is never split
            # across, or shared with, another Student row. At most one
            # exclusive-type Student record may ever be assigned to this
            # apartment, regardless of remaining physical bed capacity
            # (unused beds represent the applicant's spouse/family, who
            # are not tracked as separate records in this system).
            model.Add(sum(exclusive_vars) <= 1)

            shared_vars = shared_students_by_apartment.get(apartment_id, [])
            if shared_vars:
                model.Add(
                    sum(shared_vars) + capacity * sum(exclusive_vars) <= capacity
                )
        else:
            model.Add(sum(all_vars) <= capacity)

    same_apartment_vars = {}
    common_apartments_by_pair = {}
    same_room_vars = {}
    common_rooms_by_pair = {}

    for student_1, student_2 in roommate_pairs:
        first_id, second_id = sorted((student_1.id, student_2.id))

        # Room-pairing apartments are excluded here — "living together" for
        # those is decided at the room level below, not the apartment level.
        common_apartments = sorted(
            (
                set(student_candidates.get(first_id, []))
                & set(student_candidates.get(second_id, []))
            )
            - room_pairing_apartment_ids
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

        common_rooms = sorted(
            set(student_room_candidates.get(first_id, []))
            & set(student_room_candidates.get(second_id, []))
        )
        common_rooms_by_pair[(first_id, second_id)] = common_rooms

        for room_id in common_rooms:
            variable = model.NewBoolVar(
                f"same_r_s{first_id}_s{second_id}_r{room_id}"
            )
            same_room_vars[(first_id, second_id, room_id)] = variable
            first_room_assignment = room_assignment_vars[(first_id, room_id)]
            second_room_assignment = room_assignment_vars[(second_id, room_id)]
            model.Add(variable <= first_room_assignment)
            model.Add(variable <= second_room_assignment)
            model.Add(variable >= first_room_assignment + second_room_assignment - 1)

    if hard_religious_together:
        _add_hard_religious_together(
            model,
            students,
            apartments,
            assignment_vars,
            student_candidates,
        )
        if room_pairing_rooms:
            _add_hard_religious_together(
                model,
                students,
                room_pairing_rooms,
                room_assignment_vars,
                student_room_candidates,
            )

    if hard_roommate_positive:
        for student_1, student_2 in roommate_pairs:
            first_id, second_id = sorted((student_1.id, student_2.id))
            common_apartments = common_apartments_by_pair[(first_id, second_id)]
            common_rooms = common_rooms_by_pair[(first_id, second_id)]
            same_vars = [
                same_apartment_vars[(first_id, second_id, apartment_id)]
                for apartment_id in common_apartments
            ] + [
                same_room_vars[(first_id, second_id, room_id)]
                for room_id in common_rooms
            ]

            if _students_have_mutual_positive_roommate_request(student_1, student_2):
                same_expression = sum(same_vars) if same_vars else 0

                # If both students are assigned, they must share an
                # apartment (ordinary) or a specific room (room-pairing).
                # Either student may still be assigned alone when another
                # hard constraint makes the requested pairing impossible.
                model.Add(
                    assigned_expr_by_student[first_id]
                    + assigned_expr_by_student[second_id]
                    <= 1 + same_expression
                )
            elif _students_mutually_requested_each_other(student_1, student_2):
                for apartment_id in common_apartments:
                    model.Add(
                        assignment_vars[(first_id, apartment_id)]
                        + assignment_vars[(second_id, apartment_id)]
                        <= 1
                    )
                for room_id in common_rooms:
                    model.Add(
                        room_assignment_vars[(first_id, room_id)]
                        + room_assignment_vars[(second_id, room_id)]
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
            inventory["existing_rj_apartments"],
            inventory["existing_non_rj_apartments"],
            inventory["existing_restricted_religion_by_apartment"],
            inventory["existing_religion_set_by_apartment"],
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

            for room_id in common_rooms_by_pair[(first_id, second_id)]:
                variable = same_room_vars.get((first_id, second_id, room_id))
                if variable is not None and reward > 0:
                    soft_terms.append(variable * reward)

    religion_group_vars = 0
    if use_same_religion:
        religion_group_vars = _add_soft_group_compaction(
            model,
            soft_terms,
            students,
            ordinary_apartments,
            assignment_vars,
            student_candidates,
            _religion_key,
            religion_weight,
            "religion",
        )
        if room_pairing_rooms:
            religion_group_vars += _add_soft_group_compaction(
                model,
                soft_terms,
                students,
                room_pairing_rooms,
                room_assignment_vars,
                student_room_candidates,
                _religion_key,
                religion_weight,
                "religion_room",
            )

    sector_group_vars = 0
    if use_sector_matching:
        sector_group_vars = _add_soft_group_compaction(
            model,
            soft_terms,
            students,
            ordinary_apartments,
            assignment_vars,
            student_candidates,
            _sector_key,
            sector_weight,
            "sector",
        )
        if room_pairing_rooms:
            sector_group_vars += _add_soft_group_compaction(
                model,
                soft_terms,
                students,
                room_pairing_rooms,
                room_assignment_vars,
                student_room_candidates,
                _sector_key,
                sector_weight,
                "sector_room",
            )

    year_mix_vars = 0
    if use_avoid_year_mix:
        year_mix_vars = _add_soft_mix_penalty(
            model,
            soft_terms,
            students,
            ordinary_apartments,
            assignment_vars,
            lambda student: _get_student_year_group(student) == "year1",
            lambda student: _get_student_year_group(student) == "year3_4",
            year_weight,
            "year",
        )
        if room_pairing_rooms:
            year_mix_vars += _add_soft_mix_penalty(
                model,
                soft_terms,
                students,
                room_pairing_rooms,
                room_assignment_vars,
                lambda student: _get_student_year_group(student) == "year1",
                lambda student: _get_student_year_group(student) == "year3_4",
                year_weight,
                "year_room",
            )

    atudai_hasmaha_mix_vars = 0
    if use_avoid_atudaim_hasmaha:
        atudai_hasmaha_mix_vars = _add_soft_mix_penalty(
            model,
            soft_terms,
            students,
            ordinary_apartments,
            assignment_vars,
            _is_atudai,
            _is_hasmaha,
            atudai_hasmaha_weight,
            "atudai_hasmaha",
        )
        if room_pairing_rooms:
            atudai_hasmaha_mix_vars += _add_soft_mix_penalty(
                model,
                soft_terms,
                students,
                room_pairing_rooms,
                room_assignment_vars,
                _is_atudai,
                _is_hasmaha,
                atudai_hasmaha_weight,
                "atudai_hasmaha_room",
            )

    priority_cluster_vars = 0
    if use_priority_first:
        priority_cluster_vars = _add_priority_building_clustering(
            model,
            soft_terms,
            students,
            apartments,
            assignment_vars,
            student_candidates,
            PRIORITY_BUILDING_CLUSTER_WEIGHT,
        )

    soft_range = roommate_positive_upper_bound
    soft_range += religion_group_vars * religion_weight * WEIGHT_UNIT
    soft_range += sector_group_vars * sector_weight * WEIGHT_UNIT
    soft_range += year_mix_vars * year_weight * WEIGHT_UNIT
    soft_range += atudai_hasmaha_mix_vars * atudai_hasmaha_weight * WEIGHT_UNIT
    soft_range += priority_cluster_vars * PRIORITY_BUILDING_CLUSTER_WEIGHT * WEIGHT_UNIT

    # Objective hierarchy safety: assignment_score strictly dominates the
    # entire soft_range (roommate/religion/sector/year/atudai-hasmaha/
    # priority-clustering combined), and priority_score in turn dominates
    # len(students) assignment_score terms plus soft_range. Total
    # assignment count and priority assignment count therefore always
    # outweigh the building-clustering preference.
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
        room_pairing_apartments=len(room_pairing_apartment_ids),
        room_variables=len(room_assignment_vars),
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

    # For room-pairing apartments, the CP-SAT model itself already decided
    # the exact room (that is the whole point of the room-level layer);
    # read it back instead of re-deriving it from an arbitrary sort.
    selected_room_by_student = {}
    for student in students:
        apartment_id = selected_apartment_by_student.get(student.id)
        if apartment_id is None or apartment_id not in room_pairing_apartment_ids:
            continue
        for room_id in student_room_candidates.get(student.id, []):
            variable = room_assignment_vars.get((student.id, room_id))
            if variable is not None and solver.Value(variable) == 1:
                selected_room_by_student[student.id] = room_id
                break

    selected_students_by_apartment = defaultdict(list)
    for student_id, apartment_id in selected_apartment_by_student.items():
        selected_students_by_apartment[apartment_id].append(student_id)

    selected_bed_by_student = {}

    for apartment_id, student_ids in selected_students_by_apartment.items():
        if apartment_id in room_pairing_apartment_ids:
            students_by_selected_room = defaultdict(list)
            for student_id in student_ids:
                room_id = selected_room_by_student.get(student_id)
                students_by_selected_room[room_id].append(student_id)

            for room_id, room_student_ids in students_by_selected_room.items():
                ordered_room_student_ids = sorted(
                    room_student_ids,
                    key=lambda student_id: (
                        _get_student_identifier(students_by_id[student_id]),
                        student_id,
                    ),
                )
                available_room_beds = sorted(
                    inventory["free_beds_by_room"].get(room_id, []),
                    key=lambda bed: (_safe_str(bed.label), bed.id),
                )

                if len(available_room_beds) < len(ordered_room_student_ids):
                    raise RuntimeError(
                        f"Room {room_id} has insufficient free beds during persistence."
                    )

                for student_id, bed in zip(ordered_room_student_ids, available_room_beds):
                    selected_bed_by_student[student_id] = bed
            continue

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