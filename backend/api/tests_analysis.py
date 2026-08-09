"""
Tests for the /api/analysis/ endpoint, focused on the fields added for the
unified analytics page (pending_requests, priority_unassigned_students,
latest_batch) and on role/region scoping.

Run against Django's disposable TEST database (created and destroyed
automatically as test_<DB_NAME> on the same Postgres server - this never
touches the real `dormify` database or its data):

    docker exec dormify_backend python manage.py test api.tests_analysis
"""

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework import status

from api.models import (
    User, Region, DormType, Building, Apartment, Room, Bed, BedAssignment,
    Student, ImportBatch, RegionInbox, StudentRequest, AllocationRun,
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


class AnalysisRegionalBreakdownTests(TestCase):
    """
    students_by_region must split each region's total into assigned vs
    waiting, using the same active-BedAssignment set as the top-level
    summary counters - added for the redesigned Analysis dashboard's
    capacity-vs-demand and allocation-status-by-region views.
    """

    def setUp(self):
        self.region = Region.objects.create(id='canada', name='Canada')
        self.dorm_type = _make_dorm_type(self.region, code=1)
        self.building, self.apartment, self.room = _make_room(
            self.dorm_type, 1, '1', Apartment.Category.MALE, room_capacity=2
        )
        self.bed = Bed.objects.create(room=self.room, label='A')

        self.assigned_student = _make_student(
            'S1', Student.Gender.MALE, Student.HousingType.SINGLE_MALE, self.dorm_type,
        )
        self.waiting_student = _make_student(
            'S2', Student.Gender.MALE, Student.HousingType.SINGLE_MALE, self.dorm_type,
        )
        BedAssignment.objects.create(
            student=self.assigned_student, bed=self.bed, status=BedAssignment.Status.ACTIVE,
        )

        self.admin = _make_user('admin@test.com', User.Role.CENTRAL_ADMIN)
        self.client = APIClient()

    def test_region_entry_splits_assigned_and_waiting(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get('/api/analysis/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        data = resp.json()

        entry = next(r for r in data['students_by_region'] if r['region'] == 'Canada')
        self.assertEqual(entry['count'], 2)
        self.assertEqual(entry['assigned'], 1)
        self.assertEqual(entry['waiting'], 1)
        # Backward compatibility: pre-existing consumers reading only
        # `count` still see the same total as before this change.
        self.assertEqual(entry['count'], entry['assigned'] + entry['waiting'])


class AnalysisSpecialRequestsBreakdownTests(TestCase):
    """
    requests_by_type / requests_by_region / oldest_pending_request_created_at,
    all scoped to PENDING only and derived from the same region-scoped
    queryset backing `pending_requests`.
    """

    def setUp(self):
        self.region_a = Region.objects.create(id='canada', name='Canada')
        self.region_b = Region.objects.create(id='mizrah', name='Mizrah')
        self.dorm_a = _make_dorm_type(self.region_a, code=1)

        self.admin = _make_user('admin@test.com', User.Role.CENTRAL_ADMIN)
        self.boss_a = _make_user('bossa@test.com', User.Role.REGION_BOSS, self.region_a)
        self.boss_b = _make_user('bossb@test.com', User.Role.REGION_BOSS, self.region_b)

        self.student = _make_student(
            'S1', Student.Gender.MALE, Student.HousingType.SINGLE_MALE, self.dorm_a,
        )

        self.client = APIClient()

    def test_room_request_attributed_via_source_region(self):
        # source_region is the priority-1 signal - populated the way the
        # real ROOM/APARTMENT creation flow populates it.
        StudentRequest.objects.create(
            request_type=StudentRequest.RequestType.ROOM,
            student=self.student,
            requested_by=self.boss_a,
            source_region=self.region_a,
        )
        self.client.force_authenticate(self.admin)
        resp = self.client.get('/api/analysis/')
        data = resp.json()

        self.assertEqual(data['requests_by_type'], [{'request_type': 'room', 'count': 1}])
        self.assertEqual(data['requests_by_region'], [{'region': 'Canada', 'count': 1}])

    def test_request_without_source_region_falls_back_to_student_region(self):
        # 'other' requests never populate source_region - must fall back to
        # the student's own accepted-dorm region, not the filer's region.
        StudentRequest.objects.create(
            request_type=StudentRequest.RequestType.OTHER,
            reason='General question',
            student=self.student,
            requested_by=self.boss_b,
        )
        self.client.force_authenticate(self.admin)
        resp = self.client.get('/api/analysis/')
        data = resp.json()

        self.assertEqual(data['requests_by_region'], [{'region': 'Canada', 'count': 1}])

    def test_request_without_student_falls_back_to_requester_region(self):
        # add_student requests have no existing Student row - last resort
        # is the filing staff member's own region.
        StudentRequest.objects.create(
            request_type=StudentRequest.RequestType.ADD_STUDENT,
            requested_by=self.boss_b,
            student_data={'student_id': 'NEW1', 'first_name': 'F', 'last_name': 'L', 'gender': 'male'},
        )
        self.client.force_authenticate(self.admin)
        resp = self.client.get('/api/analysis/')
        data = resp.json()

        self.assertEqual(data['requests_by_region'], [{'region': 'Mizrah', 'count': 1}])

    def test_resolved_requests_excluded_from_breakdown_and_oldest_pending(self):
        approved = StudentRequest.objects.create(
            request_type=StudentRequest.RequestType.OTHER,
            reason='Old, already resolved',
            student=self.student,
            requested_by=self.boss_a,
        )
        approved.status = StudentRequest.Status.APPROVED
        approved.reviewed_at = approved.created_at
        approved.save()

        pending = StudentRequest.objects.create(
            request_type=StudentRequest.RequestType.OTHER,
            reason='Still open',
            student=self.student,
            requested_by=self.boss_a,
        )

        self.client.force_authenticate(self.admin)
        resp = self.client.get('/api/analysis/')
        data = resp.json()

        self.assertEqual(data['requests_by_type'], [{'request_type': 'other', 'count': 1}])
        self.assertIsNotNone(data['oldest_pending_request_created_at'])
        # Only the still-pending request contributes - the resolved one
        # must not affect the oldest-pending timestamp.
        from django.utils.dateparse import parse_datetime
        oldest = parse_datetime(data['oldest_pending_request_created_at'])
        self.assertEqual(oldest, pending.created_at)

    def test_regional_user_never_sees_other_regions_requests(self):
        StudentRequest.objects.create(
            request_type=StudentRequest.RequestType.ROOM,
            student=self.student,
            requested_by=self.boss_a,
            source_region=self.region_a,
        )
        self.client.force_authenticate(self.boss_b)
        resp = self.client.get('/api/analysis/')
        data = resp.json()

        self.assertEqual(data['requests_by_type'], [])
        self.assertEqual(data['requests_by_region'], [])
        self.assertIsNone(data['oldest_pending_request_created_at'])

    def test_request_with_no_resolvable_region_is_skipped_but_still_counted(self):
        # No source_region, no student (so no accepted_dorm_type either),
        # and requested_by (a central admin) has no region of their own -
        # all three attribution tiers come up empty. The request must be
        # skipped from requests_by_region (never a fabricated "unknown"
        # bucket) while still counting toward pending_requests and
        # requests_by_type.
        StudentRequest.objects.create(
            request_type=StudentRequest.RequestType.OTHER,
            reason='No student, no region context at all',
            requested_by=self.admin,
        )
        self.client.force_authenticate(self.admin)
        resp = self.client.get('/api/analysis/')
        data = resp.json()

        self.assertEqual(data['summary']['pending_requests'], 1)
        self.assertEqual(data['requests_by_type'], [{'request_type': 'other', 'count': 1}])
        self.assertEqual(data['requests_by_region'], [])


class AnalysisRecentRunsScopingTests(TestCase):
    """recent_runs must respect the exact same region scope as latest_run."""

    def setUp(self):
        self.region_a = Region.objects.create(id='canada', name='Canada')
        self.region_b = Region.objects.create(id='mizrah', name='Mizrah')

        self.admin = _make_user('admin@test.com', User.Role.CENTRAL_ADMIN)
        self.boss_a = _make_user('bossa@test.com', User.Role.REGION_BOSS, self.region_a)

        for region in (self.region_a, self.region_b):
            AllocationRun.objects.create(
                region=region, status=AllocationRun.Status.COMPLETED,
                completed_at=timezone.now(),
            )

        self.client = APIClient()

    def test_regional_user_only_sees_own_region_runs(self):
        self.client.force_authenticate(self.boss_a)
        resp = self.client.get('/api/analysis/')
        data = resp.json()

        self.assertTrue(len(data['recent_runs']) >= 1)
        self.assertTrue(all(r['region'] == 'canada' for r in data['recent_runs']))

    def test_central_admin_sees_runs_across_regions(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get('/api/analysis/')
        data = resp.json()

        seen_regions = {r['region'] for r in data['recent_runs']}
        self.assertEqual(seen_regions, {'canada', 'mizrah'})

    def test_recent_runs_excludes_unnecessary_fields(self):
        # recent_runs is a hand-built minimal representation, not the full
        # AllocationRunSerializer - it must never carry the identity of the
        # staff member who ran the allocation, or free-text diagnostics.
        self.client.force_authenticate(self.admin)
        resp = self.client.get('/api/analysis/')
        data = resp.json()

        self.assertTrue(len(data['recent_runs']) >= 1)
        for run in data['recent_runs']:
            self.assertEqual(
                set(run.keys()),
                {'id', 'region', 'region_name', 'status', 'successful_assignments', 'started_at', 'completed_at'},
            )
            self.assertNotIn('run_by', run)
            self.assertNotIn('run_by_name', run)
            self.assertNotIn('error_message', run)

    def test_latest_run_keeps_full_serializer_shape(self):
        # Backward compatibility: latest_run must remain the full
        # AllocationRunSerializer, unaffected by the recent_runs trim.
        self.client.force_authenticate(self.admin)
        resp = self.client.get('/api/analysis/')
        data = resp.json()

        self.assertIsNotNone(data['latest_run'])
        self.assertIn('run_by_name', data['latest_run'])
        self.assertIn('status_display', data['latest_run'])
        self.assertIn('error_message', data['latest_run'])


class AnalysisAuthorizationMatrixTests(TestCase):
    """
    Explicit role x action coverage for the fields added to this endpoint:
    requests_by_type, requests_by_region, and recent_runs must all follow
    exactly the same region-isolation rules as the pre-existing summary
    fields (see AnalysisScopingTests) - a central admin may see everything
    or narrow via ?region=, a region_boss/employee may never see another
    region's data, and a query-param spoof attempt from a non-admin is
    always ignored server-side.
    """

    def setUp(self):
        self.region_a = Region.objects.create(id='canada', name='Canada')
        self.region_b = Region.objects.create(id='mizrah', name='Mizrah')
        self.dorm_a = _make_dorm_type(self.region_a, code=1)
        self.dorm_b = _make_dorm_type(self.region_b, code=2)

        self.admin = _make_user('admin@test.com', User.Role.CENTRAL_ADMIN)
        self.boss_a = _make_user('bossa@test.com', User.Role.REGION_BOSS, self.region_a)
        self.boss_b = _make_user('bossb@test.com', User.Role.REGION_BOSS, self.region_b)
        self.employee_a = _make_user('empa@test.com', User.Role.EMPLOYEE, self.region_a)

        self.student_a = _make_student(
            'A1', Student.Gender.MALE, Student.HousingType.SINGLE_MALE, self.dorm_a,
        )
        self.student_b = _make_student(
            'B1', Student.Gender.MALE, Student.HousingType.SINGLE_MALE, self.dorm_b,
        )

        StudentRequest.objects.create(
            request_type=StudentRequest.RequestType.ROOM,
            student=self.student_a, requested_by=self.boss_a, source_region=self.region_a,
        )
        StudentRequest.objects.create(
            request_type=StudentRequest.RequestType.ROOM,
            student=self.student_b, requested_by=self.boss_b, source_region=self.region_b,
        )

        AllocationRun.objects.create(
            region=self.region_a, status=AllocationRun.Status.COMPLETED, completed_at=timezone.now(),
        )
        AllocationRun.objects.create(
            region=self.region_b, status=AllocationRun.Status.COMPLETED, completed_at=timezone.now(),
        )

        self.client = APIClient()

    def test_central_admin_sees_all_regions_by_default(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get('/api/analysis/')
        data = resp.json()

        self.assertEqual(
            {r['region'] for r in data['requests_by_region']}, {'Canada', 'Mizrah'}
        )
        self.assertEqual(
            {r['region'] for r in data['recent_runs']}, {'canada', 'mizrah'}
        )

    def test_central_admin_can_scope_via_region_param(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get('/api/analysis/', {'region': 'mizrah'})
        data = resp.json()

        self.assertEqual(data['requests_by_region'], [{'region': 'Mizrah', 'count': 1}])
        self.assertEqual({r['region'] for r in data['recent_runs']}, {'mizrah'})

    def test_region_boss_cannot_access_other_region_via_query_param(self):
        self.client.force_authenticate(self.boss_a)
        resp = self.client.get('/api/analysis/', {'region': 'mizrah'})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        data = resp.json()

        self.assertEqual(data['requests_by_region'], [{'region': 'Canada', 'count': 1}])
        self.assertEqual({r['region'] for r in data['recent_runs']}, {'canada'})
        self.assertEqual(data['requests_by_type'], [{'request_type': 'room', 'count': 1}])

    def test_employee_cannot_access_other_region_via_query_param(self):
        self.client.force_authenticate(self.employee_a)
        resp = self.client.get('/api/analysis/', {'region': 'mizrah'})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        data = resp.json()

        self.assertEqual(data['requests_by_region'], [{'region': 'Canada', 'count': 1}])
        self.assertEqual({r['region'] for r in data['recent_runs']}, {'canada'})