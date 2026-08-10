# Beds API Optimization Summary

Prepared for external AI review. Self-contained record of the BLD-04
implementation phase — the last of the four confirmed Buildings-page N+1
findings. Follows the BLD-04 baseline measurement
(`BEDS_BASELINE_SUMMARY.md`) and directly mirrors the pattern that closed
BLD-01 (Buildings), BLD-02 (Apartments), and BLD-03 (Rooms).

## Scope

Narrow fix for finding **BLD-04 only**: the `BedSerializer.is_occupied`
N+1 pattern behind `GET /api/beds/`. Explicitly **not** touched: the
already-closed Buildings/BLD-01, Apartments/BLD-02, Rooms/BLD-03
implementations, pagination, frontend React code, Docker/Azure
configuration, migrations, the allocation algorithm.

**Branch:** `donia-performance-optimization`

## Baseline

From `BEDS_BASELINE_SUMMARY.md`, measured against a local disposable
PostgreSQL 16 test database (never the real Azure DB):

| N (beds) | SQL queries |
|---:|---:|
| 1  | 2  |
| 10 | 11 |
| 50 | 51 |

`total_queries = 1 + 1 × N` — linear scaling, marginal cost 1.00
queries/bed. Smallest per-row multiplier of the four endpoints, and the
only one with **no** in-request duplication (unlike Buildings/Apartments/
Rooms, `is_occupied` isn't recomputed a second time anywhere).

## Root Cause

`backend/api/serializers.py:616` (`BedSerializer.is_occupied`, a plain
`BooleanField(read_only=True)`) + `backend/api/models.py:368-370`
(`Bed.is_occupied`), pre-fix:

```python
# serializers.py
is_occupied = serializers.BooleanField(read_only=True)

# models.py
@property
def is_occupied(self):
    return self.assignments.filter(status=BedAssignment.Status.ACTIVE).exists()
```

DRF reads the plain field via `getattr(instance, 'is_occupied')`, hitting
the model property — one `.exists()` query per bed row, a reverse-FK
lookup not coverable by `select_related`.

## Implementation

### `backend/api/views.py`

- **Function:** new module-level helper `_annotate_bed_occupancy(queryset)`,
  placed immediately before `BedViewSet`.
- **Before:** `BedViewSet.get_queryset()` returned a plain
  `Bed.objects.select_related(...)` queryset; `is_occupied` computed
  later, per row, by the model property.
- **After:**
  ```python
  def _annotate_bed_occupancy(queryset):
      active_assignment_exists = BedAssignment.objects.filter(
          bed=OuterRef('pk'), status=BedAssignment.Status.ACTIVE,
      )
      return queryset.annotate(_is_occupied=Exists(active_assignment_exists))
  ```
  A single `Exists(...)` annotation — unlike BLD-01/02/03 (all counts,
  needing `Subquery`+`Coalesce`), this is a boolean existence check, so
  `Exists()` is the natural, simpler fit. It compiles to a correlated
  `EXISTS (SELECT 1 FROM ... WHERE ...)` subquery per row, computed inside
  the same single SQL statement as the list/detail query.
  `BedViewSet.get_queryset()`'s base queryset is now wrapped in this
  helper before its existing `room`/`apartment`/region filters run. No
  other function in this file was touched.
- **Why this fixes the N+1:** `is_occupied` is now computed inside the
  single list/detail SQL statement, instead of as a separate round-trip
  query issued once per bed row.
- **Why `Exists()`, not `Subquery`+`Coalesce`:** there is nothing else
  being annotated on `Bed` to risk JOIN-multiplying against — a single
  boolean check has no aggregation ambiguity the way multiple `Count()`s
  combined in one `annotate()` would. `Exists()` is Django's dedicated
  primitive for exactly this "does at least one related row matching X
  exist" question, and it never returns `NULL` (always a real boolean), so
  no `Coalesce()` wrapper is needed either.

### `backend/api/serializers.py`

- **Field:** `is_occupied` changed from plain `BooleanField(read_only=True)`
  to `SerializerMethodField()`.
- **Method:** `get_is_occupied` reads `getattr(obj, '_is_occupied', None)`
  first (fast path, zero extra queries); falls back to the original
  `obj.is_occupied` property when absent. `BedViewSet` has no create
  endpoint (`http_method_names = ['get', 'patch', 'head', 'options']`), so
  the only realistic unannotated case is a `Bed` instance fetched some
  other way outside `get_queryset()` — the fallback keeps that path
  correct.

No other file was changed.

## Correctness Protection

| Field | Original | New | Match? |
|---|---|---|---|
| `is_occupied` | `self.assignments.filter(status=ACTIVE).exists()` | `Exists(BedAssignment.filter(bed=OuterRef('pk'), status=ACTIVE))` | Identical |

**How this was verified, not just asserted:**

1. **Empirical cross-check against the original property.** New test
   `BedOccupancyCorrectnessTests.test_is_occupied_matches_original_unannotated_property`
   builds three beds — one with an **ACTIVE** assignment, one with **no**
   assignment, and one whose assignment has since transitioned to
   **ENDED** (must not count as occupied) — then re-runs the *original*
   `Bed.is_occupied` property directly against the DB and asserts the
   live endpoint's values match for all three beds.

2. **Hand-computed expected values.** A second test asserts the same
   fixture against hand-computed booleans (`B1: True, B2: False, B3:
   False`).

3. **Direct fallback-path coverage.** `test_unannotated_bed_falls_back_correctly`
   fetches a `Bed` with a plain `Bed.objects.get(pk=...)` (bypassing the
   annotated `get_queryset()` entirely) and serializes it directly with
   `BedSerializer`, confirming the fallback returns correct values for
   both an occupied and a free bed — since `BedViewSet` has no create
   endpoint to exercise this the way Buildings/Apartments/Rooms did.

4. **Bulk spot-check at every measured N.** `BedsListPerformanceTests._measure`
   asserts the count of occupied beds returned matches the known fixture
   count at N=1, 10, and 50.

5. **Permissions / region isolation / API contract.** None of
   `get_queryset()`'s existing filtering or `update()` (label-only edit)
   logic was touched — only wrapped with an additional `.annotate()`
   call. `BedSerializer.Meta.fields` unchanged; field still returns the
   same Python `bool` type. Verified by `backend/api/tests_inventory.py`
   — **41/41 passed, unchanged**. The already-closed BLD-01/02/03 fixes
   were re-run (16 tests total) and confirmed still flat — unaffected,
   despite all four viewsets sharing `backend/api/views.py`.

## Before vs After Measurements

| N (beds) | SQL queries before | SQL queries after | Response time before (ms) | Response time after (ms) | Response size before (bytes) | Response size after (bytes) |
|---:|---:|---:|---:|---:|---:|---:|
| 1  | 2  | 1 | ~6–7   | ~7  | 115   | 115   |
| 10 | 11 | 1 | ~24–30 | ~6  | 1,128 | 1,137 |
| 50 | 51 | 1 | ~90–94 | ~11 | 5,717 | 5,717 |

- **Absolute query reduction:** 1 (N=1), 10 (N=10), 50 (N=50).
- **Percentage query reduction:** 50.0% (N=1), 90.9% (N=10), **98.0%**
  (N=50).
- Small byte differences reflect independent test-DB runs assigning
  different primary keys — not value changes (confirmed by correctness
  tests, which compare within a single shared DB state).

## Query Scaling

**Before:** `total_queries = 1 + 1 × N`, linear.
**After:** `total_queries = 1` at N=1, 10, and 50 — **flat, fully
independent of N**. Marginal cost 0.00 queries/bed (down from 1.00).

## Tests Run

| Command | Result |
|---|---|
| `cd backend && ENV_FILE=.env.test python manage.py check` | No issues (0 silenced) |
| `ENV_FILE=.env.test python manage.py test api.performance_tests.test_beds_performance -v 2` | **5/5 passed** |
| `ENV_FILE=.env.test python manage.py test api.tests_inventory -v 1` | **41/41 passed**, unchanged |
| `ENV_FILE=.env.test python manage.py test api.performance_tests.test_buildings_performance api.performance_tests.test_apartments_performance api.performance_tests.test_rooms_performance -v 1` (sanity re-check) | **16/16 passed** — BLD-01/02/03 still flat, unaffected |

All runs against the same local disposable `test_db` container used
throughout this session. Real Azure database never connected to.

## Files Changed

**Production application files (2):**
- `backend/api/views.py` — added `Exists` import; added
  `_annotate_bed_occupancy()` helper; `BedViewSet.get_queryset()` wraps
  its base queryset in that helper.
- `backend/api/serializers.py` — `BedSerializer.is_occupied` changed to
  `SerializerMethodField` with annotation-first-with-fallback getter.

**Performance tests (1):**
- `backend/api/performance_tests/test_beds_performance.py` — rewritten:
  flat-scaling regression assertions replace the linear baseline
  assertions; new `BedOccupancyCorrectnessTests` (3 tests).

**Documentation / evidence (4, all new — nothing pre-existing overwritten):**
- `project-quality/performance/evidence/BEDS_AFTER_QUERY_COUNTS.txt`
- `project-quality/performance/evidence/BEDS_AFTER_TEST_RUN_LOG.txt`
- `project-quality/performance/PERFORMANCE_OPTIMIZATION_RESULTS.md` (new "BLD-04 — Beds API Optimization Result" section appended)
- `project-quality/performance/BEDS_OPTIMIZATION_SUMMARY.md` (this file)

The BLD-04 baseline evidence files (`BEDS_BASELINE_QUERY_COUNTS.txt`,
`BEDS_BASELINE_TEST_RUN_LOG.txt`) were **not modified**.

## Remaining Risks / Limitations

- All four confirmed Buildings-page N+1 findings (BLD-01–04) are now
  resolved. BLD-05 (pagination) remains open — analysis only, no
  implementation planned as part of this fix.
- Server-side-only timing (no real HTTP/network/Azure measurement).
- Synthetic test data only.
- The `getattr(..., None) is not None` fallback pattern depends on
  `Exists()` never returning `NULL` when present — true by construction
  (it always evaluates to a real boolean), so no `Coalesce()` dependency
  exists here the way it does for BLD-01/02/03's count-based annotations.

## Recommendation

**BLD-04 is resolved** for `GET /api/beds/`: query count is now flat and
independent of bed count (down from `1 + 1N` to `1`, a 98.0% reduction at
N=50), with correctness verified against the original property logic
(including the ACTIVE-vs-ENDED assignment distinction) and zero measured
change to permissions, region isolation, business rules, or API response
shape. The already-closed BLD-01/BLD-02/BLD-03 fixes were independently
confirmed unaffected.

This closes **all four** confirmed Buildings-page N+1 findings from the
original code inspection (BLD-01 through BLD-04). BLD-05 (pagination
analysis) proceeds next, per the session plan — analysis only, no
implementation.
