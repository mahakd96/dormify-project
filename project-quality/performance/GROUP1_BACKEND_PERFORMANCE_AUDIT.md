# Group 1 — Backend Performance & Efficiency Audit

Prepared for external AI review. **This is an AUDIT / MEASUREMENT / INSPECTION
report — no production code was changed to produce it.** It is
self-contained: another engineer or AI should be able to understand the
current state of Dormify's backend performance from this document alone,
without needing the conversation that produced it.

---

## 1. Executive Summary

Dormify's backend performance work has proceeded in phases on this branch.
Buildings/Apartments/Rooms/Beds and the Analysis endpoint's per-building N+1
are **already fixed and verified** (query count flat, correctness tested,
regression-tested). This audit swept the rest of the system — Home
Dashboard, Transfers/Requests, Students, Reports/exports, database/runtime
configuration, and payload/pagination — looking for the same class of
problems (N+1 queries, redundant queries, unbounded payloads, missing
pagination) using the same methodology (`CaptureQueriesContext` + DRF
`APIClient` + synthetic data against the local disposable Postgres).

**The single most important finding of this audit**: the "Transfers"
page — the page real users actually use for transfer/request management
(`TransfersPage.js`, backed by `StudentRequestViewSet`/`/api/requests/`,
**not** the separate, apparently-unused `/api/transfers/` endpoint) — has a
confirmed, measured, severe N+1: **127 SQL queries to render a single
25-row page** (vs. ~2 for an equivalent well-behaved list), scaling
linearly with the number of requests on the page. This is compounded by a
frontend bug (out of this audit's remit to fix, but documented): the page
never follows DRF's pagination `next` link, so beyond the first 25 matching
requests, more requests wouldn't be shown *even if fetched cheaply*. This
is the clear top priority for the next implementation phase — measured,
in shape, similar in severity to the original (already-fixed) Buildings
N+1.

Beyond that: Home Dashboard, Students, and Reports are each **structurally
reasonable** with a handful of small, safe, well-understood cleanup
opportunities (duplicate queries, missing `select_related`, redundant
Python passes) — none of them scaling problems. Two **database/runtime
configuration** items (`CONN_MAX_AGE = 0` against what is very likely a
TLS-secured remote Azure Postgres host, and the backend Docker image
running Django's development server with no production WSGI server in
`requirements.txt`) were found by direct inspection of the repo's own
config files; their *real* latency impact cannot be measured locally (no
real network hop, no real Azure host in this environment) and is flagged
as **NEEDS REAL-ENVIRONMENT MEASUREMENT**, not asserted as a proven
problem.

**Bottom line:** Group 1 is ready for an implementation/fix phase. One
confirmed P0 (Requests list N+1), a short list of well-scoped P1/P2 safe
optimizations (several already fully designed in prior Analysis-phase
documents, ready to implement), and a small set of items that genuinely
require real-environment (Azure) measurement before any further backend
change is justified.

---

## 2. Current System / Environment

- **Branch:** `donia-analysis-performance`.
- **Git status at the start of this audit:** working tree already carried
  the uncommitted Analysis N+1 fix (`backend/api/views.py` modified) and
  its supporting docs/tests/evidence from the immediately-preceding phase
  of this same investigation series — see §3 for exact status. **This
  audit changed none of that** — it only added the files listed in §14.
- **Test environment:** the pre-existing local disposable PostgreSQL 16
  Docker container (`dormify_test_db`, already running throughout this
  session — confirmed via `docker ps`, not restarted), used via
  `ENV_FILE=.env.test` exactly as in every prior phase. Django's own
  further-disposable `test_dormify_test` database is created/destroyed
  inside it per test run. **The real Azure database was never connected
  to at any point in this audit.**
- **Important limitations (apply to every number in this report unless
  stated otherwise):**
  - Every query count/timing/payload figure was measured via DRF's
    in-process `APIClient` — **no real HTTP round trip, no real network,
    no real TLS handshake, no real Azure latency** is reflected in any
    number in this document. This is the same limitation every prior
    phase in this series has carried, restated here because §9's findings
    make it unusually consequential.
  - All data is synthetic, created and torn down by test code — no real
    production row counts, data skew, or index behavior was observed.
  - No `EXPLAIN ANALYZE` or Postgres-side query-plan inspection was
    performed anywhere in this audit — "query count" and "wall-clock
    time via DRF's APIClient" were measured; per-query database execution
    cost/plan was not isolated.
  - This audit inspected frontend code only enough to determine which
    endpoints are called, when, and how responses are consumed — no
    frontend code was modified, and this is explicitly not a UI/design
    review.

---

## 3. Already-Completed Performance Fixes (current, verified status — not stale history)

### 3.1 Buildings / Apartments / Rooms / Beds (BLD-01–04) — **CLOSED, HEALTHY**

All four inventory endpoints (`GET /api/buildings/`, `/api/apartments/`,
`/api/rooms/`, `/api/beds/`) had their `SerializerMethodField`/model-property
N+1 patterns fixed via correlated-`Subquery`+`Coalesce` annotations
(`_annotate_building_inventory_counts`, `_annotate_apartment_inventory_counts`,
`_annotate_room_inventory_counts`, `_annotate_bed_occupancy` in
`backend/api/views.py`). Query count is flat (1–2 queries) regardless of
row count, verified up to N=25/50, with dedicated correctness tests proving
field-for-field equivalence to the original per-row computation. **This
audit did not re-run these tests** (no code in this area changed since
they last passed — see `PERFORMANCE_SESSION_FINAL_SUMMARY.md`'s **21/21**
performance-test result and `tests_inventory.py`'s **41/41**) but did
re-confirm via `git status`/`git diff` that `backend/api/views.py`'s
Buildings/Apartments/Rooms/Beds sections are unmodified since that phase.

**Pagination (BLD-05):** analyzed, not implemented — classified **NOT
CURRENTLY NECESSARY** (`PAGINATION_ANALYSIS_SUMMARY.md`): the N+1 fix
already removed the main justification for pagination, measured payloads
stay small (sub-15KB at N=25–50, extrapolated tens-of-KB at N=500–1,000),
and the frontend (`BuildingsPage.js`) depends on receiving the *complete*
list for client-side search/filter/summary totals — enabling pagination
without a coordinated frontend change would silently truncate data. **This
audit did not find anything to change that conclusion** — see §10.

### 3.2 Analysis (`GET /api/analysis/`) — **N+1 CLOSED**, fixed-query cleanup **DOCUMENTED, NOT YET IMPLEMENTED**

Three phases already completed on this branch, all still present and
unmodified by this audit:

1. **Baseline** (`ANALYSIS_BASELINE_SUMMARY.md`): confirmed
   `total_queries = 31 + 3×N` in the `occupancy_data` per-building loop
   (building capacity, assigned-beds, room-count each queried
   independently per building).
2. **Fix** (`ANALYSIS_OPTIMIZATION_SUMMARY.md`): `_annotate_analysis_building_occupancy()`
   collapses the 3-per-building queries into correlated subqueries inside
   one `buildings_qs` statement. **Verified flat `31` queries at N=1/5/25**,
   byte-identical response payloads before/after, 12/12 existing
   `tests_analysis` passing, 6/6 new correctness+regression tests passing.
3. **Fixed-query inspection** (`ANALYSIS_FIXED_QUERY_INSPECTION.md`,
   inspection-only, no code changed): decomposed the remaining flat 31
   queries. Found **2 queries that are unconditionally computed and then
   discarded/overwritten whenever a region filter applies**
   (`views.py:6474-6475` — `Building.objects.count()` /
   `.filter(is_active=False).count()`, immediately replaced by
   region-scoped versions at `views.py:6478-6485`), and **4 groups of
   queryset-evaluated-multiple-times consolidation candidates** (10
   queries → could become 4): the `assignments_qs` group (student/bed
   distinct counts + raw list, 3→1), the `rooms_qs` group (capacity sum +
   room count, 2→1), the `transfers_qs` group (total + pending count +
   already-grouped `transfers_by_status`, 3→1), and the `requests_qs`
   group (pending count + already-grouped `pending_requests_by_type`,
   2→1). **Total possible reduction: 31 → 23 (~26%), not yet
   implemented** — this is a ready-to-implement, fully-scoped, low-risk
   candidate for the next phase (see §13).
4. **This audit's verification**: re-read the current `analysis_data()`
   source in full (confirmed the fix is exactly as documented, nothing
   drifted) and treated the fixed-query inspection's findings as current,
   not stale — they describe the code as it exists today.

**Status: HEALTHY (no scaling problem), with a well-scoped, quantified,
not-yet-implemented cleanup opportunity.**

---

## 4. Operational Home / Dashboard Findings

**Endpoint:** `GET /api/home/` (`home_dashboard`, `backend/api/views.py:7972-8383`).
**Frontend:** `src/pages/HomePage.js` — makes **exactly one** API call on
mount (`homeAPI.get()` → `GET /api/home/`), no parallel fan-out needed
(there's only one call), no polling, no redundant re-fetch from any
interaction except an explicit user-triggered Retry button. **Frontend
behavior here is clean — no findings.**

**Backend, measured (this audit):** built a representative fixture (1
region, 1 building/apartment/room, 2 students — one assigned, one
priority/unassigned — 1 pending `StudentRequest`, 1 `AllocationRun`, 1
`ImportBatch` + `RegionInbox`) and captured `GET /api/home/` for both a
central-admin and a region-boss user:

| Role | Total SQL queries | Time (ms) | Payload (bytes) |
|---|---:|---:|---:|
| central_admin | 17 | 86.8 | 4,654 |
| region_boss | 15 | 78.4 | 4,617 |

No N+1 loop was found — all three loops in the view (`batch_qs[:3]`,
`run_qs[:3]`, `recent_requests_qs[:5]`) iterate an already-fetched,
appropriately `select_related`'d slice. Findings:

- **G1-06 — `pending_inbox_count`/`viewed_inbox_count` two separate
  `.count()` queries (admin/system-wide path only)**
  (`views.py:8080-8081`): `RegionInbox.objects.filter(status=PENDING).count()`
  and `.filter(status=VIEWED).count()` could be one
  `.values('status').annotate(Count('id'))` grouped query — the same
  pattern already fixed for Analysis's `transfers_qs`/`requests_qs`
  groups. **SAFE OPTIMIZATION OPPORTUNITY, P3** (2→1 query, only on the
  admin/no-region-filter path).
- **G1-07 — `run_qs` (`AllocationRun`) evaluated 4 separate times** for
  overlapping information: `active_run` (`:8088-8092`, filtered +
  ordered), `latest_run` (`:8093`, ordered only), `has_completed_run`
  (`:8095`, `.exists()` with a different filter), and the `recent_activity`
  slice (`:8324`, `[:3]`). Each has a genuinely different filter, so a
  naive single-fetch replacement risks correctness (e.g. `has_completed_run`
  could be wrong if fetching only a bounded recent-N window and more than
  N non-completed runs exist before a completed one). **SAFE OPTIMIZATION
  OPPORTUNITY but needs correctness care, P3.**
- **G1-08 — `latest_inbox` query missing `select_related('region')`**
  (`views.py:8074`: `RegionInbox.objects.select_related('batch').filter(region=region)...`
  — omits `'region'`). `RegionInboxSerializer.region_name`
  (`serializers.py:1548-1573`, `source='region.name'`) therefore issues an
  extra lazy-fetch query whenever `latest_inbox` is not `None` (any
  region-scoped user who has ever received inbox data). **CONFIRMED
  PERFORMANCE ISSUE (minor), P2** — trivial, safe one-line fix (`.select_related('batch', 'region')`).
- **Cross-reference, not a new bug:** `ImportBatchSerializer.get_region_breakdown`
  (`serializers.py:1510-1519`) adds the same kind of conditional +1 query
  here (when `latest_batch` is not `None`) as already documented for
  Analysis — noted for completeness, not re-litigated.
- **Minor/cosmetic, not performance-relevant:** the "batch_ids for this
  region" subquery expression (`RegionInbox.objects.filter(region=region).values_list('batch_id', flat=True)`)
  is written out twice, independently, at `views.py:8064` and `:8313` —
  code duplication, not a double query (each is still lazily embedded
  once into its own single statement). **OUT OF SCOPE / P3 cosmetic.**

`AllocationRun` is read extensively by this view (`active_run`,
`latest_run`, `has_completed_run`, `recent_activity` entries) — per the
ownership boundary, this is noted only as a read; no allocation behavior
was evaluated.

`backend/api/tests_home_dashboard.py` (existing, 3 test classes) covers
functional/scoping correctness thoroughly but **has no query-count
assertion anywhere** — none of G1-06/07/08 would be caught by regression
if introduced or reintroduced.

**Status: HEALTHY overall.** No scaling problem, no N+1. A handful of
small, well-understood, low-risk query-count trims available (P2/P3),
none urgent.

---

## 5. Analysis Findings

Covered in full in §3.2 above (current, not historical) — repeated here
only as a pointer per the requested report structure: **N+1 closed and
verified; a documented, quantified, not-yet-implemented 31→23 query
cleanup remains as the next candidate for this endpoint specifically.**
See `ANALYSIS_FIXED_QUERY_INSPECTION.md` for the full per-query breakdown.

---

## 6. Transfers + Requests Findings — **the audit's headline finding**

### 6.1 The "Transfers" page is actually the Requests page

`TransfersPage.js` is the single frontend page for transfer/request
management. It imports and uses **`requestsAPI`** (backed by
`StudentRequestViewSet` / `GET /api/requests/`) exclusively.
**`transfersAPI`** (backed by `TransferViewSet` / `/api/transfers/`) is
defined in `src/services/api.js` but is **never imported or called
anywhere in `src/`** (confirmed by repo-wide search) — `TransferViewSet`/
`Transfer` is reachable only by a direct API call, not through any current
UI flow.

### 6.2 CONFIRMED, MEASURED P0 — `StudentRequestViewSet` list N+1

**Endpoint:** `GET /api/requests/` (`StudentRequestViewSet`,
`backend/api/views.py:3074-3141`), paginated at 25/page
(`StandardResultsPagination`).

**Root cause** — `StudentRequestSerializer` (`backend/api/serializers.py:1180-1403`)
has, per row:

- `get_current_bed` (`:1307-1311`) — calls `obj.student.current_bed`,
  which is `Student.current_assignment`
  (`models.py:580-582`, `self.bed_assignments.filter(status=ACTIVE)...first()`),
  a **fresh query per row**, not prefetched anywhere in `get_queryset()`.
- `get_placement_history` (`:1313-1332`) — `obj.student.bed_assignments...order_by('-assigned_at')[:10]`,
  **another fresh query per row**.
- `get_destination_region_names` (`:1263-1264`) — `obj.destination_regions.all()`,
  a M2M query per row, **duplicated** by the fact that `destination_regions`
  is *also* declared as a writable `PrimaryKeyRelatedField(many=True, ...)`
  in the same serializer's `Meta.fields` (`:1220-1222`) — DRF serializes
  that field too, independently re-querying the exact same M2M relation a
  **second time per row** (the same "compute the same thing twice"
  redundancy already fixed for `get_free_beds` in `BuildingSerializer`).
- `source_region_name` (`:1219`, `source='source_region.name'`) — a plain
  `CharField`, but `source_region` is **not** in `get_queryset()`'s
  `select_related` list (`:3079-3087`), so this is a per-row lazy-FK-fetch
  query whenever `source_region` is set (region-transfer requests).

**Measured (this audit):** 25 `StudentRequest` rows, all `region_transfer`
type with one `destination_regions` entry and a `source_region` set (each
student also holding one active `BedAssignment`, to exercise
`current_bed`/`placement_history`):

| N (requests) | Total SQL queries | Time (ms) | Payload (bytes) |
|---:|---:|---:|---:|
| 25 | **127** | 572.4 | 37,093 |

Query-shape breakdown (masked, top groups): `×50` a `Region` JOIN query
via `destination_regions` (2 per row — the declared-field/method-field
duplication above), `×25` a plain `source_region` lazy-FK fetch, `×25`
`current_bed`'s `BedAssignment` query, `×25` `placement_history`'s
`BedAssignment` query, plus the 2 fixed queries (pagination `COUNT` + the
base list `SELECT`). **50+25+25+25+1+1 = 127 — exact match**, confirming
marginal cost of **5 queries per row** for this request-type mix (lower,
but still present — 2/row minimum from `current_bed`+`placement_history`
alone — for request types with no `source_region`/`destination_regions`).
This is linear N+1 scaling, the same shape already fixed four times over
for Buildings/Apartments/Rooms/Beds and once for Analysis.

**Severity: P0.** This is the actual live page every user hits for
transfer/request management, already paginated at only 25 rows, and still
costs up to ~127 queries and 572ms (locally, with zero real network
latency) for that single page.

**Affected files:** `backend/api/serializers.py` (`StudentRequestSerializer`,
`:1180-1403`), `backend/api/views.py` (`StudentRequestViewSet.get_queryset()`,
`:3079-3141`).

**Recommended fix (not implemented — audit only):** the same
`prefetch_related`/`select_related`-first pattern already proven safe
across this whole investigation series: add `select_related('source_region')`
to `get_queryset()`; add `Prefetch('destination_regions', ...)` (or simply
rely on the fact that `prefetch_related('destination_regions')` makes the
already-declared `PrimaryKeyRelatedField` and `get_destination_region_names`
both read the same prefetched cache, eliminating the duplicate without
removing either field); add a `Prefetch('bed_assignments', queryset=BedAssignment.objects.filter(status=ACTIVE).select_related('bed', 'bed__room'), to_attr=...)`
mirroring the fix already applied to `StudentListSerializer.get_current_bed`,
adjusted for `placement_history`'s need for the most-recent-10 (not just
active) assignments — this one needs its own `Prefetch` with an
appropriately ordered/sliced queryset, or a documented decision to compute
it differently. **Expected result: query count flat regardless of N**,
matching every other fix in this series. **Risk: low** — same technique,
same safety profile, as five prior successful fixes; needs a correctness
test (compare against original per-row values) exactly like the existing
`AnalysisOccupancyCorrectnessTests`/`BuildingCountCorrectnessTests` pattern
before being considered complete.

### 6.3 CONFIRMED — Frontend pagination not followed (companion finding, not a backend fix)

`TransfersPage.js`'s `loadRequests()` does
`const list = Array.isArray(d) ? d : (d.results || [])` and **never reads
or follows `d.next`**, never sends `page`/`page_size`. Beyond the first 25
matching requests (region-filtered, ordered by `-created_at`), the rest
are simply invisible — stat cards, tab counts, and search/filter (all
computed client-side via `useMemo` over the truncated `requests` state)
silently operate on an incomplete dataset. This is a genuine bug, but it
is a **frontend** bug — out of this backend-only audit's remit to fix
(explicit instruction: do not modify frontend code) — documented here
because it directly compounds §6.2: even a fully-optimized `/api/requests/`
page-1 fetch would still only ever show the newest 25 requests today.
**Classification: CONFIRMED PERFORMANCE/CORRECTNESS ISSUE, OUT OF SCOPE
FOR THIS AUDIT'S IMPLEMENTATION, P1** (flagged prominently for whoever
owns the frontend-coordinated follow-up).

Related, same root cause (frontend re-implements filtering client-side
instead of using the backend's already-efficient, DB-side `status`/
`request_type`/`search`/`date_from`/`date_to` filters — `get_queryset()`
supports all of them correctly): **G1-11, SAFE OPTIMIZATION OPPORTUNITY,
frontend-coupled, P2.** And every approve/reject action triggers a full
`loadRequests()` reload instead of patching the single changed row locally:
**G1-12, SAFE OPTIMIZATION OPPORTUNITY, frontend-coupled, P3.** Both are
documented for completeness; neither was implemented (frontend changes
are out of scope here).

### 6.4 CONFIRMED, MEASURED, but currently dormant — `TransferViewSet`/`TransferSerializer`

**Endpoint:** `GET /api/transfers/` — **no `pagination_class` set** (unlike
every other list endpoint audited), returns a plain unpaginated JSON array.
`TransferSerializer` (`serializers.py:1070-1174`) reads
`from_room.apartment.building.*`, `to_room.apartment.building.*`, and
`requested_by.region.*`, none of which are in `TransferViewSet.get_queryset()`'s
`select_related('student', 'from_room', 'to_room', 'requested_by', 'reviewed_by')`
(`views.py:1798-1801`) — a straightforward N+1, same shape as the
already-fixed Buildings/Apartments/Rooms/Beds patterns.

**Measured (this audit):**

| N (transfers) | Total SQL queries | Time (ms) | Payload (bytes) |
|---:|---:|---:|---:|
| 25 | 101 | 248.6 | 13,789 |
| 100 | 401 | 825.1 | 55,431 |

Marginal cost: `(401−101)/(100−25) = 4.00` queries/transfer — clean linear
fit, matching the 3 uncovered join paths (building via from_room,
building via to_room, region via requested_by) plus one base query.

**Severity assessment:** structurally a real, confirmed N+1 — but
`TransferViewSet` is not called anywhere in the current frontend (§6.1),
so its real-world blast radius today is **zero active traffic**, only
"reachable by anyone with a valid API token who calls it directly."
**Classification: CONFIRMED PERFORMANCE ISSUE, dormant, P2** (would become
P0-equivalent the moment any frontend code starts using it — worth fixing
opportunistically alongside §6.2 since the pattern and fix are identical,
but not urgent on its own).

### 6.5 Existing test coverage gap

`backend/api/tests_requests.py` (12 correctness/business-logic tests) and
`backend/api/tests_transfer_regions.py` (region-scoping/authorization
tests) are both thorough for *correctness* but **neither contains a single
query-count assertion** (`assertNumQueries`, `CaptureQueriesContext`, or
similar) and neither creates >25 requests to exercise a second page. This
is exactly why the N+1 in §6.2 was never caught — noted as a systemic gap
worth closing alongside the fix (see §13).

**Status: the clear top finding of this entire audit.** §6.2 is the
strongest, best-evidenced P0 in Group 1.

---

## 7. Students Findings

**Endpoints:** `GET /api/students/` (list, paginated), `/counts/`,
`/filter-options/`, `GET/POST/PATCH /api/students/{id}/` (detail).

### 7.1 List — **ALREADY FIXED, HEALTHY**

`StudentViewSet` (`views.py:1549-1698`) is paginated
(`StandardResultsPagination`, 25/page, max 100), uses
`select_related('accepted_dorm_type', 'accepted_dorm_type__region',
'assigned_room', 'assigned_room__apartment', 'assigned_room__apartment__building')`
plus a list-only `Prefetch('bed_assignments', ..., to_attr='prefetched_active_assignments')`
that neutralizes what the existing test suite's own comments describe as
the historical N+1 (`current_bed`, "the old code issued 1+ extra query PER
student"). All search/filter query params (`search`, `gender`,
`requested_religion`, `region`, `dorm_type`, `building`, `apartment`,
`room`, `religious`, `placement_sector`, `status`, `has_roommate_request`,
`category`) are applied as DB filters, not Python-side.

**Re-verified this audit** (not rebuilt from scratch, per instructions):
re-ran the existing `backend/api/tests_students_performance.py` suite —
**8/8 passed**, including `test_students_list_query_count_is_flat`
(asserts `< 12` queries for a 25-row page with 10 assigned students,
regression-guarding exactly the historical N+1).

`StudentListSerializer.get_current_bed` reads the prefetched attribute
first, with a safe fallback to the (query-issuing) property only for
objects not built through the view's queryset — correctly guarded, **no
N+1 remains in the list serializer.**

### 7.2 `filter-options` action — **NO MEANINGFUL ISSUE**

`views.py:1745-1791` — 5 independent, appropriately `select_related`'d,
appropriately region-scoped full-table fetches (`Region`, `Building`,
`DormType`, `Apartment`, `Room`) — not a per-field `.distinct()` scan over
`Student`, not repeated evaluation of a shared base queryset. Dimension
tables are small; this is a reasonable, efficient approach. **No finding.**

### 7.3 `counts` action — **NO MEANINGFUL ISSUE**

`views.py:1731-1743` — exactly 2 queries (one `GROUP BY category`
aggregate, one plain `.count()`), both DB-side. **No finding.**

### 7.4 Detail (`StudentSerializer`) — 2 small, confirmed, minor findings

**Measured (this audit):** `GET /api/students/{id}/` for one student with
one active `BedAssignment` → **3 total queries**: 1 for the student row,
and **2 separate, identical-shape `api_bedassignment` queries.**

- **G1-15 — `get_current_bed_id`/`get_current_bed_label` each independently
  call `obj.current_bed`** (`serializers.py:841-847`), and
  `Student.current_bed`/`current_assignment` (`models.py:580-587`) are
  plain, uncached `@property`s that re-query on every access — so every
  single detail/create/update response issues the same `BedAssignment`
  lookup **twice**. **CONFIRMED PERFORMANCE ISSUE (minor — single-object
  impact, not N+1 across rows), P3.** Safe fix: compute once (e.g. cache
  on the instance, or read the value once and pass to both output keys).
- **G1-16 — `batch_id` (`source='batch.id'`) not covered by `select_related('batch')`**
  on the detail queryset (only `accepted_dorm_type`, `accepted_dorm_type__region`,
  `assigned_room`, `assigned_room__apartment`, `assigned_room__apartment__building`
  are select_related, per `views.py:1561-1567`) — **+1 query on every
  detail/create/update.** **CONFIRMED PERFORMANCE ISSUE (minor), P3.**
  Safe fix: add `'batch'` to the `select_related` list.

Neither is covered by the existing test suite (which only tests the list
endpoint's query-flatness).

**Status: HEALTHY overall.** The one historically-significant N+1 here
(list-page `current_bed`) is already fixed and verified; what remains are
two small, single-object, easy, low-risk cleanups.

---

## 8. Reports / Exports Findings

**Endpoints:** `GET /api/reports/{dormify,student-allocation,student-actions,capacity,manual-review}-report/`
(`backend/api/views.py:10804-10976`), all backed by
`backend/api/report_exports.py` (1,000 lines), all synchronous DRF
`@api_view` functions returning one complete `.xlsx` binary via
pandas+openpyxl, built entirely in an in-memory `BytesIO()` buffer — no
temp files, no background job/Celery/async mechanism of any kind.

### 8.1 Shared data loader — `_load_data()` (`report_exports.py:196-245`)

- **DB-side region filtering when a region is given** — efficient
  (`assignment_qs`/`student_qs`/`bed_qs` each `.filter(...region_id=region_id)`).
- **Fully unbounded ("all regions ever") when `region_id` is `None`** —
  `list(student_qs.all())`, `list(bed_qs.all())`,
  `list(assignment_qs)` load **every** `Student`/`Bed`/active
  `BedAssignment` row in the system into memory, with no date range, no
  batch/import scoping, no row limit anywhere.
- **`select_related` chains verified complete** for every field accessed
  in every row-builder function (`_location_from_assignment`,
  `_build_occupancy_rows`, `_build_occupancy_by_region/_building/_apartment`,
  `_build_summary`, etc. — all 597 lines of builder functions read) —
  **confirmed no N+1 within report generation itself**, a genuinely clean
  result on that specific axis.

### 8.2 Per-report findings

- **G1-18 — `dormify_report` (`views.py:10804-10830`, `report_exports.py:746-784`)
  has no region-filtering capability at all** — always the entire system,
  central-admin only. **It is not wired to any button in the current
  frontend** (`ReportsPage.js`'s `REPORT_CARDS` only references 3 of the 5
  report endpoints — `downloadDormifyReport` and `downloadStudentAllocationReport`
  are defined in `api.js` but unused in the UI) — reachable only via a
  direct URL/API call by a central admin. **Classification: CONFIRMED
  STRUCTURAL PATTERN (unbounded, whole-system, synchronous, in-memory) by
  direct code inspection; actual real-world severity NEEDS
  REAL-ENVIRONMENT MEASUREMENT** (depends entirely on real total
  student/bed/assignment row counts, which were not available to this
  audit). **P1 as a structural finding, pending real-data confirmation of
  actual impact.**
- **G1-19 — `manual_review_report` runs 5 separate full O(n) Python passes
  over `all_students`** for overlapping validation/duplicate-detection
  logic: `_student_issues` is called independently from
  `_build_exceptions_summary_rows`, `_build_all_exceptions_rows`, and
  `_build_unassigned_with_issues` (3 passes), plus separate,
  independent duplicate-detection passes in `_build_duplicate_id_rows`
  and `_build_missing_data_rows` (2 more) — **5 full passes total** where
  1 would suffice with the validation results computed once and reused.
  Pure Python/CPU redundancy, not DB query redundancy. **SAFE
  OPTIMIZATION OPPORTUNITY, P2/P3** (bounded by student count within one
  region typically; user-click-triggered, not page-load).
- **G1-20 — `capacity_report` loads `all_students` via `_load_data()`
  even though it never uses student data** (only beds/assignments feed
  its occupancy breakdowns) — a wasted `list(student_qs.all())` fetch on
  every capacity-report generation. **SAFE OPTIMIZATION OPPORTUNITY, P3**
  (would need minor restructuring of the shared `_load_data()` signature,
  used by multiple reports — low risk but needs care not to break the
  other 3 reports that DO need student data).
- **openpyxl formatting cost (all reports)**: after each sheet is written,
  `_format_worksheet` and several color/highlight helpers
  (`_apply_uniform_row_fill`, `_highlight_priority_rows`,
  `_color_occupancy_rows`, `_reapply_headers`) each do a full
  `ws.iter_rows`/`ws.columns` sweep — O(rows×cols) per sheet, several such
  sweeps for color-coded reports. This is a real, structural CPU cost that
  scales with dataset size, proportionate to a user-click-triggered,
  on-demand action (not something every page load pays). **Not classified
  as a confirmed problem** — no timing measurement was performed at a
  realistic row count in this audit (out of the audit's time budget; flag
  as **NEEDS MORE MEASUREMENT** if this becomes a priority).

### 8.3 No pagination on exports

Correctly absent — a "download the complete report" feature has no
sensible smaller unit to paginate. **Not a defect.**

**Status:** structurally reasonable on the query-efficiency axis
(confirmed no N+1, confirmed correct region-scoping when available); one
confirmed-unbounded, UI-dormant export (`dormify_report`) whose real
severity is unmeasurable locally; a couple of small, safe Python-side
redundancy cleanups.

---

## 9. Database / Runtime / Connection Findings

Read directly from `backend/dormify/settings.py`, `backend/Dockerfile`,
`docker-compose.yml`, `backend/requirements.txt` (no code executed against
a real environment — these are static-configuration findings).

- **G1-21 — `CONN_MAX_AGE = 0`** (`settings.py:88`), combined with
  `DB_SSLMODE` defaulting to `"require"` (`settings.py:75, 92-93`) and a
  `DB_HOST` that (per `BUILDINGS_BASELINE_SUMMARY.md`'s environment
  investigation, not re-verified here) resolves to a managed Postgres host
  consistent with Azure Database for PostgreSQL. `CONN_MAX_AGE = 0` means
  Django opens a brand-new database connection for every request and
  closes it at the end — against a **remote**, **TLS-secured** host, this
  means every single HTTP request (not every query — the connection is
  reused across all queries *within* one request) pays a full TCP+TLS
  handshake + Postgres authentication negotiation before any of the
  15–127+ queries measured throughout this report even begin. **This cost
  is invisible to every measurement in this entire investigation series**
  (local `test_db` is same-host Docker, effectively zero network RTT,
  likely no TLS negotiation of comparable cost). **Classification:
  CONFIRMED (the setting itself, by direct inspection) / NEEDS
  REAL-ENVIRONMENT MEASUREMENT (the actual latency impact)** — the
  standard Django/Postgres recommendation for exactly this topology
  (remote managed Postgres) is `CONN_MAX_AGE > 0` (e.g. 60s) or a
  connection pooler; this is a plausible, evidence-grounded P1 candidate,
  not a proven one. **P1.**
- **G1-22 — Backend Docker image/compose run Django's development server**:
  `backend/Dockerfile:13` (`CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]`)
  and `docker-compose.yml`'s `backend` service (`command: python manage.py runserver 0.0.0.0:8000`)
  both use `runserver` — Django's own documentation states this is not
  suitable for production use (no production-grade concurrency handling,
  no hardening). **No gunicorn, uvicorn, daphne, or any WSGI/ASGI
  production server appears anywhere in `backend/requirements.txt`.**
  **Classification: CONFIRMED (the repo's own checked-in config does
  this) / NEEDS REAL-ENVIRONMENT VERIFICATION (whether the actual deployed
  Azure App Service uses this exact image/command, or overrides it with
  its own default Python startup — which is often gunicorn-based on Azure
  App Service by default)** — this should not be assumed broken in
  production without confirming what Azure actually runs, but it is a
  genuine gap in the repo's own configuration as committed. **P1.**
- **G1-23 — No connection pooling anywhere** (no `pgbouncer` service in
  `docker-compose.yml`, no `django-db-pool`/similar package in
  `requirements.txt`). Consistent with `CONN_MAX_AGE = 0` — reinforces
  G1-21 rather than being a separate root cause. **NEEDS
  REAL-ENVIRONMENT MEASUREMENT, P2** (only worth deciding after G1-21 is
  resolved/measured — a pooler and `CONN_MAX_AGE` tuning are two different
  solutions to the same problem, not both needed).
- **G1-24 — No missing-index candidates confirmed.** Every filtered
  column observed across this entire audit's query captures (Buildings
  through Requests) is either a primary key, a foreign key (automatically
  indexed by Django/Postgres), or an `icontains` free-text search
  (`Student`/`StudentRequest` search fields) — the latter is a genuine,
  well-known scaling concern for large tables regardless of indexing
  strategy (a plain B-tree index doesn't accelerate `LIKE '%x%'`), but
  **no query pattern observed in this audit's synthetic, small-N testing
  demonstrated an actual slow query** that would justify recommending a
  specific index today. **Classification: NO MEANINGFUL ISSUE found by
  this audit's measurements; the `icontains` search concern is flagged as
  NEEDS REAL-ENVIRONMENT MEASUREMENT (real table size) rather than
  asserted as a problem — do not manufacture an index recommendation
  without evidence it's needed.**

**Status:** two genuine, evidence-grounded configuration concerns
(G1-21/G1-22) that this audit cannot resolve locally — they require either
real-environment measurement or a direct answer to "what does the real
Azure deployment actually run" before any change is justified.

---

## 10. Payload / Pagination Findings

| Endpoint | Paginated? | Frontend follows pagination correctly? | Status |
|---|---|---|---|
| `/api/buildings/`, `/apartments/`, `/rooms/`, `/beds/` | No | N/A (see below) | Analyzed, **NOT CURRENTLY NECESSARY** — payload stays small (sub-15KB at N=25-50), frontend needs the complete list for client-side search/summary; enabling pagination without a coordinated frontend change would silently truncate data (§3.1). No change from this audit. |
| `/api/students/` | Yes (25/page, max 100) | **Yes** — `loadMoreStudents` correctly follows `next`, appends results, never re-fetches page 1 | **HEALTHY.** |
| `/api/requests/` | Yes (25/page, max 100) | **No** — `TransfersPage.js` reads only `d.results`, never `d.next` (§6.3) | **CONFIRMED BUG** — backend did the right thing, frontend doesn't use it. Out of scope to fix here (frontend), documented prominently. |
| `/api/transfers/` | **No pagination_class at all** | N/A (endpoint unused by frontend) | Confirmed unbounded growth (measured: 55KB/401 queries at N=100, §6.4) — dormant risk, not active, since nothing currently calls it. |
| Reports/exports | No (by design) | N/A | Correct — "download everything" has no sensible page unit. Not a defect. |

**This is the clearest instance in the whole audit of "whether pagination
is supported correctly by the caller" actually failing** — the backend
for `/api/requests/` is correctly paginated; the one and only frontend
consumer of it does not use that pagination correctly.

---

## 11. Real-Environment / Azure Items That Cannot Be Concluded Locally

Consolidated list (each already introduced above, gathered here as the
single "needs real measurement" checklist):

1. **G1-21 — `CONN_MAX_AGE = 0` real latency impact** against the actual
   remote/TLS Postgres host — needs either real-environment timing or a
   deliberate decision to tune it based on Django/Postgres best-practice
   reasoning alone.
2. **G1-22 — What does the real Azure deployment actually run** — this
   Dockerfile/compose command as-is, or Azure App Service's own default
   startup (often gunicorn)? Cannot be answered by inspecting this repo
   alone.
3. **G1-18 — `dormify_report`'s real severity** — entirely dependent on
   real total student/bed/assignment row counts across all regions, which
   were not available to this audit.
4. **G1-24 — `icontains` search scaling** on `Student`/`StudentRequest` at
   real production table sizes.
5. **Real HTTP/network/TLS cost** for literally every endpoint measured in
   this entire investigation series (Buildings through Requests) — every
   number in every phase used DRF's in-process `APIClient`.
6. **Postgres-side query execution plans** (`EXPLAIN ANALYZE`) — not run
   anywhere in this audit; query *count* was measured, not per-query
   execution cost against real data volume/index statistics.
7. **Frontend render time** for any page audited — not profiled in a
   running browser.
8. **G1-23 — connection-pooling decision** — depends on the outcome of #1/#2.

None of these should be treated as confirmed problems; they are
explicitly unresolved by this audit's local-only methodology.

---

## 12. Complete Findings Table

| ID | Area | Endpoint/Page | Status/Category | Severity | Evidence | Recommended action |
|---|---|---|---|---|---|---|
| G1-01 | Dorm inventory | `/api/buildings/`,`/apartments/`,`/rooms/`,`/beds/` | ALREADY FIXED | — | BLD-01–04 docs, 21/21 perf tests, flat 1-2 queries | None — closed |
| G1-02 | Dorm inventory | same 4 | ALREADY FIXED (analysis-only decision) | — | `PAGINATION_ANALYSIS_SUMMARY.md` | None — re-confirmed still valid |
| G1-03 | Analysis | `/api/analysis/` | ALREADY FIXED | — | `ANALYSIS_OPTIMIZATION_SUMMARY.md`, flat 31 queries | None — closed |
| G1-04 | Analysis | `/api/analysis/` | SAFE OPTIMIZATION OPPORTUNITY | P2 | `ANALYSIS_FIXED_QUERY_INSPECTION.md` — 31→23 possible | Implement the documented 2-waste-elimination + 4 consolidations |
| G1-05 | Analysis | `/api/analysis/` | NO MEANINGFUL ISSUE | — | Documented, single necessary conditional query | None — note only |
| G1-06 | Home Dashboard | `/api/home/` | SAFE OPTIMIZATION OPPORTUNITY | P3 | Measured 15/17 queries; code at `views.py:8080-8081` | Merge 2 counts into 1 groupby (admin path) |
| G1-07 | Home Dashboard | `/api/home/` | SAFE OPTIMIZATION OPPORTUNITY (care needed) | P3 | `views.py:8088-8095,8324` — `run_qs` evaluated 4x | Consider consolidating with correctness care, or leave |
| G1-08 | Home Dashboard | `/api/home/` | CONFIRMED PERFORMANCE ISSUE (minor) | P2 | `views.py:8074` missing `select_related('region')` | Add `'region'` to select_related |
| G1-09 | Transfers/Requests | `/api/requests/` | **CONFIRMED PERFORMANCE ISSUE** | **P0** | Measured **127 queries / 25 rows**, 572ms | Prefetch destination_regions + bed_assignments, select_related source_region, add correctness test |
| G1-10 | Transfers/Requests | `TransfersPage.js` | CONFIRMED ISSUE, OUT OF SCOPE (frontend) | P1 | Never reads `d.next` | Flag for coordinated frontend fix |
| G1-11 | Transfers/Requests | `TransfersPage.js` | SAFE OPTIMIZATION (frontend-coupled) | P2 | Client-side filtering ignores efficient backend filters | Flag for coordinated frontend fix |
| G1-12 | Transfers/Requests | `TransfersPage.js` | SAFE OPTIMIZATION (frontend-coupled) | P3 | Approve/reject triggers full reload | Flag for coordinated frontend fix |
| G1-13 | Transfers/Requests | `/api/transfers/` | CONFIRMED PERFORMANCE ISSUE, dormant | P2 | Measured 101→401 queries (N=25→100), unpaginated, unused by UI | Fix alongside G1-09 (same pattern) or leave dormant |
| G1-14 | Students | `/api/students/` (list) | ALREADY FIXED | — | 8/8 tests re-passed this audit | None — closed |
| G1-15 | Students | `/api/students/{id}/` | CONFIRMED PERFORMANCE ISSUE (minor) | P3 | Measured 2x identical BedAssignment query | Compute `current_bed` once, reuse for both fields |
| G1-16 | Students | `/api/students/{id}/` | CONFIRMED PERFORMANCE ISSUE (minor) | P3 | `batch_id` not select_related | Add `'batch'` to select_related |
| G1-17 | Students | `/api/students/filter-options/` | NO MEANINGFUL ISSUE | — | 5 efficient, scoped queries | None |
| G1-18 | Reports | `dormify_report` | CONFIRMED STRUCTURAL PATTERN / NEEDS REAL MEASUREMENT | P1 (structural) | Unbounded whole-system load, no UI wiring | Confirm real row counts before deciding; consider region-scoping or background job if real volume is large |
| G1-19 | Reports | `manual_review_report` | SAFE OPTIMIZATION OPPORTUNITY | P2/P3 | 5 redundant Python passes over `all_students` | Compute validation once, reuse |
| G1-20 | Reports | `capacity_report` | SAFE OPTIMIZATION OPPORTUNITY | P3 | Loads unused student data | Skip student load when not needed (careful shared-loader refactor) |
| G1-21 | DB/runtime | all endpoints | CONFIRMED (config) / NEEDS REAL MEASUREMENT (impact) | P1 | `settings.py:88`, `CONN_MAX_AGE=0` | Real-environment latency test, then consider `CONN_MAX_AGE>0` or pooler |
| G1-22 | DB/runtime | all endpoints | CONFIRMED (config) / NEEDS REAL VERIFICATION | P1 | `Dockerfile:13`, `docker-compose.yml`, no WSGI server in requirements | Confirm real Azure startup command; add gunicorn if this config is actually deployed as-is |
| G1-23 | DB/runtime | all endpoints | NEEDS REAL MEASUREMENT | P2 | No pooling package found | Decide after G1-21/22 resolved |
| G1-24 | DB/runtime | Students/Requests search | NO MEANINGFUL ISSUE (locally) / flag for real data | P3 | No slow query observed at tested N | Re-check at real production table sizes if search becomes slow |
| G1-25 | End-to-end | all endpoints | NEEDS REAL MEASUREMENT | — | No real HTTP/network/Azure cost measured anywhere in this series | Real-environment timing pass, out of this audit's local-only scope |

---

## 13. Prioritized Fix Plan for the Next Phase

Grouped so this can become **one implementation prompt** per group.

### Group 1 — MUST FIX (P0, clear, well-evidenced, ready to scope)

**`StudentRequestViewSet`/`StudentRequestSerializer` N+1 (G1-09, +
opportunistically G1-13 since it's the identical pattern in the dormant
`TransferViewSet`).** Add `select_related('source_region')` to
`StudentRequestViewSet.get_queryset()`; add `prefetch_related`/`Prefetch`
for `destination_regions` and for the bed-assignment data
`current_bed`/`placement_history` need (two different shapes — `current_bed`
needs only the single active assignment, `placement_history` needs the
most-recent-10 regardless of status — likely two separate `Prefetch`
calls with `to_attr`); eliminate the `destination_regions`
declared-field/method-field duplicate query. Add correctness tests
(compare against original per-row values, mirroring
`AnalysisOccupancyCorrectnessTests`) and a flat-query-count regression
test (mirroring the Buildings/Analysis "after" test pattern) — closing the
coverage gap noted in §6.5. Optionally extend the identical fix to
`TransferViewSet`/`TransferSerializer` (G1-13) since it's the same 3-line
`select_related` addition, even though currently dormant.

### Group 2 — SHOULD FIX (P1/P2, safe, already well-scoped, low effort)

- **G1-04 (Analysis, 31→23 queries)** — fully documented and ready in
  `ANALYSIS_FIXED_QUERY_INSPECTION.md`; no new investigation needed, just
  implementation + the correctness tests that document already specifies.
- **G1-08 (Home Dashboard `latest_inbox` select_related)** — one-line fix.
- **G1-15 / G1-16 (Students detail double-query + missing select_related)** —
  two small, independent, low-risk fixes.
- **G1-06 (Home Dashboard 2→1 count consolidation)** — same pattern as
  G1-04's D-group, low risk.
- **Add query-count regression tests to `tests_requests.py`/
  `tests_transfer_regions.py`** (closing the gap noted in §6.5) as part of
  the Group 1 fix, so this class of regression can't silently reappear.

### Group 3 — WORTH FIXING ONLY IF MEASUREMENT SUPPORTS IT (do not implement blindly)

- **G1-07 (Home Dashboard `run_qs` 4x)** — real consolidation risks
  correctness (bounded-window `has_completed_run` could become wrong);
  only pursue with a carefully-designed correctness test, or leave as-is.
- **G1-19 / G1-20 (Reports Python-pass/loader cleanup)** — real but
  low-impact (user-click-triggered, bounded by typical region size);
  worth doing opportunistically, not urgent.
- **G1-18 (`dormify_report` unbounded)** — do not add region-scoping or a
  background-job mechanism without first confirming real row counts
  justify the effort; could be "leave alone, it's rarely called" or "needs
  a real redesign," and only real data can tell which.

### Group 4 — NEEDS REAL-ENVIRONMENT MEASUREMENT BEFORE ANY DECISION

- **G1-21 (`CONN_MAX_AGE`)**, **G1-22 (production WSGI server)**,
  **G1-23 (connection pooling)** — these three are related; resolve/measure
  G1-21 and G1-22 together first (they're both about the same underlying
  "how does a real request actually reach Postgres" question), then decide
  G1-23.
- **G1-24 (search indexing)** — only worth revisiting if real table sizes
  or a real observed slow query justify it.

### Group 5 — LEAVE ALONE (already correct / already decided)

- G1-01, G1-02, G1-03, G1-05, G1-14, G1-17 — all already fixed or already
  correctly decided; no further action without new evidence.
- Reports' lack of pagination (§8.3) — correct by design, not a finding.
- G1-10, G1-11, G1-12 — real, but explicitly frontend-coupled and out of
  this backend audit's remit; documented for whoever owns the coordinated
  frontend fix, not actioned here.

---

## 14. Exact Files Created/Changed During This Audit

- `project-quality/performance/GROUP1_BACKEND_PERFORMANCE_AUDIT.md` — this
  file, new. **The single main report for this phase.**
- Two temporary diagnostic scripts were created under
  `backend/api/performance_tests/` to empirically verify findings via
  `CaptureQueriesContext` (Home Dashboard, Student detail, Transfers
  payload growth, StudentRequest list N+1), run once each, and **deleted
  immediately after** — neither is present in the tree and neither was a
  deliverable.

**Not modified:** any production application file (`backend/api/views.py`,
`serializers.py`, `models.py`, `report_exports.py`), any frontend file, any
migration, any Django setting, `docker-compose.yml`, `Dockerfile`,
`.env`/`.env.test`, any allocation-owned file, or any prior phase's
documentation/evidence (`ANALYSIS_*`, `BUILDINGS_*`, `APARTMENTS_*`,
`ROOMS_*`, `BEDS_*`, `PAGINATION_ANALYSIS_SUMMARY.md`,
`PERFORMANCE_SESSION_FINAL_SUMMARY.md`, `PERFORMANCE_OPTIMIZATION_RESULTS.md`
— all left byte-for-byte as they were at the start of this audit). Nothing
was committed, pushed, merged, reset, restored, or cleaned.

---

## 15. Tests / Measurements Run and Results

| Command | Purpose | Result |
|---|---|---|
| `ENV_FILE=.env.test python manage.py check` | System check | No issues (0 silenced) |
| `ENV_FILE=.env.test python manage.py test api.tests_students_performance -v 2` | Re-verify Students list is still fixed | **8/8 passed** |
| `ENV_FILE=.env.test python manage.py test api.tests_home_dashboard api.tests_requests api.tests_transfer_regions -v 1` | Verify existing behavior tests for newly-audited areas still pass (no code changed, sanity check only) | **44/44 passed** |
| Temporary diagnostic: Home Dashboard query dump (central_admin + region_boss) | Empirical query count for `/api/home/` | 17 / 15 queries respectively (§4) |
| Temporary diagnostic: Student detail double-query check | Empirically confirm G1-15 | 3 total queries, 2 identical `BedAssignment` queries confirmed (§7.4) |
| Temporary diagnostic: `StudentRequest` list N+1 check (N=25) | Empirically confirm G1-09 | **127 queries, 572ms, 37KB** confirmed (§6.2) |
| Temporary diagnostic: `/api/transfers/` payload growth (N=25, N=100) | Empirically confirm G1-13 | 101→401 queries, linear (§6.4) |

All runs used the pre-existing local disposable `test_db` Docker container
via `.env.test` — the real Azure database was never touched. No allocation
test suite was run or modified — none of the areas audited required it
(AllocationRun was only ever read, per the ownership boundary).

---

## 16. Final Conclusion

- **Confirmed remaining issues in Group 1:** 19 (G1-04, 06, 07, 08, 09, 10,
  11, 12, 13, 15, 16, 18, 19, 20, 21, 22, 23, 24, 25) — the rest (G1-01,
  02, 03, 05, 14, 17) are already fixed or already correctly decided, not
  open issues.
- **Severity breakdown:**
  - **P0: 1** (G1-09 — `StudentRequestViewSet`/Requests-page N+1, 127
    queries/25-row page, the clear top priority).
  - **P1: 4** (G1-10 — frontend pagination bug, frontend-coupled;
    G1-18 — `dormify_report` unbounded, structural; G1-21 —
    `CONN_MAX_AGE=0`; G1-22 — dev server in Docker config).
  - **P2: 7** (G1-04, G1-08, G1-11, G1-13, G1-19, G1-20, G1-23).
  - **P3: 6** (G1-06, G1-07, G1-12, G1-15, G1-16, G1-24).
  - Plus **1 cross-cutting "needs measurement" item** not independently
    severity-ranked (G1-25 — real network/Azure cost, blanket limitation
    of this whole investigation series).
- **Areas already healthy, no action needed:** Buildings, Apartments,
  Rooms, Beds (query efficiency and pagination decision both closed);
  Analysis's N+1 (closed; only its documented fixed-cost cleanup remains
  open, P2); Students list (closed); Students filter-options; Home
  Dashboard's core structure (no N+1, only minor P2/P3 trims);
  Reports' query-efficiency-within-generation (confirmed no N+1, correct
  region-scoping when given).
- **Requires real-environment (Azure) measurement before further
  decisions:** G1-18 (`dormify_report` real row counts), G1-21
  (`CONN_MAX_AGE` real latency), G1-22 (what Azure actually runs), G1-23
  (pooling decision), G1-24 (search-index need at real scale), and — as a
  blanket caveat over every number in this entire investigation series —
  real HTTP/network/TLS cost was never measured anywhere.
- **Is Group 1 ready for the implementation/fix phase?** **Yes.** The top
  priority (G1-09) is precisely scoped, measured, and low-risk to fix
  using a pattern already proven safe five times over in this same
  investigation series. The "should fix" group (Group 2 in §13) is
  similarly low-risk and, in Analysis's case, already fully designed.
  Nothing in the "needs real measurement" set blocks starting the P0/P1
  code-level fixes — those are independent, config/environment-level
  questions that can be pursued in parallel or afterward.
