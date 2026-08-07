"""
Focused tests for the redesigned BuildingsPage inventory-management API:
Building / Apartment / Room / Bed create-edit-activate-deactivate, the
safety validations that block conflicting edits on occupied inventory, and
region-scoped permission enforcement.

Run with the isolated test database (never the production Azure DB):
    ENV_FILE=.env.test python manage.py test api.tests_inventory
"""

from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import (
    User, Region, DormType, Building, Apartment, Room, Bed,
    Student, BedAssignment, StudentRequest,
)
from api.views import get_free_bed


# ---------------------------------------------------------------------------
# Helpers (kept local/self-contained rather than importing from
# tests_allocation.py, per "use isolated tests only").
# ---------------------------------------------------------------------------

def _make_region(name='InvRegion'):
    region_id = name.lower().replace(' ', '_')
    return Region.objects.create(id=region_id, name=name)


def _make_central_admin(email='admin@inv.test'):
    return User.objects.create_user(
        username=email, email=email, password='testpass123',
        role=User.Role.CENTRAL_ADMIN, first_name='Admin', last_name='User',
    )


def _make_region_boss(region, email='boss@inv.test'):
    return User.objects.create_user(
        username=email, email=email, password='testpass123',
        role=User.Role.REGION_BOSS, first_name='Boss', last_name='User',
        region=region,
    )


def _make_employee(region, email='emp@inv.test'):
    return User.objects.create_user(
        username=email, email=email, password='testpass123',
        role=User.Role.EMPLOYEE, first_name='Emp', last_name='User',
        region=region,
    )


def _make_full_stack(region, *, category=Apartment.Category.FEMALE,
                      apartment_type=Apartment.ApartmentType.SINGLE,
                      capacity=2, occupy=False,
                      gender=Student.Gender.FEMALE,
                      housing_type=Student.HousingType.SINGLE_FEMALE):
    """Building -> Apartment -> Room -> Bed, optionally with one active occupant."""
    dorm_type = DormType.objects.create(name=f'InvDorm_{region.id}', region=region)
    building = Building.objects.create(number=100, dorm_type=dorm_type)
    apartment = Apartment.objects.create(
        building=building, number='1', category=category,
        apartment_type=apartment_type, room_count=1, apartment_capacity=capacity,
    )
    room = Room.objects.create(apartment=apartment, name='A', capacity=capacity)
    beds = [Bed.objects.create(room=room, label=str(i + 1)) for i in range(capacity)]

    student = None
    if occupy:
        student = Student.objects.create(
            student_id=f'INV_OCC_{apartment.id}', first_name='Occ', last_name='Student',
            gender=gender, housing_type=housing_type, accepted_dorm_type=dorm_type,
            assigned_room=room,
        )
        BedAssignment.objects.create(
            student=student, bed=beds[0], status=BedAssignment.Status.ACTIVE,
            assignment_type=BedAssignment.AssignmentType.INITIAL,
        )

    return dorm_type, building, apartment, room, beds, student


