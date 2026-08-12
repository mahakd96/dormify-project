# Analysis API — Baseline Performance Measurement Summary

Prepared for external AI review. Self-contained summary of the Analysis
(`GET /api/analysis/`) baseline (measurement-only) phase of the Dormify
performance-optimization work. **No optimization has been implemented —
this is measurement only**, following the same Phase-1/Phase-2 pattern
already used for Buildings/Apartments/Rooms/Beds
(`BUILDINGS_BASELINE_SUMMARY.md` etc. in this folder).

## Context

- **Project:** Dormify (university dormitory allocation/management system).
- **Branch:** `donia-analysis-performance`.
- **Scope of this phase:** `GET /api/analysis/` (the `analysis_data()` view
  in `backend/api/views.py`) only. No other endpoint was measured or
  changed in this phase.
- **Ownership boundary respected:** `analysis_data()` reads
  `AllocationRun` (for `latest_run`), but this phase never created,
  asserted on, exercised, or drew any conclusion about allocation
  algorithm behavior. The allocation algorithm and its tests belong to
  other team members and were not touched.

## Endpoint and exact frontend usage

`GET /api/analysis/?region=<id>` (optionally `region_id=`/`region_name=`
for central admins; ignored for non-admins, who are always scoped to
their own region — `backend/api/views.py:6282-6308`).

Frontend caller: `analysisAPI.getData(regionId)`
(`src/services/api.js:716-727`), invoked from `AnalysisPage.js`'s
`fetchAnalysis()` (`src/pages/AnalysisPage.js:438-452`), which fires:
- once on initial page mount,
- once whenever the Region filter changes (`useEffect` on `filterRegion`,
  `AnalysisPage.js:462-465`),
- once when the user clicks the manual **Refresh** button.

Per the page's own "Data loading" comment (`AnalysisPage.js:433-437`):
choosing an Analyze tab (occupancy/available/demand/requests), Group-by,
Sort, and row selection are all **pure client-side reshaping** of the one
already-fetched payload — they never trigger a second network request.
So `GET /api/analysis/` is the *only* API call the Analysis page makes,
and it is called exactly once per page load / region change / refresh —
there is no "multiple expensive requests triggered by one page load"
pattern on the frontend side.

## Inspected files/functions

- `src/pages/AnalysisPage.js` — full data-loading path (`fetchAnalysis`,
  the one `useEffect` that calls it) and all client-side derivation
  (`buildingRows`, `regionRows`, `demandRows`, `requestRows`, `rows`,
  `sortedRows`) — confirmed these never re-fetch, only re-derive from
  `data`.
- `src/services/api.js:716-727` (`analysisAPI.getData`).
- `backend/api/urls.py:61` (`path('analysis/', views.analysis_data, ...)`).
- `backend/api/views.py:6282-6745` (`analysis_data()` in full) — every
  queryset, aggregate, and loop it runs.
- `backend/api/serializers.py` — `RegionSerializer`, `AllocationRunSerializer`,
  `ImportBatchSerializer` (used only for the two optional single-object
  fields `region`/`latest_run`/`latest_batch`; not exercised in a loop).
- `backend/api/tests_analysis.py` — existing behavior/scoping tests (12
  tests; run as part of this phase, unmodified — see "Tests run" below).
- `backend/api/performance_tests/test_buildings_performance.py` and
  `project-quality/performance/BUILDINGS_BASELINE_SUMMARY.md` /
  `PERFORMANCE_OPTIMIZATION_RESULTS.md` — used as the established
  methodology template (`CaptureQueriesContext` + `APIClient` + SQL-shape
  masking + `time.perf_counter()` + payload size).
- `project-quality/performance/PERFORMANCE_INSPECTION_SUMMARY.md` /
  `PERFORMANCE_OPTIMIZATION_PLAN.md` — read for context; neither currently
  documents an Analysis-specific finding, so this phase originates its own
  code-level suspicion (below) rather than testing a pre-existing one.

## Environment

Identical setup to the Buildings/Apartments/Rooms/Beds baselines:

- **Database measured against:** local, disposable PostgreSQL 16 via the
  `test_db` service already defined in `docker-compose.yml`
  (`dormify_test_db`, confirmed already running — `docker ps` showed
  `Up 9 hours` at the start of this session, so it did not need to be
  started for this phase). Django's own test runner additionally
  created/destroyed its own further-disposable `test_dormify_test`
  database inside that container for each run, exactly as with the prior
  baselines.
- **Real Azure/production database:** never connected to. All commands
  below were run with `ENV_FILE=.env.test`, the same pre-existing,
  non-secret, local-only env file used for the Buildings/Apartments/Rooms/
  Beds work (not re-created or modified in this phase).
