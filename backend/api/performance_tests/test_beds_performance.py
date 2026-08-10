"""
Beds list endpoint (GET /api/beds/) performance regression tests.

History:
- BLD-04 baseline measurement (code unchanged): this module captured the
  N+1 pattern in BedSerializer.is_occupied / Bed.is_occupied - query count
  scaled as `1 + 1*N` with bed count N. That evidence is frozen at
  project-quality/performance/evidence/BEDS_BASELINE_QUERY_COUNTS.txt and
  project-quality/performance/evidence/BEDS_BASELINE_TEST_RUN_LOG.txt and
  is NOT reproduced or overwritten by this module going forward - see
  project-quality/performance/BEDS_BASELINE_SUMMARY.md for the full
  baseline write-up.
- BLD-04 fix (this version, current code): BedViewSet.get_queryset() now
  annotates is_occupied via an Exists(...) correlated subquery
  (views._annotate_bed_occupancy) instead of BedSerializer/Bed.is_occupied
  running 1 extra query per bed row. This module now asserts the query
  count stays FLAT as bed count grows, and writes CURRENT evidence to
  project-quality/performance/evidence/BEDS_AFTER_QUERY_COUNTS.txt (a
  distinct file from the frozen baseline above).

Methodology and structure mirror the BLD-01/02/03 fixes exactly - see
backend/api/performance_tests/test_buildings_performance.py,
test_apartments_performance.py, test_rooms_performance.py, and
project-quality/performance/*_OPTIMIZATION_SUMMARY.md - down to using
django.test.utils.CaptureQueriesContext, the "query shape" duplicate-
detection technique, and the annotation-fallback correctness-cross-check
pattern. Self-contained (does not import from the other performance_tests
modules), per api/performance_tests/__init__.py's stated convention.

MEASUREMENT + REGRESSION TEST. The correctness tests in this module
(`BedOccupancyCorrectnessTests`) are the primary safety net for the
optimization: they prove is_occupied returns byte-for-byte the same value
as the original Bed.is_occupied property, across occupied/unoccupied beds
and ACTIVE vs. ENDED assignments - a faster query that returns wrong
values is not an acceptable outcome.

Run against Django's disposable TEST database (created/destroyed as
test_<DB_NAME> - never touches the real database), via a local-only
.env.test:

    cd backend
    ENV_FILE=.env.test python manage.py test api.performance_tests.test_beds_performance -v 2

Lives in api/performance_tests/ - the dedicated home for performance /
query-efficiency regression tests (see performance_tests/__init__.py);
business-logic/permission tests for beds stay in api/tests_inventory.py.
"""

import re
import time
from collections import Counter
from pathlib import Path

from django.conf import settings
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import (
    User, Region, DormType, Building, Apartment, Room, Bed,
    Student, BedAssignment,
)
from api.serializers import BedSerializer

EVIDENCE_DIR = Path(settings.BASE_DIR).parent / 'project-quality' / 'performance' / 'evidence'
# Deliberately a DIFFERENT file from the frozen BLD-04 baseline evidence
# (BEDS_BASELINE_QUERY_COUNTS.txt) - this module now measures the
# optimized (post-fix) code and must never overwrite the historical
# baseline record.
EVIDENCE_FILE = EVIDENCE_DIR / 'BEDS_AFTER_QUERY_COUNTS.txt'

_NUMBER_RE = re.compile(r'\d+')


def _shape(sql):
    return _NUMBER_RE.sub('#', sql)


def _summarize(captured_queries):
    shapes = Counter(_shape(q['sql']) for q in captured_queries)
    repeated = {shape: n for shape, n in shapes.items() if n > 1}
    return {
        'total': len(captured_queries),
        'distinct_shapes': len(shapes),
        'repeated_shapes': repeated,
    }


def _make_user(email, role, region=None):
    user = User(email=email, username=email, role=role, region=region,
                first_name='T', last_name='User')
    user.set_password('testpass123')
    user.save()
    return user


