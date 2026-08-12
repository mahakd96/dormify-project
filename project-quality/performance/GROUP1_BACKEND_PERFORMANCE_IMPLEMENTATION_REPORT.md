# Group 1 — Backend Performance & Efficiency: Implementation Report

Prepared for external AI review. This is the **implementation** phase
following `GROUP1_BACKEND_PERFORMANCE_AUDIT.md`. All fixes below are
backend-only, measured locally against the disposable Postgres test
database, and regression-tested. **No frontend code, no real-environment
configuration, and no allocation-owned logic was touched.**

## 1. Executive Summary

Six of the audit's confirmed/likely-safe findings were implemented,
measured, and regression-tested in this phase:

| Priority | Area | Result |
|---|---|---|
| 1 (P0) | Requests list N+1 (G1-09) | **127 → 5 queries** at N=25 (96.1% reduction), flat at N=1/25/100 |
| 2 | Transfers list N+1 (G1-13) | **401 → 1 query** at N=100 (99.8% reduction), flat at N=1/25/100 |
| 3 | Analysis fixed-query cleanup (G1-04) | **31 → 23 queries**, flat, all 4 safe consolidations implemented and validated (one at 2,000-row synthetic scale) |
| 4 | Home Dashboard (G1-06, G1-08) | 2 queries merged to 1 (admin path); a lazy per-request query eliminated (region-scoped path) |
| 4 | Home Dashboard (G1-07) | **Investigated, deliberately left unchanged** — no safe consolidation exists without weakening `has_completed_run`'s correctness |
| 5 | Student detail (G1-15, G1-16) | Duplicate `BedAssignment` query eliminated (2→1); `batch` lazy-fetch eliminated |
| 6 | Reports (G1-19, G1-20) | `manual_review_report`'s redundant validation passes reduced 5→3; `capacity_report` no longer loads Student data at all |

Every fix reuses the exact `select_related`/`prefetch_related`/DB-`aggregate()`
pattern already proven safe across the prior Buildings/Apartments/Rooms/Beds/
Analysis phases of this investigation series. Every fix has a dedicated
correctness test comparing the optimized output against either
hand-computed expected values or the original (pre-optimization) query
logic run directly against the same data — several at meaningful
synthetic scale, per the explicit instruction not to accept an
optimization that trades query count for materially worse Python/CPU/data
transfer behavior without validating it.

**What was deliberately NOT done**, per explicit instruction:

- G1-18 (`dormify_report` unbounded architecture), G1-21 (`CONN_MAX_AGE`),
  G1-22 (production WSGI server), G1-23 (connection pooling), G1-24
  (search/index strategy), G1-25 (real HTTP/Azure cost) — all remain
  **NEEDS REAL-ENVIRONMENT MEASUREMENT**, unchanged. No speculative
  configuration change was made.
- G1-10, G1-11, G1-12 — frontend-coupled findings (pagination not
  followed, client-side filtering, full-list reload on approve/reject) —
  **no frontend code was modified**. Carried forward as
  "frontend-coordinated follow-up," not resolved here.
- G1-07 — investigated and explicitly **not** consolidated (see §6).

**Status: LOCAL BACKEND FIXES COMPLETE for the scope assigned to this
phase.** `REAL-ENVIRONMENT VALIDATION STILL REQUIRED` for the six items
above, and `FRONTEND-COORDINATED FOLLOW-UP STILL REQUIRED` for the three
frontend-coupled findings — see §10-§11 for the full, explicit breakdown.

---

## 2. Starting State

- **Branch:** `donia-analysis-performance` (unchanged — no branch switch,
  no reset/restore/clean at any point).
- **Working tree at the start of this phase:** already carried the
  completed, uncommitted Analysis N+1 fix and `GROUP1_BACKEND_PERFORMANCE_AUDIT.md`
  from the immediately-preceding phases of this same investigation
  series — preserved and built on, not redone.
- **Findings addressed in this phase**, per `GROUP1_BACKEND_PERFORMANCE_AUDIT.md`'s
  findings table: G1-04, G1-06, G1-08, G1-09, G1-13, G1-15, G1-16, G1-19,
  G1-20. G1-07 was investigated and left unchanged (§6). G1-01/02/03/05/14/17
  were already healthy/closed and untouched. G1-10/11/12 (frontend) and
  G1-18/21/22/23/24/25 (real-environment) were explicitly out of scope for
  this phase, per instruction.
- **Test environment:** the same pre-existing local disposable PostgreSQL
  16 Docker container (`dormify_test_db`) used throughout this entire
  investigation series, via `ENV_FILE=.env.test`. The real Azure database
  was never connected to at any point.

---

## 3. Requests N+1 (G1-09) — Priority 1

### Baseline (frozen, from the audit)

`GET /api/requests/`, 25 rows, region_transfer-type requests (each with a
`source_region` and one `destination_regions` entry, each student holding
one active `BedAssignment`): **127 SQL queries**, ~572 ms locally.

### Root cause

`StudentRequestSerializer` (`backend/api/serializers.py`) had 3 sources
of per-row query cost, none prefetched by `StudentRequestViewSet.get_queryset()`:

1. `get_current_bed` — `obj.student.current_bed` (a fresh, uncached
   `BedAssignment` query per row).
2. `get_placement_history` — `obj.student.bed_assignments...[:10]`
   (another fresh query per row).
3. `destination_regions` — declared **twice**: once as a writable
   `PrimaryKeyRelatedField(many=True, ...)` (a `Meta.fields` entry) and
   once as `get_destination_region_names()` (a `SerializerMethodField`) —
   both independently call `obj.destination_regions.all()`, so this one
   M2M relation was queried **twice per row**.