# ---------------------------------------------------------------------------
# 1 & 3. Building creation/editing + region permission enforcement.
# ---------------------------------------------------------------------------
class BuildingCreateEditTest(TestCase):

    def test_boss_can_create_building(self):
        region = _make_region('BldCreateRegion')
        boss = _make_region_boss(region)
        dorm_type = DormType.objects.create(name='BldCreateDorm', region=region)

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.post('/api/buildings/', {'number': 42, 'dorm_type': dorm_type.id}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['number'], 42)
        self.assertTrue(Building.objects.filter(number=42, dorm_type=dorm_type).exists())

    def test_employee_cannot_create_building(self):
        region = _make_region('BldEmpRegion')
        employee = _make_employee(region)
        dorm_type = DormType.objects.create(name='BldEmpDorm', region=region)

        client = APIClient()
        client.force_authenticate(user=employee)
        response = client.post('/api/buildings/', {'number': 1, 'dorm_type': dorm_type.id}, format='json')
        self.assertEqual(response.status_code, 403, response.data)
        self.assertFalse(Building.objects.filter(number=1, dorm_type=dorm_type).exists())

    def test_region_boss_cannot_create_building_in_other_region(self):
        region = _make_region('BldOwnRegion')
        other_region = _make_region('BldOtherRegion')
        boss = _make_region_boss(region)
        other_dorm_type = DormType.objects.create(name='BldOtherDorm', region=other_region)

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.post(
            '/api/buildings/', {'number': 5, 'dorm_type': other_dorm_type.id}, format='json',
        )
        self.assertEqual(response.status_code, 403, response.data)
        self.assertFalse(Building.objects.filter(number=5, dorm_type=other_dorm_type).exists())

    def test_central_admin_can_create_building_in_any_region(self):
        region = _make_region('BldCentralRegion')
        admin = _make_central_admin()
        dorm_type = DormType.objects.create(name='BldCentralDorm', region=region)

        client = APIClient()
        client.force_authenticate(user=admin)
        response = client.post('/api/buildings/', {'number': 9, 'dorm_type': dorm_type.id}, format='json')
        self.assertEqual(response.status_code, 201, response.data)

    def test_boss_can_edit_building_number(self):
        region = _make_region('BldEditRegion')
        boss = _make_region_boss(region)
        dorm_type = DormType.objects.create(name='BldEditDorm', region=region)
        building = Building.objects.create(number=1, dorm_type=dorm_type)

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.patch(f'/api/buildings/{building.id}/', {'number': 2}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        building.refresh_from_db()
        self.assertEqual(building.number, 2)

    def test_duplicate_building_number_in_same_dorm_type_rejected(self):
        region = _make_region('BldDupRegion')
        boss = _make_region_boss(region)
        dorm_type = DormType.objects.create(name='BldDupDorm', region=region)
        Building.objects.create(number=7, dorm_type=dorm_type)

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.post('/api/buildings/', {'number': 7, 'dorm_type': dorm_type.id}, format='json')
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data.get('code'), 'DUPLICATE_BUILDING_NUMBER')

    def test_building_hard_delete_not_allowed(self):
        region = _make_region('BldDeleteRegion')
        boss = _make_region_boss(region)
        dorm_type = DormType.objects.create(name='BldDeleteDorm', region=region)
        building = Building.objects.create(number=1, dorm_type=dorm_type)

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.delete(f'/api/buildings/{building.id}/')
        self.assertEqual(response.status_code, 405, response.data)
        self.assertTrue(Building.objects.filter(pk=building.id).exists())

    def test_direct_is_active_patch_on_building_is_rejected(self):
        """is_active may only change through the availability workflow, not
        an ordinary PATCH, so it always goes through the impact-warning +
        pending-transfer-request path."""
        region = _make_region('BldDirectActiveRegion')
        boss = _make_region_boss(region)
        dorm_type = DormType.objects.create(name='BldDirectActiveDorm', region=region)
        building = Building.objects.create(number=1, dorm_type=dorm_type, is_active=True)

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.patch(f'/api/buildings/{building.id}/', {'is_active': False}, format='json')
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data.get('code'), 'USE_AVAILABILITY_WORKFLOW')
        building.refresh_from_db()
        self.assertTrue(building.is_active)


