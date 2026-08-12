# Group 1 Follow-Up — Student Requests `placement_history` Verification

**Scope:** one targeted verification (and, since the result was clearly
problematic, one small fix) of the `placement_history` prefetch strategy
implemented as part of Group 1 Priority 1 (G1-09) for
`GET /api/requests/` (`StudentRequestViewSet` / `StudentRequestSerializer`).

**Did NOT touch:** the allocation algorithm, `AllocationRun`, frontend code,
or any code outside `backend/api/views.py` (one new helper function + one
Prefetch queryset) and `backend/api/serializers.py` (one comment update, no
logic change). Nothing was committed, pushed, or merged.

---

## 1. Current Behavior (before this follow-up)

`StudentRequestViewSet.get_queryset()` prefetched each relevant student's
**entire** `bed_assignments` history (any status, ordered `-assigned_at`,
no DB-side `LIMIT`) into `student.prefetched_placement_history_all`, via:

```python
Prefetch(
    'student__bed_assignments',
    queryset=BedAssignment.objects.select_related(
        'bed__room__apartment__building',
        'bed__room__apartment__building__dorm_type__region',
    ).order_by('-assigned_at'),
    to_attr='prefetched_placement_history_all',
),
```

`StudentRequestSerializer.get_placement_history()` then sliced this to the
top 10 **in Python**:

```python
prefetched = getattr(obj.student, 'prefetched_placement_history_all', None)
if prefetched is not None:
    assignments = prefetched[:10]
```

This correctly eliminated the original per-row N+1 (flat query count
regardless of page size — confirmed again below), but it meant the SQL
query itself had no `LIMIT`: Postgres returned **every** historical
`BedAssignment` row for every student on the page, and only the first 10
(by `assigned_at desc`) were ever used per student. The remaining rows were
fully materialized into Django model instances (with joined
building/apartment/region data via `select_related`) and then discarded.

## 2. Test Dataset

Added `backend/api/performance_tests/test_placement_history_verification.py`,
building the worst case for this pattern:

- **25 `StudentRequest` rows** (`N_REQUESTS = 25`), each pointing at a
  **distinct** student (so all 25 students on the page are "relevant" —
  no sharing that would reduce the number of large histories fetched).
- **100 `BedAssignment` rows per student** (`HISTORY_PER_STUDENT = 100`):
  99 `ENDED` (reusing one `Bed` — no DB uniqueness constraint on ended
  assignments) with staggered `assigned_at` timestamps, plus 1 `ACTIVE` on
  a separate bed as the most recent entry.
- Ground truth per student = that student's own 10 most-recent assignments
  by `assigned_at desc`, computed independently in the test setup for
  cross-checking.

Endpoint under test: `GET /api/requests/?page_size=100` (single page
containing all 25 requests), same methodology as the rest of the Group 1
suite (`CaptureQueriesContext` + DRF `APIClient` + `time.perf_counter()`).

## 3. Measurements

### Before this follow-up (original Group 1 implementation)

| Metric | Value |
|---|---|
| Total SQL queries (HTTP request) | 5 (flat — same as N=1) |
| `server_side_request_time_ms` | 374.97 ms |
| `response_payload_bytes` | 77,532 |
| BedAssignment rows loaded into Python (all 25 students) | **2,500** |
| BedAssignment rows actually used in the response | 250 |
| **Overfetch ratio** | **10.0x** |

The query count stayed flat (the N+1 fix itself is sound — this is not a
regression of that fix), but the single placement-history query pulled 10x
more rows than needed, and every joined column
(`bed__room__apartment__building`, `...__dorm_type__region`) was hydrated
for all of them. This ratio is **not bounded by page size** — it scales
with each student's own lifetime assignment count, which only grows over
time (more transfers/room changes = more history rows fetched and
discarded on every single `/api/requests/` page load that includes that
student, forever).

### After the fix (DB-level top-10-per-student bound)

| Metric | Value |
|---|---|
| Total SQL queries (HTTP request) | 5 (flat — unchanged) |
| `server_side_request_time_ms` | 164.47 ms |
| `response_payload_bytes` | 77,532 (unchanged — same JSON) |
| BedAssignment rows loaded into Python (all 25 students) | **250** |
| BedAssignment rows actually used in the response | 250 |
| **Overfetch ratio** | **1.0x** |

Full evidence: `project-quality/performance/evidence/GROUP1_PLACEMENT_HISTORY_VERIFICATION_QUERY_COUNTS.txt`.

(The absolute time numbers reflect this local Windows/Docker Postgres
environment's per-query round-trip overhead, consistent with every other
measurement in this investigation series — the comparison that matters is
relative: same query count, 10x fewer rows moved and hydrated, and a
measured wall-clock improvement at this scale.)

## 4. Correctness Result

`test_correctness_top_10_per_request_matches_expected` — for all 25
requests, `placement_history`:

- has exactly 10 entries,
- matches the independently-computed ground truth (top 10 by
  `assigned_at desc`) entry-by-entry (`status`, `assigned_at` pairs),
- is strictly ordered most-recent-first,
- and its first entry is always the student's `ACTIVE` assignment.

