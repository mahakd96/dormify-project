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


# ---------------------------------------------------------------------------
# Tests: GET /api/allocation/results/ region access by role
# (Case 3 fix: employees must not be able to read another region's results
# by passing a foreign ?region= query param.)
#
# This class is intentionally self-contained (it does not use the
# _make_central_admin / _make_region_boss / _make_employee / _make_run /
# _make_run_with_assignment helpers above). Those helpers currently do not
# work against the present schema (e.g. missing `username`, an invalid
# AllocationRun.__new__ construction, and a non-numeric DormType.code) —
# a pre-existing issue unrelated to this fix, left untouched here.
# ---------------------------------------------------------------------------

def _make_region_with_data(region_id, region_name, owner_role, owner_email, student_id):
    """
    Build one fully independent region: its own user, dorm type, building,
    apartment, room, bed, student, and an ACTIVE BedAssignment. Does not use
    the shared helpers above, and every identifier is derived from
    region_id/student_id so two calls in the same test never collide.
    """
    region = Region.objects.create(id=region_id, name=region_name)

    owner = User.objects.create_user(
        username=owner_email,
        email=owner_email,
        password='testpass123',
        role=owner_role,
        first_name='Test',
        last_name='User',
        region=region,
    )

    dorm_type = DormType.objects.create(name=f'DormType-{region_id}', region=region)
    building = Building.objects.create(number=1, dorm_type=dorm_type)
    apartment = Apartment.objects.create(
        building=building,
        number='1',
        category=Apartment.Category.MALE,
        apartment_type=Apartment.ApartmentType.SINGLE,
        room_count=1,
    )
    room = Room.objects.create(apartment=apartment, name='101', capacity=1)
    bed = Bed.objects.create(room=room, label='A')

    student = Student.objects.create(
        student_id=student_id,
        first_name='Test',
        last_name='Student',
        gender=Student.Gender.MALE,
        accepted_dorm_type=dorm_type,
        assigned_room=room,
    )

    run = AllocationRun.objects.create(
        region=region,
        run_by=owner,
        status=AllocationRun.Status.COMPLETED,
        completed_at=timezone.now(),
    )

    BedAssignment.objects.create(
        student=student,
        bed=bed,
        status=BedAssignment.Status.ACTIVE,
        assignment_type=BedAssignment.AssignmentType.INITIAL,
        allocation_run=run,
    )

    return region, owner, student


