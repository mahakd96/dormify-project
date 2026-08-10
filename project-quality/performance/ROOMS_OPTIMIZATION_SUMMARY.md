# Rooms API Optimization Summary

Prepared for external AI review. Self-contained record of the BLD-03
implementation phase. Follows the BLD-03 baseline measurement
(`ROOMS_BASELINE_SUMMARY.md`) and directly mirrors the pattern that closed
BLD-01 (Buildings) and BLD-02 (Apartments) — see
`BUILDINGS_OPTIMIZATION_SUMMARY.md`, `APARTMENTS_OPTIMIZATION_SUMMARY.md`.

## Scope

Narrow fix for finding **BLD-03 only**: the `RoomSerializer`/`Room` model
property N+1 pattern behind `GET /api/rooms/`. Explicitly **not**
touched: the already-closed Buildings/BLD-01 and Apartments/BLD-02
implementations, Beds, pagination, frontend React code, Docker/Azure
configuration, migrations, the allocation algorithm.

**Branch:** `donia-performance-optimization`

## Baseline

From `ROOMS_BASELINE_SUMMARY.md`, measured against a local disposable
PostgreSQL 16 test database (never the real Azure DB):

| N (rooms) | SQL queries (active rooms) |
|---:|---:|
| 1  | 8   |
| 5  | 36  |
| 25 | 176 |

`total_queries = 1 + 7 × N` — linear scaling, marginal cost 7.00
queries/room. An inactive room cost only 4 queries (3 per-row + 1 fixed),
since `available_beds`/`is_full` short-circuited in Python without
querying when `is_active=False`.

## Root Cause

`backend/api/serializers.py:517-559` (`RoomSerializer`) +
`backend/api/models.py:323-349` (`Room` properties), pre-fix:

```python
# models.py
@property
def current_occupancy(self):
    return BedAssignment.objects.filter(bed__room=self, status=ACTIVE).count()

@property
def is_full(self):
    if not self.is_active:
        return True
    return self.available_beds <= 0

@property
def available_beds(self):
    if not self.is_active:
        return 0
    used = BedAssignment.objects.filter(bed__room=self, status=ACTIVE).values('bed_id').distinct().count()
    return max(self.beds.count() - used, 0)

# serializers.py
def get_bed_count(self, obj):
    return obj.beds.count()

def get_has_missing_bed_records(self, obj):
    return obj.beds.count() < obj.capacity
```

For an active room: `current_occupancy` (1) + `available_beds` (2) +
`is_full` (re-runs `available_beds`: 2 more) + `get_bed_count` (1) +
`get_has_missing_bed_records` (1) = **7 queries**, of which **4 were
exact in-request duplicates** — the highest duplication ratio of the
three endpoints inspected (BLD-01: 2/6, BLD-02: 2/5, BLD-03: 4/7).

## Implementation

### `backend/api/views.py`

- **Function:** new module-level helper
  `_annotate_room_inventory_counts(queryset)`, placed immediately before
  `RoomViewSet`.
- **Before:** `RoomViewSet.get_queryset()` returned a plain
  `Room.objects.select_related(...)` queryset; all five derived values
  computed later, per row, by the serializer/model properties.
- **After:** three chained `.annotate()` calls:
  1. Three correlated-subquery counts — `_bed_count` (all beds for the
     room), `_current_occupancy` (ACTIVE-assignment `.count()`, matching
     `Room.current_occupancy` exactly), and `_used_beds_distinct` (a
     **separately-computed** `Count('bed_id', distinct=True)` subquery,
     deliberately not reused from `_current_occupancy` — the original
     code writes these as two differently-shaped queries that are only
     numerically guaranteed equal by the `unique_active_assignment_per_bed`
     DB constraint, so the optimization preserves that literal structure
     rather than assuming the equivalence).
  2. `_available_beds = Case(When(is_active=False, then=Value(0)),
     default=Greatest(F('_bed_count') - F('_used_beds_distinct'),
     Value(0)))` — reproduces the is_active short-circuit and
     `max(beds.count() - used, 0)` clamp as one SQL expression.
  3. `_is_full = Case(When(_available_beds__lte=0, then=Value(True)),
     default=Value(False))` and
     `_has_missing_bed_records = Case(When(_bed_count__lt=F('capacity'),
     then=Value(True)), default=Value(False))`. `_is_full` collapses the
     original two-branch property (`not is_active` OR `available_beds<=0`)
     into a single comparison, because `_available_beds` is already forced
     to `0` for inactive rooms by step 2 — making `_available_beds <= 0`
     `True` in both the "inactive" and "active-but-full" cases, exactly
     like the original.
  `RoomViewSet.get_queryset()`'s base queryset is now wrapped in this
  helper before its existing filters run. No other function in this file
  was touched.
