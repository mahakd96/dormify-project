# Analysis API — Optimization Result Summary

Prepared for external AI review. Self-contained summary of the Analysis
(`GET /api/analysis/`) optimization phase — implementation, correctness
verification, and re-measurement — following the confirmed baseline in
`ANALYSIS_BASELINE_SUMMARY.md`.

## Confirmed baseline (input to this phase, unchanged)

| Buildings (N) | SQL queries (before) |
|---:|---:|
| 1  | 34  |
| 5  | 46  |
| 25 | 106 |

Scaling: `total_queries = 31 + 3 × N` (marginal cost 3.00 queries/building),
reproduced identically across 3 full baseline runs. Query count was
already confirmed **flat with respect to student volume** (46 queries at
both S=50 and S=500 extra students, buildings fixed at N=5) — that finding
is unchanged and the student-volume code path was **not** touched in this
phase, per the baseline's explicit instruction.

## Root cause (recap)

Inside `analysis_data()`'s `occupancy_data` loop (`backend/api/views.py`,
pre-fix), three independent queries ran once per building row:

1. **Building capacity** — `building_capacity = sum(building_rooms_qs.values_list('capacity', flat=True))` (was `views.py:6657-6659`).
2. **Assigned/occupied distinct beds** — `building_assigned_beds = assignments_qs.filter(bed__room__apartment__building=building).values('bed_id').distinct().count()` (was `views.py:6661-6663`).
3. **Room count** — `'rooms_count': building_rooms_qs.count()` (was `views.py:6689`) — a second, independent `COUNT` on the same `building_rooms_qs` already evaluated for capacity.

## Implementation (production code changed)

**`backend/api/views.py`** — 2 changes, both narrowly scoped to the
`occupancy_data` loop:

1. **Import line:** added `Sum` to the existing
   `from django.db.models import (Q, Count, Prefetch, OuterRef, Subquery, IntegerField, Case, When, Value, F, BooleanField, Exists)`
   import (now `Q, Count, Sum, Prefetch, OuterRef, Subquery, ...`). No other
   import changed.
2. **New module-level helper `_annotate_analysis_building_occupancy(buildings_qs, rooms_qs, assignments_qs)`**
   (placed immediately before `analysis_data()`, mirroring the placement
   convention already used for `_annotate_building_inventory_counts` /
   `_annotate_apartment_inventory_counts`): annotates `_capacity`,
   `_rooms_count`, `_assigned_beds` onto the `buildings_qs` passed in, each
   as an independent `Coalesce(Subquery(...), 0)` correlated by
   `OuterRef('pk')` — built directly from the caller's already-filtered
   `rooms_qs`/`assignments_qs` (see "Correctness protection" below), just
   with `apartment__building=OuterRef('pk')` /
   `bed__room__apartment__building=OuterRef('pk')` added on top.
