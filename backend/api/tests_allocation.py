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
        """Priority student enters reserved apt; non-priority student cannot."""
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

class SolverCombinedFivePerApartmentTest(TestCase):
    """Capacity-5 apartments with several constraints active at once."""

    # Hard religion + soft grouping + priority (all soft rules enabled so the run
    # looks like a realistic production config, not a single-rule micro-test).
    HARD_RELIGION_PLUS_SOFT = {
        "ReligiousTogether": {"enabled": True, "strict": True, "critical": True},
        "sameReligion": {"enabled": True, "weight": 6},
        "sectorMatching": {"enabled": True, "weight": 7},
        "roommateMatch": {"enabled": True, "weight": 8},
        "avoidYearMix_1_with_3_4": {"enabled": True, "weight": 4},
        "avoidAtudaimWithHasmaha": {"enabled": True, "weight": 5},
        "priorityFirst": {"enabled": True},
        "roommatePositiveOnly": {"enabled": False},
    }

    def setUp(self):
        patcher = patch('allocation.solver.close_old_connections')
        patcher.start()
        self.addCleanup(patcher.stop)
        self.dorm = DormType.objects.create(name='TestDorm')
        self.building = Building.objects.create(number=1, dorm_type=self.dorm)

    # ------------------------------------------------------------------ infra
    def _apartment(self, number, reserved=False):
        return Apartment.objects.create(
            building=self.building,
            number=number,
            category=Apartment.Category.FEMALE,
            apartment_type=Apartment.ApartmentType.SINGLE,
            room_count=5,
            is_active=True,
            inactive_reason=(Apartment.InactiveReason.RESERVED if reserved else ''),
        )

    def _five_bed_apartments(self, count, reserved_first=False):
        """`count` apartments, each with 5 one-bed rooms (capacity 5)."""
        rooms = []
        for i in range(count):
            apt = self._apartment(number=str(i + 1),
                                  reserved=(reserved_first and i == 0))
            for j in range(5):
                room = Room.objects.create(apartment=apt, name=f'R{j + 1}', capacity=1)
                Bed.objects.create(room=room, label='Bed 1')
                rooms.append(room)
        return rooms

    def _student(self, sid, religion, religious, priority=False):
        return Student.objects.create(
            student_id=sid,
            first_name='T',
            last_name=sid,
            housing_type=Student.HousingType.SINGLE_FEMALE,
            requested_religion=religion,
            religious=religious,
            is_priority=priority,
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
            config or self.HARD_RELIGION_PLUS_SOFT,
        )

        assignments = result.get("proposed_assignments", [])
        assigned_ids = {item["student_db_id"] for item in assignments}
        by_apartment = defaultdict(list)
        for item in assignments:
            by_apartment[item["apartment_id"]].append(item)

        print("\n" + "=" * 110)
        print(f"STRONG TEST: {test_name}")
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
                for row in sorted(
                    by_apartment[apartment_id],
                    key=lambda x: (
                        str(x.get("room_name", "")),
                        str(x.get("bed_label", "")),
                        x["student_db_id"],
                    ),
                ):
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

    def _assert_religiously_homogeneous(self, result):
        """No apartment may mix a religious student with an incompatible one."""
        from allocation.solver import (
            _is_religious_jewish, _student_religious_state, _religion_key,
        )
        by_apt = defaultdict(list)
        for a in result['proposed_assignments']:
            by_apt[a['apartment_id']].append(Student.objects.get(id=a['student_db_id']))
        for apt_id, occupants in by_apt.items():
            has_rj = any(_is_religious_jewish(s) for s in occupants)
            if has_rj:
                self.assertTrue(
                    all(_is_religious_jewish(s) for s in occupants),
                    f"apt {apt_id}: Religious-Jewish mixed with non-RJ",
                )
            restricted = {
                st[1] for s in occupants
                if (st := _student_religious_state(s)) is not None and st[0] == 'religion'
            }
            for r in restricted:
                self.assertTrue(
                    all(_religion_key(s) == r for s in occupants),
                    f"apt {apt_id}: religious-{r} mixed with another religion",
                )

    # ---------------------------------------------------------------- tests
    def test_religion_packing_shortage_6_6_8_five_beds(self):
        """
        Case-22 analogue. 6 Religious Jewish + 6 Religious Muslim + 8 non-religious
        in four capacity-5 apartments. Religious Muslims can absorb non-religious
        Muslims, but the six Religious Jewish cannot all fit -> exactly one drops.
        Expected: 19 assigned, 1 conflict, every apartment religiously homogeneous.
        """
        rooms = self._five_bed_apartments(4)
        students = []
        for i in range(6):
            students.append(self._student(f'RJ{i}', Student.Religion.Jewish,
                                          Student.Religious.RELIGIOUS))
        for i in range(6):
            students.append(self._student(f'RM{i}', Student.Religion.Muslim,
                                          Student.Religious.RELIGIOUS))
        for i in range(8):
            rel = Student.Religion.Jewish if i % 2 else Student.Religion.Muslim
            students.append(self._student(f'NR{i}', rel,
                                          Student.Religious.NO_PREFERENCE))
        result = self._run(students, rooms)
        self.assertEqual(result['successful_assignments'], 19,
                         result['proposed_assignments'])
        self.assertEqual(result['conflicts'], 1)
        self._assert_religiously_homogeneous(result)

    def test_reserved_plus_priority_plus_religion_tradeoff(self):
        """
        Case-25 analogue. Apartment 1 is RESERVED (priority-only). Pool: 3 priority
        Religious Jewish, 3 non-priority Religious Jewish, 5 Religious Muslim,
        9 non-religious Muslim. The optimum seats the 3 priority students in the
        reserved apartment, fills the other three apartments with the 14 Muslims,
        and drops all three non-priority Religious Jewish students.
        Expected: 17 assigned, 3 conflicts, all 3 priority students placed.
        """
        rooms = self._five_bed_apartments(4, reserved_first=True)
        priority = [self._student(f'PRJ{i}', Student.Religion.Jewish,
                                  Student.Religious.RELIGIOUS, priority=True)
                    for i in range(3)]
        students = list(priority)
        for i in range(3):
            students.append(self._student(f'RJ{i}', Student.Religion.Jewish,
                                          Student.Religious.RELIGIOUS))
        for i in range(5):
            students.append(self._student(f'RM{i}', Student.Religion.Muslim,
                                          Student.Religious.RELIGIOUS))
        for i in range(9):
            students.append(self._student(f'NR{i}', Student.Religion.Muslim,
                                          Student.Religious.NO_PREFERENCE))
        result = self._run(students, rooms)
        self.assertEqual(result['successful_assignments'], 17,
                         result['proposed_assignments'])
        self.assertEqual(result['conflicts'], 3)
        assigned_ids = {a['student_db_id'] for a in result['proposed_assignments']}
        for p in priority:
            self.assertIn(p.id, assigned_ids,
                          "a priority student was left unassigned")
        self._assert_religiously_homogeneous(result)

    def test_all_non_religious_fill_every_bed_five_per_apartment(self):
        """
        Sanity: with hard religion ON but only non-religious students of mixed
        religions, there is no restriction, so all 20 beds fill (5 per apartment).
        Guards against a regression where non-religious students are over-restricted.
        """
        rooms = self._five_bed_apartments(4)
        students = []
        for i in range(20):
            rel = Student.Religion.Jewish if i % 2 else Student.Religion.Muslim
            students.append(self._student(f'N{i}', rel,
                                          Student.Religious.NO_PREFERENCE))
        result = self._run(students, rooms)
        self.assertEqual(result['successful_assignments'], 20,
                         result['proposed_assignments'])
        self.assertEqual(result['conflicts'], 0)
