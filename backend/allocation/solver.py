from collections import defaultdict
from itertools import combinations
import os
import re
import threading
import unicodedata

from django.db import close_old_connections, transaction
from django.utils import timezone

from api.models import AllocationRun, Apartment, Bed, BedAssignment, Room, Student
from allocation import live_registry

try:
    from ortools.sat.python import cp_model
    ORTOOLS_AVAILABLE = True
except ImportError:
    ORTOOLS_AVAILABLE = False


BASE_ASSIGNMENT_SCORE = 1000
WEIGHT_UNIT = 10
# Existing behavior, unchanged: what the solver uses when the caller does
# not specify max_seconds at all (e.g. the sync legacy endpoint / most
# tests). This is a DEFAULT, not an upper bound - a user-selected "max
# search time" can be smaller or much larger, see the MIN/MAX bounds below.
DEFAULT_SOLVER_TIME_SECONDS = 500


try:
    NUM_SEARCH_WORKERS = int(os.getenv("ALLOCATION_NUM_SEARCH_WORKERS", "2"))
except (TypeError, ValueError):
    NUM_SEARCH_WORKERS = 2
if NUM_SEARCH_WORKERS < 1:
    NUM_SEARCH_WORKERS = 2

# Reasonable bounds for a user-selected "max search time" (זמן חיפוש
# מרבי). These are the backend-side belt-and-suspenders check:
# start_allocation_run (views.py) validates the same bounds before ever
# creating an AllocationRun or spawning the background thread, but
# run_improved_ortools_allocation re-validates independently so a
# malformed/bypassed request can never reach CpSolver with an
# unreasonable duration. 1 second minimum (an operator may deliberately
# want a very fast/best-effort run), 10 hours (36000s) maximum.
MIN_USER_SOLVER_TIME_SECONDS = 1
MAX_USER_SOLVER_TIME_SECONDS = 36000

# Throttling for the live solution callback (_LiveSolutionCallback). These
# bound how often it does any work at all, since CP-SAT can invoke
# on_solution_callback very frequently early in a search - see the class
# docstring for the full rationale. The very first snapshot is always
# captured immediately regardless of these intervals (see
# _has_memory_snapshot / _has_db_snapshot).
_LIVE_STOP_FLAG_POLL_INTERVAL_SECONDS = 1.5
_LIVE_MEMORY_SNAPSHOT_INTERVAL_SECONDS = 2.0
_LIVE_DB_SNAPSHOT_INTERVAL_SECONDS = 8.0

# Poll interval for _run_stop_watcher - the independent, always-running
# thread that detects Cancel/Stop & Save requests regardless of whether
# CP-SAT is currently finding new solutions (see its docstring).
_STOP_WATCHER_POLL_INTERVAL_SECONDS = 1.0

# Reasonable bounds for a user-selected "max search time" (זמן חיפוש
# מרבי). These are the backend-side belt-and-suspenders check:
# start_allocation_run (views.py) validates the same bounds before ever
# creating an AllocationRun or spawning the background thread, but
# run_improved_ortools_allocation re-validates independently so a
# malformed/bypassed request can never reach CpSolver with an
# unreasonable duration. 1 second minimum (an operator may deliberately
# want a very fast/best-effort run), 10 hours (36000s) maximum.
MIN_USER_SOLVER_TIME_SECONDS = 1
MAX_USER_SOLVER_TIME_SECONDS = 36000

# Throttling for the live solution callback (_LiveSolutionCallback). These
# bound how often it does any work at all, since CP-SAT can invoke
# on_solution_callback very frequently early in a search - see the class
# docstring for the full rationale. The very first snapshot is always
# captured immediately regardless of these intervals (see
# _has_memory_snapshot / _has_db_snapshot).
_LIVE_STOP_FLAG_POLL_INTERVAL_SECONDS = 1.5
_LIVE_MEMORY_SNAPSHOT_INTERVAL_SECONDS = 2.0
_LIVE_DB_SNAPSHOT_INTERVAL_SECONDS = 8.0

# Poll interval for _run_stop_watcher - the independent, always-running
# thread that detects Cancel/Stop & Save requests regardless of whether
# CP-SAT is currently finding new solutions (see its docstring).
_STOP_WATCHER_POLL_INTERVAL_SECONDS = 1.0



EXCLUSIVE_HOUSING_TYPES = {
    Student.HousingType.COUPLE,
    Student.HousingType.FAMILY,
    Student.HousingType.SINGLE_IN_APARTMENT,
}



BUILDING_179_NUMBER = 179
HASMAHA_DORM_TYPE_CODE = 15
PRIORITY_BUILDING_CLUSTER_WEIGHT = 3
BUILDING_179_PREFERENCE_WEIGHT = 5

