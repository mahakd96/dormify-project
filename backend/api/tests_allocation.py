"""
Tests for Stop Allocation and Delete Results features.

Run with the test database (never the production Azure DB):
    python manage.py test api.tests_allocation --settings=dormify.settings_test
    # or if no separate test settings:
    python manage.py test api.tests_allocation
"""

from unittest.mock import patch, MagicMock
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework import status

from api.models import (
    User, Region, AllocationRun, BedAssignment, Student, DormType,
    Building, Apartment, Room, Bed,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_region(name='TestRegion'):
    return Region.objects.create(name=name)


def _make_central_admin(region=None, email='admin@test.com'):
    user = User.objects.create_user(
        email=email,
        password='testpass123',
        role=User.Role.CENTRAL_ADMIN,
        first_name='Admin',
        last_name='User',
    )
    if region:
        user.region = region
        user.save()
    return user


def _make_region_boss(region, email='boss@test.com'):
    user = User.objects.create_user(
        email=email,
        password='testpass123',
        role=User.Role.REGION_BOSS,
        first_name='Boss',
        last_name='User',
        region=region,
    )
    return user


def _make_employee(region, email='emp@test.com'):
    return User.objects.create_user(
        email=email,
        password='testpass123',
        role=User.Role.EMPLOYEE,
        first_name='Emp',
        last_name='User',
        region=region,
    )


def _make_run(region, user, status_val=AllocationRun.Status.COMPLETED, completed=True):
    run = AllocationRun.__new__(AllocationRun)
    run.region = region
    run.run_by = user
    run.status = status_val
    run.students_processed = 0
    run.successful_assignments = 0
    run.roommate_matches = 0
    run.conflicts = 0
    run.error_message = '' if status_val != AllocationRun.Status.FAILED else 'test error'
    run.completed_at = timezone.now() if completed else None
    AllocationRun.objects.bulk_create([run])
    return AllocationRun.objects.filter(region=region).order_by('-started_at').first()


def _make_run_with_assignment(region, user, status_val=AllocationRun.Status.COMPLETED):
    run = _make_run(region, user, status_val=status_val)

    dorm_type = DormType.objects.create(name='TestType', code='TT', region=region)
    building = Building.objects.create(number=1, dorm_type=dorm_type)
    apartment = Apartment.objects.create(
        number=1, building=building, category='male', apartment_type='single'
    )
    room = Room.objects.create(name='101', apartment=apartment, capacity=2)
    bed = Bed.objects.create(room=room, label='A')

    student = Student.objects.create(
        student_id='S001',
        first_name='Test',
        last_name='Student',
        gender='male',
        housing_type='single_male',
        accepted_dorm_type=dorm_type,
        assigned_room=room,
    )

    BedAssignment.objects.create(
        student=student,
        bed=bed,
        status=BedAssignment.Status.ACTIVE,
        assignment_type=BedAssignment.AssignmentType.INITIAL,
        allocation_run=run,
    )

    return run, student, bed


# ---------------------------------------------------------------------------
# Tests: AllocationRun lifecycle model
# ---------------------------------------------------------------------------

class AllocationRunStatusTest(TestCase):
    def setUp(self):
        self.region = _make_region()
        self.user = _make_central_admin()

    def test_queued_status_valid(self):
        run = AllocationRun(
            region=self.region,
            run_by=self.user,
            status=AllocationRun.Status.QUEUED,
        )
        run.full_clean()  # should not raise

    def test_running_status_valid(self):
        run = AllocationRun(
            region=self.region,
            run_by=self.user,
            status=AllocationRun.Status.RUNNING,
        )
        run.full_clean()

    def test_cancellation_requested_no_completed_at(self):
        run = AllocationRun(
            region=self.region,
            run_by=self.user,
            status=AllocationRun.Status.CANCELLATION_REQUESTED,
        )
        run.full_clean()

    def test_stopped_requires_completed_at(self):
        from django.core.exceptions import ValidationError
        run = AllocationRun(
            region=self.region,
            run_by=self.user,
            status=AllocationRun.Status.STOPPED,
        )
        with self.assertRaises(ValidationError):
            run.full_clean()

    def test_deleted_requires_completed_at(self):
        from django.core.exceptions import ValidationError
        run = AllocationRun(
            region=self.region,
            run_by=self.user,
            status=AllocationRun.Status.DELETED,
        )
        with self.assertRaises(ValidationError):
            run.full_clean()


# ---------------------------------------------------------------------------
# Tests: GET /api/allocation/runs/active/
# ---------------------------------------------------------------------------

class ActiveRunTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.region = _make_region()
        self.boss = _make_region_boss(self.region)
        self.client.force_authenticate(user=self.boss)

    def test_no_active_run_returns_none(self):
        resp = self.client.get('/api/allocation/runs/active/')
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.data['run'])

    def test_returns_running_run(self):
        run = _make_run(self.region, self.boss, status_val=AllocationRun.Status.RUNNING, completed=False)
        resp = self.client.get('/api/allocation/runs/active/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['run']['id'], run.id)

    def test_returns_completed_draft(self):
        run = _make_run(self.region, self.boss, status_val=AllocationRun.Status.COMPLETED)
        resp = self.client.get('/api/allocation/runs/active/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['run']['id'], run.id)

    def test_deleted_run_not_returned(self):
        _make_run(self.region, self.boss, status_val=AllocationRun.Status.DELETED)
        resp = self.client.get('/api/allocation/runs/active/')
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.data['run'])


# ---------------------------------------------------------------------------
# Tests: POST /api/allocation/runs/<id>/stop/
# ---------------------------------------------------------------------------

class StopAllocationRunTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.region = _make_region()
        self.boss = _make_region_boss(self.region)
        self.employee = _make_employee(self.region)

    def test_unauthorized_user_cannot_stop(self):
        """Test Case 2: Unauthorized user cannot stop."""
        self.client.force_authenticate(user=self.employee)
        run = _make_run(self.region, self.boss, status_val=AllocationRun.Status.RUNNING, completed=False)
        resp = self.client.post(f'/api/allocation/runs/{run.id}/stop/')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_boss_can_stop_running_run(self):
        self.client.force_authenticate(user=self.boss)
        run = _make_run(self.region, self.boss, status_val=AllocationRun.Status.RUNNING, completed=False)
        resp = self.client.post(f'/api/allocation/runs/{run.id}/stop/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        run.refresh_from_db()
        self.assertEqual(run.status, AllocationRun.Status.CANCELLATION_REQUESTED)

    def test_stop_completed_run_returns_409(self):
        """A completed run cannot be stopped."""
        self.client.force_authenticate(user=self.boss)
        run = _make_run(self.region, self.boss, status_val=AllocationRun.Status.COMPLETED)
        resp = self.client.post(f'/api/allocation/runs/{run.id}/stop/')
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT)

    def test_repeated_stop_requests_are_safe(self):
        """Test Case 5: Repeated stop requests are idempotent."""
        self.client.force_authenticate(user=self.boss)
        run = _make_run(self.region, self.boss, status_val=AllocationRun.Status.RUNNING, completed=False)
        resp1 = self.client.post(f'/api/allocation/runs/{run.id}/stop/')
        self.assertEqual(resp1.status_code, status.HTTP_200_OK)
        resp2 = self.client.post(f'/api/allocation/runs/{run.id}/stop/')
        # Second call: already CANCELLATION_REQUESTED → 200 idempotent
        self.assertEqual(resp2.status_code, status.HTTP_200_OK)
        run.refresh_from_db()
        self.assertEqual(run.status, AllocationRun.Status.CANCELLATION_REQUESTED)

    def test_stop_unknown_run_returns_404(self):
        self.client.force_authenticate(user=self.boss)
        resp = self.client.post('/api/allocation/runs/99999/stop/')
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)