4. `source_region_name` (`source='source_region.name'`) — `source_region`
   was not in `get_queryset()`'s `select_related`, so this was a lazy
   per-row fetch whenever set.

### Implementation

**`backend/api/views.py`**, `StudentRequestViewSet.get_queryset()`:

- Added `'source_region'` to `select_related(...)`.
- Added `.prefetch_related(...)` with:
  - `'destination_regions'` (a plain prefetch — Django's M2M prefetch
    cache transparently satisfies both the declared field's and the
    method field's bare `.all()` calls, so **no serializer code change
    was needed** for this part).
  - Two `Prefetch('student__bed_assignments', ..., to_attr=...)` objects
    on the *same* relation path, distinguished by `to_attr`
    (`prefetched_current_assignment_list` — filtered to `status=ACTIVE`,
    matching `current_bed`'s exact original filter; and
    `prefetched_placement_history_all` — all statuses, ordered
    `-assigned_at`, matching `placement_history`'s exact original query)
    — Django runs exactly one query per `Prefetch`, not one per row.

**`backend/api/serializers.py`**, `StudentRequestSerializer`:

- `get_current_bed`: reads `student.prefetched_current_assignment_list[0]`
  first (a DB-level `unique_active_assignment_per_student` constraint
  guarantees at most one match), falling back to the original
  `obj.student.current_bed` property when the attribute is absent (object
  not built via `get_queryset()`).
- `get_placement_history`: reads `student.prefetched_placement_history_all[:10]`
  first (sliced in Python to the same top-10 the original SQL `LIMIT`
  used — a per-student list, bounded by that one student's own
  assignment history, not by page size), same fallback pattern.
- `get_destination_region_names`: **unchanged** — automatically benefits
  from the queryset-level `prefetch_related('destination_regions')`.

**Critical correctness fix — `StudentRequestViewSet.approve()`:**
`approve()` fetches `req` via `get_object()` (which uses the prefetching
`get_queryset()`), then may create/end a `BedAssignment` for `req.student`
*inside the same request*, then serializes `req` for the response. Without
intervention, the response would show the **stale, pre-approval**
`current_bed`/`placement_history` from the prefetch cache populated before
the mutation. Fixed by explicitly invalidating
(`delattr`) the two `to_attr` caches on `req.student` immediately before
building the response, forcing the serializer's fallback path (a fresh
query) to run — exactly reproducing the original (always-fresh) behavior
for this one action, with zero cost to the (unaffected) list-endpoint
optimization.

### Correctness protection

New test module `backend/api/performance_tests/test_requests_performance.py`,
class `StudentRequestNPlus1CorrectnessTests` (4 tests):

- 14-assignment history (13 ended, staggered `assigned_at`, 1 active) —
  proves `current_bed` returns only the active one, `placement_history`
  caps at exactly 10 entries in the correct most-recent-first order, and
  both match the original per-row query logic run directly against the
  same data (byte-for-byte, including `assigned_at`/`ended_at` datetimes).
- `destination_regions`/`source_region_name` with 2 destination regions —
  proves both the declared field and the method field return the same,
  correct set, and `source_region_name` is populated.
- A student-less request — proves the `None`/`[]` short-circuit is
  unchanged.
- **The `approve()` staleness case** — creates an active assignment,
  approves a `ROOM`-type request moving the student to a new bed, and
  asserts the response's `current_bed` is the **new** bed, not the old
  one (this is the test that would have caught the cache-invalidation bug
  if it were missing).

### Before/after and query scaling

| N (requests) | Queries before | Queries after |
|---:|---:|---:|
| 1 | *(not separately measured in the audit)* | 5 |
| 25 (region_transfer scenario, matching audit exactly) | **127** | **5** |
| 100 | *(not separately measured in the audit)* | 5 |

Marginal cost: **0.00 queries/request** at both N=1→25 and N=25→100
(`test_query_count_flat_across_n_simple_requests`), vs. the audit's
~5.0/row marginal cost pre-fix. **96.1% query reduction** at the exact
audit-matching N=25 scenario (`test_query_count_flat_with_region_transfer_fields_matching_audit_scenario`).

### Tests

`api.performance_tests.test_requests_performance` — **6/6 passed**
(2 scaling/regression tests, 4 correctness tests) — see §13 for the full
run log reference.

---

## 4. Transfer Endpoint (G1-13) — Priority 2

### Baseline (frozen, from the audit)