def _reset_inventory():
    BedAssignment.objects.all().delete()
    Student.objects.all().delete()
    Building.objects.all().delete()


def _build_beds(dorm_type, n_beds, admin, occupied_count=None, start_number=1):
    """
    Creates one Building -> one active Apartment -> one active Room
    (capacity=n_beds, purely so the room record itself is internally
    consistent - not meant to represent a realistic room size, see the
    original module docstring/BEDS_BASELINE_SUMMARY.md) -> n_beds Beds.
    Half (rounded down) of the beds get an ACTIVE BedAssignment by
    default, so is_occupied is genuinely exercised both ways.
    """
    if occupied_count is None:
        occupied_count = n_beds // 2

    building = Building.objects.create(number=1, dorm_type=dorm_type)
    apartment = Apartment.objects.create(
        building=building, number='1', category=Apartment.Category.MIXED,
        apartment_type=Apartment.ApartmentType.SINGLE, room_count=1,
    )
    room = Room.objects.create(apartment=apartment, name='1', capacity=n_beds)

    beds = [
        Bed.objects.create(room=room, label=f'Bed {i + 1}')
        for i in range(n_beds)
    ]
    for i in range(occupied_count):
        student = Student.objects.create(
            student_id=f'BPERF{start_number}-{i + 1}',
            first_name='F', last_name='L', gender='male',
            housing_type=Student.HousingType.SINGLE_MALE,
            accepted_dorm_type=dorm_type, category='new',
        )
        BedAssignment.objects.create(
            student=student, bed=beds[i],
            status=BedAssignment.Status.ACTIVE, assigned_by=admin,
        )
    return room, occupied_count


