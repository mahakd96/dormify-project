# Apartments API Optimization Summary

Prepared for external AI review. Self-contained record of the BLD-02
implementation phase of the Dormify Apartments-API performance work.
Follows the BLD-02 baseline measurement (`APARTMENTS_BASELINE_SUMMARY.md`)
and directly mirrors the pattern that closed BLD-01 for Buildings
(`BUILDINGS_OPTIMIZATION_SUMMARY.md`).

## Scope

Narrow fix for finding **BLD-02 only**: the `ApartmentSerializer` N+1
pattern behind `GET /api/apartments/`. Explicitly **not** touched: the
already-closed Buildings/BLD-01 implementation, Rooms, Beds, Analysis,
Students, Transfers, pagination, frontend React code, Docker
configuration, Azure configuration, `.env`/`.env.test`, database schema,
migrations, or the allocation algorithm.

**Branch:** `donia-performance-optimization`

## Baseline

From the BLD-02 baseline measurement (`APARTMENTS_BASELINE_SUMMARY.md`),
measured against a local disposable PostgreSQL 16 test database (never the
real Azure DB):

| N (apartments) | SQL queries |
|---:|---:|
| 1  | 6   |
| 5  | 26  |
| 25 | 126 |

`total_queries = 1 + 5 × N` — linear scaling, marginal cost 5.00
queries/apartment, empirically confirmed via `CaptureQueriesContext`.

## Root Cause

`backend/api/serializers.py:480-492` (pre-fix) —
`ApartmentSerializer.get_actual_room_count`, `.get_bed_count`,
`.get_occupied_beds` were each a `SerializerMethodField` running an
independent DB query per `Apartment` row (none of it coverable by the
queryset's `select_related`, since these are reverse-relation aggregate
counts, not forward FK lookups). `.get_free_beds` additionally called
`.get_bed_count()`/`.get_occupied_beds()` a second time internally,
duplicating two of those three queries — the identical shape of N+1
already fixed for BLD-01 (`BuildingSerializer`).

## Implementation

### `backend/api/views.py`

- **Function:** new module-level helper
  `_annotate_apartment_inventory_counts(queryset)`, placed immediately
  before `ApartmentViewSet`.
- **Before:** no such function existed; `ApartmentViewSet.get_queryset()`
  returned a plain `Apartment.objects.select_related('building',
  'building__dorm_type', 'building__dorm_type__region')` queryset, with
  all counts computed later, per row, by the serializer.
- **After:** the helper annotates three new fields — `_actual_room_count`,
  `_bed_count`, `_occupied_beds` — onto any `Apartment` queryset, each via
  `Coalesce(Subquery(<correlated count-per-apartment subquery>,
  output_field=IntegerField()), 0)`. Every subquery is built as
  `Model.objects.filter(<fk path>=OuterRef('pk'), <same filters as the
  original per-row query>).order_by().values(<group field>).annotate(c=Count(...)).values('c')`
  — i.e. **one independent correlated subquery per count**, not three
  `Count()` annotations combined in a single `annotate()` call.
  `ApartmentViewSet.get_queryset()` now calls this helper on the base
  queryset before its existing `is_active`/`building`/region filters run;
  nothing else in `get_queryset()`, `create()`, or `update()` changed. No
  new imports were required — `OuterRef`, `Subquery`, `IntegerField`,
  `Coalesce`, and `Count` were already imported in this file from the
  BLD-01 fix.
- **Why this fixes the N+1:** the three counts are now computed as scalar
  subquery expressions inside the *same* SQL statement Django already
  issues for the apartment list/detail query, instead of as separate
  Python-level queries issued once per row after the fact.
- **Why subqueries, not a single multi-`Count()` `annotate()` call:** same
  reasoning as BLD-01 — combining several `Count()` annotations across
  different joined relations (rooms, beds, bed-assignments) in one
  `annotate()` call risks join fan-out multiplying/inflating every count.
  Three independent, separately-grouped correlated subqueries sidestep
  this entirely.

### `backend/api/serializers.py`

- **Class/methods:** `ApartmentSerializer.get_actual_room_count`,
  `.get_bed_count`, `.get_occupied_beds`.
- **Before:** each ran its query unconditionally, every time, for every
  object.
- **After:** each first checks `getattr(obj, '_<name>', None)`. If the
  object came from the now-annotated `get_queryset()` (the normal case for
  list/retrieve/update), the annotated value is returned directly — **zero
  extra queries**. If the attribute is absent (only true for a
  freshly-`POST`-created `Apartment`, serialized straight from
  `serializer.save()`), each method falls back to running the **original,
  unmodified per-object query**.
