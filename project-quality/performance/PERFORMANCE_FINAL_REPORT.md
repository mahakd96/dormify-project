# Dormify Backend Performance — Final Report

**Status: primary and complete performance reference document.** This
report is self-contained: it synthesizes the backend performance
investigation, fixes, follow-up verification, and analysis carried out
across the project's performance-optimization effort, and its conclusions
do not depend on any other document.

---

## 1. Purpose and Scope

The goal of this work was to identify and remove database-query
inefficiencies (N+1 query patterns, redundant queries, unbounded data
loads) in Dormify's Django REST backend, measure their impact, fix the
confirmed problems, and verify that fixes did not change API behavior,
permissions, or business logic.

Two related work streams make up this effort:

1. **Dorm inventory endpoints (Buildings, Apartments, Rooms, Beds, and a
   pagination analysis)** — referred to as BLD-01 through BLD-05.
2. **A broader backend audit and implementation phase**
   covering the Analysis endpoint's remaining query cost, the
   Transfers/Requests pages, the Home Dashboard, Student detail, Reports/
   exports, and database/runtime configuration.

All measurements were taken with Django REST Framework's in-process
`APIClient` against a local, disposable PostgreSQL 16 Docker test
database (`ENV_FILE=.env.test`). **No measurement in this body of work
reflects real HTTP network latency, TLS negotiation, or the real
managed production database** — this limitation applies to every
number in this report and is restated in Section 12.

---

## 2. Main Performance Problems Identified

- **Buildings, Apartments, Rooms, and Beds list endpoints** each had
  `SerializerMethodField`/model-property computations that issued one or
  more SQL queries per row, producing query counts that scaled linearly
  with the number of objects returned (an N+1 pattern), with some
  internal duplication (the same count re-queried more than once per
  row).
- **The Requests page** (`GET /api/requests/`, backing `TransfersPage.js`
  in the frontend — the page actually used for transfer/request
  management) had a severe N+1: rendering a single 25-row page cost
  **127 SQL queries**.
- **The Transfers endpoint** (`GET /api/transfers/`, a separate,
  currently-unused-by-the-frontend endpoint) had an equivalent N+1,
  scaling to **401 queries at 100 rows**.
- **The Analysis endpoint** had already had its dominant per-building N+1
  fixed in earlier work; a fixed-cost inspection found further redundant
  and wasted queries within its flat query count.
- **The Home Dashboard, Student detail, and Reports/exports** had smaller,
  non-scaling inefficiencies: duplicate queries, a missing
  `select_related`, and redundant Python-side passes over data.
- **Two database/runtime configuration items** — `CONN_MAX_AGE = 0`
  against what is very likely a remote, TLS-secured managed cloud environment Postgres host,
  and the backend Docker configuration running Django's development
  server with no production WSGI server present in `requirements.txt` —
  were identified by static configuration inspection; their real-world
  latency impact could not be measured locally.

---

## 3. Root Causes

