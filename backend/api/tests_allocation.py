"""
Tests for Stop Allocation and Delete Results features.

Run with the test database (never the production Azure DB):
    python manage.py test api.tests_allocation --settings=dormify.settings_test
    # or if no separate test settings:
    python manage.py test api.tests_allocation
"""

from collections import defaultdict
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
    # Region.id is a CharField primary key — must be supplied explicitly.
    region_id = name.lower().replace(' ', '_')
    return Region.objects.create(id=region_id, name=name)


def _make_central_admin(region=None, email='admin@test.com'):
    user = User.objects.create_user(
        username=email,
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
        username=email,
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
        username=email,
        email=email,
        password='testpass123',
        role=User.Role.EMPLOYEE,
        first_name='Emp',
        last_name='User',
        region=region,
    )


def _make_run(region, user, status_val=AllocationRun.Status.COMPLETED, completed=True):
    run = AllocationRun(
        region=region,
        run_by=user,
        status=status_val,
        students_processed=0,
        successful_assignments=0,
        roommate_matches=0,
        conflicts=0,
        error_message='' if status_val != AllocationRun.Status.FAILED else 'test error',
        completed_at=timezone.now() if completed else None,
    )
    AllocationRun.objects.bulk_create([run])
    return AllocationRun.objects.filter(region=region).order_by('-started_at').first()


