"""
Tests for the /api/requests/ (StudentRequest) workflow, the bed matching
engine, and direct room-assignment endpoints.

Run against Django's disposable TEST database (created and destroyed
automatically as test_<DB_NAME> on the same Postgres server - this never
touches the real `dormify` database or its data):

    docker exec dormify_backend python manage.py test api.tests.test_requests
"""

from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework import status

from api.models import (
    User, Region, DormType, Building, Apartment, Room,
    Student, BedAssignment, StudentRequest,
)
from api.tests.matching_test_utils import create_beds_for_room, flatten_bed_options


def _make_user(email, role, region=None):
    user = User(email=email, username=email, role=role, region=region,
                first_name='T', last_name='User')
    user.set_password('testpass123')
    user.save()
    return user


def _make_dorm_type(region, code, name=None):
    return DormType.objects.create(code=code, name=name or f'DT{code}', region=region)


def _make_room(dorm_type, building_number, apartment_number, category,
                apartment_type=Apartment.ApartmentType.SINGLE, room_capacity=2):
    building = Building.objects.create(number=building_number, dorm_type=dorm_type)
    apartment = Apartment.objects.create(
        building=building, number=apartment_number, category=category,
        apartment_type=apartment_type, room_count=1,
    )
    room = Room.objects.create(apartment=apartment, name='101', capacity=room_capacity)
    # Matching is read-only over real Bed rows - fixtures materialize them
    # explicitly, like a properly initialized production database.
    create_beds_for_room(room)
    return building, apartment, room


def _make_student(student_id, gender, housing_type, dorm_type, **extra):
    return Student.objects.create(
        student_id=student_id, first_name='F', last_name='L',
        gender=gender, housing_type=housing_type, accepted_dorm_type=dorm_type,
        **extra,
    )


