"""
Analysis endpoint (GET /api/analysis/) performance measurement + regression
tests.

History:
- Phase 1 (baseline measurement, code unchanged): this module captured the
  per-building N+1 pattern in analysis_data()'s occupancy_data loop -
  query count scaled as `31 + 3*N` with building count N (3 extra queries
  per building: capacity sum, distinct assigned-bed count, room count -
  views.py, formerly lines ~6657-6689). That baseline evidence is
  summarized in project-quality/performance/PERFORMANCE_FINAL_REPORT.md
  and is not reproduced or overwritten by this module going forward.
- Phase 2 (per-building fix): `analysis_data()`'s occupancy_data loop got
  `_capacity`/`_rooms_count`/`_assigned_beds` from
  `views._annotate_analysis_building_occupancy(buildings_qs, rooms_qs,
  assignments_qs)` - three correlated Subquery annotations computed inside
  the single `buildings_qs` query - instead of running 3 extra queries per
  building row. Query count dropped from `31 + 3*N` to a flat `31`. That
  result is summarized in project-quality/performance/PERFORMANCE_FINAL_REPORT.md
  and is not reproduced or overwritten by this module going forward.
- Phase 3 / Group 1 implementation (this version, current code): the
  remaining flat 31 queries were inspected
  (see project-quality/performance/PERFORMANCE_FINAL_REPORT.md) and 4 safe
  consolidations implemented - the 2 unconditionally-wasted Building counts eliminated
  entirely; the assignments/rooms/transfers/requests query groups each
  consolidated from 2-3 queries down to 1. Query count is now flat `23`
  (31 - 8), reproduced identically across repeated runs, with response
  payloads byte-identical to Phase 2. This module now writes CURRENT
  evidence to
  project-quality/performance/evidence/GROUP1_ANALYSIS_FINAL_QUERY_COUNTS.txt
  (a distinct file from both the Phase 1 and Phase 2 evidence above -
  neither is touched by this module).

MEASUREMENT + REGRESSION TEST. The correctness tests in this module
(`AnalysisOccupancyCorrectnessTests`) are the primary safety net for the
optimization: they prove `total_beds`/`assigned`/`rooms_count`/
`available_beds`/`occupancy_rate` in `occupancy_data` return byte-for-byte
the same values as the original per-building query implementation, across
active/inactive rooms/apartments, occupied/ended/wrongly-scoped bed
assignments, and a building with zero inventory - a faster query that
returns wrong numbers is not an acceptable outcome.

Modeled directly on the established methodology already used for
Buildings/Apartments/Rooms/Beds
(`api/performance_tests/test_buildings_performance.py` et al.):
`CaptureQueriesContext` + DRF `APIClient` + SQL-"shape" masking (numeric
literals replaced with `#` to collapse per-row queries issued against
different pks into one repeated pattern) + `time.perf_counter()` timing +
`len(response.content)` payload size.

Endpoint measured:
    GET /api/analysis/?region=<id>
the exact call `analysisAPI.getData(regionId)` makes from
`src/pages/AnalysisPage.js` (see its "Data loading" comment block, ~line
433) on page load, region-filter change, and the manual Refresh button -
the ONLY network request the Analysis page issues. Choosing an Analyze tab
(occupancy/available/demand/requests), Group-by, Sort, and row-selection
are all pure client-side reshaping of the same already-fetched payload and
never trigger a second request.

OWNERSHIP BOUNDARY: this module measures `analysis_data()` and the
querysets/loops inside it only. `analysis_data()` reads `AllocationRun`
(for `latest_run`) but this module never creates, asserts on, or draws any
conclusion about allocation algorithm behavior - that logic is owned by
other team members and is out of scope here.

Run against Django's disposable TEST database (created/destroyed as
test_<DB_NAME> - never touches the real database):

    cd backend
    ENV_FILE=.env.test python manage.py test api.performance_tests.test_analysis_performance -v 2

Lives in api/performance_tests/ alongside the Buildings/Apartments/Rooms/
Beds baselines. Business-logic/permission/scoping tests for Analysis stay
in api/tests/test_analysis.py, untouched by this module.
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
    Student, BedAssignment, Transfer, StudentRequest,
)

EVIDENCE_DIR = Path(settings.BASE_DIR).parent / 'project-quality' / 'performance' / 'evidence'
# Deliberately a DIFFERENT file from the frozen Phase 1 baseline evidence
# (ANALYSIS_BASELINE_QUERY_COUNTS.txt) - this module now measures the
# optimized (post-fix) code and must never overwrite the historical
# baseline record.
EVIDENCE_FILE = EVIDENCE_DIR / 'GROUP1_ANALYSIS_FINAL_QUERY_COUNTS.txt'

_NUMBER_RE = re.compile(r'\d+')


def _shape(sql):
    """
    Collapse a captured SQL statement's literal numbers so structurally
    identical queries issued for different building/apartment/room/bed pks
    collapse into the same 'shape' - lets us count how many times the
    *same kind* of query ran, not just distinct query strings (which would
    never collapse, since every building has a different pk).
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