**PASSED**, both before and after the fix (the "before" version was
already correct — this was a data-volume problem, not a correctness bug).
The existing Group 1 correctness suite for this endpoint
(`test_requests_performance.py::StudentRequestNPlus1CorrectnessTests`,
including the 14-assignment-history test and the `approve()`
stale-prefetch-cache test) was re-run against the fixed code and still
passes unchanged (see §6).

## 5. Was the Current Implementation Acceptable?

**No — fixed.** At this stress scale the 10x overfetch is clearly a real,
unbounded-growth data-volume cost (not a query-count/N+1 problem, which
remained flat throughout). Given the measured evidence, this was judged
"clearly problematic" per the verification criteria, so the smallest safe
DB-level fix was implemented rather than left as a documented risk.

## 6. Changes Made

**`backend/api/views.py`:**

1. New import: `from django.db.models.expressions import RawSQL`.
2. New module-level helper `_top10_bed_assignment_history_qs()` (placed
   just above `StudentRequestViewSet`): returns a `BedAssignment` queryset
   bounded to each student's 10 most-recent rows via a small
   `ROW_NUMBER() OVER (PARTITION BY student_id ORDER BY assigned_at DESC,
   id DESC)` windowed subquery, referenced through
   `pk__in=RawSQL(sql, ())`. A raw-SQL subquery was necessary because
   Django's ORM explicitly disallows filtering on `Window()` annotations
   directly ("Window is disallowed in the filter clause") — this is the
   standard, minimal way to express a bounded "top N per group" query
   through the ORM. `id DESC` is an explicit tiebreak for determinism (the
   original code had no tiebreak at all under `.order_by('-assigned_at')[:10]`,
   so this is a small correctness improvement, not a behavior change, for
   the realistic case where `assigned_at` values are effectively unique
   per row).
3. `StudentRequestViewSet.get_queryset()`'s `Prefetch(..., to_attr='prefetched_placement_history_all')`
   now uses `queryset=_top10_bed_assignment_history_qs()` instead of an
   unbounded `.select_related(...).order_by('-assigned_at')`. Django's
   `Prefetch` mechanism appends its own `student_id__in=[...]` filter
   (restricted to whichever students are on the current page) on top of
   this, so the query stays a single flat statement per page, now bounded
   to at most 10 rows per relevant student.

**`backend/api/serializers.py`:**

- `StudentRequestSerializer.get_placement_history()`: comment updated to
  describe the new DB-level bound; the Python `prefetched[:10]` slice is
  **unchanged** and kept in place — it is now a harmless defensive no-op
  (the query already returns ≤10 rows) and still exactly matches the
  fallback path's own `.order_by('-assigned_at')[:10]` for cases where the
  object wasn't built through `get_queryset()`. No serializer logic was
  changed.

No other files were touched. `StudentRequestViewSet.approve()`'s existing
cache-invalidation logic (`delattr` on `prefetched_placement_history_all`
after a mutation) is untouched and still applies — it invalidates whichever
cache is present, regardless of how that cache's queryset is bounded.

## 7. Tests Run and Results

| Suite | Result |
|---|---|
| `api.performance_tests.test_placement_history_verification` (new, this follow-up) | **2/2 passed** |
| `api.performance_tests.test_requests_performance` (existing Group 1 suite) | **6/6 passed** |
| `api.performance_tests.test_transfers_performance` (existing Group 1 suite, untouched code but re-run for safety) | **2/2 passed** |
| `api.tests_requests` (business-logic/permission tests for Requests) | **11/11 passed** |
| `api.tests_transfer_regions` (region-scoping/approval tests) | **19/19 passed** |
| **Combined total** | **40/40 passed** |
| `python manage.py check` | Clean — "System check identified no issues (0 silenced)" |

The critical `approve()` staleness test
(`test_approve_response_reflects_new_assignment_not_stale_prefetch`) was
re-verified passing against the new bounded queryset — a mid-request
mutation still correctly invalidates the prefetch cache and the response
reflects the fresh assignment, not a stale snapshot.

A broader regression sweep across the full `api.performance_tests` package
(Buildings/Apartments/Rooms/Beds, Analysis, Home Dashboard, Student Detail,
Reports, Transfers, Requests, plus the two new placement-history
verification tests) was additionally run to confirm this change did not
affect any other endpoint:

```
Ran 50 tests in 230.804s
OK
```

**50/50 passed.** No regressions anywhere in the codebase this or prior
Group 1 work touched.

## 8. Scope Boundaries

- The allocation algorithm and `AllocationRun` were not read for
  correctness purposes, not touched, and not evaluated.
- No frontend code, deployment configuration, or unrelated backend code was
  changed.
- This is a **local, disposable-test-database-only** verification. Real
  Postgres query-planner behavior for the `RawSQL` windowed subquery at
  production data volumes (years of `BedAssignment` history across the
  full student population) has **not** been measured against the real
  Azure database and should be confirmed there before being treated as
  fully validated in production, consistent with the Group 1 report's
  standing distinction between LOCAL BACKEND FIXES COMPLETE and
  REAL-ENVIRONMENT VALIDATION STILL REQUIRED.