class StudentRequestApiTests(TestCase):
    def setUp(self):
        self.region = Region.objects.create(id='canada', name='Canada')
        self.dorm_type = _make_dorm_type(self.region, code=1)
        self.building, self.apartment, self.room = _make_room(
            self.dorm_type, 1, '1', Apartment.Category.MALE
        )

        self.other_region = Region.objects.create(id='other', name='Other')

        self.admin = _make_user('admin@test.com', User.Role.CENTRAL_ADMIN)
        self.boss = _make_user('boss@test.com', User.Role.REGION_BOSS, self.region)
        self.other_boss = _make_user('otherboss@test.com', User.Role.REGION_BOSS, self.other_region)

        self.student = _make_student(
            'S1', Student.Gender.MALE, Student.HousingType.SINGLE_MALE, self.dorm_type
        )

        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _assign(self, student, room, expect_status=200):
        resp = self.client.post('/api/room-assignments/assign/', {
            'student_id': student.id, 'room_id': room.id,
        }, format='json')
        self.assertEqual(resp.status_code, expect_status, resp.content)
        return resp

    # 1. Request creation succeeds and returns JSON.
    def test_create_room_request_returns_json(self):
        resp = self.client.post('/api/requests/', {
            'student': self.student.id, 'request_type': 'room', 'reason': 'Wants to move',
        }, format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)
        self.assertEqual(resp.data['request_type'], 'room')
        self.assertEqual(resp.data['status'], 'pending')
        self.assertTrue(resp.data['request_number'])
        self.assertEqual(StudentRequest.objects.count(), 1)

    # 2. Invalid request creation returns useful JSON errors, not an empty body.
    def test_create_room_request_without_student_returns_field_errors(self):
        resp = self.client.post('/api/requests/', {
            'request_type': 'room', 'reason': 'no student attached',
        }, format='json')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('student', resp.data)

    def test_create_add_student_request_missing_fields_returns_field_errors(self):
        resp = self.client.post('/api/requests/', {
            'request_type': 'add_student', 'reason': 'new student',
            'student_data': {'student_id': 'X1'},  # missing first/last name/gender
        }, format='json')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('student_data', resp.data)

    # 3. A request is real backend state (not device-local): a brand new,
    # independently-authenticated client sees it immediately after creation -
    # i.e. "log out, log in again" cannot make it disappear.
    def test_request_visible_from_a_fresh_authenticated_session(self):
        StudentRequest.objects.create(
            student=self.student, request_type='room', reason='r',
            requested_by=self.admin, request_number='REQ-000001',
        )
        fresh_client = APIClient()
        fresh_client.force_authenticate(self.admin)
        resp = fresh_client.get('/api/requests/')
        self.assertEqual(resp.status_code, 200)
        data = resp.data if isinstance(resp.data, list) else resp.data.get('results', [])
        self.assertEqual(len(data), 1)

    # 5. An unassigned student receives valid matching bed options.
    def test_match_options_for_unassigned_student(self):
        resp = self.client.post('/api/requests/match-options/', {
            'student_id': self.student.id,
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data['feasible'])
        options = flatten_bed_options(resp.data)
        self.assertEqual(options[0]['room_id'], self.room.id)
        # The hierarchy carries the complete location context for every bed.
        building = resp.data['buildings'][0]
        self.assertEqual(building['building_id'], self.building.id)
        self.assertEqual(building['region_name'], self.region.name)

    # 6. An assigned student receives valid reassignment options (current room excluded).
    def test_match_options_for_assigned_student_excludes_current_room(self):
        self._assign(self.student, self.room)
        _, _, room2 = _make_room(self.dorm_type, 2, '2', Apartment.Category.MALE)

        resp = self.client.post('/api/requests/match-options/', {
            'student_id': self.student.id,
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        room_ids = [o['room_id'] for o in flatten_bed_options(resp.data)]
        self.assertNotIn(self.room.id, room_ids)
        self.assertIn(room2.id, room_ids)

    # 7. Hard-constraint violations (gender mismatch) are excluded, never shown.
    def test_match_options_excludes_gender_mismatch(self):
        _, _, female_room = _make_room(self.dorm_type, 3, 'F1', Apartment.Category.FEMALE)

        resp = self.client.post('/api/requests/match-options/', {
            'student_id': self.student.id,
        }, format='json')
        room_ids = [o['room_id'] for o in flatten_bed_options(resp.data)]
        self.assertNotIn(female_room.id, room_ids)

    # 8. An occupied bed cannot be assigned again.
    def test_cannot_assign_already_occupied_bed(self):
        student_b = _make_student(
            'S2', Student.Gender.MALE, Student.HousingType.SINGLE_MALE, self.dorm_type
        )
        self._assign(self.student, self.room)
        self._assign(student_b, self.room)  # room capacity is 2 - now full

        student_c = _make_student(
            'S3', Student.Gender.MALE, Student.HousingType.SINGLE_MALE, self.dorm_type
        )
        resp = self.client.post('/api/room-assignments/assign/', {
            'student_id': student_c.id, 'room_id': self.room.id,
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(
            BedAssignment.objects.filter(bed__room=self.room, status='active').count(), 2
        )

    # 9. Reassignment does not lose the original assignment if the new one fails.
    def test_reassignment_keeps_original_if_new_room_full(self):
        self._assign(self.student, self.room)

        _, _, full_room = _make_room(self.dorm_type, 4, 'F2', Apartment.Category.MALE, room_capacity=1)
        blocker = _make_student(
            'S4', Student.Gender.MALE, Student.HousingType.SINGLE_MALE, self.dorm_type
        )
        self._assign(blocker, full_room)

        resp = self.client.post('/api/room-assignments/move/', {
            'student_id': self.student.id, 'room_id': full_room.id,
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertTrue(
            BedAssignment.objects.filter(
                student=self.student, bed__room=self.room, status='active'
            ).exists(),
            'original assignment must survive a failed reassignment',
        )

    # 10. Regional users cannot see or act on other regions' requests.
    def test_boss_cannot_see_or_approve_other_region_requests(self):
        other_dorm_type = _make_dorm_type(self.other_region, code=2)
        _, _, other_room = _make_room(other_dorm_type, 1, '1', Apartment.Category.MALE)
        other_student = _make_student(
            'S5', Student.Gender.MALE, Student.HousingType.SINGLE_MALE, other_dorm_type
        )
        req = StudentRequest.objects.create(
            student=other_student, request_type='room', reason='r',
            requested_by=self.other_boss, request_number='REQ-000002',
        )

        client = APIClient()
        client.force_authenticate(self.boss)

        resp = client.get('/api/requests/')
        data = resp.data if isinstance(resp.data, list) else resp.data['results']
        self.assertNotIn(req.id, [r['id'] for r in data])

        resp2 = client.put(f'/api/requests/{req.id}/approve/', {}, format='json')
        self.assertIn(resp2.status_code, (403, 404))

    # Approve/reject transition StudentRequest status and actually mutate assignments.
    def test_approve_room_request_moves_student_and_ends_old_assignment(self):
        self._assign(self.student, self.room)
        _, _, room2 = _make_room(self.dorm_type, 5, '5', Apartment.Category.MALE)

        req = StudentRequest.objects.create(
            student=self.student, request_type='room', reason='r',
            requested_by=self.admin, request_number='REQ-000003',
        )

        self.client.force_authenticate(self.boss)
        resp = self.client.put(f'/api/requests/{req.id}/approve/', {
            'target_room': room2.id,
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)

        req.refresh_from_db()
        self.assertEqual(req.status, 'approved')
        self.assertTrue(
            BedAssignment.objects.filter(student=self.student, bed__room=room2, status='active').exists()
        )
        self.assertFalse(
            BedAssignment.objects.filter(student=self.student, bed__room=self.room, status='active').exists()
        )

    def test_reject_request_sets_rejection_reason(self):
        req = StudentRequest.objects.create(
            student=self.student, request_type='other', reason='r', other_description='desc',
            requested_by=self.admin, request_number='REQ-000004',
        )
        self.client.force_authenticate(self.boss)
        resp = self.client.put(f'/api/requests/{req.id}/reject/', {'reason': 'not needed'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        req.refresh_from_db()
        self.assertEqual(req.status, 'rejected')
        self.assertEqual(req.rejection_reason, 'not needed')
