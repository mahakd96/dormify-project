"""
Tests for the Assisted Allocation workbench
(/api/assisted-allocation/*, backend/allocation/manual_placement.py).

Run with the test database (never the production Azure DB):
    python manage.py test api.tests_assisted_allocation
"""

from django.test import TestCase
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

    def test_queue_ignores_foreign_region_param_for_regional_user(self):
        resp = self.client.get('/api/assisted-allocation/queue/', {'region': self.region_b.id})
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

    def test_transfer_requested_reflected_in_queue(self):
        StudentRequest.objects.create(
            request_type=StudentRequest.RequestType.REGION_TRANSFER,
            student=self.student,
            reason='אין מקום פנוי באזור',
            requested_by=self.boss,
        )
        resp = self.client.get('/api/assisted-allocation/queue/', {'tab': 'unassigned'})
        row = next(s for s in resp.data['students'] if s['student_id'] == 'TR001')
        self.assertTrue(row['is_transfer_requested'])
        self.assertEqual(resp.data['counts']['transfer_requested'], 1)


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
