"""
Tests for the Assisted Allocation workbench
(/api/assisted-allocation/*, backend/allocation/manual_placement.py).

Run with the isolated test database only; never target an operational database:
    python manage.py test api.tests_assisted_allocation
"""

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework import status

from api.models import (
    User, Region, DormType, Building, Apartment, Room, Bed,
    Student, BedAssignment, StudentRequest, AssistedAllocationAudit,
)
from allocation.manual_placement import evaluate_manual_override, find_configuration_opportunities
from allocation.solver import run_improved_ortools_allocation


# ---------------------------------------------------------------------------
# Helpers (mirrors api/tests_allocation.py's helper style)
# ---------------------------------------------------------------------------

def _make_region(name='TestRegion'):
    region_id = name.lower().replace(' ', '_')
    return Region.objects.create(id=region_id, name=name)


def _make_central_admin(region=None, email='admin@test.com'):
    user = User.objects.create_user(
        username=email, email=email, password='testpass123',
        role=User.Role.CENTRAL_ADMIN, first_name='Admin', last_name='User',
    )
    if region:
        user.region = region
        user.save()
    return user


def _make_region_boss(region, email='boss@test.com'):
    return User.objects.create_user(
        username=email, email=email, password='testpass123',
        role=User.Role.REGION_BOSS, first_name='Boss', last_name='User', region=region,
    )


def _make_employee(region, email='emp@test.com'):
    return User.objects.create_user(
        username=email, email=email, password='testpass123',
        role=User.Role.EMPLOYEE, first_name='Emp', last_name='User', region=region,
    )


def _make_dorm_type(region, name=None, code=None):
    name = name or f'DormType_{region.id}'
    return DormType.objects.create(name=name, code=code, region=region)


def _make_apartment(dorm_type, *, building_number=1, apartment_number='1',
                     category='male', apartment_type='single', room_count=1):
    building = Building.objects.create(number=building_number, dorm_type=dorm_type)
    apartment = Apartment.objects.create(
        number=apartment_number, building=building,
        category=category, apartment_type=apartment_type, room_count=room_count,
    )
    return building, apartment


def _make_room_with_beds(apartment, *, room_name='101', capacity=1, bed_labels=('A',)):
    room = Room.objects.create(name=room_name, apartment=apartment, capacity=capacity)
    beds = [Bed.objects.create(room=room, label=label) for label in bed_labels]
    return room, beds


def _make_student(dorm_type, *, student_id, gender='male', housing_type='רווקים',
                   accessibility_flag=False, assigned_room=None, is_priority=False):
    return Student.objects.create(
        student_id=student_id, first_name='Test', last_name=student_id,
        gender=gender, housing_type=housing_type, accepted_dorm_type=dorm_type,
        accessibility_flag=accessibility_flag, assigned_room=assigned_room,
        is_priority=is_priority,
    )


def _active_assignment(student, bed):
    return BedAssignment.objects.create(
        student=student, bed=bed, status=BedAssignment.Status.ACTIVE,
        assignment_type=BedAssignment.AssignmentType.INITIAL,
    )


# ---------------------------------------------------------------------------
# Regional isolation
# ---------------------------------------------------------------------------