`GET /api/transfers/`: 101 queries at N=25, 401 at N=100 (marginal cost
4.00 queries/transfer). This endpoint is not called anywhere in the
current frontend (`TransfersPage.js` uses `/api/requests/`, not
`/api/transfers/` — confirmed by the audit's repo-wide search), but
remains a reachable, confirmed-N+1 backend API.

### Implementation

**`backend/api/views.py`**, `TransferViewSet.get_queryset()` — extended
`select_related` from `'student', 'from_room', 'to_room', 'requested_by', 'reviewed_by'`
to also cover the exact chains `TransferSerializer` reads:
`'from_room__apartment', 'from_room__apartment__building'`,
`'to_room__apartment', 'to_room__apartment__building'`, and
`'requested_by__region'`. No other line was touched — permissions, the
region-isolation filter, and the `status` query param filter are
unchanged.

### Correctness protection

New test module `backend/api/performance_tests/test_transfers_performance.py`,
`TransferSerializerCorrectnessTests` — asserts
`from_building_number`/`from_apartment_number`/`to_building_number`/
`to_apartment_number`/`requested_by_region_name` all match hand-computed
expected values for a fixture with distinct from/to apartments and a
region-scoped `requested_by` user.

### Before/after and query scaling

| N (transfers) | Queries before | Queries after |
|---:|---:|---:|
| 1 | *(not separately measured in the audit)* | 1 |
| 25 | 101 | 1 |
| 100 | 401 | 1 |

Marginal cost: **0.00 queries/transfer** at both N=1→25 and N=25→100.
**99.8% query reduction** at N=100 (401 → 1).

### Remaining pagination consideration

**No pagination was added.** `/api/transfers/` remains unpaginated
(returns a plain JSON array), per the explicit instruction not to add
pagination unless it can be proven not to break an existing API contract
— and since the endpoint is currently unused by any frontend code, there
is no way to verify locally that a caller wouldn't be broken by a
paginated envelope, nor any confirmed need (no active traffic to protect
today). The test suite explicitly asserts the response stays a plain list
(`assertIsInstance(resp.data, list)`), so this remains a documented,
regression-tested contract, not an oversight. If/when this endpoint is
ever wired into the frontend, its unpaginated nature should be
reconsidered at that time, following the same evidence-based process used
for Buildings/Apartments/Rooms/Beds (`PAGINATION_ANALYSIS_SUMMARY.md`).

### Tests

`api.performance_tests.test_transfers_performance` — **2/2 passed**
(1 scaling/regression test, 1 correctness test).

---

## 5. Analysis Final Optimization (G1-04) — Priority 3

### Starting state

`GET /api/analysis/` was already flat at **31 queries** (the per-building
N+1 closed in the prior phase). `ANALYSIS_FIXED_QUERY_INSPECTION.md`
identified 2 unconditionally-wasted queries and 4 consolidation
candidates (10 queries → potentially 4) — none implemented yet at the
start of this phase.

### Consolidations implemented (all 4 candidates + the waste elimination)

All were implemented — no candidate was rejected. Each is documented
inline in `analysis_data()` at its exact location:

1. **Building-count waste elimination (2 queries → 0 wasted):**
   `all_buildings_count`/`inactive_buildings_count` were computed
   unconditionally (system-wide) and then immediately discarded/
   recomputed region-scoped whenever `region` was set. Restructured into
   an `if region: ... else: ...` so exactly one shape is computed, never
   both. Pure dead-code elimination — not a trade-off.
2. **Rooms group (2 → 1, via true DB-side aggregation, not a Python-side
   trade):** `total_capacity` (`sum(values_list('capacity'))`, fetching
   every room row into Python) and `total_rooms` (`.count()`) replaced
   with a single `rooms_qs.aggregate(total_capacity=Sum('capacity'), total_rooms=Count('id'))`
   — **zero room rows are now transferred to Python at all**, strictly
   less data movement than before, not merely fewer round trips. This is
   the cleanest of the four fixes.
3. **Assignments group (3 → 1, the one Python-side trade — validated at
   scale):** `assigned_students` (`COUNT DISTINCT`), `assigned_student_ids`
   (a raw fetch — already existing, reused later by the students-by-region
   loop), and `assigned_beds` (`COUNT DISTINCT`) consolidated into one
   fetch of `assignments_qs.values('student_id', 'bed_id')`, with both
   counts derived as `len(set(...))` in Python. **This is not "fetch more
   to save queries"**: `assigned_student_ids` already had to pull every
   matching row into memory (unchanged, still reused downstream) — adding
   `bed_id` to that *same* fetch costs zero additional round trips.
   Explicitly validated at **2,000 active BedAssignments** in one region
   (`test_assigned_students_and_beds_correct_and_performant_at_2000_assignments`):
   values matched the ground-truth original query logic exactly, and
   server-side time was 245 ms (well under a 5-second sanity ceiling) —
   this is the one change the implementation instructions specifically
   called out for stress-scale validation before keeping.
4. **Transfers group (3 → 1):** `total_transfers`/`pending_transfers`
   (2 separate `.count()` queries) derived from `transfers_by_status`'s
   already-grouped counts (moved earlier in the function, computed once,
   reused both for the summary numbers and the `transfers_by_status`
   response field — no second, regrouped query).
5. **Requests group (2 → 1):** `pending_requests` derived by summing
   `pending_requests_by_type`'s already-grouped counts (same reasoning —
   `requests_qs` is already filtered to `status=PENDING` only, so the
   grouped counts sum to exactly what `pending_requests` needs).

### Why nothing was rejected

Every candidate the audit identified turned out to be safe:
join-structure inspection (documented in `ANALYSIS_FIXED_QUERY_INSPECTION.md`,
reconfirmed here) showed the transfers/requests region-scoping filters
use only forward FK joins (no fan-out risk for the `.distinct()`/grouped-count
reasoning), and the one Python-side trade (assignments group) was
validated empirically at 2,000-row scale rather than assumed safe.

### Final query count and scale testing

| N (buildings) | Queries (Phase 2, per-building fix only) | Queries (this phase, final) |
|---:|---:|---:|
| 1 | 31 | **23** |
| 5 | 31 | **23** |
| 25 | 31 | **23** |

Flat at N=1/5/25 (marginal 0.00 both intervals), flat across student
volume (S=50/500 extra students, unchanged from the prior phase — the
student loop was not touched), and flat at **2,000 assignments**
(dedicated stress test). Response payloads remain byte-identical to the
Phase 2 baseline at every N (1,324 / 2,292 / 7,162 bytes). **31 → 23,
exactly matching the audit's `31 − 8` prediction** (2 + 2 + 1 + 2 + 1 = 8),
not forced — this is the measured result of implementing every candidate
the audit found safe.

### Tests

`api.performance_tests.test_analysis_performance` — **8/8 passed**
(the pre-existing 3 scaling tests + 3 correctness tests, unchanged in
assertions but now measuring 23 instead of 31; plus 2 new
`Group1FixedQueryConsolidationTests` — a hand-computed small-scale summary
correctness test and the 2,000-assignment stress test).
`api.tests_analysis` — **12/12 passed**, unchanged.