# ---------------------------------------------------------------------------
# 2. Building activation/deactivation via the existing what-if availability
#    workflow (reused, not reimplemented) — confirms occupants are
#    preserved and the API surfaces an impact warning before confirming.
# ---------------------------------------------------------------------------
class BuildingAvailabilityWorkflowTest(TestCase):

    def test_simulate_reports_impact_before_deactivation(self):
        region = _make_region('BldSimRegion')
        boss = _make_region_boss(region)
        _dorm_type, building, apartment, room, beds, student = _make_full_stack(region, occupy=True)

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.post('/api/what-if/availability/simulate/', {
            'target_type': 'building', 'target_ids': [building.id],
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['summary']['affected_students_count'], 1)
        self.assertEqual(response.data['summary']['lost_apartments'], 1)
        self.assertEqual(response.data['summary']['lost_rooms'], 1)
        self.assertEqual(response.data['summary']['lost_beds'], len(beds))

    def test_confirm_deactivates_building_and_preserves_occupant_assignment(self):
        region = _make_region('BldConfirmRegion')
        boss = _make_region_boss(region)
        _dorm_type, building, apartment, room, beds, student = _make_full_stack(region, occupy=True)
        assignment = BedAssignment.objects.get(student=student, status=BedAssignment.Status.ACTIVE)

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.post('/api/what-if/availability/confirm/', {
            'target_type': 'building', 'target_ids': [building.id], 'action': 'inactivate',
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)

        building.refresh_from_db()
        self.assertFalse(building.is_active)

        # The occupant is never unassigned or deleted as a side effect.
        assignment.refresh_from_db()
        self.assertEqual(assignment.status, BedAssignment.Status.ACTIVE)
        student.refresh_from_db()
        self.assertEqual(student.assigned_room_id, room.id)

        # A pending transfer request is created for staff to act on later,
        # instead of the student being silently moved. This must be a
        # StudentRequest - the model the actual Transfer Requests /
        # בקשות מעבר page (StudentRequestViewSet, /api/requests/) reads -
        # not the legacy, UI-unreachable MovementRequest model.
        self.assertEqual(
            student.requests.filter(
                status=StudentRequest.Status.PENDING,
                request_type=StudentRequest.RequestType.ROOM,
            ).count(),
            1,
        )

        # It must actually be visible through the real Transfer Requests
        # page endpoint, not just present in the database.
        list_response = client.get('/api/requests/')
        self.assertEqual(list_response.status_code, 200, list_response.data)
        results = list_response.data.get('results', list_response.data)
        matching = [r for r in results if r['student'] == student.id]
        self.assertEqual(len(matching), 1)
        self.assertEqual(matching[0]['status'], 'pending')
        self.assertEqual(matching[0]['current_building'], building.number)

    def test_reactivation_restores_building_without_touching_assignments(self):
        region = _make_region('BldReactivateRegion')
        boss = _make_region_boss(region)
        _dorm_type, building, apartment, room, beds, student = _make_full_stack(region, occupy=True)
        Building.objects.filter(pk=building.id).update(is_active=False)

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.post('/api/what-if/availability/confirm/', {
            'target_type': 'building', 'target_ids': [building.id], 'action': 'reactivate',
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        building.refresh_from_db()
        self.assertTrue(building.is_active)
        self.assertEqual(
            BedAssignment.objects.filter(student=student, status=BedAssignment.Status.ACTIVE).count(), 1,
        )


# ---------------------------------------------------------------------------
# 4, 5, 6, 7. Apartment editing safety rules.
# ---------------------------------------------------------------------------
class ApartmentEditSafetyTest(TestCase):

    def test_category_edit_allowed_when_apartment_empty(self):
        region = _make_region('AptEmptyRegion')
        boss = _make_region_boss(region)
        _dorm_type, _building, apartment, _room, _beds, _student = _make_full_stack(
            region, category=Apartment.Category.MALE, apartment_type=Apartment.ApartmentType.SINGLE, occupy=False,
        )

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.patch(
            f'/api/apartments/{apartment.id}/', {'category': Apartment.Category.FEMALE}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        apartment.refresh_from_db()
        self.assertEqual(apartment.category, Apartment.Category.FEMALE)

    def test_category_edit_blocked_when_active_occupant_conflicts(self):
        region = _make_region('AptConflictRegion')
        boss = _make_region_boss(region)
        _dorm_type, _building, apartment, _room, _beds, student = _make_full_stack(
            region, category=Apartment.Category.FEMALE, apartment_type=Apartment.ApartmentType.SINGLE,
            gender=Student.Gender.FEMALE, housing_type=Student.HousingType.SINGLE_FEMALE, occupy=True,
        )
        assignment = BedAssignment.objects.get(student=student, status=BedAssignment.Status.ACTIVE)

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.patch(
            f'/api/apartments/{apartment.id}/', {'category': Apartment.Category.MALE}, format='json',
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data.get('code'), 'ACTIVE_OCCUPANT_CONFLICT')
        apartment.refresh_from_db()
        self.assertEqual(apartment.category, Apartment.Category.FEMALE)

        # The conflicting edit must never silently unassign the occupant.
        assignment.refresh_from_db()
        self.assertEqual(assignment.status, BedAssignment.Status.ACTIVE)
        student.refresh_from_db()
        self.assertIsNotNone(student.assigned_room_id)

    def test_housing_type_change_blocked_when_occupants_conflict(self):
        region = _make_region('AptHousingRegion')
        boss = _make_region_boss(region)
        _dorm_type, _building, apartment, _room, _beds, student = _make_full_stack(
            region, category=Apartment.Category.FEMALE, apartment_type=Apartment.ApartmentType.SINGLE,
            gender=Student.Gender.FEMALE, housing_type=Student.HousingType.SINGLE_FEMALE, occupy=True,
        )
        assignment = BedAssignment.objects.get(student=student, status=BedAssignment.Status.ACTIVE)

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.patch(
            f'/api/apartments/{apartment.id}/', {'apartment_type': Apartment.ApartmentType.COUPLE}, format='json',
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data.get('code'), 'ACTIVE_OCCUPANT_CONFLICT')
        apartment.refresh_from_db()
        self.assertEqual(apartment.apartment_type, Apartment.ApartmentType.SINGLE)
        assignment.refresh_from_db()
        self.assertEqual(assignment.status, BedAssignment.Status.ACTIVE)

    def test_capacity_cannot_be_reduced_below_current_occupancy(self):
        region = _make_region('AptCapacityRegion')
        boss = _make_region_boss(region)
        _dorm_type, _building, apartment, _room, _beds, _student = _make_full_stack(
            region, capacity=2, occupy=True,
        )

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.patch(
            f'/api/apartments/{apartment.id}/', {'apartment_capacity': 0}, format='json',
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data.get('code'), 'CAPACITY_BELOW_OCCUPANCY')

    def test_capacity_can_be_reduced_to_at_least_current_occupancy(self):
        region = _make_region('AptCapacityOkRegion')
        boss = _make_region_boss(region)
        _dorm_type, _building, apartment, _room, _beds, _student = _make_full_stack(
            region, capacity=2, occupy=True,
        )

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.patch(
            f'/api/apartments/{apartment.id}/', {'apartment_capacity': 1}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)


# ---------------------------------------------------------------------------
# 8, 9. Room creation/editing + deactivation safety.
# ---------------------------------------------------------------------------
class RoomEditSafetyTest(TestCase):

    def test_boss_can_create_room(self):
        region = _make_region('RoomCreateRegion')
        boss = _make_region_boss(region)
        _dorm_type, _building, apartment, _room, _beds, _student = _make_full_stack(region)

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.post(
            '/api/rooms/', {'apartment': apartment.id, 'name': 'B', 'capacity': 2}, format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(Room.objects.filter(apartment=apartment, name='B').exists())

    def test_room_capacity_cannot_be_reduced_below_occupancy(self):
        region = _make_region('RoomCapacityRegion')
        boss = _make_region_boss(region)
        _dorm_type, _building, _apartment, room, _beds, _student = _make_full_stack(
            region, capacity=2, occupy=True,
        )

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.patch(f'/api/rooms/{room.id}/', {'capacity': 0}, format='json')
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data.get('code'), 'CAPACITY_BELOW_OCCUPANCY')

    def test_direct_is_active_patch_on_room_is_rejected(self):
        region = _make_region('RoomDirectActiveRegion')
        boss = _make_region_boss(region)
        _dorm_type, _building, _apartment, room, _beds, _student = _make_full_stack(region)

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.patch(f'/api/rooms/{room.id}/', {'is_active': False}, format='json')
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data.get('code'), 'USE_AVAILABILITY_WORKFLOW')

    def test_room_deactivation_via_availability_workflow_preserves_occupant(self):
        region = _make_region('RoomDeactivateRegion')
        boss = _make_region_boss(region)
        _dorm_type, _building, _apartment, room, _beds, student = _make_full_stack(region, occupy=True)
        assignment = BedAssignment.objects.get(student=student, status=BedAssignment.Status.ACTIVE)

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.post('/api/what-if/availability/confirm/', {
            'target_type': 'room', 'target_ids': [room.id], 'action': 'inactivate',
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)

        room.refresh_from_db()
        self.assertFalse(room.is_active)
        assignment.refresh_from_db()
        self.assertEqual(assignment.status, BedAssignment.Status.ACTIVE)
        student.refresh_from_db()
        self.assertEqual(student.assigned_room_id, room.id)

        self.assertEqual(
            student.requests.filter(
                status=StudentRequest.Status.PENDING,
                request_type=StudentRequest.RequestType.ROOM,
            ).count(),
            1,
        )


# ---------------------------------------------------------------------------
# 10. Bed: no individual activate/deactivate exists — only label editing.
# ---------------------------------------------------------------------------
class BedEditTest(TestCase):

    def test_boss_can_rename_bed_label(self):
        region = _make_region('BedLabelRegion')
        boss = _make_region_boss(region)
        _dorm_type, _building, _apartment, _room, beds, _student = _make_full_stack(region)
        bed = beds[0]

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.patch(f'/api/beds/{bed.id}/', {'label': 'A1'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        bed.refresh_from_db()
        self.assertEqual(bed.label, 'A1')

    def test_bed_has_no_activation_field_and_unsupported_edit_is_rejected(self):
        """The Bed model has no is_active field at all — attempting to send
        one through the edit endpoint must be rejected explicitly rather
        than silently ignored or fabricated."""
        region = _make_region('BedNoActiveRegion')
        boss = _make_region_boss(region)
        _dorm_type, _building, _apartment, _room, beds, _student = _make_full_stack(region)
        bed = beds[0]

        self.assertFalse(hasattr(Bed, 'is_active'))

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.patch(f'/api/beds/{bed.id}/', {'is_active': False}, format='json')
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data.get('code'), 'FIELD_NOT_EDITABLE')

    def test_employee_cannot_edit_bed_label(self):
        region = _make_region('BedEmpRegion')
        employee = _make_employee(region)
        _dorm_type, _building, _apartment, _room, beds, _student = _make_full_stack(region)
        bed = beds[0]

        client = APIClient()
        client.force_authenticate(user=employee)
        response = client.patch(f'/api/beds/{bed.id}/', {'label': 'Z'}, format='json')
        self.assertEqual(response.status_code, 403, response.data)


# ---------------------------------------------------------------------------
# 11. No inventory edit silently deletes a BedAssignment (cross-cutting
#     check across the endpoints exercised above).
# ---------------------------------------------------------------------------
class NoSilentAssignmentDeletionTest(TestCase):

    def test_rejected_and_accepted_apartment_edits_never_change_assignment_count(self):
        region = _make_region('NoDeleteRegion')
        boss = _make_region_boss(region)
        _dorm_type, _building, apartment, _room, _beds, student = _make_full_stack(
            region, category=Apartment.Category.FEMALE, apartment_type=Apartment.ApartmentType.SINGLE,
            gender=Student.Gender.FEMALE, housing_type=Student.HousingType.SINGLE_FEMALE, occupy=True,
        )
        before_count = BedAssignment.objects.filter(status=BedAssignment.Status.ACTIVE).count()
        self.assertEqual(before_count, 1)

        client = APIClient()
        client.force_authenticate(user=boss)

        # Rejected edit (conflicting category change).
        rejected = client.patch(
            f'/api/apartments/{apartment.id}/', {'category': Apartment.Category.MALE}, format='json',
        )
        self.assertEqual(rejected.status_code, 400, rejected.data)
        self.assertEqual(
            BedAssignment.objects.filter(status=BedAssignment.Status.ACTIVE).count(), before_count,
        )

        # Accepted, non-conflicting edit (capacity increase).
        accepted = client.patch(
            f'/api/apartments/{apartment.id}/', {'apartment_capacity': 5}, format='json',
        )
        self.assertEqual(accepted.status_code, 200, accepted.data)
        self.assertEqual(
            BedAssignment.objects.filter(status=BedAssignment.Status.ACTIVE).count(), before_count,
        )


# ---------------------------------------------------------------------------
# 12. Deactivating a Building/Apartment/Room must never make a currently
#     assigned student disappear: the BedAssignment is untouched and a
#     pending StudentRequest (the model the real Transfer Requests /
#     בקשות מעבר page reads - see StudentRequestViewSet, /api/requests/) is
#     created for every affected active assignment. This must be
#     idempotent across overlapping hierarchy levels, atomic, and remain
#     visible even once the source inventory is inactive.
# ---------------------------------------------------------------------------
class DeactivationTransferRequestTest(TestCase):

    def _make_room_with_occupant(self, dorm_type, building, apartment, room_name, number_suffix):
        room = Room.objects.create(apartment=apartment, name=room_name, capacity=1)
        bed = Bed.objects.create(room=room, label='1')
        student = Student.objects.create(
            student_id=f'DEACT_{number_suffix}', first_name='S', last_name=str(number_suffix),
            gender=Student.Gender.MALE, housing_type=Student.HousingType.SINGLE_MALE,
            accepted_dorm_type=dorm_type, assigned_room=room,
        )
        assignment = BedAssignment.objects.create(
            student=student, bed=bed, status=BedAssignment.Status.ACTIVE,
            assignment_type=BedAssignment.AssignmentType.INITIAL,
        )
        return room, bed, student, assignment

    # TEST 1
    def test_deactivate_empty_building_creates_no_requests(self):
        region = _make_region('EmptyBldRegion')
        boss = _make_region_boss(region)
        _dorm_type, building, _apartment, _room, _beds, _student = _make_full_stack(region, occupy=False)

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.post('/api/what-if/availability/confirm/', {
            'target_type': 'building', 'target_ids': [building.id], 'action': 'inactivate',
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['created_requests'], 0)

        building.refresh_from_db()
        self.assertFalse(building.is_active)
        self.assertEqual(StudentRequest.objects.count(), 0)

    # TEST 2
    def test_deactivate_building_with_three_occupants_creates_three_requests(self):
        region = _make_region('ThreeOccRegion')
        boss = _make_region_boss(region)
        dorm_type = DormType.objects.create(name='ThreeOccDorm', region=region)
        building = Building.objects.create(number=200, dorm_type=dorm_type)
        apartment = Apartment.objects.create(
            building=building, number='1', category=Apartment.Category.MIXED,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=3, apartment_capacity=3,
        )
        assignments, students = [], []
        for i in range(3):
            _room, _bed, student, assignment = self._make_room_with_occupant(
                dorm_type, building, apartment, f'R{i}', i,
            )
            assignments.append(assignment)
            students.append(student)

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.post('/api/what-if/availability/confirm/', {
            'target_type': 'building', 'target_ids': [building.id], 'action': 'inactivate',
            'reason': 'maintenance',
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['created_requests'], 3)

        building.refresh_from_db()
        self.assertFalse(building.is_active)

        for assignment in assignments:
            assignment.refresh_from_db()
            self.assertEqual(assignment.status, BedAssignment.Status.ACTIVE)

        self.assertEqual(
            StudentRequest.objects.filter(status=StudentRequest.Status.PENDING).count(), 3,
        )
        for student in students:
            self.assertEqual(student.requests.filter(status=StudentRequest.Status.PENDING).count(), 1)

    # TEST 3
    def test_deactivate_apartment_with_occupant_creates_request(self):
        region = _make_region('AptOccRegion')
        boss = _make_region_boss(region)
        _dorm_type, _building, apartment, room, _beds, student = _make_full_stack(region, occupy=True)
        assignment = BedAssignment.objects.get(student=student, status=BedAssignment.Status.ACTIVE)

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.post('/api/what-if/availability/confirm/', {
            'target_type': 'apartment', 'target_ids': [apartment.id], 'action': 'inactivate',
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['created_requests'], 1)

        apartment.refresh_from_db()
        self.assertFalse(apartment.is_active)
        assignment.refresh_from_db()
        self.assertEqual(assignment.status, BedAssignment.Status.ACTIVE)
        student.refresh_from_db()
        self.assertEqual(student.assigned_room_id, room.id)
        self.assertEqual(student.requests.filter(status=StudentRequest.Status.PENDING).count(), 1)

    # TEST 4
    def test_deactivate_room_with_occupant_creates_request(self):
        region = _make_region('RoomOccRegion')
        boss = _make_region_boss(region)
        _dorm_type, _building, _apartment, room, _beds, student = _make_full_stack(region, occupy=True)
        assignment = BedAssignment.objects.get(student=student, status=BedAssignment.Status.ACTIVE)

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.post('/api/what-if/availability/confirm/', {
            'target_type': 'room', 'target_ids': [room.id], 'action': 'inactivate',
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['created_requests'], 1)

        assignment.refresh_from_db()
        self.assertEqual(assignment.status, BedAssignment.Status.ACTIVE)
        self.assertEqual(student.requests.filter(status=StudentRequest.Status.PENDING).count(), 1)

    # TEST 5 (documents current backend capability rather than faking one)
    def test_bed_level_deactivation_is_not_a_supported_target_type(self):
        """
        Individual-bed deactivation does not exist anywhere in the current
        backend: Bed has no is_active field at all (see
        BedEditTest.test_bed_has_no_activation_field_and_unsupported_edit_is_rejected),
        and the generic availability endpoint explicitly rejects
        target_type='bed' with a 400 rather than silently accepting a
        capability that was never implemented.
        """
        region = _make_region('BedTargetRegion')
        boss = _make_region_boss(region)
        _dorm_type, _building, _apartment, _room, beds, _student = _make_full_stack(region)

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.post('/api/what-if/availability/confirm/', {
            'target_type': 'bed', 'target_ids': [beds[0].id], 'action': 'inactivate',
        }, format='json')
        self.assertEqual(response.status_code, 400, response.data)

    # TEST 6
    def test_duplicate_protection_no_second_request_for_same_student(self):
        """Room deactivated first (creates a pending request); the parent
        Building deactivated afterwards must not create a second one for
        the same student, since both concern the same current assignment."""
        region = _make_region('DupRegion')
        boss = _make_region_boss(region)
        _dorm_type, building, _apartment, room, _beds, student = _make_full_stack(region, occupy=True)

        client = APIClient()
        client.force_authenticate(user=boss)

        first = client.post('/api/what-if/availability/confirm/', {
            'target_type': 'room', 'target_ids': [room.id], 'action': 'inactivate',
        }, format='json')
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(first.data['created_requests'], 1)

        second = client.post('/api/what-if/availability/confirm/', {
            'target_type': 'building', 'target_ids': [building.id], 'action': 'inactivate',
        }, format='json')
        self.assertEqual(second.status_code, 200, second.data)
        self.assertEqual(second.data['created_requests'], 0)
        self.assertEqual(second.data['skipped_existing_requests'], 1)

        self.assertEqual(
            StudentRequest.objects.filter(student=student, status=StudentRequest.Status.PENDING).count(), 1,
        )

    # TEST 7
    def test_multiple_occupants_one_request_per_affected_assignment(self):
        region = _make_region('MultiOccRegion')
        boss = _make_region_boss(region)
        dorm_type = DormType.objects.create(name='MultiOccDorm', region=region)
        building = Building.objects.create(number=201, dorm_type=dorm_type)
        apartment = Apartment.objects.create(
            building=building, number='1', category=Apartment.Category.MIXED,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=1, apartment_capacity=2,
        )
        room = Room.objects.create(apartment=apartment, name='A', capacity=2)
        beds = [Bed.objects.create(room=room, label=str(i + 1)) for i in range(2)]
        students = []
        for i in range(2):
            student = Student.objects.create(
                student_id=f'MULTI_{i}', first_name='S', last_name=str(i),
                gender=Student.Gender.MALE, housing_type=Student.HousingType.SINGLE_MALE,
                accepted_dorm_type=dorm_type, assigned_room=room,
            )
            BedAssignment.objects.create(
                student=student, bed=beds[i], status=BedAssignment.Status.ACTIVE,
                assignment_type=BedAssignment.AssignmentType.INITIAL,
            )
            students.append(student)

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.post('/api/what-if/availability/confirm/', {
            'target_type': 'building', 'target_ids': [building.id], 'action': 'inactivate',
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['created_requests'], 2)

        for student in students:
            self.assertEqual(student.requests.filter(status=StudentRequest.Status.PENDING).count(), 1)

    # TEST 8
    def test_failure_during_request_creation_rolls_back_deactivation(self):
        region = _make_region('RollbackRegion')
        boss = _make_region_boss(region)
        _dorm_type, building, _apartment, _room, _beds, student = _make_full_stack(region, occupy=True)

        client = APIClient()
        client.force_authenticate(user=boss)

        with patch('api.views.StudentRequest.objects.create', side_effect=RuntimeError('boom')):
            response = client.post('/api/what-if/availability/confirm/', {
                'target_type': 'building', 'target_ids': [building.id], 'action': 'inactivate',
            }, format='json')

        self.assertEqual(response.status_code, 500, response.data)

        building.refresh_from_db()
        self.assertTrue(building.is_active)
        self.assertEqual(StudentRequest.objects.filter(student=student).count(), 0)
        self.assertEqual(
            BedAssignment.objects.filter(student=student, status=BedAssignment.Status.ACTIVE).count(), 1,
        )

    # TEST 9
    def test_transfer_requests_endpoint_returns_requests_with_inactive_source(self):
        region = _make_region('VisibleRegion')
        boss = _make_region_boss(region)
        _dorm_type, building, apartment, room, _beds, student = _make_full_stack(region, occupy=True)

        client = APIClient()
        client.force_authenticate(user=boss)
        # Deactivate the room itself (not just an ancestor) so its own
        # is_active flag - the literal "source inventory is inactive"
        # case - is what the Transfer Requests listing has to tolerate.
        confirm = client.post('/api/what-if/availability/confirm/', {
            'target_type': 'room', 'target_ids': [room.id], 'action': 'inactivate',
            'reason': 'maintenance',
        }, format='json')
        self.assertEqual(confirm.status_code, 200, confirm.data)

        room.refresh_from_db()
        self.assertFalse(room.is_active)

        listing = client.get('/api/requests/')
        self.assertEqual(listing.status_code, 200, listing.data)
        results = listing.data.get('results', listing.data)
        matching = [r for r in results if r['student'] == student.id]
        self.assertEqual(len(matching), 1)
        self.assertEqual(matching[0]['status'], 'pending')
        self.assertEqual(matching[0]['reason'], 'maintenance')
        self.assertEqual(matching[0]['current_building'], building.number)
        self.assertEqual(matching[0]['current_apartment'], apartment.number)
        self.assertEqual(matching[0]['current_room'], room.name)

    # TEST 10
    def test_inactive_inventory_cannot_be_used_for_new_allocation(self):
        region = _make_region('NoNewAllocRegion')
        boss = _make_region_boss(region)
        _dorm_type, building, _apartment, room, _beds, _student = _make_full_stack(region, occupy=False)

        self.assertIsNotNone(get_free_bed(room))

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.post('/api/what-if/availability/confirm/', {
            'target_type': 'building', 'target_ids': [building.id], 'action': 'inactivate',
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)

        room.refresh_from_db()
        self.assertIsNone(get_free_bed(room))
