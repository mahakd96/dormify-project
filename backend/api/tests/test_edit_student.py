"""
Tests for Edit Student (PATCH /api/students/{id}/) validation and the
match-options "single blocking error" behavior for students missing
housing_type/region.

Covers the housing-type/region assignment-eligibility bug: a student with
housing_type='' (e.g. real Azure student pk=26203, category=leaving) must
never reach the room-scanning loop and get the same "no supported housing
type" conflict repeated on every candidate room - instead match-options
returns one clear (blocking_field, reason) pair.

Run against Django's disposable TEST database (created/destroyed as
test_<DB_NAME> - never touches the real `dormify` database):

    docker exec dormify_backend python manage.py test api.tests.test_edit_student
"""

from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework import status

from api.models import User, Region, DormType, Building, Apartment, Room, Student


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
    from api.tests.matching_test_utils import create_beds_for_room
    create_beds_for_room(room)
    return building, apartment, room


class EditStudentValidationTests(TestCase):
    def setUp(self):
        self.region_a = Region.objects.create(id='canada', name='Canada')
        self.region_b = Region.objects.create(id='mizrah', name='Mizrah')
        self.dorm_type_a = _make_dorm_type(self.region_a, code=1)
        self.dorm_type_b = _make_dorm_type(self.region_b, code=2)

        self.admin = _make_user('admin@test.com', User.Role.CENTRAL_ADMIN)
        self.boss_a = _make_user('bossa@test.com', User.Role.REGION_BOSS, self.region_a)

        # A student that reproduces the real bug: category is not 'leaving'
        # (so housing_type/region ARE required), but both are missing -
        # exactly the shape that used to produce a repeated per-room
        # "no supported housing type" conflict.
        self.broken_student = Student.objects.create(
            student_id='BROKEN1', first_name='Missing', last_name='Data',
            gender='female', category=Student.StudentCategory.CONTINUING,
            housing_type='', accepted_dorm_type=None,
        )

        self.valid_student = Student.objects.create(
            student_id='VALID1', first_name='Valid', last_name='Student',
            gender='male', category=Student.StudentCategory.CONTINUING,
            housing_type=Student.HousingType.SINGLE_MALE,
            accepted_dorm_type=self.dorm_type_a,
        )

    # Blank housing_type is rejected on Edit for an assignable student.
    def test_blank_housing_type_rejected_on_edit(self):
        client = APIClient()
        client.force_authenticate(self.admin)
        resp = client.patch(
            f'/api/students/{self.broken_student.id}/',
            {'accepted_dorm_type': self.dorm_type_a.id}, format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('housing_type', resp.data)

    # Missing region produces a clear field error on Edit.
    def test_missing_region_rejected_on_edit(self):
        client = APIClient()
        client.force_authenticate(self.admin)
        resp = client.patch(
            f'/api/students/{self.broken_student.id}/',
            {'housing_type': Student.HousingType.SINGLE_FEMALE}, format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('accepted_dorm_type', resp.data)

    # The assignment picker (match-options) returns one student-level
    # blocking error instead of a repeated per-room conflict.
    def test_match_options_returns_single_blocking_error_for_missing_housing_type(self):
        client = APIClient()
        client.force_authenticate(self.admin)
        resp = client.post(
            '/api/requests/match-options/',
            {'student_id': self.broken_student.id}, format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data['feasible'])
        self.assertEqual(resp.data.get('blocking_field'), 'housing_type')
        self.assertEqual(resp.data['buildings'], [])
        # No per-room conflict list generated at all - the whole point is to
        # avoid scanning rooms once a student-level blocker is found.
        self.assertEqual(resp.data.get('conflict_examples'), [])

    # After valid housing_type and region are saved via Edit Student,
    # matching options are returned (the exact "fix the record" flow).
    def test_matching_options_returned_after_fixing_housing_type_and_region(self):
        _make_room(self.dorm_type_a, 1, '1', Apartment.Category.FEMALE)

        client = APIClient()
        client.force_authenticate(self.admin)
        resp = client.patch(
            f'/api/students/{self.broken_student.id}/',
            {
                'housing_type': Student.HousingType.SINGLE_FEMALE,
                'accepted_dorm_type': self.dorm_type_a.id,
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)

        match_resp = client.post(
            '/api/requests/match-options/',
            {'student_id': self.broken_student.id}, format='json',
        )
        self.assertEqual(match_resp.status_code, 200)
        self.assertTrue(match_resp.data['feasible'])
        self.assertGreater(match_resp.data['total_valid'], 0)
        self.assertNotIn('blocking_field', match_resp.data)

    # A regional employee cannot move a student to another region via Edit.
    def test_regional_employee_cannot_change_student_region(self):
        client = APIClient()
        client.force_authenticate(self.boss_a)
        resp = client.patch(
            f'/api/students/{self.valid_student.id}/',
            {'accepted_dorm_type': self.dorm_type_b.id}, format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.valid_student.refresh_from_db()
        self.assertEqual(self.valid_student.accepted_dorm_type_id, self.dorm_type_a.id)

    # A central admin can freely select any valid region on Edit.
    def test_central_admin_can_select_valid_region(self):
        client = APIClient()
        client.force_authenticate(self.admin)
        resp = client.patch(
            f'/api/students/{self.valid_student.id}/',
            {'accepted_dorm_type': self.dorm_type_b.id}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.valid_student.refresh_from_db()
        self.assertEqual(self.valid_student.accepted_dorm_type_id, self.dorm_type_b.id)

    # Existing valid students are unaffected - editing an unrelated field
    # (e.g. phone) on an already-complete student still succeeds.
    def test_existing_valid_student_unaffected_by_unrelated_edit(self):
        client = APIClient()
        client.force_authenticate(self.admin)
        resp = client.patch(
            f'/api/students/{self.valid_student.id}/',
            {'phone': '0501234567'}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.valid_student.refresh_from_db()
        self.assertEqual(self.valid_student.phone, '0501234567')
        self.assertEqual(self.valid_student.housing_type, Student.HousingType.SINGLE_MALE)
        self.assertEqual(self.valid_student.accepted_dorm_type_id, self.dorm_type_a.id)

    # A leaving-category student is exempt from the housing_type/region
    # requirement, and match-options reports a clear (non-room) reason.
    def test_leaving_student_exempt_and_blocked_on_category_not_housing_type(self):
        leaver = Student.objects.create(
            student_id='LEAVER1', first_name='Leaving', last_name='Person',
            gender='female', category=Student.StudentCategory.LEAVING,
            housing_type='', accepted_dorm_type=None,
        )
        client = APIClient()
        client.force_authenticate(self.admin)

        # Editing an unrelated field on a leaving student does not demand
        # housing_type/region.
        resp = client.patch(f'/api/students/{leaver.id}/', {'phone': '050'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)

        match_resp = client.post(
            '/api/requests/match-options/', {'student_id': leaver.id}, format='json',
        )
        self.assertEqual(match_resp.status_code, 200)
        self.assertFalse(match_resp.data['feasible'])
        self.assertEqual(match_resp.data.get('blocking_field'), 'category')