---

## 6. Home Dashboard (G1-06, G1-07, G1-08) — Priority 4

### Fixes made

**G1-08** (`backend/api/views.py`, "Region inbox status" section): the
`latest_inbox` query only `select_related`d `'batch'`, not `'region'` —
`RegionInboxSerializer.region_name` (`source='region.name'`) was a lazy
per-request query whenever `latest_inbox` was not `None`. Fixed by adding
`'region'` to that `select_related(...)` call. One-line, zero risk.

**G1-06** (same section, admin/system-wide path only — `region is None`):
`pending_inbox_count`/`viewed_inbox_count` were two independent
`RegionInbox.objects.filter(status=X).count()` queries. Consolidated into
one `.values('status').annotate(c=Count('id'))` groupby, with both counts
read from the resulting dict. Same pattern already used for Analysis's
transfers/requests groups.

### G1-07 — investigated, deliberately left unchanged

`run_qs` (`AllocationRun`) is evaluated 4 separate times in
`home_dashboard()`: `active_run` (status-filtered `.first()`), `latest_run`
(unfiltered `.first()`), `has_completed_run` (status-filtered `.exists()`),
and a `[:3]` slice for `recent_activity`. The implementation instructions
explicitly forbid answering `has_completed_run` from a bounded recent-N
window (it would silently return a wrong answer — "no completed run
found in my recent N" — if more than N non-completed runs exist before
the most recent completed one). No other safe consolidation exists
without assuming an allocation-app invariant (e.g. "a new run never
starts while one is still active") that this phase has no authority to
assume, per the ownership boundary (`AllocationRun` is allocation-owned
data; Home may only change *how* it's read, never what the read means).
Each of the 4 queries is already a single, simple, appropriately-scoped
lookup — not a table scan — so the correctness risk of forcing a
consolidation does not clear the bar the measured benefit would justify.
**Left unchanged**, with the reasoning recorded as an inline code comment
at the exact spot in `views.py` (`"Allocation runs"` section) as well as
here.

### Before/after

| Scenario | Queries before (frozen audit baseline) | Queries after |
|---|---:|---:|
| central_admin | 17 | **16** |
| region_boss | 15 | **14** |

Both scenarios drop by exactly 1 query. The central_admin drop is G1-06
(2→1 on the admin-only path). Note that G1-08 does not, by itself, change
query *count* for a given fixture — it widens an existing
`select_related`, which turns what would otherwise be a *conditional*
extra query (only present when `latest_inbox` exists and is serialized)
into zero extra queries; the region_boss row's 15→14 reflects this
phase's measurement fixture rather than an exact re-run of the audit's
richer one. G1-08's correctness (not its query-count effect in isolation)
is confirmed directly by `test_g1_08_latest_inbox_region_name_populated_correctly`:
`region_name` is still correct, now sourced from the single joined
`latest_inbox` query instead of a separate lazy fetch.

### Tests

`api.performance_tests.test_home_dashboard_performance` — **4/4 passed**
(2 query-count tests, 2 correctness tests covering G1-08's `region_name`
value and G1-06's consolidated counts against the exact original
two-independent-`.count()` ground truth). `api.tests_home_dashboard` —
**unchanged, re-run for regression** (see §13).

---

## 7. Students (G1-15, G1-16) — Priority 5

### Detail fixes

**G1-15** (`backend/api/serializers.py`, `StudentSerializer`):
`get_current_bed_id`/`get_current_bed_label` each independently called
`obj.current_bed` (an uncached `@property` that runs a fresh
`BedAssignment` query on every access) — issuing the identical query
twice per detail/create/update response. Fixed with a small
`_current_bed_cached(obj)` helper that caches the property's result on
the instance (`obj._cached_current_bed`) for the duration of one
serialization; both methods now read the cache. Same underlying
query/semantics, called once instead of twice.

**G1-16** (`backend/api/views.py`, `StudentViewSet.get_queryset()`):
`StudentSerializer.batch_id` (`source='batch.id'`) was not covered by any
`select_related`, so every detail/create/update response issued a lazy
per-response query. Fixed by adding an `else:` branch (alongside the
existing `if self.action == 'list':` branch) that adds
`select_related('batch')` for every **non-list** action only — the list
action's queryset (and `StudentListSerializer`, which has no `batch_id`
field) is completely untouched.

### Before/after

| Metric | Before (frozen audit baseline) | After |
|---|---:|---:|
| Total queries, `GET /api/students/{id}/` (student with 1 active assignment) | 3 | **2** |
| `BedAssignment` queries in that request | 2 (identical) | **1** |

### Confirmation the list endpoint remains healthy

**No change was made to the list action's queryset or serializer.**
Re-ran the existing `api.tests_students_performance` suite (the dedicated
regression guard for the historical list-page N+1) — **8/8 passed**,
including `test_students_list_query_count_is_flat` (still `< 12` queries
for a 25-row page) — unaffected by this phase's detail-only changes.

### Tests

`api.performance_tests.test_student_detail_performance` — **4/4 passed**
(2 query-count tests including the `batch` JOIN-not-separate-query check,
2 correctness tests — unassigned student returns `None`, and an
assigned student's `current_bed_id`/`current_bed_label` match the
original uncached property exactly, including an ended→reassigned
history).

---

## 8. Reports (G1-19, G1-20) — Priority 6

### G1-19 — `manual_review_report`'s redundant validation passes

**Root cause:** 3 of the report's 5 sheet-builder functions
(`_build_exceptions_summary_rows`, `_build_all_exceptions_rows`,
`_build_unassigned_with_issues`) each independently called
`_student_issues(student, seen_ids)` over the full `all_students` list,
each with its **own fresh `seen_ids` dict** — since all three iterate the
exact same already-materialized list in the exact same order, a fresh
`seen_ids` per call always produced identical results anyway (duplicate-ID
detection is order-dependent: only the *second+* occurrence of a repeated
ID is flagged, and the order across the 3 calls is the same by
construction). The other 2 builders (`_build_duplicate_id_rows`,
`_build_missing_data_rows`) compute genuinely different things (group-by-ID
duplicate detection; a missing-data-only check without the duplicate
component) and were left as their own passes.

**Fix** (`backend/api/report_exports.py`): new helper
`_compute_student_issues(all_students)` computes `_student_issues()` for
every student **once**, in a single pass with one shared `seen_ids`,
returning `(student, issues)` pairs. The 3 identical-computation builders
now accept this pre-computed list instead of re-deriving it.
`generate_manual_review_report()` computes it once
(`student_issues = _compute_student_issues(d['all_students'])`) and passes
it to all 3. **Result: 5 full passes over `all_students` → 3** (the 2
structurally-different builders unchanged).

### G1-20 — `capacity_report` loading unused Student data

**Root cause:** `_load_data()` always fetched every `Student` row and
every active `BedAssignment` (plus 5 Python-side category list
comprehensions), regardless of caller — `generate_capacity_report()` only
ever reads `d['all_beds']`/`d['occupied_bed_ids']`, never any
student-derived key.

**Fix:** `_load_data()` gained an `include_students=True` parameter
(default preserves every existing caller's exact prior behavior — the
returned dict's key set is always identical regardless of the flag, just
with empty defaults when `False`). `generate_capacity_report()` now calls
`_load_data(region_id=region_id, include_students=False)`. Bed/occupancy
loading (`bed_qs`, `occ_qs`) is unconditional, unchanged, and was always
computed independently of the student-loading block to begin with — this
was a clean, structurally-obvious split, not a risky refactor.
`dormify_report`/`student_actions_report`/`manual_review_report` all keep
the `include_students=True` default, byte-for-byte unaffected.

### Correctness / output protection

New test module `backend/api/performance_tests/test_reports_performance.py`:

- `CapacityReportPerformanceTests` — confirms **zero** standalone
  `Student` queries in `generate_capacity_report()`'s captured queries,
  and cross-checks the generated workbook's occupancy numbers (parsed
  directly via `openpyxl`) against a hand-computed fixture (1 of 3 beds
  occupied).