# ---------------------------------------------------------------------------
# Tests: DELETE /api/allocation/runs/<id>/delete/
# ---------------------------------------------------------------------------

class DeleteAllocationRunTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.region = _make_region()
        self.boss = _make_region_boss(self.region)
        self.employee = _make_employee(self.region)

    def test_unauthorized_user_cannot_delete(self):
        self.client.force_authenticate(user=self.employee)
        run = _make_run(self.region, self.boss, status_val=AllocationRun.Status.COMPLETED)
        resp = self.client.delete(f'/api/allocation/runs/{run.id}/delete/')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_delete_completed_draft_restores_students(self):
        """Test Case 6: Deleting completed draft results restores students and beds."""
        self.client.force_authenticate(user=self.boss)
        run, student, bed = _make_run_with_assignment(self.region, self.boss)

        resp = self.client.delete(f'/api/allocation/runs/{run.id}/delete/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        run.refresh_from_db()
        self.assertEqual(run.status, AllocationRun.Status.DELETED)

        student.refresh_from_db()
        self.assertIsNone(student.assigned_room)

        assignment = BedAssignment.objects.get(bed=bed)
        self.assertEqual(assignment.status, BedAssignment.Status.CANCELLED)

    def test_approved_run_returns_409(self):
        """Test Case 7: Approved results return 409 and remain unchanged."""
        self.client.force_authenticate(user=self.boss)
        run = _make_run(self.region, self.boss, status_val=AllocationRun.Status.APPROVED)
        resp = self.client.delete(f'/api/allocation/runs/{run.id}/delete/')
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT)

        run.refresh_from_db()
        self.assertEqual(run.status, AllocationRun.Status.APPROVED)

    def test_delete_one_run_does_not_affect_another(self):
        """Test Case 8: Deleting one run does not affect another run's assignments."""
        self.client.force_authenticate(user=self.boss)

        run1, student1, bed1 = _make_run_with_assignment(self.region, self.boss)

        region2 = _make_region('OtherRegion')
        boss2 = _make_region_boss(region2, email='boss2@test.com')
        run2, student2, bed2 = _make_run_with_assignment(region2, boss2)

        admin = _make_central_admin(email='admin2@test.com')
        self.client.force_authenticate(user=admin)

        resp = self.client.delete(f'/api/allocation/runs/{run1.id}/delete/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        # run2 assignments should be untouched
        assignment2 = BedAssignment.objects.get(bed=bed2)
        self.assertEqual(assignment2.status, BedAssignment.Status.ACTIVE)
        run2.refresh_from_db()
        self.assertEqual(run2.status, AllocationRun.Status.COMPLETED)

    def test_delete_running_run_returns_409(self):
        """Cannot delete a run that is still running."""
        self.client.force_authenticate(user=self.boss)
        run = _make_run(self.region, self.boss, status_val=AllocationRun.Status.RUNNING, completed=False)
        resp = self.client.delete(f'/api/allocation/runs/{run.id}/delete/')
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT)


