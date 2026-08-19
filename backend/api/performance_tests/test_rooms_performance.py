"""
Rooms list endpoint (GET /api/rooms/) performance regression tests.

History:
- BLD-03 baseline measurement (code unchanged): this module captured the
  N+1 pattern in RoomSerializer/Room model properties - query count scaled
  as `1 + 7*N` for active rooms (3 for an inactive room). That baseline
  evidence is summarized in project-quality/performance/PERFORMANCE_FINAL_REPORT.md
  and is not reproduced or overwritten by this module going forward.
- BLD-03 fix (this version, current code): RoomViewSet.get_queryset() now
  annotates current_occupancy/available_beds/is_full/bed_count/
  has_missing_bed_records via correlated Subquery + Case/When/F
  expressions (views._annotate_room_inventory_counts) instead of
  RoomSerializer/Room model properties running up to 7 extra queries per
  room row. This module now asserts the query count stays FLAT as room
  count grows, and writes CURRENT evidence to
  project-quality/performance/evidence/ROOMS_AFTER_QUERY_COUNTS.txt (a
  distinct file from the frozen baseline above).

Methodology and structure mirror the BLD-01 (Buildings)/BLD-02
(Apartments) fixes exactly - see
backend/api/performance_tests/test_buildings_performance.py,
test_apartments_performance.py, and
project-quality/performance/PERFORMANCE_FINAL_REPORT.md - down to using
django.test.utils.CaptureQueriesContext, the "query shape" duplicate-
detection technique, and the annotation-fallback correctness-cross-check
pattern. Self-contained (does not import from the other performance_tests
modules), per api/performance_tests/__init__.py's stated convention.

MEASUREMENT + REGRESSION TEST. The correctness tests in this module
(`RoomCountCorrectnessTests`) are the primary safety net for the
optimization: they prove current_occupancy/available_beds/is_full/
bed_count/has_missing_bed_records return byte-for-byte the same values as
the original per-row property/query implementation, across active/
inactive rooms, occupied/unoccupied/ended-assignment beds, and a missing-
bed-records edge case (fewer materialized Bed rows than capacity) - a
faster query that returns wrong numbers is not an acceptable outcome.

Run against Django's disposable TEST database (created/destroyed as
test_<DB_NAME> - never touches the real database), via a local-only
.env.test:

    cd backend
    ENV_FILE=.env.test python manage.py test api.performance_tests.test_rooms_performance -v 2

Lives in api/performance_tests/ - the dedicated home for performance /
query-efficiency regression tests (see performance_tests/__init__.py);
business-logic/permission tests for rooms stay in api/tests/test_inventory.py.
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
# Deliberately a DIFFERENT file from the frozen BLD-03 baseline evidence
# (ROOMS_BASELINE_QUERY_COUNTS.txt) - this module now measures the
# optimized (post-fix) code and must never overwrite the historical
# baseline record.
EVIDENCE_FILE = EVIDENCE_DIR / 'ROOMS_AFTER_QUERY_COUNTS.txt'

_NUMBER_RE = re.compile(r'\d+')


def _shape(sql):
    """
    Collapse a captured SQL statement's literal numbers so structurally
    identical queries issued for different room/bed pks collapse into the
    same 'shape'.
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
    BedAssignment.objects.all().delete()
    Student.objects.all().delete()
    Building.objects.all().delete()