- **Backend:** Django, DRF, local Python interpreter (not the Docker
  backend image), same as prior baselines.
- **Frontend/browser/network:** not involved. This measures the Django
  layer directly via DRF's `APIClient` (in-process, no real HTTP round
  trip) — isolates backend query + serialization cost only.

## Measurement method

New dedicated test module:
`backend/api/performance_tests/test_analysis_performance.py`, in the
existing `api/performance_tests/` package (alongside the Buildings/
Apartments/Rooms/Beds modules). Business-logic/permission/scoping tests
for Analysis remain untouched in `backend/api/tests_analysis.py`.

Same technique as every prior baseline in this folder:
- `django.test.utils.CaptureQueriesContext` around a
  `rest_framework.test.APIClient` GET request.
- SQL "shape" masking (`_shape()`: numeric literals → `#`) to collapse
  structurally-identical queries issued against different pks into one
  repeated pattern, via a `Counter`.
- `time.perf_counter()` wall-clock timing (server-side only).
- `len(response.content)` for payload size.
- Response status/shape sanity checks (`200`, correct
  `occupancy_data` row count) inside the same measurement helper.

### Exact commands run

```bash
# Local disposable test DB was already running (docker ps confirmed
# dormify_test_db "Up 9 hours"); not (re-)started in this phase.

cd backend
ENV_FILE=.env.test python manage.py check
ENV_FILE=.env.test python manage.py test api.tests_analysis -v 2
ENV_FILE=.env.test python manage.py test api.performance_tests.test_analysis_performance -v 2
# repeated 3 times total for reproducibility (identical query counts every time)
```

## Dataset (synthetic, created and torn down by the test itself)

**Dimension 1 — building count (primary, isolates the SQL-query-count
question):**
- 1 region, 1 dorm type, 1 `central_admin` user (`force_authenticate`).
- Per building: 2 apartments → 2 rooms/apartment → 2 beds/room, plus one
  `ACTIVE` `BedAssignment` on the first bed of the first room of the first
  apartment of every building — the exact same per-building shape used for
  the Buildings baseline, for direct comparability. Building count (N) is
  the controlled variable; the per-building shape underneath is held
  constant.
- Measured at **N = 1, 5, 25 buildings**, each a fully independent,
  isolated measurement (`_reset_all()` between runs).

**Dimension 2 — student volume (secondary; added and justified below):**
- `analysis_data()` also runs a Python-side loop over every `Student` row
  (`for student in students_qs.select_related(...)`, `views.py:6567-6594`)
  to build `students_by_region`/`students_by_region_demand` — **one** SQL
  query (via `select_related`), but O(students) **Python** work per row
  (region-name resolution, dict bucketing). This is a categorically
  different cost (interpreter time, not query count) from the per-building
  SQL-query loop, so it cannot be assumed to scale the same way and was
  measured separately rather than folded into Dimension 1 or skipped.
- Method: building count held fixed at N=5; **S = 50 vs S = 500** *extra*
  unassigned students layered on top (no `BedAssignment`, so they land in
  `unassigned_students`/`unassigned_by_region` without touching
  `occupancy_data`, keeping this dimension orthogonal to Dimension 1).

## Results — Dimension 1: building count

| Buildings (N) | Total SQL queries | Distinct query shapes | Queries / building | Server-side time (ms, 3 runs) | Response size (bytes) |
|---:|---:|---:|---:|---:|---:|
| 1  | 34  | 34 | 34.00 | 41–49    | 1,324 |
| 5  | 46  | 34 | 9.20  | 58–60    | 2,292 |
| 25 | 106 | 34 | 4.24  | 141–156  | 7,162 |

- **Marginal queries per additional building:** `(46−34)/(5−1) = 3.00` and
  `(106−46)/(25−5) = 3.00` — identical across both intervals.
- **Linear fit:** `total_queries = 31 + 3 × N` fits all three points
  exactly (34 = 31+3·1, 46 = 31+3·5, 106 = 31+3·25) — zero residual.
- **Reproducibility:** the full 3-test module (all three N values plus the
  student-volume dimension) was run **3 times end-to-end**; total/distinct
  query counts were **byte-identical every time** (34/46/106, 34 distinct
  shapes throughout). Only wall-clock timing varied run to run, as
  expected.
- **Base (fixed, per-request) query count:** 31 — the ~28 single
  aggregate/count/values_list queries `analysis_data()` runs once
  regardless of N (summary KPIs, 5 `students_by_*` distributions,
  `transfers_by_status`/`transfers_by_type`, `pending_requests_by_type`,
  `latest_run`, `latest_batch`/`RegionInbox` lookup, `dorm_types_for_region`,
  `region_name_to_id`, the one `students_qs.select_related(...)` loop
  query, plus DRF auth/permission overhead) — none of these were the
  target of this phase's suspicion and none showed per-building growth.