- **Per-row serializer computation without prefetching:** `SerializerMethodField`s and model `@property`s that ran their own query, evaluated once per row in a list response, with no `select_related`/`prefetch_related` on the underlying queryset to satisfy them in bulk.
- **Internal duplication:** the same underlying data queried more than once within a single request — e.g. `is_full` re-running `available_beds`'s two queries (Rooms); `destination_regions` declared as both a writable field and a separate method field, each independently querying the same many-to-many relation (Requests); `get_current_bed_id`/`get_current_bed_label` each independently invoking the same uncached property (Student detail).
- **Missing `select_related` on forward foreign-key fields** consumed by a serializer (e.g. `source_region` on Requests, `region` on Home Dashboard's inbox lookup, `batch` on Student detail).
- **Unconditional computation of values later discarded**, and **querysets evaluated multiple times for overlapping counts** where a single grouped/aggregate query would suffice (Analysis's summary-numbers section, Home Dashboard's inbox counts).
- **Redundant Python-side passes** over an already-materialized list for structurally identical computations (three of five sheet-builders in the manual review report independently re-deriving the same per-student validation result).
- **A shared data loader fetching data a specific caller never uses** (the capacity report loading Student rows it never reads).

---

## 4. Improvements Implemented

### Dorm inventory endpoints (Buildings/Apartments/Rooms/Beds)

Each of the four `ViewSet.get_queryset()` methods was wrapped in a
dedicated annotation helper in `backend/api/views.py`
(`_annotate_building_inventory_counts`,
`_annotate_apartment_inventory_counts`, `_annotate_room_inventory_counts`,
`_annotate_bed_occupancy`), using correlated `Subquery`/`Exists` +
`Coalesce` annotations (and, for Rooms, derived `Case`/`When`/`Greatest`
expressions to preserve an existing active/inactive short-circuit as a SQL
branch). The corresponding serializer fields were changed to
`SerializerMethodField`s that read the annotation first, falling back to
the original per-row computation when the annotation is absent (e.g. for
objects not built through the viewset's queryset).

### Requests / Transfers (Priority 1–2)

`StudentRequestViewSet.get_queryset()` gained
`select_related('source_region')` and `prefetch_related` entries for
`destination_regions` and two distinct `Prefetch` objects on
`student__bed_assignments` (one for the single active assignment, one for
the most-recent-10 placement history). The serializer's `get_current_bed`
and `get_placement_history` read these prefetch caches first, falling
back to the original query. A correctness fix was required in
`StudentRequestViewSet.approve()`: because approval can mutate the
student's bed assignment within the same request, the two prefetch caches
are explicitly invalidated before the response is built, so the response
reflects the post-approval state rather than a stale prefetch.

`TransferViewSet.get_queryset()`'s `select_related` was extended to cover
the full chains `TransferSerializer` reads (`from_room__apartment`,
`from_room__apartment__building`, `to_room__apartment`,
`to_room__apartment__building`, `requested_by__region`). No pagination was
added to this endpoint; it remains unpaginated by design, with a test
asserting the response stays a plain list.

### Requests placement-history follow-up (bounded per-student history fetch)

A targeted follow-up examined the `placement_history` prefetch introduced
by the Requests fix above. The original prefetch pulled each relevant
student's **entire** `bed_assignments` history (no database-side `LIMIT`)
and sliced it to the most-recent 10 in Python, which kept the query count
flat but meant Postgres returned and Django hydrated every historical row
per student — a data-volume cost that is not bounded by page size and
grows with each student's own lifetime assignment count. At a stress
scale of 25 requests, each pointing at a distinct student with 100
historical `BedAssignment` rows, this measured a **10.0x overfetch**:
2,500 rows loaded into Python to serve 250 actually used.

This was judged clearly problematic and fixed at the database level: a
new helper builds a `BedAssignment` queryset bounded to each student's 10
most-recent rows via a `ROW_NUMBER() OVER (PARTITION BY student_id ORDER
BY assigned_at DESC, id DESC)` windowed subquery (Django's ORM disallows
filtering directly on a `Window()` annotation, so this is expressed as a
small raw-SQL subquery referenced through `pk__in=RawSQL(...)`), and the
existing `Prefetch` on `student__bed_assignments` now uses that bounded
queryset instead of an unbounded one. The `id DESC` tiebreak is a minor
determinism improvement over the original (untied) ordering. No
serializer logic changed — the existing `[:10]` Python slice remains in
place as a now-harmless no-op.

### Report export HTTP-path verification

A gap was identified in report-export test coverage: the existing report
tests called the report-generation functions directly and never
exercised the actual HTTP view layer that wraps them
(`_excel_response()`, shared by all 5 Excel report endpoints —
`dormify_report`, `student_allocation_report`, `student_actions_report`,
`capacity_report`, `manual_review_report`). That view-layer code path had
a `NameError: name 'HttpResponse' is not defined` (a missing `from
django.http import HttpResponse` import) that manual smoke testing had
already found and fixed, but which no automated test could have caught,
since none of them went through `_excel_response()`. New HTTP-level
regression tests were added that call all 5 report endpoints through
Django's real URL router → permission classes → view → `_excel_response()`
path (via `APIClient` with `force_authenticate()`), asserting a 200
status, correct `.xlsx` content type and `Content-Disposition` header,
and a workbook that `openpyxl` can actually load. The central-admin-only
permission check on `dormify_report` is also verified to reject a
non-admin caller with 403.

### Analysis (Priority 3)

The `analysis_data()` summary-numbers section was restructured: the
unconditionally-computed-then-discarded building counts were made
conditional; the rooms group's separate row-fetch + count was replaced
with one `aggregate(Sum(...), Count(...))` call; the assignments group's
three separate queries were consolidated into one fetch of
`(student_id, bed_id)` pairs with counts derived in Python; the
transfers and requests groups' separate `.count()` queries were replaced
by deriving totals from already-computed grouped counts.

### Home Dashboard, Student detail, Reports (Priority 4–6)

- Home Dashboard: `latest_inbox`'s `select_related` was extended to
  include `'region'`; the admin-only `pending_inbox_count`/
  `viewed_inbox_count` pair was consolidated into a single grouped-count
  query. A separate finding — `AllocationRun` being queried four times
  for different, genuinely non-overlapping filters — was investigated and
  **deliberately left unchanged**, because no available consolidation
  could preserve `has_completed_run`'s correctness without assuming an
  allocation-system invariant not established in this work.
- Student detail: a small caching helper eliminated the duplicate
  `BedAssignment` query behind `current_bed_id`/`current_bed_label`;
  `select_related('batch')` was added for non-list actions only (the list
  action and its serializer were left untouched).
- Reports: `manual_review_report`'s three structurally-identical
  validation passes were consolidated into one shared computation reused
  by all three; `capacity_report` was changed to skip loading Student
  data it never uses, via a new `include_students` parameter on the
  shared data loader (default preserved for every other caller).

---

## 5. Baseline → After Measurements

### Dorm inventory endpoints

| Endpoint | N | Queries before | Queries after | % reduction |
|---|---:|---:|---:|---:|
| `/api/buildings/` | 1 | 8 | 2 | 75.0% |
| `/api/buildings/` | 5 | 32 | 2 | 93.75% |
| `/api/buildings/` | 25 | 152 | 2 | 98.7% |
| `/api/apartments/` | 1 | 6 | 1 | 83.3% |
| `/api/apartments/` | 5 | 26 | 1 | 96.2% |
| `/api/apartments/` | 25 | 126 | 1 | 99.2% |
| `/api/rooms/` | 1 (active) | 8 | 1 | 87.5% |
| `/api/rooms/` | 5 (active) | 36 | 1 | 97.2% |
| `/api/rooms/` | 25 (active) | 176 | 1 | 99.4% |
| `/api/rooms/` | 1 (inactive) | 4 | 1 | 75.0% |
| `/api/beds/` | 1 | 2 | 1 | 50.0% |
| `/api/beds/` | 10 | 11 | 1 | 90.9% |
| `/api/beds/` | 50 | 51 | 1 | 98.0% |

Every one of these endpoints now returns a small flat query count (1 or
2) regardless of how many rows are returned.

### Requests, Transfers, Analysis, Home Dashboard, Student detail, Reports

| Endpoint/area | Queries before | Queries after | Notes |
|---|---:|---:|---|
| `GET /api/requests/` (N=25, region-transfer scenario) | 127 | 5 | 96.1% reduction; flat at N=1/25/100 after the fix (marginal cost 0.00 queries/request, vs. ~5.0/row before) |
| `GET /api/transfers/` (N=100) | 401 | 1 | 99.8% reduction; flat at N=1/25/100 after the fix (101 queries measured at N=25 before) |
| `GET /api/analysis/` (any N) | 31 | 23 | Flat before and after; the per-building N+1 behind this endpoint had already been fixed in earlier work — this is a fixed-cost cleanup on top of that |
| `GET /api/home/` (central_admin) | 17 | 16 | |
| `GET /api/home/` (region_boss) | 15 | 14 | |
| `GET /api/students/{id}/` | 3 | 2 | Duplicate `BedAssignment` query eliminated (2 identical queries → 1) |
| `generate_capacity_report()` | includes 1 unused Student query | 0 Student queries | |
| `generate_manual_review_report()` | 5 full Python passes over all students | 3 full passes | Python/CPU cost, not a query count |

Timing figures reported alongside these measurements (all via the
in-process `APIClient`, not real network conditions): the Requests page
dropped from approximately 572 ms to roughly 130–145 ms at N=25; the
Analysis assignments consolidation was separately validated at 2,000
synthetic `BedAssignment` rows in one region, completing in 245 ms
(against a 5-second sanity ceiling), with results matching the original
per-row query logic exactly.

Response payload sizes were confirmed unchanged in shape/content: the
Analysis endpoint's response was verified byte-identical before and
after its cleanup at every tested N (1,324 / 2,292 / 7,162 bytes);
Requests and Transfers payload sizes were confirmed to reflect the same
underlying rows, not a smaller or truncated response.

### Requests placement-history data volume (before/after the bounded-fetch follow-up)

This is a row-volume fix, not a query-count fix — the query count stayed
flat at 5 both before and after (25 requests, one active assignment
prefetch and one placement-history prefetch, plus pagination overhead),
measured under a stress scenario of 25 requests each pointing at a
distinct student with 100 historical `BedAssignment` rows:

| Metric | Before | After |
|---|---:|---:|
| Total SQL queries | 5 | 5 |
| Server-side request time | 374.97 ms | 164.47 ms |
| Response payload | 77,532 bytes | 77,532 bytes (unchanged) |
| `BedAssignment` rows loaded into Python | 2,500 | 250 |
| `BedAssignment` rows actually used | 250 | 250 |
| Overfetch ratio | 10.0x | 1.0x |

Correctness was unaffected throughout: for all 25 requests,
`placement_history` had exactly 10 entries, matched independently
computed ground truth entry-by-entry, stayed strictly ordered
most-recent-first, and its first entry was always the student's active
assignment — both before and after the fix (this was a data-volume
problem, not a correctness bug).

---

## 6. SQL / Query-Count Improvements — Summary

Query-count reductions ranged from roughly 50% (single-row Beds request)
to 99.8% (100-row Transfers request), with every fixed endpoint moving
from a linear, row-count-dependent query pattern to a flat, constant
query count. The two largest reductions in absolute terms were the
Requests page (127 → 5 queries at N=25) and the Transfers endpoint
(401 → 1 query at N=100) — both were N+1 patterns caused by missing
`select_related`/`prefetch_related` on relations read by their
serializers.

---

## 7. Pagination Analysis and Conclusion

A dedicated pagination analysis examined whether the four dorm inventory
endpoints — unpaginated by default — should have pagination added, now
that their query-count problem is fixed.

**Classification: NOT CURRENTLY NECESSARY.** Three lines of evidence
converged:

1. The query-scaling problem pagination would traditionally address is
   already solved (flat query counts, Section 5).
2. Measured response payloads stay small at tested scale — approximately
   294 bytes/building, 470 bytes/apartment, 283 bytes/room, and 114
   bytes/bed, giving totals in the low tens of KB at N=25–50, and
   extrapolated (not directly measured) to roughly 294 KB / 470 KB / 283
   KB / 114 KB respectively at 1,000 rows.
3. The frontend (`BuildingsPage.js`) currently assumes it has received
   the *complete* list for client-side search, filtering, and summary
   totals. Its `asArray()` helper tolerates a paginated response shape
   without crashing, but no code path follows a `next` link or
   accumulates multiple pages — enabling pagination today would silently
   truncate the data those computations use, a functional regression
   rather than a clean failure.

This conclusion is explicitly reasoning from synthetic data and stable
per-row byte costs, not a measurement against real production row counts,
and the analysis names the conditions that would warrant revisiting it
(materially larger real building/apartment/room counts than assumed, a
product requirement to browse larger lists, or a future move to
server-side filtering).

Separately, `GET /api/requests/` **is** paginated (25/page) and the
backend correctly honors that; the confirmed gap is that its one frontend
consumer does not read the `next` link, so results beyond the first page
are not shown regardless of how cheap the backend fetch is (see Section
11). `GET /api/transfers/` has no `pagination_class` at all and returns
an unbounded plain array; this was left unpaginated because the endpoint
is not currently called by any frontend code, and adding pagination
without a caller to verify against was judged higher-risk than leaving it
as a documented, tested contract.

---

## 8. Performance-Related Backend Changes

All changes were backend-only, made in three files:

- **`backend/api/views.py`** — new queryset-annotation helper functions
  for Buildings/Apartments/Rooms/Beds; `select_related`/
  `prefetch_related` additions and `approve()` cache-invalidation logic on
  `StudentRequestViewSet`; extended `select_related` on
  `TransferViewSet`; restructured summary-numbers section in
  `analysis_data()`; `select_related`/grouped-count changes in
  `home_dashboard()`; an additional `select_related('batch')` branch on
  `StudentViewSet.get_queryset()` for non-list actions.
- **`backend/api/serializers.py`** — annotation-first-with-fallback
  changes to the affected `SerializerMethodField`s on
  `BuildingSerializer`, `ApartmentSerializer`, `RoomSerializer`,
  `BedSerializer`, `StudentRequestSerializer`, and a caching helper on
  `StudentSerializer`.
- **`backend/api/report_exports.py`** — a shared `_compute_student_issues`
  helper and an `include_students` parameter on the shared data loader.

No model, migration, URL routing, permission class, Django setting,
Docker configuration, or frontend file was modified as part of any of
these fixes. The allocation subsystem (`backend/allocation/`) was read
in places (e.g. by the Home Dashboard) but never edited.

---

## 9. Regression / Safety Verification

The following were explicitly verified unchanged across the dorm
inventory fixes: permissions, role checks, region-isolation filtering,
business-rule conflict checks (occupancy/capacity, gender/category),
the allocation algorithm, API response field names/order/types, and the
database schema (no migrations were created or needed, since every
change is a queryset-level `.annotate()`).

For these fixes, each change was covered by a dedicated
correctness test comparing optimized output against either hand-computed
expected values or the original pre-optimization query logic run
directly against the same data. Notably:

- The Requests fix includes a test specifically constructed to catch the
  `approve()` prefetch-staleness scenario — creating an assignment,
  approving a request that moves the student, and asserting the response
  reflects the new bed, not a stale cached value.
- The Analysis assignments consolidation (the one genuinely Python-side
  trade among the Analysis changes) was validated at 2,000 synthetic
  `BedAssignment` rows, not assumed safe at small scale alone.
- The Reports consolidation was validated by generating real workbooks
  and parsing all sheets via `openpyxl`, confirming row membership and
  counts match hand-computed expectations, including for the two report
  builders that were left unchanged.
- The placement-history bound was verified to leave the endpoint's
  correctness contract unchanged and to leave the `approve()`
  stale-prefetch-cache protection intact: after the change, a mid-request
  mutation still correctly invalidates the prefetch cache and the
  response reflects the fresh assignment.
- The report-export HTTP-path tests were proven to actually catch the
  bug they were built for: with the `HttpResponse` import deliberately
  removed, all 7 tests failed with the exact `NameError` traceback that
  manual smoke testing had originally found; with the import restored,
  all 7 passed. This confirms the new tests would catch a regression of
  that specific bug, not just exercise the happy path.

A manual smoke test of the running application (login, Buildings page
load, building/apartment/room/bed selection, count/data display) was
performed for the dorm inventory work and reported as passed, with no
functional regression observed and the page noticeably faster.

---

## 10. Relevant Test Results

| Suite | Result |
|---|---|
| Django system check (`manage.py check`) | No issues, run repeatedly throughout, always clean |
| Dorm inventory performance tests (`api.performance_tests`, Buildings/Apartments/Rooms/Beds) | 21/21 passed |
| Inventory business logic/permissions (`api.tests_inventory`) | 41/41 passed, unchanged |
| Assisted allocation (`api.tests_assisted_allocation`) | 40/40 passed |
| Allocation solver + run lifecycle (`api.tests_allocation`, 155 tests) | 153/155 passed — 2 failures, assessed as unrelated (see Section 11) |
| Requests performance/correctness (`api.performance_tests.test_requests_performance`) | 6/6 passed |
| Transfers performance/correctness (`api.performance_tests.test_transfers_performance`) | 2/2 passed |
| Analysis performance/correctness (`api.performance_tests.test_analysis_performance`) | 8/8 passed |
| Home Dashboard performance/correctness (`api.performance_tests.test_home_dashboard_performance`) | 4/4 passed |
| Student detail performance/correctness (`api.performance_tests.test_student_detail_performance`) | 4/4 passed |
| Reports performance/correctness (`api.performance_tests.test_reports_performance`) | 3/3 passed |
| Analysis business logic (`api.tests_analysis`) | 12/12 passed, unchanged |
| Students list performance (`api.tests_students_performance`) | 8/8 passed, unchanged |
| Full combined regression sweep (Analysis, Requests, Transfer regions, Home Dashboard, Students performance, Inventory, all performance tests, one process) | 153/153 passed |
| Placement-history bounded-fetch verification (new) | 2/2 passed |
| Placement-history fix + existing Requests/Transfers business-logic suites (`test_requests_performance`, `test_transfers_performance`, `tests_requests`, `tests_transfer_regions`) combined | 40/40 passed |
| Full `api.performance_tests` package re-run after the placement-history fix (Buildings/Apartments/Rooms/Beds, Analysis, Home Dashboard, Student detail, Reports, Transfers, Requests, placement-history) | 50/50 passed |
| Report export HTTP-path regression tests (new — `test_report_http_regression`) | 7/7 passed |
| Report HTTP-path tests + existing report-content tests (`test_reports_performance`) combined | 10/10 passed |

All test runs used the local disposable PostgreSQL test database; the
real production database was never connected to at any point in this work.

---

## 11. Remaining Performance Risks and Limitations

These are open items, not fixed problems, and are preserved here as
genuine limitations rather than resolved:

- **Real production network/database latency** for every endpoint measured across this
  entire body of work is unmeasured — all figures come from an in-process
  API client with no real HTTP round trip, TLS handshake, or database
  network hop.
- **`CONN_MAX_AGE = 0`** in `backend/dormify/settings.py`, combined with
  a database configuration that defaults to requiring SSL and a host
  consistent with a managed managed cloud environment Postgres instance, means every request
  opens and closes a fresh database connection. The real latency cost of
  this against the production host was not measured and requires
  real-environment measurement before any configuration change is
  justified.
- **No production WSGI/ASGI server** (e.g. gunicorn) appears in the
  backend's `requirements.txt`; the Docker image and compose
  configuration run Django's development server. Whether the actual
  deployed environment overrides this at the platform level was not
  determined by repository inspection alone.
- **No connection pooling** is configured; a decision here depends on
  first resolving the two items above.
- **The Requests page frontend does not follow pagination**: it reads
  only the first page of `GET /api/requests/` and never requests
  subsequent pages, so more than 25 matching requests are not shown
  regardless of how cheap the backend fetch now is. This is a frontend
  behavior gap, not a backend query-efficiency problem, and was not
  changed as part of this work.
- **Client-side filtering on the Requests page** duplicates filtering the
  backend already supports server-side, and every approve/reject action
  triggers a full list reload rather than a local state update. Both are
  frontend-coupled and unresolved.
- **`dormify_report`** (one of five report exports) loads the entire
  system's student/bed/assignment data with no region-scoping option and
  is not currently wired to any button in the frontend. Its real severity
  depends entirely on real production row counts, which were not
  available; no structural change was made without that evidence.
- **`icontains` free-text search** on Student/StudentRequest fields is a
  known scaling concern for large tables in general, but no slow query
  was observed at the synthetic scale tested in this work; a specific
  index recommendation was not made without real-scale evidence.
- **Two allocation-suite test failures** (`ActiveRunTest.test_returns_completed_draft`
  and `SolverSharedFacilityRoomTest.test_existing_occupant_affects_second_bed_choice`)
  were observed during a broad regression sweep. Code-path analysis
  indicates neither is reachable from any file changed in this work (they
  involve allocation-run status handling and the solver's placement logic
  respectively, not the Buildings/Apartments/Rooms/Beds/Requests/Transfers
  code paths that were modified), but this was not formally verified
  against the pre-work state of the codebase, so they should be treated
  as unrelated-but-unconfirmed rather than proven pre-existing.
- **Browser/frontend render time**, the Analysis endpoint's own
  computation cost beyond query count, and the assisted-allocation
  computation were not profiled or measured in this work.
- **All measurements used synthetic data** created and torn down by test
  code; no real production data volume, skew, or index behavior was
  observed, and no `EXPLAIN ANALYZE` or database-side query-plan
  inspection was performed anywhere in this work.
- **The placement-history bound's windowed raw-SQL subquery**
  (`ROW_NUMBER() OVER (PARTITION BY student_id ...)`) has not been
  measured against the real Postgres query planner at production data
  volumes (years of `BedAssignment` history across the full student
  population) — only against the local disposable test database. It
  should be confirmed there before being treated as fully validated in
  production.

---

## 12. Conclusion

The backend query-efficiency problems identified across the dorm
inventory endpoints, the Requests page, the Transfers endpoint, the
Analysis endpoint's remaining fixed-cost queries, the Home Dashboard,
Student detail, and two report exports have been fixed, measured, and
covered by dedicated correctness and query-count regression tests. Every
fixed endpoint moved from a query count that scaled with the number of
rows returned to a small, flat, constant query count, with reductions
measured up to 99.8% at the tested scale. Pagination was analyzed for the
dorm inventory endpoints and found not currently necessary, given that
the query-scaling problem it would address is already solved and current
payload sizes remain modest. Two targeted follow-up verifications closed
out remaining gaps: the Requests page's placement-history prefetch was
found to overfetch historical data by 10x at stress scale and was bounded
at the database level (10.0x → 1.0x, with query count and payload
unchanged); and a coverage gap in the Excel report endpoints' HTTP path
was closed with new tests that were proven, before-and-after, to catch a
real bug (a missing import causing every report download to fail) that
existing tests could not have detected.

This is a **local, backend-only completion**, not a claim of full
production readiness. Real-environment validation is still required for
database connection configuration (`CONN_MAX_AGE`, WSGI server,
connection pooling), the unbounded system-wide report export, and search
scaling at real data volume — none of which can be resolved through
local measurement alone. Coordinated frontend changes are still required
before the Requests page's pagination is actually used, before its
filtering moves server-side, and before actions avoid a full-list reload.
No allocation logic, frontend code, model, migration, or deployment
configuration was modified as part of this work, and the two allocation
test failures noted above remain open and unresolved.

This report is the complete, self-contained record of the backend
performance-optimization effort: every problem, fix, measurement, test
result, and open risk summarized above is stated in full here and does
not depend on any other document.