def _build_rooms(dorm_type, n_rooms, admin, beds_per_room=3,
                  occupied_beds_per_room=2, start_room_number=1):
    """
    Creates one Building -> one active Apartment -> n_rooms active Rooms,
    each with beds_per_room beds. The first occupied_beds_per_room beds of
    every room get an ACTIVE BedAssignment, so every room shows non-trivial
    (and uniform, easy to sanity-check) values.
    """
    building = Building.objects.create(number=1, dorm_type=dorm_type)
    apartment = Apartment.objects.create(
        building=building, number='1', category=Apartment.Category.MIXED,
        apartment_type=Apartment.ApartmentType.SINGLE, room_count=n_rooms,
    )
    student_seq = 0
    for r in range(n_rooms):
        room = Room.objects.create(
            apartment=apartment, name=str(start_room_number + r), capacity=beds_per_room,
        )
        beds = [
            Bed.objects.create(room=room, label=f'Bed {i + 1}')
            for i in range(beds_per_room)
        ]
        for i in range(occupied_beds_per_room):
            student_seq += 1
            student = Student.objects.create(
                student_id=f'RPERF{start_room_number}-{student_seq}',
                first_name='F', last_name='L', gender='male',
                housing_type=Student.HousingType.SINGLE_MALE,
                accepted_dorm_type=dorm_type, category='new',
            )
            BedAssignment.objects.create(
                student=student, bed=beds[i],
                status=BedAssignment.Status.ACTIVE, assigned_by=admin,
            )
    return building