# ---------------------------------------------------------------------------
# Tests: POST /api/allocation/start/ (async start)
# ---------------------------------------------------------------------------

class StartAllocationRunTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.region = _make_region()
        self.boss = _make_region_boss(self.region)
        self.employee = _make_employee(self.region)

    @patch('api.views._execute_allocation_background')
    def test_authorized_user_starts_allocation(self, mock_bg):
        """Test Case 1: Authorized user starts an allocation."""
        self.client.force_authenticate(user=self.boss)
        resp = self.client.post('/api/allocation/start/', {
            'region': self.region.id,
        }, format='json')
        self.assertIn(resp.status_code, [status.HTTP_202_ACCEPTED, status.HTTP_200_OK])
        self.assertIn('run_id', resp.data)
        mock_bg.assert_called_once()

    @patch('api.views._execute_allocation_background')
    def test_employee_cannot_start_allocation(self, mock_bg):
        self.client.force_authenticate(user=self.employee)
        resp = self.client.post('/api/allocation/start/', {
            'region': self.region.id,
        }, format='json')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        mock_bg.assert_not_called()

    @patch('api.views._execute_allocation_background')
    def test_double_start_returns_409(self, mock_bg):
        """Starting while a run is already active returns 409."""
        self.client.force_authenticate(user=self.boss)
        _make_run(self.region, self.boss, status_val=AllocationRun.Status.RUNNING, completed=False)
        resp = self.client.post('/api/allocation/start/', {
            'region': self.region.id,
        }, format='json')
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT)