- `ManualReviewReportCorrectnessTests` — generates a real workbook via
  `generate_manual_review_report()` with a clean/assigned student, a
  missing-gender/unassigned student, and a missing-student-id/unassigned
  student; parses all 5 sheets via `openpyxl` and asserts summary counts,
  per-sheet row membership, and row counts exactly match hand-computed
  expectations for every sheet, including the 2 untouched builders. A
  separate unit-level test
  (`test_compute_student_issues_flags_duplicate_ids_in_memory`) exercises
  the duplicate-ID path directly against in-memory (unsaved) `Student`
  objects — `Student.student_id` has a real DB-level unique constraint,
  so two *persisted* rows can never actually share an ID; this is the
  only way to construct that state at all, and it proves the shared
  single-pass computation reproduces the original fresh-`seen_ids`
  semantics exactly (first occurrence unflagged, second+ flagged).

### Before/after (where measurable)

| Metric | Before | After |
|---|---:|---:|
| `generate_capacity_report()` — standalone `Student` queries | 1 (+ implicit `BedAssignment` for `assignment_map`, unused) | **0** |
| `generate_capacity_report()` — total queries (region-scoped fixture) | *(not separately measured in the audit)* | 2 |
| `generate_manual_review_report()` — full passes over `all_students` | 5 | **3** |

Workbook *contents* are unchanged for every report — verified by the
correctness tests above, not merely asserted.

### Tests

`api.performance_tests.test_reports_performance` — **3/3 passed** (1
query-count test, 1 workbook-content correctness test, 1 duplicate-ID
unit test).

---

## 9. Already-Healthy Areas (re-confirmed, not re-implemented)

- **Buildings / Apartments / Rooms / Beds** — closed in a prior phase
  (BLD-01–04): flat 1-2 queries regardless of row count. `git diff`
  confirms `backend/api/views.py`'s Buildings/Apartments/Rooms/Beds
  sections are byte-for-byte unmodified by this phase.
  `api.performance_tests.test_buildings_performance`/
  `test_apartments_performance`/`test_rooms_performance`/
  `test_beds_performance` re-run as part of the final combined regression
  sweep in this phase (§13) to confirm no collateral effect from the
  `views.py`/`serializers.py` changes made elsewhere in the same files.
- **Buildings/Apartments/Rooms/Beds pagination** — analyzed, correctly
  decided **NOT CURRENTLY NECESSARY** (`PAGINATION_ANALYSIS_SUMMARY.md`);
  nothing in this phase changes that conclusion.
- **Students list + filter-options** — list endpoint's historical N+1
  (`current_bed`) already fixed and verified; `filter-options` action's 5
  independent, appropriately-scoped queries found to have no meaningful
  issue in the audit. Re-confirmed healthy in this phase via
  `api.tests_students_performance` (8/8) — **not touched** by the
  detail-only G1-15/G1-16 fixes.
- **Analysis's per-building loop** — closed in the prior phase (`31`
  flat, now `23` after this phase's fixed-query cleanup).

---

## 10. Frontend-Coordinated Follow-Up (NOT implemented in this phase)

**No React/frontend code was modified anywhere in this phase**, per
explicit instruction. The following audit findings remain open and
require a *coordinated* frontend change (not a backend-only fix) before
they can be resolved:

- **G1-10** — `TransfersPage.js`'s `loadRequests()` reads only
  `d.results` from the paginated `/api/requests/` response and never
  follows `d.next`. Beyond the first 25 matching requests, the rest are
  invisible to the UI regardless of how cheap the backend fetch is (this
  phase's G1-09 fix makes that first page cheap, but does not change what
  the frontend does with pagination it already receives).
- **G1-11** — the Requests page re-implements status/type/search
  filtering client-side over the (now correctly limited to 25 rows, but
  still only page-1) in-memory list, instead of using the backend's
  already-efficient, DB-side `status`/`request_type`/`search`/
  `date_from`/`date_to` filters `StudentRequestViewSet.get_queryset()`
  already supports.
- **G1-12** — every approve/reject action triggers a full,
  unfiltered `loadRequests()` reload instead of patching the single
  updated row locally in frontend state. This phase's G1-09 fix makes
  that reload much cheaper (5 queries instead of ~127), but does not
  eliminate the reload itself.

None of these are backend performance bugs — they are frontend
consumption patterns that don't yet take advantage of what the backend
already correctly provides (G1-11) or don't yet consume the pagination
contract correctly (G1-10). **Not resolving Group 1 backend work; flagged
here for whoever owns the coordinated frontend follow-up.**

---

## 11. Real-Environment Follow-Up (NOT implemented in this phase)

Per explicit instruction, **no speculative configuration change was
made** for any of the following — each requires either real production
data, real Azure deployment information, or a real network/HTTP
measurement this local-only phase cannot provide:

- **G1-18** — `dormify_report`'s unbounded, whole-system,
  no-region-filter architecture. Its real severity depends entirely on
  real total student/bed/assignment row counts across all regions, which
  were not available. Changing its architecture (region-scoping, a
  background job, etc.) without that evidence risks solving a problem
  that may not exist at real scale, or under-solving one that does.
- **G1-21** — `CONN_MAX_AGE = 0` in `backend/dormify/settings.py`. Its
  real latency impact depends on the real network path to the real
  (very likely TLS-secured, remote) Azure Postgres host — not
  reproducible against the local same-host Docker `test_db`.
  `settings.py` was **not modified**.
- **G1-22** — the backend Docker image/compose runs Django's development
  server (`manage.py runserver`), with no WSGI server in
  `requirements.txt`. Whether the *real* Azure App Service deployment
  actually uses this exact image/command, or overrides it with its own
  (often gunicorn-based) default startup, cannot be determined by
  inspecting this repository alone. `Dockerfile`/`docker-compose.yml`/
  `requirements.txt` were **not modified**.
- **G1-23** — connection pooling. A decision here depends on the outcome
  of G1-21/G1-22 (a pooler and `CONN_MAX_AGE` tuning are two different
  solutions to the same underlying problem — deciding between them before
  either is measured would be premature).
- **G1-24** — search/index strategy for `Student`/`StudentRequest`
  `icontains` search. No slow query was observed in this phase's
  synthetic, small-scale testing; a real index recommendation needs real
  production table sizes to be evidence-based rather than speculative.
- **G1-25** — real HTTP/network/TLS/Azure cost. Every query count and
  timing number in this entire investigation series (this phase
  included) was measured via DRF's in-process `APIClient` against a
  local, same-host Postgres container — never a real HTTP round trip,
  never real Azure latency.

**These six items remain exactly as classified in `GROUP1_BACKEND_PERFORMANCE_AUDIT.md`:
NEEDS REAL-ENVIRONMENT MEASUREMENT.** No file listed in §14 touches any
of settings, Docker, requirements, or database/pooling configuration.

---

## 12. Before/After Master Table

| Endpoint/area | Queries before | Queries after | Scaling before | Scaling after | Timing before → after (local, ms) | Payload | Status |
|---|---:|---:|---|---|---|---|---|
| `GET /api/requests/` (N=25, region_transfer scenario) | 127 | **5** | `~2 + 5×N` (marginal ~5.0/row) | **flat** | ~572 → ~130-145 | 37KB → 38KB (unchanged, same rows) | ✅ Fixed |
| `GET /api/transfers/` (N=100) | 401 | **1** | `1 + 4×N` (marginal 4.00/transfer) | **flat** | not separately timed in audit → ~46 | 55.4KB → 55.7KB (unchanged) | ✅ Fixed (dormant endpoint) |
| `GET /api/analysis/` (any N) | 31 | **23** | flat (already fixed prior phase) | flat | ~50-155 → ~50-155 (no material change; already flat) | byte-identical at every N | ✅ Cleaned up |
| `GET /api/home/` (central_admin) | 17 | **16** | flat | flat | ~87 → ~80 | 4,654 → 3,801 bytes (fixture differs slightly) | ✅ Improved |
| `GET /api/home/` (region_boss) | 15 | **14** | flat | flat | ~78 → ~50-105 | 4,617 → 4,140 bytes (fixture differs slightly) | ✅ Improved |
| `GET /api/students/{id}/` | 3 | **2** | flat (single object) | flat | not separately timed in audit → ~52-80 | ~1,474 bytes | ✅ Fixed |
| `generate_capacity_report()` | includes 1 unused Student query | **0 Student queries** | N/A (Python-side, not a scaling metric) | N/A | not separately timed in audit → ~73-85 | unchanged content | ✅ Fixed |
| `generate_manual_review_report()` | 5 full passes over `all_students` | **3 full passes** | O(5n) → O(3n) Python-side | — | not separately timed | unchanged content (verified) | ✅ Improved |
| Buildings/Apartments/Rooms/Beds | flat 1-2 (prior phase) | unchanged | flat | flat | unchanged | unchanged | ✅ Already healthy |
| Students list | flat <12 (prior phase) | unchanged | flat | flat | unchanged | unchanged | ✅ Already healthy |

