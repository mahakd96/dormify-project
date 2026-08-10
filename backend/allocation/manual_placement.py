"""
Staff-assisted placement helpers for the Assisted Allocation workbench.

This module does not implement any new compatibility rule. Every check here
reuses the pure predicate functions already defined in allocation/solver.py
(the automatic solver's own candidate-generation rules) so there is exactly
one place hard-constraint policy lives. Two things this module adds on top
of what the solver needs for itself:

  1. evaluate_manual_override - unlike the solver (which only needs a single
     True/False "is this apartment feasible"), a human confirmation dialog
     needs to know EVERY rule a chosen placement would violate, not just the
     first one. This walks the same predicates independently instead of
     short-circuiting.

  2. find_configuration_opportunities - scans currently-EMPTY apartments/
     buildings for a category/gender_restriction change that would make them
     usable for students who are otherwise stuck. Only ever considers
     zero-occupant apartments/buildings, so the existing
     check_apartment_write_conflict / check_building_write_conflict guards
     (backend/api/serializers.py) can never reject the change later - safety
     here is structural, not re-verified.
"""

from copy import copy

from django.db.models import Count, Q

from api.models import Apartment, Bed, BedAssignment, Building, Student

from allocation.solver import (
    _accepted_dorm_matches,
    _effective_apartment_category,
    _get_building_gender_restriction,
    _get_student_priority,
    _has_anier_special_status,
    _housing_matches_apartment,
    _is_religious_jewish,
    _may_enter_building_due_to_gender_restriction,
    _religion_key,
    _student_religious_state,
)


# ---------------------------------------------------------------------------
# Tier 3 - manual override: report every violated rule
# ---------------------------------------------------------------------------

# Mirrors the Hebrew labels already shown on the Buildings page
# (src/pages/BuildingsPage.js GENDER_RESTRICTION_LABELS) - never invent a
# second Hebrew wording for the same concept.
_GENDER_RESTRICTION_LABEL = {
    'male': 'בנים בלבד',
    'female': 'בנות בלבד',
}


def _apartment_religious_state(other_residents):
    """
    Same aggregation allocation.solver._prepare_inventory performs for a
    whole run's inventory, computed here for just one apartment's current
    residents (a handful of rows, fetched by the caller).
    """
    existing_rj = False
    existing_non_rj = False
    existing_restricted_religions = set()
    existing_religion_set = set()

    for resident in other_residents:
        if _is_religious_jewish(resident):
            existing_rj = True
        else:
            existing_non_rj = True
        state = _student_religious_state(resident)
        if state is not None and state[0] == 'religion':
            existing_restricted_religions.add(state[1])
        r = _religion_key(resident)
        if r:
            existing_religion_set.add(r)

    return existing_rj, existing_non_rj, existing_restricted_religions, existing_religion_set


def religion_conflict_for_candidate(student, other_residents):
    """
    True when placing `student` alongside `other_residents` (Student
    instances, or any object exposing requested_religion/religious the way
    solver._religion_key / _student_religious_state expect) would violate
    ReligiousTogether. Single source of truth for this rule, shared by
    evaluate_manual_override (write-path override confirmation) and
    api.views.find_matching_room_options (read-path candidate ranking) so
    the two can never drift apart.
    """
    existing_rj, existing_non_rj, existing_restricted_religions, existing_religion_set = (
        _apartment_religious_state(other_residents)
    )
    s_state = _student_religious_state(student)
    s_religion = _religion_key(student)

    if existing_rj and not _is_religious_jewish(student):
        return True
    for r in existing_restricted_religions:
        if s_religion != r:
            return True
    if s_state is not None:
        if s_state[0] == 'rj' and existing_non_rj:
            return True
        if s_state[0] == 'religion' and (existing_religion_set - {s_state[1]}):
            return True
    return False