class RegionalIsolationTests(TestCase):
    def setUp(self):
        self.region_a = _make_region('RegionA')
        self.region_b = _make_region('RegionB')
        self.dorm_a = _make_dorm_type(self.region_a)
        self.dorm_b = _make_dorm_type(self.region_b)

        self.building_b, self.apartment_b = _make_apartment(self.dorm_b)
        self.room_b, self.beds_b = _make_room_with_beds(self.apartment_b)

        self.student_b = _make_student(self.dorm_b, student_id='B001', housing_type='רווקים')

        self.employee_a = _make_employee(self.region_a)
        self.client = APIClient()
        self.client.force_authenticate(user=self.employee_a)

    def test_queue_rejects_foreign_region_param_for_regional_user(self):
        # Group 3 security hardening (G3-03): previously a mismatched
        # ?region= was silently ignored, falling back to the caller's own
        # region with a 200 - never a data leak, but also never told the
        # caller their request wasn't honored. resolve_scoped_region()
        # (api/views.py) now applies one consistent rule across every
        # region-scoped read endpoint (statistics, allocation_summary,
        # allocation_results, this queue, get_active_allocation_run):
        # region_boss/employee get a clean 403 on a mismatched region
        # instead, same as this endpoint already did for a directly
        # cross-region student (see test_student_detail_cross_region_403
        # below). See
        # project-quality/security/SECURITY_AND_AUTHORIZATION_REPORT.md.
        resp = self.client.get('/api/assisted-allocation/queue/', {'region': self.region_b.id})
        self.assertEqual(resp.status_code, 403)

    def test_queue_still_works_for_own_region(self):
        resp = self.client.get('/api/assisted-allocation/queue/', {'region': self.region_a.id})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['region_id'], self.region_a.id)
        ids = {s['student_id'] for s in resp.data['students']}
        self.assertNotIn('B001', ids)

    def test_student_detail_cross_region_403(self):
        resp = self.client.get(f'/api/assisted-allocation/students/{self.student_b.id}/detail/')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_recommendations_cross_region_403(self):
        resp = self.client.get(f'/api/assisted-allocation/students/{self.student_b.id}/recommendations/')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_override_check_cross_region_bed_403(self):
        # Student in region A, bed in region B.
        student_a = _make_student(self.dorm_a, student_id='A001')
        resp = self.client.get(
            f'/api/assisted-allocation/students/{student_a.id}/override-check/',
            {'bed_id': self.beds_b[0].id},
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_assign_cross_region_bed_403(self):
        student_a = _make_student(self.dorm_a, student_id='A002')
        resp = self.client.post(
            f'/api/assisted-allocation/students/{student_a.id}/assign/',
            {'bed_id': self.beds_b[0].id},
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(BedAssignment.objects.filter(student=student_a).exists())


# ---------------------------------------------------------------------------
# Accessibility manual placement + solver respect
# ---------------------------------------------------------------------------

class AccessibilityManualPlacementTests(TestCase):
    def setUp(self):
        self.region = _make_region()
        self.dorm_type = _make_dorm_type(self.region)
        self.building, self.apartment = _make_apartment(
            self.dorm_type, category='female', apartment_type='single',
        )
        self.room, self.beds = _make_room_with_beds(self.apartment, capacity=1, bed_labels=('A',))

        self.boss = _make_region_boss(self.region)
        self.client = APIClient()
        self.client.force_authenticate(user=self.boss)

        self.student = _make_student(
            self.dorm_type, student_id='ACC001', gender='female',
            housing_type='רווקות', accessibility_flag=True,
        )

    def test_accessibility_student_excluded_from_queue_unassigned_tab(self):
        resp = self.client.get('/api/assisted-allocation/queue/', {'tab': 'unassigned'})
        ids = {s['student_id'] for s in resp.data['students']}
        self.assertNotIn('ACC001', ids)

    def test_accessibility_student_appears_in_accessibility_tab(self):
        resp = self.client.get('/api/assisted-allocation/queue/', {'tab': 'accessibility'})
        ids = {s['student_id'] for s in resp.data['students']}
        self.assertIn('ACC001', ids)

    def test_manual_assign_then_solver_respects_it(self):
        resp = self.client.post(
            f'/api/assisted-allocation/students/{self.student.id}/assign/',
            {'bed_id': self.beds[0].id},
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        assignment = BedAssignment.objects.get(student=self.student, status=BedAssignment.Status.ACTIVE)
        self.assertEqual(assignment.bed_id, self.beds[0].id)

        audit = AssistedAllocationAudit.objects.get(student=self.student)
        self.assertEqual(audit.action_type, AssistedAllocationAudit.ActionType.MANUAL_ASSIGNMENT)
        self.assertEqual(audit.bed_assignment_id, assignment.id)

        # Solver run over the same room set must leave this active
        # assignment untouched - the bed is occupied, and accessibility
        # students are excluded from the solver's own student population.
        other_student = _make_student(
            self.dorm_type, student_id='ORD001', gender='female', housing_type='רווקות',
        )
        run_improved_ortools_allocation(
            students=Student.objects.filter(id=other_student.id),
            rooms=Room.objects.filter(id=self.room.id),
            constraints_config={},
        )
        assignment.refresh_from_db()
        self.assertEqual(assignment.status, BedAssignment.Status.ACTIVE)
        self.assertEqual(assignment.bed_id, self.beds[0].id)

    def test_resolved_tab_shows_manually_assigned_student(self):
        self.client.post(
            f'/api/assisted-allocation/students/{self.student.id}/assign/',
            {'bed_id': self.beds[0].id},
        )
        resp = self.client.get('/api/assisted-allocation/queue/', {'tab': 'resolved'})
        ids = {s['student_id'] for s in resp.data['students']}
        self.assertIn('ACC001', ids)


# ---------------------------------------------------------------------------
# Post-assignment state: the detail/recommendations endpoints and a second
# manual-placement attempt must all reflect that a student is already
# placed, instead of continuing to present them as actionable. Regression
# coverage for the bug where a successful manual placement appeared to
# "revert" - persistence was always correct (assigned_room/BedAssignment),
# but the detail panel and recommendations endpoint never checked
# student.is_assigned, so re-selecting the same (now-assigned) student kept
# showing a full, clickable candidate list as if nothing had been saved.
# ---------------------------------------------------------------------------

class PostAssignmentStateTests(TestCase):
    def setUp(self):
        self.region = _make_region()
        self.dorm_type = _make_dorm_type(self.region)
        self.building, self.apartment = _make_apartment(
            self.dorm_type, category='male', apartment_type='single',
        )
        self.room, self.beds = _make_room_with_beds(
            self.apartment, capacity=2, bed_labels=('A', 'B'),
        )
        self.boss = _make_region_boss(self.region)
        self.client = APIClient()
        self.client.force_authenticate(user=self.boss)
        self.student = _make_student(self.dorm_type, student_id='POST001', housing_type='רווקים')

    def _assign(self, bed_id):
        return self.client.post(
            f'/api/assisted-allocation/students/{self.student.id}/assign/',
            {'bed_id': bed_id},
        )

    def test_detail_shows_resolved_group_and_placement_after_assign(self):
        resp = self._assign(self.beds[0].id)
        self.assertEqual(resp.status_code, 200, resp.data)

        detail = self.client.get(f'/api/assisted-allocation/students/{self.student.id}/detail/')
        self.assertEqual(detail.data['student']['group'], 'resolved')
        placement = detail.data['current_placement']
        self.assertTrue(placement['assigned'])
        self.assertEqual(placement['room_id'], self.room.id)
        self.assertEqual(placement['bed_id'], self.beds[0].id)

    def test_recommendations_empty_after_assign(self):
        resp = self._assign(self.beds[0].id)
        self.assertEqual(resp.status_code, 200, resp.data)

        rec = self.client.get(
            f'/api/assisted-allocation/students/{self.student.id}/recommendations/'
        )
        self.assertEqual(rec.data['candidates']['total_valid_beds'], 0)
        self.assertEqual(rec.data['candidates']['buildings'], [])
        self.assertTrue(rec.data.get('already_assigned'))

    def test_second_manual_assign_rejected_and_no_new_assignment_created(self):
        first = self._assign(self.beds[0].id)
        self.assertEqual(first.status_code, 200, first.data)
        first_assignment_id = first.data['assignment_id']

        second = self._assign(self.beds[1].id)
        self.assertEqual(second.status_code, 400)

        active = BedAssignment.objects.filter(
            student=self.student, status=BedAssignment.Status.ACTIVE,
        )
        self.assertEqual(active.count(), 1)
        self.assertEqual(active.first().id, first_assignment_id)
        self.assertEqual(active.first().bed_id, self.beds[0].id)
        # No second audit row for a rejected re-assignment attempt.
        self.assertEqual(
            AssistedAllocationAudit.objects.filter(student=self.student).count(), 1,
        )

    def test_second_override_rejected_after_manual_assign(self):
        first = self._assign(self.beds[0].id)
        self.assertEqual(first.status_code, 200, first.data)

        second = self.client.post(
            f'/api/assisted-allocation/students/{self.student.id}/override/',
            {'bed_id': self.beds[1].id, 'note': 'trying again'},
        )
        self.assertEqual(second.status_code, 400)
        self.assertEqual(
            BedAssignment.objects.filter(
                student=self.student, status=BedAssignment.Status.ACTIVE,
            ).count(),
            1,
        )

    def test_queue_still_excludes_resolved_student_from_needs_placement(self):
        resp = self._assign(self.beds[0].id)
        self.assertEqual(resp.status_code, 200, resp.data)

        q = self.client.get('/api/assisted-allocation/queue/', {'tab': 'needs_placement'})
        ids = {s['student_id'] for s in q.data['students']}
        self.assertNotIn('POST001', ids)


# ---------------------------------------------------------------------------
# Unassigned surfacing
# ---------------------------------------------------------------------------

class UnassignedSurfacingTests(TestCase):
    def setUp(self):
        self.region = _make_region()
        self.dorm_type = _make_dorm_type(self.region)
        self.boss = _make_region_boss(self.region)
        self.client = APIClient()
        self.client.force_authenticate(user=self.boss)

    def test_unassigned_student_appears_without_extra_setup(self):
        student = _make_student(self.dorm_type, student_id='U001', housing_type='רווקים')
        resp = self.client.get('/api/assisted-allocation/queue/', {'tab': 'unassigned'})
        ids = {s['student_id'] for s in resp.data['students']}
        self.assertIn('U001', ids)
        self.assertEqual(resp.data['counts']['unassigned'], 1)

    def test_needs_placement_orders_accessibility_before_unassigned(self):
        _make_student(self.dorm_type, student_id='U002', housing_type='רווקים')
        _make_student(self.dorm_type, student_id='ACC002', housing_type='רווקים', accessibility_flag=True)
        resp = self.client.get('/api/assisted-allocation/queue/', {'tab': 'needs_placement'})
        groups = [s['group'] for s in resp.data['students']]
        self.assertEqual(groups[0], 'accessibility')


# ---------------------------------------------------------------------------
# Tier 1 - fully compatible recommendation
# ---------------------------------------------------------------------------

class Tier1RecommendationTests(TestCase):
    def setUp(self):
        self.region = _make_region()
        self.dorm_type = _make_dorm_type(self.region)
        self.building, self.apartment = _make_apartment(
            self.dorm_type, category='female', apartment_type='single',
        )
        self.room, self.beds = _make_room_with_beds(self.apartment)

        self.boss = _make_region_boss(self.region)
        self.client = APIClient()
        self.client.force_authenticate(user=self.boss)

        self.student = _make_student(
            self.dorm_type, student_id='T1001', gender='female', housing_type='רווקות',
        )

    def test_fully_compatible_bed_returned(self):
        resp = self.client.get(f'/api/assisted-allocation/students/{self.student.id}/recommendations/')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data['candidates']['total_valid_beds'] >= 1)
        self.assertTrue(resp.data['candidates']['buildings'])

    def test_best_candidate_categorized_as_recommended(self):
        resp = self.client.get(f'/api/assisted-allocation/students/{self.student.id}/recommendations/')
        apartment = resp.data['candidates']['buildings'][0]['apartments'][0]
        self.assertEqual(apartment['assisted_status'], 'recommended')
        self.assertEqual(apartment['override_violations'], [])


# ---------------------------------------------------------------------------
# Tier 2 - configuration opportunities, safety
# ---------------------------------------------------------------------------

class Tier2ConfigOpportunityTests(TestCase):
    def setUp(self):
        self.region = _make_region()
        self.dorm_type = _make_dorm_type(self.region)

    def test_opportunity_produced_for_empty_mismatched_apartment(self):
        building, apartment = _make_apartment(
            self.dorm_type, category='male', apartment_type='single',
        )
        _make_room_with_beds(apartment, capacity=2, bed_labels=('A', 'B'))
        student = _make_student(self.dorm_type, student_id='G001', gender='female', housing_type='רווקות')

        opportunities = find_configuration_opportunities(self.region, [student])
        matching = [o for o in opportunities if o.get('apartment_id') == apartment.id]
        self.assertTrue(matching)
        self.assertEqual(matching[0]['proposed_category'], 'female')
        self.assertEqual(matching[0]['unlocked_bed_count'], 2)
        self.assertIn(student.id, matching[0]['affected_student_ids'])

    def test_no_opportunity_when_apartment_has_active_occupant(self):
        building, apartment = _make_apartment(
            self.dorm_type, category='male', apartment_type='single',
        )
        room, beds = _make_room_with_beds(apartment, capacity=2, bed_labels=('A', 'B'))
        occupant = _make_student(self.dorm_type, student_id='OCC001', gender='male', housing_type='רווקים')
        _active_assignment(occupant, beds[0])

        student = _make_student(self.dorm_type, student_id='G002', gender='female', housing_type='רווקות')
        opportunities = find_configuration_opportunities(self.region, [student])
        matching = [o for o in opportunities if o.get('apartment_id') == apartment.id]
        self.assertFalse(matching)

    def test_apply_config_change_blocked_by_existing_conflict_check(self):
        """
        Sanity check that the *existing* check_apartment_write_conflict
        (reused, not duplicated, by the Assisted Allocation "apply change"
        action) really does reject a category flip once an incompatible
        occupant has moved in after the suggestion was generated.
        """
        building, apartment = _make_apartment(
            self.dorm_type, category='male', apartment_type='single',
        )
        room, beds = _make_room_with_beds(apartment, capacity=1, bed_labels=('A',))
        occupant = _make_student(self.dorm_type, student_id='OCC002', gender='male', housing_type='רווקים')
        _active_assignment(occupant, beds[0])

        boss = _make_region_boss(self.region)
        client = APIClient()
        client.force_authenticate(user=boss)
        resp = client.patch(f'/api/apartments/{apartment.id}/', {'category': 'female'}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.data.get('code'), 'ACTIVE_OCCUPANT_CONFLICT')


# ---------------------------------------------------------------------------
# Tier 2 - building-level configuration opportunities, safety
#
# Same safety property as the apartment-level tests above, checked at the
# building scope: a building-level gender_restriction flip affects every
# apartment underneath it, so it must only ever be suggested/applied when
# the ENTIRE building has zero active occupants - "has free beds" is not
# "is empty" (a building with even one active assignment, in an apartment
# that otherwise still has free beds, must never be offered a restriction
# flip).
# ---------------------------------------------------------------------------

class BuildingLevelConfigOpportunityTests(TestCase):
    def setUp(self):
        self.region = _make_region()
        self.dorm_type = _make_dorm_type(self.region)

    def _make_restricted_building(self, number, restriction='male'):
        building = Building.objects.create(
            number=number, dorm_type=self.dorm_type, gender_restriction=restriction,
        )
        apartment = Apartment.objects.create(
            building=building, number='8', category='mixed', apartment_type='single', room_count=1,
        )
        room, beds = _make_room_with_beds(
            apartment, capacity=8, bed_labels=tuple(str(i) for i in range(1, 9)),
        )
        return building, apartment, room, beds

    def test_opportunity_produced_for_fully_empty_building(self):
        building, apartment, room, beds = self._make_restricted_building(176)
        student = _make_student(self.dorm_type, student_id='BEMPTY1', gender='female', housing_type='רווקות')

        opportunities = find_configuration_opportunities(self.region, [student])
        matching = [
            o for o in opportunities
            if o.get('type') == 'building_gender_restriction' and o.get('building_id') == building.id
        ]
        self.assertTrue(matching)
        self.assertEqual(matching[0]['proposed_restriction'], 'female')
        self.assertEqual(matching[0]['unlocked_bed_count'], 8)
        self.assertIn(student.id, matching[0]['affected_student_ids'])

    def test_no_opportunity_for_building_with_one_active_occupant_and_free_beds(self):
        # capacity 8, occupied 1, 7 free beds - "has free beds" must not be
        # treated as "is empty".
        building, apartment, room, beds = self._make_restricted_building(177)
        occupant = _make_student(self.dorm_type, student_id='BOCC1', gender='male', housing_type='רווקים')
        _active_assignment(occupant, beds[0])

        student = _make_student(self.dorm_type, student_id='BEMPTY2', gender='female', housing_type='רווקות')
        opportunities = find_configuration_opportunities(self.region, [student])
        matching = [
            o for o in opportunities
            if o.get('type') == 'building_gender_restriction' and o.get('building_id') == building.id
        ]
        self.assertFalse(matching)

    def test_apply_building_restriction_change_blocked_when_occupied(self):
        building, apartment, room, beds = self._make_restricted_building(178)
        occupant = _make_student(self.dorm_type, student_id='BOCC2', gender='male', housing_type='רווקים')
        _active_assignment(occupant, beds[0])

        boss = _make_region_boss(self.region)
        client = APIClient()
        client.force_authenticate(user=boss)
        resp = client.patch(f'/api/buildings/{building.id}/', {'gender_restriction': 'female'}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.data.get('code'), 'ACTIVE_OCCUPANT_CONFLICT')
        building.refresh_from_db()
        self.assertEqual(building.gender_restriction, 'male')


# ---------------------------------------------------------------------------
# Tier 2 - race condition at apply time: a "שינוי הגדרה" recommendation
# generated while a unit was empty must be safely refused if the unit was
# occupied in the meantime, and existing assignments elsewhere must never be
# touched by a rejected (or unrelated) configuration-change attempt.
# ---------------------------------------------------------------------------

class ConfigChangeRaceConditionTests(TestCase):
    def setUp(self):
        self.region = _make_region()
        self.dorm_type = _make_dorm_type(self.region)
        self.boss = _make_region_boss(self.region)
        self.client = APIClient()
        self.client.force_authenticate(user=self.boss)

    def test_apartment_occupied_after_recommendation_blocks_the_change(self):
        building, apartment = _make_apartment(
            self.dorm_type, category='male', apartment_type='single',
        )
        room, beds = _make_room_with_beds(apartment, capacity=8, bed_labels=tuple(str(i) for i in range(1, 9)))
        waiting = _make_student(self.dorm_type, student_id='RACE_W1', gender='female', housing_type='רווקות')

        # At this point the apartment is genuinely empty - a "שינוי הגדרה"
        # recommendation for it would be valid (mirrors what the staff
        # member would have seen on screen).
        opportunities = find_configuration_opportunities(self.region, [waiting])
        self.assertTrue(any(o.get('apartment_id') == apartment.id for o in opportunities))

        # ...but before they confirm it, another employee assigns 3
        # students into it (capacity 8, 5 beds still free - "has free beds"
        # is not "is empty").
        for i in range(3):
            occ = _make_student(self.dorm_type, student_id=f'RACE_OCC{i}', gender='male', housing_type='רווקים')
            _active_assignment(occ, beds[i])

        resp = self.client.patch(f'/api/apartments/{apartment.id}/', {'category': 'female'}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.data.get('code'), 'ACTIVE_OCCUPANT_CONFLICT')
        apartment.refresh_from_db()
        self.assertEqual(apartment.category, 'male')

    def test_existing_assignments_untouched_by_rejected_config_change(self):
        building, apartment = _make_apartment(
            self.dorm_type, category='male', apartment_type='single',
        )
        room, beds = _make_room_with_beds(apartment, capacity=3, bed_labels=('A', 'B', 'C'))
        occupants = []
        for i, bed in enumerate(beds):
            occ = _make_student(self.dorm_type, student_id=f'KEEP{i}', gender='male', housing_type='רווקים')
            occupants.append((occ, _active_assignment(occ, bed)))

        before = {
            a.id: (a.student_id, a.bed_id, a.status)
            for _occ, a in occupants
        }

        resp = self.client.patch(f'/api/apartments/{apartment.id}/', {'category': 'female'}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

        after = {
            a.id: (a.student_id, a.bed_id, a.status)
            for a in BedAssignment.objects.filter(id__in=before.keys())
        }
        self.assertEqual(before, after)
        self.assertEqual(BedAssignment.objects.filter(status=BedAssignment.Status.ACTIVE).count(), 3)


# ---------------------------------------------------------------------------
# Tier 3 - manual override
# ---------------------------------------------------------------------------

class ManualOverrideTests(TestCase):
    def setUp(self):
        self.region = _make_region()
        self.dorm_type = _make_dorm_type(self.region)
        self.building, self.apartment = _make_apartment(
            self.dorm_type, category='male', apartment_type='single',
        )
        self.room, self.beds = _make_room_with_beds(self.apartment, capacity=1, bed_labels=('A',))

        self.boss = _make_region_boss(self.region)
        self.client = APIClient()
        self.client.force_authenticate(user=self.boss)

        self.student = _make_student(
            self.dorm_type, student_id='OV001', gender='female', housing_type='רווקות',
        )

    def test_override_check_reports_gender_violation(self):
        resp = self.client.get(
            f'/api/assisted-allocation/students/{self.student.id}/override-check/',
            {'bed_id': self.beds[0].id},
        )
        self.assertEqual(resp.status_code, 200)
        codes = {v['code'] for v in resp.data['violations']}
        self.assertIn('gender', codes)
        gender_violation = next(v for v in resp.data['violations'] if v['code'] == 'gender')
        self.assertFalse(gender_violation['overridable'])
        # Gender is a structural/absolute blocker - it can never be
        # overridden, so requires_override (which implies "an override CAN
        # proceed") must be False, and blocked must be True.
        self.assertTrue(resp.data['blocked'])
        self.assertFalse(resp.data['requires_override'])

    def test_override_requires_note(self):
        resp = self.client.post(
            f'/api/assisted-allocation/students/{self.student.id}/override/',
            {'bed_id': self.beds[0].id, 'note': ''},
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_override_succeeds_with_note_and_logs_violations(self):
        # A gender mismatch (the shared fixture's self.apartment/self.beds)
        # is an absolute blocker and can no longer be overridden (see
        # test_override_rejected_for_absolute_blocker) - override success
        # is now only meaningful for an administrative (overridable)
        # violation, so this builds its own religion-conflict scenario:
        # gender/housing type match exactly, only ReligiousTogether is
        # violated.
        building, apartment = _make_apartment(
            self.dorm_type, building_number=2, category='female', apartment_type='single',
        )
        room, beds = _make_room_with_beds(apartment, capacity=2, bed_labels=('A', 'B'))
        resident = Student.objects.create(
            student_id='RJ001', first_name='Resident', last_name='RJ',
            gender='female', housing_type='רווקות', accepted_dorm_type=self.dorm_type,
            requested_religion=Student.Religion.Jewish, religious=Student.Religious.RELIGIOUS,
        )
        _active_assignment(resident, beds[0])

        student = _make_student(
            self.dorm_type, student_id='OV004', gender='female', housing_type='רווקות',
        )
        student.requested_religion = Student.Religion.Muslim
        student.save()

        resp = self.client.post(
            f'/api/assisted-allocation/students/{student.id}/override/',
            {'bed_id': beds[1].id, 'note': 'אין מקום אחר באזור'},
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertTrue(resp.data['overridden_rules'])
        codes = {v['code'] for v in resp.data['overridden_rules']}
        self.assertIn('religion', codes)
        self.assertTrue(all(v['overridable'] for v in resp.data['overridden_rules']))

        assignment = BedAssignment.objects.get(student=student, status=BedAssignment.Status.ACTIVE)
        self.assertEqual(assignment.bed_id, beds[1].id)

        audit = AssistedAllocationAudit.objects.get(student=student)
        self.assertEqual(audit.action_type, AssistedAllocationAudit.ActionType.MANUAL_OVERRIDE)
        self.assertEqual(audit.note, 'אין מקום אחר באזור')
        self.assertTrue(audit.overridden_rules)

    def test_override_rejected_for_absolute_blocker(self):
        # self.apartment/self.beds is 'male'/'single'; self.student is
        # female - a structural gender mismatch. No note, however
        # compelling, may override it.
        resp = self.client.post(
            f'/api/assisted-allocation/students/{self.student.id}/override/',
            {'bed_id': self.beds[0].id, 'note': 'אין מקום אחר באזור בכלל'},
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(
            BedAssignment.objects.filter(student=self.student, status=BedAssignment.Status.ACTIVE).exists()
        )
        self.assertFalse(AssistedAllocationAudit.objects.filter(student=self.student).exists())

    def test_override_cannot_use_already_occupied_bed(self):
        occupant = _make_student(self.dorm_type, student_id='OCC003', gender='male', housing_type='רווקים')
        _active_assignment(occupant, self.beds[0])

        resp = self.client.post(
            f'/api/assisted-allocation/students/{self.student.id}/override/',
            {'bed_id': self.beds[0].id, 'note': 'test'},
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            BedAssignment.objects.filter(bed=self.beds[0], status=BedAssignment.Status.ACTIVE).count(), 1,
        )

    def test_override_cannot_exceed_room_capacity(self):
        # capacity=1 room with its only bed already occupied by someone else -
        # even skip_validation must not create a second active assignment.
        occupant = _make_student(self.dorm_type, student_id='OCC004', gender='female', housing_type='רווקות')
        _active_assignment(occupant, self.beds[0])

        second_student = _make_student(self.dorm_type, student_id='OV002', gender='female', housing_type='רווקות')
        resp = self.client.post(
            f'/api/assisted-allocation/students/{second_student.id}/override/',
            {'bed_id': self.beds[0].id, 'note': 'test'},
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_evaluate_manual_override_empty_for_compatible_bed(self):
        compatible_student = _make_student(
            self.dorm_type, student_id='OV003', gender='male', housing_type='רווקים',
        )
        violations = evaluate_manual_override(compatible_student, self.room)
        self.assertEqual(violations, [])


# ---------------------------------------------------------------------------
# Transfer request integration (Tier 4)
# ---------------------------------------------------------------------------

class TransferRequestIntegrationTests(TestCase):
    def setUp(self):
        self.region = _make_region()
        self.dorm_type = _make_dorm_type(self.region)
        self.boss = _make_region_boss(self.region)
        self.client = APIClient()
        self.client.force_authenticate(user=self.boss)
        self.student = _make_student(self.dorm_type, student_id='TR001', housing_type='רווקים')

    def test_transfer_requested_moves_out_of_unassigned_into_transfer_pending_tab(self):
        # Before the transfer request: an ordinary unassigned/actionable student.
        before = self.client.get('/api/assisted-allocation/queue/', {'tab': 'unassigned'})
        self.assertIn('TR001', {s['student_id'] for s in before.data['students']})
        self.assertEqual(before.data['counts']['transfer_requested'], 0)

        StudentRequest.objects.create(
            request_type=StudentRequest.RequestType.REGION_TRANSFER,
            student=self.student,
            reason='אין מקום פנוי באזור',
            requested_by=self.boss,
        )

        # A pending region_transfer takes the student OUT of the ordinary
        # unassigned/needs_placement population - never simultaneously
        # "actionable locally" and "pending transfer".
        unassigned = self.client.get('/api/assisted-allocation/queue/', {'tab': 'unassigned'})
        self.assertNotIn('TR001', {s['student_id'] for s in unassigned.data['students']})

        needs_placement = self.client.get('/api/assisted-allocation/queue/', {'tab': 'needs_placement'})
        self.assertNotIn('TR001', {s['student_id'] for s in needs_placement.data['students']})
        self.assertEqual(needs_placement.data['counts']['unassigned'], 0)

        pending = self.client.get('/api/assisted-allocation/queue/', {'tab': 'transfer_pending'})
        rows = {s['student_id']: s for s in pending.data['students']}
        self.assertIn('TR001', rows)
        self.assertTrue(rows['TR001']['is_transfer_requested'])
        self.assertEqual(rows['TR001']['group'], 'transfer_pending')
        self.assertEqual(pending.data['counts']['transfer_requested'], 1)


# ---------------------------------------------------------------------------
# Central vs regional permission matrix
# ---------------------------------------------------------------------------

class PermissionMatrixTests(TestCase):
    def setUp(self):
        self.region_a = _make_region('RegionA2')
        self.region_b = _make_region('RegionB2')
        self.dorm_a = _make_dorm_type(self.region_a)
        self.dorm_b = _make_dorm_type(self.region_b)
        _make_student(self.dorm_a, student_id='PA001', housing_type='רווקים')
        _make_student(self.dorm_b, student_id='PB001', housing_type='רווקים')

    def test_central_admin_sees_all_regions_by_default(self):
        admin = _make_central_admin()
        client = APIClient()
        client.force_authenticate(user=admin)
        resp = client.get('/api/assisted-allocation/queue/', {'tab': 'unassigned'})
        ids = {s['student_id'] for s in resp.data['students']}
        self.assertIn('PA001', ids)
        self.assertIn('PB001', ids)

    def test_central_admin_can_filter_by_region(self):
        admin = _make_central_admin()
        client = APIClient()
        client.force_authenticate(user=admin)
        resp = client.get('/api/assisted-allocation/queue/', {'tab': 'unassigned', 'region': self.region_a.id})
        ids = {s['student_id'] for s in resp.data['students']}
        self.assertIn('PA001', ids)
        self.assertNotIn('PB001', ids)

    def test_employee_scoped_to_own_region_only(self):
        employee = _make_employee(self.region_a)
        client = APIClient()
        client.force_authenticate(user=employee)
        resp = client.get('/api/assisted-allocation/queue/', {'tab': 'unassigned'})
        ids = {s['student_id'] for s in resp.data['students']}
        self.assertIn('PA001', ids)
        self.assertNotIn('PB001', ids)

    def test_unauthenticated_request_rejected(self):
        client = APIClient()
        resp = client.get('/api/assisted-allocation/queue/')
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)


# ---------------------------------------------------------------------------
# Assisted allocation must stay inside the student's accepted DormType, and
# candidates must be classified into the recommended/possible/override-
# required tiers using the real allocation rules (not region-wide browsing,
# not frontend-invented scoring).
# ---------------------------------------------------------------------------

class DormTypeRestrictionAndTieringTests(TestCase):
    def setUp(self):
        self.region = _make_region()
        self.dorm_a = _make_dorm_type(self.region, name='DormA')
        self.dorm_b = _make_dorm_type(self.region, name='DormB')
        self.boss = _make_region_boss(self.region)
        self.client = APIClient()
        self.client.force_authenticate(user=self.boss)

    def _get_recommendations(self, student):
        return self.client.get(f'/api/assisted-allocation/students/{student.id}/recommendations/')

    def test_same_region_different_dorm_type_not_a_candidate(self):
        # Compatible bed exists, but in dorm_b - the same region as the
        # student's accepted dorm_a, just a different dorm type.
        building_b, apartment_b = _make_apartment(
            self.dorm_b, category='female', apartment_type='single',
        )
        _make_room_with_beds(apartment_b)

        student = _make_student(self.dorm_a, student_id='D001', gender='female', housing_type='רווקות')
        resp = self._get_recommendations(student)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['candidates']['total_valid_beds'], 0)
        building_ids = {b['building_id'] for b in resp.data['candidates']['buildings']}
        self.assertNotIn(building_b.id, building_ids)

    def test_same_dorm_type_compatible_bed_is_a_candidate(self):
        building_a, apartment_a = _make_apartment(
            self.dorm_a, category='female', apartment_type='single',
        )
        _make_room_with_beds(apartment_a)

        student = _make_student(self.dorm_a, student_id='D002', gender='female', housing_type='רווקות')
        resp = self._get_recommendations(student)
        self.assertEqual(resp.status_code, 200)
        self.assertGreaterEqual(resp.data['candidates']['total_valid_beds'], 1)
        building_ids = {b['building_id'] for b in resp.data['candidates']['buildings']}
        self.assertIn(building_a.id, building_ids)

    def test_no_candidate_in_accepted_dorm_type_enables_transfer_fallback(self):
        # dorm_b has a free, otherwise-compatible bed - but the student only
        # accepted dorm_a, which has nothing free. Recommendations must
        # report zero candidates (the signal the frontend uses to show the
        # transfer-request fallback) rather than silently reaching into
        # dorm_b.
        building_b, apartment_b = _make_apartment(
            self.dorm_b, category='male', apartment_type='single',
        )
        _make_room_with_beds(apartment_b)

        student = _make_student(self.dorm_a, student_id='D003', gender='male', housing_type='רווקים')
        resp = self._get_recommendations(student)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['candidates']['total_valid_beds'], 0)
        self.assertEqual(resp.data['candidates']['buildings'], [])

    def test_less_preferred_valid_candidate_is_possible_not_recommended(self):
        building, apartment = _make_apartment(
            self.dorm_a, category='male', apartment_type='single',
        )
        room, beds = _make_room_with_beds(apartment, capacity=2, bed_labels=('A', 'B'))
        resident = Student.objects.create(
            student_id='SEC001', first_name='Resident', last_name='Sector',
            gender='male', housing_type='רווקים', accepted_dorm_type=self.dorm_a,
            placement_sector=Student.PlacementSector.ARAB,
        )
        _active_assignment(resident, beds[0])

        student = _make_student(self.dorm_a, student_id='D004', gender='male', housing_type='רווקים')
        student.placement_sector = Student.PlacementSector.JEWISH
        student.save()

        resp = self._get_recommendations(student)
        self.assertEqual(resp.status_code, 200)
        matching_apt = next(
            a for b in resp.data['candidates']['buildings'] for a in b['apartments']
            if a['apartment_id'] == apartment.id
        )
        self.assertEqual(matching_apt['assisted_status'], 'possible')
        self.assertEqual(matching_apt['override_violations'], [])
        warning_codes = {w['code'] for w in matching_apt['warnings']}
        self.assertIn('sector_conflict', warning_codes)

    def test_overridable_violation_shown_as_override_required_with_consequence(self):
        building, apartment = _make_apartment(
            self.dorm_a, category='female', apartment_type='single',
        )
        room, beds = _make_room_with_beds(apartment, capacity=2, bed_labels=('A', 'B'))
        resident = Student.objects.create(
            student_id='RJ002', first_name='Resident', last_name='RJ',
            gender='female', housing_type='רווקות', accepted_dorm_type=self.dorm_a,
            requested_religion=Student.Religion.Jewish, religious=Student.Religious.RELIGIOUS,
        )
        _active_assignment(resident, beds[0])

        student = _make_student(self.dorm_a, student_id='D005', gender='female', housing_type='רווקות')
        student.requested_religion = Student.Religion.Muslim
        student.save()

        resp = self._get_recommendations(student)
        matching_apt = next(
            a for b in resp.data['candidates']['buildings'] for a in b['apartments']
            if a['apartment_id'] == apartment.id
        )
        self.assertEqual(matching_apt['assisted_status'], 'override_required')
        violation = next(v for v in matching_apt['override_violations'] if v['code'] == 'religion')
        self.assertTrue(violation['overridable'])
        self.assertTrue(violation['consequence'])

    def test_absolute_blocker_never_appears_as_a_candidate(self):
        # Wrong gender for the apartment category - a structural blocker,
        # never a candidate at any tier (not even override_required).
        building, apartment = _make_apartment(
            self.dorm_a, category='male', apartment_type='single',
        )
        _make_room_with_beds(apartment)

        student = _make_student(self.dorm_a, student_id='D006', gender='female', housing_type='רווקות')
        resp = self._get_recommendations(student)
        self.assertEqual(resp.status_code, 200)
        apartment_ids = {
            a['apartment_id'] for b in resp.data['candidates']['buildings'] for a in b['apartments']
        }
        self.assertNotIn(apartment.id, apartment_ids)

    def test_config_change_causes_candidates_to_be_recalculated(self):
        building, apartment = _make_apartment(
            self.dorm_a, category='male', apartment_type='single',
        )
        _make_room_with_beds(apartment, capacity=2, bed_labels=('A', 'B'))
        student = _make_student(self.dorm_a, student_id='D007', gender='female', housing_type='רווקות')

        before = self._get_recommendations(student)
        self.assertNotIn(
            apartment.id,
            {a['apartment_id'] for b in before.data['candidates']['buildings'] for a in b['apartments']},
        )

        patch_resp = self.client.patch(f'/api/apartments/{apartment.id}/', {'category': 'female'}, format='json')
        self.assertEqual(patch_resp.status_code, 200, patch_resp.data)

        after = self._get_recommendations(student)
        self.assertIn(
            apartment.id,
            {a['apartment_id'] for b in after.data['candidates']['buildings'] for a in b['apartments']},
        )


# ---------------------------------------------------------------------------
# Pending region_transfer state machine: a student with a PENDING
# region_transfer request must be mutually exclusive with "locally
# actionable" everywhere - the queue, detail, recommendations, and the
# assign/override write endpoints all key off the SAME
# _pending_region_transfer() lookup (see views.py) so they can never drift.
# Covers the full lifecycle: pending -> rejected / cancelled (back to the
# ordinary queue) and pending -> approved (leaves the source queue for good).
# ---------------------------------------------------------------------------

class TransferPendingStateMachineTests(TestCase):
    def setUp(self):
        self.region = _make_region()
        self.dest_region = _make_region('DestRegion')
        self.dorm_type = _make_dorm_type(self.region)
        self.dest_dorm_type = _make_dorm_type(self.dest_region)
        self.building, self.apartment = _make_apartment(
            self.dorm_type, category='male', apartment_type='single',
        )
        self.room, self.beds = _make_room_with_beds(self.apartment, capacity=2, bed_labels=('A', 'B'))

        self.dest_building, self.dest_apartment = _make_apartment(
            self.dest_dorm_type, category='male', apartment_type='single',
        )
        self.dest_room, self.dest_beds = _make_room_with_beds(
            self.dest_apartment, room_name='201', capacity=1, bed_labels=('A',),
        )

        self.boss = _make_region_boss(self.region)
        self.admin = _make_central_admin()
        self.client = APIClient()
        self.client.force_authenticate(user=self.boss)

        self.student = _make_student(self.dorm_type, student_id='XFER001', housing_type='רווקים')

        self.req = StudentRequest.objects.create(
            request_type=StudentRequest.RequestType.REGION_TRANSFER,
            student=self.student,
            target_region=self.dest_region,
            reason='אין מקום פנוי באזור',
            requested_by=self.boss,
        )

    def test_detail_exposes_pending_transfer_and_blocks_local_reason(self):
        resp = self.client.get(f'/api/assisted-allocation/students/{self.student.id}/detail/')
        self.assertEqual(resp.data['student']['group'], 'transfer_pending')
        self.assertTrue(resp.data['student']['is_transfer_requested'])
        pending = resp.data['pending_transfer_request']
        self.assertEqual(pending['id'], self.req.id)
        self.assertEqual(pending['status'], 'pending')
        self.assertEqual(pending['target_region'], self.dest_region.id)
        self.assertEqual(pending['target_region_name'], self.dest_region.name)
        # No "why can't we place them locally" banner while mid-transfer.
        self.assertIsNone(resp.data['reason'])

    def test_recommendations_blocked_while_pending(self):
        resp = self.client.get(f'/api/assisted-allocation/students/{self.student.id}/recommendations/')
        self.assertEqual(resp.data['candidates']['total_valid_beds'], 0)
        self.assertEqual(resp.data['candidates']['buildings'], [])
        self.assertTrue(resp.data.get('transfer_pending'))
        self.assertFalse(resp.data.get('already_assigned'))

    def test_manual_assign_blocked_while_pending(self):
        resp = self.client.post(
            f'/api/assisted-allocation/students/{self.student.id}/assign/',
            {'bed_id': self.beds[0].id},
        )
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(BedAssignment.objects.filter(student=self.student).exists())

    def test_override_blocked_while_pending(self):
        resp = self.client.post(
            f'/api/assisted-allocation/students/{self.student.id}/override/',
            {'bed_id': self.beds[0].id, 'note': 'trying anyway'},
        )
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(BedAssignment.objects.filter(student=self.student).exists())

    def test_rejected_transfer_returns_student_to_actionable_queue(self):
        admin_client = APIClient()
        admin_client.force_authenticate(self.admin)
        resp = admin_client.put(f'/api/requests/{self.req.id}/reject/', {'reason': 'לא רלוונטי'})
        self.assertEqual(resp.status_code, 200, resp.data)

        self.req.refresh_from_db()
        self.assertEqual(self.req.status, 'rejected')

        unassigned = self.client.get('/api/assisted-allocation/queue/', {'tab': 'unassigned'})
        self.assertIn('XFER001', {s['student_id'] for s in unassigned.data['students']})
        pending = self.client.get('/api/assisted-allocation/queue/', {'tab': 'transfer_pending'})
        self.assertNotIn('XFER001', {s['student_id'] for s in pending.data['students']})

        # Local placement works normally again.
        assign = self.client.post(
            f'/api/assisted-allocation/students/{self.student.id}/assign/',
            {'bed_id': self.beds[0].id},
        )
        self.assertEqual(assign.status_code, 200, assign.data)

    def test_requester_can_cancel_own_pending_transfer(self):
        resp = self.client.put(f'/api/requests/{self.req.id}/cancel/')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.req.refresh_from_db()
        self.assertEqual(self.req.status, 'cancelled')
        self.assertEqual(self.req.reviewed_by_id, self.boss.id)
        self.assertIsNotNone(self.req.reviewed_at)

        unassigned = self.client.get('/api/assisted-allocation/queue/', {'tab': 'unassigned'})
        self.assertIn('XFER001', {s['student_id'] for s in unassigned.data['students']})
        pending = self.client.get('/api/assisted-allocation/queue/', {'tab': 'transfer_pending'})
        self.assertNotIn('XFER001', {s['student_id'] for s in pending.data['students']})

        # Local placement (candidate recommendations + manual assign) works
        # again after withdrawal - not stuck permanently under "בהעברה".
        rec = self.client.get(f'/api/assisted-allocation/students/{self.student.id}/recommendations/')
        self.assertFalse(rec.data.get('transfer_pending'))
        assign = self.client.post(
            f'/api/assisted-allocation/students/{self.student.id}/assign/',
            {'bed_id': self.beds[0].id},
        )
        self.assertEqual(assign.status_code, 200, assign.data)

    def test_central_admin_can_cancel_source_regions_pending_transfer(self):
        admin_client = APIClient()
        admin_client.force_authenticate(self.admin)
        resp = admin_client.put(f'/api/requests/{self.req.id}/cancel/')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.req.refresh_from_db()
        self.assertEqual(self.req.status, 'cancelled')

    def test_unrelated_region_user_cannot_cancel(self):
        other_region = _make_region('OtherRegion')
        other_boss = _make_region_boss(other_region, email='other-boss@test.com')
        other_client = APIClient()
        other_client.force_authenticate(other_boss)

        # StudentRequestViewSet.get_queryset() already scopes a non-central
        # user's visible requests to their own region (requested_by/
        # student/target_room region) - an unrelated region's request is
        # invisible before cancel()'s own is_requester/_user_can_review_
        # request check is ever reached, so this 404s rather than 403s.
        # Same behavior approve()/reject() already have on this viewset.
        resp = other_client.put(f'/api/requests/{self.req.id}/cancel/')
        self.assertEqual(resp.status_code, 404)
        self.req.refresh_from_db()
        self.assertEqual(self.req.status, 'pending')

    def test_unauthenticated_cannot_cancel(self):
        resp = APIClient().put(f'/api/requests/{self.req.id}/cancel/')
        self.assertEqual(resp.status_code, 401)

    def test_cannot_cancel_already_rejected_request(self):
        self.req.status = StudentRequest.Status.REJECTED
        self.req.reviewed_by = self.admin
        self.req.reviewed_at = timezone.now()
        self.req.save()

        resp = self.client.put(f'/api/requests/{self.req.id}/cancel/')
        self.assertEqual(resp.status_code, 400)

    def test_cannot_cancel_already_cancelled_request(self):
        self.req.status = StudentRequest.Status.CANCELLED
        self.req.reviewed_by = self.boss
        self.req.reviewed_at = timezone.now()
        self.req.save()

        resp = self.client.put(f'/api/requests/{self.req.id}/cancel/')
        self.assertEqual(resp.status_code, 400)

    def test_cannot_cancel_already_approved_request(self):
        admin_client = APIClient()
        admin_client.force_authenticate(self.admin)
        approve = admin_client.put(f'/api/requests/{self.req.id}/approve/', {
            'target_room': self.dest_room.id, 'bed_id': self.dest_beds[0].id,
        })
        self.assertEqual(approve.status_code, 200, approve.data)

        resp = self.client.put(f'/api/requests/{self.req.id}/cancel/')
        self.assertEqual(resp.status_code, 400)

    def test_approved_transfer_leaves_source_queue_for_good(self):
        admin_client = APIClient()
        admin_client.force_authenticate(self.admin)
        approve = admin_client.put(f'/api/requests/{self.req.id}/approve/', {
            'target_room': self.dest_room.id, 'bed_id': self.dest_beds[0].id,
        })
        self.assertEqual(approve.status_code, 200, approve.data)

        self.student.refresh_from_db()
        self.assertEqual(self.student.assigned_room_id, self.dest_room.id)
        self.assertTrue(
            BedAssignment.objects.filter(
                student=self.student, bed__in=self.dest_beds, status=BedAssignment.Status.ACTIVE,
            ).exists()
        )

        # Gone from every source-region actionable/pending tab - the real
        # BedAssignment is authoritative, not a frontend boolean.
        pending = self.client.get('/api/assisted-allocation/queue/', {'tab': 'transfer_pending'})
        self.assertNotIn('XFER001', {s['student_id'] for s in pending.data['students']})
        unassigned = self.client.get('/api/assisted-allocation/queue/', {'tab': 'unassigned'})
        self.assertNotIn('XFER001', {s['student_id'] for s in unassigned.data['students']})

        detail = self.client.get(f'/api/assisted-allocation/students/{self.student.id}/detail/')
        self.assertEqual(detail.data['student']['group'], 'resolved')