def _make_run_with_assignment(region, user, status_val=AllocationRun.Status.COMPLETED):
    run = _make_run(region, user, status_val=status_val)
    rid = region.id

    dorm_type = DormType.objects.create(name=f'TestType_{rid}', code=None, region=region)
    building = Building.objects.create(number=1, dorm_type=dorm_type)
    apartment = Apartment.objects.create(
        number='1', building=building, category='male', apartment_type='single',
        room_count=1,
    )
    room = Room.objects.create(name='101', apartment=apartment, capacity=2)
    bed = Bed.objects.create(room=room, label='A')

    student = Student.objects.create(
        student_id=f'S001_{rid}',
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
        # The DELETE endpoint calls _cleanup_run_assignments which calls
        # close_old_connections(); patch to prevent closing the test connection.
        patcher = patch('django.db.close_old_connections')
        patcher.start()
        self.addCleanup(patcher.stop)

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
        # _cleanup_run_assignments calls close_old_connections() which closes the
        # test connection (CONN_MAX_AGE=0).  Patch it to a no-op for all tests.
        patcher = patch('django.db.close_old_connections')
        patcher.start()
        self.addCleanup(patcher.stop)

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
# Solver regression tests — religious-Jewish isolation rule + accessibility
# ---------------------------------------------------------------------------

class SolverReligiousJewishRuleTest(TestCase):
    """
    Regression tests for the hard ReligiousTogether rule.

    The rule is per-religion and bidirectional:

    1. A RELIGIOUS student of religion R restricts their apartment to students of
       religion R only — with one extra condition for Jewish:
         • Religious Jewish (RJ): only Jewish+RELIGIOUS students may share.
         • Religious Muslim/Christian/Druze: any student of the same religion
           (any observance level) may share.

    2. Non-RELIGIOUS students have no restriction of their own but must comply
       with any RELIGIOUS occupant's restriction.

    3. An apartment with only non-RELIGIOUS students has no religion restriction.
       Any mix of unrestricted students may share.

    4. Two RELIGIOUS students of different religions are always incompatible.
    """

    HARD_RELIGIOUS_CONFIG = {
        "ReligiousTogether": {"enabled": True, "strict": True},
        "sameReligion": {"enabled": False},
        "sectorMatching": {"enabled": False},
        "roommateMatch": {"enabled": False},
        "roommatePositiveOnly": {"enabled": False},
        "avoidYearMix_1_with_3_4": {"enabled": False},
        "avoidAtudaimWithHasmaha": {"enabled": False},
        "priorityFirst": {"enabled": False},
    }

    def setUp(self):
        patcher = patch('allocation.solver.close_old_connections')
        patcher.start()
        self.addCleanup(patcher.stop)

    def _make_infra(self, beds_per_apt=2, num_apts=1):
        dorm = DormType.objects.create(name='TestDorm')
        building = Building.objects.create(number=1, dorm_type=dorm)
        rooms = []
        for i in range(num_apts):
            apt = Apartment.objects.create(
                building=building,
                number=str(i + 1),
                category=Apartment.Category.FEMALE,
                apartment_type=Apartment.ApartmentType.SINGLE,
                room_count=1,
            )
            room = Room.objects.create(apartment=apt, name='A', capacity=beds_per_apt)
            for j in range(beds_per_apt):
                Bed.objects.create(room=room, label=str(j + 1))
            rooms.append(room)
        return rooms

    def _make_student(self, student_id, religion, religious):
        return Student.objects.create(
            student_id=student_id,
            first_name='Test',
            last_name=student_id,
            housing_type=Student.HousingType.SINGLE_FEMALE,
            requested_religion=religion,
            religious=religious,
        )

    def _run(self, students, rooms, config=None):
        import inspect
        from collections import defaultdict
        from allocation.solver import run_improved_ortools_allocation

        test_name = inspect.stack()[1].function
        students = list(students)
        rooms = list(rooms)

        result = run_improved_ortools_allocation(
            students,
            rooms,
            config or self.HARD_RELIGIOUS_CONFIG,
        )

        assignments = result.get("proposed_assignments", [])
        assigned_ids = {item["student_db_id"] for item in assignments}
        by_apartment = defaultdict(list)
        for item in assignments:
            by_apartment[item["apartment_id"]].append(item)

        print("\n" + "=" * 110)
        print(f"TEST: {test_name}")
        print(
            f"status={result.get('solver_status')} | "
            f"students={len(students)} | "
            f"assigned={result.get('successful_assignments', 0)} | "
            f"conflicts={result.get('conflicts', 0)}"
        )
        print("=" * 110)

        if assignments:
            print(
                f"{'APT':<8} {'ROOM':<8} {'BED':<8} {'STUDENT':<12} "
                f"{'RELIGION':<15} {'RELIGIOUS':<16} {'PRIORITY':<9}"
            )
            print("-" * 110)

            for apartment_id in sorted(by_apartment):
                apartment = Apartment.objects.get(id=apartment_id)
                apartment_rows = sorted(
                    by_apartment[apartment_id],
                    key=lambda row: (
                        str(row.get("room_name", "")),
                        str(row.get("bed_label", "")),
                        row["student_db_id"],
                    ),
                )

                for row in apartment_rows:
                    student = Student.objects.get(id=row["student_db_id"])
                    print(
                        f"{apartment.number:<8} "
                        f"{str(row.get('room_name', '')):<8} "
                        f"{str(row.get('bed_label', '')):<8} "
                        f"{student.student_id:<12} "
                        f"{student.requested_religion:<15} "
                        f"{student.religious:<16} "
                        f"{str(bool(student.is_priority)):<9}"
                    )
        else:
            print("No assignments.")

        unassigned = [student for student in students if student.id not in assigned_ids]
        if unassigned:
            print("\nUNASSIGNED")
            print(f"{'STUDENT':<12} {'RELIGION':<15} {'RELIGIOUS':<16} {'PRIORITY':<9}")
            print("-" * 60)
            for student in sorted(unassigned, key=lambda s: s.student_id):
                print(
                    f"{student.student_id:<12} "
                    f"{student.requested_religion:<15} "
                    f"{student.religious:<16} "
                    f"{str(bool(student.is_priority)):<9}"
                )

        print("=" * 110 + "\n")
        return result

    # ------------------------------------------------------------------
    # Case 1: RJ + RJ — allowed
    # ------------------------------------------------------------------
    def test_rj_plus_rj_can_share(self):
        rooms = self._make_infra(beds_per_apt=2)
        s1 = self._make_student('RJ1', Student.Religion.Jewish, Student.Religious.RELIGIOUS)
        s2 = self._make_student('RJ2', Student.Religion.Jewish, Student.Religious.RELIGIOUS)
        result = self._run([s1, s2], rooms)
        self.assertEqual(result['successful_assignments'], 2, result['proposed_assignments'])

    # ------------------------------------------------------------------
    # Case 2: RJ + Jewish NO_PREFERENCE — forbidden
    # ------------------------------------------------------------------
    def test_rj_plus_jewish_no_preference_cannot_share(self):
        rooms = self._make_infra(beds_per_apt=2)
        s1 = self._make_student('RJ1', Student.Religion.Jewish, Student.Religious.RELIGIOUS)
        s2 = self._make_student('JNP', Student.Religion.Jewish, Student.Religious.NO_PREFERENCE)
        result = self._run([s1, s2], rooms)
        self.assertLessEqual(result['successful_assignments'], 1, result['proposed_assignments'])

    # ------------------------------------------------------------------
    # Case 3: RJ + Muslim NO_PREFERENCE — forbidden
    # ------------------------------------------------------------------
    def test_rj_plus_muslim_no_preference_cannot_share(self):
        rooms = self._make_infra(beds_per_apt=2)
        s1 = self._make_student('RJ1', Student.Religion.Jewish, Student.Religious.RELIGIOUS)
        s2 = self._make_student('MNP', Student.Religion.Muslim, Student.Religious.NO_PREFERENCE)
        result = self._run([s1, s2], rooms)
        self.assertLessEqual(result['successful_assignments'], 1, result['proposed_assignments'])

    # ------------------------------------------------------------------
    # Case 4: Religious Muslim + Muslim NO_PREFERENCE — allowed
    # ------------------------------------------------------------------
    def test_religious_muslim_plus_muslim_no_preference_allowed(self):
        rooms = self._make_infra(beds_per_apt=2)
        s1 = self._make_student('RM1', Student.Religion.Muslim, Student.Religious.RELIGIOUS)
        s2 = self._make_student('MNP', Student.Religion.Muslim, Student.Religious.NO_PREFERENCE)
        result = self._run([s1, s2], rooms)
        self.assertEqual(result['successful_assignments'], 2, result['proposed_assignments'])

    # ------------------------------------------------------------------
    # Case 5: Religious Muslim + Muslim NOT_SPECIFIED — allowed
    # ------------------------------------------------------------------
    def test_religious_muslim_plus_muslim_not_specified_allowed(self):
        rooms = self._make_infra(beds_per_apt=2)
        s1 = self._make_student('RM1', Student.Religion.Muslim, Student.Religious.RELIGIOUS)
        s2 = self._make_student('MNS', Student.Religion.Muslim, Student.Religious.NOT_SPECIFIED)
        result = self._run([s1, s2], rooms)
        self.assertEqual(result['successful_assignments'], 2, result['proposed_assignments'])

    # ------------------------------------------------------------------
    # Case 6: Religious Muslim + Christian NO_PREFERENCE — forbidden
    # ------------------------------------------------------------------
    def test_religious_muslim_plus_christian_no_preference_forbidden(self):
        rooms = self._make_infra(beds_per_apt=2)
        s1 = self._make_student('RM1', Student.Religion.Muslim, Student.Religious.RELIGIOUS)
        s2 = self._make_student('CNP', Student.Religion.Christian, Student.Religious.NO_PREFERENCE)
        result = self._run([s1, s2], rooms)
        self.assertLessEqual(result['successful_assignments'], 1, result['proposed_assignments'])

    # ------------------------------------------------------------------
    # Case 7: Religious Christian + Christian NO_PREFERENCE — allowed
    # ------------------------------------------------------------------
    def test_religious_christian_plus_christian_no_preference_allowed(self):
        rooms = self._make_infra(beds_per_apt=2)
        s1 = self._make_student('RC1', Student.Religion.Christian, Student.Religious.RELIGIOUS)
        s2 = self._make_student('CNP', Student.Religion.Christian, Student.Religious.NO_PREFERENCE)
        result = self._run([s1, s2], rooms)
        self.assertEqual(result['successful_assignments'], 2, result['proposed_assignments'])

    # ------------------------------------------------------------------
    # Case 8: Religious Druze + Druze NO_PREFERENCE — allowed
    # ------------------------------------------------------------------
    def test_religious_druze_plus_druze_no_preference_allowed(self):
        rooms = self._make_infra(beds_per_apt=2)
        s1 = self._make_student('RD1', Student.Religion.Druze, Student.Religious.RELIGIOUS)
        s2 = self._make_student('DNP', Student.Religion.Druze, Student.Religious.NO_PREFERENCE)
        result = self._run([s1, s2], rooms)
        self.assertEqual(result['successful_assignments'], 2, result['proposed_assignments'])

    # ------------------------------------------------------------------
    # Case 9: Religious Muslim + Religious Christian — forbidden
    # ------------------------------------------------------------------
    def test_religious_muslim_plus_religious_christian_forbidden(self):
        rooms = self._make_infra(beds_per_apt=2)
        s1 = self._make_student('RM1', Student.Religion.Muslim, Student.Religious.RELIGIOUS)
        s2 = self._make_student('RC1', Student.Religion.Christian, Student.Religious.RELIGIOUS)
        result = self._run([s1, s2], rooms)
        self.assertLessEqual(result['successful_assignments'], 1, result['proposed_assignments'])

    # ------------------------------------------------------------------
    # Case 10: Religious Christian + Religious Druze — forbidden
    # ------------------------------------------------------------------
    def test_religious_christian_plus_religious_druze_forbidden(self):
        rooms = self._make_infra(beds_per_apt=2)
        s1 = self._make_student('RC1', Student.Religion.Christian, Student.Religious.RELIGIOUS)
        s2 = self._make_student('RD1', Student.Religion.Druze, Student.Religious.RELIGIOUS)
        result = self._run([s1, s2], rooms)
        self.assertLessEqual(result['successful_assignments'], 1, result['proposed_assignments'])

    # ------------------------------------------------------------------
    # Case 11: Jewish NO_PREFERENCE + Muslim NO_PREFERENCE — allowed
    # ------------------------------------------------------------------
    def test_jewish_no_preference_plus_muslim_no_preference_allowed(self):
        rooms = self._make_infra(beds_per_apt=2)
        s1 = self._make_student('JNP', Student.Religion.Jewish, Student.Religious.NO_PREFERENCE)
        s2 = self._make_student('MNP', Student.Religion.Muslim, Student.Religious.NO_PREFERENCE)
        result = self._run([s1, s2], rooms)
        self.assertEqual(result['successful_assignments'], 2, result['proposed_assignments'])

    # ------------------------------------------------------------------
    # Case 12: Muslim NO_PREFERENCE + Christian NO_PREFERENCE — allowed
    # ------------------------------------------------------------------
    def test_muslim_no_preference_plus_christian_no_preference_allowed(self):
        rooms = self._make_infra(beds_per_apt=2)
        s1 = self._make_student('MNP', Student.Religion.Muslim, Student.Religious.NO_PREFERENCE)
        s2 = self._make_student('CNP', Student.Religion.Christian, Student.Religious.NO_PREFERENCE)
        result = self._run([s1, s2], rooms)
        self.assertEqual(result['successful_assignments'], 2, result['proposed_assignments'])

    # ------------------------------------------------------------------
    # Case 13: Christian NO_PREFERENCE + Druze NO_PREFERENCE — allowed
    # ------------------------------------------------------------------
    def test_christian_no_preference_plus_druze_no_preference_allowed(self):
        rooms = self._make_infra(beds_per_apt=2)
        s1 = self._make_student('CNP', Student.Religion.Christian, Student.Religious.NO_PREFERENCE)
        s2 = self._make_student('DNP', Student.Religion.Druze, Student.Religious.NO_PREFERENCE)
        result = self._run([s1, s2], rooms)
        self.assertEqual(result['successful_assignments'], 2, result['proposed_assignments'])

    # ------------------------------------------------------------------
    # Case 14: Existing RELIGIOUS occupant blocks incompatible candidates
    # ------------------------------------------------------------------
    def test_existing_rj_blocks_non_rj_candidate(self):
        """Existing RJ occupant: a new non-RJ student cannot enter."""
        rooms = self._make_infra(beds_per_apt=2)
        room = rooms[0]
        bed = room.beds.first()
        rj = self._make_student('RJ0', Student.Religion.Jewish, Student.Religious.RELIGIOUS)
        BedAssignment.objects.create(
            student=rj, bed=bed,
            status=BedAssignment.Status.ACTIVE,
            assignment_type=BedAssignment.AssignmentType.MANUAL,
        )
        non_rj = self._make_student('MNP', Student.Religion.Muslim, Student.Religious.NO_PREFERENCE)
        result = self._run([non_rj], rooms)
        self.assertEqual(result['successful_assignments'], 0, result['proposed_assignments'])

    def test_existing_religious_muslim_blocks_christian_candidate(self):
        """Existing Religious Muslim occupant: a Christian (any level) cannot enter."""
        rooms = self._make_infra(beds_per_apt=2)
        room = rooms[0]
        bed = room.beds.first()
        rm = self._make_student('RM0', Student.Religion.Muslim, Student.Religious.RELIGIOUS)
        BedAssignment.objects.create(
            student=rm, bed=bed,
            status=BedAssignment.Status.ACTIVE,
            assignment_type=BedAssignment.AssignmentType.MANUAL,
        )
        christian = self._make_student('CNP', Student.Religion.Christian, Student.Religious.NO_PREFERENCE)
        result = self._run([christian], rooms)
        self.assertEqual(result['successful_assignments'], 0, result['proposed_assignments'])

    def test_existing_religious_muslim_allows_muslim_candidate(self):
        """Existing Religious Muslim occupant: a Muslim (no-preference) may enter."""
        rooms = self._make_infra(beds_per_apt=2)
        room = rooms[0]
        bed = room.beds.first()
        rm = self._make_student('RM0', Student.Religion.Muslim, Student.Religious.RELIGIOUS)
        BedAssignment.objects.create(
            student=rm, bed=bed,
            status=BedAssignment.Status.ACTIVE,
            assignment_type=BedAssignment.AssignmentType.MANUAL,
        )
        muslim = self._make_student('MNP', Student.Religion.Muslim, Student.Religious.NO_PREFERENCE)
        result = self._run([muslim], rooms)
        self.assertEqual(result['successful_assignments'], 1, result['proposed_assignments'])

    # ------------------------------------------------------------------
    # Case 15: Existing unrestricted occupants do not block mixed unrestricted candidates
    # ------------------------------------------------------------------
    def test_existing_unrestricted_do_not_block_mixed_unrestricted(self):
        """No-pref Muslim already in apt: a no-pref Jewish student may enter."""
        rooms = self._make_infra(beds_per_apt=2)
        room = rooms[0]
        bed = room.beds.first()
        muslim_np = self._make_student('MNP0', Student.Religion.Muslim, Student.Religious.NO_PREFERENCE)
        BedAssignment.objects.create(
            student=muslim_np, bed=bed,
            status=BedAssignment.Status.ACTIVE,
            assignment_type=BedAssignment.AssignmentType.MANUAL,
        )
        jewish_np = self._make_student('JNP1', Student.Religion.Jewish, Student.Religious.NO_PREFERENCE)
        result = self._run([jewish_np], rooms)
        self.assertEqual(result['successful_assignments'], 1, result['proposed_assignments'])

    # ------------------------------------------------------------------
    # Case 16: Accessibility removal — no student is filtered for accessibility
    # ------------------------------------------------------------------
    def test_accessibility_attributes_not_filtered(self):
        """After removing accessibility from the solver, no student is filtered for it."""
        rooms = self._make_infra(beds_per_apt=2)
        s = Student.objects.create(
            student_id='ACC1',
            first_name='Test',
            last_name='ACC1',
            housing_type=Student.HousingType.SINGLE_FEMALE,
            requested_religion=Student.Religion.Jewish,
            religious=Student.Religious.NO_PREFERENCE,
            is_priority=True,
            priority_reason='נגיש - accessibility needed',
        )
        result = self._run([s], rooms)
        self.assertEqual(result['successful_assignments'], 1, result['proposed_assignments'])

    # ------------------------------------------------------------------
    # Case 17: Priority and reserved-apartment behavior still works
    # ------------------------------------------------------------------
    def test_priority_can_enter_reserved_apartment(self):
        """
        Generic Apartment.InactiveReason.RESERVED behavior (any building,
        any is_priority=True student) — unrelated to, and not to be
        confused with, the building-179 Upper Dorm Office exclusive-group
        policy, which has its own dedicated tests in
        SolverBuilding179PriorityTest and requires priority + הסמכה + אנייר
        + the Upper Dorm Office region, not merely is_priority=True.
        """
        dorm = DormType.objects.create(name='TestDorm')
        building = Building.objects.create(number=1, dorm_type=dorm)
        apt = Apartment.objects.create(
            building=building,
            number='R1',
            category=Apartment.Category.FEMALE,
            apartment_type=Apartment.ApartmentType.SINGLE,
            room_count=1,
            is_active=True,
            inactive_reason=Apartment.InactiveReason.RESERVED,
        )
        room = Room.objects.create(apartment=apt, name='A', capacity=2)
        Bed.objects.create(room=room, label='1')
        Bed.objects.create(room=room, label='2')

        priority_s = Student.objects.create(
            student_id='PRI1',
            first_name='Priority',
            last_name='Student',
            housing_type=Student.HousingType.SINGLE_FEMALE,
            requested_religion=Student.Religion.NOT_SPECIFIED,
            religious=Student.Religious.NOT_SPECIFIED,
            is_priority=True,
        )
        non_priority_s = Student.objects.create(
            student_id='NP1',
            first_name='NonPriority',
            last_name='Student',
            housing_type=Student.HousingType.SINGLE_FEMALE,
            requested_religion=Student.Religion.NOT_SPECIFIED,
            religious=Student.Religious.NOT_SPECIFIED,
            is_priority=False,
        )

        result = self._run([priority_s, non_priority_s], [room])
        self.assertEqual(result['successful_assignments'], 1, result['proposed_assignments'])
        assigned_ids = {a['student_db_id'] for a in result['proposed_assignments']}
        self.assertIn(priority_s.id, assigned_ids)
        self.assertNotIn(non_priority_s.id, assigned_ids)

    # ------------------------------------------------------------------
    # Multi-student run: solver separates all groups correctly
    # ------------------------------------------------------------------
    def test_hard_rule_multiple_students_same_run(self):
        """4 RJ + 4 Muslim NO_PREFERENCE in 2 apts of 4 beds: no mixing allowed."""
        from allocation.solver import _is_religious_jewish
        rooms = self._make_infra(beds_per_apt=4, num_apts=2)
        rj_students = [
            self._make_student(f'RJ{i}', Student.Religion.Jewish, Student.Religious.RELIGIOUS)
            for i in range(4)
        ]
        non_rj_students = [
            self._make_student(f'NRJ{i}', Student.Religion.Muslim, Student.Religious.NO_PREFERENCE)
            for i in range(4)
        ]
        result = self._run(rj_students + non_rj_students, rooms)
        self.assertEqual(result['successful_assignments'], 8, result['proposed_assignments'])

        apt_classification = {}
        for a in result['proposed_assignments']:
            apt_id = a['apartment_id']
            student = Student.objects.get(id=a['student_db_id'])
            is_rj = _is_religious_jewish(student)
            if apt_id in apt_classification:
                self.assertEqual(
                    apt_classification[apt_id], is_rj,
                    f"Apartment {apt_id} has mixed RJ/non-RJ occupants",
                )
            else:
                apt_classification[apt_id] = is_rj


# ---------------------------------------------------------------------------
# Strong combined solver tests: capacity-5 apartments
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Strong combined solver tests:
# 4 apartments × 5 separate one-bed rooms = 20 students
# ---------------------------------------------------------------------------

class SolverCombinedAllConstraintsTest(TestCase):
    """
    End-to-end solver tests using realistic apartment structure:

        4 apartments
        5 separate rooms per apartment
        1 bed per room
        total capacity = 20 students

    The tests cover both categories of allocation rules:

    CRITICAL / HARD
    ----------------
    - sameGender
    - priorityFirst / reserved apartments
    - roommatePositiveOnly
    - ReligiousTogether
    - apartment capacity and one student per room

    FLEXIBLE / SOFT
    ---------------
    - sameReligion
    - roommateMatch
    - sectorMatching
    - avoidYearMix_1_with_3_4
    - avoidAtudaimWithHasmaha

    Every solver run prints a readable allocation table, including the actual
    apartment, room and bed loaded from the test database.
    """

    ALL_CRITICAL_AND_FLEXIBLE = {
        "sameGender": {
            "enabled": True,
            "strict": True,
            "critical": True,
            "weight": 0,
        },
        "priorityFirst": {
            "enabled": True,
            "strict": True,
            "critical": True,
            "weight": 0,
        },
        "roommatePositiveOnly": {
            "enabled": True,
            "strict": True,
            "critical": True,
            "weight": 0,
        },
        "ReligiousTogether": {
            "enabled": True,
            "strict": True,
            "critical": True,
            "weight": 0,
        },
        "sameReligion": {
            "enabled": True,
            "strict": False,
            "critical": False,
            "weight": 6,
        },
        "roommateMatch": {
            "enabled": True,
            "strict": False,
            "critical": False,
            "weight": 10,
        },
        "sectorMatching": {
            "enabled": True,
            "strict": False,
            "critical": False,
            "weight": 7,
        },
        "avoidYearMix_1_with_3_4": {
            "enabled": True,
            "strict": False,
            "critical": False,
            "weight": 8,
        },
        "avoidAtudaimWithHasmaha": {
            "enabled": True,
            "strict": False,
            "critical": False,
            "weight": 8,
        },
    }

    FLEXIBLE_ROOMMATE_CONFIG = {
        **ALL_CRITICAL_AND_FLEXIBLE,
        "roommatePositiveOnly": {
            "enabled": False,
            "strict": False,
            "critical": False,
            "weight": 0,
        },
    }

    def setUp(self):
        patcher = patch("allocation.solver.close_old_connections")
        patcher.start()
        self.addCleanup(patcher.stop)

        self.dorm = DormType.objects.create(name="CombinedStrongDorm")
        self.building = Building.objects.create(
            number=1,
            dorm_type=self.dorm,
        )

    # ------------------------------------------------------------------
    # Infrastructure and data helpers
    # ------------------------------------------------------------------

    def _make_four_apartments(
        self,
        categories=None,
        reserved_indexes=None,
    ):
        """
        Build exactly four apartments.

        Each apartment contains five separate rooms, and every room contains
        one bed. This is deliberately different from one room with five beds.
        """

        categories = categories or [
            Apartment.Category.FEMALE,
            Apartment.Category.FEMALE,
            Apartment.Category.FEMALE,
            Apartment.Category.FEMALE,
        ]
        reserved_indexes = set(reserved_indexes or [])

        self.assertEqual(len(categories), 4)

        rooms = []

        for apartment_index in range(4):
            apartment = Apartment.objects.create(
                building=self.building,
                number=str(apartment_index + 1),
                category=categories[apartment_index],
                apartment_type=Apartment.ApartmentType.SINGLE,
                room_count=5,
                apartment_capacity=5,
                is_active=True,
                inactive_reason=(
                    Apartment.InactiveReason.RESERVED
                    if apartment_index in reserved_indexes
                    else ""
                ),
            )

            for room_index in range(5):
                room = Room.objects.create(
                    apartment=apartment,
                    name=f"R{room_index + 1}",
                    capacity=1,
                    is_active=True,
                )
                Bed.objects.create(
                    room=room,
                    label="Bed 1",
                )
                rooms.append(room)

        self.assertEqual(len(rooms), 20)
        return rooms

    def _student(
        self,
        student_id,
        religion,
        religious,
        *,
        gender=Student.Gender.FEMALE,
        priority=False,
        sector=Student.PlacementSector.UNKNOWN,
        points=45,
        special_status="",
    ):
        housing_type = (
            Student.HousingType.SINGLE_MALE
            if gender == Student.Gender.MALE
            else Student.HousingType.SINGLE_FEMALE
        )

        return Student.objects.create(
            student_id=student_id,
            first_name="Test",
            last_name=student_id,
            gender=gender,
            housing_type=housing_type,
            requested_religion=religion,
            religious=religious,
            placement_sector=sector,
            study_points=points,
            special_status_1=special_status,
            is_priority=priority,
        )

    def _make_mutual_positive_roommate_pair(self, student_1, student_2):
        """
        Store a real mutual positive roommate request using the current model
        fields consumed by the solver.
        """

        student_1.roommate_request_student_id_1 = student_2.student_id
        student_1.roommate_request_flag_1 = True
        student_1.save(
            update_fields=[
                "roommate_request_student_id_1",
                "roommate_request_flag_1",
            ]
        )

        student_2.roommate_request_student_id_1 = student_1.student_id
        student_2.roommate_request_flag_1 = True
        student_2.save(
            update_fields=[
                "roommate_request_student_id_1",
                "roommate_request_flag_1",
            ]
        )

    def _assignment_maps(self, result):
        assignments = result.get("proposed_assignments", [])
        student_to_apartment = {}
        by_apartment = defaultdict(list)
        by_room = defaultdict(list)

        for assignment in assignments:
            student_id = assignment["student_db_id"]
            apartment_id = assignment["apartment_id"]

            student_to_apartment[student_id] = apartment_id
            by_apartment[apartment_id].append(student_id)

            room_id = assignment.get("room_id")
            if room_id is not None:
                by_room[room_id].append(student_id)

        return student_to_apartment, by_apartment, by_room

    def _assert_capacity_and_single_occupancy(self, result):
        _, by_apartment, by_room = self._assignment_maps(result)

        for apartment_id, student_ids in by_apartment.items():
            self.assertLessEqual(
                len(student_ids),
                5,
                f"Apartment {apartment_id} exceeds capacity 5.",
            )

        for room_id, student_ids in by_room.items():
            self.assertEqual(
                len(student_ids),
                1,
                f"Room {room_id} contains more than one student.",
            )

    def _assert_religious_rules(self, result):
        """
        Validate the corrected hard rule directly from the produced allocation.

        - Religious Jewish: only Religious Jewish.
        - Religious Muslim/Christian/Druze: everyone in the apartment must have
          that same religion, while observance may differ.
        - Unrestricted students impose no restriction.
        """

        from allocation.solver import (
            _is_religious_jewish,
            _student_religious_state,
            _religion_key,
        )

        _, by_apartment, _ = self._assignment_maps(result)

        for apartment_id, student_ids in by_apartment.items():
            occupants = list(Student.objects.filter(id__in=student_ids))

            if any(_is_religious_jewish(student) for student in occupants):
                self.assertTrue(
                    all(_is_religious_jewish(student) for student in occupants),
                    f"Apartment {apartment_id} mixes Religious Jewish "
                    f"with an incompatible student.",
                )
                continue

            restricted_religions = {
                state[1]
                for student in occupants
                if (
                    (state := _student_religious_state(student)) is not None
                    and state[0] == "religion"
                )
            }

            self.assertLessEqual(
                len(restricted_religions),
                1,
                f"Apartment {apartment_id} contains different hard "
                f"religious restrictions: {restricted_religions}",
            )

            if restricted_religions:
                required_religion = next(iter(restricted_religions))
                self.assertTrue(
                    all(
                        _religion_key(student) == required_religion
                        for student in occupants
                    ),
                    f"Apartment {apartment_id} is restricted to "
                    f"{required_religion}, but contains another religion.",
                )

    def _assert_pairs_together(self, result, pairs):
        student_to_apartment, _, _ = self._assignment_maps(result)

        for student_1, student_2 in pairs:
            self.assertIn(
                student_1.id,
                student_to_apartment,
                f"{student_1.student_id} was not assigned.",
            )
            self.assertIn(
                student_2.id,
                student_to_apartment,
                f"{student_2.student_id} was not assigned.",
            )
            self.assertEqual(
                student_to_apartment[student_1.id],
                student_to_apartment[student_2.id],
                f"Mutual roommates {student_1.student_id} and "
                f"{student_2.student_id} were separated.",
            )

    def _resolve_assignment_location(self, assignment):
        """
        Resolve actual DB objects so the printed ROOM column never appears blank
        merely because a solver result omitted room_name.
        """

        bed = None

        for key in ("bed_id", "bed_db_id"):
            value = assignment.get(key)
            if value is not None:
                bed = (
                    Bed.objects.select_related("room", "room__apartment")
                    .filter(id=value)
                    .first()
                )
                if bed is not None:
                    break

        if bed is not None:
            return bed.room.apartment, bed.room, bed

        room = None
        room_id = assignment.get("room_id")
        if room_id is not None:
            room = (
                Room.objects.select_related("apartment")
                .filter(id=room_id)
                .first()
            )

        if room is not None:
            return room.apartment, room, None

        apartment = Apartment.objects.get(id=assignment["apartment_id"])
        return apartment, None, None

    def _run(self, students, rooms, config=None):
        import inspect
        from allocation.solver import run_improved_ortools_allocation

        test_name = inspect.stack()[1].function
        students = list(students)
        rooms = list(rooms)

        result = run_improved_ortools_allocation(
            students,
            rooms,
            config or self.ALL_CRITICAL_AND_FLEXIBLE,
        )

        assignments = result.get("proposed_assignments", [])
        assigned_ids = {
            assignment["student_db_id"]
            for assignment in assignments
        }

        printable_rows = []

        for assignment in assignments:
            student = Student.objects.get(
                id=assignment["student_db_id"]
            )
            apartment, room, bed = self._resolve_assignment_location(
                assignment
            )

            printable_rows.append(
                (
                    str(apartment.number),
                    str(room.name if room else assignment.get("room_name", "")),
                    str(bed.label if bed else assignment.get("bed_label", "")),
                    student,
                )
            )

        printable_rows.sort(
            key=lambda row: (
                row[0],
                row[1],
                row[2],
                row[3].student_id,
            )
        )

        print("\n" + "=" * 150)
        print(f"STRONG COMBINED TEST: {test_name}")
        print(
            f"status={result.get('solver_status')} | "
            f"students={len(students)} | "
            f"assigned={result.get('successful_assignments', 0)} | "
            f"conflicts={result.get('conflicts', 0)} | "
            f"mutual_roommate_matches="
            f"{result.get('mutual_roommate_matches', 0)} | "
            f"one_sided_roommate_matches="
            f"{result.get('one_sided_roommate_matches', 0)}"
        )
        print("=" * 150)

        if printable_rows:
            print(
                f"{'APT':<6} {'ROOM':<7} {'BED':<8} {'STUDENT':<10} "
                f"{'GENDER':<8} {'RELIGION':<14} {'RELIGIOUS':<15} "
                f"{'SECTOR':<9} {'POINTS':<8} {'STATUS':<12} "
                f"{'PRIORITY':<8} {'ROOMMATE REQUEST':<20}"
            )
            print("-" * 150)

            for apartment_number, room_name, bed_label, student in printable_rows:
                requests = [
                    student.roommate_request_student_id_1,
                    student.roommate_request_student_id_2,
                    student.roommate_request_student_id_3,
                    student.roommate_request_student_id_4,
                    student.roommate_request_student_id_5,
                ]
                request_text = ",".join(
                    request for request in requests if request
                ) or "-"

                print(
                    f"{apartment_number:<6} "
                    f"{room_name:<7} "
                    f"{bed_label:<8} "
                    f"{student.student_id:<10} "
                    f"{str(student.gender):<8} "
                    f"{student.requested_religion:<14} "
                    f"{student.religious:<15} "
                    f"{student.placement_sector:<9} "
                    f"{str(student.study_points):<8} "
                    f"{student.special_status_1:<12} "
                    f"{str(bool(student.is_priority)):<8} "
                    f"{request_text:<20}"
                )
        else:
            print("No assignments.")

        unassigned = [
            student
            for student in students
            if student.id not in assigned_ids
        ]

        if unassigned:
            print("\nUNASSIGNED")
            print(
                f"{'STUDENT':<10} {'GENDER':<8} {'RELIGION':<14} "
                f"{'RELIGIOUS':<15} {'SECTOR':<9} {'PRIORITY':<8}"
            )
            print("-" * 80)

            for student in sorted(
                unassigned,
                key=lambda item: item.student_id,
            ):
                print(
                    f"{student.student_id:<10} "
                    f"{str(student.gender):<8} "
                    f"{student.requested_religion:<14} "
                    f"{student.religious:<15} "
                    f"{student.placement_sector:<9} "
                    f"{str(bool(student.is_priority)):<8}"
                )

        print("=" * 150 + "\n")
        return result

    # ------------------------------------------------------------------
    # Test 1: all critical constraints together
    # ------------------------------------------------------------------

    def test_all_critical_constraints_together_with_20_students(self):
        """
        WHAT THIS TEST CHECKS
        ---------------------
        1. Exactly 20 students fit into 4 apartments × 5 separate rooms.
        2. Apartment 1 is reserved, so only the five priority students enter it.
        3. Female students enter female apartments and male students enter male
           apartments (sameGender + housing-type compatibility).
        4. Ten mutual positive roommate pairs remain in the same apartment
           (roommatePositiveOnly is critical).
        5. Religious Jewish students share only with Religious Jewish students.
        6. Religious Muslim, Christian and Druze students share only with their
           own religion, but may share with same-religion NO_PREFERENCE students.
        7. All flexible constraints are simultaneously enabled.
        """

        rooms = self._make_four_apartments(
            categories=[
                Apartment.Category.FEMALE,
                Apartment.Category.FEMALE,
                Apartment.Category.MALE,
                Apartment.Category.MALE,
            ],
            reserved_indexes={0},
        )

        groups = []

        # Reserved female apartment: 5 priority Religious Jewish students.
        groups.append([
            self._student(
                f"FRJ{i}",
                Student.Religion.Jewish,
                Student.Religious.RELIGIOUS,
                gender=Student.Gender.FEMALE,
                priority=True,
                sector=Student.PlacementSector.JEWISH,
                points=20,
                special_status="עתודאי",
            )
            for i in range(1, 6)
        ])

        # Female Muslim apartment.
        groups.append([
            self._student(
                "FRM1",
                Student.Religion.Muslim,
                Student.Religious.RELIGIOUS,
                gender=Student.Gender.FEMALE,
                sector=Student.PlacementSector.ARAB,
                points=80,
                special_status="הסמכה",
            ),
            *[
                self._student(
                    f"FMU{i}",
                    Student.Religion.Muslim,
                    Student.Religious.NO_PREFERENCE,
                    gender=Student.Gender.FEMALE,
                    sector=Student.PlacementSector.ARAB,
                    points=80,
                    special_status="הסמכה",
                )
                for i in range(1, 5)
            ],
        ])

        # Male Christian apartment.
        groups.append([
            self._student(
                "MRC1",
                Student.Religion.Christian,
                Student.Religious.RELIGIOUS,
                gender=Student.Gender.MALE,
                sector=Student.PlacementSector.ARAB,
                points=20,
                special_status="עתודאי",
            ),
            *[
                self._student(
                    f"MCU{i}",
                    Student.Religion.Christian,
                    Student.Religious.NO_PREFERENCE,
                    gender=Student.Gender.MALE,
                    sector=Student.PlacementSector.ARAB,
                    points=20,
                    special_status="עתודאי",
                )
                for i in range(1, 5)
            ],
        ])

        # Male Druze apartment.
        groups.append([
            self._student(
                "MRD1",
                Student.Religion.Druze,
                Student.Religious.RELIGIOUS,
                gender=Student.Gender.MALE,
                sector=Student.PlacementSector.ARAB,
                points=80,
                special_status="הסמכה",
            ),
            *[
                self._student(
                    f"MDU{i}",
                    Student.Religion.Druze,
                    Student.Religious.NO_PREFERENCE,
                    gender=Student.Gender.MALE,
                    sector=Student.PlacementSector.ARAB,
                    points=80,
                    special_status="הסמכה",
                )
                for i in range(1, 5)
            ],
        ])

        students = [
            student
            for group in groups
            for student in group
        ]

        roommate_pairs = []

        # Two hard mutual pairs in every five-person group.
        for group in groups:
            for first_index, second_index in ((0, 1), (2, 3)):
                first = group[first_index]
                second = group[second_index]
                self._make_mutual_positive_roommate_pair(first, second)
                roommate_pairs.append((first, second))

        result = self._run(students, rooms)

        self.assertEqual(
            result["successful_assignments"],
            20,
            result.get("proposed_assignments"),
        )
        self.assertEqual(result["conflicts"], 0)

        self._assert_capacity_and_single_occupancy(result)
        self._assert_religious_rules(result)
        self._assert_pairs_together(result, roommate_pairs)

        student_to_apartment, by_apartment, _ = self._assignment_maps(result)

        reserved_apartment = Apartment.objects.get(
            building=self.building,
            number="1",
        )

        reserved_student_ids = set(
            by_apartment.get(reserved_apartment.id, [])
        )

        expected_priority_ids = {
            student.id
            for student in groups[0]
        }

        self.assertEqual(
            reserved_student_ids,
            expected_priority_ids,
            "The reserved apartment must contain exactly the five "
            "priority students.",
        )

        for apartment_id, student_ids in by_apartment.items():
            occupants = list(Student.objects.filter(id__in=student_ids))
            genders = {student.gender for student in occupants}
            self.assertEqual(
                len(genders),
                1,
                f"Apartment {apartment_id} mixes genders: {genders}",
            )

    # ------------------------------------------------------------------
    # Test 2: two critical constraints conflict
    # ------------------------------------------------------------------

    def test_critical_roommate_request_cannot_break_critical_religion(self):
        """
        WHAT THIS TEST CHECKS
        ---------------------
        A Religious Jewish student and a Muslim NO_PREFERENCE student request
        each other as critical positive roommates.

        Hard roommate logic says they must share an apartment if both are placed.
        Hard religion logic says they may never share.

        Therefore the solver must not assign both students. It must preserve both
        hard constraints instead of silently violating either one.
        """

        rooms = self._make_four_apartments()

        religious_jewish = self._student(
            "CRJ",
            Student.Religion.Jewish,
            Student.Religious.RELIGIOUS,
            sector=Student.PlacementSector.JEWISH,
        )
        muslim = self._student(
            "CMU",
            Student.Religion.Muslim,
            Student.Religious.NO_PREFERENCE,
            sector=Student.PlacementSector.ARAB,
        )

        self._make_mutual_positive_roommate_pair(
            religious_jewish,
            muslim,
        )

        fillers = [
            self._student(
                f"CF{i:02}",
                [
                    Student.Religion.Jewish,
                    Student.Religion.Muslim,
                    Student.Religion.Christian,
                    Student.Religion.Druze,
                ][i % 4],
                Student.Religious.NO_PREFERENCE,
                sector=(
                    Student.PlacementSector.JEWISH
                    if i % 4 == 0
                    else Student.PlacementSector.ARAB
                ),
            )
            for i in range(18)
        ]

        students = [
            religious_jewish,
            muslim,
            *fillers,
        ]

        result = self._run(students, rooms)

        assigned_ids = {
            assignment["student_db_id"]
            for assignment in result["proposed_assignments"]
        }

        self.assertFalse(
            religious_jewish.id in assigned_ids
            and muslim.id in assigned_ids,
            "The incompatible critical roommate pair was assigned together.",
        )

        self.assertGreaterEqual(result["conflicts"], 1)
        self._assert_capacity_and_single_occupancy(result)
        self._assert_religious_rules(result)

    # ------------------------------------------------------------------
    # Test 3: flexible roommate preference never overrides a hard rule
    # ------------------------------------------------------------------

    def test_flexible_roommate_preference_does_not_override_religion(self):
        """
        WHAT THIS TEST CHECKS
        ---------------------
        The same incompatible pair is now a FLEXIBLE roommate preference:
        roommateMatch is enabled, but roommatePositiveOnly is disabled.

        Because religion is critical and roommate matching is flexible:
        - both students may still be assigned,
        - but they must be assigned to different apartments,
        - and all 20 students should fit.
        """

        rooms = self._make_four_apartments()

        religious_jewish = self._student(
            "SRJ",
            Student.Religion.Jewish,
            Student.Religious.RELIGIOUS,
            sector=Student.PlacementSector.JEWISH,
        )
        muslim = self._student(
            "SMU",
            Student.Religion.Muslim,
            Student.Religious.NO_PREFERENCE,
            sector=Student.PlacementSector.ARAB,
        )

        self._make_mutual_positive_roommate_pair(
            religious_jewish,
            muslim,
        )

        # Four more RJ students allow a valid RJ-only apartment.
        rj_fillers = [
            self._student(
                f"SRJF{i}",
                Student.Religion.Jewish,
                Student.Religious.RELIGIOUS,
                sector=Student.PlacementSector.JEWISH,
            )
            for i in range(1, 5)
        ]

        unrestricted_fillers = [
            self._student(
                f"SU{i:02}",
                [
                    Student.Religion.Muslim,
                    Student.Religion.Christian,
                    Student.Religion.Druze,
                ][i % 3],
                Student.Religious.NO_PREFERENCE,
                sector=Student.PlacementSector.ARAB,
            )
            for i in range(14)
        ]

        students = [
            religious_jewish,
            muslim,
            *rj_fillers,
            *unrestricted_fillers,
        ]

        self.assertEqual(len(students), 20)

        result = self._run(
            students,
            rooms,
            config=self.FLEXIBLE_ROOMMATE_CONFIG,
        )

        self.assertEqual(
            result["successful_assignments"],
            20,
            result["proposed_assignments"],
        )
        self.assertEqual(result["conflicts"], 0)

        student_to_apartment, _, _ = self._assignment_maps(result)

        self.assertNotEqual(
            student_to_apartment[religious_jewish.id],
            student_to_apartment[muslim.id],
            "A flexible roommate preference overrode critical religion.",
        )

        self._assert_capacity_and_single_occupancy(result)
        self._assert_religious_rules(result)

    # ------------------------------------------------------------------
    # Test 4: all flexible preferences guide the optimizer together
    # ------------------------------------------------------------------

    def test_all_flexible_preferences_organize_20_students(self):
        """
        WHAT THIS TEST CHECKS
        ---------------------
        There are no religious students, so hard ReligiousTogether imposes no
        grouping restriction. All 20 students remain feasible.

        The 20 students form four natural five-person groups distinguished by:
        - religion,
        - placement sector,
        - study-year group,
        - Atudai versus Hasmaha status,
        - mutual roommate requests.

        With all flexible weights enabled, the optimal result should keep every
        apartment internally homogeneous for those soft attributes and keep the
        requested roommate pairs together.

        This directly exercises:
        - sameReligion,
        - roommateMatch,
        - sectorMatching,
        - avoidYearMix_1_with_3_4,
        - avoidAtudaimWithHasmaha.
        """

        rooms = self._make_four_apartments()

        group_specs = [
            (
                "A",
                Student.Religion.Jewish,
                Student.PlacementSector.JEWISH,
                20,
                "עתודאי",
            ),
            (
                "B",
                Student.Religion.Muslim,
                Student.PlacementSector.ARAB,
                80,
                "הסמכה",
            ),
            (
                "C",
                Student.Religion.Christian,
                Student.PlacementSector.ARAB,
                20,
                "עתודאי",
            ),
            (
                "D",
                Student.Religion.Druze,
                Student.PlacementSector.ARAB,
                80,
                "הסמכה",
            ),
        ]

        groups = []
        roommate_pairs = []

        for prefix, religion, sector, points, special_status in group_specs:
            group = [
                self._student(
                    f"{prefix}{index}",
                    religion,
                    Student.Religious.NO_PREFERENCE,
                    sector=sector,
                    points=points,
                    special_status=special_status,
                )
                for index in range(1, 6)
            ]
            groups.append(group)

            self._make_mutual_positive_roommate_pair(
                group[0],
                group[1],
            )
            self._make_mutual_positive_roommate_pair(
                group[2],
                group[3],
            )

            roommate_pairs.extend([
                (group[0], group[1]),
                (group[2], group[3]),
            ])

        students = [
            student
            for group in groups
            for student in group
        ]

        result = self._run(
            students,
            rooms,
            config=self.FLEXIBLE_ROOMMATE_CONFIG,
        )

        self.assertEqual(
            result["successful_assignments"],
            20,
            result["proposed_assignments"],
        )
        self.assertEqual(result["conflicts"], 0)

        self._assert_capacity_and_single_occupancy(result)
        self._assert_pairs_together(result, roommate_pairs)

        _, by_apartment, _ = self._assignment_maps(result)

        self.assertEqual(
            len(by_apartment),
            4,
            "All four apartments should be used.",
        )

        for apartment_id, student_ids in by_apartment.items():
            occupants = list(Student.objects.filter(id__in=student_ids))

            self.assertEqual(
                len(occupants),
                5,
                f"Apartment {apartment_id} should contain exactly 5 students.",
            )

            religions = {
                student.requested_religion
                for student in occupants
            }
            sectors = {
                student.placement_sector
                for student in occupants
            }
            year_groups = {
                "year1"
                if float(student.study_points or 0) <= 40
                else "year3_4"
                if float(student.study_points or 0) >= 60
                else "other"
                for student in occupants
            }
            statuses = {
                "atudai"
                if "עתודאי" in student.special_status_1
                else "hasmaha"
                if "הסמכה" in student.special_status_1
                else "other"
                for student in occupants
            }

            self.assertEqual(
                len(religions),
                1,
                f"sameReligion did not keep apartment {apartment_id} homogeneous.",
            )
            self.assertEqual(
                len(sectors),
                1,
                f"sectorMatching did not keep apartment {apartment_id} homogeneous.",
            )
            self.assertEqual(
                len(year_groups),
                1,
                f"Year-mix preference was violated in apartment {apartment_id}.",
            )
            self.assertEqual(
                len(statuses),
                1,
                f"Atudai/Hasmaha preference was violated in apartment {apartment_id}.",
            )


# ---------------------------------------------------------------------------
# Upper Dorm Office / building-179 exclusive-group policy
# ---------------------------------------------------------------------------

class SolverBuilding179PriorityTest(TestCase):
    """
    Focused tests for the Upper Dorm Office building-179 exclusive-group
    policy implemented in allocation/solver.py.

    Business rule under test:
      - A student belongs to the building-179 exclusive group only when ALL
        FOUR characteristics hold: is_priority, belongs to הסמכה (special
        status), carries the אנייר special status, and the allocation is
        for the Upper Dorm Office region.
      - Exclusive-group students may be assigned only to building 179 (any
        apartment/bed in it, not merely RESERVED ones) and remain
        unassigned rather than fall back to another building.
      - Building 179 in the Upper Dorm Office region rejects every student
        who is not in the exact exclusive group.
      - Other priority students are not restricted to, and may not enter,
        building 179; they may bypass their imported accepted_dorm_type and
        are softly clustered into as few buildings as possible.
      - Ordinary non-priority students are unaffected by any of this.

    NOTE ON DATA ASSUMPTIONS (see final report): no region record for the
    "Upper Dorm Office" and no literal 'אנייר' value exist anywhere else in
    this repository. The Region below uses id='upper_dorm_office', which
    allocation/solver.py recognizes via UPPER_DORM_OFFICE_REGION_IDS.
    """

    UPPER_OFFICE_CONFIG = {
        "sameGender": {"enabled": True, "strict": True, "critical": True, "weight": 0},
        "priorityFirst": {"enabled": True, "strict": True, "critical": True, "weight": 0},
        "roommatePositiveOnly": {"enabled": True, "strict": True, "critical": True, "weight": 0},
        "ReligiousTogether": {"enabled": True, "strict": True, "critical": True, "weight": 0},
        "sameReligion": {"enabled": False},
        "roommateMatch": {"enabled": False},
        "sectorMatching": {"enabled": False},
        "avoidYearMix_1_with_3_4": {"enabled": False},
        "avoidAtudaimWithHasmaha": {"enabled": False},
    }

    def setUp(self):
        patcher = patch("allocation.solver.close_old_connections")
        patcher.start()
        self.addCleanup(patcher.stop)

        # The Upper Dorm Office region and its buildings.
        self.upper_region = Region.objects.create(
            id="upper_dorm_office",
            name="מעונות הלשכה העליונה",
        )
        self.dorm_type_a = DormType.objects.create(
            name="UpperOfficeDormA", region=self.upper_region,
        )
        self.dorm_type_b = DormType.objects.create(
            name="UpperOfficeDormB", region=self.upper_region,
        )

        self.building_179 = Building.objects.create(number=179, dorm_type=self.dorm_type_a)
        self.building_101 = Building.objects.create(number=101, dorm_type=self.dorm_type_a)
        self.building_102 = Building.objects.create(number=102, dorm_type=self.dorm_type_b)

        # A second, unrelated region that also happens to have a building
        # numbered 179 — used to verify region scoping (test 15).
        self.other_region = Region.objects.create(id="other_region", name="אזור אחר")
        self.other_dorm_type = DormType.objects.create(
            name="OtherRegionDorm", region=self.other_region,
        )
        self.other_building_179 = Building.objects.create(
            number=179, dorm_type=self.other_dorm_type,
        )

    # ------------------------------------------------------------------
    # Infrastructure helpers
    # ------------------------------------------------------------------

    def _make_room(
        self,
        building,
        apt_number,
        category=Apartment.Category.FEMALE,
        apartment_type=Apartment.ApartmentType.SINGLE,
        bed_count=2,
        room_name="A",
    ):
        apartment = Apartment.objects.create(
            building=building,
            number=apt_number,
            category=category,
            apartment_type=apartment_type,
            room_count=1,
            apartment_capacity=bed_count,
            is_active=True,
        )
        room = Room.objects.create(apartment=apartment, name=room_name, capacity=bed_count)
        for index in range(bed_count):
            Bed.objects.create(room=room, label=str(index + 1))
        return room

    def _make_student(
        self,
        student_id,
        *,
        gender=Student.Gender.FEMALE,
        priority=False,
        hasmaha=False,
        anier=False,
        accepted_dorm_type=None,
        religion=Student.Religion.NOT_SPECIFIED,
        religious=Student.Religious.NOT_SPECIFIED,
    ):
        housing_type = (
            Student.HousingType.SINGLE_MALE
            if gender == Student.Gender.MALE
            else Student.HousingType.SINGLE_FEMALE
        )

        return Student.objects.create(
            student_id=student_id,
            first_name="Test",
            last_name=student_id,
            gender=gender,
            housing_type=housing_type,
            is_priority=priority,
            special_status_1="הסמכה" if hasmaha else "",
            special_status_2="אנייר" if anier else "",
            accepted_dorm_type=accepted_dorm_type,
            requested_religion=religion,
            religious=religious,
        )

    def _make_mutual_positive_roommate_pair(self, student_1, student_2):
        student_1.roommate_request_student_id_1 = student_2.student_id
        student_1.roommate_request_flag_1 = True
        student_1.save(update_fields=["roommate_request_student_id_1", "roommate_request_flag_1"])

        student_2.roommate_request_student_id_1 = student_1.student_id
        student_2.roommate_request_flag_1 = True
        student_2.save(update_fields=["roommate_request_student_id_1", "roommate_request_flag_1"])

    def _resolve_assignment_location(self, assignment):
        bed = Bed.objects.select_related(
            "room", "room__apartment", "room__apartment__building",
            "room__apartment__building__dorm_type",
        ).get(id=assignment["bed_id"])
        return bed.room.apartment, bed.room, bed

    def _assignment_maps(self, result):
        assignments = result.get("proposed_assignments", [])
        student_to_building = {}
        student_to_apartment = {}
        by_building = defaultdict(list)

        for assignment in assignments:
            apartment, room, bed = self._resolve_assignment_location(assignment)
            student_id = assignment["student_db_id"]
            student_to_building[student_id] = apartment.building_id
            student_to_apartment[student_id] = apartment.id
            by_building[apartment.building_id].append(student_id)

        return student_to_building, student_to_apartment, by_building

    def _run(self, students, rooms, config=None):
        import inspect
        from allocation.solver import (
            run_improved_ortools_allocation,
            _is_building_179_exclusive_student,
        )

        test_name = inspect.stack()[1].function
        students = list(students)
        rooms = list(rooms)

        result = run_improved_ortools_allocation(
            students,
            rooms,
            config or self.UPPER_OFFICE_CONFIG,
        )

        assignments = result.get("proposed_assignments", [])
        assigned_ids = {item["student_db_id"] for item in assignments}

        printable_rows = []
        for assignment in assignments:
            student = Student.objects.get(id=assignment["student_db_id"])
            apartment, room, bed = self._resolve_assignment_location(assignment)
            region = apartment.building.dorm_type.region
            printable_rows.append((apartment, room, bed, student, region))

        printable_rows.sort(
            key=lambda row: (
                row[0].building.number or 0,
                str(row[0].number),
                str(row[1].name),
                str(row[2].label),
            )
        )

        print("\n" + "=" * 160)
        print(f"BUILDING-179 / UPPER DORM OFFICE TEST: {test_name}")
        print(
            f"status={result.get('solver_status')} | students={len(students)} | "
            f"assigned={result.get('successful_assignments', 0)} | "
            f"conflicts={result.get('conflicts', 0)}"
        )
        print("=" * 160)

        if printable_rows:
            print(
                f"{'BLDG':<6} {'DORMTYPE':<16} {'APT':<6} {'ROOM':<6} {'BED':<6} "
                f"{'STUDENT':<10} {'ACC.DORM':<16} {'PRIORITY':<9} {'STATUSES':<16} "
                f"{'EXCLUSIVE179':<12}"
            )
            print("-" * 160)
            for apartment, room, bed, student, region in printable_rows:
                accepted = student.accepted_dorm_type.name if student.accepted_dorm_type_id else "-"
                statuses = " | ".join(
                    value
                    for value in (
                        student.special_status_1,
                        student.special_status_2,
                        student.special_status_3,
                        student.special_status_4,
                    )
                    if value
                ) or "-"
                is_exclusive = _is_building_179_exclusive_student(student, apartment)
                print(
                    f"{str(apartment.building.number):<6} "
                    f"{apartment.building.dorm_type.name:<16} "
                    f"{str(apartment.number):<6} "
                    f"{str(room.name):<6} "
                    f"{str(bed.label):<6} "
                    f"{student.student_id:<10} "
                    f"{accepted:<16} "
                    f"{str(bool(student.is_priority)):<9} "
                    f"{statuses:<16} "
                    f"{str(bool(is_exclusive)):<12}"
                )
        else:
            print("No assignments.")

        unassigned = [student for student in students if student.id not in assigned_ids]
        if unassigned:
            print("\nUNASSIGNED")
            print(f"{'STUDENT':<10} {'PRIORITY':<9} {'STATUSES':<16}")
            print("-" * 60)
            for student in sorted(unassigned, key=lambda item: item.student_id):
                statuses = " | ".join(
                    value
                    for value in (
                        student.special_status_1,
                        student.special_status_2,
                        student.special_status_3,
                        student.special_status_4,
                    )
                    if value
                ) or "-"
                print(f"{student.student_id:<10} {str(bool(student.is_priority)):<9} {statuses:<16}")

        print("=" * 160 + "\n")
        return result

    # ------------------------------------------------------------------
    # 1. Exact exclusive-group student is assigned to building 179.
    # ------------------------------------------------------------------

    def test_exclusive_group_student_assigned_to_building_179(self):
        """An exact exclusive-group student (priority + הסמכה + אנייר, Upper
        Dorm Office region) is assigned into building 179."""
        room179 = self._make_room(self.building_179, "1", bed_count=2)

        student = self._make_student(
            "EX1", priority=True, hasmaha=True, anier=True,
        )

        result = self._run([student], [room179])
        self.assertEqual(result["successful_assignments"], 1, result["proposed_assignments"])

        by_building, _, _ = self._assignment_maps(result)
        self.assertEqual(by_building[student.id], self.building_179.id)

        payload = result["proposed_assignments"][0]
        bed = Bed.objects.get(id=payload["bed_id"])
        self.assertEqual(bed.room.apartment.building.number, 179)
        self.assertIsNotNone(bed.room)
        self.assertIsNotNone(bed)

    # ------------------------------------------------------------------
    # 2. Exclusive-group student cannot be assigned to any other building;
    #    remains unassigned when building 179 has no compatible free bed.
    # ------------------------------------------------------------------

    def test_exclusive_group_student_unassigned_when_building_179_full(self):
        """When building 179 has no free bed, an exclusive-group student
        must remain unassigned rather than fall back to another building."""
        room179 = self._make_room(self.building_179, "1", bed_count=1)
        room101 = self._make_room(self.building_101, "1", bed_count=2)

        existing_occupant = self._make_student(
            "EXOLD", priority=True, hasmaha=True, anier=True,
        )
        BedAssignment.objects.create(
            student=existing_occupant,
            bed=room179.beds.first(),
            status=BedAssignment.Status.ACTIVE,
            assignment_type=BedAssignment.AssignmentType.MANUAL,
        )

        new_student = self._make_student(
            "EX2", priority=True, hasmaha=True, anier=True,
        )

        result = self._run([new_student], [room179, room101])
        self.assertEqual(result["successful_assignments"], 0, result["proposed_assignments"])
        assigned_ids = {item["student_db_id"] for item in result["proposed_assignments"]}
        self.assertNotIn(new_student.id, assigned_ids)

        # The pre-existing occupant's assignment must remain untouched.
        existing_assignment = BedAssignment.objects.get(student=existing_occupant)
        self.assertEqual(existing_assignment.status, BedAssignment.Status.ACTIVE)
        self.assertEqual(existing_assignment.bed_id, room179.beds.first().id)

    # ------------------------------------------------------------------
    # 3. Building 179 rejects a non-priority student.
    # ------------------------------------------------------------------

    def test_building_179_rejects_non_priority_student(self):
        """A non-priority student (no special status at all) cannot enter
        building 179 and remains unassigned when it is the only option."""
        room179 = self._make_room(self.building_179, "1", bed_count=2)
        student = self._make_student("NP1", priority=False)

        result = self._run([student], [room179])
        self.assertEqual(result["successful_assignments"], 0, result["proposed_assignments"])

    # ------------------------------------------------------------------
    # 4. Building 179 rejects a priority student without אנייר.
    # ------------------------------------------------------------------

    def test_building_179_rejects_priority_student_without_anier(self):
        """A priority student who lacks the אנייר special status (and also
        lacks הסמכה) cannot enter building 179."""
        room179 = self._make_room(self.building_179, "1", bed_count=2)
        student = self._make_student("NA1", priority=True, hasmaha=False, anier=False)

        result = self._run([student], [room179])
        self.assertEqual(result["successful_assignments"], 0, result["proposed_assignments"])

    # ------------------------------------------------------------------
    # 5. Building 179 rejects a priority + הסמכה student lacking אנייר.
    # ------------------------------------------------------------------

    def test_building_179_rejects_priority_hasmaha_without_anier(self):
        """A priority student who belongs to הסמכה but does NOT carry the
        אנייר status still cannot enter building 179."""
        room179 = self._make_room(self.building_179, "1", bed_count=2)
        student = self._make_student("NA2", priority=True, hasmaha=True, anier=False)

        result = self._run([student], [room179])
        self.assertEqual(result["successful_assignments"], 0, result["proposed_assignments"])

    # ------------------------------------------------------------------
    # 6. Building 179 rejects a student with אנייר missing another
    #    required characteristic (priority).
    # ------------------------------------------------------------------

    def test_building_179_rejects_anier_student_missing_priority(self):
        """A student who carries הסמכה and אנייר but is NOT flagged priority
        still cannot enter building 179 — is_priority alone (or its absence)
        must not be the deciding factor."""
        room179 = self._make_room(self.building_179, "1", bed_count=2)
        student = self._make_student("NA3", priority=False, hasmaha=True, anier=True)

        result = self._run([student], [room179])
        self.assertEqual(result["successful_assignments"], 0, result["proposed_assignments"])

    # ------------------------------------------------------------------
    # 7. Non-exclusive priority student may be assigned outside their
    #    imported accepted_dorm_type.
    # ------------------------------------------------------------------

    def test_non_exclusive_priority_student_bypasses_accepted_dorm_type(self):
        """A priority student who is not in the building-179 exclusive
        group may be placed outside their imported accepted_dorm_type."""
        room101 = self._make_room(self.building_101, "1", bed_count=2)

        student = self._make_student(
            "PRI_BYPASS", priority=True,
            accepted_dorm_type=self.dorm_type_b,
        )

        result = self._run([student], [room101])
        self.assertEqual(result["successful_assignments"], 1, result["proposed_assignments"])
        _, student_to_apartment, _ = self._assignment_maps(result)
        self.assertEqual(student_to_apartment[student.id], room101.apartment.id)

    # ------------------------------------------------------------------
    # 8. A normal non-priority student still respects accepted_dorm_type.
    # ------------------------------------------------------------------

    def test_non_priority_student_respects_accepted_dorm_type(self):
        """An ordinary non-priority student is only assignable within their
        imported accepted_dorm_type, even when a closer building exists."""
        room101 = self._make_room(self.building_101, "1", bed_count=2)  # dorm_type_a
        room102 = self._make_room(self.building_102, "1", bed_count=2)  # dorm_type_b

        student = self._make_student(
            "NP_STRICT", priority=False,
            accepted_dorm_type=self.dorm_type_b,
        )

        result = self._run([student], [room101, room102])
        self.assertEqual(result["successful_assignments"], 1, result["proposed_assignments"])
        _, student_to_apartment, _ = self._assignment_maps(result)
        self.assertEqual(student_to_apartment[student.id], room102.apartment.id)

    # ------------------------------------------------------------------
    # 9. Multiple non-exclusive priority students cluster into the same
    #    building when capacity allows and all else is equal.
    # ------------------------------------------------------------------

    def test_non_exclusive_priority_students_cluster_same_building(self):
        """Two non-exclusive priority students, with no other factor to
        distinguish them, are preferably placed in the same building."""
        room101 = self._make_room(self.building_101, "1", bed_count=2)
        room102 = self._make_room(self.building_102, "1", bed_count=2)

        student_1 = self._make_student("CL1", priority=True)
        student_2 = self._make_student("CL2", priority=True)

        result = self._run([student_1, student_2], [room101, room102])
        self.assertEqual(result["successful_assignments"], 2, result["proposed_assignments"])

        by_building, _, _ = self._assignment_maps(result)
        self.assertEqual(
            by_building[student_1.id], by_building[student_2.id],
            "Non-exclusive priority students should be clustered into the same building.",
        )

    # ------------------------------------------------------------------
    # 10. When one building lacks capacity, priority students spread across
    #     buildings and the solver still maximizes total assignments.
    # ------------------------------------------------------------------

    def test_priority_students_spread_when_capacity_forces_it(self):
        """3 non-exclusive priority students but only 1 free bed in building
        101 and 2 in building 102: all 3 must still be assigned, spread
        across both buildings — clustering never reduces total assignment."""
        room101 = self._make_room(self.building_101, "1", bed_count=1)
        room102 = self._make_room(self.building_102, "1", bed_count=2)

        students = [self._make_student(f"SP{i}", priority=True) for i in range(1, 4)]

        result = self._run(students, [room101, room102])
        self.assertEqual(result["successful_assignments"], 3, result["proposed_assignments"])

        by_building, _, by_building_map = self._assignment_maps(result)
        buildings_used = set(by_building.values())
        self.assertEqual(
            buildings_used,
            {self.building_101.id, self.building_102.id},
            "Capacity shortage should force use of both buildings.",
        )

    # ------------------------------------------------------------------
    # 11. Priority grouping never overrides gender/housing compatibility.
    # ------------------------------------------------------------------

    def test_priority_clustering_never_overrides_gender(self):
        """A female and a male non-exclusive priority student cannot be
        clustered into the same apartment/building when only gender-
        appropriate apartments exist for each of them."""
        room101_female = self._make_room(
            self.building_101, "1", category=Apartment.Category.FEMALE, bed_count=2,
        )
        room102_male = self._make_room(
            self.building_102, "1", category=Apartment.Category.MALE, bed_count=2,
        )

        female_student = self._make_student("GF1", gender=Student.Gender.FEMALE, priority=True)
        male_student = self._make_student("GM1", gender=Student.Gender.MALE, priority=True)

        result = self._run(
            [female_student, male_student],
            [room101_female, room102_male],
        )
        self.assertEqual(result["successful_assignments"], 2, result["proposed_assignments"])

        by_building, _, _ = self._assignment_maps(result)
        self.assertEqual(by_building[female_student.id], self.building_101.id)
        self.assertEqual(by_building[male_student.id], self.building_102.id)

    # ------------------------------------------------------------------
    # 12. Priority grouping never overrides the hard religious rule.
    # ------------------------------------------------------------------

    def test_priority_clustering_never_overrides_religion(self):
        """A Religious Jewish and a Religious Muslim non-exclusive priority
        student cannot share the one apartment in building 101 (hard
        ReligiousTogether); the solver must still assign both, splitting
        them across buildings instead of clustering them together."""
        room101 = self._make_room(self.building_101, "1", bed_count=2)
        room102 = self._make_room(self.building_102, "1", bed_count=2)

        rj_student = self._make_student(
            "RELJ", priority=True,
            religion=Student.Religion.Jewish, religious=Student.Religious.RELIGIOUS,
        )
        muslim_student = self._make_student(
            "RELM", priority=True,
            religion=Student.Religion.Muslim, religious=Student.Religious.RELIGIOUS,
        )

        result = self._run([rj_student, muslim_student], [room101, room102])
        self.assertEqual(result["successful_assignments"], 2, result["proposed_assignments"])

        _, student_to_apartment, _ = self._assignment_maps(result)
        self.assertNotEqual(
            student_to_apartment[rj_student.id],
            student_to_apartment[muslim_student.id],
            "Incompatible religious students must not share an apartment "
            "even though clustering would prefer it.",
        )

    # ------------------------------------------------------------------
    # 13. A hard mutual roommate request cannot force an exclusive-group
    #     student out of 179, or a non-exclusive student into 179.
    # ------------------------------------------------------------------

    def test_mutual_roommate_request_cannot_breach_building_179_policy(self):
        """An exclusive-group student in building 179 and a non-exclusive
        priority student request each other as mutual positive roommates.
        Since they can never share an apartment (their candidate apartments
        never overlap), the solver may leave one or both unassigned, but it
        must never move the exclusive student out of 179 or let the
        non-exclusive student into 179."""
        room179 = self._make_room(self.building_179, "1", bed_count=2)
        room101 = self._make_room(self.building_101, "1", bed_count=2)

        exclusive_student = self._make_student(
            "MR_EX", priority=True, hasmaha=True, anier=True,
        )
        non_exclusive_student = self._make_student(
            "MR_NE", priority=True,
        )
        self._make_mutual_positive_roommate_pair(exclusive_student, non_exclusive_student)

        result = self._run(
            [exclusive_student, non_exclusive_student],
            [room179, room101],
        )

        by_building, _, _ = self._assignment_maps(result)

        if exclusive_student.id in by_building:
            self.assertEqual(by_building[exclusive_student.id], self.building_179.id)
        if non_exclusive_student.id in by_building:
            self.assertNotEqual(by_building[non_exclusive_student.id], self.building_179.id)

    # ------------------------------------------------------------------
    # 14. Existing active assignments in building 179 are not deleted or
    #     modified.
    # ------------------------------------------------------------------

    def test_existing_building_179_assignment_untouched_and_warned(self):
        """An existing occupant of building 179 who does NOT belong to the
        exclusive group keeps their active assignment unchanged, and the
        solver surfaces a clear diagnostic warning instead of silently
        producing a misleading allocation."""
        room179 = self._make_room(self.building_179, "1", bed_count=2)

        legacy_occupant = self._make_student("LEGACY1", priority=False)
        legacy_bed = room179.beds.first()
        BedAssignment.objects.create(
            student=legacy_occupant,
            bed=legacy_bed,
            status=BedAssignment.Status.ACTIVE,
            assignment_type=BedAssignment.AssignmentType.MANUAL,
        )

        other_student = self._make_student("OTHER1", priority=False)
        room101 = self._make_room(self.building_101, "1", bed_count=2)

        result = self._run([other_student], [room179, room101])

        legacy_assignment = BedAssignment.objects.get(student=legacy_occupant)
        self.assertEqual(legacy_assignment.status, BedAssignment.Status.ACTIVE)
        self.assertEqual(legacy_assignment.bed_id, legacy_bed.id)

        self.assertTrue(
            any("179" in warning and "exclusive group" in warning for warning in result["warnings"]),
            f"Expected a building-179 existing-occupant warning, got: {result['warnings']}",
        )

    # ------------------------------------------------------------------
    # 15. A building numbered 179 in another region is not accidentally
    #     treated as the Upper Office's exclusive building.
    # ------------------------------------------------------------------

    def test_building_179_in_other_region_is_not_exclusive(self):
        """Building 179 belonging to a different (non-Upper-Office) region
        behaves like an ordinary building: an otherwise-non-priority
        student can freely enter it."""
        other_room179 = self._make_room(self.other_building_179, "1", bed_count=2)
        student = self._make_student("SCOPE1", priority=False)

        result = self._run([student], [other_room179])
        self.assertEqual(result["successful_assignments"], 1, result["proposed_assignments"])
        _, student_to_apartment, _ = self._assignment_maps(result)
        self.assertEqual(student_to_apartment[student.id], other_room179.apartment.id)

    # ------------------------------------------------------------------
    # 16. Mixed end-to-end scenario.
    # ------------------------------------------------------------------

    def test_mixed_scenario_ordinary_priority_and_exclusive_students(self):
        """
        End-to-end scenario mixing ordinary students, non-exclusive priority
        students and exclusive building-179 students. Verifies:
          - every exclusive student is either in building 179 or unassigned;
          - every new occupant of building 179 belongs to the exclusive group;
          - no non-exclusive priority student is in building 179;
          - ordinary students still follow accepted_dorm_type;
          - all apartment capacities and hard constraints remain valid.
        """
        room179 = self._make_room(self.building_179, "1", bed_count=2)
        room101 = self._make_room(self.building_101, "1", bed_count=2)
        room102 = self._make_room(self.building_102, "1", bed_count=2)

        exclusive_students = [
            self._make_student(f"MIX_EX{i}", priority=True, hasmaha=True, anier=True)
            for i in range(1, 3)
        ]
        non_exclusive_priority_students = [
            self._make_student(f"MIX_PR{i}", priority=True)
            for i in range(1, 3)
        ]
        ordinary_students = [
            self._make_student(
                f"MIX_ORD{i}", priority=False, accepted_dorm_type=self.dorm_type_b,
            )
            for i in range(1, 2)
        ]

        students = exclusive_students + non_exclusive_priority_students + ordinary_students
        result = self._run(students, [room179, room101, room102])

        student_to_building, student_to_apartment, by_building = self._assignment_maps(result)

        for student in exclusive_students:
            if student.id in student_to_building:
                self.assertEqual(student_to_building[student.id], self.building_179.id)

        for student_id in by_building.get(self.building_179.id, []):
            occupant = Student.objects.get(id=student_id)
            self.assertTrue(
                occupant.is_priority and "הסמכה" in occupant.special_status_1
                and "אנייר" in occupant.special_status_2,
                f"Non-exclusive student {occupant.student_id} found in building 179.",
            )

        for student in non_exclusive_priority_students:
            if student.id in student_to_building:
                self.assertNotEqual(student_to_building[student.id], self.building_179.id)

        for student in ordinary_students:
            if student.id in student_to_apartment:
                self.assertEqual(student_to_apartment[student.id], room102.apartment.id)


# ---------------------------------------------------------------------------
# Priority vs. accessibility: is_priority must come only from
# special_status_1..4, never from accessibility/medical import data.
# ---------------------------------------------------------------------------

class StudentPriorityImportTest(TestCase):
    """
    Regression tests for the separation of accessibility from is_priority
    in the Excel importer (api/views.py: build_student_payload_from_row,
    is_accessibility_priority, priority_fields_from_special_statuses).

    Accessible students are still allocated manually by the dorm office, so
    accessibility/medical columns must keep being read and parsed by the
    importer — they must simply never set is_priority, feed the solver's
    priorityFirst score, affect building-179 exclusivity, or influence
    priority-clustering.
    """

    def _make_row(self, **overrides):
        import pandas as pd

        values = {
            'ת"ז ישראלית': overrides.pop('student_id', 'IMP1'),
            'שם פרטי': overrides.pop('first_name', 'Test'),
            'שם משפחה': overrides.pop('last_name', 'Student'),
            'תיאור סוג מגורים': overrides.pop('housing_type', 'רווקות'),
        }

        alias_to_header = {
            'accessibility_flag': 'החלטה-זקוק להנגשה',
            'disability_percent': '%נכות',
            'medical_reason': 'סיבה רפואית מאושרת מרופאת הטכניון',
            'special_status_1': 'תאור סטטוס מיוחד1',
            'special_status_2': 'תאור סטטוס מיוחד2',
            'special_status_3': 'תאור סטטוס מיוחד3',
            'special_status_4': 'תאור סטטוס מיוחד4',
        }
        for key, header in alias_to_header.items():
            if key in overrides:
                values[header] = overrides.pop(key)

        assert not overrides, f"Unrecognized row overrides: {overrides}"
        return pd.Series(values)

    # ------------------------------------------------------------------
    # 1. Accessibility data is still imported and preserved.
    # ------------------------------------------------------------------

    def test_accessibility_data_still_parsed_and_preserved(self):
        """
        is_accessibility_priority still reads and recognizes
        accessibility_flag / disability_percent / medical_reason from the
        Excel row exactly as before — the columns are not removed from the
        importer — even though a student with only this data is not made
        priority (see test 2 below).
        """
        from api.views import is_accessibility_priority

        row = self._make_row(
            student_id='ACC_IMP1',
            accessibility_flag='כן',
            disability_percent='40',
            medical_reason='מצב רפואי מאושר',
        )
        self.assertTrue(is_accessibility_priority(row))

        row_medical_only = self._make_row(
            student_id='ACC_IMP2',
            medical_reason='מצב רפואי מאושר',
        )
        self.assertTrue(is_accessibility_priority(row_medical_only))

        row_none = self._make_row(student_id='ACC_IMP3')
        self.assertFalse(is_accessibility_priority(row_none))

    # ------------------------------------------------------------------
    # 1b. Accessibility values are actually persisted and retrievable
    #     after import (not merely computed and discarded).
    # ------------------------------------------------------------------

    def test_accessibility_values_persisted_and_retrievable_after_import(self):
        """
        Import a row carrying accessibility_flag/disability_percent/
        medical_reason, reload the Student from the database, and confirm
        all three values are still there — proving this data is genuinely
        stored (Student.accessibility_flag/disability_percent/
        medical_reason), not just computed and thrown away, while
        is_priority/priority_reason remain untouched by it. Also confirm
        the fields are exposed through StudentSerializer.
        """
        from decimal import Decimal
        from api.views import build_student_payload_from_row
        from api.serializers import StudentSerializer

        row = self._make_row(
            student_id='ACC_PERSIST1',
            accessibility_flag='כן',
            disability_percent='40',
            medical_reason='מצב רפואי מאושר',
        )
        payload = build_student_payload_from_row(row)
        student = Student.objects.create(**payload)

        reloaded = Student.objects.get(pk=student.pk)
        self.assertTrue(reloaded.accessibility_flag)
        self.assertEqual(reloaded.disability_percent, Decimal('40'))
        self.assertEqual(reloaded.medical_reason, 'מצב רפואי מאושר')

        # Separation from priority must hold even though the data is stored.
        self.assertFalse(reloaded.is_priority)
        self.assertEqual(reloaded.priority_reason, '')

        serialized = StudentSerializer(reloaded).data
        self.assertTrue(serialized['accessibility_flag'])
        self.assertEqual(Decimal(str(serialized['disability_percent'])), Decimal('40'))
        self.assertEqual(serialized['medical_reason'], 'מצב רפואי מאושר')

    # ------------------------------------------------------------------
    # 2. Accessibility alone does not create priority.
    # ------------------------------------------------------------------

    def test_accessibility_alone_does_not_create_priority(self):
        """A row with accessibility/medical data but no special_status must
        import as is_priority=False with an empty priority_reason."""
        from api.views import build_student_payload_from_row

        row = self._make_row(
            student_id='ACC_NOPRI',
            accessibility_flag='כן',
            disability_percent='100',
            medical_reason='מצב רפואי מאושר',
        )
        payload = build_student_payload_from_row(row)

        self.assertFalse(payload['is_priority'])
        self.assertEqual(payload['priority_reason'], '')

    # ------------------------------------------------------------------
    # 3. Any non-empty special-status field creates priority.
    # ------------------------------------------------------------------

    def test_any_non_empty_special_status_creates_priority(self):
        """Any single non-empty special_status_1..4 field must set
        is_priority=True and populate priority_reason, with no
        accessibility data present at all."""
        from api.views import build_student_payload_from_row

        row = self._make_row(student_id='PRI_STATUS1', special_status_1='הסמכה')
        payload = build_student_payload_from_row(row)
        self.assertTrue(payload['is_priority'])
        self.assertEqual(payload['priority_reason'], 'הסמכה')

        row2 = self._make_row(student_id='PRI_STATUS2', special_status_3='אנייר')
        payload2 = build_student_payload_from_row(row2)
        self.assertTrue(payload2['is_priority'])
        self.assertEqual(payload2['priority_reason'], 'אנייר')

        row3 = self._make_row(
            student_id='PRI_STATUS3',
            special_status_1='הסמכה',
            special_status_2='אנייר',
        )
        payload3 = build_student_payload_from_row(row3)
        self.assertTrue(payload3['is_priority'])
        self.assertEqual(payload3['priority_reason'], 'הסמכה | אנייר')

        row_none = self._make_row(student_id='NO_STATUS')
        payload_none = build_student_payload_from_row(row_none)
        self.assertFalse(payload_none['is_priority'])
        self.assertEqual(payload_none['priority_reason'], '')

    # ------------------------------------------------------------------
    # 4. Existing priority allocation behavior still works end-to-end:
    #    an imported, special-status-derived priority student is still
    #    preferred by the solver's priorityFirst rule, while an imported
    #    accessibility-only student is not.
    # ------------------------------------------------------------------

    def test_imported_special_status_priority_still_wins_allocation(self):
        """
        Build two students purely through the real importer
        (build_student_payload_from_row): one with a special_status (thus
        is_priority=True) and one with only accessibility data (thus
        is_priority=False). With capacity for only one of two candidates,
        priorityFirst must still favor the special-status student —
        proving the solver's existing priority behavior is unaffected by
        this import-layer change.
        """
        from api.views import build_student_payload_from_row
        from allocation.solver import run_improved_ortools_allocation

        dorm = DormType.objects.create(name='ImportPriorityDorm')
        building = Building.objects.create(number=1, dorm_type=dorm)
        apartment = Apartment.objects.create(
            building=building,
            number='1',
            category=Apartment.Category.FEMALE,
            apartment_type=Apartment.ApartmentType.SINGLE,
            room_count=1,
        )
        room = Room.objects.create(apartment=apartment, name='A', capacity=1)
        Bed.objects.create(room=room, label='1')

        priority_row = self._make_row(
            student_id='IMPPRI1', special_status_1='הסמכה',
        )
        priority_payload = build_student_payload_from_row(priority_row)
        priority_student = Student.objects.create(**priority_payload)

        accessibility_row = self._make_row(
            student_id='IMPACC1',
            accessibility_flag='כן',
            medical_reason='מצב רפואי מאושר',
        )
        accessibility_payload = build_student_payload_from_row(accessibility_row)
        accessibility_student = Student.objects.create(**accessibility_payload)

        self.assertTrue(priority_student.is_priority)
        self.assertFalse(accessibility_student.is_priority)

        patcher = patch('allocation.solver.close_old_connections')
        patcher.start()
        self.addCleanup(patcher.stop)

        config = {
            'sameGender': {'enabled': True, 'strict': True, 'critical': True, 'weight': 0},
            'priorityFirst': {'enabled': True, 'strict': True, 'critical': True, 'weight': 0},
        }
        result = run_improved_ortools_allocation(
            [priority_student, accessibility_student],
            [room],
            config,
        )

        assigned_ids = {item['student_db_id'] for item in result['proposed_assignments']}
        self.assertIn(priority_student.id, assigned_ids)
        self.assertNotIn(accessibility_student.id, assigned_ids)


# ---------------------------------------------------------------------------
# Reusable printing helper shared by SolverSharedFacilityRoomTest and
# SolverBuildingGenderRestrictionTest — module-level so both TestCase
# classes can call it without any inheritance relationship between them.
# Printing only; it never touches assertions or solver behavior.
# ---------------------------------------------------------------------------

def _print_gender_allocation_report(test_name, result, students, rooms):
    """
    Print a readable allocation report for building/room gender tests:
      - header: test name, solver status, totals, warnings;
      - allocation table (BUILDING | BUILDING GENDER | APARTMENT |
        APARTMENT CATEGORY | ROOM | BED | STUDENT | GENDER | RELIGION |
        SECTOR | PRIORITY), including pre-existing active occupants,
        clearly marked EXISTING versus newly persisted NEW rows;
      - a separate UNASSIGNED table (student id, gender, religion, reason
        when available).
    """
    rooms = list(rooms)
    room_ids = [room.id for room in rooms]

    proposed = result.get('proposed_assignments', []) or []
    new_bed_ids = {item['bed_id'] for item in proposed}
    assigned_student_ids = {item['student_db_id'] for item in proposed}

    active_assignments = list(
        BedAssignment.objects.filter(
            bed__room_id__in=room_ids,
            status=BedAssignment.Status.ACTIVE,
        ).select_related(
            'student',
            'bed',
            'bed__room',
            'bed__room__apartment',
            'bed__room__apartment__building',
        )
    )

    rows = []
    for assignment in active_assignments:
        bed = assignment.bed
        room = bed.room
        apartment = room.apartment
        building = apartment.building
        student = assignment.student
        row_status = 'NEW' if bed.id in new_bed_ids else 'EXISTING'
        rows.append((row_status, building, apartment, room, bed, student))

    rows.sort(
        key=lambda row: (
            str(row[1].number),
            str(row[2].number),
            str(row[3].name),
            str(row[4].label),
        )
    )

    print('\n' + '=' * 160)
    print(f'TEST: {test_name}')
    print(
        f"status={result.get('solver_status')} | students={len(students)} | "
        f"assigned={result.get('successful_assignments', 0)} | "
        f"conflicts={result.get('conflicts', 0)}"
    )
    warnings = result.get('warnings') or []
    if warnings:
        print('WARNINGS:')
        for warning in warnings:
            print(f'  - {warning}')
    else:
        print('WARNINGS: none')
    print('=' * 160)

    if rows:
        print(
            f"{'STATUS':<9} {'BUILDING':<9} {'BLD.GENDER':<11} {'APARTMENT':<10} "
            f"{'APT.CAT':<8} {'ROOM':<6} {'BED':<5} {'STUDENT':<12} {'GENDER':<7} "
            f"{'RELIGION':<12} {'SECTOR':<9} {'PRIORITY':<9}"
        )
        print('-' * 160)
        for row_status, building, apartment, room, bed, student in rows:
            print(
                f"{row_status:<9} "
                f"{str(building.number):<9} "
                f"{(building.gender_restriction or '-'):<11} "
                f"{str(apartment.number):<10} "
                f"{str(apartment.category):<8} "
                f"{str(room.name):<6} "
                f"{str(bed.label):<5} "
                f"{student.student_id:<12} "
                f"{str(student.gender):<7} "
                f"{student.requested_religion:<12} "
                f"{student.placement_sector:<9} "
                f"{str(bool(student.is_priority)):<9}"
            )
    else:
        print('No assignments (new or existing).')

    no_feasible_ids = set(result.get('students_with_no_feasible_beds') or [])
    unassigned = [student for student in students if student.id not in assigned_student_ids]
    if unassigned:
        print('\nUNASSIGNED')
        print(f"{'STUDENT':<12} {'GENDER':<7} {'RELIGION':<12} {'REASON':<30}")
        print('-' * 70)
        for student in sorted(unassigned, key=lambda item: item.student_id):
            reason = 'no feasible beds' if student.id in no_feasible_ids else '-'
            print(
                f"{student.student_id:<12} {str(student.gender):<7} "
                f"{student.requested_religion:<12} {reason:<30}"
            )

    print('=' * 160 + '\n')


# ---------------------------------------------------------------------------
# Shared-facility dorm buildings: rooms with capacity 2 (two students per
# room), apartments that may contain several such rooms.
# ---------------------------------------------------------------------------

class SolverSharedFacilityRoomTest(TestCase):
    """
    Focused tests for shared-facility dorm buildings where each physical
    room holds two students (Room.capacity=2, two distinct Bed records),
    and an apartment may contain several such rooms sharing one apartment/
    kitchen (see allocation/solver.py: _apartment_uses_room_pairing,
    _build_candidate_rooms, and the room_assignment_vars layer in
    run_improved_ortools_allocation).

    Gender/building designation is read dynamically from the existing
    Apartment.category field (MALE/FEMALE/MIXED) — there is no separate
    Building-level gender field in this codebase — via the existing
    _housing_matches_apartment check; nothing here hard-codes a building
    number for that purpose.

    For apartments containing exactly one room, or several 1-bed rooms,
    behavior is completely unchanged (that is the existing, unmodified
    apartment-level architecture already covered by every other test class
    in this module) — see test 9 below.
    """

    def setUp(self):
        patcher = patch('allocation.solver.close_old_connections')
        patcher.start()
        self.addCleanup(patcher.stop)

        self.region = Region.objects.create(id='shared_facility_region', name='Shared Facility Region')
        self.dorm_type = DormType.objects.create(name='SharedFacilityDorm', region=self.region)
        self.building = Building.objects.create(number=201, dorm_type=self.dorm_type)

    # ------------------------------------------------------------------
    # Infrastructure helpers
    # ------------------------------------------------------------------

    def _make_apartment(self, number, category=Apartment.Category.FEMALE, building=None):
        return Apartment.objects.create(
            building=building or self.building,
            number=number,
            category=category,
            apartment_type=Apartment.ApartmentType.SINGLE,
            room_count=0,
            is_active=True,
        )

    def _make_room(self, apartment, name, capacity=2):
        room = Room.objects.create(apartment=apartment, name=name, capacity=capacity)
        for index in range(capacity):
            Bed.objects.create(room=room, label=str(index + 1))
        return room

    def _make_student(
        self,
        student_id,
        *,
        gender=Student.Gender.FEMALE,
        religion=Student.Religion.NOT_SPECIFIED,
        religious=Student.Religious.NOT_SPECIFIED,
    ):
        housing_type = (
            Student.HousingType.SINGLE_MALE
            if gender == Student.Gender.MALE
            else Student.HousingType.SINGLE_FEMALE
        )
        return Student.objects.create(
            student_id=student_id,
            first_name='Test',
            last_name=student_id,
            gender=gender,
            housing_type=housing_type,
            requested_religion=religion,
            religious=religious,
        )

    def _fill_room_with_existing_occupants(self, room, count=None):
        """Occupy `count` (default: room.capacity) beds with unrelated existing students."""
        count = room.capacity if count is None else count
        beds = list(room.beds.all())[:count]
        for index, bed in enumerate(beds):
            occupant = self._make_student(f'EXIST_{room.id}_{index}')
            BedAssignment.objects.create(
                student=occupant,
                bed=bed,
                status=BedAssignment.Status.ACTIVE,
                assignment_type=BedAssignment.AssignmentType.MANUAL,
            )

    def _make_mutual_positive_roommate_pair(self, student_1, student_2):
        student_1.roommate_request_student_id_1 = student_2.student_id
        student_1.roommate_request_flag_1 = True
        student_1.save(update_fields=['roommate_request_student_id_1', 'roommate_request_flag_1'])

        student_2.roommate_request_student_id_1 = student_1.student_id
        student_2.roommate_request_flag_1 = True
        student_2.save(update_fields=['roommate_request_student_id_1', 'roommate_request_flag_1'])

    HARD_CONFIG = {
        'sameGender': {'enabled': True, 'strict': True, 'critical': True, 'weight': 0},
        'ReligiousTogether': {'enabled': True, 'strict': True, 'critical': True, 'weight': 0},
        'roommatePositiveOnly': {'enabled': True, 'strict': True, 'critical': True, 'weight': 0},
        'priorityFirst': {'enabled': False},
        'sameReligion': {'enabled': False},
        'roommateMatch': {'enabled': False},
        'sectorMatching': {'enabled': False},
        'avoidYearMix_1_with_3_4': {'enabled': False},
        'avoidAtudaimWithHasmaha': {'enabled': False},
    }

    def _resolve_assignment_location(self, assignment):
        bed = Bed.objects.select_related(
            'room', 'room__apartment', 'room__apartment__building',
        ).get(id=assignment['bed_id'])
        return bed.room.apartment, bed.room, bed

    def _run(self, students, rooms, config=None):
        import inspect
        from allocation.solver import run_improved_ortools_allocation

        test_name = inspect.stack()[1].function
        students = list(students)
        rooms = list(rooms)

        result = run_improved_ortools_allocation(
            students,
            rooms,
            config or self.HARD_CONFIG,
        )

        _print_gender_allocation_report(test_name, result, students, rooms)
        return result

    def _room_of(self, result, student):
        for assignment in result.get('proposed_assignments', []):
            if assignment['student_db_id'] == student.id:
                _, room, _ = self._resolve_assignment_location(assignment)
                return room
        return None

    # ------------------------------------------------------------------
    # 1. Two compatible students share one room.
    # ------------------------------------------------------------------

    def test_two_compatible_students_share_one_room(self):
        """
        Two mutually-compatible students are both assigned into the same
        2-bed room of a shared-facility apartment, using two distinct beds.
        """
        apartment = self._make_apartment('SF1')
        room_a = self._make_room(apartment, 'A', capacity=2)
        room_b = self._make_room(apartment, 'B', capacity=2)
        self._fill_room_with_existing_occupants(room_b)  # only room A has space

        s1 = self._make_student('RM1')
        s2 = self._make_student('RM2')

        result = self._run([s1, s2], [room_a, room_b])
        self.assertEqual(result['successful_assignments'], 2, result['proposed_assignments'])

        room_1 = self._room_of(result, s1)
        room_2 = self._room_of(result, s2)
        self.assertEqual(room_1.id, room_a.id)
        self.assertEqual(room_2.id, room_a.id)

        beds = {a['bed_id'] for a in result['proposed_assignments']}
        self.assertEqual(len(beds), 2, 'Each student must use a distinct bed.')

    # ------------------------------------------------------------------
    # 2. A third student is rejected from the full room.
    # ------------------------------------------------------------------

    def test_third_student_rejected_from_full_room(self):
        """
        With only one 2-bed room available (the apartment's other room is
        already full), a third compatible student cannot be squeezed in
        and must remain unassigned rather than exceed room capacity.
        """
        apartment = self._make_apartment('SF2')
        room_a = self._make_room(apartment, 'A', capacity=2)
        room_b = self._make_room(apartment, 'B', capacity=2)
        self._fill_room_with_existing_occupants(room_b)

        s1 = self._make_student('TH1')
        s2 = self._make_student('TH2')
        s3 = self._make_student('TH3')

        result = self._run([s1, s2, s3], [room_a, room_b])
        self.assertEqual(result['successful_assignments'], 2, result['proposed_assignments'])

        assigned_ids = {a['student_db_id'] for a in result['proposed_assignments']}
        self.assertEqual(len(assigned_ids & {s1.id, s2.id, s3.id}), 2)
        unassigned_id = ({s1.id, s2.id, s3.id} - assigned_ids).pop()
        self.assertNotIn(unassigned_id, assigned_ids)

    # ------------------------------------------------------------------
    # 3. An existing occupant affects the second-bed choice.
    # ------------------------------------------------------------------

    def test_existing_occupant_affects_second_bed_choice(self):
        """
        Room A already has one Religious-Jewish occupant (one free bed);
        Room B is completely empty (two free beds) in the same apartment.
        A new Religious-Jewish candidate may join Room A's free bed, while
        a new, otherwise-unrelated Muslim (no-preference) candidate is NOT
        blocked from the whole apartment — only from Room A — and is
        correctly placed in Room B instead.
        """
        apartment = self._make_apartment('SF3')
        room_a = self._make_room(apartment, 'A', capacity=2)
        room_b = self._make_room(apartment, 'B', capacity=2)

        existing_rj = self._make_student(
            'EXRJ', religion=Student.Religion.Jewish, religious=Student.Religious.RELIGIOUS,
        )
        BedAssignment.objects.create(
            student=existing_rj,
            bed=room_a.beds.first(),
            status=BedAssignment.Status.ACTIVE,
            assignment_type=BedAssignment.AssignmentType.MANUAL,
        )

        new_rj = self._make_student(
            'NEWRJ', religion=Student.Religion.Jewish, religious=Student.Religious.RELIGIOUS,
        )
        new_muslim = self._make_student(
            'NEWMU', religion=Student.Religion.Muslim, religious=Student.Religious.NO_PREFERENCE,
        )

        result = self._run([new_rj, new_muslim], [room_a, room_b])
        self.assertEqual(result['successful_assignments'], 2, result['proposed_assignments'])

        self.assertEqual(self._room_of(result, new_rj).id, room_a.id)
        self.assertEqual(self._room_of(result, new_muslim).id, room_b.id)

    # ------------------------------------------------------------------
    # 4. Incompatible students do not share a room.
    # ------------------------------------------------------------------

    def test_incompatible_students_do_not_share_room(self):
        """
        A Religious-Jewish and a Religious-Muslim student cannot both be
        placed when the only capacity available is two beds in the SAME
        room: the hard ReligiousTogether rule must block them from sharing
        it, so at most one of them is assigned — never both, in violation
        of the rule.
        """
        apartment = self._make_apartment('SF4')
        room_a = self._make_room(apartment, 'A', capacity=2)
        room_b = self._make_room(apartment, 'B', capacity=2)
        self._fill_room_with_existing_occupants(room_b)  # only room A has space

        rj = self._make_student(
            'INCRJ', religion=Student.Religion.Jewish, religious=Student.Religious.RELIGIOUS,
        )
        muslim = self._make_student(
            'INCMU', religion=Student.Religion.Muslim, religious=Student.Religious.RELIGIOUS,
        )

        result = self._run([rj, muslim], [room_a, room_b])
        self.assertEqual(
            result['successful_assignments'], 1, result['proposed_assignments'],
        )

        assigned_ids = {a['student_db_id'] for a in result['proposed_assignments']}
        self.assertEqual(len(assigned_ids & {rj.id, muslim.id}), 1)

    # ------------------------------------------------------------------
    # 5. Mutual roommate requests produce the same room.
    # ------------------------------------------------------------------

    def test_mutual_roommate_request_produces_same_room(self):
        """Two students with a hard mutual positive roommate request end up
        in the SAME physical room, not merely the same apartment."""
        apartment = self._make_apartment('SF5')
        room_a = self._make_room(apartment, 'A', capacity=2)
        room_b = self._make_room(apartment, 'B', capacity=2)

        s1 = self._make_student('MR1')
        s2 = self._make_student('MR2')
        self._make_mutual_positive_roommate_pair(s1, s2)

        result = self._run([s1, s2], [room_a, room_b])
        self.assertEqual(result['successful_assignments'], 2, result['proposed_assignments'])

        room_1 = self._room_of(result, s1)
        room_2 = self._room_of(result, s2)
        self.assertEqual(room_1.id, room_2.id)

    # ------------------------------------------------------------------
    # 6. Female/male building (apartment) restriction.
    # ------------------------------------------------------------------

    def test_female_male_apartment_restriction(self):
        """A female student and a male student are each restricted to the
        gender-matching apartment, read dynamically from Apartment.category
        — no building number is hard-coded for this."""
        female_apartment = self._make_apartment('SFF', category=Apartment.Category.FEMALE)
        male_apartment = self._make_apartment('SFM', category=Apartment.Category.MALE)
        female_room = self._make_room(female_apartment, 'A', capacity=2)
        male_room = self._make_room(male_apartment, 'A', capacity=2)

        female_student = self._make_student('GF1', gender=Student.Gender.FEMALE)
        male_student = self._make_student('GM1', gender=Student.Gender.MALE)

        result = self._run([female_student, male_student], [female_room, male_room])
        self.assertEqual(result['successful_assignments'], 2, result['proposed_assignments'])

        self.assertEqual(
            self._resolve_assignment_location(
                next(a for a in result['proposed_assignments'] if a['student_db_id'] == female_student.id)
            )[0].id,
            female_apartment.id,
        )
        self.assertEqual(
            self._resolve_assignment_location(
                next(a for a in result['proposed_assignments'] if a['student_db_id'] == male_student.id)
            )[0].id,
            male_apartment.id,
        )

    # ------------------------------------------------------------------
    # 7. Changing the building/apartment designation later.
    # ------------------------------------------------------------------

    def test_changing_apartment_gender_designation_takes_effect(self):
        """
        A male student cannot enter a FEMALE-designated apartment. After
        staff change that apartment's category to MALE in the database, a
        fresh solver run for the same male student succeeds — proving the
        designation is read fresh from the database every run, not cached
        or hard-coded by building number.
        """
        apartment = self._make_apartment('SF7', category=Apartment.Category.FEMALE)
        room = self._make_room(apartment, 'A', capacity=2)
        second_room = self._make_room(apartment, 'B', capacity=2)

        male_student = self._make_student('DESG1', gender=Student.Gender.MALE)

        result_before = self._run([male_student], [room, second_room])
        self.assertEqual(result_before['successful_assignments'], 0, result_before['proposed_assignments'])

        apartment.category = Apartment.Category.MALE
        apartment.save(update_fields=['category'])

        result_after = self._run([male_student], [room, second_room])
        self.assertEqual(result_after['successful_assignments'], 1, result_after['proposed_assignments'])

    # ------------------------------------------------------------------
    # 8. Unique-bed persistence.
    # ------------------------------------------------------------------

    def test_unique_bed_persistence(self):
        """Four students filling a 2-room/4-bed shared-facility apartment
        each persist to a distinct, real Bed row — no bed is reused."""
        apartment = self._make_apartment('SF8')
        room_a = self._make_room(apartment, 'A', capacity=2)
        room_b = self._make_room(apartment, 'B', capacity=2)

        students = [self._make_student(f'UB{i}') for i in range(1, 5)]

        result = self._run(students, [room_a, room_b])
        self.assertEqual(result['successful_assignments'], 4, result['proposed_assignments'])

        bed_ids = [a['bed_id'] for a in result['proposed_assignments']]
        self.assertEqual(len(bed_ids), len(set(bed_ids)), 'Every bed must be used at most once.')

        for student in students:
            assignment = BedAssignment.objects.get(student=student, status=BedAssignment.Status.ACTIVE)
            self.assertIn(assignment.bed_id, bed_ids)

    # ------------------------------------------------------------------
    # 9. Existing one-student-per-room dorms remain unaffected.
    # ------------------------------------------------------------------

    def test_existing_one_per_room_dorm_unaffected(self):
        """
        An ordinary apartment built from several 1-bed rooms (the existing,
        already-tested architecture) is NOT treated as room-pairing: an
        existing Religious-Jewish occupant in one of its 1-bed rooms still
        blocks an incompatible newcomer from the WHOLE apartment (the
        pre-existing apartment-level ReligiousTogether behavior), unlike
        the neutralized, per-room behavior used for shared-facility
        apartments above.
        """
        from allocation.solver import _apartment_uses_room_pairing, _rooms_by_apartment_id

        apartment = self._make_apartment('SF9')
        rooms = [self._make_room(apartment, f'R{i}', capacity=1) for i in range(1, 4)]

        existing_rj = self._make_student(
            'OLDRJ', religion=Student.Religion.Jewish, religious=Student.Religious.RELIGIOUS,
        )
        BedAssignment.objects.create(
            student=existing_rj,
            bed=rooms[0].beds.first(),
            status=BedAssignment.Status.ACTIVE,
            assignment_type=BedAssignment.AssignmentType.MANUAL,
        )

        rooms_by_apartment = _rooms_by_apartment_id(rooms)
        self.assertFalse(
            _apartment_uses_room_pairing(apartment.id, rooms_by_apartment),
            'A 1-bed-room-per-room apartment must not be treated as room-pairing.',
        )

        new_rj = self._make_student(
            'NEWOLDRJ', religion=Student.Religion.Jewish, religious=Student.Religious.RELIGIOUS,
        )
        new_muslim = self._make_student(
            'NEWOLDMU', religion=Student.Religion.Muslim, religious=Student.Religious.NO_PREFERENCE,
        )

        result = self._run([new_rj, new_muslim], rooms)
        self.assertEqual(result['successful_assignments'], 1, result['proposed_assignments'])

        assigned_ids = {a['student_db_id'] for a in result['proposed_assignments']}
        self.assertIn(new_rj.id, assigned_ids)
        self.assertNotIn(
            new_muslim.id, assigned_ids,
            'The pre-existing apartment-level ReligiousTogether rule must '
            'still block the whole apartment for 1-bed-room dorms.',
        )


# ---------------------------------------------------------------------------
# Building-level gender restriction (shared-facility buildings with shared
# bathrooms: the whole building must be single-gender, not just individual
# apartments).
# ---------------------------------------------------------------------------

class SolverBuildingGenderRestrictionTest(TestCase):
    """
    Focused tests for Building.gender_restriction.

    Apartment.category (male/female/mixed) remains an apartment-level
    attribute and is NOT itself a building-level gender designation — a
    building can, by data error or a genuine mixed-apartment layout,
    contain apartments with conflicting categories. For shared-facility
    buildings (shared bathrooms), the whole BUILDING must still be
    restricted to one gender regardless of what any individual apartment's
    category says. Building.gender_restriction ('male'/'female'/blank) is
    the hard, building-wide override; blank preserves today's existing
    apartment-category-only behavior for ordinary buildings.
    """

    def setUp(self):
        patcher = patch('allocation.solver.close_old_connections')
        patcher.start()
        self.addCleanup(patcher.stop)

        self.region = Region.objects.create(id='gender_bldg_region', name='Gender Building Region')
        self.dorm_type = DormType.objects.create(name='GenderBuildingDorm', region=self.region)

    def _make_room(self, apartment, name, capacity=2):
        room = Room.objects.create(apartment=apartment, name=name, capacity=capacity)
        for index in range(capacity):
            Bed.objects.create(room=room, label=str(index + 1))
        return room

    def _make_student(self, student_id, gender):
        housing_type = (
            Student.HousingType.SINGLE_MALE
            if gender == Student.Gender.MALE
            else Student.HousingType.SINGLE_FEMALE
        )
        return Student.objects.create(
            student_id=student_id,
            first_name='Test',
            last_name=student_id,
            gender=gender,
            housing_type=housing_type,
        )

    CONFIG = {
        'sameGender': {'enabled': True, 'strict': True, 'critical': True, 'weight': 0},
        'priorityFirst': {'enabled': False},
        'ReligiousTogether': {'enabled': False},
        'roommatePositiveOnly': {'enabled': False},
        'sameReligion': {'enabled': False},
        'roommateMatch': {'enabled': False},
        'sectorMatching': {'enabled': False},
        'avoidYearMix_1_with_3_4': {'enabled': False},
        'avoidAtudaimWithHasmaha': {'enabled': False},
    }

    def _run(self, students, rooms):
        import inspect
        from allocation.solver import run_improved_ortools_allocation

        test_name = inspect.stack()[1].function
        students = list(students)
        rooms = list(rooms)

        result = run_improved_ortools_allocation(students, rooms, self.CONFIG)

        _print_gender_allocation_report(test_name, result, students, rooms)
        return result

    # ------------------------------------------------------------------
    # 1. Building-level restriction overrides conflicting apartment
    #    categories: male and female students can never be allocated
    #    anywhere in the same restricted building.
    # ------------------------------------------------------------------

    def test_building_restriction_overrides_conflicting_apartment_categories(self):
        """
        One shared-facility building holds two apartments with CONFLICTING
        categories (one FEMALE, one MALE), but the building itself is
        restricted to female only. A male student must be rejected from
        BOTH apartments — even the one nominally marked MALE — because the
        building-level restriction is authoritative for shared-facility
        buildings. A female student is still assigned normally.
        """
        building = Building.objects.create(
            number=301,
            dorm_type=self.dorm_type,
            gender_restriction=Building.GenderRestriction.FEMALE,
        )
        female_apartment = Apartment.objects.create(
            building=building, number='F1', category=Apartment.Category.FEMALE,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=1,
        )
        # Mislabeled/conflicting apartment: category says MALE, but the
        # building as a whole is female-only.
        conflicting_apartment = Apartment.objects.create(
            building=building, number='M1', category=Apartment.Category.MALE,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=1,
        )
        room_f = self._make_room(female_apartment, 'A', capacity=2)
        room_m = self._make_room(conflicting_apartment, 'A', capacity=2)

        male_student = self._make_student('BGM1', Student.Gender.MALE)
        female_student = self._make_student('BGF1', Student.Gender.FEMALE)

        result = self._run([male_student, female_student], [room_f, room_m])

        assigned_ids = {a['student_db_id'] for a in result['proposed_assignments']}
        self.assertIn(female_student.id, assigned_ids)
        self.assertNotIn(
            male_student.id,
            assigned_ids,
            'A male student must never be assigned anywhere in a '
            'female-restricted building, even an apartment marked MALE.',
        )

        # Confirm across every room actually persisted in this building —
        # not merely the one apartment a naive apartment-only check might
        # have looked at.
        for assignment in result['proposed_assignments']:
            bed = Bed.objects.select_related(
                'room__apartment__building',
            ).get(id=assignment['bed_id'])
            self.assertEqual(bed.room.apartment.building_id, building.id)
            student = Student.objects.get(id=assignment['student_db_id'])
            self.assertEqual(student.gender, Student.Gender.FEMALE)

    # ------------------------------------------------------------------
    # 2. Ordinary buildings without a restriction keep the existing
    #    apartment-category-only behavior.
    # ------------------------------------------------------------------

    def test_ordinary_building_without_restriction_uses_apartment_category(self):
        """
        A building with NO gender_restriction (blank, the default) behaves
        exactly as before: each student follows their own apartment's
        category, and a mixed building (one FEMALE apartment, one MALE
        apartment) still allocates both genders successfully.
        """
        building = Building.objects.create(number=302, dorm_type=self.dorm_type)
        self.assertEqual(building.gender_restriction, '')

        female_apartment = Apartment.objects.create(
            building=building, number='F1', category=Apartment.Category.FEMALE,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=1,
        )
        male_apartment = Apartment.objects.create(
            building=building, number='M1', category=Apartment.Category.MALE,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=1,
        )
        room_f = self._make_room(female_apartment, 'A', capacity=2)
        room_m = self._make_room(male_apartment, 'A', capacity=2)

        male_student = self._make_student('OGM1', Student.Gender.MALE)
        female_student = self._make_student('OGF1', Student.Gender.FEMALE)

        result = self._run([male_student, female_student], [room_f, room_m])
        self.assertEqual(result['successful_assignments'], 2, result['proposed_assignments'])

        assignments_by_student = {
            a['student_db_id']: a for a in result['proposed_assignments']
        }
        male_bed = Bed.objects.select_related('room__apartment').get(
            id=assignments_by_student[male_student.id]['bed_id']
        )
        female_bed = Bed.objects.select_related('room__apartment').get(
            id=assignments_by_student[female_student.id]['bed_id']
        )
        self.assertEqual(male_bed.room.apartment_id, male_apartment.id)
        self.assertEqual(female_bed.room.apartment_id, female_apartment.id)

    # ------------------------------------------------------------------
    # 3. A building's ONLY apartment is mislabeled (wrong category); the
    #    building restriction must still correct it.
    # ------------------------------------------------------------------

    def test_single_mislabeled_apartment_building_restriction_overrides_category(self):
        """
        A female-restricted building has only one apartment, incorrectly
        marked MALE. A female student must still be assigned there (the
        building-level restriction corrects the wrong apartment category),
        while a male student is rejected.
        """
        building = Building.objects.create(
            number=303,
            dorm_type=self.dorm_type,
            gender_restriction=Building.GenderRestriction.FEMALE,
        )
        mislabeled_apartment = Apartment.objects.create(
            building=building, number='1', category=Apartment.Category.MALE,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=1,
        )
        room = self._make_room(mislabeled_apartment, 'A', capacity=2)

        female_student = self._make_student('SOLO_F', Student.Gender.FEMALE)
        male_student = self._make_student('SOLO_M', Student.Gender.MALE)

        result = self._run([female_student, male_student], [room])

        assigned_ids = {a['student_db_id'] for a in result['proposed_assignments']}
        self.assertIn(
            female_student.id, assigned_ids,
            'A female student must be assigned even though the only '
            "apartment's own category says MALE.",
        )
        self.assertNotIn(male_student.id, assigned_ids)

    # ------------------------------------------------------------------
    # 4. Existing occupants: preserved unchanged, block new opposite-
    #    gender students, and surface a clear warning.
    # ------------------------------------------------------------------

    def test_conflicting_existing_occupant_freezes_building_female_restriction(self):
        """
        A building already has an active MALE occupant from before any
        restriction existed. After the building becomes FEMALE-restricted:
          - the existing male occupant's active assignment is preserved
            exactly as-is (never modified);
          - a new MALE candidate is NOT added;
          - a new FEMALE candidate is ALSO not added — a matching-gender
            addition would not fix an already-mixed building, so the whole
            building is frozen for new assignments until staff resolve
            the inconsistency manually;
          - a clear warning about the conflicting existing occupant/frozen
            building is returned.
        """
        building = Building.objects.create(number=304, dorm_type=self.dorm_type)
        apartment = Apartment.objects.create(
            building=building, number='1', category=Apartment.Category.MALE,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=1,
        )
        room = self._make_room(apartment, 'A', capacity=2)

        legacy_male = self._make_student('LEGACY_M', Student.Gender.MALE)
        legacy_bed = room.beds.first()
        BedAssignment.objects.create(
            student=legacy_male,
            bed=legacy_bed,
            status=BedAssignment.Status.ACTIVE,
            assignment_type=BedAssignment.AssignmentType.MANUAL,
        )

        # The building becomes female-restricted after the fact.
        building.gender_restriction = Building.GenderRestriction.FEMALE
        building.save(update_fields=['gender_restriction'])

        new_male = self._make_student('NEW_M', Student.Gender.MALE)
        new_female = self._make_student('NEW_F', Student.Gender.FEMALE)

        result = self._run([new_male, new_female], [room])

        legacy_assignment = BedAssignment.objects.get(student=legacy_male)
        self.assertEqual(legacy_assignment.status, BedAssignment.Status.ACTIVE)
        self.assertEqual(legacy_assignment.bed_id, legacy_bed.id)

        assigned_ids = {a['student_db_id'] for a in result['proposed_assignments']}
        self.assertNotIn(
            new_male.id, assigned_ids,
            'No new opposite-gender student may be added once the '
            'building is restricted, even though a legacy occupant of '
            'that gender is already grandfathered in.',
        )
        self.assertNotIn(
            new_female.id, assigned_ids,
            'A conflicting existing occupant must freeze the WHOLE '
            'building for new assignments, including matching-gender '
            'candidates — adding them would not fix an already-mixed '
            'building.',
        )

        self.assertTrue(
            any(
                'restricted to' in warning and 'LEGACY_M' in warning and 'frozen' in warning
                for warning in result['warnings']
            ),
            f"Expected a conflicting-existing-occupant/frozen-building warning, got: {result['warnings']}",
        )

    def test_conflicting_existing_occupant_freezes_building_male_restriction(self):
        """
        Symmetric case: a building already has an active FEMALE occupant.
        After the building becomes MALE-restricted:
          - the existing female occupant's active assignment is preserved
            exactly as-is (never modified);
          - a new MALE candidate (matching the restriction) is NOT added —
            the building is frozen entirely because of the conflict;
          - a clear warning is returned.
        """
        building = Building.objects.create(number=306, dorm_type=self.dorm_type)
        apartment = Apartment.objects.create(
            building=building, number='1', category=Apartment.Category.FEMALE,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=1,
        )
        room = self._make_room(apartment, 'A', capacity=2)

        legacy_female = self._make_student('LEGACY_F', Student.Gender.FEMALE)
        legacy_bed = room.beds.first()
        BedAssignment.objects.create(
            student=legacy_female,
            bed=legacy_bed,
            status=BedAssignment.Status.ACTIVE,
            assignment_type=BedAssignment.AssignmentType.MANUAL,
        )

        # The building becomes male-restricted after the fact.
        building.gender_restriction = Building.GenderRestriction.MALE
        building.save(update_fields=['gender_restriction'])

        new_male = self._make_student('NEW_M2', Student.Gender.MALE)

        result = self._run([new_male], [room])

        legacy_assignment = BedAssignment.objects.get(student=legacy_female)
        self.assertEqual(legacy_assignment.status, BedAssignment.Status.ACTIVE)
        self.assertEqual(legacy_assignment.bed_id, legacy_bed.id)

        assigned_ids = {a['student_db_id'] for a in result['proposed_assignments']}
        self.assertNotIn(
            new_male.id, assigned_ids,
            'A male candidate must not be added to a male-restricted '
            'building that already has a conflicting existing female '
            'occupant — that would create a mixed-gender shared-facility '
            'building.',
        )

        self.assertTrue(
            any(
                'restricted to' in warning and 'LEGACY_F' in warning and 'frozen' in warning
                for warning in result['warnings']
            ),
            f"Expected a conflicting-existing-occupant/frozen-building warning, got: {result['warnings']}",
        )

    # ------------------------------------------------------------------
    # 5. Changing gender_restriction affects the very next solver run.
    # ------------------------------------------------------------------

    def test_changing_gender_restriction_affects_next_run(self):
        """Changing Building.gender_restriction takes effect immediately
        on the next solver run — read fresh from the database, never
        cached or hard-coded by building number."""
        building = Building.objects.create(number=305, dorm_type=self.dorm_type)
        apartment = Apartment.objects.create(
            building=building, number='1', category=Apartment.Category.MALE,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=1,
        )
        room = self._make_room(apartment, 'A', capacity=2)

        female_student = self._make_student('DYN_F', Student.Gender.FEMALE)

        result_before = self._run([female_student], [room])
        self.assertEqual(
            result_before['successful_assignments'], 0, result_before['proposed_assignments'],
        )

        building.gender_restriction = Building.GenderRestriction.FEMALE
        building.save(update_fields=['gender_restriction'])

        result_after = self._run([female_student], [room])
        self.assertEqual(
            result_after['successful_assignments'], 1, result_after['proposed_assignments'],
        )


# ---------------------------------------------------------------------------
# API permissions for editing Building.gender_restriction.
# ---------------------------------------------------------------------------

def _print_permission_check_row(test_name, user, requested_value, response, building):
    """Reusable printing helper for building-permission API tests: prints
    TEST | USER ROLE | REGION | REQUESTED VALUE | HTTP STATUS | SAVED VALUE."""
    building.refresh_from_db()
    print('\n' + '-' * 115)
    print(
        f"{'TEST':<50} {'USER ROLE':<14} {'REGION':<14} "
        f"{'REQUESTED':<12} {'HTTP STATUS':<12} {'SAVED VALUE':<12}"
    )
    print('-' * 115)
    print(
        f"{test_name:<50} {user.role:<14} {(user.region_id or '-'):<14} "
        f"{str(requested_value):<12} {response.status_code:<12} "
        f"{(building.gender_restriction or '-'):<12}"
    )
    print('-' * 115 + '\n')


class BuildingGenderRestrictionPermissionTest(TestCase):
    """
    Editing a building (e.g. gender_restriction) via BuildingViewSet is a
    boss-level action (see BuildingViewSet.update in api/views.py):
      - an ordinary employee -> 403, regardless of region;
      - a region_boss of the SAME region as the building -> allowed;
      - a region_boss of a DIFFERENT region -> 403 or 404 (the building
        is outside their scoped queryset, so DRF's get_object() 404s);
      - a central_admin -> allowed, regardless of region.
    """

    def setUp(self):
        self.region = _make_region('Perm Region A')
        self.other_region = _make_region('Perm Region B')
        self.dorm_type = DormType.objects.create(name='PermDorm', region=self.region)
        self.building = Building.objects.create(number=401, dorm_type=self.dorm_type)

        self.employee = _make_employee(self.region, email='perm_emp@test.com')
        self.boss = _make_region_boss(self.region, email='perm_boss@test.com')
        self.other_boss = _make_region_boss(self.other_region, email='perm_other_boss@test.com')
        self.admin = _make_central_admin(email='perm_admin@test.com')

    def _patch_gender_restriction(self, user):
        import inspect

        test_name = inspect.stack()[1].function
        requested_value = Building.GenderRestriction.FEMALE

        client = APIClient()
        client.force_authenticate(user=user)
        response = client.patch(
            f'/api/buildings/{self.building.id}/',
            {'gender_restriction': requested_value},
            format='json',
        )

        _print_permission_check_row(test_name, user, requested_value, response, self.building)
        return response

    def test_employee_forbidden(self):
        """An ordinary employee cannot change gender_restriction."""
        response = self._patch_gender_restriction(self.employee)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_region_boss_own_region_allowed(self):
        """A region_boss may change gender_restriction for a building in
        their own region."""
        response = self._patch_gender_restriction(self.boss)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.building.refresh_from_db()
        self.assertEqual(self.building.gender_restriction, Building.GenderRestriction.FEMALE)

    def test_region_boss_other_region_forbidden_or_not_found(self):
        """A region_boss from a different region cannot change this
        building's gender_restriction."""
        response = self._patch_gender_restriction(self.other_boss)
        self.assertIn(
            response.status_code,
            (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND),
        )
        self.building.refresh_from_db()
        self.assertEqual(self.building.gender_restriction, '')

    def test_central_admin_allowed(self):
        """A central_admin may change gender_restriction for any building,
        regardless of region."""
        response = self._patch_gender_restriction(self.admin)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.building.refresh_from_db()
        self.assertEqual(self.building.gender_restriction, Building.GenderRestriction.FEMALE)


# ---------------------------------------------------------------------------
# Exclusive-apartment allocation (Z1/Z2 singles, Z3 couples, Z4 families, Z6
# single-in-apartment): each Z3/Z4/Z6 Student record represents one COMPLETE,
# independent application. Diagnostic + regression tests for the
# application-exclusivity constraint in allocation/solver.py.
# ---------------------------------------------------------------------------

def _print_household_capacity_report(test_name, result, students, rooms):
    """
    Reusable diagnostic printer for exclusive-apartment allocation tests.
    Prints, per applicant: housing type, dorm type, and — for assigned
    students — the actual building/apartment/room/bed they landed in plus
    that apartment's real inventory (rooms, room capacity, total beds,
    active occupants after this run), whether they were ever a candidate,
    whether they were assigned, and a rejection reason when available.
    Then prints aggregate inventory totals (physical beds, free beds,
    empty apartments, applications assigned/unassigned).
    """
    rooms = list(rooms)
    room_ids = [room.id for room in rooms]

    proposed = result.get('proposed_assignments', []) or []
    assignment_by_student_id = {item['student_db_id']: item for item in proposed}
    no_feasible_ids = set(result.get('students_with_no_feasible_beds') or [])

    print('\n' + '=' * 175)
    print(f'TEST: {test_name}')
    print(
        f"status={result.get('solver_status')} | students={len(students)} | "
        f"assigned={result.get('successful_assignments', 0)} | "
        f"conflicts={result.get('conflicts', 0)}"
    )
    warnings = result.get('warnings') or []
    if warnings:
        print('WARNINGS:')
        for warning in warnings:
            print(f'  - {warning}')
    print('=' * 175)

    print(
        f"{'HOUSING TYPE':<28} {'STUDENT':<10} {'DORM TYPE':<14} {'BUILDING':<9} "
        f"{'APARTMENT':<10} {'APT TYPE':<9} {'CATEGORY':<9} {'ROOMS':<6} "
        f"{'ROOM CAP':<9} {'BEDS':<6} {'ACTIVE OCC':<11} {'CANDIDATE':<10} "
        f"{'ASSIGNED':<9} {'REJECTION REASON':<28}"
    )
    print('-' * 175)

    for student in sorted(students, key=lambda item: item.student_id):
        assignment = assignment_by_student_id.get(student.id)
        dorm_type_name = student.accepted_dorm_type.name if student.accepted_dorm_type_id else '-'
        is_candidate = student.id not in no_feasible_ids
        is_assigned = assignment is not None

        if assignment:
            bed = Bed.objects.select_related(
                'room', 'room__apartment', 'room__apartment__building',
            ).get(id=assignment['bed_id'])
            room = bed.room
            apartment = room.apartment
            building = apartment.building
            building_label = str(building.number)
            apartment_label = str(apartment.number)
            apt_type_label = str(apartment.apartment_type)
            category_label = str(apartment.category)
            rooms_count = apartment.rooms.count()
            room_capacity = room.capacity
            beds_total = Bed.objects.filter(room__apartment_id=apartment.id).count()
            active_occupants = BedAssignment.objects.filter(
                bed__room__apartment_id=apartment.id,
                status=BedAssignment.Status.ACTIVE,
            ).count()
            reason = '-'
        else:
            building_label = apartment_label = apt_type_label = category_label = '-'
            rooms_count = room_capacity = beds_total = active_occupants = '-'
            reason = 'no feasible beds' if not is_candidate else 'capacity/household conflict'

        print(
            f"{str(student.housing_type):<28} "
            f"{student.student_id:<10} "
            f"{dorm_type_name:<14} "
            f"{building_label:<9} "
            f"{apartment_label:<10} "
            f"{apt_type_label:<9} "
            f"{category_label:<9} "
            f"{str(rooms_count):<6} "
            f"{str(room_capacity):<9} "
            f"{str(beds_total):<6} "
            f"{str(active_occupants):<11} "
            f"{('yes' if is_candidate else 'no'):<10} "
            f"{('yes' if is_assigned else 'no'):<9} "
            f"{reason:<28}"
        )

    apartment_ids = {room.apartment_id for room in rooms}
    physical_beds = Bed.objects.filter(room_id__in=room_ids).count()
    active_bed_ids = set(
        BedAssignment.objects.filter(
            bed__room_id__in=room_ids,
            status=BedAssignment.Status.ACTIVE,
        ).values_list('bed_id', flat=True)
    )
    free_beds = physical_beds - len(active_bed_ids)
    occupied_apartment_ids = set(
        BedAssignment.objects.filter(
            bed__room_id__in=room_ids,
            status=BedAssignment.Status.ACTIVE,
        ).values_list('bed__room__apartment_id', flat=True)
    )
    empty_apartments = len(apartment_ids - occupied_apartment_ids)

    print('-' * 175)
    print('INVENTORY TOTALS')
    print(f"  physical beds:              {physical_beds}")
    print(f"  free beds (after run):      {free_beds}")
    print(f"  empty apartments:           {empty_apartments}")
    print(f"  applications assigned:      {result.get('successful_assignments', 0)}")
    print(f"  applications unassigned:    {result.get('conflicts', 0)}")
    print('=' * 175 + '\n')


class HouseholdExclusivityTest(TestCase):
    """
    Authoritative data model (confirmed with the business owner): for
    exclusive housing types, ONE Student database record represents the
    ENTIRE application, not one household member.

      - Z3 / COUPLE: one Student row represents the student AND their
        partner. The partner is never stored as a separate Student record.
      - Z4 / FAMILY: one Student row represents the student AND their
        complete family. Family members are never stored as separate
        Student records.
      - Z6 / SINGLE_IN_APARTMENT: one Student row represents one single
        applicant requesting an entire apartment.

    Consequently:
      - two Z3 Student records are always two DIFFERENT couple
        applications;
      - two Z4 Student records are always two DIFFERENT family
        applications;
      - two Z6 Student records are always two DIFFERENT individual
        applications;
      - a mutual roommate request between any two exclusive-type records
        must NEVER combine them into one household — there is no such
        thing as "the applicant's spouse/family member inside the Student
        table" to find and merge with.

    Allocation semantics for Z3/Z4/Z6 are therefore APPLICATION-based, not
    bed-based: one Student record consumes an entire apartment, at most
    one Student record may ever be assigned to a given exclusive apartment
    regardless of remaining physical bed capacity (unused beds represent
    the untracked spouse/family), and any existing active assignment in
    the apartment makes it unavailable to every other applicant — a
    mutual roommate request never overrides this.

    An earlier version of this file (and of allocation/solver.py) treated
    two same-type Student rows linked by a mutual positive roommate
    request as verified members of ONE household allowed to co-occupy an
    apartment up to its bed capacity. That assumption was incorrect and
    has been reverted: `allocation.solver` no longer contains
    `_exclusive_household_groups`, `_verified_household_pairs`, or
    `_may_join_existing_exclusive_occupants`; the capacity constraint for
    exclusive apartments is the simple `sum(exclusive_vars) <= 1` below.
    Exclusive-type students are also excluded from the general
    roommate-pair machinery entirely (see the `roommate_pairs` filter in
    `run_improved_ortools_allocation`), so a stray mutual request between
    two unrelated Z3/Z4/Z6 applicants can never suppress either
    assignment.
    """

    def setUp(self):
        patcher = patch('allocation.solver.close_old_connections')
        patcher.start()
        self.addCleanup(patcher.stop)

        self.region = Region.objects.create(id='household_region', name='Household Region')
        self.dorm_type = DormType.objects.create(name='HouseholdDorm', region=self.region)
        self.other_dorm_type = DormType.objects.create(name='OtherHouseholdDorm', region=self.region)
        self.building = Building.objects.create(number=501, dorm_type=self.dorm_type)

    # ------------------------------------------------------------------
    # Infrastructure helpers
    # ------------------------------------------------------------------

    def _make_apartment(self, number, apartment_type, category, room_specs, building=None):
        """room_specs: list of (room_name, capacity) tuples. Beds are
        created explicitly (not relying on solver auto-repair) unless a
        test deliberately wants to exercise that self-healing path."""
        building = building or self.building

        apartment = Apartment.objects.create(
            building=building,
            number=str(number),
            category=category,
            apartment_type=apartment_type,
            room_count=len(room_specs),
        )
        rooms = []
        for room_name, capacity in room_specs:
            room = Room.objects.create(apartment=apartment, name=room_name, capacity=capacity)
            for index in range(capacity):
                Bed.objects.create(room=room, label=str(index + 1))
            rooms.append(room)
        return apartment, rooms

    def _make_student(self, student_id, housing_type, *, gender=None, accepted_dorm_type=None):
        if gender is None:
            gender = (
                Student.Gender.MALE
                if housing_type == Student.HousingType.SINGLE_MALE
                else Student.Gender.FEMALE
            )
        return Student.objects.create(
            student_id=student_id,
            first_name='Test',
            last_name=student_id,
            gender=gender,
            housing_type=housing_type,
            accepted_dorm_type=accepted_dorm_type,
        )

    def _make_mutual_positive_roommate_pair(self, student_1, student_2):
        self._add_positive_roommate_link(student_1, student_2, index=1)
        self._add_positive_roommate_link(student_2, student_1, index=1)

    def _add_positive_roommate_link(self, from_student, to_student, index):
        """
        Add a one-directional positive roommate request in a specific
        request slot (1-5), without disturbing any other slot already set
        on `from_student` — needed to build a multi-link chain (e.g. A-B
        and B-C) for the transitive-merging tests below.
        """
        id_field = f'roommate_request_student_id_{index}'
        flag_field = f'roommate_request_flag_{index}'
        setattr(from_student, id_field, to_student.student_id)
        setattr(from_student, flag_field, True)
        from_student.save(update_fields=[id_field, flag_field])

    CONFIG = {
        'sameGender': {'enabled': True, 'strict': True, 'critical': True, 'weight': 0},
        'roommatePositiveOnly': {'enabled': True, 'strict': True, 'critical': True, 'weight': 0},
        'priorityFirst': {'enabled': False},
        'ReligiousTogether': {'enabled': False},
        'sameReligion': {'enabled': False},
        'roommateMatch': {'enabled': False},
        'sectorMatching': {'enabled': False},
        'avoidYearMix_1_with_3_4': {'enabled': False},
        'avoidAtudaimWithHasmaha': {'enabled': False},
    }

    def _run(self, students, rooms):
        import inspect
        from allocation.solver import run_improved_ortools_allocation

        test_name = inspect.stack()[1].function
        students = list(students)
        rooms = list(rooms)

        result = run_improved_ortools_allocation(students, rooms, self.CONFIG)

        _print_household_capacity_report(test_name, result, students, rooms)
        return result

    def _apartment_of(self, result, student):
        for assignment in result.get('proposed_assignments', []):
            if assignment['student_db_id'] == student.id:
                return Bed.objects.select_related('room__apartment').get(
                    id=assignment['bed_id']
                ).room.apartment
        return None

    # ------------------------------------------------------------------
    # 1. One Z3 application occupies one whole couple apartment.
    # ------------------------------------------------------------------

    def test_single_couple_application_occupies_whole_apartment(self):
        """One Z3 Student record represents an entire couple application.
        It is assigned into the empty 2-bed couple apartment, consuming
        one bed; the apartment is then unavailable to anyone else."""
        apartment, rooms = self._make_apartment(
            1, Apartment.ApartmentType.COUPLE, Apartment.Category.MIXED,
            [('A', 2)],
        )
        s1 = self._make_student('C1A', Student.HousingType.COUPLE)

        result = self._run([s1], rooms)
        self.assertEqual(result['successful_assignments'], 1, result['proposed_assignments'])
        self.assertEqual(self._apartment_of(result, s1).id, apartment.id)

    # ------------------------------------------------------------------
    # 2. Two Z3 applications cannot share, even with a mutual roommate
    #    request between them.
    # ------------------------------------------------------------------

    def test_two_couple_applications_cannot_share_even_with_mutual_request(self):
        """Two Z3 Student records are always two DIFFERENT couple
        applications, never two members of one household. Even with a
        mutual positive roommate request between them, only one of the
        two records may ever be assigned to the single available couple
        apartment; the request must have no effect on this exclusivity."""
        apartment, rooms = self._make_apartment(
            1, Apartment.ApartmentType.COUPLE, Apartment.Category.MIXED,
            [('A', 2)],
        )
        s1 = self._make_student('C1A', Student.HousingType.COUPLE)
        s2 = self._make_student('C1B', Student.HousingType.COUPLE)
        self._make_mutual_positive_roommate_pair(s1, s2)

        result = self._run([s1, s2], rooms)
        self.assertEqual(result['successful_assignments'], 1, result['proposed_assignments'])

        assigned_ids = {a['student_db_id'] for a in result['proposed_assignments']}
        self.assertEqual(len(assigned_ids & {s1.id, s2.id}), 1)

    # ------------------------------------------------------------------
    # 3. One Z4 application occupies one whole family apartment.
    # ------------------------------------------------------------------

    def test_single_family_application_occupies_whole_apartment(self):
        """One Z4 Student record represents an entire family application
        (the student and their complete family, not stored as separate
        records). It is assigned into the empty family apartment,
        consuming one bed; the apartment is then unavailable to anyone
        else, regardless of remaining physical beds."""
        apartment, rooms = self._make_apartment(
            2, Apartment.ApartmentType.FAMILY, Apartment.Category.MIXED,
            [('A', 2)],
        )
        s1 = self._make_student('F1A', Student.HousingType.FAMILY)

        result = self._run([s1], rooms)
        self.assertEqual(result['successful_assignments'], 1, result['proposed_assignments'])
        self.assertEqual(self._apartment_of(result, s1).id, apartment.id)

    # ------------------------------------------------------------------
    # 4. Two Z4 applications cannot share, even with a mutual roommate
    #    request between them.
    # ------------------------------------------------------------------

    def test_two_family_applications_cannot_share_even_with_mutual_request(self):
        """Two Z4 Student records are always two DIFFERENT family
        applications. A mutual positive roommate request between them
        must not combine them into one household — only one of the two
        may ever be assigned to the single available family apartment."""
        apartment, rooms = self._make_apartment(
            2, Apartment.ApartmentType.FAMILY, Apartment.Category.MIXED,
            [('A', 2)],
        )
        s1 = self._make_student('F1A', Student.HousingType.FAMILY)
        s2 = self._make_student('F1B', Student.HousingType.FAMILY)
        self._make_mutual_positive_roommate_pair(s1, s2)

        result = self._run([s1, s2], rooms)
        self.assertEqual(result['successful_assignments'], 1, result['proposed_assignments'])

        assigned_ids = {a['student_db_id'] for a in result['proposed_assignments']}
        self.assertEqual(len(assigned_ids & {s1.id, s2.id}), 1)

    # ------------------------------------------------------------------
    # 4b. A mutual roommate request between two INDEPENDENT exclusive
    #     applications must never suppress either assignment when they
    #     have separate apartments available.
    # ------------------------------------------------------------------

    def test_mutual_request_between_independent_couples_does_not_block_assignment(self):
        """Two Z3 Student records with a mutual positive roommate request
        between them are two independent applications. When two separate
        couple apartments are available, BOTH are assigned — one to each
        apartment. The stray roommate request must never be treated as
        household linkage and must never cap them at a single combined
        assignment."""
        apartment_1, rooms_1 = self._make_apartment(
            1, Apartment.ApartmentType.COUPLE, Apartment.Category.MIXED, [('A', 2)],
        )
        apartment_2, rooms_2 = self._make_apartment(
            2, Apartment.ApartmentType.COUPLE, Apartment.Category.MIXED, [('A', 2)],
        )
        s1 = self._make_student('IND1', Student.HousingType.COUPLE)
        s2 = self._make_student('IND2', Student.HousingType.COUPLE)
        self._make_mutual_positive_roommate_pair(s1, s2)

        result = self._run([s1, s2], rooms_1 + rooms_2)
        self.assertEqual(result['successful_assignments'], 2, result['proposed_assignments'])

        assigned_apartment_ids = {
            self._apartment_of(result, s1).id,
            self._apartment_of(result, s2).id,
        }
        self.assertEqual(assigned_apartment_ids, {apartment_1.id, apartment_2.id})

    # ------------------------------------------------------------------
    # 3. Z6 assigned exclusively to a couple-layout apartment.
    # ------------------------------------------------------------------

    def test_z6_assigned_exclusively_to_couple_layout_apartment(self):
        """A single Z6 (single student receiving a couple-layout
        apartment) applicant is assigned into a COUPLE-type apartment on
        their own, reserving the whole apartment for their household."""
        apartment, rooms = self._make_apartment(
            3, Apartment.ApartmentType.COUPLE, Apartment.Category.MIXED,
            [('A', 2)],
        )
        z6_student = self._make_student('Z6A', Student.HousingType.SINGLE_IN_APARTMENT)

        result = self._run([z6_student], rooms)
        self.assertEqual(result['successful_assignments'], 1, result['proposed_assignments'])
        self.assertEqual(self._apartment_of(result, z6_student).id, apartment.id)

    # ------------------------------------------------------------------
    # 4. Two exclusive applicants cannot share one apartment.
    # ------------------------------------------------------------------

    def test_two_unrelated_exclusive_applicants_cannot_share_apartment(self):
        """Two UNRELATED couple applicants (no mutual roommate request
        between them) compete for the same single couple apartment: only
        one household may be assigned there — never both."""
        apartment, rooms = self._make_apartment(
            4, Apartment.ApartmentType.COUPLE, Apartment.Category.MIXED,
            [('A', 2)],
        )
        s1 = self._make_student('U1', Student.HousingType.COUPLE)
        s2 = self._make_student('U2', Student.HousingType.COUPLE)

        result = self._run([s1, s2], rooms)
        self.assertEqual(result['successful_assignments'], 1, result['proposed_assignments'])

        assigned_ids = {a['student_db_id'] for a in result['proposed_assignments']}
        self.assertEqual(len(assigned_ids & {s1.id, s2.id}), 1)

    # ------------------------------------------------------------------
    # 5. A partially occupied apartment rejects a new exclusive applicant.
    # ------------------------------------------------------------------

    def test_partially_occupied_apartment_rejects_new_exclusive_applicant(self):
        """A couple apartment already has one ACTIVE existing occupant
        (from a prior run). A new, unrelated couple-type applicant must be
        rejected — the existing assignment is preserved unchanged."""
        apartment, rooms = self._make_apartment(
            5, Apartment.ApartmentType.COUPLE, Apartment.Category.MIXED,
            [('A', 2)],
        )
        existing_occupant = self._make_student('EXIST_C', Student.HousingType.COUPLE)
        existing_bed = rooms[0].beds.first()
        BedAssignment.objects.create(
            student=existing_occupant,
            bed=existing_bed,
            status=BedAssignment.Status.ACTIVE,
            assignment_type=BedAssignment.AssignmentType.MANUAL,
        )

        new_applicant = self._make_student('NEW_C', Student.HousingType.COUPLE)

        result = self._run([new_applicant], rooms)
        self.assertEqual(result['successful_assignments'], 0, result['proposed_assignments'])

        existing_assignment = BedAssignment.objects.get(student=existing_occupant)
        self.assertEqual(existing_assignment.status, BedAssignment.Status.ACTIVE)
        self.assertEqual(existing_assignment.bed_id, existing_bed.id)

    # ------------------------------------------------------------------
    # 6. Wrong apartment type/category is rejected.
    # ------------------------------------------------------------------

    def test_wrong_apartment_type_or_category_is_rejected(self):
        """A couple-type apartment mistakenly marked category=FEMALE
        (instead of MIXED) is correctly rejected for a couple applicant,
        even though physical beds exist there."""
        mislabeled_apartment, rooms = self._make_apartment(
            6, Apartment.ApartmentType.COUPLE, Apartment.Category.FEMALE,
            [('A', 2)],
        )
        s1 = self._make_student('WRONG1', Student.HousingType.COUPLE)

        result = self._run([s1], rooms)
        self.assertEqual(result['successful_assignments'], 0, result['proposed_assignments'])

    # ------------------------------------------------------------------
    # 7. Accepted dorm type filtering works correctly.
    # ------------------------------------------------------------------

    def test_accepted_dorm_type_filtering(self):
        """A couple applicant whose accepted_dorm_type does not match the
        only available couple apartment's dorm type is rejected; the same
        applicant with a matching accepted_dorm_type is assigned."""
        apartment, rooms = self._make_apartment(
            7, Apartment.ApartmentType.COUPLE, Apartment.Category.MIXED,
            [('A', 2)],
        )

        mismatched_student = self._make_student(
            'DORM_MISMATCH', Student.HousingType.COUPLE, accepted_dorm_type=self.other_dorm_type,
        )
        result_mismatch = self._run([mismatched_student], rooms)
        self.assertEqual(
            result_mismatch['successful_assignments'], 0, result_mismatch['proposed_assignments'],
        )

        matched_student = self._make_student(
            'DORM_MATCH', Student.HousingType.COUPLE, accepted_dorm_type=self.dorm_type,
        )
        result_match = self._run([matched_student], rooms)
        self.assertEqual(
            result_match['successful_assignments'], 1, result_match['proposed_assignments'],
        )

    # ------------------------------------------------------------------
    # 8. Available apartment with missing beds is detected/repaired.
    # ------------------------------------------------------------------

    def test_missing_bed_records_are_detected_and_repaired(self):
        """A Room is recorded with capacity=2, but only ONE Bed row was
        actually created (a data-entry gap). The solver's existing
        bed-auto-repair (_ensure_beds_for_room) detects and creates the
        missing bed. A single Z3 application is still assigned exactly
        once, occupying one bed — the repaired second bed does not admit
        a second Student record."""
        apartment = Apartment.objects.create(
            building=self.building, number='8', category=Apartment.Category.MIXED,
            apartment_type=Apartment.ApartmentType.COUPLE, room_count=1,
        )
        room = Room.objects.create(apartment=apartment, name='A', capacity=2)
        Bed.objects.create(room=room, label='1')  # only one of two beds created

        self.assertEqual(room.beds.count(), 1, 'Test setup should start with a missing bed.')

        s1 = self._make_student('REPAIR1', Student.HousingType.COUPLE)

        result = self._run([s1], [room])

        self.assertEqual(room.beds.count(), 2, 'The missing bed should have been auto-created.')
        self.assertEqual(result['successful_assignments'], 1, result['proposed_assignments'])

    # ------------------------------------------------------------------
    # 9. Multiple available couple/family apartments maximize assignments.
    # ------------------------------------------------------------------

    def test_multiple_apartments_maximize_assigned_applications(self):
        """Two couple apartments (2 beds each) but THREE independent Z3
        applications compete for them: exactly two are assigned — one
        Student record per apartment — and the third remains entirely
        unassigned. A spurious mutual roommate request between two of the
        applicants must have no effect on this outcome."""
        apartment_1, rooms_1 = self._make_apartment(
            9, Apartment.ApartmentType.COUPLE, Apartment.Category.MIXED, [('A', 2)],
        )
        apartment_2, rooms_2 = self._make_apartment(
            10, Apartment.ApartmentType.COUPLE, Apartment.Category.MIXED, [('A', 2)],
        )

        s1 = self._make_student('MC1', Student.HousingType.COUPLE)
        s2 = self._make_student('MC2', Student.HousingType.COUPLE)
        s3 = self._make_student('MC3', Student.HousingType.COUPLE)
        self._make_mutual_positive_roommate_pair(s1, s2)

        result = self._run([s1, s2, s3], rooms_1 + rooms_2)

        self.assertEqual(result['successful_assignments'], 2, result['proposed_assignments'])

        assigned_ids = {a['student_db_id'] for a in result['proposed_assignments']}
        self.assertEqual(len(assigned_ids), 2, 'Exactly two of the three applications should be assigned.')

        assigned_apartment_ids = [
            self._apartment_of(result, student).id
            for student in (s1, s2, s3)
            if student.id in assigned_ids
        ]
        self.assertEqual(
            len(set(assigned_apartment_ids)), 2,
            'The two assigned applications must occupy two different apartments '
            '— one Student record per apartment, never two in one.',
        )

    # ------------------------------------------------------------------
    # 10. Ordinary single allocation remains unchanged.
    # ------------------------------------------------------------------

    def test_ordinary_single_allocation_unchanged(self):
        """Z1/Z2 ordinary single students are unaffected by the household-
        exclusivity fix: each single apartment still holds independent,
        unrelated single students up to its own bed capacity."""
        female_apartment, female_rooms = self._make_apartment(
            11, Apartment.ApartmentType.SINGLE, Apartment.Category.FEMALE, [('A', 2)],
        )
        male_apartment, male_rooms = self._make_apartment(
            12, Apartment.ApartmentType.SINGLE, Apartment.Category.MALE, [('A', 2)],
        )

        sf1 = self._make_student('SF1', Student.HousingType.SINGLE_FEMALE)
        sf2 = self._make_student('SF2', Student.HousingType.SINGLE_FEMALE)
        sm1 = self._make_student('SM1', Student.HousingType.SINGLE_MALE)

        result = self._run([sf1, sf2, sm1], female_rooms + male_rooms)
        self.assertEqual(result['successful_assignments'], 3, result['proposed_assignments'])

        self.assertEqual(self._apartment_of(result, sf1).id, female_apartment.id)
        self.assertEqual(self._apartment_of(result, sf2).id, female_apartment.id)
        self.assertEqual(self._apartment_of(result, sm1).id, male_apartment.id)

    # ------------------------------------------------------------------
    # 11. Z6 is NEVER grouped, even given a mutual roommate request.
    # ------------------------------------------------------------------

    def test_z6_never_groups_even_with_mutual_roommate_request(self):
        """
        Two Z6 Student records are always two DIFFERENT individual
        applications, each requiring exclusive use of an entire apartment.
        A mutual roommate request between them has no effect. With only
        one couple-layout apartment available, only ONE of them is
        assigned; the other remains unassigned rather than sharing.
        """
        apartment, rooms = self._make_apartment(
            14, Apartment.ApartmentType.COUPLE, Apartment.Category.MIXED, [('A', 2)],
        )
        z6_a = self._make_student('Z6PAIR_A', Student.HousingType.SINGLE_IN_APARTMENT)
        z6_b = self._make_student('Z6PAIR_B', Student.HousingType.SINGLE_IN_APARTMENT)
        self._make_mutual_positive_roommate_pair(z6_a, z6_b)

        result = self._run([z6_a, z6_b], rooms)
        self.assertEqual(result['successful_assignments'], 1, result['proposed_assignments'])

        assigned_ids = {a['student_db_id'] for a in result['proposed_assignments']}
        self.assertEqual(
            len(assigned_ids & {z6_a.id, z6_b.id}),
            1,
            'Z6 must never share an apartment, even with a mutually '
            'requested partner.',
        )
        self.assertEqual(self._apartment_of(result, z6_a) or self._apartment_of(result, z6_b), apartment)

    # ------------------------------------------------------------------
    # 12. Household grouping must never combine different housing types.
    # ------------------------------------------------------------------

    def test_cross_housing_type_mutual_request_has_no_effect(self):
        """
        A Z3 (couple) and a Z4 (family) applicant mutually request each
        other as roommates. There is no household concept linking them —
        the request is simply irrelevant to allocation. Each is
        independently assigned into its own type-matching apartment; the
        mutual request neither merges them nor blocks either assignment.
        """
        couple_apartment, couple_rooms = self._make_apartment(
            12, Apartment.ApartmentType.COUPLE, Apartment.Category.MIXED, [('A', 2)],
        )
        family_apartment, family_rooms = self._make_apartment(
            13, Apartment.ApartmentType.FAMILY, Apartment.Category.MIXED, [('A', 2)],
        )
        couple_student = self._make_student('CROSS_Z3', Student.HousingType.COUPLE)
        family_student = self._make_student('CROSS_Z4', Student.HousingType.FAMILY)
        self._make_mutual_positive_roommate_pair(couple_student, family_student)

        result = self._run([couple_student, family_student], couple_rooms + family_rooms)

        self.assertEqual(result['successful_assignments'], 2, result['proposed_assignments'])
        self.assertEqual(self._apartment_of(result, couple_student).id, couple_apartment.id)
        self.assertEqual(self._apartment_of(result, family_student).id, family_apartment.id)

    # ------------------------------------------------------------------
    # 14. Existing assignment: verified partner may join; unrelated may not.
    # ------------------------------------------------------------------

    def test_mutual_request_does_not_admit_second_record_into_occupied_apartment(self):
        """
        One Z3 application already occupies the apartment (a pre-existing
        active assignment, e.g. from a previous run or manual entry). A
        second, independent Z3 application with a mutual positive
        roommate request to the existing occupant must still be REJECTED
        — a mutual request is never grounds to admit a second Student
        record into an apartment that already has any active assignment.
        The existing assignment is preserved unchanged.
        """
        apartment, rooms = self._make_apartment(
            16, Apartment.ApartmentType.COUPLE, Apartment.Category.MIXED, [('A', 2)],
        )
        existing_member = self._make_student('EXIST_V1', Student.HousingType.COUPLE)
        other_applicant = self._make_student('PARTNER_V2', Student.HousingType.COUPLE)
        self._make_mutual_positive_roommate_pair(existing_member, other_applicant)

        existing_bed = rooms[0].beds.first()
        BedAssignment.objects.create(
            student=existing_member,
            bed=existing_bed,
            status=BedAssignment.Status.ACTIVE,
            assignment_type=BedAssignment.AssignmentType.MANUAL,
        )

        result = self._run([other_applicant], rooms)
        self.assertEqual(result['successful_assignments'], 0, result['proposed_assignments'])

        existing_assignment = BedAssignment.objects.get(student=existing_member)
        self.assertEqual(existing_assignment.status, BedAssignment.Status.ACTIVE)
        self.assertEqual(existing_assignment.bed_id, existing_bed.id)

    def test_unrelated_applicant_still_rejected_when_existing_occupant_present(self):
        """
        Same setup as above (one existing couple occupant), but the new
        candidate is a couple-type applicant with NO roommate link to the
        existing occupant. They must still be rejected — any existing
        active assignment makes the exclusive apartment unavailable to
        every other applicant, unconditionally.
        """
        apartment, rooms = self._make_apartment(
            17, Apartment.ApartmentType.COUPLE, Apartment.Category.MIXED, [('A', 2)],
        )
        existing_member = self._make_student('EXIST_V3', Student.HousingType.COUPLE)
        existing_bed = rooms[0].beds.first()
        BedAssignment.objects.create(
            student=existing_member,
            bed=existing_bed,
            status=BedAssignment.Status.ACTIVE,
            assignment_type=BedAssignment.AssignmentType.MANUAL,
        )

        unrelated_applicant = self._make_student('UNRELATED_V4', Student.HousingType.COUPLE)

        result = self._run([unrelated_applicant], rooms)
        self.assertEqual(result['successful_assignments'], 0, result['proposed_assignments'])

        existing_assignment = BedAssignment.objects.get(student=existing_member)
        self.assertEqual(existing_assignment.status, BedAssignment.Status.ACTIVE)
        self.assertEqual(existing_assignment.bed_id, existing_bed.id)

    # ------------------------------------------------------------------
    # 15. Manual assignment/transfer validation enforces the same rules.
    # ------------------------------------------------------------------

    def test_manual_assignment_validation_blocks_unrelated_couple(self):
        """api.views.validate_apartment_assignment (used by manual
        assign/move/swap and Transfer approval) must reject a second
        couple-type Student record from an apartment that already has an
        existing active assignment."""
        from api.views import validate_apartment_assignment

        apartment, rooms = self._make_apartment(
            18, Apartment.ApartmentType.COUPLE, Apartment.Category.MIXED, [('A', 2)],
        )
        existing_member = self._make_student('MANUAL_EXIST', Student.HousingType.COUPLE)
        BedAssignment.objects.create(
            student=existing_member,
            bed=rooms[0].beds.first(),
            status=BedAssignment.Status.ACTIVE,
            assignment_type=BedAssignment.AssignmentType.MANUAL,
        )

        unrelated_applicant = self._make_student('MANUAL_UNRELATED', Student.HousingType.COUPLE)

        with self.assertRaises(ValueError):
            validate_apartment_assignment(unrelated_applicant, rooms[0])

    def test_manual_assignment_validation_blocks_second_record_even_with_mutual_request(self):
        """The same manual-assignment validation must REJECT a second Z3
        Student record even when it carries a mutual positive roommate
        request to the existing occupant — a roommate request is never
        grounds to admit a second application into an occupied exclusive
        apartment."""
        from api.views import validate_apartment_assignment

        apartment, rooms = self._make_apartment(
            19, Apartment.ApartmentType.COUPLE, Apartment.Category.MIXED, [('A', 2)],
        )
        existing_member = self._make_student('MANUAL_EXIST2', Student.HousingType.COUPLE)
        other_applicant = self._make_student('MANUAL_PARTNER2', Student.HousingType.COUPLE)
        self._make_mutual_positive_roommate_pair(existing_member, other_applicant)

        BedAssignment.objects.create(
            student=existing_member,
            bed=rooms[0].beds.first(),
            status=BedAssignment.Status.ACTIVE,
            assignment_type=BedAssignment.AssignmentType.MANUAL,
        )

        with self.assertRaises(ValueError):
            validate_apartment_assignment(other_applicant, rooms[0])

    def test_manual_assignment_validation_blocks_second_z6_record(self):
        """api.views.validate_apartment_assignment must reject a second Z6
        Student record from an apartment that already has an active Z6
        assignment — Z6 always requires exclusive use of the complete
        apartment, with no exception for any roommate request."""
        from api.views import validate_apartment_assignment

        apartment, rooms = self._make_apartment(
            20, Apartment.ApartmentType.COUPLE, Apartment.Category.MIXED, [('A', 2)],
        )
        existing_z6 = self._make_student('MANUAL_Z6_EXIST', Student.HousingType.SINGLE_IN_APARTMENT)
        other_z6 = self._make_student('MANUAL_Z6_OTHER', Student.HousingType.SINGLE_IN_APARTMENT)
        self._make_mutual_positive_roommate_pair(existing_z6, other_z6)

        BedAssignment.objects.create(
            student=existing_z6,
            bed=rooms[0].beds.first(),
            status=BedAssignment.Status.ACTIVE,
            assignment_type=BedAssignment.AssignmentType.MANUAL,
        )

        with self.assertRaises(ValueError):
            validate_apartment_assignment(other_z6, rooms[0])


# ---------------------------------------------------------------------------
# Accessibility / disability: saved normally, never sent to the solver.
# ---------------------------------------------------------------------------
class AccessibilityAllocationExclusionTest(TestCase):
    """
    Covers the confirmed root cause of the over-flagging bug plus the
    surrounding accessibility/category behavior:

    Root cause: the allocation-group ("החלטה-תאור קבוצת הקצאה") whitelist
    used to also include the STAYING/CONTINUING category value
    ('הסמכה – ותיקים+חדשים שנפסלו כחדשים+בינלאומי מלאות2'), which is the
    majority category for returning students. That single mistaken entry
    caused 722 of 840 students to be marked accessibility_flag=True and
    excluded from the OR-Tools solver, leaving only 118 students actually
    allocated. Only the EXACT value 'הסמכה - נכים' may set
    accessibility_flag=True (see ACCESSIBILITY_ALLOCATION_GROUP_VALUES /
    allocation_group_indicates_accessibility in api/views.py).

    Separately, an accessibility_flag=True student must still be saved
    normally but excluded from the solver — neither api.views.run_allocation
    nor api.views._execute_allocation_background sends
    accessibility_flag=True students to
    allocation.solver.run_improved_ortools_allocation; the dorm office
    allocates them manually.

    None of this may affect is_priority (see
    priority_fields_from_special_statuses / StudentPriorityImportTest),
    which is derived solely from special_status_1..4.
    """

    def _make_row(self, **overrides):
        import pandas as pd

        values = {
            'ת"ז ישראלית': overrides.pop('student_id', 'ACCROW1'),
            'שם פרטי': overrides.pop('first_name', 'Test'),
            'שם משפחה': overrides.pop('last_name', 'Student'),
            'תיאור סוג מגורים': overrides.pop('housing_type', 'רווקות'),
        }

        alias_to_header = {
            'accessibility_flag': 'החלטה-זקוק להנגשה',
            'disability_percent': '%נכות',
            'medical_reason': 'סיבה רפואית מאושרת מרופאת הטכניון',
            'allocation_group': 'תיאור קבוצת הקצאה',
            'special_status_1': 'תאור סטטוס מיוחד1',
        }
        for key, header in alias_to_header.items():
            if key in overrides:
                values[header] = overrides.pop(key)

        assert not overrides, f"Unrecognized row overrides: {overrides}"
        return pd.Series(values)

    # ------------------------------------------------------------------
    # 1. allocation_group values containing נכים mark accessibility.
    # ------------------------------------------------------------------

    def test_allocation_group_hasmaha_nichim_marks_accessibility(self):
        """allocation_group='הסמכה - נכים' (no explicit accessibility
        columns) must still set accessibility_flag=True — an EXACT
        confirmed accessibility category value."""
        from api.views import build_student_payload_from_row

        row = self._make_row(student_id='ACC_GRP1', allocation_group='הסמכה - נכים')
        payload = build_student_payload_from_row(row)
        self.assertTrue(payload['accessibility_flag'])

    def test_allocation_group_kdam_academi_nichim_does_not_mark_accessibility(self):
        """allocation_group='קדםאקדמי - כולל נכים' is NOT one of the
        confirmed exact accessibility values and must NOT set
        accessibility_flag=True — only 'הסמכה - נכים' does."""
        from api.views import build_student_payload_from_row

        row = self._make_row(student_id='ACC_GRP2', allocation_group='קדםאקדמי - כולל נכים')
        payload = build_student_payload_from_row(row)
        self.assertFalse(payload['accessibility_flag'])

    def test_allocation_group_staying_value_does_not_mark_accessibility(self):
        """
        Regression test for the confirmed root cause: allocation_group=
        'הסמכה – ותיקים+חדשים שנפסלו כחדשים+בינלאומי מלאות2' identifies
        STAYING/CONTINUING students (the majority category) and must NOT
        set accessibility_flag=True. Before the fix, this exact value was
        mistakenly included in the accessibility whitelist, which flagged
        722 of 840 students as accessibility_flag=True and excluded them
        from the OR-Tools solver, leaving only 118 actually allocated.
        These students must still reach the solver like any other
        staying/continuing student, since all students are re-allocated
        from scratch.
        """
        from api.views import build_student_payload_from_row

        row = self._make_row(
            student_id='ACC_GRP3',
            allocation_group='הסמכה – ותיקים+חדשים שנפסלו כחדשים+בינלאומי מלאות2',
        )
        payload = build_student_payload_from_row(row)
        self.assertFalse(payload['accessibility_flag'])
        self.assertEqual(payload['category'], Student.StudentCategory.CONTINUING)

    def test_allocation_group_staying_value_dash_variant_still_classified_as_staying(self):
        """The same staying/continuing value, but with a plain hyphen
        instead of an en-dash (a real Excel-export inconsistency), must
        still classify as CONTINUING and not accessibility — proving
        normalization is dash-insensitive in both directions."""
        from api.views import build_student_payload_from_row

        row = self._make_row(
            student_id='ACC_GRP3B',
            allocation_group='הסמכה - ותיקים+חדשים שנפסלו כחדשים+בינלאומי מלאות2',
        )
        payload = build_student_payload_from_row(row)
        self.assertFalse(payload['accessibility_flag'])
        self.assertEqual(payload['category'], Student.StudentCategory.CONTINUING)

    def test_allocation_group_new_values_marked_new_and_not_accessibility(self):
        """allocation_group='הסמכה – חדשים' and 'מסיימי מכינה מאוחרים – שנה
        1' must classify as StudentCategory.NEW and must not be treated as
        accessibility."""
        from api.views import build_student_payload_from_row

        for index, allocation_group in enumerate((
            'הסמכה – חדשים',
            'מסיימי מכינה מאוחרים – שנה 1',
        ), start=1):
            row = self._make_row(student_id=f'ACC_GRP_NEW{index}', allocation_group=allocation_group)
            payload = build_student_payload_from_row(row)
            self.assertFalse(payload['accessibility_flag'], allocation_group)
            self.assertEqual(payload['category'], Student.StudentCategory.NEW, allocation_group)

    def test_allocation_group_other_ordinary_value_sent_normally(self):
        """allocation_group='תארים מתקדמים – מגיסטרים+דוקטורים+בינלאומיים'
        (advanced degrees) is an ordinary non-empty value: not
        accessibility, and no special category field/migration is created
        for it — it falls back to the existing CONTINUING default."""
        from api.views import build_student_payload_from_row

        row = self._make_row(
            student_id='ACC_GRP_OTHER1',
            allocation_group='תארים מתקדמים – מגיסטרים+דוקטורים+בינלאומיים',
        )
        payload = build_student_payload_from_row(row)
        self.assertFalse(payload['accessibility_flag'])
        self.assertEqual(payload['category'], Student.StudentCategory.CONTINUING)

    def test_allocation_group_unrelated_value_does_not_mark_accessibility(self):
        """An ordinary, unrelated allocation-group value must not be
        treated as accessibility."""
        from api.views import build_student_payload_from_row

        row = self._make_row(student_id='ACC_GRP5', allocation_group='רגילים')
        payload = build_student_payload_from_row(row)
        self.assertFalse(payload['accessibility_flag'])

    def test_allocation_group_header_is_not_treated_as_value(self):
        """The column header text itself ('החלטה-תאור קבוצת הקצאה' / 'תיאור
        קבוצת הקצאה') must never be read back as if it were a cell value —
        get_row_value() only ever returns row.get(column_name), never the
        column name itself, so a row whose allocation_group cell literally
        equals the header text is not one of the confirmed category values
        and must not be classified as accessibility or as any exact
        staying/new category."""
        from api.views import build_student_payload_from_row

        row = self._make_row(
            student_id='ACC_GRP_HDR1',
            allocation_group='תיאור קבוצת הקצאה',
        )
        payload = build_student_payload_from_row(row)
        self.assertFalse(payload['accessibility_flag'])
        self.assertEqual(payload['category'], Student.StudentCategory.CONTINUING)

    def test_allocation_group_partial_match_does_not_mark_accessibility(self):
        """
        A value that merely SHARES WORDS with a confirmed accessibility
        category (e.g. 'הסמכה' alone, or 'הסמכה - אחר') must NOT be
        treated as accessibility — the match is an exact confirmed
        category value, never a broad substring/partial rule that could
        misclassify ordinary הסמכה students who are not in the
        accessibility cohort.
        """
        from api.views import build_student_payload_from_row

        row_bare = self._make_row(student_id='ACC_GRP6', allocation_group='הסמכה')
        self.assertFalse(build_student_payload_from_row(row_bare)['accessibility_flag'])

        row_other = self._make_row(student_id='ACC_GRP7', allocation_group='הסמכה - אחר')
        self.assertFalse(build_student_payload_from_row(row_other)['accessibility_flag'])

    def test_allocation_group_accessibility_does_not_set_priority(self):
        """Accessibility derived from allocation_group text must never set
        is_priority — only special_status_1..4 may do that."""
        from api.views import build_student_payload_from_row

        row = self._make_row(student_id='ACC_GRP_PRI1', allocation_group='הסמכה - נכים')
        payload = build_student_payload_from_row(row)
        self.assertTrue(payload['accessibility_flag'])
        self.assertFalse(payload['is_priority'])
        self.assertEqual(payload['priority_reason'], '')

    def test_allocation_group_staying_and_new_values_do_not_set_priority(self):
        """The staying/new category values must never set is_priority
        either — only special_status_1..4 may do that."""
        from api.views import build_student_payload_from_row

        for index, allocation_group in enumerate((
            'הסמכה – ותיקים+חדשים שנפסלו כחדשים+בינלאומי מלאות2',
            'הסמכה – חדשים',
            'מסיימי מכינה מאוחרים – שנה 1',
        ), start=1):
            row = self._make_row(student_id=f'ACC_GRP_PRI2_{index}', allocation_group=allocation_group)
            payload = build_student_payload_from_row(row)
            self.assertFalse(payload['accessibility_flag'], allocation_group)
            self.assertFalse(payload['is_priority'], allocation_group)
            self.assertEqual(payload['priority_reason'], '', allocation_group)

    # ------------------------------------------------------------------
    # 2. Real Excel upload still saves accessibility students normally.
    # ------------------------------------------------------------------

    def test_upload_excel_saves_accessibility_student_via_allocation_group(self):
        """End-to-end: /api/upload/excel/ with a real .xlsx row whose only
        accessibility signal is the allocation-group text must still save
        accessibility_flag=True and is_priority=False."""
        import io

        import pandas as pd
        from django.core.files.uploadedfile import SimpleUploadedFile

        buffer = io.BytesIO()
        pd.DataFrame([{
            'ת"ז ישראלית': 'ACC_UP1',
            'שם פרטי': 'Test',
            'שם משפחה': 'Upload',
            'תיאור סוג מגורים': 'רווקות',
            'תיאור קבוצת הקצאה': 'הסמכה - נכים',
        }]).to_excel(buffer, index=False, sheet_name='נכנסים חדשים')
        buffer.seek(0)

        try:
            pd.ExcelFile(buffer)
        except ImportError as exc:
            self.skipTest(
                f"openpyxl/pandas version mismatch in this environment ({exc}); "
                "this pre-existing environment issue is unrelated to the fix — "
                "see build_student_payload_from_row unit tests above for full "
                "coverage of the actual shared mapping logic."
            )
        buffer.seek(0)

        admin = _make_central_admin()
        client = APIClient()
        client.force_authenticate(user=admin)

        upload_file = SimpleUploadedFile(
            'accessibility.xlsx', buffer.read(),
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )

        response = client.post('/api/upload/excel/', {'file': upload_file}, format='multipart')
        self.assertEqual(response.status_code, 200, response.data)

        student = Student.objects.get(student_id='ACC_UP1')
        self.assertTrue(student.accessibility_flag)
        self.assertFalse(student.is_priority)

    # ------------------------------------------------------------------
    # 3. accessibility_flag=True students are excluded from allocation.
    # ------------------------------------------------------------------

    def test_run_allocation_excludes_accessibility_students(self):
        """/api/allocation/run/ (views.run_allocation) must never send an
        accessibility_flag=True student to the solver, even though they
        have a perfectly valid candidate bed available. An ordinary
        student in the same room must still be assigned."""
        region = _make_region('AccessRegion')
        boss = _make_region_boss(region)
        dorm_type = DormType.objects.create(name='AccessDorm', region=region)
        building = Building.objects.create(number=901, dorm_type=dorm_type)
        apartment = Apartment.objects.create(
            building=building, number='1', category=Apartment.Category.FEMALE,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=1,
        )
        room = Room.objects.create(apartment=apartment, name='A', capacity=2)
        Bed.objects.create(room=room, label='1')
        Bed.objects.create(room=room, label='2')

        ordinary = Student.objects.create(
            student_id='ACC_ORD1', first_name='Ord', last_name='Student',
            gender=Student.Gender.FEMALE, housing_type=Student.HousingType.SINGLE_FEMALE,
            accepted_dorm_type=dorm_type,
        )
        accessible = Student.objects.create(
            student_id='ACC_EXCL1', first_name='Acc', last_name='Student',
            gender=Student.Gender.FEMALE, housing_type=Student.HousingType.SINGLE_FEMALE,
            accepted_dorm_type=dorm_type, accessibility_flag=True,
        )

        patcher = patch('allocation.solver.close_old_connections')
        patcher.start()
        self.addCleanup(patcher.stop)

        client = APIClient()
        client.force_authenticate(user=boss)
        response = client.post('/api/allocation/run/', {'region': region.id}, format='json')
        self.assertEqual(response.status_code, 200, response.data)

        ordinary.refresh_from_db()
        accessible.refresh_from_db()
        self.assertTrue(ordinary.is_assigned)
        self.assertFalse(accessible.is_assigned)


# ---------------------------------------------------------------------------
# Anir (אנייר) reserved-building policy: upload mapping + solver detection.
# ---------------------------------------------------------------------------
class AnierBuildingMappingTest(TestCase):
    """
    Root cause of the reserved Anir (building 179) building receiving zero
    students — two independent defects, both required to be fixed:

    1. Upload mapping: the main upload's Excel column '9108-אנייר' (an 'X'
       flag) was never read anywhere — COLUMN_ALIASES had no entry for it,
       so no student ever got the 'אנייר' marker recorded in
       special_status_1..4, and _has_anier_special_status was always False
       for everyone. Fixed by adding the 'anier_flag' alias and injecting
       the marker via inject_special_status_marker in
       build_student_payload_from_row — shared by both
       /api/upload/excel/ and /api/upload/additions-excel/ (both call this
       same function, so one fix covers both flows).

    2. Solver region detection: allocation.solver._is_upper_dorm_office_region
       only recognized the allocation Region's own name/id. Confirmed by
       inspection: in production, the Region itself carries no such
       marker — only a DormType named 'עליון עמים' (code 11) does, and
       building 179 (confirmed correct) sits under that DormType. So even
       a correctly-flagged, eligible Anir student could never be
       recognized as an exclusive-group member. Fixed by
       allocation.solver._is_upper_dorm_office_dorm_type (DormType.code==11),
       used together with (not instead of) the region-name fallback.
    """

    def _make_row(self, **overrides):
        import pandas as pd

        values = {
            'ת"ז ישראלית': overrides.pop('student_id', 'ANIERROW1'),
            'שם פרטי': overrides.pop('first_name', 'Test'),
            'שם משפחה': overrides.pop('last_name', 'Student'),
            'תיאור סוג מגורים': overrides.pop('housing_type', 'רווקות'),
        }

        alias_to_header = {
            'anier_flag': '9108-אנייר',
            'special_status_1': 'תאור סטטוס מיוחד1',
            'special_status_2': 'תאור סטטוס מיוחד2',
            'special_status_3': 'תאור סטטוס מיוחד3',
            'special_status_4': 'תאור סטטוס מיוחד4',
        }
        for key, header in alias_to_header.items():
            if key in overrides:
                values[header] = overrides.pop(key)

        assert not overrides, f"Unrecognized row overrides: {overrides}"
        return pd.Series(values)

    # ------------------------------------------------------------------
    # 1. The 9108-אנייר column injects the אנייר marker.
    # ------------------------------------------------------------------

    def test_anier_column_flag_injects_special_status(self):
        """A bare '9108-אנייר'='X' flag, with no other special status, must
        result in 'אנייר' recorded in special_status_1..4, is_priority=True,
        and priority_reason == 'אנייר'."""
        from api.views import build_student_payload_from_row

        row = self._make_row(student_id='ANIER1', anier_flag='X')
        payload = build_student_payload_from_row(row)

        statuses = [
            payload['special_status_1'], payload['special_status_2'],
            payload['special_status_3'], payload['special_status_4'],
        ]
        self.assertIn('אנייר', statuses)
        self.assertTrue(payload['is_priority'])
        self.assertEqual(payload['priority_reason'], 'אנייר')

    def test_anier_flag_combines_with_existing_special_status(self):
        """An existing הסמכה special status plus the אנייר column flag must
        produce BOTH markers, joined in priority_reason."""
        from api.views import build_student_payload_from_row

        row = self._make_row(student_id='ANIER2', special_status_1='הסמכה', anier_flag='X')
        payload = build_student_payload_from_row(row)

        statuses = [
            payload['special_status_1'], payload['special_status_2'],
            payload['special_status_3'], payload['special_status_4'],
        ]
        self.assertIn('הסמכה', statuses)
        self.assertIn('אנייר', statuses)
        self.assertEqual(payload['priority_reason'], 'הסמכה | אנייר')

    def test_anier_flag_not_duplicated_when_already_present(self):
        """If 'אנייר' is already present as a special-status value (legacy
        data), the column flag must not create a duplicate entry."""
        from api.views import build_student_payload_from_row

        row = self._make_row(student_id='ANIER3', special_status_2='אנייר', anier_flag='X')
        payload = build_student_payload_from_row(row)

        statuses = [
            payload['special_status_1'], payload['special_status_2'],
            payload['special_status_3'], payload['special_status_4'],
        ]
        self.assertEqual(statuses.count('אנייר'), 1)

    def test_anier_flag_absent_leaves_special_status_untouched(self):
        """A blank/absent 9108-אנייר column must not add anything."""
        from api.views import build_student_payload_from_row

        row = self._make_row(student_id='ANIER4', special_status_1='הסמכה')
        payload = build_student_payload_from_row(row)

        statuses = [
            payload['special_status_1'], payload['special_status_2'],
            payload['special_status_3'], payload['special_status_4'],
        ]
        self.assertNotIn('אנייר', statuses)

    # ------------------------------------------------------------------
    # 2. Real Excel upload end-to-end — proves the column-name mapping
    #    survives the actual pandas read_excel round trip, not just a
    #    hand-built pandas Series.
    # ------------------------------------------------------------------

    def test_upload_excel_saves_anier_student_via_real_column(self):
        import io

        import pandas as pd
        from django.core.files.uploadedfile import SimpleUploadedFile

        buffer = io.BytesIO()
        pd.DataFrame([{
            'ת"ז ישראלית': 'ANIER_UP1',
            'שם פרטי': 'Test',
            'שם משפחה': 'Upload',
            'תיאור סוג מגורים': 'רווקות',
            '9108-אנייר': 'X',
        }]).to_excel(buffer, index=False, sheet_name='נכנסים חדשים')
        buffer.seek(0)

        try:
            pd.ExcelFile(buffer)
        except ImportError as exc:
            self.skipTest(
                f"openpyxl/pandas version mismatch in this environment ({exc}); "
                "this pre-existing environment issue is unrelated to the fix — "
                "see build_student_payload_from_row unit tests above for full "
                "coverage of the actual shared mapping logic."
            )
        buffer.seek(0)

        admin = _make_central_admin()
        client = APIClient()
        client.force_authenticate(user=admin)

        upload_file = SimpleUploadedFile(
            'anier.xlsx', buffer.read(),
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        response = client.post('/api/upload/excel/', {'file': upload_file}, format='multipart')
        self.assertEqual(response.status_code, 200, response.data)

        student = Student.objects.get(student_id='ANIER_UP1')
        self.assertTrue(student.is_priority)
        self.assertIn('אנייר', [
            student.special_status_1, student.special_status_2,
            student.special_status_3, student.special_status_4,
        ])

    # ------------------------------------------------------------------
    # 3. Solver: DormType.code==11 recognition (the real production
    #    signal), independent of the Region's own name/id.
    # ------------------------------------------------------------------

    UPPER_OFFICE_CONFIG = {
        'sameGender': {'enabled': True, 'strict': True, 'critical': True, 'weight': 0},
        'priorityFirst': {'enabled': True, 'strict': True, 'critical': True, 'weight': 0},
        'roommatePositiveOnly': {'enabled': True, 'strict': True, 'critical': True, 'weight': 0},
        'ReligiousTogether': {'enabled': False},
    }

    def _make_upper_office_building_179(self, region_id, region_name, dorm_name, beds=1):
        """
        The Region deliberately carries NO 'Upper Dorm Office' marker of
        its own (generic id/name) — only the DormType (code=11) does,
        matching confirmed production data (building 179 is confirmed
        correct; the Region itself is generic).
        """
        region = Region.objects.create(id=region_id, name=region_name)
        dorm_type = DormType.objects.create(name=dorm_name, code=11, region=region)
        building = Building.objects.create(number=179, dorm_type=dorm_type)
        apartment = Apartment.objects.create(
            building=building, number='1', category=Apartment.Category.FEMALE,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=1,
        )
        room = Room.objects.create(apartment=apartment, name='A', capacity=beds)
        for index in range(beds):
            Bed.objects.create(room=room, label=str(index + 1))
        return region, dorm_type, building, apartment, room

    def _make_eligible_anier(self, student_id):
        return Student.objects.create(
            student_id=student_id, first_name='T', last_name='S',
            gender=Student.Gender.FEMALE, housing_type=Student.HousingType.SINGLE_FEMALE,
            is_priority=True, special_status_1='הסמכה', special_status_2='אנייר',
        )

    def _patch_close_old_connections(self):
        patcher = patch('allocation.solver.close_old_connections')
        patcher.start()
        self.addCleanup(patcher.stop)

    # ------------------------------------------------------------------
    # 3a. An eligible Anir student CAN enter building 179.
    # ------------------------------------------------------------------

    def test_eligible_anier_student_can_enter_building_179(self):
        """An eligible Anir student (is_priority + הסמכה + אנייר) is
        recognized purely via DormType.code==11 — the Region carries no
        marker of its own — and is assigned into building 179."""
        from allocation.solver import run_improved_ortools_allocation

        _, _, _, _, room = self._make_upper_office_building_179(
            'anier_region_a', 'Region A', 'עליון עמים A', beds=1,
        )
        eligible_anier = self._make_eligible_anier('ANIER_OK1')

        self._patch_close_old_connections()
        result = run_improved_ortools_allocation([eligible_anier], [room], self.UPPER_OFFICE_CONFIG)

        assigned_ids = {item['student_db_id'] for item in result['proposed_assignments']}
        self.assertIn(eligible_anier.id, assigned_ids)

    # ------------------------------------------------------------------
    # 3b. A non-Anir student can NEVER enter building 179.
    # ------------------------------------------------------------------

    def test_non_anier_student_never_enters_building_179(self):
        """An ordinary student — even one flagged priority — must never
        be assigned into building 179 when they are not the exclusive
        Anir group (missing הסמכה/אנייר)."""
        from allocation.solver import run_improved_ortools_allocation

        _, _, _, _, room = self._make_upper_office_building_179(
            'anier_region_b', 'Region B', 'עליון עמים B', beds=1,
        )
        ordinary_priority = Student.objects.create(
            student_id='ANIER_REJ1', first_name='T', last_name='S',
            gender=Student.Gender.FEMALE, housing_type=Student.HousingType.SINGLE_FEMALE,
            is_priority=True,
        )

        self._patch_close_old_connections()
        result = run_improved_ortools_allocation([ordinary_priority], [room], self.UPPER_OFFICE_CONFIG)

        assigned_ids = {item['student_db_id'] for item in result['proposed_assignments']}
        self.assertNotIn(ordinary_priority.id, assigned_ids)
        self.assertIn(ordinary_priority.id, result['students_with_no_feasible_beds'])

    # ------------------------------------------------------------------
    # 3c. Building 179 may remain partially empty.
    # ------------------------------------------------------------------

    def test_building_179_may_remain_partially_empty(self):
        """Building 179 has capacity for 3, but only 1 eligible Anir
        student exists. The other 2 beds must remain empty — an ordinary
        student must never be backfilled into them."""
        from allocation.solver import run_improved_ortools_allocation

        _, _, _, _, room = self._make_upper_office_building_179(
            'anier_region_c', 'Region C', 'עליון עמים C', beds=3,
        )
        eligible_anier = self._make_eligible_anier('ANIER_PARTIAL1')
        ordinary = Student.objects.create(
            student_id='ANIER_PARTIAL_ORD1', first_name='T', last_name='S',
            gender=Student.Gender.FEMALE, housing_type=Student.HousingType.SINGLE_FEMALE,
        )

        self._patch_close_old_connections()
        result = run_improved_ortools_allocation(
            [eligible_anier, ordinary], [room], self.UPPER_OFFICE_CONFIG,
        )

        assigned_ids = {item['student_db_id'] for item in result['proposed_assignments']}
        self.assertIn(eligible_anier.id, assigned_ids)
        self.assertNotIn(ordinary.id, assigned_ids)
        self.assertEqual(result['successful_assignments'], 1)

        diagnostics = result['anier_building_179_diagnostics']
        self.assertTrue(diagnostics['reserved_building_found'])
        self.assertEqual(diagnostics['reserved_building_available_beds'], 3)

    # ------------------------------------------------------------------
    # 3d. Exclusive Anir students are NOT assigned to another building.
    # ------------------------------------------------------------------

    def test_eligible_anier_student_not_assigned_to_another_building_when_179_full(self):
        """
        When building 179's only bed is already occupied by another
        exclusive-group member, a NEW eligible Anir student must remain
        UNASSIGNED rather than fall back to a separate, otherwise fully
        compatible ordinary building/apartment that is also available.

        Regression test for a real pre-existing bug: the exclusivity
        check previously evaluated "is this student exclusive" bundled
        together with "is THIS SPECIFIC candidate apartment the Upper
        Dorm Office" (allocation.solver._is_building_179_exclusive_student
        took an apartment/region argument and folded its own upper-office
        check into the same boolean). That meant an eligible Anir student
        was judged "not exclusive" the instant they were evaluated against
        an ordinary, non-upper-office apartment — incorrectly admitting
        them there. Fixed by _is_anier_exclusive_student, a purely
        student-level predicate independent of any apartment.
        """
        from allocation.solver import run_improved_ortools_allocation

        region, dorm_type_11, building_179, apartment_179, room_179 = self._make_upper_office_building_179(
            'anier_region_d', 'Region D', 'עליון עמים D', beds=1,
        )
        existing_occupant = self._make_eligible_anier('ANIER_EXIST1')
        existing_bed = room_179.beds.first()
        BedAssignment.objects.create(
            student=existing_occupant, bed=existing_bed,
            status=BedAssignment.Status.ACTIVE, assignment_type=BedAssignment.AssignmentType.MANUAL,
        )

        # A separate, otherwise-compatible ordinary building in the SAME
        # region (region-level matching would incorrectly treat this as
        # upper-office too, if the bug were still present).
        other_dorm_type = DormType.objects.create(name='OrdinaryDorm', region=region)
        other_building = Building.objects.create(number=50, dorm_type=other_dorm_type)
        other_apartment = Apartment.objects.create(
            building=other_building, number='1', category=Apartment.Category.FEMALE,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=1,
        )
        other_room = Room.objects.create(apartment=other_apartment, name='A', capacity=1)
        Bed.objects.create(room=other_room, label='1')

        new_eligible_anier = self._make_eligible_anier('ANIER_NOFALLBACK1')

        self._patch_close_old_connections()
        result = run_improved_ortools_allocation(
            [new_eligible_anier], [room_179, other_room], self.UPPER_OFFICE_CONFIG,
        )

        assigned_ids = {item['student_db_id'] for item in result['proposed_assignments']}
        self.assertNotIn(new_eligible_anier.id, assigned_ids)
        self.assertIn(new_eligible_anier.id, result['students_with_no_feasible_beds'])

    # ------------------------------------------------------------------
    # 3e. Anir status alone (missing another required condition) must
    #      NOT be treated as eligible.
    # ------------------------------------------------------------------

    def test_anier_without_hasmaha_is_not_treated_as_eligible(self):
        """A student flagged priority + אנייר but WITHOUT הסמכה must not
        be treated as an exclusive-group member — they must not enter
        building 179, and must be assigned normally elsewhere."""
        from allocation.solver import run_improved_ortools_allocation

        _, _, _, _, room_179 = self._make_upper_office_building_179(
            'anier_region_e', 'Region E', 'עליון עמים E', beds=1,
        )
        no_hasmaha = Student.objects.create(
            student_id='ANIER_NOHASMAHA1', first_name='T', last_name='S',
            gender=Student.Gender.FEMALE, housing_type=Student.HousingType.SINGLE_FEMALE,
            is_priority=True, special_status_1='אנייר',
        )

        other_dorm_type = DormType.objects.create(name='OrdinaryDormE')
        other_building = Building.objects.create(number=51, dorm_type=other_dorm_type)
        other_apartment = Apartment.objects.create(
            building=other_building, number='1', category=Apartment.Category.FEMALE,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=1,
        )
        other_room = Room.objects.create(apartment=other_apartment, name='A', capacity=1)
        Bed.objects.create(room=other_room, label='1')

        self._patch_close_old_connections()
        result = run_improved_ortools_allocation(
            [no_hasmaha], [room_179, other_room], self.UPPER_OFFICE_CONFIG,
        )

        assigned_ids = {item['student_db_id'] for item in result['proposed_assignments']}
        self.assertIn(no_hasmaha.id, assigned_ids)
        assigned_building_id = self._resolve_assignment_location(
            next(a for a in result['proposed_assignments'] if a['student_db_id'] == no_hasmaha.id)
        )[0].building_id
        self.assertEqual(assigned_building_id, other_building.id)

    def test_anier_without_priority_is_not_treated_as_eligible(self):
        """A student with הסמכה + אנייר but is_priority=False must not be
        treated as an exclusive-group member either — is_priority is one
        of the four required conditions, not optional."""
        from allocation.solver import run_improved_ortools_allocation

        _, _, _, _, room_179 = self._make_upper_office_building_179(
            'anier_region_f', 'Region F', 'עליון עמים F', beds=1,
        )
        no_priority = Student.objects.create(
            student_id='ANIER_NOPRIORITY1', first_name='T', last_name='S',
            gender=Student.Gender.FEMALE, housing_type=Student.HousingType.SINGLE_FEMALE,
            is_priority=False, special_status_1='הסמכה', special_status_2='אנייר',
        )

        other_dorm_type = DormType.objects.create(name='OrdinaryDormF')
        other_building = Building.objects.create(number=52, dorm_type=other_dorm_type)
        other_apartment = Apartment.objects.create(
            building=other_building, number='1', category=Apartment.Category.FEMALE,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=1,
        )
        other_room = Room.objects.create(apartment=other_apartment, name='A', capacity=1)
        Bed.objects.create(room=other_room, label='1')

        self._patch_close_old_connections()
        result = run_improved_ortools_allocation(
            [no_priority], [room_179, other_room], self.UPPER_OFFICE_CONFIG,
        )

        assigned_ids = {item['student_db_id'] for item in result['proposed_assignments']}
        self.assertIn(no_priority.id, assigned_ids)
        assigned_building_id = self._resolve_assignment_location(
            next(a for a in result['proposed_assignments'] if a['student_db_id'] == no_priority.id)
        )[0].building_id
        self.assertEqual(assigned_building_id, other_building.id)

    def _resolve_assignment_location(self, assignment):
        bed = Bed.objects.select_related(
            'room', 'room__apartment', 'room__apartment__building',
        ).get(id=assignment['bed_id'])
        return bed.room.apartment, bed.room, bed

    # ------------------------------------------------------------------
    # 4. Diagnostics: surfaced on every solver run.
    # ------------------------------------------------------------------

    def test_anier_building_179_diagnostics(self):
        """run_improved_ortools_allocation must report accurate Anir/
        building-179 diagnostics: counts of imported/eligible Anir
        students, whether the reserved building was found, its available
        beds, and how many eligible students actually got a candidate
        connecting them to it."""
        from allocation.solver import run_improved_ortools_allocation

        generic_region = Region.objects.create(id='generic_region_2', name='Region Two')
        dorm_type_11 = DormType.objects.create(name='עליון עמים 2', code=11, region=generic_region)
        building_179 = Building.objects.create(number=179, dorm_type=dorm_type_11)
        apartment = Apartment.objects.create(
            building=building_179, number='1', category=Apartment.Category.FEMALE,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=1,
        )
        room = Room.objects.create(apartment=apartment, name='A', capacity=3)
        for label in ('1', '2', '3'):
            Bed.objects.create(room=room, label=label)

        eligible_anier = Student.objects.create(
            student_id='DIAG_ANIER1', first_name='T', last_name='S',
            gender=Student.Gender.FEMALE, housing_type=Student.HousingType.SINGLE_FEMALE,
            is_priority=True, special_status_1='הסמכה', special_status_2='אנייר',
        )
        imported_but_not_eligible = Student.objects.create(
            student_id='DIAG_ANIER2', first_name='T', last_name='S',
            gender=Student.Gender.FEMALE, housing_type=Student.HousingType.SINGLE_FEMALE,
            is_priority=False, special_status_1='אנייר',
        )

        patcher = patch('allocation.solver.close_old_connections')
        patcher.start()
        self.addCleanup(patcher.stop)

        config = {
            'sameGender': {'enabled': True, 'strict': True, 'critical': True, 'weight': 0},
            'priorityFirst': {'enabled': True, 'strict': True, 'critical': True, 'weight': 0},
            'roommatePositiveOnly': {'enabled': True, 'strict': True, 'critical': True, 'weight': 0},
            'ReligiousTogether': {'enabled': False},
        }
        result = run_improved_ortools_allocation(
            [eligible_anier, imported_but_not_eligible], [room], config,
        )

        diagnostics = result['anier_building_179_diagnostics']
        self.assertEqual(diagnostics['imported_anier_students'], 2)
        self.assertEqual(diagnostics['eligible_anier_students'], 1)
        self.assertTrue(diagnostics['reserved_building_found'])
        self.assertEqual(diagnostics['reserved_building_available_beds'], 3)
        self.assertEqual(diagnostics['eligible_anier_students_sent_to_solver'], 1)

    def test_anier_building_179_diagnostics_when_building_missing(self):
        """When no building 179 / Upper Dorm Office apartment exists in
        this run's inventory, diagnostics must report
        reserved_building_found=False and available beds=0, even though
        eligible Anir students are present — surfacing the exact symptom
        of the original bug."""
        from allocation.solver import run_improved_ortools_allocation

        ordinary_region = Region.objects.create(id='ordinary_region_1', name='Ordinary Region')
        ordinary_dorm = DormType.objects.create(name='OrdinaryDorm', region=ordinary_region)
        ordinary_building = Building.objects.create(number=42, dorm_type=ordinary_dorm)
        apartment = Apartment.objects.create(
            building=ordinary_building, number='1', category=Apartment.Category.FEMALE,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=1,
        )
        room = Room.objects.create(apartment=apartment, name='A', capacity=1)
        Bed.objects.create(room=room, label='1')

        eligible_anier = Student.objects.create(
            student_id='DIAG_ANIER3', first_name='T', last_name='S',
            gender=Student.Gender.FEMALE, housing_type=Student.HousingType.SINGLE_FEMALE,
            is_priority=True, special_status_1='הסמכה', special_status_2='אנייר',
        )

        patcher = patch('allocation.solver.close_old_connections')
        patcher.start()
        self.addCleanup(patcher.stop)

        config = {
            'sameGender': {'enabled': True, 'strict': True, 'critical': True, 'weight': 0},
            'priorityFirst': {'enabled': True, 'strict': True, 'critical': True, 'weight': 0},
            'roommatePositiveOnly': {'enabled': True, 'strict': True, 'critical': True, 'weight': 0},
            'ReligiousTogether': {'enabled': False},
        }
        result = run_improved_ortools_allocation([eligible_anier], [room], config)

        diagnostics = result['anier_building_179_diagnostics']
        self.assertEqual(diagnostics['imported_anier_students'], 1)
        self.assertEqual(diagnostics['eligible_anier_students'], 1)
        self.assertFalse(diagnostics['reserved_building_found'])
        self.assertEqual(diagnostics['reserved_building_available_beds'], 0)
        self.assertEqual(diagnostics['eligible_anier_students_sent_to_solver'], 0)


# ---------------------------------------------------------------------------
# End-to-end proof that /api/upload/additions-excel/ shares the identical
# accessibility + אנייר mapping as /api/upload/excel/ (both call
# build_student_payload_from_row).
# ---------------------------------------------------------------------------
class AdditionsUploadSharedMappingTest(TestCase):
    """
    /api/upload/excel/ and /api/upload/additions-excel/ both route every
    row through api.views.build_student_payload_from_row — one shared
    mapping, per the requirement that both upload flows use the same
    logic. This test exercises the additions endpoint specifically (a
    real .xlsx upload, not a hand-built pandas Series) and verifies, from
    the saved Student record, that:
      - accessibility fields (accessibility_flag/disability_percent/
        medical_reason) are saved correctly;
      - the 9108-אנייר='X' column creates the canonical 'אנייר'
        special-status value;
      - a pre-existing special status (special_status_1='הסמכה') is
        preserved alongside the injected 'אנייר' marker;
      - is_priority and priority_reason are derived correctly from the
        combined special statuses.
    """

    def test_upload_additions_excel_saves_accessibility_and_anier_correctly(self):
        import io
        from decimal import Decimal

        import pandas as pd
        from django.core.files.uploadedfile import SimpleUploadedFile

        region = Region.objects.create(id='additions_region', name='Additions Region')
        dorm_type = DormType.objects.create(name='AdditionsDorm', code=77, region=region)
        Building.objects.create(number=200, dorm_type=dorm_type, is_active=True)

        admin = _make_central_admin()
        client = APIClient()
        client.force_authenticate(user=admin)

        buffer = io.BytesIO()
        pd.DataFrame([{
            'ת"ז ישראלית': 'ADD_ANIER1',
            'שם פרטי': 'Test',
            'שם משפחה': 'Additions',
            'תיאור סוג מגורים': 'רווקות',
            'החלטה-החלטת מעונות - תאור': 'החלטה חיובית',
            'החלטה-תוכן החלטה – מעונות': '77',
            'תאור סטטוס מיוחד1': 'הסמכה',
            '9108-אנייר': 'X',
            'החלטה-זקוק להנגשה': 'כן',
            '%נכות': '30',
            'סיבה רפואית מאושרת מרופאת הטכניון': 'מצב רפואי מאושר',
        }]).to_excel(buffer, index=False, sheet_name='תוספות')
        buffer.seek(0)

        upload_file = SimpleUploadedFile(
            'additions.xlsx', buffer.read(),
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        response = client.post('/api/upload/additions-excel/', {'file': upload_file}, format='multipart')
        self.assertEqual(response.status_code, 200, response.data)

        student = Student.objects.get(student_id='ADD_ANIER1')

        # Accessibility fields saved correctly.
        self.assertTrue(student.accessibility_flag)
        self.assertEqual(student.disability_percent, Decimal('30'))
        self.assertEqual(student.medical_reason, 'מצב רפואי מאושר')

        # 9108-אנייר='X' created the canonical 'אנייר' status, and the
        # pre-existing 'הסמכה' status was preserved (not overwritten).
        statuses = [
            student.special_status_1, student.special_status_2,
            student.special_status_3, student.special_status_4,
        ]
        self.assertIn('הסמכה', statuses)
        self.assertIn('אנייר', statuses)

        # is_priority/priority_reason derived correctly from the combined
        # special statuses (never from the accessibility columns).
        self.assertTrue(student.is_priority)
        self.assertEqual(student.priority_reason, 'הסמכה | אנייר')