# Every violation code evaluate_manual_override can return, tagged with
# whether an authorized administrator may knowingly override it. Gender/
# housing-type/building/dorm-type eligibility are structural - a bed that
# fails one of these is not a worse candidate, it is not a candidate at all,
# so these can never be bypassed regardless of note/authorization. Religion
# and reserved-apartment policy are administrative preferences the dorm
# office may knowingly waive with a documented reason. Single source of
# truth for this split - api/views.py's assisted_allocation_override view
# re-derives its "blocked vs requires_override" response from this exact
# set instead of hardcoding its own copy.
NON_OVERRIDABLE_VIOLATION_CODES = {
    'housing_type', 'occupied', 'exclusive_occupancy', 'gender', 'building_gender', 'dorm_type',
}

# Short, human explanation of the practical consequence of overriding a
# given (overridable) violation - shown in the confirmation dialog next to
# the rule label so staff understand what they are knowingly waiving.
OVERRIDE_VIOLATION_CONSEQUENCE = {
    'religion': 'בדירה קיימים דיירים מקבוצה דתית שאינה תואמת את כלל השיבוץ הדתי',
    'reserved': 'הדירה שמורה לאוכלוסיית עדיפות ואינה זמינה באופן רגיל לסטודנט/ית זה',
}


def _violation(code, label):
    return {
        'code': code,
        'label': label,
        'overridable': code not in NON_OVERRIDABLE_VIOLATION_CODES,
        'consequence': OVERRIDE_VIOLATION_CONSEQUENCE.get(code, ''),
    }


def evaluate_manual_override(student, room, existing_assignments=None):
    """
    Every hard-compatibility rule the requested (student, room) placement
    would violate, as a list of {"code", "label", "overridable", "consequence"}
    dicts (see NON_OVERRIDABLE_VIOLATION_CODES for which codes are
    structural/never-overridable vs administrative/waivable). An empty list means
    the placement is already fully compatible - callers should perform a
    normal assignment instead of an override in that case.

    `existing_assignments` (optional): active BedAssignment rows for this
    apartment, excluding the student being placed, with `.student` already
    populated. When not supplied, this queries them directly (BedAssignment
    imported from api.models is already available via the solver import
    above the call site does not need to duplicate that query).

    Deliberately does NOT check: room/apartment/building active flags, or
    bed/room capacity - those are structural constraints re-verified by
    get_specific_free_bed/get_free_bed at the moment of assignment
    regardless of override, so they are never "overridable" and are not
    reported here as bypassable rules.

    Deliberately does NOT check Building-179 (כפר הסמכה) eligibility -
    allocation.solver._may_use_building_179_automatically documents that
    this gate applies to AUTOMATIC allocation only; staff have always been
    able to manually place a non-ANIR student into Building 179, so that is
    not something an override needs to acknowledge.
    """
    apartment = room.apartment
    building = apartment.building
    violations = []

    if existing_assignments is None:
        existing_assignments = list(
            BedAssignment.objects.filter(
                bed__room__apartment=apartment,
                status=BedAssignment.Status.ACTIVE,
            ).exclude(
                student_id=getattr(student, 'id', None),
            ).select_related('student')
        )
    other_residents = [a.student for a in existing_assignments]

    # --- housing type / apartment type / gender category ------------------
    from api.views import _z_compatibility

    if student.housing_type == Student.HousingType.SINGLE_IN_APARTMENT:
        if apartment.apartment_type != Apartment.ApartmentType.COUPLE:
            violations.append(_violation('housing_type', 'סוג דירה לא תואם'))
        if other_residents:
            violations.append(_violation('occupied', 'הדירה תפוסה - נדרשת דירה ריקה'))
    else:
        if any(r.housing_type == Student.HousingType.SINGLE_IN_APARTMENT for r in other_residents):
            violations.append(_violation('exclusive_occupancy', 'הדירה שמורה לשיבוץ רווקים/ות בדירה'))

        expected = _z_compatibility(student.housing_type)
        if expected is None:
            violations.append(_violation('housing_type', 'אין סוג דיור נתמך לסטודנט זה'))
        else:
            expected_type, expected_category = expected
            if apartment.apartment_type != expected_type:
                violations.append(_violation('housing_type', 'סוג דירה לא תואם'))
            effective_category = _effective_apartment_category(apartment)
            if effective_category != expected_category:
                violations.append(_violation('gender', 'מגדר/קטגוריית הדירה לא תואמים'))

        if student.housing_type in (Student.HousingType.COUPLE, Student.HousingType.FAMILY) and other_residents:
            violations.append(_violation('exclusive_occupancy', 'הדירה תפוסה - נדרשת דירה ריקה'))

    # --- building-wide gender restriction ----------------------------------
    if not _may_enter_building_due_to_gender_restriction(student, apartment):
        restriction = _get_building_gender_restriction(building)
        label = _GENDER_RESTRICTION_LABEL.get(restriction, 'הבניין מוגבל למגדר אחר')
        violations.append(_violation('building_gender', f'הבניין מוגבל - {label}'))

    # --- accepted dorm type -------------------------------------------------
    if not _accepted_dorm_matches(student, apartment):
        violations.append(_violation('dorm_type', 'מחוץ לסוג המעונות שאליו הסטודנט התקבל'))

    # --- religion (ReligiousTogether) --------------------------------------
    if religion_conflict_for_candidate(student, other_residents):
        violations.append(_violation('religion', 'אין התאמה דתית לדיירים הקיימים'))

    # --- reserved apartment --------------------------------------------------
    if apartment.inactive_reason == Apartment.InactiveReason.RESERVED:
        if not (_get_student_priority(student) or _has_anier_special_status(student)):
            violations.append(_violation('reserved', 'הדירה שמורה'))

    return violations