### Confirmed duplicate/repeated query pattern (per-building, all 3 N values)

| Shape | Occurrences at N=25 | Source |
|---|---:|---|
| `SELECT api_room.capacity FROM api_room JOIN api_apartment JOIN api_building JOIN api_dormtype ...` | ×25 (1/building) | `backend/api/views.py:6657-6659` — `building_capacity = sum(building_rooms_qs.values_list('capacity', flat=True))` |
| `SELECT COUNT(*) FROM (SELECT DISTINCT api_bedassignment.bed_id ...)` | ×25 (1/building) | `backend/api/views.py:6661-6663` — `building_assigned_beds = assignments_qs.filter(bed__room__apartment__building=building).values('bed_id').distinct().count()` |
| `SELECT COUNT(*) AS __count FROM api_room JOIN api_apartment JOIN api_building JOIN api_dormtype ...` | ×25 (1/building) | `backend/api/views.py:6689` — `'rooms_count': building_rooms_qs.count()` |

This is an **exact, empirical confirmation** of the pattern flagged before
measurement: for every building in the `occupancy_data` loop
(`views.py:6648-6698`), the code separately queries (1) building capacity,
(2) assigned/occupied beds, and (3) room count — three independent
round trips per building row, none of which reuse a value already fetched
for a sibling field in the same iteration. All three are per-building
`COUNT`/`values_list` queries that a single DB-side `annotate()` (as was
done for Buildings/Apartments/Rooms/Beds) could in principle replace with
zero marginal queries — **but that optimization is explicitly out of scope
for this phase** and was not implemented.

## Results — Dimension 2: student volume (buildings fixed at N=5)

| Extra unassigned students (S) | Total SQL queries | Server-side time (ms) | Response size (bytes) |
|---:|---:|---:|---:|
| 50  | 46 | 76.87 | 2,297 |
| 500 | 46 | 80.56 | 2,308 |

- **Query count is exactly flat** (46 → 46, Δ=0) across a 10× change in
  student volume — confirms the `students_by_region` loop is genuinely a
  single query, as the code's structure (`select_related` before the
  `for` loop) suggests.
- **Timing:** +3.7 ms (76.87 → 80.56 ms) for 10× the students in this one
  comparison — small in absolute terms and within the noise band observed
  for repeated runs of the *same* N in Dimension 1 (±10-15 ms). **Not
  large enough, from a single comparison, to confirm the Python-loop cost
  as material** — see "Hypotheses that remain unconfirmed" below.

## Timing and payload — summary

- Server-side time (DRF `APIClient`, no real HTTP/network/Azure layer)
  grew from ~41-49 ms at N=1 to ~141-156 ms at N=25 — roughly proportional
  to query count growth, consistent with each extra query costing a
  measurable, non-trivial fraction of the total.
- Response payload grew from 1,324 bytes (N=1) to 7,162 bytes (N=25) —
  linear in N, as expected (`occupancy_data` is one JSON object per
  building; no pagination on this endpoint).

## Confirmed by measurement vs. code-level suspicion

**CONFIRMED BY MEASUREMENT:**
- `GET /api/analysis/`'s total SQL query count scales **linearly** with
  the number of *active* buildings in the requested scope:
  `total_queries = 31 + 3 × N`, reproduced identically across 3 full test
  runs.
- The 3 marginal queries per building are exactly the three the
  pre-measurement code inspection named — building capacity
  (`views.py:6657-6659`), assigned/occupied beds (`views.py:6661-6663`),
  and room count (`views.py:6689`) — each issued as an independent query
  inside the `for building in buildings_qs...` loop, none reused between
  the three per-building fields.
- Query count for this endpoint is **independent of student volume**
  (flat at 46 queries for both S=50 and S=500 extra students, buildings
  fixed at N=5) — the `students_by_region`/`students_by_region_demand`
  construction is a single query regardless of how many students it
  iterates over in Python.
- The endpoint is called **exactly once** per Analysis-page load/region
  change/refresh — no multi-request fan-out from the frontend.
- `python manage.py check` reports no issues; the pre-existing 12-test
  `api.tests_analysis` suite passes unchanged, both before and alongside
  this work.

**CODE-LEVEL SUSPICION / HYPOTHESIS — NOT CONFIRMED BY THIS BASELINE:**
- Whether the 3-queries-per-building pattern is *the* dominant cost of
  real-world `/api/analysis/` latency, versus the 31-query fixed base, at
  production-scale region sizes (real regions were not measured — only
  synthetic data up to 25 buildings).
