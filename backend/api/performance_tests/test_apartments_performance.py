"""
Apartments list endpoint (GET /api/apartments/) performance regression
tests.

History:
- BLD-02 baseline measurement (code unchanged): this module captured the
  N+1 pattern in ApartmentSerializer - query count scaled as `1 + 5*N`
  with apartment count N. That baseline evidence is
  summarized in project-quality/performance/PERFORMANCE_FINAL_REPORT.md
  and is not reproduced or overwritten by this module going forward.
- BLD-02 fix (this version, current code): ApartmentViewSet.get_queryset()
  now annotates actual_room_count/bed_count/occupied_beds via correlated
  Subquery expressions (views._annotate_apartment_inventory_counts)
  instead of ApartmentSerializer running 5 extra queries per apartment
  row. This module now asserts the query count stays FLAT as apartment
  count grows, and writes CURRENT evidence to
  project-quality/performance/evidence/APARTMENTS_AFTER_QUERY_COUNTS.txt
  (a distinct file from the frozen baseline above).

Methodology and structure mirror the BLD-01 (Buildings) fix exactly - see
backend/api/performance_tests/test_buildings_performance.py and
project-quality/performance/PERFORMANCE_FINAL_REPORT.md - down to
using django.test.utils.CaptureQueriesContext, the "query shape" duplicate-
detection technique, and the annotation-fallback correctness-cross-check
pattern. This module is intentionally self-contained (does not import from
the Buildings performance test module), per
api/performance_tests/__init__.py's stated convention.

MEASUREMENT + REGRESSION TEST. The correctness tests in this module
(`ApartmentCountCorrectnessTests`) are the primary safety net for the
optimization: they prove actual_room_count/bed_count/occupied_beds/
free_beds return byte-for-byte the same values as the original per-row
query implementation, across active/inactive rooms and occupied/
unoccupied/ended-assignment beds, including the edge case where an
inactive room still has an ACTIVE assignment - a faster query that returns
wrong numbers is not an acceptable outcome.

Run against Django's disposable TEST database (created/destroyed as
test_<DB_NAME> - never touches the real database). This repo's real .env
points at the production Azure Postgres instance, so this measurement run
should be pointed at the local docker-compose `test_db` service instead,
via a local-only .env.test:

    cd backend
    ENV_FILE=.env.test python manage.py test api.performance_tests.test_apartments_performance -v 2

Lives in api/performance_tests/ - the dedicated home for performance /
query-efficiency regression tests (see performance_tests/__init__.py);
business-logic/permission tests for apartments stay in
api/tests/test_inventory.py.
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

EVIDENCE_DIR = Path(settings.BASE_DIR).parent / 'project-quality' / 'performance' / 'evidence'
# Deliberately a DIFFERENT file from the frozen BLD-02 baseline evidence
# (APARTMENTS_BASELINE_QUERY_COUNTS.txt) - this module now measures the
# optimized (post-fix) code and must never overwrite the historical
# baseline record.
EVIDENCE_FILE = EVIDENCE_DIR / 'APARTMENTS_AFTER_QUERY_COUNTS.txt'

_NUMBER_RE = re.compile(r'\d+')


def _shape(sql):
    """
    Collapse a captured SQL statement's literal numbers so structurally
    identical queries issued for different apartment/room/bed pks collapse
    into the same 'shape'. This lets us count how many times the *same
    kind* of query ran, rather than only counting distinct query strings
    (which would never collapse, since every apartment has a different
    pk).
    """
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
    """
    Clears out all building-hierarchy data created by a previous
    measurement so each _measure() call starts from a known, isolated
    state. Order matters: BedAssignment.bed and BedAssignment.student are
    both on_delete=PROTECT, so assignments (and the synthetic students they
    reference) must be removed before the Building/Apartment tree can be
    deleted; Room/Bed all cascade from Apartment/Building once that's
    clear. The Building itself is recreated fresh each call too, so
    Apartment.number (unique_together with building) never collides across
    measurements.
    """
    BedAssignment.objects.all().delete()
    Student.objects.all().delete()
    Building.objects.all().delete()


def _build_apartments(dorm_type, n_apartments, admin, rooms_per_apartment=3,
                       beds_per_room=2, start_apartment_number=1):
    """
    Creates one Building holding n_apartments apartments, each with
    rooms_per_apartment rooms, each with beds_per_room beds - genuinely
    exercising actual_room_count (3/apartment), bed_count (6/apartment),
    occupied_beds, and free_beds, not just counting empty rows. The first
    bed of the first room of every apartment gets an ACTIVE BedAssignment,
    so occupied_beds=1 and free_beds=5 for every apartment (non-trivial,
    uniform, easy to sanity-check).

    Returns the created Building (apartments are fetched via
    GET /api/apartments/?building=<id>, matching exactly how
    BuildingsPage.js's selectBuilding() calls
    dormInventoryAPI.getApartments({building, is_active: 'all'})).
    """
    building = Building.objects.create(number=1, dorm_type=dorm_type)
    student_seq = 0
    for a in range(n_apartments):
        apartment = Apartment.objects.create(
            building=building, number=str(start_apartment_number + a),
            category=Apartment.Category.MIXED,
            apartment_type=Apartment.ApartmentType.SINGLE,
            room_count=rooms_per_apartment,
        )
        first_bed = None
        for r in range(rooms_per_apartment):
            room = Room.objects.create(
                apartment=apartment, name=str(r + 1), capacity=beds_per_room,
            )
            beds = [
                Bed.objects.create(room=room, label=f'Bed {i + 1}')
                for i in range(beds_per_room)
            ]
            if r == 0:
                first_bed = beds[0]
        student_seq += 1
        student = Student.objects.create(
            student_id=f'APERF{start_apartment_number}-{student_seq}',
            first_name='F', last_name='L', gender='male',
            housing_type=Student.HousingType.SINGLE_MALE,
            accepted_dorm_type=dorm_type, category='new',
        )
        BedAssignment.objects.create(
            student=student, bed=first_bed,
            status=BedAssignment.Status.ACTIVE, assigned_by=admin,
        )
    return building


class ApartmentsListPerformanceTests(TestCase):
    """
    Post-optimization performance regression test for GET /api/apartments/.

    BLD-02 fix: ApartmentViewSet.get_queryset() now annotates the three
    counts via correlated subqueries instead of ApartmentSerializer running
    one query per count per apartment row. These tests assert query count
    stays FLAT (independent of N) - the inverse of the original baseline
    assertions, which proved the OLD code scaled linearly. If this test
    ever starts failing because query count scales with N again, the N+1
    regressed and BLD-02 needs to be re-fixed.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._evidence_lines = [
            'Apartments API (GET /api/apartments/) — POST-OPTIMIZATION query-count evidence',
            'Generated by backend/api/performance_tests/test_apartments_performance.py',
            'BLD-02 fix evidence (after the ApartmentSerializer N+1 fix).',
            'Compare against the frozen baseline in APARTMENTS_BASELINE_QUERY_COUNTS.txt '
            '(total_queries = 1 + 5*N there).',
            '',
        ]

    @classmethod
    def tearDownClass(cls):
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        with open(EVIDENCE_FILE, 'w', encoding='utf-8') as f:
            f.write('\n'.join(cls._evidence_lines) + '\n')
        super().tearDownClass()

    def setUp(self):
        self.region = Region.objects.create(id='aperf-region', name='Apartments Perf Region')
        self.dorm_type = DormType.objects.create(code=911, name='AptPerfDormType', region=self.region)
        self.admin = _make_user('aperf-admin@test.com', User.Role.CENTRAL_ADMIN)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _measure(self, n_apartments, label):
        _reset_inventory()
        building = _build_apartments(self.dorm_type, n_apartments, admin=self.admin)

        with CaptureQueriesContext(connection) as ctx:
            start = time.perf_counter()
            resp = self.client.get('/api/apartments/', {
                'building': building.id, 'is_active': 'all',
            })
            elapsed_ms = (time.perf_counter() - start) * 1000

        self.assertEqual(resp.status_code, 200)
        rows = resp.data if isinstance(resp.data, list) else resp.data.get('results', [])
        self.assertEqual(len(rows), n_apartments)

        # Correctness spot-check on every measurement (not just the
        # dedicated correctness test class): the uniform fixture shape
        # means every apartment should show the same non-trivial numbers.
        for row in rows:
            self.assertEqual(row['actual_room_count'], 3)
            self.assertEqual(row['bed_count'], 6)
            self.assertEqual(row['occupied_beds'], 1)
            self.assertEqual(row['free_beds'], 5)

        summary = _summarize(ctx.captured_queries)
        payload_bytes = len(resp.content)

        lines = [
            f'--- {label}: n_apartments={n_apartments} ---',
            f'endpoint: GET /api/apartments/?building={building.id}&is_active=all',
            f'user role: central_admin',
            f'apartments_returned: {len(rows)}',
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

    def test_apartments_list_query_count_is_flat_after_optimization(self):
        """
        Core regression check: GET /api/apartments/ must issue essentially
        the same number of SQL queries at N=5 as at N=25 - i.e. query count
        no longer scales with the number of apartments returned. Before
        the BLD-02 fix this test (as test_apartments_list_query_count_scaling)
        measured a marginal cost of 5.00 queries/apartment; it must now be
        ~0.
        """
        small_n = 5
        large_n = 25

        queries_small, ms_small, bytes_small = self._measure(small_n, 'SMALL DATASET (post-optimization)')
        queries_large, ms_large, bytes_large = self._measure(large_n, 'LARGE DATASET (post-optimization)')

        per_apartment_small = queries_small / small_n
        per_apartment_large = queries_large / large_n
        marginal_per_apartment = (queries_large - queries_small) / (large_n - small_n)

        summary_lines = [
            '--- SCALING SUMMARY (post-optimization) ---',
            f'small: n={small_n} total_queries={queries_small} '
            f'queries/apartment={per_apartment_small:.2f} time_ms={ms_small:.2f} bytes={bytes_small}',
            f'large: n={large_n} total_queries={queries_large} '
            f'queries/apartment={per_apartment_large:.2f} time_ms={ms_large:.2f} bytes={bytes_large}',
            f'marginal_queries_per_additional_apartment: {marginal_per_apartment:.2f}',
            'BLD-02 baseline marginal cost (pre-fix): 5.00 queries/apartment',
            '',
        ]
        type(self)._evidence_lines.extend(summary_lines)
        print('\n'.join(summary_lines))

        # Documentary/regression assertions (post-optimization): query
        # count must no longer scale with N - the defining proof the N+1
        # fix worked. Loose tolerance (<=0.5) rather than exactly 0 to
        # absorb any incidental per-row cost that isn't query-count-related
        # (there should be none, but this keeps the test robust rather than
        # brittle).
        self.assertLessEqual(marginal_per_apartment, 0.5)
        # And the absolute count must stay small in general - not just
        # "flat but still huge" - confirming the fix collapsed the N+1,
        # rather than merely moving it somewhere still expensive.
        self.assertLess(queries_large, 15)

    def test_apartments_list_single_apartment_baseline_overhead(self):
        """
        Secondary measurement: the N=1 case isolates the fixed per-request
        overhead (auth, permission checks, the single annotated list
        query) from the per-row multiplier measured above.
        """
        queries_one, ms_one, bytes_one = self._measure(1, 'SINGLE APARTMENT (N=1, post-optimization)')
        self.assertGreaterEqual(queries_one, 1)


class ApartmentCountCorrectnessTests(TestCase):
    """
    Correctness protection for the optimized actual_room_count/bed_count/
    occupied_beds/free_beds computation
    (views._annotate_apartment_inventory_counts + ApartmentSerializer).

    Builds one Apartment with a deliberately non-trivial mix: an active
    room (one occupied bed, one bed whose assignment has ENDED) and an
    *inactive* room holding a bed with a still-ACTIVE assignment. This
    exercises every filtering rule the original per-row queries encoded,
    including the original code's asymmetry - occupied_beds is NOT
    filtered by room is_active, unlike the other two counts - which the
    optimization must reproduce exactly, not "fix" as a side effect.
    """

    def setUp(self):
        self.region = Region.objects.create(id='aperf-correctness-region', name='Apt Perf Correctness Region')
        self.dorm_type = DormType.objects.create(code=912, name='AptPerfCorrectnessDormType', region=self.region)
        self.admin = _make_user('aperf-correctness-admin@test.com', User.Role.CENTRAL_ADMIN)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

        self.building = Building.objects.create(number=500, dorm_type=self.dorm_type)
        self.apartment = Apartment.objects.create(
            building=self.building, number='A1', category=Apartment.Category.MIXED,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=2, is_active=True,
        )

        room_active = Room.objects.create(apartment=self.apartment, name='R1', capacity=2, is_active=True)
        bed_occupied = Bed.objects.create(room=room_active, label='B1')
        bed_ended = Bed.objects.create(room=room_active, label='B2')

        room_inactive = Room.objects.create(apartment=self.apartment, name='R2', capacity=1, is_active=False)
        bed_in_inactive_room = Bed.objects.create(room=room_inactive, label='B3')

        def _student(sid):
            return Student.objects.create(
                student_id=sid, first_name='F', last_name='L', gender='male',
                housing_type=Student.HousingType.SINGLE_MALE,
                accepted_dorm_type=self.dorm_type, category='new',
            )

        BedAssignment.objects.create(
            student=_student('ACORR-1'), bed=bed_occupied,
            status=BedAssignment.Status.ACTIVE, assigned_by=self.admin,
        )
        # An ENDED assignment must NOT count as occupied.
        ended = BedAssignment.objects.create(
            student=_student('ACORR-2'), bed=bed_ended,
            status=BedAssignment.Status.ACTIVE, assigned_by=self.admin,
        )
        ended.status = BedAssignment.Status.ENDED
        ended.ended_at = timezone.now()
        ended.save(update_fields=['status', 'ended_at'])
        # Edge case: ACTIVE assignment on a bed whose room is inactive -
        # must still count in occupied_beds (matches the original
        # get_occupied_beds, which never filtered by room is_active).
        BedAssignment.objects.create(
            student=_student('ACORR-3'), bed=bed_in_inactive_room,
            status=BedAssignment.Status.ACTIVE, assigned_by=self.admin,
        )

    def _get_apartment_row(self):
        resp = self.client.get('/api/apartments/', {
            'building': self.building.id, 'is_active': 'all',
        })
        self.assertEqual(resp.status_code, 200)
        rows = resp.data if isinstance(resp.data, list) else resp.data.get('results', [])
        return next(r for r in rows if r['id'] == self.apartment.id)

    def test_apartment_counts_match_expected_values(self):
        """
        Hand-computed expected values for the fixture above:
        - actual_room_count = 1 (R1 only; R2 is inactive)
        - bed_count = 2 (B1, B2 under R1; B3 excluded - inactive room)
        - occupied_beds = 2 (B1 ACTIVE, B3 ACTIVE; B2's assignment is ENDED so excluded)
        - free_beds = max(2 - 2, 0) = 0
        """
        row = self._get_apartment_row()
        self.assertEqual(row['actual_room_count'], 1)
        self.assertEqual(row['bed_count'], 2)
        self.assertEqual(row['occupied_beds'], 2)
        self.assertEqual(row['free_beds'], 0)

    def test_apartment_counts_match_original_unannotated_queries(self):
        """
        Ground-truth cross-check: recompute each count with the exact
        original (pre-optimization) query logic directly against the DB,
        and assert the live endpoint (now backed by annotated subqueries)
        produces byte-for-byte identical numbers. This is what proves the
        optimization changed *how many queries run*, not *what the answer
        is*.
        """
        a = self.apartment

        original_actual_room_count = a.rooms.filter(is_active=True).count()
        original_bed_count = Bed.objects.filter(
            room__apartment=a, room__is_active=True,
        ).count()
        original_occupied_beds = BedAssignment.objects.filter(
            bed__room__apartment=a, status=BedAssignment.Status.ACTIVE,
        ).values('bed_id').distinct().count()
        original_free_beds = max(original_bed_count - original_occupied_beds, 0)

        row = self._get_apartment_row()

        self.assertEqual(row['actual_room_count'], original_actual_room_count)
        self.assertEqual(row['bed_count'], original_bed_count)
        self.assertEqual(row['occupied_beds'], original_occupied_beds)
        self.assertEqual(row['free_beds'], original_free_beds)

    def test_freshly_created_apartment_falls_back_correctly(self):
        """
        ApartmentViewSet.create() serializes a plain instance returned by
        serializer.save(), not one fetched through the annotated
        get_queryset() - so the serializer's fallback path (used whenever
        the _actual_room_count/_bed_count/_occupied_beds annotations are
        absent from the instance) must still return correct values for a
        brand-new, empty apartment.
        """
        resp = self.client.post('/api/apartments/', {
            'building': self.building.id, 'number': 'A999',
            'category': Apartment.Category.MIXED,
            'apartment_type': Apartment.ApartmentType.SINGLE,
            'room_count': 0,
        })
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['actual_room_count'], 0)
        self.assertEqual(resp.data['bed_count'], 0)
        self.assertEqual(resp.data['occupied_beds'], 0)
        self.assertEqual(resp.data['free_beds'], 0)