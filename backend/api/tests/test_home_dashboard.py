"""
Tests for the /api/home/ operational homepage endpoint.

Run against Django's disposable TEST database (created and destroyed
automatically as test_<DB_NAME> on the same Postgres server - this never
touches the real `dormify` database or its data):

    docker exec dormify_backend python manage.py test api.tests.test_home_dashboard
"""

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework import status

from api.models import (
    User, Region, DormType, Building, Apartment, Room,
    Student, AllocationRun, ImportBatch, RegionInbox, StudentRequest,
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


class HomeDashboardEmptyStateTests(TestCase):
    """No batches/runs/inbox/requests/students exist anywhere."""

    def setUp(self):
        self.region = Region.objects.create(id='canada', name='Canada')
        self.admin = _make_user('admin@test.com', User.Role.CENTRAL_ADMIN)
        self.client = APIClient()

    def test_unauthenticated_access_rejected(self):
        resp = self.client.get('/api/home/')
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_central_admin_empty_state(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get('/api/home/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        data = resp.json()

        self.assertEqual(data['scope'], 'system')
        self.assertIsNone(data['user']['region_id'])
        self.assertEqual(data['metrics']['assigned_students'], 0)
        self.assertEqual(data['metrics']['unassigned_students'], 0)
        self.assertEqual(data['metrics']['pending_requests'], 0)
        self.assertIsNone(data['process']['latest_batch'])
        self.assertIsNone(data['process']['active_run'])
        self.assertFalse(data['process']['has_completed_run'])
        self.assertEqual(data['recent_activity'], [])
        self.assertEqual(data['attention_items'], [])

        # No file has ever been uploaded -> the only honest next step for an
        # admin (who is the only role allowed to upload) is to upload one.
        self.assertIsNotNone(data['primary_action'])
        self.assertEqual(data['primary_action']['key'], 'upload')
        self.assertEqual(data['primary_action']['route'], '/upload')

        upload_stage = next(s for s in data['workflow'] if s['key'] == 'upload')
        self.assertEqual(upload_stage['status'], 'active')

    def test_region_user_without_region_assignment_rejected(self):
        employee = _make_user('noregion@test.com', User.Role.EMPLOYEE, region=None)
        self.client.force_authenticate(employee)
        resp = self.client.get('/api/home/')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_region_boss_empty_state_has_no_actionable_primary_action(self):
        boss = _make_user('boss@test.com', User.Role.REGION_BOSS, self.region)
        self.client.force_authenticate(boss)
        resp = self.client.get('/api/home/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        data = resp.json()

        self.assertEqual(data['scope'], 'region')
        self.assertEqual(data['user']['region_id'], 'canada')
        # A region boss can never upload, and nothing has been uploaded yet -
        # there is genuinely nothing for them to do.
        self.assertIsNone(data['primary_action'])


class HomeDashboardScopingTests(TestCase):
    def setUp(self):
        self.region_a = Region.objects.create(id='canada', name='Canada')
        self.region_b = Region.objects.create(id='mizrah', name='Mizrah')

        self.dorm_a = _make_dorm_type(self.region_a, code=1)
        self.dorm_b = _make_dorm_type(self.region_b, code=2)

        _, _, self.room_a = _make_room(self.dorm_a, 1, '1', Apartment.Category.MALE)
        _, _, self.room_b = _make_room(self.dorm_b, 2, '1', Apartment.Category.MALE)

        self.admin = _make_user('admin@test.com', User.Role.CENTRAL_ADMIN)
        self.boss_a = _make_user('bossa@test.com', User.Role.REGION_BOSS, self.region_a)
        self.employee_a = _make_user('empa@test.com', User.Role.EMPLOYEE, self.region_a)
        self.boss_b = _make_user('bossb@test.com', User.Role.REGION_BOSS, self.region_b)

        # Region A: one unassigned student, one assigned student.
        self.student_a_unassigned = _make_student(
            'A1', Student.Gender.MALE, Student.HousingType.SINGLE_MALE, self.dorm_a
        )
        self.student_a_assigned = _make_student(
            'A2', Student.Gender.MALE, Student.HousingType.SINGLE_MALE, self.dorm_a,
            assigned_room=self.room_a,
        )
        # Region B: one unassigned student - must never leak into region A's counts.
        _make_student('B1', Student.Gender.MALE, Student.HousingType.SINGLE_MALE, self.dorm_b)

        self.client = APIClient()

    def test_region_boss_sees_only_own_region_metrics(self):
        self.client.force_authenticate(self.boss_a)
        resp = self.client.get('/api/home/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        data = resp.json()

        self.assertEqual(data['scope'], 'region')
        self.assertEqual(data['user']['region_name'], 'Canada')
        self.assertEqual(data['metrics']['unassigned_students'], 1)
        self.assertEqual(data['metrics']['assigned_students'], 1)

    def test_employee_sees_same_region_scoping_as_boss(self):
        self.client.force_authenticate(self.employee_a)
        resp = self.client.get('/api/home/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        data = resp.json()

        self.assertEqual(data['metrics']['unassigned_students'], 1)
        self.assertEqual(data['metrics']['assigned_students'], 1)

    def test_central_admin_sees_system_wide_metrics(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get('/api/home/')
        data = resp.json()

        self.assertEqual(data['scope'], 'system')
        # 2 unassigned (one per region) + 1 assigned, system-wide.
        self.assertEqual(data['metrics']['unassigned_students'], 2)
        self.assertEqual(data['metrics']['assigned_students'], 1)

    def test_employee_cannot_trigger_upload_action_even_after_failed_batch(self):
        uploader = self.admin
        ImportBatch.objects.create(
            uploaded_by=uploader, filename='bad.xlsx', total_students=0,
            status=ImportBatch.Status.FAILED, error_message='parse error',
        )
        self.client.force_authenticate(self.employee_a)
        resp = self.client.get('/api/home/')
        data = resp.json()

        if data['primary_action']:
            self.assertNotEqual(data['primary_action']['key'], 'upload_retry')
        # Only central_admin (the uploader role) should ever be told to fix
        # a failed upload - never surfaced as a region-scoped attention item
        # for a boss/employee who has no upload permission.
        ids = [item['id'] for item in data['attention_items']]
        self.assertNotIn('upload-failed', ids)


class HomeDashboardProcessStateTests(TestCase):
    def setUp(self):
        self.region = Region.objects.create(id='canada', name='Canada')
        self.dorm_type = _make_dorm_type(self.region, code=1)
        self.admin = _make_user('admin@test.com', User.Role.CENTRAL_ADMIN)
        self.boss = _make_user('boss@test.com', User.Role.REGION_BOSS, self.region)
        self.client = APIClient()

    def test_active_allocation_run_reported_and_workflow_active(self):
        batch = ImportBatch.objects.create(
            uploaded_by=self.admin, filename='ok.xlsx', total_students=5,
            status=ImportBatch.Status.COMPLETED,
        )
        RegionInbox.objects.create(
            region=self.region, batch=batch, students_count=5,
            status=RegionInbox.Status.PROCESSED,
            viewed_at=timezone.now(), processed_at=timezone.now(),
        )
        run = AllocationRun.objects.create(
            region=self.region, run_by=self.boss, status=AllocationRun.Status.RUNNING,
        )

        self.client.force_authenticate(self.boss)
        resp = self.client.get('/api/home/')
        data = resp.json()

        self.assertIsNotNone(data['process']['active_run'])
        self.assertEqual(data['process']['active_run']['id'], run.id)
        allocation_stage = next(s for s in data['workflow'] if s['key'] == 'allocation')
        self.assertEqual(allocation_stage['status'], 'active')
        self.assertEqual(data['primary_action']['key'], 'view_active')

        ids = [item['id'] for item in data['attention_items']]
        self.assertIn('allocation-running', ids)

    def test_failed_allocation_run_surfaces_attention_item_for_boss(self):
        AllocationRun.objects.create(
            region=self.region, run_by=self.boss, status=AllocationRun.Status.FAILED,
            completed_at=timezone.now(), error_message='solver crashed',
        )

        self.client.force_authenticate(self.boss)
        resp = self.client.get('/api/home/')
        data = resp.json()

        allocation_stage = next(s for s in data['workflow'] if s['key'] == 'allocation')
        self.assertEqual(allocation_stage['status'], 'attention')
        self.assertEqual(data['primary_action']['key'], 'retry_allocation')
        ids = [item['id'] for item in data['attention_items']]
        self.assertIn('allocation-failed', ids)

    def test_completed_run_with_unassigned_students_needs_review(self):
        AllocationRun.objects.create(
            region=self.region, run_by=self.boss, status=AllocationRun.Status.COMPLETED,
            completed_at=timezone.now(),
        )
        _make_student('S1', Student.Gender.MALE, Student.HousingType.SINGLE_MALE, self.dorm_type)

        self.client.force_authenticate(self.boss)
        resp = self.client.get('/api/home/')
        data = resp.json()

        self.assertTrue(data['process']['has_completed_run'])
        results_stage = next(s for s in data['workflow'] if s['key'] == 'results_review')
        self.assertEqual(results_stage['status'], 'attention')
        self.assertEqual(data['primary_action']['key'], 'review_unassigned')

    def test_pending_request_with_no_linked_student_does_not_crash(self):
        # "other" requests may have no student FK - only a free-text
        # description - the endpoint must handle this gracefully.
        StudentRequest.objects.create(
            request_type=StudentRequest.RequestType.OTHER,
            reason='General question',
            requested_by=self.boss,
        )

        self.client.force_authenticate(self.boss)
        resp = self.client.get('/api/home/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        data = resp.json()

        self.assertEqual(data['metrics']['pending_requests'], 1)
        ids = [item['id'] for item in data['attention_items']]
        self.assertIn('pending-requests', ids)
        activity_ids = [a['id'] for a in data['recent_activity']]
        self.assertTrue(any(a.startswith('request-') for a in activity_ids))