- **Why this fixes the N+1:** all five values are now computed inside the
  single list/detail SQL statement, instead of as separate per-row Python
  queries — and because the short-circuit is now a SQL `CASE` branch
  rather than a Python early-`return`, an **inactive** room now costs the
  same flat query count as an active one (previously it cost fewer, since
  the early return skipped two queries entirely).
- **Why subqueries + Case, not combined `Count()` annotations:** same
  JOIN-multiplication-avoidance reasoning as BLD-01/02 — each raw count is
  an independent, separately-grouped correlated subquery; the derived
  boolean/clamped fields are computed afterward from those already-named
  columns via `Case`/`F`, never by combining multiple `Count()`s across
  different relations in one `annotate()` call.

### `backend/api/serializers.py`

- **Fields:** `current_occupancy`, `available_beds`, `is_full` changed
  from plain `IntegerField(read_only=True)` / `BooleanField(read_only=True)`
  to `SerializerMethodField()` — necessary because the plain field types
  read the value directly off the `Room` model property via implicit
  `getattr(instance, field_name)`, which cannot be redirected to a
  differently-named annotation without a method field.
- **Methods:** all five getters
  (`get_current_occupancy`/`get_available_beds`/`get_is_full`/
  `get_bed_count`/`get_has_missing_bed_records`) now check
  `getattr(obj, '_X', None)` first (fast path, zero extra queries when the
  object came from the annotated `get_queryset()`), falling back to the
  **original, unmodified** property/query when absent (only true for a
  freshly `POST`-created `Room`).

No other file was changed.

## Correctness Protection

| Field | Original | New | Match? |
|---|---|---|---|
| `current_occupancy` | `BedAssignment.filter(bed__room=self, status=ACTIVE).count()` | Same filter, correlated subquery | Identical, no `is_active` gate (preserved) |
| `bed_count` | `obj.beds.count()` | `Bed.filter(room=OuterRef('pk'))` counted | Identical |
| `available_beds` | `0` if inactive, else `max(beds.count()-used,0)` | `Case` reproducing both branches | Identical |
| `is_full` | `True` if inactive, else `available_beds<=0` | `_available_beds<=0` (collapses correctly since inactive→0) | Identical |
| `has_missing_bed_records` | `beds.count() < capacity` | `_bed_count < capacity` | Identical |

**How this was verified, not just asserted:**

1. **Empirical cross-check against the original properties.** New test
   `RoomCountCorrectnessTests.test_room_values_match_original_unannotated_properties`
   builds three rooms:
   - **R1** (active): one bed with an **ACTIVE** assignment (occupied),
     one bed whose assignment has since **ended** (must not count), one
     free bed.
   - **R2** (active, capacity=5, only 2 beds materialized): the
     `has_missing_bed_records` edge case, one **ACTIVE** assignment.
   - **R3** (**INACTIVE**): one **ACTIVE** assignment — the asymmetry edge
     case where `current_occupancy` still counts it but
     `available_beds`/`is_full` short-circuit regardless of the underlying
     bed math.

   The test re-runs the *original* `Room` model properties directly
   against the DB and asserts the live endpoint's five fields match, for
   all three rooms.

2. **Hand-computed expected values.** A second test asserts the same
   fixture against numbers computed by hand (R1: `bed_count=3,
   current_occupancy=1, available_beds=2, is_full=False,
   has_missing_bed_records=False`; R2: `bed_count=2, current_occupancy=1,
   available_beds=1, is_full=False, has_missing_bed_records=True`; R3:
   `bed_count=2, current_occupancy=1, available_beds=0, is_full=True,
   has_missing_bed_records=False`).

3. **Fallback-path coverage.** `test_freshly_created_room_falls_back_correctly`
   confirms `POST /api/rooms/` (unannotated instance) still returns
   correct values for a brand-new, unmaterialized room — including
   `is_full=True`/`has_missing_bed_records=True` (0 beds < capacity).

4. **Bulk spot-check + inactive-room dedicated test.**
   `RoomsListPerformanceTests._measure` asserts every room at every N
   shows the known fixture values, and a dedicated inactive-room
   performance test confirms `available_beds=0`/`is_full=True` are still
   correct post-fix, at flat query cost.

5. **Permissions / region isolation / API contract.** None of
   `get_queryset()`'s existing filtering/`create()`/`update()` logic was
   touched — only wrapped with additional `.annotate()` calls.
   `RoomSerializer.Meta.fields` (names, order) unchanged; every field
   still returns the same Python type. Verified by
   `backend/api/tests_inventory.py` — **41/41 passed, unchanged**. The
   already-closed BLD-01/BLD-02 fixes were re-run and confirmed still flat
   (2/1 queries respectively) — unaffected, despite sharing
   `backend/api/views.py`.

## Before vs After Measurements