# Shared shape for the Building-179 diagnostics dict, importable so callers
# (e.g. api/views.py's early-return responses that never reach the solver)
# can present a consistent, zeroed-out structure instead of duplicating
# these keys by hand.
EMPTY_ANIER_BUILDING_179_DIAGNOSTICS = {
    "imported_anier_students": 0,
    "eligible_hasmaha_anier_students": 0,
    "reserved_building_found": False,
    "reserved_building_available_beds": 0,
    "eligible_anier_students_sent_to_solver": 0,
    "assigned_to_building_179": 0,
    "assigned_via_overflow_in_dorm_type": 0,
    "unassigned_eligible_hasmaha_anier": 0,
    # Defensive counter: must always be 0. An eligible Hasmaha ANIR
    # student assigned to an apartment outside DormType 15 entirely is
    # never valid overflow — see the post-solve diagnostics comment in
    # run_improved_ortools_allocation for why this is tracked separately
    # instead of being folded into assigned_via_overflow_in_dorm_type.
    "assigned_outside_hasmaha_dorm_type": 0,
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
    """Return True only for כפר הסמכה, whose confirmed DormType.code is 15."""
    if dorm_type is None:
        return False
    return getattr(dorm_type, "code", None) == HASMAHA_DORM_TYPE_CODE


def _apartment_in_hasmaha(apartment):
    """True only when the apartment belongs to כפר הסמכה (DormType.code == 15)."""
    return _is_hasmaha_dorm_type(_get_apartment_dorm_type(apartment))


def _is_reserved_building_179_apartment(apartment):
    """
    True only for Building 179 inside כפר הסמכה (DormType.code == 15).
    A building numbered 179 in any other DormType is an ordinary building
    and is not affected by this policy.
    """
    building = getattr(apartment, "building", None)
    return _is_building_179(building) and _apartment_in_hasmaha(apartment)


def _student_accepted_dorm_type_code(student):
    """
    The student's own accepted_dorm_type.code. DormType.code is a domain/
    map code (e.g. 15 == כפר הסמכה), not the Django primary key — never
    compare accepted_dorm_type_id against it.
    """
    dorm_type = getattr(student, "accepted_dorm_type", None)
    if dorm_type is None:
        return None
    return getattr(dorm_type, "code", None)


def _is_hasmaha_accepted_student(student):
    """True when the student's own accepted_dorm_type is כפר הסמכה (code 15)."""
    return _student_accepted_dorm_type_code(student) == HASMAHA_DORM_TYPE_CODE


def _is_hasmaha_anier_student(student):
    """
    The population eligible for the Building-179 automatic-allocation
    preference: carries the אנייר marker AND is accepted into כפר הסמכה
    (accepted_dorm_type.code == 15). Both conditions are required —
    confirmed business rule B1: the אנייר marker alone is not sufficient.

    Deliberately does NOT consult: region, allocation_group free text, a
    Django primary key, accessibility status, the separate הסמכה special-
    status marker, or generic is_priority.
    """
    return _has_anier_special_status(student) and _is_hasmaha_accepted_student(student)


def _may_use_building_179_automatically(student, apartment):
    """
    Hard automatic-allocation gate for Building 179 — asymmetric, not
    mutually exclusive:

      • A student who is NOT an eligible Hasmaha ANIR student (ordinary
        students, generic-priority students, and ANIR students accepted
        into a different dorm type) may never automatically consume
        Building-179 inventory.
      • An eligible Hasmaha ANIR student MAY use Building 179, but this
        function does not restrict them to it — their preference for 179
        over the rest of DormType 15 is a soft objective reward (see
        _add_building_179_preference), not a hard requirement, so overflow
        to 176/177/178 (or any future DormType-15 building) via ordinary
        accepted-dorm-type matching remains possible.
      • A building numbered 179 in any other DormType is ordinary and
        unaffected by this rule.

    This gate applies to AUTOMATIC allocation only. Manual assignment,
    transfer, and swap endpoints intentionally never call this function —
    authorized staff may override this rule by hand.
    """
    if not _is_reserved_building_179_apartment(apartment):
        return True
    return _is_hasmaha_anier_student(student)


def _should_enforce_accepted_dorm_type(student):
    """
    Ordinary non-priority students must respect the imported
    accepted_dorm_type restriction. Generic priority students (who do NOT
    carry the אנייר marker) keep the pre-existing bypass — that behavior
    predates, and is unrelated to, the Building-179 policy and is
    intentionally left unchanged here.

    ANY student carrying the אנייר marker MUST always have this
    restriction enforced, regardless of is_priority (confirmed business
    rule — production validation of a production validation run caught a regression here: the
    ANIR import pipeline routinely also sets is_priority=True as a side
    effect of populating special_status_*, so an ANIR student is very
    often also a generic-priority student. If the generic-priority bypass
    below were allowed to apply to them too, accepted_dorm_type would be
    silently skipped and the student would receive candidates in ANY dorm
    type, not just their own — exactly the cross-DormType leak observed
    in production, where a subset of eligible Hasmaha ANIR students were
    placed in unrelated dorm types 6, 11, and 18).

    Enforcing this unconditionally for every אנייר-marked student is still
    correct for a Hasmaha ANIR student (accepted_dorm_type.code == 15):
    ordinary accepted-dorm-type matching already admits every apartment in
    that dorm type — Building 179 and any current or future overflow
    building — so enforcing the restriction does not narrow their
    candidates below what the confirmed overflow rule requires. An ANIR
    student accepted into a different dorm type keeps the same
    restriction as any other student, so they are never redirected toward
    Building 179 or any other כפר הסמכה building merely because they
    carry the אנייר marker, and never leak into a third, unrelated dorm
    type either.
    """
    if _has_anier_special_status(student):
        return True
    return not _get_student_priority(student)


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
    Building 179 (כפר הסמכה) already has an occupant who is not an
    eligible Hasmaha ANIR student, surface a clear warning instead of
    silently producing a misleading allocation.
    """
    warnings = []
    for apartment in apartments:
        if not _is_reserved_building_179_apartment(apartment):
            continue

        for assignment in existing_assignments_by_apartment.get(apartment.id, []):
            occupant = assignment.student
            if not _is_hasmaha_anier_student(occupant):
                warnings.append(
                    "Building 179 (כפר הסמכה) apartment "
                    f"{_safe_str(apartment.number)} already has an existing "
                    f"occupant (student_id={_get_student_identifier(occupant)}) "
                    "who is not an eligible Hasmaha ANIR student; the existing "
                    "assignment was preserved unchanged."
                )
    return warnings


def _anier_building_179_diagnostics(students, apartments, student_candidates, free_capacity_by_apartment):
    """
    Diagnostic counters for the Building-179 (כפר הסמכה, DormType.code==15)
    automatic-allocation preference, computed on every solver run so a
    broken upload mapping or a missing/misconfigured building shows up
    immediately instead of silently producing zero Hasmaha-ANIR
    assignments to their preferred building:

      imported_anier_students          — every student in this run carrying
                                          the אנייר marker, regardless of
                                          accepted dorm type.
      eligible_hasmaha_anier_students  — the subset of the above whose
                                          accepted_dorm_type.code == 15 —
                                          the actual population eligible
                                          for the Building-179 preference
                                          (the marker alone is not enough).
      reserved_building_found          — whether an apartment matching
                                          Building 179 in כפר הסמכה exists
                                          in this run's room inventory.
      reserved_building_available_beds — free beds in that building before
                                          solving.
      eligible_anier_students_sent_to_solver — eligible Hasmaha ANIR
                                          students who reached candidate
                                          generation with at least one
                                          feasible DormType-15 apartment
                                          (Building 179 or an overflow
                                          apartment).

    Four further keys — assigned_to_building_179,
    assigned_via_overflow_in_dorm_type, unassigned_eligible_hasmaha_anier,
    assigned_outside_hasmaha_dorm_type — are filled in after solving (see
    run_improved_ortools_allocation) once the actual outcome is known.
    """
    imported_anier_students = [
        student for student in students if _has_anier_special_status(student)
    ]
    eligible_hasmaha_anier_students = [
        student for student in imported_anier_students
        if _is_hasmaha_accepted_student(student)
    ]

    reserved_building_179_apartment_ids = {
        apartment.id
        for apartment in apartments
        if _is_reserved_building_179_apartment(apartment)
    }
    reserved_building_available_beds = sum(
        free_capacity_by_apartment.get(apartment_id, 0)
        for apartment_id in reserved_building_179_apartment_ids
    )

    eligible_sent_to_solver = [
        student for student in eligible_hasmaha_anier_students
        if student_candidates.get(student.id)
    ]

    return {
        "imported_anier_students": len(imported_anier_students),
        "eligible_hasmaha_anier_students": len(eligible_hasmaha_anier_students),
        "reserved_building_found": bool(reserved_building_179_apartment_ids),
        "reserved_building_available_beds": reserved_building_available_beds,
        "eligible_anier_students_sent_to_solver": len(eligible_sent_to_solver),
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
        # Reserved apartments (a generic mechanism, not specific to Building
        # 179) normally require priority status. Any student carrying the
        # אנייר marker is an explicit, pre-existing exception here — this
        # generic reserved-apartment bypass is independent of the dedicated
        # Building-179 accepted-dorm-type eligibility below, so it
        # intentionally still checks the marker alone.
        if not (
            _get_student_priority(student)
            or _has_anier_special_status(student)
        ):
            return False
    if not _may_use_building_179_automatically(student, apartment):
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


def _summarize_free_inventory(apartments, free_capacity_by_apartment):
    """
    Free-bed counts grouped by (category, apartment_type) — the "here is
    what IS available, even though it doesn't match" breakdown shown
    alongside an unassigned-reason explanation (e.g. "41 male-single beds,
    24 mixed-couple beds" when the blocked group needs female-single).
    """
    buckets = defaultdict(int)
    for apartment in apartments:
        free_count = free_capacity_by_apartment.get(apartment.id, 0)
        if free_count <= 0:
            continue
        category = _effective_apartment_category(apartment)
        apartment_type = getattr(apartment, "apartment_type", None)
        buckets[(category, apartment_type)] += free_count

    return [
        {
            "category": category,
            "apartment_type": apartment_type,
            "free_beds": free_beds,
        }
        for (category, apartment_type), free_beds in sorted(
            buckets.items(), key=lambda item: -item[1],
        )
    ]


def analyze_unassigned_group(student, rooms, hard_religious_together=True):
    """
    Staged hard-constraint breakdown for one representative student against
    an active Room queryset/list already scoped to their accepted dorm
    type (region-independent — accepted_dorm_type is the actual hard
    constraint, not region).

    Reuses the exact predicates the solver's own candidate-generation
    pipeline uses (_housing_matches_apartment,
    _may_enter_building_due_to_gender_restriction,
    _apartment_is_available_for_student) so the reported reason can never
    diverge from real solver behavior — this function is intentionally a
    thin staged wrapper around those, not a reimplementation of their
    rules.

    Stages, in order — the first stage where the surviving free-bed count
    reaches zero determines reason_code:
      1. physically free beds anywhere in the accepted dorm type
      2. ...also matching housing type AND gender/category together
         (_housing_matches_apartment checks both as one atomic rule, so
         they are reported as one combined reason rather than an
         artificial split that could misrepresent the real check)
      3. ...also allowed by any BUILDING-level gender restriction
         (a separate, structurally independent check from apartment
         category)
      4. ...also passing every remaining hard constraint via the real
         per-apartment eligibility function: religion/existing-occupant
         compatibility, room-level rules, accepted-dorm-type, Building
         179, and reserved-apartment rules.

    A student who survives stage 4 with compatible free beds but was
    still not assigned by the solver was blocked by a constraint this
    single-student staged view cannot see — chiefly the mutual-roommate
    hard constraint or contention with other students for the same beds
    at solve time. Reported as OTHER_HARD_CONSTRAINT_CONFLICT; the caller
    must not present this as a confirmed roommate conflict without
    further evidence.
    """
    rooms = _normalize_rooms_input(rooms)
    inventory = _prepare_inventory(rooms)
    apartments = sorted(
        inventory["apartments_by_id"].values(), key=lambda apartment: apartment.id,
    )

    free_capacity_by_apartment = {
        apartment.id: len(inventory["free_beds_by_apartment"].get(apartment.id, []))
        for apartment in apartments
    }
    inventory_breakdown = _summarize_free_inventory(apartments, free_capacity_by_apartment)
    physically_free_beds = sum(free_capacity_by_apartment.values())

    all_apartments_by_id = {room.apartment_id: room.apartment for room in rooms}
    frozen_gender_conflict_building_ids = _building_gender_conflict_ids(
        all_apartments_by_id.values(), inventory["existing_assignments_by_apartment"],
    )

    def _result(reason_code, compatible_free_beds=0):
        return {
            "reason_code": reason_code,
            "physically_free_beds_in_accepted_dorm": physically_free_beds,
            "compatible_free_beds": compatible_free_beds,
            "inventory_breakdown": inventory_breakdown,
        }

    stage1 = [a for a in apartments if free_capacity_by_apartment.get(a.id, 0) > 0]
    if not stage1:
        return _result("NO_PHYSICAL_FREE_BEDS_IN_ACCEPTED_DORM")

    stage2 = [a for a in stage1 if _housing_matches_apartment(student, a)]
    if not stage2:
        return _result("HOUSING_TYPE_OR_GENDER_MISMATCH")

    stage3 = [
        a for a in stage2
        if a.building_id not in frozen_gender_conflict_building_ids
        and _may_enter_building_due_to_gender_restriction(student, a)
    ]
    if not stage3:
        return _result("BUILDING_GENDER_RESTRICTION")

    final_matches = [
        a for a in stage3
        if _apartment_is_available_for_student(
            student, a,
            inventory["existing_assignments_by_apartment"].get(a.id, []),
            inventory["existing_exclusive_by_apartment"].get(a.id, False),
            hard_religious_together,
            existing_rj=a.id in inventory["existing_rj_apartments"],
            existing_non_rj=a.id in inventory["existing_non_rj_apartments"],
            existing_restricted_religions=inventory["existing_restricted_religion_by_apartment"].get(
                a.id, frozenset(),
            ),
            existing_religion_set=inventory["existing_religion_set_by_apartment"].get(
                a.id, frozenset(),
            ),
            frozen_gender_conflict_building_ids=frozen_gender_conflict_building_ids,
        )
    ]
    compatible_free_beds = sum(
        free_capacity_by_apartment.get(a.id, 0) for a in final_matches
    )
    if not final_matches or compatible_free_beds == 0:
        return _result("RELIGION_OR_EXISTING_OCCUPANT_INCOMPATIBILITY")

    return _result("OTHER_HARD_CONSTRAINT_CONFLICT", compatible_free_beds=compatible_free_beds)


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
    """
    Returns (created, used_var_by_group_scope, member_vars_by_group_scope)
    — the two extra dicts are pure bookkeeping over what this function
    already computes internally (which used_var/member_vars pair belongs
    to which (group, apartment_or_room) scope). Nothing about which
    variables get created, how they're linked, or what enters the
    objective changes — see _add_group_capacity_valid_inequalities, the
    only consumer of this extra data, for what it's used for.
    """
    if weight <= 0:
        return 0, {}, {}

    groups_by_apartment = defaultdict(lambda: defaultdict(list))

    for student in students:
        group = group_function(student)
        if not group:
            continue
        for apartment_id in student_candidates.get(student.id, []):
            variable = assignment_vars.get((student.id, apartment_id))
            if variable is not None:
                groups_by_apartment[apartment_id][group].append(variable)

    used_var_by_group_scope = {}
    member_vars_by_group_scope = {}
    created = 0
    for apartment in apartments:
        for group_index, (group_key, member_vars) in enumerate(
            groups_by_apartment.get(apartment.id, {}).items(),
            start=1,
        ):
            used_var = model.NewBoolVar(
                f"{label}_group_a{apartment.id}_{group_index}"
            )
            _link_group_used_var(model, used_var, member_vars)
            objective_terms.append(used_var * (-weight * WEIGHT_UNIT))
            created += 1
            used_var_by_group_scope[(group_key, apartment.id)] = used_var
            member_vars_by_group_scope[(group_key, apartment.id)] = member_vars

    return created, used_var_by_group_scope, member_vars_by_group_scope


def _add_group_capacity_valid_inequalities(
    model,
    students,
    assigned_expr_by_student,
    free_capacity_by_apartment,
    group_scopes,
):
    """
    Adds redundant (mathematically implied, never business-rule-changing)
    aggregate valid inequalities strengthening the LP relaxation around
    _add_soft_group_compaction's used_var booleans:

        assigned_group_g <= sum_a( group_capacity[g,a] * used[g,a] )

    Proof this is implied by the existing model, for every group g and
    apartment a already tracked by _add_soft_group_compaction:
      - _link_group_used_var(used[g,a], member_vars) already forces every
        member_var <= used[g,a]. So used[g,a]=0 forces every group-g
        candidate assignment at apartment a to 0 (0 actual placements),
        and used[g,a]=1 is the only case where >0 placements are possible.
      - group_capacity[g,a] = min(free_capacity[a], len(member_vars)) is
        the min of two values ALREADY exact/authoritative in the model:
        free_capacity[a] is the identical number the apartment's own
        capacity constraint (elsewhere in this function's caller) uses,
        and len(member_vars) is the count of distinct candidate variables
        that exist at all — an assignment can never exceed the number of
        variables available to set. The min of two safe upper bounds is
        itself a safe upper bound; capacity is never underestimated.
      - So actual-group-g-count-at-a <= group_capacity[g,a]*used[g,a] for
        every apartment individually; summing over every apartment where
        a group-g candidate exists (exactly the scopes this function
        receives, sourced from the same student_candidates/assignment_vars
        the rest of the model already uses) gives the inequality above.

    Never called for group_scopes belonging to room-pairing rooms/
    apartments — the caller only ever passes ordinary-apartment scopes,
    since the analogous room-level capacity term was never derived or
    tested; skipping room-pairing runs entirely (rather than guessing a
    room-level bound) is the deliberately conservative choice here.

    Returns the number of cuts added, for diagnostics only.
    """
    cuts_added = 0
    for used_map, members_map, group_function in group_scopes:
        groups_seen = defaultdict(list)
        for (group_key, apartment_id), used_var in used_map.items():
            member_vars = members_map[(group_key, apartment_id)]
            capacity = min(
                free_capacity_by_apartment.get(apartment_id, 0),
                len(member_vars),
            )
            groups_seen[group_key].append((apartment_id, used_var, capacity))

        for group_key, entries in groups_seen.items():
            assigned_group_expr = sum(
                assigned_expr_by_student[student.id]
                for student in students
                if group_function(student) == group_key
            )
            rhs = sum(capacity * used_var for _apt_id, used_var, capacity in entries)
            model.Add(assigned_group_expr <= rhs)
            cuts_added += 1

    return cuts_added


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
    Soft rule: prefer clustering priority students who are NOT eligible
    Hasmaha ANIR students into as few distinct buildings as reasonably
    possible. Grouping is decided by building_id, not dorm type or
    apartment id.

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

            if _is_hasmaha_anier_student(student):
                # Eligible Hasmaha ANIR students have their own dedicated
                # Building-179 preference (_add_building_179_preference)
                # spanning all of DormType 15; they never participate in
                # this generic "spread across as few buildings as
                # possible" preference.
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


def _add_building_179_preference(
    model,
    objective_terms,
    students,
    apartments,
    assignment_vars,
    student_candidates,
    weight,
):
    """
    Soft rule: for eligible Hasmaha ANIR students, reward an assignment
    specifically to Building 179 over any other DormType-15 apartment
    (176/177/178/any future building). This is what makes Building 179 the
    PREFERRED/first-choice destination for this group without hard-locking
    them to it (see _may_use_building_179_automatically and
    _should_enforce_accepted_dorm_type for the hard side of the policy).

    Every (student, apartment) pair this function touches already survived
    the full hard-eligibility pass in _apartment_is_available_for_student
    (active status, capacity, gender, religion, housing type, accepted
    dorm type, existing occupants, room-level rules, etc), so this reward
    can never override a hard constraint — it only ever adds a bonus on
    top of an already-feasible candidate. Being assigned anywhere (which
    earns assignment_score, or priority_score under priorityFirst) always
    dominates this reward's maximum possible contribution — see soft_range
    / assignment_score sizing in run_improved_ortools_allocation — so this
    preference can never cause a student to go unassigned merely because
    the Building-179 bonus could not be earned while a compatible
    DormType-15 bed exists elsewhere.
    """
    if weight <= 0:
        return 0

    apartment_by_id = {apartment.id: apartment for apartment in apartments}
    created = 0

    for student in students:
        if not _is_hasmaha_anier_student(student):
            continue
        for apartment_id in student_candidates.get(student.id, []):
            apartment = apartment_by_id.get(apartment_id)
            if apartment is None or not _is_reserved_building_179_apartment(apartment):
                continue
            variable = assignment_vars.get((student.id, apartment_id))
            if variable is not None:
                objective_terms.append(variable * (weight * WEIGHT_UNIT))
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


def _extract_current_solution(
    value_provider,
    students,
    student_candidates,
    assignment_vars,
    room_pairing_apartment_ids,
    student_room_candidates,
    room_assignment_vars,
    inventory,
    students_by_id,
):
    """
    Resolve which apartment/room/bed each student is assigned to in the
    solution currently held by `value_provider`.

    `value_provider` is anything exposing a `.Value(boolvar) -> int` method
    with the same contract as CpSolver.Value() - either the CpSolver itself
    (called once, after solver.Solve() returns, for the final result) or a
    CpSolverSolutionCallback instance mid-solve (self.Value(...), reading
    the current incumbent). Using one function for both means a live
    preview snapshot can never drift from the shape/logic of the real
    final result - it is not a re-implementation.

    Bed-level resolution (which specific bed within an apartment/room) uses
    the exact same deterministic tie-break (sorted by student identifier /
    bed label) the final persistence path has always used, so a preview's
    assignments are the same beds the final result would pick given
    today's incumbent solution.

    Returns (selected_apartment_by_student, selected_room_by_student,
    selected_bed_by_student) - all dicts keyed by student.id.
    """
    selected_apartment_by_student = {}

    for student in students:
        for apartment_id in student_candidates.get(student.id, []):
            variable = assignment_vars.get((student.id, apartment_id))
            if variable is not None and value_provider.Value(variable) == 1:
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
            if variable is not None and value_provider.Value(variable) == 1:
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

    return selected_apartment_by_student, selected_room_by_student, selected_bed_by_student


class _LiveSolutionCallback(cp_model.CpSolverSolutionCallback if ORTOOLS_AVAILABLE else object):
    """
    CP-SAT solution callback whose PRIMARY job is capturing feasible
    solutions: each time CP-SAT finds a new incumbent, it publishes a
    lightweight "current best solution so far" snapshot for the
    /preview/ endpoint to read (in-process live_registry immediately,
    plus a throttled AllocationRun.live_snapshot DB write as a
    cross-process fallback).

    The FIRST feasible solution is captured immediately, unthrottled
    (both the in-memory snapshot and the DB fallback) — a preview must
    become available as soon as anything feasible exists, not after an
    arbitrary warm-up delay. Every snapshot after the first is throttled
    by wall-clock time (_LIVE_MEMORY_SNAPSHOT_INTERVAL_SECONDS /
    _LIVE_DB_SNAPSHOT_INTERVAL_SECONDS) because on_solution_callback can
    fire very frequently once solutions start improving - this callback
    must stay cheap.

    Stopping the search is NOT this callback's primary responsibility -
    see _run_stop_watcher below, which polls AllocationRun.status on its
    own independent timer regardless of whether CP-SAT is finding new
    solutions. This callback only does an opportunistic, best-effort
    stop-flag check (cheap, since it is already awake) so a stop can take
    effect slightly earlier when solutions happen to be arriving
    frequently; it must never be relied on as the only way a stop
    request is noticed, because on_solution_callback only fires when a
    NEW IMPROVING solution is found - if the search goes a long stretch
    without improving, this callback simply does not run during that
    stretch.

    Never raises: any failure while checking the stop flag or building a
    snapshot is swallowed, because a bug here must never abort the solve.
    """

    def __init__(
        self,
        allocation_run_id,
        students,
        student_candidates,
        assignment_vars,
        room_pairing_apartment_ids,
        student_room_candidates,
        room_assignment_vars,
        inventory,
        students_by_id,
    ):
        cp_model.CpSolverSolutionCallback.__init__(self)
        self._allocation_run_id = allocation_run_id
        self._students = students
        self._student_candidates = student_candidates
        self._assignment_vars = assignment_vars
        self._room_pairing_apartment_ids = room_pairing_apartment_ids
        self._student_room_candidates = student_room_candidates
        self._room_assignment_vars = room_assignment_vars
        self._inventory = inventory
        self._students_by_id = students_by_id

        self._sequence = 0
        self._last_stop_check = 0.0
        self._last_memory_snapshot = 0.0
        self._last_db_snapshot = 0.0
        self._has_memory_snapshot = False
        self._has_db_snapshot = False

    def on_solution_callback(self):
        if self._allocation_run_id is None:
            return

        try:
            now = self.WallTime()
        except Exception:
            now = None

        # Opportunistic/secondary stop check only - see class docstring.
        # _run_stop_watcher is the authoritative, always-running mechanism.
        if now is not None and now - self._last_stop_check >= _LIVE_STOP_FLAG_POLL_INTERVAL_SECONDS:
            self._last_stop_check = now
            self._maybe_stop_search()

        is_first_snapshot = not self._has_memory_snapshot
        if not is_first_snapshot and (
            now is None
            or now - self._last_memory_snapshot < _LIVE_MEMORY_SNAPSHOT_INTERVAL_SECONDS
        ):
            return

        try:
            snapshot = self._build_snapshot(now if now is not None else self.WallTime())
        except Exception:
            return

        self._last_memory_snapshot = now if now is not None else snapshot["wall_time_seconds"]
        self._has_memory_snapshot = True
        live_registry.set(self._allocation_run_id, snapshot)

        is_first_db_snapshot = not self._has_db_snapshot
        due_for_db_write = is_first_db_snapshot or (
            now is not None
            and now - self._last_db_snapshot >= _LIVE_DB_SNAPSHOT_INTERVAL_SECONDS
        )
        if due_for_db_write:
            self._last_db_snapshot = self._last_memory_snapshot
            self._has_db_snapshot = True
            try:
                AllocationRun.objects.filter(pk=self._allocation_run_id).update(
                    live_snapshot=snapshot,
                )
            except Exception:
                pass

    def _maybe_stop_search(self):
        try:
            current_status = (
                AllocationRun.objects.filter(pk=self._allocation_run_id)
                .values_list("status", flat=True)
                .first()
            )
        except Exception:
            return

        if current_status in {
            AllocationRun.Status.CANCELLATION_REQUESTED,
            AllocationRun.Status.STOP_AND_SAVE_REQUESTED,
        }:
            self.StopSearch()

    def _build_snapshot(self, wall_time):
        (
            selected_apartment_by_student,
            _selected_room_by_student,
            selected_bed_by_student,
        ) = _extract_current_solution(
            self,
            self._students,
            self._student_candidates,
            self._assignment_vars,
            self._room_pairing_apartment_ids,
            self._student_room_candidates,
            self._room_assignment_vars,
            self._inventory,
            self._students_by_id,
        )

        assignments = [
            _build_assignment_payload(self._students_by_id[student_id], bed)
            for student_id, bed in sorted(selected_bed_by_student.items())
        ]

        self._sequence += 1

       
        objective_value = float(self.ObjectiveValue())
        best_objective_bound = float(self.BestObjectiveBound())
        absolute_gap = max(0.0, best_objective_bound - objective_value)
        relative_gap = absolute_gap / max(1.0, abs(objective_value))

        return {
            "sequence": self._sequence,
            "assignments": assignments,
            "assigned_count": len(assignments),
            "unassigned_count": len(self._students) - len(assignments),
            "objective_value": objective_value,
            "best_objective_bound": best_objective_bound,
            "absolute_gap": absolute_gap,
            "relative_gap": relative_gap,
            "wall_time_seconds": float(wall_time),
            "solver_status": "FEASIBLE",
            "captured_at": timezone.now().isoformat(),
        }


def _run_stop_watcher(allocation_run_id, solver, stop_event):
    """
    Runs in its own daemon thread for the duration of a single solve,
    polling AllocationRun.status on a fixed timer - independent of
    CP-SAT's solution-driven callback - and calling solver.StopSearch()
    the moment it observes a Cancel or Stop & Save request.

    This is the AUTHORITATIVE, process-agnostic way a stop request takes
    effect. It exists specifically because
    _LiveSolutionCallback.on_solution_callback only runs when CP-SAT
    finds a NEW IMPROVING solution - if the search goes a long stretch
    without improving, that callback simply does not run during the
    stretch, and a stop request would otherwise sit unnoticed until the
    next incumbent (or the time limit). This watcher has no such
    dependency: it checks the DB on its own schedule regardless of
    solver progress, so a stop request is noticed within roughly
    _STOP_WATCHER_POLL_INTERVAL_SECONDS no matter what CP-SAT is doing.
    (live_registry.request_stop_search additionally lets a same-process
    HTTP request trigger StopSearch() immediately, without waiting even
    for this watcher's next tick - see stop_and_save_allocation_run /
    stop_allocation_run in api/views.py.)

    `stop_event` is a threading.Event the caller sets once solver.Solve()
    returns, so this loop exits promptly instead of polling forever.
    """
    from django.db import close_old_connections, connection as db_conn

    try:
        while not stop_event.wait(timeout=_STOP_WATCHER_POLL_INTERVAL_SECONDS):
            try:
                close_old_connections()
                current_status = (
                    AllocationRun.objects.filter(pk=allocation_run_id)
                    .values_list("status", flat=True)
                    .first()
                )
            except Exception:
                continue

            if current_status in {
                AllocationRun.Status.CANCELLATION_REQUESTED,
                AllocationRun.Status.STOP_AND_SAVE_REQUESTED,
            }:
                try:
                    solver.StopSearch()
                except Exception:
                    pass
                return
    finally:
        try:
            db_conn.close()
        except Exception:
            pass


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
    enable_group_capacity_cuts=False,
):
    if not ORTOOLS_AVAILABLE:
        raise ImportError("OR-Tools is not installed.")

    if max_seconds is None:
        max_seconds = DEFAULT_SOLVER_TIME_SECONDS

    try:
        max_seconds = float(max_seconds)
    except (TypeError, ValueError) as exc:
        raise ValueError("max_seconds must be a positive number.") from exc

    if max_seconds < MIN_USER_SOLVER_TIME_SECONDS or max_seconds > MAX_USER_SOLVER_TIME_SECONDS:
        raise ValueError(
            "max_seconds must be between "
            f"{MIN_USER_SOLVER_TIME_SECONDS} and {MAX_USER_SOLVER_TIME_SECONDS} seconds."
        )

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
        "anier_building_179_diagnostics": dict(EMPTY_ANIER_BUILDING_179_DIAGNOSTICS),
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
    religion_used_map, religion_members_map = {}, {}
    if use_same_religion:
        religion_group_vars, religion_used_map, religion_members_map = (
            _add_soft_group_compaction(
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
        )
        if room_pairing_rooms:
            extra_created, _room_used_map, _room_members_map = (
                _add_soft_group_compaction(
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
            )
            religion_group_vars += extra_created

    sector_group_vars = 0
    sector_used_map, sector_members_map = {}, {}
    if use_sector_matching:
        sector_group_vars, sector_used_map, sector_members_map = (
            _add_soft_group_compaction(
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
        )
        if room_pairing_rooms:
            extra_created, _room_used_map, _room_members_map = (
                _add_soft_group_compaction(
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
            )
            sector_group_vars += extra_created

    if enable_group_capacity_cuts and not room_pairing_apartment_ids:
        group_scopes = []
        if use_same_religion and religion_used_map:
            group_scopes.append((religion_used_map, religion_members_map, _religion_key))
        if use_sector_matching and sector_used_map:
            group_scopes.append((sector_used_map, sector_members_map, _sector_key))
        if group_scopes:
            _add_group_capacity_valid_inequalities(
                model,
                students,
                assigned_expr_by_student,
                free_capacity_by_apartment,
                group_scopes,
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
    building_179_preference_vars = 0
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
        # Gated behind the same priorityFirst toggle as the clustering
        # preference above — the two are part of the same "priority
        # placement" feature bundle, and the frontend's priorityFirst
        # description is exactly what documents this Building-179
        # preference to users. In production this is always active:
        # normalize_allocation_constraints() forces priorityFirst on for
        # every real allocation run. The hard, asymmetric Building-179
        # eligibility rule itself (_may_use_building_179_automatically)
        # is NOT gated by this flag — it always applies.
        building_179_preference_vars = _add_building_179_preference(
            model,
            soft_terms,
            students,
            apartments,
            assignment_vars,
            student_candidates,
            BUILDING_179_PREFERENCE_WEIGHT,
        )

    soft_range = roommate_positive_upper_bound
    soft_range += religion_group_vars * religion_weight * WEIGHT_UNIT
    soft_range += sector_group_vars * sector_weight * WEIGHT_UNIT
    soft_range += year_mix_vars * year_weight * WEIGHT_UNIT
    soft_range += atudai_hasmaha_mix_vars * atudai_hasmaha_weight * WEIGHT_UNIT
    soft_range += priority_cluster_vars * PRIORITY_BUILDING_CLUSTER_WEIGHT * WEIGHT_UNIT
    soft_range += building_179_preference_vars * BUILDING_179_PREFERENCE_WEIGHT * WEIGHT_UNIT

    # Objective hierarchy safety: assignment_score strictly dominates the
    # entire soft_range (roommate/religion/sector/year/atudai-hasmaha/
    # priority-clustering/building-179-preference combined), and
    # priority_score in turn dominates len(students) assignment_score
    # terms plus soft_range. Total assignment count and priority
    # assignment count therefore always outweigh the building-179
    # preference — a student is never left unassigned merely because the
    # Building-179 bonus could not be earned.
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

    # Stamp the real search-start moment now — model/candidate generation
    # above (DB loading, _build_candidate_apartments/_build_candidate_rooms,
    # constraint/objective construction) can take meaningfully longer than
    # an instant, so this is deliberately NOT AllocationRun.started_at
    # (set at row creation, before any of that work). AllocationRunSerializer
    # derives elapsed_search_seconds/remaining_search_seconds from this
    # field so the frontend can reconstruct accurate timing after
    # navigating away, refreshing, or opening the page in a new tab. Only
    # a timing instrumentation write — does not affect solver behavior.
    if allocation_run_id is not None:
        AllocationRun.objects.filter(pk=allocation_run_id).update(
            search_started_at=timezone.now(),
        )

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

    # Live preview snapshots + real mid-solve stopping only make sense
    # when there is an AllocationRun row to publish/poll against - skip
    # all of this entirely for the sync legacy endpoint / management
    # command / tests that call this function without allocation_run_id,
    # so those callers see zero behavior change.
    if allocation_run_id is not None:
        live_callback = _LiveSolutionCallback(
            allocation_run_id,
            students,
            student_candidates,
            assignment_vars,
            room_pairing_apartment_ids,
            student_room_candidates,
            room_assignment_vars,
            inventory,
            students_by_id,
        )

        # Registering the solver lets a same-process HTTP request
        # (live_registry.request_stop_search, called from
        # stop_and_save_allocation_run / stop_allocation_run) invoke
        # StopSearch() immediately. The watcher thread is the
        # process-agnostic fallback/authority: it polls AllocationRun's
        # DB status on its own fixed timer, independent of whether
        # CP-SAT is currently finding new solutions - see
        # _run_stop_watcher's docstring for why the callback alone is
        # not sufficient.
        live_registry.register_solver(allocation_run_id, solver)
        stop_watcher_event = threading.Event()
        stop_watcher_thread = threading.Thread(
            target=_run_stop_watcher,
            args=(allocation_run_id, solver, stop_watcher_event),
            daemon=True,
        )
        stop_watcher_thread.start()

        try:
            status = solver.Solve(model, live_callback)
        finally:
            stop_watcher_event.set()
            stop_watcher_thread.join(timeout=_STOP_WATCHER_POLL_INTERVAL_SECONDS + 1.0)
            live_registry.unregister_solver(allocation_run_id)
            live_registry.clear(allocation_run_id)
    else:
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

    (
        selected_apartment_by_student,
        selected_room_by_student,
        selected_bed_by_student,
    ) = _extract_current_solution(
        solver,
        students,
        student_candidates,
        assignment_vars,
        room_pairing_apartment_ids,
        student_room_candidates,
        room_assignment_vars,
        inventory,
        students_by_id,
    )

    proposed_assignments = [
        _build_assignment_payload(students_by_id[student_id], bed)
        for student_id, bed in sorted(selected_bed_by_student.items())
    ]

    results["proposed_assignments"] = proposed_assignments
    results["assignments"] = proposed_assignments
    results["successful_assignments"] = len(proposed_assignments)
    results["conflicts"] = len(students) - len(proposed_assignments)

    # Post-solve Building-179 diagnostics: now that the actual outcome is
    # known, record how many eligible Hasmaha ANIR students landed in
    # their preferred building vs. overflowed elsewhere in DormType 15 vs.
    # could not be placed at all — this is what lets an operator tell
    # "179 was full so this student overflowed to 177" apart from "this
    # student was genuinely infeasible" (see also unassigned_reason
    # generation upstream in views.py).
    #
    # A destination outside DormType 15 entirely is NEVER valid overflow —
    # it must be counted and warned about separately
    # (assigned_outside_hasmaha_dorm_type), never folded into
    # assigned_via_overflow_in_dorm_type. Production validation of a production validation run
    # caught exactly this: a pre-fix accepted-dorm-type bug let 22 eligible
    # Hasmaha ANIR students leak into unrelated dorm types 6/11/18, and the
    # diagnostics at the time silently counted all 22 as "overflow"
    # alongside the 8 genuinely valid same-DormType-15 placements.
    hasmaha_anier_students = [
        student for student in students if _is_hasmaha_anier_student(student)
    ]
    assigned_to_179 = 0
    assigned_via_overflow = 0
    assigned_outside_dorm_type = 0
    unassigned_eligible = 0
    for student in hasmaha_anier_students:
        apartment_id = selected_apartment_by_student.get(student.id)
        if apartment_id is None:
            unassigned_eligible += 1
            continue
        apartment = all_apartments_by_id.get(apartment_id)
        if apartment is not None and _is_reserved_building_179_apartment(apartment):
            assigned_to_179 += 1
        elif apartment is not None and _apartment_in_hasmaha(apartment):
            assigned_via_overflow += 1
        else:
            assigned_outside_dorm_type += 1

    results["anier_building_179_diagnostics"]["eligible_hasmaha_anier_students"] = (
        len(hasmaha_anier_students)
    )
    results["anier_building_179_diagnostics"]["assigned_to_building_179"] = assigned_to_179
    results["anier_building_179_diagnostics"]["assigned_via_overflow_in_dorm_type"] = (
        assigned_via_overflow
    )
    results["anier_building_179_diagnostics"]["unassigned_eligible_hasmaha_anier"] = (
        unassigned_eligible
    )
    results["anier_building_179_diagnostics"]["assigned_outside_hasmaha_dorm_type"] = (
        assigned_outside_dorm_type
    )
    if assigned_outside_dorm_type:
        results["warnings"].append(
            "Data integrity: "
            f"{assigned_outside_dorm_type} eligible Hasmaha ANIR student(s) "
            "were assigned outside DormType 15 (כפר הסמכה) entirely — this "
            "should never happen and indicates accepted-dorm-type "
            "enforcement did not apply to them."
        )

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