class RoomsListPerformanceTests(TestCase):
    """
    Post-optimization performance regression test for GET /api/rooms/.

    BLD-03 fix: RoomViewSet.get_queryset() now annotates all five derived
    fields via correlated subqueries/Case expressions instead of
    RoomSerializer/Room properties running one-to-several queries per room
    row. These tests assert query count stays FLAT (independent of N) -
    the inverse of the original baseline assertions, which proved the OLD
    code scaled linearly. If this test ever starts failing because query
    count scales with N again, the N+1 regressed and BLD-03 needs to be
    re-fixed.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._evidence_lines = [
            'Rooms API (GET /api/rooms/) — POST-OPTIMIZATION query-count evidence',
            'Generated by backend/api/performance_tests/test_rooms_performance.py',
            'BLD-03 fix evidence (after the RoomSerializer/Room property N+1 fix).',
            'Compare against the frozen baseline in ROOMS_BASELINE_QUERY_COUNTS.txt '
            '(total_queries = 1 + 7*N there for active rooms).',
            '',
        ]

    @classmethod
    def tearDownClass(cls):
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        with open(EVIDENCE_FILE, 'w', encoding='utf-8') as f:
            f.write('\n'.join(cls._evidence_lines) + '\n')
        super().tearDownClass()

    def setUp(self):
        self.region = Region.objects.create(id='rperf-region', name='Rooms Perf Region')
        self.dorm_type = DormType.objects.create(code=921, name='RoomPerfDormType', region=self.region)
        self.admin = _make_user('rperf-admin@test.com', User.Role.CENTRAL_ADMIN)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _measure(self, n_rooms, label):
        _reset_inventory()
        building = _build_rooms(self.dorm_type, n_rooms, admin=self.admin)

        with CaptureQueriesContext(connection) as ctx:
            start = time.perf_counter()
            resp = self.client.get('/api/rooms/', {
                'building': building.id, 'is_active': 'all',
            })
            elapsed_ms = (time.perf_counter() - start) * 1000

        self.assertEqual(resp.status_code, 200)
        rows = resp.data if isinstance(resp.data, list) else resp.data.get('results', [])
        self.assertEqual(len(rows), n_rooms)

        for row in rows:
            self.assertEqual(row['bed_count'], 3)
            self.assertEqual(row['current_occupancy'], 2)
            self.assertEqual(row['available_beds'], 1)
            self.assertFalse(row['is_full'])
            self.assertFalse(row['has_missing_bed_records'])

        summary = _summarize(ctx.captured_queries)
        payload_bytes = len(resp.content)

        lines = [
            f'--- {label}: n_rooms={n_rooms} ---',
            f'endpoint: GET /api/rooms/?building={building.id}&is_active=all',
            f'user role: central_admin',
            f'rooms_returned: {len(rows)}',
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

    def test_rooms_list_query_count_is_flat_after_optimization(self):
        """
        Core regression check: GET /api/rooms/ must issue essentially the
        same number of SQL queries at N=5 as at N=25 - i.e. query count no
        longer scales with the number of rooms returned. Before the BLD-03
        fix this test (as test_rooms_list_query_count_scaling) measured a
        marginal cost of 7.00 queries/room; it must now be ~0.
        """
        small_n = 5
        large_n = 25

        queries_small, ms_small, bytes_small = self._measure(small_n, 'SMALL DATASET (post-optimization)')
        queries_large, ms_large, bytes_large = self._measure(large_n, 'LARGE DATASET (post-optimization)')

        per_room_small = queries_small / small_n
        per_room_large = queries_large / large_n
        marginal_per_room = (queries_large - queries_small) / (large_n - small_n)

        summary_lines = [
            '--- SCALING SUMMARY (post-optimization) ---',
            f'small: n={small_n} total_queries={queries_small} '
            f'queries/room={per_room_small:.2f} time_ms={ms_small:.2f} bytes={bytes_small}',
            f'large: n={large_n} total_queries={queries_large} '
            f'queries/room={per_room_large:.2f} time_ms={ms_large:.2f} bytes={bytes_large}',
            f'marginal_queries_per_additional_room: {marginal_per_room:.2f}',
            'BLD-03 baseline marginal cost (pre-fix, active rooms): 7.00 queries/room',
            '',
        ]
        type(self)._evidence_lines.extend(summary_lines)
        print('\n'.join(summary_lines))

        self.assertLessEqual(marginal_per_room, 0.5)
        self.assertLess(queries_large, 15)

    def test_rooms_list_single_room_baseline_overhead(self):
        """
        Secondary measurement: the N=1 case isolates the fixed per-request
        overhead (auth, permission checks, the single annotated list
        query) from the per-row multiplier measured above.
        """
        queries_one, ms_one, bytes_one = self._measure(1, 'SINGLE ROOM (N=1, post-optimization)')
        self.assertGreaterEqual(queries_one, 1)

    def test_rooms_list_inactive_room_query_count_unaffected(self):
        """
        Post-fix version of the baseline's dedicated inactive-room
        measurement: an inactive room must still report available_beds=0
        and is_full=True (short-circuit semantics preserved), and now
        costs the SAME flat query count as an active room (the annotation
        computes both branches inside the single SQL statement - there is
        no separate Python-level short-circuit anymore, just a SQL CASE
        expression).
        """
        _reset_inventory()
        building = Building.objects.create(number=2, dorm_type=self.dorm_type)
        apartment = Apartment.objects.create(
            building=building, number='1', category=Apartment.Category.MIXED,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=1,
        )
        room = Room.objects.create(apartment=apartment, name='INACTIVE', capacity=2, is_active=False)
        Bed.objects.create(room=room, label='Bed 1')
        Bed.objects.create(room=room, label='Bed 2')

        with CaptureQueriesContext(connection) as ctx:
            resp = self.client.get('/api/rooms/', {'building': building.id, 'is_active': 'all'})

        self.assertEqual(resp.status_code, 200)
        rows = resp.data if isinstance(resp.data, list) else resp.data.get('results', [])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['current_occupancy'], 0)
        self.assertEqual(rows[0]['available_beds'], 0)
        self.assertTrue(rows[0]['is_full'])

        summary = _summarize(ctx.captured_queries)
        lines = [
            '--- INACTIVE ROOM (post-optimization) ---',
            f'total_sql_queries: {summary["total"]}',
            '(baseline was 4 for this exact fixture; should now match the flat '
            'per-request cost, same as an active room)',
            '',
        ]
        type(self)._evidence_lines.extend(lines)
        print('\n'.join(lines))
        self.assertLessEqual(summary['total'], 3)


class RoomCountCorrectnessTests(TestCase):
    """
    Correctness protection for the optimized current_occupancy/
    available_beds/is_full/bed_count/has_missing_bed_records computation
    (views._annotate_room_inventory_counts + RoomSerializer).

    Builds three rooms under one apartment, deliberately covering:
    - R1 (active, capacity=3, 3 materialized beds): one ACTIVE assignment,
      one ENDED assignment (must not count as occupied), one free bed.
    - R2 (active, capacity=5, only 2 materialized beds): the
      has_missing_bed_records edge case (bed_count < capacity), with one
      ACTIVE assignment.
    - R3 (INACTIVE, capacity=2, 2 materialized beds): one ACTIVE
      assignment - the asymmetry edge case where current_occupancy still
      counts it (no is_active gate) but available_beds/is_full
      short-circuit to 0/True regardless of the underlying bed math.
    """

    def setUp(self):
        self.region = Region.objects.create(id='rperf-correctness-region', name='Room Perf Correctness Region')
        self.dorm_type = DormType.objects.create(code=922, name='RoomPerfCorrectnessDormType', region=self.region)
        self.admin = _make_user('rperf-correctness-admin@test.com', User.Role.CENTRAL_ADMIN)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

        self.building = Building.objects.create(number=500, dorm_type=self.dorm_type)
        self.apartment = Apartment.objects.create(
            building=self.building, number='A1', category=Apartment.Category.MIXED,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=3, is_active=True,
        )

        def _student(sid):
            return Student.objects.create(
                student_id=sid, first_name='F', last_name='L', gender='male',
                housing_type=Student.HousingType.SINGLE_MALE,
                accepted_dorm_type=self.dorm_type, category='new',
            )

        # R1: active, normal occupancy, one ended assignment.
        self.room_normal = Room.objects.create(apartment=self.apartment, name='R1', capacity=3, is_active=True)
        r1_bed_occupied = Bed.objects.create(room=self.room_normal, label='B1')
        r1_bed_ended = Bed.objects.create(room=self.room_normal, label='B2')
        Bed.objects.create(room=self.room_normal, label='B3')  # free
        BedAssignment.objects.create(
            student=_student('RCORR-1'), bed=r1_bed_occupied,
            status=BedAssignment.Status.ACTIVE, assigned_by=self.admin,
        )
        ended = BedAssignment.objects.create(
            student=_student('RCORR-2'), bed=r1_bed_ended,
            status=BedAssignment.Status.ACTIVE, assigned_by=self.admin,
        )
        ended.status = BedAssignment.Status.ENDED
        ended.ended_at = timezone.now()
        ended.save(update_fields=['status', 'ended_at'])

        # R2: active, capacity=5 but only 2 beds materialized (missing bed
        # records edge case), one ACTIVE assignment.
        self.room_missing_beds = Room.objects.create(apartment=self.apartment, name='R2', capacity=5, is_active=True)
        r2_bed_occupied = Bed.objects.create(room=self.room_missing_beds, label='B1')
        Bed.objects.create(room=self.room_missing_beds, label='B2')  # free
        BedAssignment.objects.create(
            student=_student('RCORR-3'), bed=r2_bed_occupied,
            status=BedAssignment.Status.ACTIVE, assigned_by=self.admin,
        )

        # R3: INACTIVE, one ACTIVE assignment (asymmetry edge case).
        self.room_inactive = Room.objects.create(apartment=self.apartment, name='R3', capacity=2, is_active=False)
        r3_bed_occupied = Bed.objects.create(room=self.room_inactive, label='B1')
        Bed.objects.create(room=self.room_inactive, label='B2')  # free
        BedAssignment.objects.create(
            student=_student('RCORR-4'), bed=r3_bed_occupied,
            status=BedAssignment.Status.ACTIVE, assigned_by=self.admin,
        )

    def _get_rows(self):
        resp = self.client.get('/api/rooms/', {
            'building': self.building.id, 'is_active': 'all',
        })
        self.assertEqual(resp.status_code, 200)
        rows = resp.data if isinstance(resp.data, list) else resp.data.get('results', [])
        by_name = {r['name']: r for r in rows}
        return by_name

    def test_room_values_match_expected_values(self):
        """
        Hand-computed expected values:
        - R1: bed_count=3, current_occupancy=1 (B2's assignment ended),
          available_beds=max(3-1,0)=2, is_full=False,
          has_missing_bed_records=False (3 >= 3).
        - R2: bed_count=2, current_occupancy=1,
          available_beds=max(2-1,0)=1, is_full=False,
          has_missing_bed_records=True (2 < 5).
        - R3 (inactive): bed_count=2, current_occupancy=1 (still counts,
          no is_active gate), available_beds=0 (short-circuit),
          is_full=True (short-circuit), has_missing_bed_records=False
          (2 >= 2).
        """
        rows = self._get_rows()

        r1 = rows['R1']
        self.assertEqual(r1['bed_count'], 3)
        self.assertEqual(r1['current_occupancy'], 1)
        self.assertEqual(r1['available_beds'], 2)
        self.assertFalse(r1['is_full'])
        self.assertFalse(r1['has_missing_bed_records'])

        r2 = rows['R2']
        self.assertEqual(r2['bed_count'], 2)
        self.assertEqual(r2['current_occupancy'], 1)
        self.assertEqual(r2['available_beds'], 1)
        self.assertFalse(r2['is_full'])
        self.assertTrue(r2['has_missing_bed_records'])

        r3 = rows['R3']
        self.assertEqual(r3['bed_count'], 2)
        self.assertEqual(r3['current_occupancy'], 1)
        self.assertEqual(r3['available_beds'], 0)
        self.assertTrue(r3['is_full'])
        self.assertFalse(r3['has_missing_bed_records'])

    def test_room_values_match_original_unannotated_properties(self):
        """
        Ground-truth cross-check: recompute each value with the exact
        original (pre-optimization) Room model properties / serializer
        queries directly against the DB, and assert the live endpoint (now
        backed by annotated subqueries) produces byte-for-byte identical
        numbers for all three rooms.
        """
        rows = self._get_rows()

        for room, key in (
            (self.room_normal, 'R1'),
            (self.room_missing_beds, 'R2'),
            (self.room_inactive, 'R3'),
        ):
            original_bed_count = room.beds.count()
            original_current_occupancy = room.current_occupancy
            original_available_beds = room.available_beds
            original_is_full = room.is_full
            original_has_missing_bed_records = room.beds.count() < room.capacity

            row = rows[key]
            self.assertEqual(row['bed_count'], original_bed_count, key)
            self.assertEqual(row['current_occupancy'], original_current_occupancy, key)
            self.assertEqual(row['available_beds'], original_available_beds, key)
            self.assertEqual(row['is_full'], original_is_full, key)
            self.assertEqual(row['has_missing_bed_records'], original_has_missing_bed_records, key)

    def test_freshly_created_room_falls_back_correctly(self):
        """
        RoomViewSet.create() serializes a plain instance returned by
        serializer.save(), not one fetched through the annotated
        get_queryset() - so the serializer's fallback path (used whenever
        the _current_occupancy/_available_beds/_is_full/_bed_count/
        _has_missing_bed_records annotations are absent from the instance)
        must still return correct values for a brand-new, empty room (no
        Bed rows materialized yet).
        """
        resp = self.client.post('/api/rooms/', {
            'apartment': self.apartment.id, 'name': 'R999', 'capacity': 2,
        })
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['bed_count'], 0)
        self.assertEqual(resp.data['current_occupancy'], 0)
        self.assertEqual(resp.data['available_beds'], 0)
        # capacity=2 but 0 beds materialized -> is_full=True (available_beds<=0)
        # and has_missing_bed_records=True (0 < 2), matching the original
        # Room.is_full / RoomSerializer.get_has_missing_bed_records logic
        # exactly for a brand-new, active, unmaterialized room.
        self.assertTrue(resp.data['is_full'])
        self.assertTrue(resp.data['has_missing_bed_records'])