- Whether the small (+3.7 ms) timing delta observed for a 10× student-count
  increase in Dimension 2 reflects a real, growing Python-loop cost, or is
  within normal measurement noise — this baseline's one comparison point
  is not statistically conclusive either way; a wider sweep (e.g. S=50 /
  500 / 5,000 / 50,000, repeated per point) would be needed to confirm or
  refute a material per-student CPU cost independent of query count.
- Whether `total_capacity`/`total_rooms`/etc. (the *global*, non-per-building
  aggregates computed once, before the loop) would themselves show
  different scaling characteristics at much larger single-region row
  counts (e.g. tens of thousands of rooms) — not exercised by this
  dataset size.
- Whether extrapolating `31 + 3N` to real production building counts (not
  separately measured) predicts real observed latency — e.g. a region
  with 100 buildings would be predicted to issue ~331 queries, but this is
  an extrapolation of the fitted line, not a separate measurement.

## Limitations

- **No real network/Azure latency measured** — `APIClient` only (in-process,
  no HTTP round trip); isolates backend query + serialization cost.
- **No real production data volume measured** — synthetic, up to 25
  buildings / 500 extra students. Real regions may have more or fewer
  buildings, students, or a different data-skew profile.
- **Frontend render time not measured.**
- Timing numbers (41–156 ms range) reflect Python/ORM/serialization cost
  on this local machine only — not a promise about production latency.
- The student-volume dimension used only two data points (S=50, S=500);
  it is sufficient to confirm query-count flatness (deterministic) but not
  sufficient to draw a firm conclusion about a timing trend (noisy,
  see above).
- This baseline did not measure the endpoint under concurrent load / with
  multiple simultaneous requests.

## Exact files created/changed in this phase

- `backend/api/performance_tests/test_analysis_performance.py` — new
  measurement/regression test module, `GET /api/analysis/` only. No
  production code touched.
- `project-quality/performance/evidence/ANALYSIS_BASELINE_QUERY_COUNTS.txt`
  — raw evidence, regenerated by the test itself each run (this copy is
  from the final run of this phase).
- `project-quality/performance/evidence/ANALYSIS_BASELINE_TEST_RUN_LOG.txt`
  — full `manage.py test -v 2` console output for one complete run.
- `project-quality/performance/PERFORMANCE_OPTIMIZATION_RESULTS.md` —
  updated with a new, clearly separate **"Analysis API — Baseline"**
  section (existing Buildings/Apartments/Rooms/Beds sections left
  byte-for-byte unchanged).
- `project-quality/performance/ANALYSIS_BASELINE_SUMMARY.md` — this file.

**Not modified:** any Django view, serializer, model, migration, React
component, Django setting, Docker configuration, `.env`/`.env.test`,
business rule, permission/role logic, region-isolation logic, pagination,
or **the allocation algorithm / allocation tests** (explicitly out of
scope and untouched — `AllocationRun` was only ever read, never created or
modified, by this phase's fixtures).

**Docker state:** the local `test_db` container (`dormify_test_db`) was
already running before this phase started (confirmed via `docker ps`, not
(re-)started by this work) and was left running for reuse in later phases.

## Tests run and results

| Command | Result |
|---|---|
| `ENV_FILE=.env.test python manage.py check` | No issues (0 silenced) |
| `ENV_FILE=.env.test python manage.py test api.tests_analysis -v 2` | **12/12 passed**, unchanged (pre-existing scoping/behavior tests) |
| `ENV_FILE=.env.test python manage.py test api.performance_tests.test_analysis_performance -v 2` | **3/3 passed**, run 3 times total — query counts (34/46/106) identical every run |

## Recommendation for the next phase

Per this phase's explicit stop condition, no optimization is proposed for
implementation yet — this is a record of measured facts for review. If a
follow-up optimization phase is approved, the confirmed 3-queries-per-building
pattern (`views.py:6657-6659`, `6661-6663`, `6689`) is the best-evidenced
candidate to address first, using the same DB-side `annotate()`/`Subquery`
approach already applied and verified for `BuildingViewSet` (BLD-01),
`ApartmentViewSet` (BLD-02), `RoomViewSet` (BLD-03), and `BedViewSet`
(BLD-04) — i.e. compute `building_capacity`, `building_assigned_beds`, and
`rooms_count` as correlated subqueries inside the single `buildings_qs`
list query, eliminating the `3 × N` term entirely and leaving the fixed
31-query base as the dominant cost at any building count. Any such change
must, per the ownership boundary, avoid altering the `AllocationRun`
(`latest_run`) read path or any other allocation-owned logic, and should
be re-measured with this same test module (against a new, non-overwriting
evidence file, mirroring the Buildings `_AFTER_` pattern) before being
considered complete.