def _reset_all():
    """
    Clears everything the fixtures below create, in FK-safe order
    (BedAssignment.bed/.student are PROTECT, so assignments must go before
    the Building tree and before Students; Apartment/Room/Bed cascade from
    Building). Mirrors _reset_inventory() in test_buildings_performance.py.
    """
    BedAssignment.objects.all().delete()
    Student.objects.all().delete()
    Building.objects.all().delete()


def _build_inventory(dorm_type, n_buildings, admin, apartments_per_building=2,
                      rooms_per_apartment=2, beds_per_room=2,
                      start_building_number=1):
    """
    Same per-building shape as test_buildings_performance.py's
    _build_inventory: N buildings, each with apartments_per_building
    apartments, each with rooms_per_apartment rooms, each with
    beds_per_room beds. The first bed of the first room of the first
    apartment of every building gets one ACTIVE BedAssignment (to a fresh
    synthetic student), so occupancy/assigned-beds computation is
    genuinely exercised on every building row, not just counted as zero.
    Building count (N) is the controlled variable; the per-building shape
    underneath is held constant across measurements - matching the
    rationale already used for Buildings/Apartments/Rooms/Beds, so results
    are directly comparable.
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
                        accepted_dorm_type=dorm_type,
                    )
                    BedAssignment.objects.create(
                        student=student, bed=beds[0],
                        status=BedAssignment.Status.ACTIVE, assigned_by=admin,
                    )


def _build_unassigned_students(dorm_type, n_students, prefix):
    """
    Creates n_students Student rows under dorm_type with NO BedAssignment.
    Used only by the second (student-volume) measurement dimension below,
    to isolate the Python-side per-student loop in analysis_data()
    (students_by_region / students_by_region_demand construction, roughly
    views.py:6567-6594 - a single SQL query via select_related(), but O(S)
    Python work per row: region-name resolution + dict bucketing) from the
    per-building SQL-query loop measured by the primary test below. These
    students are deliberately left unassigned so they land in
    unassigned_students / unassigned_by_region without touching
    occupancy_data (which is driven by buildings, not students).
    student_id has max_length=20, so `prefix` must stay short.
    """
    for i in range(n_students):
        Student.objects.create(
            student_id=f'{prefix}-{i}',
            first_name='F', last_name='L', gender='male',
            housing_type=Student.HousingType.SINGLE_MALE,
            accepted_dorm_type=dorm_type,
        )


class AnalysisPerformanceTests(TestCase):
    """
    Post-optimization performance regression test for GET /api/analysis/.

    Phase 2: analysis_data()'s occupancy_data loop now gets
    _capacity/_rooms_count/_assigned_beds via
    views._annotate_analysis_building_occupancy - three correlated
    Subquery annotations computed inside the single buildings_qs query -
    instead of running 3 extra queries per building row. These tests
    assert query count stays FLAT (independent of building count) - the
    inverse of the Phase 1 baseline assertions, which only recorded that
    the OLD code scaled linearly (`31 + 3*N`) without gating on it. If
    this test ever starts failing because query count scales with N
    again, the per-building N+1 regressed and needs to be re-fixed.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._evidence_lines = [
            'Analysis API (GET /api/analysis/) — Group 1 implementation phase FINAL query-count evidence',
            'Generated by backend/api/performance_tests/test_analysis_performance.py',
            'Phase 3 / Group 1: per-building fix (flat 31) + fixed-query cleanup (flat 23) both applied.',
            'Compare against the frozen Phase 1 baseline in ANALYSIS_BASELINE_QUERY_COUNTS.txt '
            '(total_queries = 31 + 3*N there) and the frozen Phase 2 evidence in '
            'ANALYSIS_AFTER_QUERY_COUNTS.txt (flat 31, per-building fix only, cleanup not yet applied).',
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

    def _measure(self, n_buildings, label, extra_unassigned_students=0, student_prefix='UNASSIGNED'):
        _reset_all()
        _build_inventory(self.dorm_type, n_buildings, admin=self.admin)
        if extra_unassigned_students:
            _build_unassigned_students(self.dorm_type, extra_unassigned_students, prefix=student_prefix)

        with CaptureQueriesContext(connection) as ctx:
            start = time.perf_counter()
            resp = self.client.get('/api/analysis/', {'region': self.region.id})
            elapsed_ms = (time.perf_counter() - start) * 1000

        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        rows = data.get('occupancy_data', [])
        self.assertEqual(len(rows), n_buildings)

        summary = _summarize(ctx.captured_queries)
        payload_bytes = len(resp.content)

        lines = [
            f'--- {label}: n_buildings={n_buildings} extra_unassigned_students={extra_unassigned_students} ---',
            f'endpoint: GET /api/analysis/?region={self.region.id}',
            f'user role: central_admin',
            f'occupancy_data_rows_returned: {len(rows)}',
            f'total_sql_queries: {summary["total"]}',
            f'distinct_query_shapes: {summary["distinct_shapes"]}',
            f'server_side_request_time_ms: {elapsed_ms:.2f}',
            f'response_payload_bytes: {payload_bytes}',
            'repeated_query_shapes (occurrence_count x shape, numbers masked as #):',
        ]
        for shape, count in sorted(summary['repeated_shapes'].items(), key=lambda kv: -kv[1]):
            lines.append(f'  x{count}: {shape[:240]}')
        lines.append('')
        type(self)._evidence_lines.extend(lines)
        print('\n'.join(lines))

        return summary['total'], elapsed_ms, payload_bytes, data

    def test_analysis_query_count_scaling_with_building_count(self):
        """
        Core regression check: GET /api/analysis/ must issue essentially
        the same number of SQL queries at N=25 buildings as at N=1 - i.e.
        query count no longer scales with the number of buildings
        returned. Before the Phase 2 fix this test (as
        test_analysis_query_count_scaling_with_building_count, then a
        measurement-only test) measured `total_queries = 31 + 3*N`
        (marginal cost 3.00 queries/building, see
        project-quality/performance/PERFORMANCE_FINAL_REPORT.md); it must now be ~0.
        """
        results = {}
        for n in (1, 5, 25):
            total, ms, payload, _ = self._measure(n, f'N={n} BUILDINGS')
            results[n] = (total, ms, payload)

        q1, q5, q25 = results[1][0], results[5][0], results[25][0]
        marginal_1_5 = (q5 - q1) / (5 - 1)
        marginal_5_25 = (q25 - q5) / (25 - 5)

        summary_lines = [
            '--- SCALING SUMMARY (building count, N=1/5/25, post-optimization) ---',
            f'N=1:  total_queries={q1}  time_ms={results[1][1]:.2f}  bytes={results[1][2]}',
            f'N=5:  total_queries={q5}  time_ms={results[5][1]:.2f}  bytes={results[5][2]}',
            f'N=25: total_queries={q25} time_ms={results[25][1]:.2f}  bytes={results[25][2]}',
            f'marginal_queries_per_additional_building (1->5): {marginal_1_5:.2f}',
            f'marginal_queries_per_additional_building (5->25): {marginal_5_25:.2f}',
            'Phase 1 baseline marginal cost (pre-fix): 3.00 queries/building',
            '',
        ]
        type(self)._evidence_lines.extend(summary_lines)
        print('\n'.join(summary_lines))

        # Query count must no longer scale with N - the defining proof the
        # per-building N+1 fix worked. Loose tolerance (<=0.5) rather than
        # exactly 0 to absorb any incidental per-row cost that isn't
        # query-count-related (there should be none, but this keeps the
        # test robust rather than brittle) - same tolerance already used
        # for the Buildings/Apartments/Rooms/Beds "after" regression
        # tests.
        self.assertLessEqual(marginal_1_5, 0.5)
        self.assertLessEqual(marginal_5_25, 0.5)
        # And query count must stay small in absolute terms too - not
        # just "flat but still huge" - confirming the fix collapsed the
        # N+1 rather than merely moving it somewhere still expensive.
        self.assertLess(q25, 40)

    def test_analysis_single_building_baseline_overhead(self):
        """
        Isolates fixed per-request overhead (auth/permission resolution,
        the dozen-plus summary/distribution aggregate queries that run
        once per request regardless of N) from the per-building multiplier
        measured above.
        """
        total, ms, payload, data = self._measure(1, 'SINGLE BUILDING (N=1)')
        self.assertGreaterEqual(total, 1)
        self.assertIn('summary', data)
        self.assertIn('occupancy_data', data)

    def test_analysis_query_count_independent_of_student_volume(self):
        """
        Second, independently-justified measurement dimension.

        WHY a second dimension is needed here (and only here): unlike the
        Buildings/Apartments/Rooms/Beds endpoints, analysis_data() also
        runs a Python-side loop over every returned Student row
        (`for student in students_qs.select_related(...)`, views.py
        ~6567-6594) to build students_by_region / students_by_region_demand
        - a single SQL query (select_related avoids per-row queries), but
        O(S) Python work per row (region-name resolution via
        _resolve_region_name_from_student_text, dict bucketing). That is a
        DIFFERENT kind of cost (Python CPU time, not SQL query count) from
        the per-building SQL-query loop measured above, so it needs its
        own controlled measurement rather than being assumed to scale the
        same way or ignored.

        Method: building count is held fixed and small (N=5, non-trivial
        but cheap) while student volume varies - S=50 vs S=500 EXTRA
        unassigned students layered on top of the 5 the building fixture
        itself creates. This checks two things independently: (a) query
        count stays flat as S grows tenfold (asserted below - the code
        reads as a single query, so this should hold deterministically),
        and (b) whether server-side time grows measurably with S (reported
        as evidence only, not asserted - wall-clock timing is too noisy on
        a shared dev machine for a hard gate, but the numbers are recorded
        so a real trend, if any, is visible in the evidence file).
        """
        total_s50, ms_s50, payload_s50, _ = self._measure(
            5, 'N=5 BUILDINGS + S=50 EXTRA UNASSIGNED STUDENTS',
            extra_unassigned_students=50, student_prefix='S50U',
        )
        total_s500, ms_s500, payload_s500, _ = self._measure(
            5, 'N=5 BUILDINGS + S=500 EXTRA UNASSIGNED STUDENTS',
            extra_unassigned_students=500, student_prefix='S500U',
        )

        summary_lines = [
            '--- SCALING SUMMARY (student volume, buildings fixed at N=5) ---',
            f'S=50 extra:  total_queries={total_s50}  time_ms={ms_s50:.2f}  bytes={payload_s50}',
            f'S=500 extra: total_queries={total_s500} time_ms={ms_s500:.2f}  bytes={payload_s500}',
            f'query_count_delta (S=50 -> S=500): {total_s500 - total_s50}',
            f'time_ms_delta (S=50 -> S=500): {ms_s500 - ms_s50:.2f}',
            '',
        ]
        type(self)._evidence_lines.extend(summary_lines)
        print('\n'.join(summary_lines))

        # Deterministic and worth asserting: query count must NOT scale
        # with student volume (the students loop is a single query).
        self.assertEqual(total_s500, total_s50)


class AnalysisOccupancyCorrectnessTests(TestCase):
    """
    Correctness protection for the optimized occupancy_data computation
    (views._annotate_analysis_building_occupancy).

    Builds one Building with a deliberately non-trivial mix: an active
    apartment with an active room (one occupied bed, one bed whose
    assignment has ENDED), an *inactive* room holding a bed with a
    still-ACTIVE assignment, and a second, fully *inactive* apartment
    holding an active room with a still-ACTIVE assignment - plus a second,
    completely empty Building (no apartments/rooms/beds at all). This
    exercises every filter analysis_data() applies to rooms_qs/
    assignments_qs, including the fact that (unlike the Buildings-page
    BuildingSerializer.get_occupied_beds) analysis_data()'s
    assignments_qs DOES filter by bed__room__is_active AND
    bed__room__apartment__is_active - so an ACTIVE assignment on a bed in
    an inactive room/apartment must NOT count here, which the optimization
    must reproduce exactly, not "fix" as a side effect.
    """

    def setUp(self):
        self.region = Region.objects.create(id='perf-corr-region', name='Perf Correctness Region')
        self.dorm_type = DormType.objects.create(code=950, name='PerfCorrDormType', region=self.region)
        self.admin = _make_user('perf-corr-admin@test.com', User.Role.CENTRAL_ADMIN)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

        self.building = Building.objects.create(number=700, dorm_type=self.dorm_type)

        # Apartment A1: active - holds the "normal" active room plus the
        # edge-case inactive room with a still-active assignment.
        apartment_active = Apartment.objects.create(
            building=self.building, number='A1', category=Apartment.Category.MIXED,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=2, is_active=True,
        )
        room_active = Room.objects.create(apartment=apartment_active, name='R1', capacity=2, is_active=True)
        bed_occupied = Bed.objects.create(room=room_active, label='B1')
        bed_ended = Bed.objects.create(room=room_active, label='B2')

        room_inactive = Room.objects.create(apartment=apartment_active, name='R2', capacity=5, is_active=False)
        bed_in_inactive_room = Bed.objects.create(room=room_inactive, label='B3')

        # Apartment A2: inactive - nothing under it should count anywhere,
        # even though its room and assignment are both individually active.
        apartment_inactive = Apartment.objects.create(
            building=self.building, number='A2', category=Apartment.Category.MIXED,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=1, is_active=False,
        )
        room_under_inactive_apartment = Room.objects.create(
            apartment=apartment_inactive, name='R3', capacity=3, is_active=True,
        )
        bed_under_inactive_apartment = Bed.objects.create(room=room_under_inactive_apartment, label='B4')

        def _student(sid):
            return Student.objects.create(
                student_id=sid, first_name='F', last_name='L', gender='male',
                housing_type=Student.HousingType.SINGLE_MALE,
                accepted_dorm_type=self.dorm_type,
            )

        BedAssignment.objects.create(
            student=_student('CORR-1'), bed=bed_occupied,
            status=BedAssignment.Status.ACTIVE, assigned_by=self.admin,
        )
        # An ENDED assignment must NOT count as assigned.
        ended = BedAssignment.objects.create(
            student=_student('CORR-2'), bed=bed_ended,
            status=BedAssignment.Status.ACTIVE, assigned_by=self.admin,
        )
        ended.status = BedAssignment.Status.ENDED
        ended.ended_at = timezone.now()
        ended.save(update_fields=['status', 'ended_at'])
        # ACTIVE assignment on a bed in an INACTIVE room - analysis_data()'s
        # assignments_qs filters bed__room__is_active=True, so this must
        # NOT count (unlike the Buildings-page asymmetry).
        BedAssignment.objects.create(
            student=_student('CORR-3'), bed=bed_in_inactive_room,
            status=BedAssignment.Status.ACTIVE, assigned_by=self.admin,
        )
        # ACTIVE assignment on a bed under an INACTIVE apartment - must
        # also NOT count (bed__room__apartment__is_active=True filter).
        BedAssignment.objects.create(
            student=_student('CORR-4'), bed=bed_under_inactive_apartment,
            status=BedAssignment.Status.ACTIVE, assigned_by=self.admin,
        )

        # Second building: zero apartments/rooms/beds at all - exercises
        # the Coalesce(...,0) NULL-subquery fallback path directly (no
        # rows exist to aggregate over for capacity/rooms_count/
        # assigned_beds).
        self.empty_building = Building.objects.create(number=701, dorm_type=self.dorm_type)

    def _get_occupancy_row(self, building_id):
        resp = self.client.get('/api/analysis/', {'region': self.region.id})
        self.assertEqual(resp.status_code, 200, resp.content)
        rows = resp.json()['occupancy_data']
        return next(r for r in rows if r['building_id'] == building_id)

    def _original_values(self, building):
        """
        Re-runs the EXACT original (pre-optimization) per-building query
        logic directly against the DB, scoped to one building via the same
        filters analysis_data() used before this phase's change - ground
        truth to compare the now-annotated endpoint against.
        """
        rooms_qs = Room.objects.filter(
            is_active=True,
            apartment__is_active=True,
            apartment__building__is_active=True,
            apartment__building=building,
        )
        assignments_qs = BedAssignment.objects.filter(
            status=BedAssignment.Status.ACTIVE,
            bed__room__is_active=True,
            bed__room__apartment__is_active=True,
            bed__room__apartment__building__is_active=True,
            bed__room__apartment__building=building,
        )
        capacity = sum(rooms_qs.values_list('capacity', flat=True))
        assigned = assignments_qs.values('bed_id').distinct().count()
        rooms_count = rooms_qs.count()
        return capacity, assigned, rooms_count

    def test_occupancy_values_match_hand_computed_expected_values(self):
        """
        Hand-computed expected values for the fixture above:
        - rooms_count = 1 (R1 only; R2 is inactive, R3's apartment A2 is inactive)
        - total_beds (capacity) = 2 (R1's capacity only)
        - assigned = 1 (B1's ACTIVE assignment only; B2 ended, B3 is in an
          inactive room, B4 is under an inactive apartment - all excluded)
        - available_beds = max(2 - 1, 0) = 1
        - occupancy_rate = round((1 / 2) * 100, 2) = 50.0
        """
        row = self._get_occupancy_row(self.building.id)
        self.assertEqual(row['rooms_count'], 1)
        self.assertEqual(row['total_beds'], 2)
        self.assertEqual(row['assigned'], 1)
        self.assertEqual(row['available_beds'], 1)
        self.assertEqual(row['occupancy_rate'], 50.0)

    def test_occupancy_values_match_original_unannotated_queries(self):
        """
        Ground-truth cross-check: the live endpoint (now backed by
        annotated subqueries) must produce byte-for-byte identical numbers
        to the original, unoptimized per-building query logic, for the
        same DB state - this is what proves the optimization changed *how
        many queries run*, not *what the answer is*.
        """
        expected_capacity, expected_assigned, expected_rooms_count = self._original_values(self.building)
        row = self._get_occupancy_row(self.building.id)

        self.assertEqual(row['total_beds'], expected_capacity)
        self.assertEqual(row['assigned'], expected_assigned)
        self.assertEqual(row['rooms_count'], expected_rooms_count)

        expected_available = max(expected_capacity - expected_assigned, 0)
        self.assertEqual(row['available_beds'], expected_available)

        expected_rate = round((expected_assigned / expected_capacity) * 100, 2) if expected_capacity > 0 else 0
        self.assertEqual(row['occupancy_rate'], expected_rate)

    def test_building_with_zero_inventory_returns_zeroes_not_none(self):
        """
        A building with no apartments/rooms/beds at all must fall back to
        rooms_count=total_beds=assigned=available_beds=occupancy_rate=0
        (the Coalesce(...,0) path, since the correlated subqueries produce
        no rows to aggregate for this building's pk) - not None, and not a
        crash - matching the original sum()/count() behavior, which always
        returns 0 for an empty queryset, never None.
        """
        row = self._get_occupancy_row(self.empty_building.id)
        self.assertEqual(row['rooms_count'], 0)
        self.assertEqual(row['total_beds'], 0)
        self.assertEqual(row['assigned'], 0)
        self.assertEqual(row['available_beds'], 0)
        self.assertEqual(row['occupancy_rate'], 0)


class Group1FixedQueryConsolidationTests(TestCase):
    """
    Group 1 implementation phase: correctness + stress-scale validation
    for the 4 consolidations made to analysis_data()'s previously-flat-31
    fixed query base
    (project-quality/performance/PERFORMANCE_FINAL_REPORT.md).
    Query count is now flat 23 - see AnalysisPerformanceTests above for
    the scaling proof; this class proves the CONSOLIDATED VALUES are
    still correct, including at a synthetic scale (2,000 active
    BedAssignments) large enough to matter for the one consolidation that
    trades DB aggregation for a Python-side fetch (assigned_students/
    assigned_student_ids/assigned_beds), per the explicit instruction to
    validate that specific change at meaningful scale before keeping it.
    """

    def setUp(self):
        self.region = Region.objects.create(id='perf-g1-region', name='Perf Group1 Region')
        self.dorm_type = DormType.objects.create(code=955, name='PerfG1DormType', region=self.region)
        self.admin = _make_user('perf-g1-admin@test.com', User.Role.CENTRAL_ADMIN)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_summary_numbers_match_original_computation_at_small_scale(self):
        """
        Hand-computable fixture exercising every consolidated value:
        total_capacity/total_rooms (now a single DB aggregate()),
        assigned_students/assigned_beds (now a single Python set
        derivation), total_buildings/active_buildings/inactive_buildings
        (dead-code elimination - the region-scoped branch), and
        total_transfers/pending_transfers/pending_requests (now derived
        from transfers_by_status/pending_requests_by_type instead of
        separate .count() queries).
        """
        building = Building.objects.create(number=1, dorm_type=self.dorm_type)
        Building.objects.create(number=2, dorm_type=self.dorm_type, is_active=False)
        apartment = Apartment.objects.create(
            building=building, number='1', category=Apartment.Category.MIXED,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=3,
        )
        room1 = Room.objects.create(apartment=apartment, name='1', capacity=2)
        room2 = Room.objects.create(apartment=apartment, name='2', capacity=3)
        room3 = Room.objects.create(apartment=apartment, name='3', capacity=1)
        beds = (
            [Bed.objects.create(room=room1, label=f'B{i}') for i in range(2)]
            + [Bed.objects.create(room=room2, label=f'B{i + 2}') for i in range(3)]
        )
        students = []
        for i in range(3):
            s = Student.objects.create(
                student_id=f'G1SUM-{i}', first_name='F', last_name='L', gender='male',
                housing_type=Student.HousingType.SINGLE_MALE, accepted_dorm_type=self.dorm_type,
            )
            students.append(s)
            BedAssignment.objects.create(
                student=s, bed=beds[i], status=BedAssignment.Status.ACTIVE, assigned_by=self.admin,
            )

        Transfer.objects.create(
            student=students[0], from_room=room1, to_room=room2,
            status=Transfer.Status.PENDING, requested_by=self.admin,
        )
        Transfer.objects.create(
            student=students[1], from_room=room1, to_room=room3,
            status=Transfer.Status.PENDING, requested_by=self.admin,
        )
        Transfer.objects.create(
            student=students[2], from_room=room2, to_room=room3,
            status=Transfer.Status.APPROVED, requested_by=self.admin,
            reviewed_by=self.admin, reviewed_at=timezone.now(),
        )

        StudentRequest.objects.create(
            request_type=StudentRequest.RequestType.OTHER, reason='r1',
            requested_by=self.admin, student=students[0],
        )
        StudentRequest.objects.create(
            request_type=StudentRequest.RequestType.OTHER, reason='r2',
            requested_by=self.admin, student=students[1],
        )

        resp = self.client.get('/api/analysis/', {'region': self.region.id})
        self.assertEqual(resp.status_code, 200, resp.content)
        summary = resp.json()['summary']

        self.assertEqual(summary['total_capacity'], 6)  # room1(2) + room2(3) + room3(1)
        self.assertEqual(summary['total_rooms'], 3)
        self.assertEqual(summary['assigned_students'], 3)
        self.assertEqual(summary['assigned_beds'], 3)
        self.assertEqual(summary['active_buildings'], 1)
        self.assertEqual(summary['total_buildings'], 2)
        self.assertEqual(summary['inactive_buildings'], 1)
        self.assertEqual(summary['total_transfers'], 3)
        self.assertEqual(summary['pending_transfers'], 2)
        self.assertEqual(summary['pending_requests'], 2)

    def test_assigned_students_and_beds_correct_and_performant_at_2000_assignments(self):
        """
        Stress-scale validation specifically for the assignments
        consolidation - the one change trading 2 DB-side COUNT DISTINCT
        queries for a single Python-side fetch of (student_id, bed_id)
        pairs. 2,000 active BedAssignments in one region; asserts (a) the
        returned counts are exactly 2,000 (no off-by-one/dedup bug at
        scale), (b) they match the ORIGINAL pre-consolidation query logic
        run directly against the same data, and (c) server-side time
        stays well within a generous ceiling (not a regression into
        "obviously worse" territory).
        """
        building = Building.objects.create(number=100, dorm_type=self.dorm_type)
        apartment = Apartment.objects.create(
            building=building, number='1', category=Apartment.Category.MIXED,
            apartment_type=Apartment.ApartmentType.SINGLE, room_count=1,
        )
        room = Room.objects.create(apartment=apartment, name='1', capacity=2000)
        n = 2000
        for i in range(n):
            bed = Bed.objects.create(room=room, label=f'StressBed{i}')
            student = Student.objects.create(
                student_id=f'STRESS-{i}', first_name='F', last_name='L', gender='male',
                housing_type=Student.HousingType.SINGLE_MALE, accepted_dorm_type=self.dorm_type,
            )
            BedAssignment.objects.create(
                student=student, bed=bed, status=BedAssignment.Status.ACTIVE, assigned_by=self.admin,
            )

        with CaptureQueriesContext(connection) as ctx:
            start = time.perf_counter()
            resp = self.client.get('/api/analysis/', {'region': self.region.id})
            elapsed_ms = (time.perf_counter() - start) * 1000

        self.assertEqual(resp.status_code, 200, resp.content)
        summary = resp.json()['summary']
        self.assertEqual(summary['assigned_students'], n)
        self.assertEqual(summary['assigned_beds'], n)

        # Ground truth: the exact original (pre-consolidation) query logic,
        # run directly against the same data.
        assignments_qs = BedAssignment.objects.filter(
            status=BedAssignment.Status.ACTIVE,
            bed__room__is_active=True,
            bed__room__apartment__is_active=True,
            bed__room__apartment__building__is_active=True,
            bed__room__apartment__building__dorm_type__region=self.region,
        )
        self.assertEqual(summary['assigned_students'], assignments_qs.values('student_id').distinct().count())
        self.assertEqual(summary['assigned_beds'], assignments_qs.values('bed_id').distinct().count())

        print(f'=== STRESS SCALE (N={n} assignments) === '
              f'total_queries={len(ctx.captured_queries)} time_ms={elapsed_ms:.2f}')
        # Not asserting an exact query count here - AnalysisPerformanceTests
        # already proves flatness; this test's purpose is value correctness
        # and that performance does not fall over at 2,000 rows, per the
        # instruction to validate this specific consolidation at scale
        # before keeping it, not to re-benchmark query count.
        self.assertLess(elapsed_ms, 5000)