class BedsListPerformanceTests(TestCase):
    """
    Post-optimization performance regression test for GET /api/beds/.

    BLD-04 fix: BedViewSet.get_queryset() now annotates is_occupied via an
    Exists(...) correlated subquery instead of BedSerializer/
    Bed.is_occupied running one query per bed row. These tests assert
    query count stays FLAT (independent of N) - the inverse of the
    original baseline assertions, which proved the OLD code scaled
    linearly. If this test ever starts failing because query count scales
    with N again, the N+1 regressed and BLD-04 needs to be re-fixed.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._evidence_lines = [
            'Beds API (GET /api/beds/) — POST-OPTIMIZATION query-count evidence',
            'Generated by backend/api/performance_tests/test_beds_performance.py',
            'BLD-04 fix evidence (after the BedSerializer.is_occupied N+1 fix).',
            'Compare against the frozen baseline in BEDS_BASELINE_QUERY_COUNTS.txt '
            '(total_queries = 1 + 1*N there).',
            '',
        ]

    @classmethod
    def tearDownClass(cls):
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        with open(EVIDENCE_FILE, 'w', encoding='utf-8') as f:
            f.write('\n'.join(cls._evidence_lines) + '\n')
        super().tearDownClass()

    def setUp(self):
        self.region = Region.objects.create(id='bperf-region', name='Beds Perf Region')
        self.dorm_type = DormType.objects.create(code=931, name='BedPerfDormType', region=self.region)
        self.admin = _make_user('bperf-admin@test.com', User.Role.CENTRAL_ADMIN)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _measure(self, n_beds, label):
        _reset_inventory()
        room, occupied_count = _build_beds(self.dorm_type, n_beds, admin=self.admin)

        with CaptureQueriesContext(connection) as ctx:
            start = time.perf_counter()
            resp = self.client.get('/api/beds/', {'room': room.id})
            elapsed_ms = (time.perf_counter() - start) * 1000

        self.assertEqual(resp.status_code, 200)
        rows = resp.data if isinstance(resp.data, list) else resp.data.get('results', [])
        self.assertEqual(len(rows), n_beds)

        occupied_returned = sum(1 for r in rows if r['is_occupied'])
        self.assertEqual(occupied_returned, occupied_count)

        summary = _summarize(ctx.captured_queries)
        payload_bytes = len(resp.content)

        lines = [
            f'--- {label}: n_beds={n_beds} (occupied={occupied_count}) ---',
            f'endpoint: GET /api/beds/?room={room.id}',
            f'user role: central_admin',
            f'beds_returned: {len(rows)}',
            f'total_sql_queries: {summary["total"]}',
            f'distinct_query_shapes: {summary["distinct_shapes"]}',
            f'server_side_request_time_ms: {elapsed_ms:.2f}',
            f'response_payload_bytes: {payload_bytes}',
            'repeated_query_shapes (occurrence_count x shape, numbers masked as #):',
        ]
        for shape, count in sorted(summary['repeated_shapes'].items(), key=lambda kv: -kv[1]):
            lines.append(f'  x{count}: {shape[:220]}')
        lines.append('')
        type(self)._evidence_lines.extend(lines)
        print('\n'.join(lines))

        return summary['total'], elapsed_ms, payload_bytes

    def test_beds_list_query_count_is_flat_after_optimization(self):
        """
        Core regression check: GET /api/beds/ must issue essentially the
        same number of SQL queries at N=10 as at N=50 - i.e. query count no
        longer scales with the number of beds returned. Before the BLD-04
        fix this test (as test_beds_list_query_count_scaling) measured a
        marginal cost of 1.00 queries/bed; it must now be ~0.
        """
        small_n = 10
        large_n = 50

        queries_small, ms_small, bytes_small = self._measure(small_n, 'SMALL DATASET (N=10, post-optimization)')
        queries_large, ms_large, bytes_large = self._measure(large_n, 'LARGE DATASET (N=50, post-optimization)')

        per_bed_small = queries_small / small_n
        per_bed_large = queries_large / large_n
        marginal_per_bed = (queries_large - queries_small) / (large_n - small_n)

        summary_lines = [
            '--- SCALING SUMMARY (post-optimization) ---',
            f'small: n={small_n} total_queries={queries_small} '
            f'queries/bed={per_bed_small:.2f} time_ms={ms_small:.2f} bytes={bytes_small}',
            f'large: n={large_n} total_queries={queries_large} '
            f'queries/bed={per_bed_large:.2f} time_ms={ms_large:.2f} bytes={bytes_large}',
            f'marginal_queries_per_additional_bed: {marginal_per_bed:.2f}',
            'BLD-04 baseline marginal cost (pre-fix): 1.00 queries/bed',
            '',
        ]
        type(self)._evidence_lines.extend(summary_lines)
        print('\n'.join(summary_lines))

        self.assertLessEqual(marginal_per_bed, 0.1)
        self.assertLess(queries_large, 15)

    def test_beds_list_single_bed_baseline_overhead(self):
        """
        Secondary measurement: the N=1 case isolates the fixed per-request
        overhead (auth, permission checks, the single annotated list
        query) from the per-row multiplier measured above.
        """
        queries_one, ms_one, bytes_one = self._measure(1, 'SINGLE BED (N=1, post-optimization)')
        self.assertGreaterEqual(queries_one, 1)


class BedOccupancyCorrectnessTests(TestCase):
    """
    Correctness protection for the optimized is_occupied computation
    (views._annotate_bed_occupancy + BedSerializer).

    Builds three beds under one room:
    - occupied: one ACTIVE BedAssignment -> is_occupied should be True.
    - free: no assignment at all -> is_occupied should be False.
    - previously_occupied: one assignment that has since transitioned to
      ENDED -> is_occupied should be False (an ENDED assignment must NOT
      count as occupied).
    """

    def setUp(self):
        self.region = Region.objects.create(id='bperf-correctness-region', name='Bed Perf Correctness Region')
        self.dorm_type = DormType.objects.create(code=932, name='BedPerfCorrectnessDormType', region=self.region)
        self.admin = _make_user('bperf-correctness-admin@test.com', User.Role.CENTRAL_ADMIN)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

        self.building = Building.objects.create(number=500, dorm_type=self.dorm_type)
        self.apartment = Apartment.objects.create(
            building=self.building, number='A1', category=Apartment.Category.MIXED,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=1, is_active=True,
        )
        self.room = Room.objects.create(apartment=self.apartment, name='R1', capacity=3, is_active=True)

        self.bed_occupied = Bed.objects.create(room=self.room, label='B1')
        self.bed_free = Bed.objects.create(room=self.room, label='B2')
        self.bed_previously_occupied = Bed.objects.create(room=self.room, label='B3')

        def _student(sid):
            return Student.objects.create(
                student_id=sid, first_name='F', last_name='L', gender='male',
                housing_type=Student.HousingType.SINGLE_MALE,
                accepted_dorm_type=self.dorm_type, category='new',
            )

        BedAssignment.objects.create(
            student=_student('BCORR-1'), bed=self.bed_occupied,
            status=BedAssignment.Status.ACTIVE, assigned_by=self.admin,
        )
        ended = BedAssignment.objects.create(
            student=_student('BCORR-2'), bed=self.bed_previously_occupied,
            status=BedAssignment.Status.ACTIVE, assigned_by=self.admin,
        )
        ended.status = BedAssignment.Status.ENDED
        ended.ended_at = timezone.now()
        ended.save(update_fields=['status', 'ended_at'])
        # bed_free deliberately gets no BedAssignment at all.

    def _get_rows(self):
        resp = self.client.get('/api/beds/', {'room': self.room.id})
        self.assertEqual(resp.status_code, 200)
        rows = resp.data if isinstance(resp.data, list) else resp.data.get('results', [])
        return {r['label']: r for r in rows}

    def test_is_occupied_matches_expected_values(self):
        """
        Hand-computed expected values:
        - B1 (ACTIVE assignment): is_occupied = True.
        - B2 (no assignment): is_occupied = False.
        - B3 (ENDED assignment): is_occupied = False.
        """
        rows = self._get_rows()
        self.assertTrue(rows['B1']['is_occupied'])
        self.assertFalse(rows['B2']['is_occupied'])
        self.assertFalse(rows['B3']['is_occupied'])

    def test_is_occupied_matches_original_unannotated_property(self):
        """
        Ground-truth cross-check: recompute is_occupied with the exact
        original (pre-optimization) Bed.is_occupied property directly
        against the DB, and assert the live endpoint (now backed by an
        Exists(...) annotation) produces byte-for-byte identical values
        for all three beds.
        """
        rows = self._get_rows()
        for bed, label in (
            (self.bed_occupied, 'B1'),
            (self.bed_free, 'B2'),
            (self.bed_previously_occupied, 'B3'),
        ):
            original_is_occupied = bed.is_occupied
            self.assertEqual(rows[label]['is_occupied'], original_is_occupied, label)

    def test_unannotated_bed_falls_back_correctly(self):
        """
        BedViewSet only supports get/patch/head/options (no create), so
        there is no "freshly POSTed, unannotated instance" case to
        exercise through the API the way Buildings/Apartments/Rooms have.
        Instead, this directly serializes a Bed instance fetched WITHOUT
        going through the annotated get_queryset() (a plain
        Bed.objects.get(pk=...)), proving BedSerializer's fallback path
        (used whenever the _is_occupied annotation is absent from the
        instance) still returns the correct value.
        """
        plain_bed = Bed.objects.get(pk=self.bed_occupied.pk)
        self.assertFalse(hasattr(plain_bed, '_is_occupied'))
        data = BedSerializer(plain_bed).data
        self.assertTrue(data['is_occupied'])

        plain_free_bed = Bed.objects.get(pk=self.bed_free.pk)
        data_free = BedSerializer(plain_free_bed).data
        self.assertFalse(data_free['is_occupied'])