- **`get_free_beds`:** left as `max(self.get_bed_count(obj) -
  self.get_occupied_beds(obj), 0)`, unchanged. Because the two calls it
  makes are now attribute reads (not queries) in the common case, the
  original duplicated-query problem inside `get_free_beds` disappears as a
  direct consequence.

No other file was changed.

## Correctness Protection

Each optimized value's filter logic matches the original query, field for
field:

| Field | Original filter | New subquery filter | Match? |
|---|---|---|---|
| `actual_room_count` | `obj.rooms.filter(is_active=True)` | `Room.filter(apartment=OuterRef('pk'), is_active=True)` | Identical |
| `bed_count` | `Bed.filter(room__apartment=obj, room__is_active=True)` | `Bed.filter(room__apartment=OuterRef('pk'), room__is_active=True)` | Identical |
| `occupied_beds` | `BedAssignment.filter(bed__room__apartment=obj, status=ACTIVE).values('bed_id').distinct().count()` | `BedAssignment.filter(bed__room__apartment=OuterRef('pk'), status=ACTIVE)` grouped, `Count('bed_id', distinct=True)` | Identical, including **not** filtering by room `is_active` (preserves the original asymmetry) |
| `free_beds` | `max(bed_count - occupied_beds, 0)` | unchanged formula | Identical |

**How this was verified, not just asserted:**

1. **Empirical cross-check against the original code.** New test
   `ApartmentCountCorrectnessTests.test_apartment_counts_match_original_unannotated_queries`
   (`backend/api/performance_tests/test_apartments_performance.py`) builds
   one fixture with:
   - an active room → one bed with an **ACTIVE** assignment (occupied),
     one bed with an assignment that has since transitioned to **ENDED**
     (must not count as occupied),
   - an **inactive** room → one bed with an **ACTIVE** assignment (the
     asymmetry edge case: occupied but excluded from `bed_count`/
     `actual_room_count` since the room is inactive).

   The test re-runs the *exact original* (pre-optimization) query
   expressions directly against the database inside the test itself, and
   asserts the live `GET /api/apartments/` response's
   `actual_room_count`/`bed_count`/`occupied_beds`/`free_beds` equal those
   freshly-recomputed original values, field by field.

2. **Hand-computed expected values.** A second test,
   `test_apartment_counts_match_expected_values`, asserts the same fixture
   against numbers computed by hand: `actual_room_count=1, bed_count=2,
   occupied_beds=2, free_beds=0`.

3. **Fallback-path coverage.** `test_freshly_created_apartment_falls_back_correctly`
   asserts `POST /api/apartments/` (which serializes an unannotated
   instance) still returns all four counts as `0` for a brand-new
   apartment.

4. **Bulk spot-check at every measured N.** `ApartmentsListPerformanceTests._measure`
   now additionally asserts every apartment returned at N=1, 5, and 25
   shows the exact known fixture values (`actual_room_count=3,
   bed_count=6, occupied_beds=1, free_beds=5`) — correctness is checked at
   the same time as, not separately from, the performance measurement.

5. **Permissions / region isolation / API contract.** None of
   `get_queryset()`'s existing `is_active`/`building`/region/role
   filtering, `create()`, or `update()` logic was touched — only wrapped
   with an additional `.annotate()` call before the pre-existing filters
   run. `ApartmentSerializer.Meta.fields` (names, order) is unchanged, and
   every field still returns the same Python `int` type as before.
   Verified by running the full pre-existing `backend/api/tests_inventory.py`
   suite — **41/41 passed, unchanged**, both before and after this change.
   The already-closed BLD-01 (Buildings) fix was also re-run
   (`test_buildings_performance`) and confirmed still flat at 2
   queries/request — unaffected, even though both viewsets live in the
   same `backend/api/views.py` file.

## Before vs After Measurements

| N (apartments) | SQL queries before | SQL queries after | Response time before (ms) | Response time after (ms) | Response size before (bytes) | Response size after (bytes) |
|---:|---:|---:|---:|---:|---:|---:|
| 1  | 6   | 1 | ~11–21   | ~20  | 470    | 470    |
| 5  | 26  | 1 | ~53–79   | ~8   | 2,341  | 2,341  |
| 25 | 126 | 1 | ~235–339 | ~14  | 11,738 | 11,742 |

- **Absolute query reduction:** 5 (N=1), 25 (N=5), 125 (N=25).
- **Percentage query reduction:** 83.3% (N=1), 96.2% (N=5), **99.2%**
  (N=25).
- The 4-byte size difference at N=25 is expected noise between two
  independent test-database runs assigning different auto-increment
  primary keys to synthetic rows — not a value discrepancy; the
  correctness tests above compare field values within a single, shared DB
  state and match exactly.
- Timing is server-side only (DRF `APIClient`, no real network/Azure hop)
  — directional evidence of the fix's effect, not a production latency
  claim.