# ---------------------------------------------------------------------------
# Tests: Cleanup helper
# ---------------------------------------------------------------------------

class CleanupRunAssignmentsTest(TestCase):
    def setUp(self):
        self.region = _make_region()
        self.boss = _make_region_boss(self.region)

    def test_cleanup_cancels_assignments_and_restores_students(self):
        """Test Case 3: Stopping removes only partial records belonging to that run."""
        from api.views import _cleanup_run_assignments

        run, student, bed = _make_run_with_assignment(
            self.region, self.boss,
            status_val=AllocationRun.Status.RUNNING,
        )
        # Manually set as running (bypassing clean)
        AllocationRun.objects.filter(pk=run.id).update(
            status=AllocationRun.Status.RUNNING,
            completed_at=None,
        )

        count = _cleanup_run_assignments(run.id, mark_status=AllocationRun.Status.STOPPED)
        self.assertEqual(count, 1)

        run.refresh_from_db()
        self.assertEqual(run.status, AllocationRun.Status.STOPPED)

        student.refresh_from_db()
        self.assertIsNone(student.assigned_room)

        assignment = BedAssignment.objects.get(bed=bed)
        self.assertEqual(assignment.status, BedAssignment.Status.CANCELLED)

    def test_cleanup_does_not_affect_older_approved_allocation(self):
        """Test Case 4: Stopping does not affect an older approved allocation."""
        from api.views import _cleanup_run_assignments

        # Create an approved run (separate region to avoid FK conflicts)
        region2 = _make_region('Region2')
        boss2 = _make_region_boss(region2, email='boss_r2@test.com')
        approved_run, approved_student, approved_bed = _make_run_with_assignment(
            region2, boss2,
            status_val=AllocationRun.Status.APPROVED,
        )

        # Create a running run to be stopped
        run_to_stop, student_to_stop, bed_to_stop = _make_run_with_assignment(
            self.region, self.boss,
            status_val=AllocationRun.Status.RUNNING,
        )
        AllocationRun.objects.filter(pk=run_to_stop.id).update(
            status=AllocationRun.Status.RUNNING,
            completed_at=None,
        )

        _cleanup_run_assignments(run_to_stop.id, mark_status=AllocationRun.Status.STOPPED)

        # Approved assignment must be untouched
        approved_assignment = BedAssignment.objects.get(bed=approved_bed)
        self.assertEqual(approved_assignment.status, BedAssignment.Status.ACTIVE)

        approved_run.refresh_from_db()
        self.assertEqual(approved_run.status, AllocationRun.Status.APPROVED)


# ---------------------------------------------------------------------------
# Tests: GET /api/allocation/runs/<id>/
# ---------------------------------------------------------------------------

class GetRunDetailTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.region = _make_region()
        self.boss = _make_region_boss(self.region)

    def test_get_run_detail_returns_status(self):
        self.client.force_authenticate(user=self.boss)
        run = _make_run(self.region, self.boss, status_val=AllocationRun.Status.RUNNING, completed=False)
        resp = self.client.get(f'/api/allocation/runs/{run.id}/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['run']['status'], 'running')

    def test_get_run_detail_completed_includes_assignments(self):
        self.client.force_authenticate(user=self.boss)
        run, student, bed = _make_run_with_assignment(self.region, self.boss)
        resp = self.client.get(f'/api/allocation/runs/{run.id}/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['run']['status'], 'completed')
        self.assertGreaterEqual(len(resp.data['assignments']), 1)

    def test_get_unknown_run_returns_404(self):
        self.client.force_authenticate(user=self.boss)
        resp = self.client.get('/api/allocation/runs/99999/')
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