3. **`analysis_data()`'s occupancy loop:** immediately before the `for
   building in ...` loop, `buildings_qs` is now wrapped once via
   `occupancy_buildings_qs = _annotate_analysis_building_occupancy(buildings_qs, rooms_qs, assignments_qs)`,
   and the loop iterates over `occupancy_buildings_qs.order_by(...)`
   (same `order_by` clause, unchanged) instead of `buildings_qs.order_by(...)`.
   Inside the loop, `building_capacity`/`building_assigned_beds` now read
   `building._capacity`/`building._assigned_beds` (annotated attributes,
   zero extra queries) instead of running the two original per-building
   queries, and `'rooms_count': building_rooms_qs.count()` became
   `'rooms_count': building._rooms_count`. The now-unused
   `building_rooms_qs = rooms_qs.filter(apartment__building=building)`
   local variable was removed (nothing else in the loop referenced it).
   No other line in the loop body — `building_available_beds`,
   `building_occupancy_rate`, the `dorm_type`/`dorm_region` lookups (still
   zero-query via the pre-existing `select_related('dorm_type',
   'dorm_type__region')` on `buildings_qs`), or the `occupancy_data.append({...})`
   dict itself — was changed.

**No other function in `views.py`, and no other file, was touched.** In
particular: `buildings_qs`'s own definition/filters (lines before the
loop), `rooms_qs`'s and `assignments_qs`'s own definitions/filters
(including their `is_active` and region scoping), the summary KPI block,
every `students_by_*` distribution, the `students_by_region`/
`students_by_region_demand` Python loop (explicitly out of scope per the
baseline's student-volume finding), `transfers_by_status`/
`transfers_by_type`, `pending_requests_by_type`, `latest_run`
(`AllocationRun` read path), and `latest_batch` are all byte-for-byte
unchanged.

## Why this avoids join multiplication

Each of the three values (`_capacity`, `_rooms_count`, `_assigned_beds`)
is computed as an **independent** correlated subquery
(`Subquery(...filter(apartment__building=OuterRef('pk'))...values(group_field).annotate(agg).values(agg_field)...)`),
not as multiple `Sum()`/`Count()` annotations combined in one
`.annotate()` call on joined relations. Combining aggregates over
different related paths (rooms vs. bed assignments) in a single
`annotate()` is the classic Django trap where the JOINs needed for each
aggregate multiply against each other, silently inflating every count by
the row count of the *other* joined relation. Because each subquery here
is filtered, grouped, and evaluated independently — exactly the same
technique already applied and verified for `BuildingViewSet` (BLD-01),
`ApartmentViewSet` (BLD-02), `RoomViewSet` (BLD-03), and `BedViewSet`
(BLD-04) — there is no cross-join between the room-capacity subquery and
the bed-assignment subquery; each produces its own single scalar per
building, computed in its own correlated `SELECT`, all three inside the
one outer `buildings_qs` statement.

## Correctness protection

- **`_capacity`** — subquery is `rooms_qs.filter(apartment__building=OuterRef('pk'))`
  grouped by `apartment__building`, `Sum('capacity')` — identical filter
  to the original `sum(rooms_qs.filter(apartment__building=building).values_list('capacity', flat=True))`,
  since `rooms_qs` is passed in **already carrying** its own
  `is_active`/apartment-active/building-active/region filters unchanged.
- **`_rooms_count`** — subquery is the *same* `rooms_qs.filter(apartment__building=OuterRef('pk'))`,
  `Count('id')` instead of `Sum('capacity')` — identical filter to the
  original `building_rooms_qs.count()`, which used the identical
  `building_rooms_qs = rooms_qs.filter(apartment__building=building)`.
- **`_assigned_beds`** — subquery is `assignments_qs.filter(bed__room__apartment__building=OuterRef('pk'))`
  grouped by `bed__room__apartment__building`,
  `Count('bed_id', distinct=True)` — identical filter and distinct-bed
  semantics to the original
  `assignments_qs.filter(bed__room__apartment__building=building).values('bed_id').distinct().count()`,
  since `assignments_qs` is passed in already carrying its own
  `status=ACTIVE` + `bed__room__is_active` + `bed__room__apartment__is_active`
  + `bed__room__apartment__building__is_active` + region filters unchanged
  — **including** the fact that (unlike `BuildingSerializer.get_occupied_beds`
  on the Buildings page) `analysis_data()`'s `assignments_qs` *does*
  filter out assignments on beds in inactive rooms/apartments. This
  asymmetry-vs-Buildings was preserved exactly, not "fixed."
- `Coalesce(..., 0)` makes a building with zero matching rooms/assignments
  yield `0` instead of `NULL`, matching the original `sum()`/`.count()`
  behavior (which returns `0` for an empty queryset/list, never `None`).
- **Verified empirically, not just by inspection** — new test class
  `AnalysisOccupancyCorrectnessTests`
  (`backend/api/performance_tests/test_analysis_performance.py`):
  - Fixture: one Building with an active apartment holding an active room
    (one bed with an **ACTIVE** assignment, one bed whose assignment has
    since **ENDED**) and an **inactive** room holding a bed with a
    still-**ACTIVE** assignment; a second, fully **inactive** apartment
    holding an active room with a still-**ACTIVE** assignment; and a
    second, completely **empty** Building (no apartments/rooms/beds at
    all).
  - `test_occupancy_values_match_hand_computed_expected_values` — asserts
    the fixture building's `rooms_count=1`, `total_beds=2`, `assigned=1`,
    `available_beds=1`, `occupancy_rate=50.0` against hand-computed
    expectations (only the active room under the active apartment counts;
    the ended assignment, the inactive-room assignment, and the
    inactive-apartment assignment are all correctly excluded).
  - `test_occupancy_values_match_original_unannotated_queries` — re-runs
    the *exact original* pre-optimization query logic directly against
    the DB (same filters, scoped to one building) and asserts the live,
    now-annotated endpoint returns byte-for-byte identical
    `total_beds`/`assigned`/`rooms_count`/`available_beds`/`occupancy_rate`.
  - `test_building_with_zero_inventory_returns_zeroes_not_none` —
    confirms the empty-building `Coalesce(...,0)` fallback returns all
    zeroes, not `None` or a crash.
  - All three pass.
- **Response payload proof (not just field-by-field assertions):** the
  post-fix response payload size is **byte-for-byte identical** to the
  frozen baseline at every measured N — 1,324 bytes (N=1), 2,292 bytes
  (N=5), 7,162 bytes (N=25), both before and after — the strongest
  available signal that the JSON contents are unchanged, since any
  differing value or field would change the serialized byte count.
- **Existing behavior/scoping suite** — the full pre-existing
  `backend/api/tests_analysis.py` (12 tests: empty-state, region scoping
  for central admin / region boss / employee, invalid-region 404,
  pending-requests scoping, latest-batch scoping) — **12/12 passed**,
  unchanged, both before and after this change.
- **Permissions / region isolation / API contract** — none of
  `analysis_data()`'s existing role/region-scoping logic
  (`_resolve_region`, the `if region: ...filter(...)` blocks for
  `students_qs`/`rooms_qs`/`buildings_qs`/`assignments_qs`/`transfers_qs`/
  `runs_qs`/`requests_qs`) was changed — `_annotate_analysis_building_occupancy`
  only adds the per-building correlation on top of whatever `rooms_qs`/
  `assignments_qs` already were at the point the loop runs. Response
  field names, types, and the `occupancy_data` list shape are unchanged.

## Before vs after measurements

| N (buildings) | SQL queries before | SQL queries after | Response time before (ms) | Response time after (ms) | Response size before (bytes) | Response size after (bytes) |
|---:|---:|---:|---:|---:|---:|---:|
| 1  | 34  | 31 | ~41–49  | ~41–51 | 1,324 | 1,324 |
| 5  | 46  | 31 | ~52–60  | ~42–49 | 2,292 | 2,292 |
| 25 | 106 | 31 | ~141–156 | ~46–61 | 7,162 | 7,162 |

(Response-time figures are server-side only, measured via DRF's
`APIClient` — see limitations in `ANALYSIS_BASELINE_SUMMARY.md`; they are
directional, not a promise of real-world latency, and both before/after
ranges reflect normal wall-clock noise on a shared dev machine. Response
sizes are exact and byte-identical before/after at every N — see
"Correctness protection" above.)

**Absolute query reduction:** 3 (N=1), 15 (N=5), 75 (N=25).
**Percentage query reduction:** 8.8% (N=1), 32.6% (N=5), **70.8% (N=25)**.

## Query scaling — before vs after

- **Before:** `total_queries = 31 + 3 × N` — linear, unbounded growth with
  building count (marginal cost 3.00 queries/building, confirmed in the
  baseline phase).
- **After:** `total_queries = 31` at N=1, N=5, **and** N=25 — **flat,
  independent of N** (marginal cost 0.00 queries/building, measured
  directly, reproduced across 2 full test runs). Query count for
  `GET /api/analysis/` is no longer coupled to the number of buildings
  returned.

**Query count is now flat with respect to building count.** ✅

## Tests run and results

| Command | Result |
|---|---|
| `ENV_FILE=.env.test python manage.py check` | No issues (0 silenced) |
| `ENV_FILE=.env.test python manage.py test api.tests_analysis -v 2` | **12/12 passed**, unchanged (pre-existing scoping/behavior tests) |
| `ENV_FILE=.env.test python manage.py test api.performance_tests.test_analysis_performance -v 2` | **6/6 passed** (3 correctness tests, 1 flat-scaling regression test, 1 student-volume-independence test, 1 N=1 overhead test) — run 2 full times, query counts (31/31/31, and 31 for both S=50/S=500) identical every run |

No allocation test (`api.tests_allocation.py`, `api.tests_assisted_allocation.py`,
or any allocation-owned test module) was run or modified — the production
change in this phase does not touch any allocation-owned code path (see
"Allocation-owned logic" below), so per the baseline's explicit
instruction, allocation tests were intentionally left out of this phase's
regression scope.

## Exact production files changed

- `backend/api/views.py`:
  - Import line: added `Sum` to the existing `django.db.models` import.
  - New helper `_annotate_analysis_building_occupancy(buildings_qs, rooms_qs, assignments_qs)`,
    placed immediately before `analysis_data()`.
  - `analysis_data()`'s `occupancy_data` loop: wraps `buildings_qs` via the
    new helper before iterating; reads `building._capacity` /
    `building._assigned_beds` / `building._rooms_count` instead of running
    3 queries per building; removed the now-unused
    `building_rooms_qs` local variable. No other line in `analysis_data()`,
    and no other function in the file, was changed.

**That is the complete list.** No serializer, model, migration, URL,
permission class, or any other view was touched.

## Exact test/docs/evidence files changed

- `backend/api/performance_tests/test_analysis_performance.py` — updated:
  module docstring now documents Phase 1 (frozen baseline) vs. Phase 2
  (this optimization); `EVIDENCE_FILE` now points at
  `ANALYSIS_AFTER_QUERY_COUNTS.txt` (not the frozen baseline file);
  `test_analysis_query_count_scaling_with_building_count` now asserts flat
  (not merely records) query count; added `AnalysisOccupancyCorrectnessTests`
  (3 new tests). The student-volume test
  (`test_analysis_query_count_independent_of_student_volume`) is otherwise
  unchanged, per the baseline's instruction not to touch the student-loop
  measurement or implementation.
- `project-quality/performance/evidence/ANALYSIS_AFTER_QUERY_COUNTS.txt` — new.
- `project-quality/performance/evidence/ANALYSIS_AFTER_TEST_RUN_LOG.txt` — new.
- `project-quality/performance/PERFORMANCE_OPTIMIZATION_RESULTS.md` — new
  "Analysis API — Optimization Result" section appended; the "Analysis
  API — Baseline" section and all prior Buildings/Apartments/Rooms/Beds
  sections above it left byte-for-byte unchanged.
- `project-quality/performance/ANALYSIS_OPTIMIZATION_SUMMARY.md` — this
  file, new.
- Baseline evidence files (`ANALYSIS_BASELINE_QUERY_COUNTS.txt`,
  `ANALYSIS_BASELINE_TEST_RUN_LOG.txt`) — **not modified**.

## Confirmation: allocation-owned logic untouched

- `analysis_data()`'s `latest_run` read path
  (`runs_qs = AllocationRun.objects.all()`, its optional
  `.filter(region=region)`, and
  `latest_run = runs_qs.select_related('run_by', 'region').order_by('-started_at').first()`)
  was **not modified in any way** — not read, re-ordered, or re-scoped
  differently. It still runs exactly as many queries as before (1).
- No allocation algorithm file, allocation serializer, allocation test
  module, `AssistedAllocationAudit`, or assisted-allocation endpoint was
  opened for editing or touched by this change.
- The only production file changed (`backend/api/views.py`) had its edits
  confined to an import line and the `occupancy_data` loop inside
  `analysis_data()` — no allocation-related view function
  (`run_allocation`, `start_allocation_run`, `allocation_summary`,
  `allocation_results`, `assisted_allocation_*`, etc.) in the same file
  was touched.
- No allocation test (`api.tests_allocation.py`,
  `api.tests_assisted_allocation.py`) was run, modified, or needed for
  this phase's regression scope, per the explicit ownership boundary.

## Remaining fixed/base query count — NOT optimized in this phase

After this fix, `GET /api/analysis/` still issues a **flat 31 queries**
per request, regardless of building count. This is the same fixed base
already identified (not measured in isolation) in the baseline phase — it
comes from the ~28+ single aggregate/count/values_list queries
`analysis_data()` runs once per request regardless of N: the summary KPI
block (`total_students`, `assigned_students`, `priority_students`,
`total_capacity`, `assigned_beds`, `total_buildings`,
`all_buildings_count`, `inactive_buildings_count`, `total_rooms`,
`total_transfers`, `pending_transfers`, `pending_requests`,
`priority_unassigned_students`, etc. — each its own `.count()`/`.sum()`/
`values_list()` call), the 5 `students_by_*` distribution aggregates, the
`dorm_types_for_region` lookup, the one `students_qs.select_related(...)`
loop query, `region_name_to_id`, `transfers_by_status`/`transfers_by_type`,
`pending_requests_by_type`, `latest_run`, and `latest_batch`/
`RegionInbox` lookup — plus DRF auth/permission overhead.

**This phase deliberately did not touch, consolidate, or optimize any of
those 31 queries** — per the explicit instruction to implement only the
narrowest fix for the 3 confirmed per-building queries and not
opportunistically optimize the rest of `analysis_data()`. Whether any of
those 31 fixed queries could themselves be consolidated (e.g. several
single-purpose `.count()` calls combined via `aggregate()`) is a
**candidate for the next investigation**, not addressed here.

## Remaining risks / limitations

- Only the 3 confirmed per-building queries were addressed. The 31
  remaining fixed queries are unchanged and undocumented beyond a
  high-level listing above — no query-shape/duplicate-pattern analysis
  was performed on them in this phase (that would require a dedicated
  measurement pass, out of scope here).
- Timing measurements remain server-side-only (DRF `APIClient`, no real
  HTTP/network/Azure layer) — real-world latency improvement was not
  separately measured.
- Real production data volume/shape was not used — synthetic data only,
  consistent with the baseline method (up to 25 buildings, 500 extra
  students).
- The student-volume independence finding (query count flat vs. S) was
  re-confirmed as an unintended side effect of this fix (46→31 at every S,
  same flat-vs-S shape as before), but the student loop itself was not
  reviewed or touched, per scope.
- No pagination exists on this endpoint — response size still grows
  linearly with building count (7,162 bytes at N=25 currently); this was
  out of scope and unchanged, consistent with the Buildings-page
  BLD-05 finding being left open as well.
- No concurrent-load measurement was performed.

## Interpretation

The confirmed per-building N+1 pattern in `analysis_data()`'s
`occupancy_data` loop is resolved: query count dropped from `31 + 3N` to a
flat `31`, a 70.8% reduction at N=25, with **byte-identical response
payloads** at every measured N (the strongest available evidence of
unchanged correctness) and zero observed change in permissions, region
scoping, or any other endpoint behavior — confirmed by the unmodified
12-test `tests_analysis` suite passing unchanged and 3 new correctness
tests proving field-for-field equivalence to the original per-building
query logic, including every active/inactive/ended-assignment edge case
the original filters encoded. The allocation algorithm, allocation tests,
and every allocation-owned code path were not touched. The endpoint's
remaining flat 31-query base is documented above as the candidate for the
next investigation, not addressed in this phase.
