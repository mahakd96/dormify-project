"""
Tests for the /api/analysis/ endpoint, focused on the fields added for the
unified analytics page (pending_requests, priority_unassigned_students,
latest_batch) and on role/region scoping.

Run against Django's disposable TEST database (created and destroyed
automatically as test_<DB_NAME> on the same Postgres server - this never
touches the real `dormify` database or its data):

    docker exec dormify_backend python manage.py test api.tests.test_analysis
"""

from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework import status

from api.models import (
    User, Region, DormType, Building, Apartment, Room,
    Student, ImportBatch, RegionInbox, StudentRequest,
)


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
    return building, apartment, room


def _make_student(student_id, gender, housing_type, dorm_type, **extra):
    return Student.objects.create(
        student_id=student_id, first_name='F', last_name='L',
        gender=gender, housing_type=housing_type, accepted_dorm_type=dorm_type,
        **extra,
    )


class AnalysisEmptyStateTests(TestCase):
    def setUp(self):
        self.admin = _make_user('admin@test.com', User.Role.CENTRAL_ADMIN)
        self.client = APIClient()

    def test_unauthenticated_access_rejected(self):
        resp = self.client.get('/api/analysis/')
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_central_admin_empty_database_returns_zeroes_without_crashing(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get('/api/analysis/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        data = resp.json()

        summary = data['summary']
        self.assertEqual(summary['total_students'], 0)
        self.assertEqual(summary['assigned_students'], 0)
        self.assertEqual(summary['unassigned_students'], 0)
        self.assertEqual(summary['occupancy_rate'], 0)
        self.assertEqual(summary['pending_requests'], 0)
        self.assertEqual(summary['priority_unassigned_students'], 0)
        self.assertEqual(data['occupancy_data'], [])
        self.assertIsNone(data['latest_batch'])
        self.assertIsNone(data['latest_run'])

    def test_employee_without_region_rejected(self):
        employee = _make_user('noregion@test.com', User.Role.EMPLOYEE, region=None)
        self.client.force_authenticate(employee)
        resp = self.client.get('/api/analysis/')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


class AnalysisScopingTests(TestCase):
    def setUp(self):
        self.region_a = Region.objects.create(id='canada', name='Canada')
        self.region_b = Region.objects.create(id='mizrah', name='Mizrah')

        self.dorm_a = _make_dorm_type(self.region_a, code=1)
        self.dorm_b = _make_dorm_type(self.region_b, code=2)

        self.building_a, _, self.room_a = _make_room(self.dorm_a, 1, '1', Apartment.Category.MALE)
        self.building_b, _, self.room_b = _make_room(self.dorm_b, 2, '1', Apartment.Category.MALE)

        self.admin = _make_user('admin@test.com', User.Role.CENTRAL_ADMIN)
        self.boss_a = _make_user('bossa@test.com', User.Role.REGION_BOSS, self.region_a)
        self.employee_a = _make_user('empa@test.com', User.Role.EMPLOYEE, self.region_a)

        # Region A: one priority student, unassigned.
        self.priority_student_a = _make_student(
            'A1', Student.Gender.MALE, Student.HousingType.SINGLE_MALE, self.dorm_a,
            is_priority=True,
        )
        # Region B: one ordinary student - must never leak into region A's counts.
        _make_student('B1', Student.Gender.MALE, Student.HousingType.SINGLE_MALE, self.dorm_b)

        self.client = APIClient()

    def test_region_boss_sees_only_own_region(self):
        self.client.force_authenticate(self.boss_a)
        resp = self.client.get('/api/analysis/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        data = resp.json()

        self.assertEqual(data['summary']['total_students'], 1)
        self.assertEqual(data['summary']['priority_unassigned_students'], 1)
        self.assertEqual(data['region']['id'], 'canada')
        building_names = [b['region'] for b in data['occupancy_data']]
        self.assertTrue(all(name == 'Canada' for name in building_names))

    def test_region_boss_cannot_escape_scope_via_query_param(self):
        # A boss passing ?region=mizrah must still only see their own region -
        # the query param is silently ignored for non-admins, never trusted.
        self.client.force_authenticate(self.boss_a)
        resp = self.client.get('/api/analysis/', {'region': 'mizrah'})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        data = resp.json()

        self.assertEqual(data['region']['id'], 'canada')
        self.assertEqual(data['summary']['total_students'], 1)

    def test_employee_sees_same_region_scoping_as_boss(self):
        self.client.force_authenticate(self.employee_a)
        resp = self.client.get('/api/analysis/')
        data = resp.json()

        self.assertEqual(data['summary']['total_students'], 1)
        self.assertEqual(data['region']['id'], 'canada')

    def test_central_admin_sees_system_wide_by_default(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get('/api/analysis/')
        data = resp.json()

        self.assertIsNone(data['region'])
        self.assertEqual(data['summary']['total_students'], 2)
        self.assertEqual(data['summary']['priority_unassigned_students'], 1)

    def test_central_admin_can_filter_to_one_region(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get('/api/analysis/', {'region': 'mizrah'})
        data = resp.json()

        self.assertEqual(data['region']['id'], 'mizrah')
        self.assertEqual(data['summary']['total_students'], 1)
        self.assertEqual(data['summary']['priority_unassigned_students'], 0)

    def test_central_admin_invalid_region_returns_404(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get('/api/analysis/', {'region': 'does-not-exist'})
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)


class AnalysisPendingRequestsAndBatchTests(TestCase):
    def setUp(self):
        self.region = Region.objects.create(id='canada', name='Canada')
        self.dorm_type = _make_dorm_type(self.region, code=1)
        self.admin = _make_user('admin@test.com', User.Role.CENTRAL_ADMIN)
        self.boss = _make_user('boss@test.com', User.Role.REGION_BOSS, self.region)
        self.client = APIClient()

    def test_pending_requests_scoped_like_transfers_page(self):
        StudentRequest.objects.create(
            request_type=StudentRequest.RequestType.OTHER,
            reason='General question',
            requested_by=self.boss,
        )
        self.client.force_authenticate(self.boss)
        resp = self.client.get('/api/analysis/')
        data = resp.json()
        self.assertEqual(data['summary']['pending_requests'], 1)

    def test_latest_batch_reflects_region_inbox_for_region_scoped_user(self):
        batch = ImportBatch.objects.create(
            uploaded_by=self.admin, filename='students.xlsx', total_students=10,
            status=ImportBatch.Status.COMPLETED,
        )
        RegionInbox.objects.create(
            region=self.region, batch=batch, students_count=10,
            status=RegionInbox.Status.PENDING,
        )
        self.client.force_authenticate(self.boss)
        resp = self.client.get('/api/analysis/')
        data = resp.json()
        self.assertIsNotNone(data['latest_batch'])
        self.assertEqual(data['latest_batch']['filename'], 'students.xlsx')

    def test_latest_batch_none_for_admin_when_no_batches_uploaded(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get('/api/analysis/')
        data = resp.json()
        self.assertIsNone(data['latest_batch'])