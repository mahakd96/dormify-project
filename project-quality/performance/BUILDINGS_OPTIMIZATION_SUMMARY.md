# Buildings API Optimization Summary

Prepared for external AI review. Self-contained record of Phase 3
(implementation) of the Dormify Buildings-API performance work. Follows
Phase 1 (code inspection — `PERFORMANCE_INSPECTION_SUMMARY.md`) and Phase
2 (baseline measurement — `BUILDINGS_BASELINE_SUMMARY.md`).

## Scope

Narrow fix for finding **BLD-01 only**: the `BuildingSerializer` N+1
pattern behind `GET /api/buildings/`. Explicitly **not** touched:
Apartments, Rooms, Beds, Analysis, Students, Transfers, pagination,
frontend React code, Docker configuration, `.env`/`.env.test`, database
schema, migrations, or the allocation algorithm.

**Branch:** `donia-performance-optimization`

## Baseline

From Phase 2 (`BUILDINGS_BASELINE_SUMMARY.md`), measured against a local
disposable PostgreSQL 16 test database (never the real Azure DB):

| N (buildings) | SQL queries |
|---:|---:|
| 1  | 8   |
| 5  | 32  |
| 25 | 152 |

`total_queries = 2 + 6 × N` — linear scaling, marginal cost 6.00
queries/building, empirically confirmed via `CaptureQueriesContext`.

## Root Cause

`backend/api/serializers.py:363-412` (pre-fix) —
`BuildingSerializer.get_apartment_count`, `.get_room_count`,
`.get_bed_count`, `.get_occupied_beds` were each a `SerializerMethodField`
running an independent DB query per `Building` row (none of it coverable
by the queryset's `select_related`, since these are reverse-relation
aggregate counts, not forward FK lookups). `.get_free_beds` additionally
called `.get_bed_count()`/`.get_occupied_beds()` a second time internally,
duplicating two of those four queries.

## Implementation

### `backend/api/views.py`

- **Function:** new module-level helper `_annotate_building_inventory_counts(queryset)`,
  placed immediately before `BuildingViewSet`.
- **Before:** no such function existed; `BuildingViewSet.get_queryset()`
  returned a plain `Building.objects.select_related('dorm_type',
  'dorm_type__region')` queryset, with all counts computed later, per row,
  by the serializer.
- **After:** the helper annotates four new fields —
  `_apartment_count`, `_room_count`, `_bed_count`, `_occupied_beds` — onto
  any `Building` queryset, each via `Coalesce(Subquery(<correlated
  count-per-building subquery>, output_field=IntegerField()), 0)`. Every
  subquery is built as `Model.objects.filter(<fk path>=OuterRef('pk'),
  <same filters as the original per-row query>).order_by().values(<group
  field>).annotate(c=Count(...)).values('c')` — i.e. **one independent
  correlated subquery per count**, not four `Count()` annotations combined
  in a single `annotate()` call. `BuildingViewSet.get_queryset()` now calls
  this helper on the base queryset before its existing `is_active`/region
  filters run; nothing else in `get_queryset()`, `create()`, or `update()`
  changed.
- **Why this fixes the N+1:** the four counts are now computed as scalar
  subquery expressions inside the *same* SQL statement Django already
  issues for the building list/detail query, instead of as separate
  Python-level queries issued once per row after the fact. Query count
  becomes independent of `N`.
- **Why subqueries, not a single multi-`Count()` `annotate()` call:**
  combining several `Count()` annotations across different joined relations
  (apartments, rooms, beds, bed-assignments) in one `annotate()` call is a
  well-known Django trap — the joins fan out against each other and can
  silently multiply/inflate every count by the size of the other relations
  involved. Four independent, separately-grouped correlated subqueries
  sidestep this entirely: each is evaluated as its own self-contained
  aggregate per building, with no shared join to fan out across.

### `backend/api/serializers.py`

- **Class/methods:** `BuildingSerializer.get_apartment_count`,
  `.get_room_count`, `.get_bed_count`, `.get_occupied_beds`.
- **Before:** each ran its query unconditionally, every time, for every
  object.