# ---------------------------------------------------------------------------
# Tier 2 - configuration opportunities on completely empty inventory
# ---------------------------------------------------------------------------

_FLIPPABLE_CATEGORY = {
    Apartment.Category.MALE: Apartment.Category.FEMALE,
    Apartment.Category.FEMALE: Apartment.Category.MALE,
}
_FLIPPABLE_GENDER_RESTRICTION = {'male': 'female', 'female': 'male'}


def _empty_apartments_in_region(region):
    return (
        Apartment.objects.filter(
            building__dorm_type__region=region,
            is_active=True,
            building__is_active=True,
        )
        .select_related('building', 'building__dorm_type')
        .annotate(active_occupants=Count(
            'rooms__beds__assignments',
            filter=Q(rooms__beds__assignments__status=BedAssignment.Status.ACTIVE),
            distinct=True,
        ))
        .filter(active_occupants=0)
    )


def find_configuration_opportunities(region, students):
    """
    `students`: the queued (accessibility-pending + unassigned) students in
    this region right now - used only to count how many of them a proposed
    change would help, never to decide whether the suggestion is safe.
    Returns a list of opportunity dicts, apartment-level first (the primary,
    explicitly-requested case), then building-level.
    """
    students = list(students)
    opportunities = []

    for apartment in _empty_apartments_in_region(region):
        current_category = apartment.category
        proposed_category = _FLIPPABLE_CATEGORY.get(current_category)
        if proposed_category is None:
            continue  # mixed-category apartments (couple/family) aren't gender-flippable

        hypothetical = copy(apartment)
        hypothetical.category = proposed_category

        affected = [
            s for s in students
            if _housing_matches_apartment(s, hypothetical) and _accepted_dorm_matches(s, apartment)
            and not _housing_matches_apartment(s, apartment)
        ]
        if not affected:
            continue

        bed_count = Bed.objects.filter(room__apartment=apartment).count()
        opportunities.append({
            'type': 'apartment_category',
            'apartment_id': apartment.id,
            'apartment_number': apartment.number,
            'building_id': apartment.building_id,
            'building_number': apartment.building.number,
            'current_category': current_category,
            'proposed_category': proposed_category,
            'unlocked_bed_count': bed_count,
            'affected_student_ids': [s.id for s in affected],
            'affected_student_count': len(affected),
        })

    # Building-level gender_restriction flip: only ever proposed when EVERY
    # apartment in the building is currently empty.
    buildings = (
        Building.objects.filter(
            dorm_type__region=region,
            is_active=True,
        )
        .exclude(gender_restriction='')
        .select_related('dorm_type')
        .prefetch_related('apartments')
    )
    for building in buildings:
        apartment_ids = list(building.apartments.values_list('id', flat=True))
        if not apartment_ids:
            continue
        occupied = Apartment.objects.filter(
            id__in=apartment_ids,
            rooms__beds__assignments__status=BedAssignment.Status.ACTIVE,
        ).exists()
        if occupied:
            continue

        current_restriction = _get_building_gender_restriction(building)
        proposed_restriction = _FLIPPABLE_GENDER_RESTRICTION.get(current_restriction)
        if proposed_restriction is None:
            continue

        hypothetical_building = copy(building)
        hypothetical_building.gender_restriction = proposed_restriction

        affected_ids = set()
        for apartment in building.apartments.all():
            hypothetical_apartment = copy(apartment)
            hypothetical_apartment.building = hypothetical_building
            for s in students:
                if s.id in affected_ids:
                    continue
                if (
                    _may_enter_building_due_to_gender_restriction(s, hypothetical_apartment)
                    and _housing_matches_apartment(s, hypothetical_apartment)
                    and _accepted_dorm_matches(s, apartment)
                    and not _may_enter_building_due_to_gender_restriction(s, apartment)
                ):
                    affected_ids.add(s.id)

        if not affected_ids:
            continue

        bed_count = Bed.objects.filter(room__apartment_id__in=apartment_ids).count()
        opportunities.append({
            'type': 'building_gender_restriction',
            'building_id': building.id,
            'building_number': building.number,
            'current_restriction': current_restriction,
            'proposed_restriction': proposed_restriction,
            'unlocked_bed_count': bed_count,
            'affected_student_ids': sorted(affected_ids),
            'affected_student_count': len(affected_ids),
        })

    opportunities.sort(key=lambda o: -o['affected_student_count'])
    return opportunities


