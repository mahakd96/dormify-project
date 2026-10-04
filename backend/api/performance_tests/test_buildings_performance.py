"""
Buildings list endpoint (GET /api/buildings/) performance regression tests.

History:
- Phase 2 (baseline measurement, code unchanged): this module captured the
  N+1 pattern in BuildingSerializer (finding BLD-01) - query count scaled
  as `2 + 6*N` with building count N. That baseline evidence is
  summarized in project-quality/performance/PERFORMANCE_FINAL_REPORT.md
  and is not reproduced or overwritten by this module going forward.
- Phase 3 (this version, current code): BuildingViewSet.get_queryset() now
  annotates apartment_count/room_count/bed_count/occupied_beds via
  correlated Subquery expressions
  (views._annotate_building_inventory_counts) instead of
  BuildingSerializer running 6 extra queries per building row. This module
  now asserts the query count stays FLAT as building count grows, and
  writes CURRENT evidence to
  project-quality/performance/evidence/BUILDINGS_AFTER_QUERY_COUNTS.txt
  (a distinct file from the frozen baseline above).

MEASUREMENT + REGRESSION TEST. The correctness tests in this module
(`BuildingCountCorrectnessTests`) are the primary safety net for the
optimization: they prove apartment_count/room_count/bed_count/
occupied_beds/free_beds return byte-for-byte the same values as the
original per-row query implementation, across active/inactive
apartments/rooms and occupied/unoccupied/ended-assignment beds - a faster
query that returns wrong numbers is not an acceptable outcome.

Run against Django's disposable TEST database (created/destroyed as
test_<DB_NAME> - never touches the real database). This repo's real .env
points at the production Azure Postgres instance, so this measurement run
should be pointed at the local docker-compose `test_db` service instead,
via a local-only .env.test:

    cd backend
    ENV_FILE=.env.test python manage.py test api.performance_tests.test_buildings_performance -v 2

Modeled directly on the CaptureQueriesContext approach already used in
api/performance_tests/test_students_performance.py for the earlier
Students-page N+1 investigation.

Lives in api/performance_tests/ - the dedicated home for performance /
query-efficiency regression tests (see performance_tests/__init__.py);
business-logic/permission tests for buildings stay in
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
# Deliberately a DIFFERENT file from the frozen Phase 2 baseline evidence
# (BUILDINGS_BASELINE_QUERY_COUNTS.txt) - this module now measures the
# optimized (post-fix) code and must never overwrite the historical
# baseline record.
EVIDENCE_FILE = EVIDENCE_DIR / 'BUILDINGS_AFTER_QUERY_COUNTS.txt'

_NUMBER_RE = re.compile(r'\d+')


def _shape(sql):
    """
    Collapse a captured SQL statement's literal numbers so structurally
    identical queries issued for different building/apartment/room/bed pks
    collapse into the same 'shape'. This lets us count how many times the
    *same kind* of query ran, rather than only counting distinct query
    strings (which would never collapse, since every building has a
    different pk).
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
    reference) must be removed before the Building tree can be deleted;
    Apartment/Room/Bed all cascade from Building once that's clear.
    """
    BedAssignment.objects.all().delete()
    Student.objects.all().delete()
    Building.objects.all().delete()


def _build_inventory(dorm_type, n_buildings, admin, apartments_per_building=2,
                      rooms_per_apartment=2, beds_per_room=2,
                      start_building_number=1):
    """
    Creates n_buildings, each with apartments_per_building apartments, each
    with rooms_per_apartment rooms, each with beds_per_room beds. The first
    bed of the first room of the first apartment of every building gets an
    ACTIVE BedAssignment, so occupied_beds/free_beds computation (the part
    of BuildingSerializer under investigation) is genuinely exercised on
    every building, not just counting empty rows.
    """
    student_seq = 0
    for b in range(n_buildings):
        building = Building.objects.create(
            number=start_building_number + b, dorm_type=dorm_type,
        )
        for a in range(apartments_per_building):
            apartment = Apartment.objects.create(
                building=building, number=str(a + 1),
                category=Apartment.Category.MIXED,
                apartment_type=Apartment.ApartmentType.SINGLE,
                room_count=rooms_per_apartment,
            )
            for r in range(rooms_per_apartment):
                room = Room.objects.create(
                    apartment=apartment, name=str(r + 1), capacity=beds_per_room,
                )
                beds = [
                    Bed.objects.create(room=room, label=f'Bed {i + 1}')
                    for i in range(beds_per_room)
                ]
                if a == 0 and r == 0:
                    student_seq += 1
                    student = Student.objects.create(
                        student_id=f'PERF{start_building_number}-{student_seq}',
                        first_name='F', last_name='L', gender='male',
                        housing_type=Student.HousingType.SINGLE_MALE,
                        accepted_dorm_type=dorm_type, category='new',
                    )
                    BedAssignment.objects.create(
                        student=student, bed=beds[0],
                        status=BedAssignment.Status.ACTIVE, assigned_by=admin,
                    )


class BuildingsListPerformanceTests(TestCase):
    """
    Post-optimization performance regression test for GET /api/buildings/.

    Phase 3: BuildingViewSet.get_queryset() now annotates the four counts
    via correlated subqueries instead of BuildingSerializer running one
    query per count per building row. These tests assert query count stays
    FLAT (independent of N) - the inverse of the Phase 2 baseline
    assertions, which proved the OLD code scaled linearly. If this test
    ever starts failing because query count scales with N again, the N+1
    regressed and finding BLD-01 needs to be re-fixed.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._evidence_lines = [
            'Buildings API (GET /api/buildings/) — POST-OPTIMIZATION query-count evidence',
            'Generated by backend/api/performance_tests/test_buildings_performance.py',
            'Phase 3 of the performance-optimization investigation (after the BLD-01 fix).',
            'Compare against the frozen Phase 2 baseline in BUILDINGS_BASELINE_QUERY_COUNTS.txt '
            '(total_queries = 2 + 6*N there).',
            '',
        ]

    @classmethod
    def tearDownClass(cls):
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        with open(EVIDENCE_FILE, 'w', encoding='utf-8') as f:
            f.write('\n'.join(cls._evidence_lines) + '\n')
        super().tearDownClass()

    def setUp(self):
        self.region = Region.objects.create(id='perf-region', name='Perf Region')
        self.dorm_type = DormType.objects.create(code=901, name='PerfDormType', region=self.region)
        self.admin = _make_user('perf-admin@test.com', User.Role.CENTRAL_ADMIN)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _measure(self, n_buildings, label):
        _reset_inventory()
        _build_inventory(self.dorm_type, n_buildings, admin=self.admin)

        with CaptureQueriesContext(connection) as ctx:
            start = time.perf_counter()
            resp = self.client.get('/api/buildings/', {
                'region': self.region.id, 'is_active': 'all',
            })
            elapsed_ms = (time.perf_counter() - start) * 1000

        self.assertEqual(resp.status_code, 200)
        rows = resp.data if isinstance(resp.data, list) else resp.data.get('results', [])
        self.assertEqual(len(rows), n_buildings)

        summary = _summarize(ctx.captured_queries)
        payload_bytes = len(resp.content)

        lines = [
            f'--- {label}: n_buildings={n_buildings} ---',
            f'endpoint: GET /api/buildings/?region={self.region.id}&is_active=all',
            f'user role: central_admin',
            f'buildings_returned: {len(rows)}',
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

    def test_buildings_list_query_count_is_flat_after_optimization(self):
        """
        Core regression check: GET /api/buildings/ must issue essentially
        the same number of SQL queries at N=5 as at N=25 - i.e. query count
        no longer scales with the number of buildings returned. Before the
        Phase 3 fix this test (as test_buildings_list_query_count_scaling)
        measured a marginal cost of 6.00 queries/building; it must now be
        ~0.
        """
        small_n = 5
        large_n = 25

        queries_small, ms_small, bytes_small = self._measure(small_n, 'SMALL DATASET (post-optimization)')
        queries_large, ms_large, bytes_large = self._measure(large_n, 'LARGE DATASET (post-optimization)')

        per_building_small = queries_small / small_n
        per_building_large = queries_large / large_n
        marginal_per_building = (queries_large - queries_small) / (large_n - small_n)

        summary_lines = [
            '--- SCALING SUMMARY (post-optimization) ---',
            f'small: n={small_n} total_queries={queries_small} '
            f'queries/building={per_building_small:.2f} time_ms={ms_small:.2f} bytes={bytes_small}',
            f'large: n={large_n} total_queries={queries_large} '
            f'queries/building={per_building_large:.2f} time_ms={ms_large:.2f} bytes={bytes_large}',
            f'marginal_queries_per_additional_building: {marginal_per_building:.2f}',
            'Phase 2 baseline marginal cost (BLD-01, pre-fix): 6.00 queries/building',
            '',
        ]
        type(self)._evidence_lines.extend(summary_lines)
        print('\n'.join(summary_lines))

        # Query count must no longer scale with N - the defining proof the
        # N+1 fix worked. Loose tolerance (<=0.5) rather than exactly 0 to
        # absorb any incidental per-row cost that isn't query-count-related
        # (there should be none, but this keeps the test robust rather than
        # brittle).
        self.assertLessEqual(marginal_per_building, 0.5)
        # And the absolute count must stay small in general - not just
        # "flat but still huge" - confirming the fix collapsed the N+1,
        # rather than merely moving it somewhere still expensive.
        self.assertLess(queries_large, 15)

    def test_buildings_list_single_building_baseline_overhead(self):
        """
        Secondary measurement: the N=1 case isolates the fixed per-request
        overhead (auth, permission checks, the single annotated list
        query) from the per-row multiplier measured above.
        """
        queries_one, ms_one, bytes_one = self._measure(1, 'SINGLE BUILDING (N=1, post-optimization)')
        self.assertGreaterEqual(queries_one, 1)


class BuildingCountCorrectnessTests(TestCase):
    """
    Correctness protection for the optimized apartment_count/room_count/
    bed_count/occupied_beds/free_beds computation
    (views._annotate_building_inventory_counts + BuildingSerializer).

    Builds one Building with a deliberately non-trivial mix: an active
    apartment with an active room (one occupied bed, one bed whose
    assignment has ENDED) and an *inactive* room holding a bed with a
    still-ACTIVE assignment, plus a second, fully inactive apartment. This
    exercises every filtering rule the original per-row queries encoded,
    including the original code's asymmetry - occupied_beds is NOT
    filtered by room/apartment is_active, unlike the other three counts -
    which the optimization must reproduce exactly, not "fix" as a side
    effect.
    """

    def setUp(self):
        self.region = Region.objects.create(id='perf-correctness-region', name='Perf Correctness Region')
        self.dorm_type = DormType.objects.create(code=902, name='PerfCorrectnessDormType', region=self.region)
        self.admin = _make_user('perf-correctness-admin@test.com', User.Role.CENTRAL_ADMIN)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

        self.building = Building.objects.create(number=500, dorm_type=self.dorm_type)

        # Apartment A1: active - holds the "normal" active room plus the
        # edge-case inactive room with a still-active assignment.
        apartment_active = Apartment.objects.create(
            building=self.building, number='A1', category=Apartment.Category.MIXED,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=2, is_active=True,
        )
        room_active = Room.objects.create(apartment=apartment_active, name='R1', capacity=2, is_active=True)
        bed_occupied = Bed.objects.create(room=room_active, label='B1')
        bed_ended = Bed.objects.create(room=room_active, label='B2')

        room_inactive = Room.objects.create(apartment=apartment_active, name='R2', capacity=1, is_active=False)
        bed_in_inactive_room = Bed.objects.create(room=room_inactive, label='B3')

        # Apartment A2: inactive - nothing under it should count anywhere.
        apartment_inactive = Apartment.objects.create(
            building=self.building, number='A2', category=Apartment.Category.MIXED,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=1, is_active=False,
        )
        room_under_inactive_apartment = Room.objects.create(
            apartment=apartment_inactive, name='R3', capacity=1, is_active=True,
        )
        Bed.objects.create(room=room_under_inactive_apartment, label='B4')

        def _student(sid):
            return Student.objects.create(
                student_id=sid, first_name='F', last_name='L', gender='male',
                housing_type=Student.HousingType.SINGLE_MALE,
                accepted_dorm_type=self.dorm_type, category='new',
            )

        BedAssignment.objects.create(
            student=_student('CORR-1'), bed=bed_occupied,
            status=BedAssignment.Status.ACTIVE, assigned_by=self.admin,
        )
        # An ENDED assignment must NOT count as occupied.
        ended = BedAssignment.objects.create(
            student=_student('CORR-2'), bed=bed_ended,
            status=BedAssignment.Status.ACTIVE, assigned_by=self.admin,
        )
        ended.status = BedAssignment.Status.ENDED
        ended.ended_at = timezone.now()
        ended.save(update_fields=['status', 'ended_at'])
        # Edge case: ACTIVE assignment on a bed whose room is inactive -
        # must still count in occupied_beds (matches the original
        # get_occupied_beds, which never filtered by room/apartment
        # is_active).
        BedAssignment.objects.create(
            student=_student('CORR-3'), bed=bed_in_inactive_room,
            status=BedAssignment.Status.ACTIVE, assigned_by=self.admin,
        )

    def _get_building_row(self):
        resp = self.client.get('/api/buildings/', {
            'region': self.region.id, 'is_active': 'all',
        })
        self.assertEqual(resp.status_code, 200)
        rows = resp.data if isinstance(resp.data, list) else resp.data.get('results', [])
        return next(r for r in rows if r['id'] == self.building.id)

    def test_building_counts_match_expected_values(self):
        """
        Hand-computed expected values for the fixture above:
        - apartment_count = 1 (A1 only; A2 is inactive)
        - room_count = 1 (R1 only; R2 is inactive, R3's apartment A2 is inactive)
        - bed_count = 2 (B1, B2 under R1; B3 excluded - inactive room; B4 excluded - inactive apartment)
        - occupied_beds = 2 (B1 ACTIVE, B3 ACTIVE; B2's assignment is ENDED so excluded)
        - free_beds = max(2 - 2, 0) = 0
        """
        row = self._get_building_row()
        self.assertEqual(row['apartment_count'], 1)
        self.assertEqual(row['room_count'], 1)
        self.assertEqual(row['bed_count'], 2)
        self.assertEqual(row['occupied_beds'], 2)
        self.assertEqual(row['free_beds'], 0)

    def test_building_counts_match_original_unannotated_queries(self):
        """
        Ground-truth cross-check: recompute each count with the exact
        original (pre-optimization) query logic directly against the DB,
        and assert the live endpoint (now backed by annotated subqueries)
        produces byte-for-byte identical numbers. This is what proves the
        optimization changed *how many queries run*, not *what the answer
        is*.
        """
        b = self.building

        original_apartment_count = b.apartments.filter(is_active=True).count()
        original_room_count = Room.objects.filter(
            apartment__building=b, is_active=True, apartment__is_active=True,
        ).count()
        original_bed_count = Bed.objects.filter(
            room__apartment__building=b, room__is_active=True, room__apartment__is_active=True,
        ).count()
        original_occupied_beds = BedAssignment.objects.filter(
            bed__room__apartment__building=b, status=BedAssignment.Status.ACTIVE,
        ).values('bed_id').distinct().count()
        original_free_beds = max(original_bed_count - original_occupied_beds, 0)

        row = self._get_building_row()

        self.assertEqual(row['apartment_count'], original_apartment_count)
        self.assertEqual(row['room_count'], original_room_count)
        self.assertEqual(row['bed_count'], original_bed_count)
        self.assertEqual(row['occupied_beds'], original_occupied_beds)
        self.assertEqual(row['free_beds'], original_free_beds)

    def test_freshly_created_building_falls_back_correctly(self):
        """
        BuildingViewSet.create() serializes a plain instance returned by
        serializer.save(), not one fetched through the annotated
        get_queryset() - so the serializer's fallback path (used whenever
        the _apartment_count/_room_count/_bed_count/_occupied_beds
        annotations are absent from the instance) must still return
        correct values for a brand-new, empty building.
        """
        resp = self.client.post('/api/buildings/', {
            'number': 999, 'dorm_type': self.dorm_type.id,
        })
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['apartment_count'], 0)
        self.assertEqual(resp.data['room_count'], 0)
        self.assertEqual(resp.data['bed_count'], 0)
        self.assertEqual(resp.data['occupied_beds'], 0)
        self.assertEqual(resp.data['free_beds'], 0)