("Payload differs slightly" notes above reflect different synthetic
fixtures between the audit measurement and this phase's dedicated test
fixtures, not a behavior change — each fix's own before/after comparison
in §3-§8 uses a held-fixture-constant methodology where payload
byte-identity was the actual claim being verified, e.g. Analysis's
byte-identical payloads at every N.)

---

## 13. Tests Run and Exact Results

| Command | Result |
|---|---|
| `ENV_FILE=.env.test python manage.py check` | No issues (0 silenced) — run repeatedly throughout this phase, always clean |
| `api.performance_tests.test_requests_performance` | **6/6 passed** |
| `api.performance_tests.test_transfers_performance` | **2/2 passed** |
| `api.performance_tests.test_analysis_performance` | **8/8 passed** |
| `api.performance_tests.test_home_dashboard_performance` | **4/4 passed** |
| `api.performance_tests.test_student_detail_performance` | **4/4 passed** |
| `api.performance_tests.test_reports_performance` | **3/3 passed** |
| `api.tests_analysis` | **12/12 passed**, unchanged |
| `api.tests_students_performance` | **8/8 passed**, unchanged (re-confirmed independently, §7) |
| **Full combined sweep: `api.tests_analysis api.tests_requests api.tests_transfer_regions api.tests_home_dashboard api.tests_students_performance api.tests_inventory api.performance_tests` (all suites, one process, one test database)** | **✅ 153/153 passed** (1381.7s / ~23 min — this local Windows/Docker environment has consistently shown 90-190s per medium suite throughout this whole session, due to per-query round-trip overhead over the Docker network bridge, not test logic; a single process covering ~150 tests including the 2,000-row Analysis stress test and the full 41-test `tests_inventory` suite genuinely takes this long here) |

This is the authoritative final confirmation: `api.tests_requests`,
`api.tests_transfer_regions`, and `api.tests_home_dashboard` (the
business-logic/authorization suites for the two viewsets and the one view
this phase modified) all passed unchanged, and `api.tests_inventory` plus
every Buildings/Apartments/Rooms/Beds performance test passed unchanged —
confirming zero collateral effect from this phase's `views.py`/
`serializers.py` changes on the code this phase did not touch.

All runs used the pre-existing local disposable `test_db` Docker
container via `ENV_FILE=.env.test`. The real Azure database was never
connected to. No allocation test suite
(`api.tests_allocation`, `api.tests_assisted_allocation`) was run or
modified — none of the areas touched in this phase required it
(`AllocationRun` was only ever read, per the ownership boundary, and its
read path in `home_dashboard()`/`analysis_data()` was not modified).

---

## 14. Exact Production Files Changed

- **`backend/api/views.py`**:
  - `StudentRequestViewSet.get_queryset()` — added `select_related('source_region')`
    and `prefetch_related('destination_regions', Prefetch(...) × 2)` (G1-09).
  - `StudentRequestViewSet.approve()` — added prefetch-cache invalidation
    for `req.student` before building the response (G1-09 correctness fix).
  - `TransferViewSet.get_queryset()` — extended `select_related` to cover
    `from_room`/`to_room` → apartment → building, and `requested_by__region`
    (G1-13).
  - `analysis_data()` — restructured the "Summary numbers" section: the
    assignments/rooms/transfers/requests consolidations and the
    Building-count dead-code elimination (G1-04). Added `Sum` to the
    existing `django.db.models` import.
  - `home_dashboard()` — `latest_inbox`'s `select_related` extended with
    `'region'` (G1-08); admin-path `pending_inbox_count`/`viewed_inbox_count`
    consolidated into one groupby (G1-06); added an inline comment
    documenting the G1-07 leave-unchanged decision (no functional change).
  - `StudentViewSet.get_queryset()` — added an `else:` branch adding
    `select_related('batch')` for non-list actions only (G1-16).
- **`backend/api/serializers.py`**:
  - `StudentRequestSerializer.get_current_bed`/`get_placement_history` —
    read the new prefetch caches first, with the original query as
    fallback (G1-09).
  - `StudentSerializer` — new `_current_bed_cached()` helper;
    `get_current_bed_id`/`get_current_bed_label` now read it instead of
    calling `obj.current_bed` independently (G1-15).
- **`backend/api/report_exports.py`**:
  - `_load_data()` — new `include_students=True` parameter; student/
    assignment loading wrapped in `if include_students:` (G1-20).
  - New helper `_compute_student_issues(all_students)` (G1-19).
  - `_build_exceptions_summary_rows`, `_build_all_exceptions_rows`,
    `_build_unassigned_with_issues` — signature changed from
    `(all_students, ...)` to `(student_issues, ...)`, reading pre-computed
    `(student, issues)` pairs instead of re-running `_student_issues`
    (G1-19). `_build_duplicate_id_rows`/`_build_missing_data_rows`
    unchanged.
  - `generate_manual_review_report()` — computes `student_issues` once,
    passes it to the 3 affected builders (G1-19).
  - `generate_capacity_report()` — calls `_load_data(..., include_students=False)`
    (G1-20).

**No model, migration, URL, permission class, or any other view/serializer/
report function was touched.** No frontend file, Django setting, Docker
configuration, `.env`/`.env.test`, or allocation-owned file was modified.

## 15. Exact Test/Docs/Evidence Files Changed

**New performance test modules:**
- `backend/api/performance_tests/test_requests_performance.py`
- `backend/api/performance_tests/test_transfers_performance.py`
- `backend/api/performance_tests/test_home_dashboard_performance.py`
- `backend/api/performance_tests/test_student_detail_performance.py`
- `backend/api/performance_tests/test_reports_performance.py`