## Query Scaling

**Before:** `total_queries = 1 + 5 × N` — linear, unbounded with apartment
count.

**After:** `total_queries = 1` at N = 1, 5, **and** 25 — **flat, fully
independent of N**. Query count for `GET /api/apartments/` no longer
scales with the number of apartments returned; the marginal cost measured
directly is 0.00 queries/apartment (down from 5.00).

## Tests Run

| Command | Result |
|---|---|
| `cd backend && ENV_FILE=.env.test python manage.py check` | System check identified no issues (0 silenced) |
| `ENV_FILE=.env.test python manage.py test api.performance_tests.test_apartments_performance -v 2` | **5/5 passed**: `test_apartment_counts_match_expected_values`, `test_apartment_counts_match_original_unannotated_queries`, `test_freshly_created_apartment_falls_back_correctly`, `test_apartments_list_query_count_is_flat_after_optimization`, `test_apartments_list_single_apartment_baseline_overhead` |
| `ENV_FILE=.env.test python manage.py test api.tests_inventory -v 1` | **41/41 passed**, unchanged from pre-optimization run |
| `ENV_FILE=.env.test python manage.py test api.performance_tests.test_buildings_performance -v 1` (sanity re-check) | **5/5 passed** — BLD-01 confirmed still flat at 2 queries/request, unaffected |

All runs against the same local disposable `test_db` Docker container used
for the BLD-01/BLD-02 baselines. The real Azure production database was
never connected to.

## Files Changed

**Production application files (2):**
- `backend/api/views.py` — added `_annotate_apartment_inventory_counts()`
  helper; `ApartmentViewSet.get_queryset()` now wraps its base queryset in
  that helper. No new imports needed.
- `backend/api/serializers.py` — `ApartmentSerializer`'s three count
  getters now read the annotation first, with the original query as
  fallback.

**Performance tests (1):**
- `backend/api/performance_tests/test_apartments_performance.py` —
  scaling test updated to assert flat (not linear) query count, writes to
  a new evidence file; added `ApartmentCountCorrectnessTests` (3 tests);
  `_measure` now also asserts per-row field correctness.

**Documentation / evidence (4, all new — nothing pre-existing overwritten):**
- `project-quality/performance/evidence/APARTMENTS_AFTER_QUERY_COUNTS.txt`
- `project-quality/performance/evidence/APARTMENTS_AFTER_TEST_RUN_LOG.txt`
- `project-quality/performance/PERFORMANCE_OPTIMIZATION_RESULTS.md` (new "BLD-02 — Apartments API Optimization Result" section appended; earlier sections left untouched)
- `project-quality/performance/APARTMENTS_OPTIMIZATION_SUMMARY.md` (this file)

The BLD-02 baseline evidence files
(`APARTMENTS_BASELINE_QUERY_COUNTS.txt`, `APARTMENTS_BASELINE_TEST_RUN_LOG.txt`)
were **not modified**.

## Remaining Risks / Limitations

- Only `GET /api/apartments/` was optimized. `RoomSerializer`/`Room` model
  properties (BLD-03) and `BedSerializer.is_occupied` (BLD-04) are
  unchanged and still carry their original per-row query patterns —
  selecting a room on the Buildings page still triggers those N+1
  patterns via `getRooms`/`getBeds`.
- No pagination was added (BLD-05 unchanged) — response payload size will
  still grow with total apartment count in a building; only the
  query-count multiplier was removed.
- Server-side-only timing (no real HTTP/network/Azure measurement).
- Synthetic test data only; real production data volume/shape not
  measured in this phase.
- Same `Coalesce(..., 0)` dependency noted for BLD-01: the
  `getattr(obj, '_actual_room_count', None) is not None` fallback check
  relies on the annotated value never legitimately being `None`, enforced
  by wrapping every subquery in `Coalesce`. If a future edit to
  `_annotate_apartment_inventory_counts` ever dropped that `Coalesce`, the
  fallback logic would still be correct (just slower more often), not
  wrong — worth knowing for anyone editing that helper later.

## Recommendation

**BLD-02 is resolved** for `GET /api/apartments/`: query count is now flat
and independent of apartment count (down from `1 + 5N` to `1`, a 99.2%
reduction at N=25), with correctness verified against the original query
logic (not just hand-picked expected values) and zero measured change to
permissions, region isolation, business rules, or API response shape. The
already-closed BLD-01 fix was independently confirmed unaffected by this
change.

No further work is required to close BLD-02 specifically. The remaining
Buildings-page N+1 findings (BLD-03 Rooms, BLD-04 Beds, BLD-05 pagination)
remain open and unaddressed, as intended — out of scope for this phase.