def has_unsafe_configuration_candidates(region, students):
    """
    True when at least one currently-OCCUPIED apartment in the region has
    free beds AND a category flip would help a queued student - i.e.
    inventory that looks promising ("free beds exist") but is not safe to
    touch because real students already live there.

    Informational only: this never feeds find_configuration_opportunities
    (which only ever proposes changes to genuinely empty units) or any
    other actionable list. It exists purely so the UI can explain, in one
    short line, why staff don't see a "שינוי הגדרה" suggestion for a unit
    that visibly has free beds - see api.views.assisted_allocation_recommendations.
    """
    students = list(students)
    if not students:
        return False

    apartments = (
        Apartment.objects.filter(
            building__dorm_type__region=region, is_active=True, building__is_active=True,
        )
        .select_related('building', 'building__dorm_type')
        .annotate(
            active_occupants=Count(
                'rooms__beds__assignments',
                filter=Q(rooms__beds__assignments__status=BedAssignment.Status.ACTIVE),
                distinct=True,
            ),
            total_beds=Count('rooms__beds', distinct=True),
        )
        .filter(active_occupants__gt=0, total_beds__gt=0)
    )

    for apartment in apartments:
        if apartment.active_occupants >= apartment.total_beds:
            continue  # fully occupied - no free beds, not what this note is about
        proposed_category = _FLIPPABLE_CATEGORY.get(apartment.category)
        if proposed_category is None:
            continue

        hypothetical = copy(apartment)
        hypothetical.category = proposed_category
        if any(
            _housing_matches_apartment(s, hypothetical) and _accepted_dorm_matches(s, apartment)
            and not _housing_matches_apartment(s, apartment)
            for s in students
        ):
            return True
    return False