**Extended existing performance test module:**
- `backend/api/performance_tests/test_analysis_performance.py` — updated
  docstring (documents this phase as "Phase 3 / Group 1 implementation");
  `EVIDENCE_FILE` redirected to a new file (see below, so the Phase 2
  evidence stays frozen); added `Group1FixedQueryConsolidationTests` (2
  new tests, including the 2,000-assignment stress test); added
  `Transfer`/`StudentRequest` to model imports. The pre-existing scaling
  and correctness test *assertions* are unchanged — they now simply
  observe 23 instead of 31, which the existing loose-bound assertions
  (`< 40`, marginal `≤ 0.5`) already accommodated without modification.

**New evidence files** (`project-quality/performance/evidence/`):
- `GROUP1_REQUESTS_AFTER_QUERY_COUNTS.txt`
- `GROUP1_TRANSFERS_AFTER_QUERY_COUNTS.txt`
- `GROUP1_ANALYSIS_FINAL_QUERY_COUNTS.txt`
- `GROUP1_HOME_AFTER_QUERY_COUNTS.txt`
- `GROUP1_STUDENTS_DETAIL_AFTER_QUERY_COUNTS.txt`
- `GROUP1_REPORTS_AFTER_QUERY_COUNTS.txt`

**Historical evidence — confirmed NOT overwritten:**
`ANALYSIS_BASELINE_QUERY_COUNTS.txt`, `ANALYSIS_BASELINE_TEST_RUN_LOG.txt`,
`ANALYSIS_AFTER_QUERY_COUNTS.txt` (Phase 2, 31-query evidence — this
phase's Analysis test module now writes to `GROUP1_ANALYSIS_FINAL_QUERY_COUNTS.txt`
instead), and every `BUILDINGS_*`/`APARTMENTS_*`/`ROOMS_*`/`BEDS_*`
evidence file — all untouched.

**This report:**
- `project-quality/performance/GROUP1_BACKEND_PERFORMANCE_IMPLEMENTATION_REPORT.md` — this file.

**Not modified:** `GROUP1_BACKEND_PERFORMANCE_AUDIT.md` and every other
prior-phase document (`ANALYSIS_BASELINE_SUMMARY.md`,
`ANALYSIS_OPTIMIZATION_SUMMARY.md`, `ANALYSIS_FIXED_QUERY_INSPECTION.md`,
`BUILDINGS_*`, `APARTMENTS_*`, `ROOMS_*`, `BEDS_*`,
`PAGINATION_ANALYSIS_SUMMARY.md`, `PERFORMANCE_SESSION_FINAL_SUMMARY.md`).
`PERFORMANCE_OPTIMIZATION_RESULTS.md` shows as modified in `git status`
only because it already carried the uncommitted Analysis Phase 1/2
sections from the prior phase — **this phase did not add a new section to
it** (per this phase's own scope, the master implementation report is
this file, not that running log).

---

## 16. Remaining Group 1 Risks / Items

- **G1-07** was investigated and intentionally left unchanged (§6) — not
  a risk, a documented decision. Revisit only if a future measurement
  shows the 4 separate `AllocationRun` queries are materially expensive
  at real data volume (not observed locally).
- **The 6 real-environment items (§11)** remain open by design — this
  phase could not and did not attempt to resolve them locally.
- **The 3 frontend-coupled items (§10)** remain open by design — no
  frontend code was touched.
- **`dormify_report` (G1-18)** is unchanged and still architecturally
  unbounded — explicitly out of scope, not fixed, not worsened.
- **Server-side timing throughout this phase** (and the entire
  investigation series) reflects DRF's in-process `APIClient` only — no
  real HTTP/network/Azure round trip is reflected in any number in this
  report.
- **Synthetic data only** — every fixture in every new test module in
  this phase was created and torn down by the test itself; no real
  production data was read or measured. The Analysis assignments
  consolidation was validated at 2,000 synthetic rows specifically
  because the instructions required stress-scale validation for that one
  change — this is still synthetic, not real-world, scale.
- **No new correctness gap was introduced by this phase's own test
  modules** (all now pass), but two pre-existing test-coverage gaps
  identified in the audit — `tests_requests.py`/`tests_transfer_regions.py`
  never asserted query counts, which is why the Requests N+1 was never
  caught before this investigation — are now partially closed by this
  phase's new `test_requests_performance.py`/`test_transfers_performance.py`
  modules, but the original business-logic test files themselves were
  **not modified** (per instruction: create new dedicated performance
  test modules, don't alter existing behavior tests).

---

## 17. Final Recommendation

**LOCAL BACKEND FIXES COMPLETE** for the scope assigned to this phase
(G1-04, G1-06, G1-08, G1-09, G1-13, G1-15, G1-16, G1-19, G1-20 — all
implemented, measured, and regression-tested; G1-07 investigated and
correctly left unchanged).

This is explicitly **not** "everything is solved":

- **REAL-ENVIRONMENT VALIDATION STILL REQUIRED** for G1-18, G1-21, G1-22,
  G1-23, G1-24, G1-25 (§11) — none of these were touched, and none can be
  resolved without real production data, real Azure deployment
  information, or a real network measurement.
- **FRONTEND-COORDINATED FOLLOW-UP STILL REQUIRED** for G1-10, G1-11,
  G1-12 (§10) — no frontend code was modified, and the Requests page will
  not show more than 25 requests, or use the backend's efficient filters,
  until that coordinated change happens.

Every fix that *was* in scope for this phase is implemented, has a
dedicated correctness test proving output equivalence (several against
the original pre-optimization query logic directly, one at 2,000-row
synthetic scale), has a dedicated query-count regression test, and passes
alongside the full set of pre-existing, unmodified business-logic test
suites for every area touched. No allocation-owned logic, frontend code,
model, migration, or configuration file was changed.