class AllocationResultsRegionAccessTest(TestCase):
    def setUp(self):
        self.client = APIClient()

        self.region_a, self.employee_a, self.student_a = _make_region_with_data(
            'region-a', 'Region A', User.Role.EMPLOYEE, 'emp-a@test.com', 'STU-A-001'
        )
        self.region_b, self.boss_b, self.student_b = _make_region_with_data(
            'region-b', 'Region B', User.Role.REGION_BOSS, 'boss-b@test.com', 'STU-B-001'
        )

    def test_employee_foreign_region_param_does_not_return_foreign_data(self):
        self.client.force_authenticate(user=self.employee_a)
        resp = self.client.get('/api/allocation/results/', {'region': self.region_b.id})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        student_ids = [a['student_id'] for a in resp.data['assignments']]
        self.assertNotIn(self.student_b.student_id, student_ids)
        for assignment in resp.data['assignments']:
            self.assertEqual(assignment['region_id'], self.region_a.id)

    def test_employee_own_region_read_still_works(self):
        self.client.force_authenticate(user=self.employee_a)
        resp = self.client.get('/api/allocation/results/', {'region': self.region_a.id})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        student_ids = [a['student_id'] for a in resp.data['assignments']]
        self.assertIn(self.student_a.student_id, student_ids)

    def test_employee_no_region_param_defaults_to_own_region(self):
        self.client.force_authenticate(user=self.employee_a)
        resp = self.client.get('/api/allocation/results/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        student_ids = [a['student_id'] for a in resp.data['assignments']]
        self.assertIn(self.student_a.student_id, student_ids)
        self.assertNotIn(self.student_b.student_id, student_ids)

    def test_region_boss_can_read_another_regions_results(self):
        self.client.force_authenticate(user=self.boss_b)
        resp = self.client.get('/api/allocation/results/', {'region': self.region_a.id})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        student_ids = [a['student_id'] for a in resp.data['assignments']]
        self.assertIn(self.student_a.student_id, student_ids)


# ---------------------------------------------------------------------------
# Tests: Case 3B - region-manager (region_boss) read access to another
# region's students/buildings/rooms/statistics/allocation-summary, while
# employees stay pinned to their own region and central_admin keeps existing
# behavior (unfiltered by default, filterable by ?region=).
#
# Self-contained, reuses _make_region_with_data from the allocation_results
# fix above; does not use the pre-existing broken shared helpers.
# ---------------------------------------------------------------------------

class RegionAccessByRoleTest(TestCase):
    def setUp(self):
        self.client = APIClient()

        self.region_a, self.employee_a, self.student_a = _make_region_with_data(
            'case3b-region-a', 'Case3B Region A',
            User.Role.EMPLOYEE, 'case3b-emp-a@test.com', 'CASE3B-STU-A',
        )
        self.region_b, self.boss_b, self.student_b = _make_region_with_data(
            'case3b-region-b', 'Case3B Region B',
            User.Role.REGION_BOSS, 'case3b-boss-b@test.com', 'CASE3B-STU-B',
        )
        self.central_admin = User.objects.create_user(
            username='case3b-admin@test.com',
            email='case3b-admin@test.com',
            password='testpass123',
            role=User.Role.CENTRAL_ADMIN,
            first_name='Test',
            last_name='Admin',
        )

    # ---- /api/students/ ----

    def test_students_employee_pinned_to_own_region(self):
        self.client.force_authenticate(user=self.employee_a)

        resp = self.client.get('/api/students/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        student_ids = [s['student_id'] for s in resp.data]
        self.assertIn(self.student_a.student_id, student_ids)
        self.assertNotIn(self.student_b.student_id, student_ids)

        resp = self.client.get('/api/students/', {'region': self.region_b.id})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        student_ids = [s['student_id'] for s in resp.data]
        self.assertIn(self.student_a.student_id, student_ids)
        self.assertNotIn(self.student_b.student_id, student_ids)

    def test_students_region_boss_can_read_foreign_region(self):
        self.client.force_authenticate(user=self.boss_b)
        resp = self.client.get('/api/students/', {'region': self.region_a.id})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        student_ids = [s['student_id'] for s in resp.data]
        self.assertIn(self.student_a.student_id, student_ids)

    def test_students_central_admin_can_filter_by_region(self):
        self.client.force_authenticate(user=self.central_admin)
        resp = self.client.get('/api/students/', {'region': self.region_b.id})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        student_ids = [s['student_id'] for s in resp.data]
        self.assertIn(self.student_b.student_id, student_ids)
        self.assertNotIn(self.student_a.student_id, student_ids)

    # ---- /api/buildings/ ----

    def test_buildings_employee_pinned_to_own_region(self):
        self.client.force_authenticate(user=self.employee_a)
        resp = self.client.get('/api/buildings/', {'region': self.region_b.id})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        regions = {b['region'] for b in resp.data}
        self.assertEqual(regions, {self.region_a.id})

    def test_buildings_region_boss_can_read_foreign_region(self):
        self.client.force_authenticate(user=self.boss_b)
        resp = self.client.get('/api/buildings/', {'region': self.region_a.id})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        regions = {b['region'] for b in resp.data}
        self.assertEqual(regions, {self.region_a.id})

    def test_buildings_central_admin_can_filter_by_region(self):
        self.client.force_authenticate(user=self.central_admin)
        resp = self.client.get('/api/buildings/', {'region': self.region_b.id})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        regions = {b['region'] for b in resp.data}
        self.assertEqual(regions, {self.region_b.id})

    # ---- /api/rooms/ ----

    def test_rooms_employee_pinned_to_own_region(self):
        self.client.force_authenticate(user=self.employee_a)
        resp = self.client.get('/api/rooms/', {'region': self.region_b.id})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        regions = {r['region'] for r in resp.data}
        self.assertEqual(regions, {self.region_a.id})

    def test_rooms_region_boss_can_read_foreign_region(self):
        self.client.force_authenticate(user=self.boss_b)
        resp = self.client.get('/api/rooms/', {'region': self.region_a.id})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        regions = {r['region'] for r in resp.data}
        self.assertEqual(regions, {self.region_a.id})

    def test_rooms_central_admin_can_filter_by_region(self):
        self.client.force_authenticate(user=self.central_admin)
        resp = self.client.get('/api/rooms/', {'region': self.region_a.id})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        regions = {r['region'] for r in resp.data}
        self.assertEqual(regions, {self.region_a.id})

    def test_rooms_non_central_user_without_region_returns_empty(self):
        employee_no_region = User.objects.create_user(
            username='case3b-emp-no-region@test.com',
            email='case3b-emp-no-region@test.com',
            password='testpass123',
            role=User.Role.EMPLOYEE,
            first_name='Test',
            last_name='NoRegion',
        )
        self.client.force_authenticate(user=employee_no_region)

        resp = self.client.get('/api/rooms/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(list(resp.data), [])

        resp = self.client.get('/api/rooms/', {'region': self.region_a.id})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(list(resp.data), [])

    # ---- /api/statistics/ ----

    def test_statistics_employee_pinned_to_own_region(self):
        self.client.force_authenticate(user=self.employee_a)
        resp = self.client.get('/api/statistics/', {'region': self.region_b.id})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['total_students'], 1)
        self.assertEqual(resp.data['total_buildings'], 1)

    def test_statistics_region_boss_can_read_foreign_region(self):
        self.client.force_authenticate(user=self.boss_b)
        resp = self.client.get('/api/statistics/', {'region': self.region_a.id})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['total_students'], 1)

    def test_statistics_central_admin_can_filter_by_region(self):
        self.client.force_authenticate(user=self.central_admin)
        resp = self.client.get('/api/statistics/', {'region': self.region_a.id})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['total_students'], 1)

    def test_statistics_central_admin_no_region_sees_all(self):
        self.client.force_authenticate(user=self.central_admin)
        resp = self.client.get('/api/statistics/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['total_students'], 2)

    # ---- /api/allocation/summary/ ----

    def test_allocation_summary_employee_pinned_to_own_region(self):
        self.client.force_authenticate(user=self.employee_a)
        resp = self.client.get('/api/allocation/summary/', {'region': self.region_b.id})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['region']['id'], self.region_a.id)
        self.assertEqual(resp.data['total_students'], 1)

    def test_allocation_summary_region_boss_can_read_foreign_region(self):
        self.client.force_authenticate(user=self.boss_b)
        resp = self.client.get('/api/allocation/summary/', {'region': self.region_a.id})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['region']['id'], self.region_a.id)
        self.assertEqual(resp.data['total_students'], 1)

    def test_allocation_summary_central_admin_can_filter_by_region(self):
        self.client.force_authenticate(user=self.central_admin)
        resp = self.client.get('/api/allocation/summary/', {'region': self.region_b.id})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['region']['id'], self.region_b.id)

    def test_allocation_summary_central_admin_no_region_returns_defaults(self):
        self.client.force_authenticate(user=self.central_admin)
        resp = self.client.get('/api/allocation/summary/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIsNone(resp.data['region'])
        self.assertEqual(resp.data['total_students'], 0)