| N (rooms) | SQL queries before | SQL queries after | Response time before (ms) | Response time after (ms) | Response size before (bytes) | Response size after (bytes) |
|---:|---:|---:|---:|---:|---:|---:|
| 1  | 8   | 1 | ~11–15   | ~11 | 283   | 283   |
| 5  | 36  | 1 | ~53–61   | ~15 | 1,406 | 1,411 |
| 25 | 176 | 1 | ~235–269 | ~15 | 7,080 | 7,083 |
| 1 (inactive) | 4 | 1 | — | — | — | — |

- **Absolute query reduction:** 7 (N=1), 35 (N=5), 175 (N=25); 3 for the
  inactive-room case.
- **Percentage query reduction:** 87.5% (N=1), 97.2% (N=5), **99.4%**
  (N=25); 75% (inactive room).
- Small byte differences reflect independent test-DB runs assigning
  different primary keys — not value changes (confirmed by the
  correctness tests, which compare within a single shared DB state).

## Query Scaling

**Before:** `total_queries = 1 + 7 × N` for active rooms, linear.
**After:** `total_queries = 1` at N=1, 5, and 25, for **both** active and
inactive rooms — **flat, fully independent of N and of room active
status**. Marginal cost 0.00 queries/room (down from 7.00).

## Tests Run

| Command | Result |
|---|---|
| `cd backend && ENV_FILE=.env.test python manage.py check` | No issues (0 silenced) |
| `ENV_FILE=.env.test python manage.py test api.performance_tests.test_rooms_performance -v 2` | **6/6 passed** |
| `ENV_FILE=.env.test python manage.py test api.tests_inventory -v 1` | **41/41 passed**, unchanged |
| `ENV_FILE=.env.test python manage.py test api.performance_tests.test_buildings_performance api.performance_tests.test_apartments_performance -v 1` (sanity re-check) | **10/10 passed** — BLD-01/BLD-02 still flat, unaffected |

All runs against the same local disposable `test_db` container. Real
Azure database never connected to.

## Files Changed

**Production application files (2):**
- `backend/api/views.py` — added imports (`Case`, `When`, `Value`, `F`,
  `BooleanField`, `Greatest`); added `_annotate_room_inventory_counts()`
  helper; `RoomViewSet.get_queryset()` wraps its base queryset in that
  helper.
- `backend/api/serializers.py` — `RoomSerializer`'s `current_occupancy`/
  `available_beds`/`is_full` changed to `SerializerMethodField`; all five
  getters read the annotation first, with the original property/query as
  fallback.

**Performance tests (1):**
- `backend/api/performance_tests/test_rooms_performance.py` — rewritten:
  flat-scaling regression assertions replace the linear baseline
  assertions; new `RoomCountCorrectnessTests` (3 tests); inactive-room
  test now asserts flat cost instead of documenting a discount.

**Documentation / evidence (4, all new — nothing pre-existing overwritten):**
- `project-quality/performance/evidence/ROOMS_AFTER_QUERY_COUNTS.txt`
- `project-quality/performance/evidence/ROOMS_AFTER_TEST_RUN_LOG.txt`
- `project-quality/performance/PERFORMANCE_OPTIMIZATION_RESULTS.md` (new "BLD-03 — Rooms API Optimization Result" section appended)
- `project-quality/performance/ROOMS_OPTIMIZATION_SUMMARY.md` (this file)

The BLD-03 baseline evidence files (`ROOMS_BASELINE_QUERY_COUNTS.txt`,
`ROOMS_BASELINE_TEST_RUN_LOG.txt`) were **not modified**.

## Remaining Risks / Limitations

- Only `GET /api/rooms/` was optimized. `BedSerializer.is_occupied`
  (BLD-04) is unchanged and still carries its original per-row query
  pattern — selecting a room on the Buildings page still triggers that
  N+1 via `getBeds`.
- No pagination was added (BLD-05 unchanged).
- Server-side-only timing (no real HTTP/network/Azure measurement).
- Synthetic test data only.
- The `getattr(..., None) is not None` fallback pattern depends on every
  annotation always resolving to a non-`None` value when present
  (`Coalesce(..., 0)` for counts, explicit `default=` on every `Case`) —
  same dependency already documented for BLD-01/02; worth knowing for
  anyone editing `_annotate_room_inventory_counts` later.

## Recommendation

**BLD-03 is resolved** for `GET /api/rooms/`: query count is now flat and
independent of both room count and active/inactive status (down from
`1 + 7N` to `1`, a 99.4% reduction at N=25), with correctness verified
against the original property/query logic (including the inactive-room/
active-assignment asymmetry) and zero measured change to permissions,
region isolation, business rules, or API response shape. The
already-closed BLD-01/BLD-02 fixes were independently confirmed
unaffected.

No further work is required to close BLD-03 specifically. The remaining
finding (BLD-04 Beds) and BLD-05 (pagination analysis) proceed next, per
the session plan.