- **After:** each first checks `getattr(obj, '_<name>', None)`. If the
  object came from the now-annotated `get_queryset()` (the normal case for
  list/retrieve/update), the annotated value is returned directly — **zero
  extra queries**. If the attribute is absent (only true for a
  freshly-`POST`-created `Building`, serialized straight from
  `serializer.save()` rather than re-fetched through `get_queryset()`),
  each method falls back to running the **original, unmodified per-object
  query** — so that one remaining case is provably correct by construction
  (it's literally the old code, untouched, not a new implementation).
- **`get_free_beds`:** left as `max(self.get_bed_count(obj) -
  self.get_occupied_beds(obj), 0)`, unchanged. Because the two calls it
  makes are now attribute reads (not queries) in the common case, the
  original duplicated-query problem inside `get_free_beds` disappears as a
  direct consequence, with no separate code path needed for it.

No other file was changed.

## Correctness Protection

Each optimized value's filter logic was written to match the original
query, field for field:

| Field | Original filter | New subquery filter | Match? |
|---|---|---|---|
| `apartment_count` | `apartments.filter(is_active=True)` | `Apartment.filter(building=OuterRef('pk'), is_active=True)` | Identical |
| `room_count` | `Room.filter(apartment__building=obj, is_active=True, apartment__is_active=True)` | `Room.filter(apartment__building=OuterRef('pk'), is_active=True, apartment__is_active=True)` | Identical |
| `bed_count` | `Bed.filter(room__apartment__building=obj, room__is_active=True, room__apartment__is_active=True)` | `Bed.filter(room__apartment__building=OuterRef('pk'), room__is_active=True, room__apartment__is_active=True)` | Identical |
| `occupied_beds` | `BedAssignment.filter(bed__room__apartment__building=obj, status=ACTIVE).values('bed_id').distinct().count()` | `BedAssignment.filter(bed__room__apartment__building=OuterRef('pk'), status=ACTIVE)` grouped, `Count('bed_id', distinct=True)` | Identical, including **not** filtering by room/apartment `is_active` (preserves the original asymmetry) |
| `free_beds` | `max(bed_count - occupied_beds, 0)` | unchanged formula | Identical |

**How this was verified, not just asserted:**

1. **Empirical cross-check against the original code.** New test
   `BuildingCountCorrectnessTests.test_building_counts_match_original_unannotated_queries`
   (`backend/api/performance_tests/test_buildings_performance.py`) builds
   one fixture with:
   - an active apartment → active room → one bed with an **ACTIVE**
     assignment (occupied), one bed with an assignment that has since
     transitioned to **ENDED** (must not count as occupied),
   - the same active apartment → an **inactive** room → one bed with an
     **ACTIVE** assignment (the asymmetry edge case: occupied but excluded
     from `bed_count`/`room_count` since the room is inactive),
   - a second, fully **inactive** apartment → active room → bed (nothing
     under it should count anywhere).

   The test then re-runs the *exact original* (pre-optimization) query
   expressions directly against the database inside the test itself, and
   asserts the live `GET /api/buildings/` response's
   `apartment_count`/`room_count`/`bed_count`/`occupied_beds`/`free_beds`
   equal those freshly-recomputed original values, field by field. **This
   is the strongest form of correctness proof available short of a formal
   proof** — it doesn't just re-check hand-picked expected numbers, it
   re-derives the answer with the original logic every time the test runs.

2. **Hand-computed expected values.** A second test,
   `test_building_counts_match_expected_values`, asserts the same fixture
   against numbers computed by hand from the fixture description:
   `apartment_count=1, room_count=1, bed_count=2, occupied_beds=2,
   free_beds=0`.

3. **Fallback-path coverage.** `test_freshly_created_building_falls_back_correctly`
   asserts `POST /api/buildings/` (which serializes an unannotated
   instance) still returns all five counts as `0` for a brand-new
   building.

4. **Permissions / region isolation / API contract.** None of
   `get_queryset()`'s existing `is_active`/region/role filtering, `create()`,
   or `update()` logic was touched — only wrapped with an additional
   `.annotate()` call before the pre-existing filters run.
   `BuildingSerializer.Meta.fields` (names, order) is unchanged, and every
   field still returns the same Python `int` type as before. Verified by
   running the full pre-existing `backend/api/tests_inventory.py` suite
   (permissions, region scoping, availability workflow, occupancy-conflict
   checks, bulk creation) — **41/41 passed, unchanged**, both before and
   after this change.

## Before vs After Measurements

| N (buildings) | SQL queries before | SQL queries after | Response time before (ms) | Response time after (ms) | Response size before (bytes) | Response size after (bytes) |
|---:|---:|---:|---:|---:|---:|---:|
| 1  | 8   | 2 | ~14–15   | ~7  | 294   | 294   |
| 5  | 32  | 2 | ~59–72   | ~8  | 1,461 | 1,461 |
| 25 | 152 | 2 | ~240–270 | ~12 | 7,338 | 7,342 |

- **Absolute query reduction:** 6 (N=1), 30 (N=5), 150 (N=25).
- **Percentage query reduction:** 75.0% (N=1), 93.75% (N=5), **98.7%**
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

**Before:** `total_queries = 2 + 6 × N` — linear, unbounded with building
count.

**After:** `total_queries = 2` at N = 1, 5, **and** 25 — **flat, fully
independent of N**. Query count for `GET /api/buildings/` no longer scales
with the number of buildings returned; the marginal cost measured directly
is 0.00 queries/building (down from 6.00).

## Tests Run

| Command | Result |
|---|---|
| `cd backend && ENV_FILE=.env.test python manage.py check` | System check identified no issues (0 silenced) |
| `ENV_FILE=.env.test python manage.py test api.performance_tests.test_buildings_performance -v 2` | **5/5 passed**: `test_building_counts_match_expected_values`, `test_building_counts_match_original_unannotated_queries`, `test_freshly_created_building_falls_back_correctly`, `test_buildings_list_query_count_is_flat_after_optimization`, `test_buildings_list_single_building_baseline_overhead` |
| `ENV_FILE=.env.test python manage.py test api.tests_inventory -v 1` | **41/41 passed**, unchanged from pre-optimization run |

All runs against the same local disposable `test_db` Docker container used
for the Phase 2 baseline (`docker compose --profile local-db up -d
test_db`). The real Azure production database was never connected to.

## Files Changed

**Production application files (2):**
- `backend/api/views.py` — added imports; added
  `_annotate_building_inventory_counts()` helper; `BuildingViewSet.get_queryset()`
  now wraps its base queryset in that helper.
- `backend/api/serializers.py` — `BuildingSerializer`'s four count getters
  now read the annotation first, with the original query as fallback.

**Performance tests (1):**
- `backend/api/performance_tests/test_buildings_performance.py` — scaling
  test updated to assert flat (not linear) query count, writes to a new
  evidence file; added `BuildingCountCorrectnessTests` (3 tests).

**Documentation / evidence (4, all new — nothing pre-existing overwritten):**
- `project-quality/performance/evidence/BUILDINGS_AFTER_QUERY_COUNTS.txt`
- `project-quality/performance/evidence/BUILDINGS_AFTER_TEST_RUN_LOG.txt`
- `project-quality/performance/PERFORMANCE_OPTIMIZATION_RESULTS.md` (new "P1 — Buildings API Optimization Result" section appended; Phase 2 baseline section left untouched)
- `project-quality/performance/BUILDINGS_OPTIMIZATION_SUMMARY.md` (this file)

The Phase 2 baseline evidence files
(`BUILDINGS_BASELINE_QUERY_COUNTS.txt`, `BUILDINGS_BASELINE_TEST_RUN_LOG_run1.txt`)
were **not modified**.

## Remaining Risks / Limitations

- Only `GET /api/buildings/` was optimized. `ApartmentSerializer` (BLD-02),
  `RoomSerializer`/`Room` model properties (BLD-03), and
  `BedSerializer.is_occupied` (BLD-04) are unchanged and still carry their
  original per-row query patterns — selecting a building on the Buildings
  page still triggers those N+1 patterns via `getApartments`/`getRooms`.
- No pagination was added (BLD-05 unchanged) — response payload size will
  still grow with total building count in a region; only the query-count
  multiplier was removed.
- Server-side-only timing (no real HTTP/network/Azure measurement).
- Synthetic test data only; real production data volume/shape not
  measured in this phase.
- The `getattr(obj, '_apartment_count', None) is not None` fallback check
  relies on the annotated value never legitimately being `None` — enforced
  by wrapping every subquery in `Coalesce(..., 0)`, so a building with zero
  matches annotates to `0`, not `None`, and `None` reliably means "not
  annotated." If a future change to the annotation ever dropped that
  `Coalesce`, the fallback logic would still be correct (it would just
  silently take the slower path more often) rather than return a wrong
  value — but this dependency is worth knowing about for anyone editing
  `_annotate_building_inventory_counts` later.

## Recommendation

**BLD-01 is resolved** for `GET /api/buildings/`: query count is now flat
and independent of building count (down from `2 + 6N` to `2`, a 98.7%
reduction at N=25), with correctness verified against the original query
logic (not just hand-picked expected values) and zero measured change to
permissions, region isolation, business rules, or API response shape.

No further work is required to close BLD-01 specifically. The remaining
Buildings-page N+1 findings (BLD-02 Apartments, BLD-03 Rooms, BLD-04 Beds,
BLD-05 pagination) remain open and unaddressed, as intended — they were
explicitly out of scope for this phase and should be tackled as separate,
similarly-scoped phases if the team chooses to continue this work.