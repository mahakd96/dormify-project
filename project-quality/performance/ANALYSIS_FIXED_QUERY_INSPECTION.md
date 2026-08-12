# Analysis API — Fixed-Query Inspection (Post-N+1-Fix)

Prepared for external AI review. **INSPECTION + MEASUREMENT ONLY — no
production code was changed in this phase.** Follow-up to
`ANALYSIS_BASELINE_SUMMARY.md` (Phase 1: confirmed the per-building N+1)
and `ANALYSIS_OPTIMIZATION_SUMMARY.md` (Phase 2: fixed it). This phase
answers: *now that query count is flat at 31, what are those 31 queries,
and is there anything else worth optimizing?*

## 1. Current state (recap, unchanged by this phase)

`GET /api/analysis/` query count, confirmed flat with building count:

| N (buildings) | Total SQL queries |
|---:|---:|
| 1  | 31 |
| 5  | 31 |
| 25 | 31 |

`total_queries = 31` regardless of `N` (buildings) or `S` (student
volume, confirmed separately in Phase 1). This phase does not
re-measure that — it decomposes the fixed **31**.

## 2. Method

- New, **temporary** diagnostic test (`_tmp_inspect_analysis_queries.py`,
  written to `backend/api/performance_tests/`, run once via
  `ENV_FILE=.env.test python manage.py test`, then **deleted** —
  not a tracked deliverable of this phase, per its "inspection only"
  scope) built a representative fixture: 5 buildings (same per-building
  shape as the earlier baselines), one region, one `central_admin` user,
  **plus** one `Transfer` (+ `MovementRequest`), one pending
  `StudentRequest`, one `AllocationRun`, and one `ImportBatch` +
  `RegionInbox` — so every conditional branch and every optional
  response field in `analysis_data()` fires at least once, not just the
  branches the flat-31 baseline fixture happened to exercise.
- Wrapped one `GET /api/analysis/?region=<id>` call in
  `CaptureQueriesContext` and dumped the **full, unmasked SQL text** (not
  shape-masked) plus the DB driver's reported per-query execution time
  for every captured query, to a scratch file.
- Cross-referenced every captured query, in order, against the exact
  current source of `analysis_data()` (`backend/api/views.py:6356-6820`)
  and `_annotate_analysis_building_occupancy`
  (`backend/api/views.py:6280-6353`) line by line, plus the two
  serializers involved (`RegionSerializer`, `AllocationRunSerializer`,
  `ImportBatchSerializer` — `backend/api/serializers.py`).
- No production code was modified to do this — the diagnostic script
  only reads/queries; the temporary file was deleted after use, leaving
  no residue beyond this document.

### An honest surprise: 32 queries were captured, not 31

The richer fixture (with a real `ImportBatch` present) captured **32**
queries, not 31. This is fully explained, not a mystery or a
regression:

**`ImportBatchSerializer.get_region_breakdown`**
(`backend/api/serializers.py:1510-1519`) is a `SerializerMethodField`
that runs `obj.region_inboxes.select_related('region').all()` —
**one query, only when `latest_batch` is not `None`**. The Phase 1/2
baseline fixture never created an `ImportBatch`, so `latest_batch` was
always `None` and `ImportBatchSerializer(latest_batch).data if
latest_batch else None` (`views.py:6819`) short-circuited to `None`
without ever instantiating the serializer — so that query never fired
in the "flat 31" measurement. In a real region that has ever received an
import batch, `GET /api/analysis/` will issue **32** queries, not 31.

This is **not a bug** — `get_region_breakdown` is a single, already
`select_related`-optimized query (not a per-row N+1: `obj` is one
`ImportBatch`, and the query fetches all of its `region_inboxes` rows in
one round trip) — but it means **"31" is the floor for a scope with no
import history, not a hard constant.** Noted as a documentation
correction for future baselines, not something requiring code changes.

## 3. Full breakdown of the (flat) 31 queries

| # | Source (function/line) | What it computes | Response field(s) | Region/role-dependent? |
|---:|---|---|---|---|
| 1 | `_resolve_region()`, `views.py:234-253`, called from `views.py:6370` | Resolves the `?region=` param to a `Region` row | Gates all region-scoped filtering below | Only runs for central admin **with** a `region`/`region_id`/`region_name` param; skipped entirely for a region-less admin request or for non-admins (who use `user.region` directly, no query) |
| 2 | `views.py:6442` `students_qs.count()` | `summary.total_students` | `summary.total_students` | Filtered by region if set |
| 3 | `views.py:6446` `assignments_qs...distinct().count()` | Distinct assigned-student count | `summary.assigned_students` | Yes |
| 4 | `views.py:6451` `assignments_qs.values_list('student_id', flat=True)` | Raw assignment→student id list, used only to build a Python `set` for O(1) lookups later | (feeds `students_by_region_demand` classification, no direct field) | Yes |
| 5 | `views.py:6463` `allocatable_students_qs.filter(is_priority=True).count()` | Priority-student count (allocation-population-scoped) | `summary.priority_students` | Yes |
| 6 | `views.py:6465` `sum(rooms_qs.values_list('capacity', flat=True))` | Total room capacity (fetches every room's capacity value, sums in Python) | `summary.total_capacity`/`total_beds` | Yes |
| 7 | `views.py:6466` `assignments_qs...distinct().count()` (on `bed_id`) | Distinct assigned-bed count | `summary.assigned_beds`/`occupied_beds` | Yes |
| 8 | `views.py:6473` `buildings_qs.count()` | Active building count in scope | `summary.active_buildings` | Yes |
| 9 | `views.py:6474` `Building.objects.count()` | **Unconditionally computed, then immediately discarded/overwritten if `region` is set** | Only actually used when `region is None` | No — always runs regardless of region |
| 10 | `views.py:6475` `Building.objects.filter(is_active=False).count()` | **Same as #9 — unconditionally computed, discarded if `region` is set** | Only actually used when `region is None` | No — always runs regardless of region |
| 11 | `views.py:6478-6480` (region branch) `Building.objects.filter(dorm_type__region=region).count()` | Re-computes `all_buildings_count`, this time correctly region-scoped | `summary.total_buildings` | Only runs when `region` is set |
| 12 | `views.py:6482-6485` (region branch) `Building.objects.filter(dorm_type__region=region, is_active=False).count()` | Re-computes `inactive_buildings_count`, region-scoped | `summary.inactive_buildings` | Only runs when `region` is set |
| 13 | `views.py:6486` `rooms_qs.count()` | Active room count in scope | `summary.total_rooms` | Yes |
| 14 | `views.py:6487` `transfers_qs.count()` | Total transfer count | `summary.total_transfers` | Yes |
| 15 | `views.py:6488` `transfers_qs.filter(status=PENDING).count()` | Pending transfer count | `summary.pending_transfers` | Yes |
| 16 | `views.py:6490` `runs_qs.select_related(...).order_by('-started_at').first()` | Most recent `AllocationRun` in scope | `latest_run` | Yes — **`AllocationRun` read, allocation-owned data; classified only, no recommendation made about it (see §6)** |
| 17 | `views.py:6502` `requests_qs.count()` | Pending `StudentRequest` count | `summary.pending_requests` | Yes |
| 18 | `views.py:6507-6512` `requests_qs.values('request_type').annotate(count=Count('id'))` | Pending requests grouped by type | `pending_requests_by_type` | Yes |
| 19 | `views.py:6514-6518` `allocatable_students_qs.filter(is_priority=True).exclude(id__in=assignments_qs.values('student_id')).count()` | Priority-and-unassigned count (one query — the `id__in=` subquery is compiled inline, not a second round trip) | `summary.priority_unassigned_students` | Yes |
| 20 | `views.py:6520-6526` `ImportBatch.objects.filter(...).select_related('uploaded_by').order_by('-created_at').first()` | Most recent import batch in scope (one query either branch — the region branch's `id__in=batch_ids` is also compiled as a single subquery, confirmed by SQL capture) | `latest_batch` (base fields) | Yes |
| 21 | `views.py:6532-6537` `students_qs.values('gender').annotate(count=Count('id'))` | Gender distribution | `students_by_gender` | Yes |
| 22 | `views.py:6539-6544` same, grouped by `requested_religion` | Religion distribution | `students_by_religion` | Yes |
| 23 | `views.py:6546-6551` same, grouped by `religious` | Religiosity distribution | `students_by_religious` | Yes |
| 24 | `views.py:6553-6558` same, grouped by `category` | Category distribution | `students_by_category` | Yes |
| 25 | `views.py:6560-6565` same, grouped by `housing_type` | Housing-type distribution | `students_by_housing` | Yes |
| 26 | `views.py:6578` `DormType.objects.select_related('region').all()` | All dorm types + region, for the text-based region-name fallback resolver | Feeds `students_by_region`/`unassigned_by_region` (no direct field) | No — global lookup table, same regardless of region filter |
| 27 | `views.py:6641-6644` `students_qs.select_related('accepted_dorm_type', 'accepted_dorm_type__region')`, iterated | Per-student region classification loop (already confirmed flat vs. student volume — **out of scope, not re-analyzed here**) | `students_by_region`, `unassigned_by_region` | Yes |
| 28 | `views.py:6670` `Region.objects.all()` | All regions, for name→id mapping | Feeds `unassigned_by_region[].region_id` (no direct field) | No — global lookup table |
| 29 | `views.py:6700-6705` `transfers_qs.values('status').annotate(count=Count('id'))` | Transfers grouped by status | `transfers_by_status` | Yes |
| 30 | `views.py:6707-6712` `transfers_qs.values('movement_request__movement_type').annotate(count=Count('id'))` | Transfers grouped by movement type | `transfers_by_type` | Yes |
| 31 | `views.py:6728-6732` annotated `occupancy_buildings_qs`, iterated | Per-building capacity/assigned/room-count (the Phase 2 fix — already flat, 1 query total regardless of `N`) | `occupancy_data[]` | Yes |

(32nd, conditional, not part of the "always-31": `ImportBatchSerializer.get_region_breakdown`, fires only when `latest_batch is not None` — see §2.)

## 4. Classification

**A — Framework/parameter-resolution overhead (1 query):**
- #1 (`_resolve_region`). Conditional (central admin + region param only). Not Analysis-domain logic per se, but not framework/auth middleware either — it is the one query needed to turn a request parameter into the `Region` object every other query is scoped against. No optimization opportunity (a single `pk=` lookup is already minimal).
- **Note on true auth overhead:** every measurement in this entire investigation series (Buildings/Apartments/Rooms/Beds/Analysis) uses DRF's `force_authenticate()` in tests, which sets `request.user` directly and bypasses `SimpleJWT`'s real per-request `User.objects.get(...)` lookup. A production request authenticated via a real JWT header likely costs **one additional query** beyond every count in this document (and in every prior baseline) — this was never measured anywhere in this series and is flagged here as a general, cross-cutting limitation, not specific to Analysis.

**B — Required, independent Analysis queries (18 queries):**
#2, #5, #8, #11, #12, #16 (AllocationRun — see §6), #19, #20, #21, #22,
#23, #24, #25, #26, #27, #28, #30, #31.

Each computes a genuinely distinct value, from a genuinely distinct
grouping/filter, feeding a distinct response field. None overlaps another
query's *result*, even where they share a base queryset (e.g. #21-#25 all
start from `students_qs` but group by five different columns — a GROUP BY
can only produce one grouping per query, so five different breakdowns
need five different queries; see §5E for why merging these is not
recommended).

**C — Duplicate/redundant queries, safe to eliminate entirely (2 queries):**
- #9, #10 (`Building.objects.count()` / `Building.objects.filter(is_active=False).count()`, `views.py:6474-6475`). **These are computed unconditionally on every request, then immediately overwritten by #11/#12 whenever `region` is set** (`views.py:6477-6485`). When `region` is `None` (central-admin, no region filter — the only case where #9/#10's results are actually used), #11/#12 never run at all, so there's no double-count in that branch either way. **In every region-scoped request (any non-admin user, or an admin who picked a region — almost certainly the majority of real traffic), #9 and #10 are pure wasted round trips: their results are computed, then discarded without ever being read.** This is not a "maybe" — the current code unconditionally executes them and the `if region:` block unconditionally replaces both variables before anything reads them.

**D — Consolidation candidates (10 queries → could become 4; net savings 6):**

| Group | Queries | Current count | Shape difference | Possible reduced count | Why safe |
|---|---|---:|---|---:|---|
| **Assignments** | #3 (`assigned_students`, distinct student-id count), #4 (`assigned_student_ids`, raw student-id list), #7 (`assigned_beds`, distinct bed-id count) | 3 | Same `assignments_qs` base table/filter, three different `SELECT`/aggregation shapes over the same underlying rows | 1 | Fetch `assignments_qs.values('student_id', 'bed_id')` **once**; derive `assigned_students = len({r['student_id'] for r in rows})`, `assigned_student_ids = {r['student_id'] for r in rows}`, `assigned_beds = len({r['bed_id'] for r in rows})` in Python. Set-based dedup in Python is mathematically identical to `SELECT DISTINCT ... COUNT(*)` — same result, no join fan-out risk (see below). |
| **Rooms** | #6 (`total_capacity`, capacity values fetched + summed in Python), #13 (`total_rooms`, `.count()`) | 2 | Same `rooms_qs` base table/filter, evaluated twice (once via `values_list`, once via `.count()`) | 1 | The `values_list('capacity', flat=True)` fetch already used for #6 also gives `len(list)` for #13 — one fetch instead of two. |
| **Transfers** | #14 (`total_transfers`, `.count()`), #15 (`pending_transfers`, `.filter(status=PENDING).count()`), #29 (`transfers_by_status`, grouped by status) | 3 | Same `transfers_qs`, and #29's grouped result **already contains** everything #14/#15 need | 1 | `total_transfers = sum(g['count'] for g in transfers_by_status)`; `pending_transfers = next((g['count'] for g in transfers_by_status if g['status'] == PENDING), 0)`. `status` is a non-nullable `CharField` with a fixed choice set, so every row falls into exactly one group — the sum is exact. |
| **Requests** | #17 (`pending_requests`, `.count()`), #18 (`pending_requests_by_type`, grouped by `request_type`) | 2 | `requests_qs` is **already** filtered to `status=PENDING` before both #17 and #18 run — #18's grouped result already contains everything #17 needs | 1 | `pending_requests = sum(g['count'] for g in pending_requests_by_type)`. |

**Fan-out safety check (why the Transfers/Requests consolidations don't
risk silently-wrong counts):** inspected the actual joins Django generates
for `transfers_qs`'s and `requests_qs`'s region-scoping filters (captured
via raw SQL, §2) — every join involved (`from_room`/`to_room` →
`apartment` → `building` → `dorm_type` for Transfers; `requested_by`,
`student` → `accepted_dorm_type`, `target_room` → `apartment` →
`building` → `dorm_type` for Requests) is a **forward** foreign-key join
(many-to-one from the base row's perspective). A row on the "many" side
can never join to more than one row on each of these paths, so there is
no possible row-multiplication — a `COUNT`/`GROUP BY` over these joins
cannot overcount, with or without `.distinct()`. This is also why
`requests_qs`'s existing `.distinct()` (`views.py:6501`, added only in the
region-scoped branch) is very likely unnecessary defensive code in the
first place — captured SQL for #18 shows `SELECT DISTINCT ... GROUP BY
...`, which is a structurally redundant combination once GROUP BY already
collapses to one row per `request_type`.

**E — Would require behavior/design change, not recommended without
further measurement (5 queries, not counted as candidates):**
- #21-#25, the five `students_by_*` distributions. In principle these
  could be replaced by fetching every `Student` row **once** and computing
  all five breakdowns in Python (trading 5 small `GROUP BY` result sets —
  a handful of rows each — for 1 large raw fetch of every matching student
  row and every column). This is **not recommended**: for a region with
  many students, one `SELECT *`-shaped fetch of every student row is very
  likely **more** total bytes transferred and more Python-side work than
  five tiny aggregate queries, the opposite of the direction this whole
  investigation has been optimizing in. Flagged only as a documented idea
  requiring its own dedicated before/after measurement, not as something
  to implement.
- Postgres supports `GROUPING SETS`/`CUBE`/`ROLLUP` for genuinely merging
  multiple independent group-bys into one statement, but Django's ORM has
  no first-class support for this, would require raw SQL (losing
  ORM-level filter reuse and readability), and — same as above — is not
  justified without a dedicated measurement showing #21-#25 are actually
  expensive at production scale (they were not; see §5).

## 5. Timing — no individual query stood out

Every one of the 32 captured queries in the diagnostic run reported
**1-3 ms** of driver-side execution time (`CaptureQueriesContext`'s
per-query `time` field), with no outlier — including query #31 (the
Phase 2 fix's three-correlated-subquery `occupancy_data` query), which at
~2 ms was in the same range as every simple `.count()`. At this synthetic
scale (5 buildings, ~6 students, 1 transfer, 1 request), **the cost here
is structural (31-32 network round trips), not any single expensive
query** — consistent with the instruction to identify structural
inefficiency rather than manufacture a problem. This does not rule out a
single query becoming disproportionately expensive at real production
data volumes (large `api_student`/`api_bedassignment` tables without
supporting indexes, for instance) — that was not tested here and would
need its own measurement against realistic row counts, which this
synthetic, small fixture cannot speak to.

## 6. Allocation-owned data — classified only, no recommendation

Query #16 (`latest_run`) reads `AllocationRun`. Per the ownership
boundary for this investigation, it is classified here (group B,
required, one `select_related`-optimized `.first()` query, already
minimal) and **no change, correctness assessment, or optimization
recommendation is made about it or about `AllocationRun`/allocation
behavior in general.** It was not modified, and this document makes no
suggestion that it should be.

## 7. Estimated impact if all safe candidates were implemented (NOT done in this phase)

| Category | Current queries | Possible queries | Savings |
|---|---:|---:|---:|
| C — wasted (#9, #10) | 2 | 0 | 2 |
| D — Assignments group | 3 | 1 | 2 |
| D — Rooms group | 2 | 1 | 1 |
| D — Transfers group | 3 | 1 | 2 |
| D — Requests group | 2 | 1 | 1 |
| **Total** | **12** | **4** | **8** |

If every C and D candidate above were implemented (not done here): `31 →
23` queries, a **~25.8% reduction** of the current fixed base — still a
flat count independent of building/student count either way (this is a
fixed-cost reduction, not a scaling-shape change; there is no further
N+1 left to fix after the Phase 2 work).

## 8. Recommendation

- **C group (#9, #10 — the two unconditionally-wasted `Building` counts):
  OPTIMIZE NEXT.** This is not really an "optimization" in the tuning
  sense — it's dead-code elimination. The values are computed and then
  discarded before anything reads them, in the common (region-scoped)
  case. Zero behavior change is possible almost by construction (the
  `if region:` branch already fully overwrites both variables with the
  correct values; moving the two unconditional lines into an `else:`
  would be the entire change). Lowest risk, clearest win of anything
  found in this phase.
- **D group (assignments/rooms/transfers/requests consolidations):
  OPTIMIZE NEXT, as a secondary/batched follow-up**, each guarded by a
  correctness test proving the consolidated Python-derived value equals
  the original query's value (mirroring the `AnalysisOccupancyCorrectnessTests`
  pattern already established in Phase 2) before being considered
  complete. Confirmed safe by join-structure inspection (§4), but still
  warrants dedicated before/after regression tests per group, not a
  blanket single change.
- **B group (the 18 required/independent queries) and E group (the 5
  `students_by_*` distributions): NO MEANINGFUL ISSUE / NOT RECOMMENDED
  without further measurement.** These are either irreducible (each
  computes information nothing else in the request already has) or a
  theoretically-possible but likely-counterproductive redesign (E) that
  would need its own dedicated measurement before being considered at
  all.
- **`AllocationRun` (#16): out of scope by the explicit ownership
  boundary** — classified, not evaluated for change.
- **Overall structural finding: NO further N+1 exists.** All 31 (32 with
  a batch present) queries are O(1) per request regardless of building or
  student count — the remaining opportunity is a one-time ~26% reduction
  of a flat fixed cost, not a scaling problem. Given the small,
  uniformly-fast (1-3 ms) per-query timing observed, this is a legitimate
  but modest further cleanup, not a pressing performance emergency.

## Exact files created/changed in this phase

- `project-quality/performance/ANALYSIS_FIXED_QUERY_INSPECTION.md` — this
  file, new.
- A temporary diagnostic test file
  (`backend/api/performance_tests/_tmp_inspect_analysis_queries.py`) was
  created to capture raw, unmasked SQL for verification, run once, and
  **deleted** immediately after — it is not present in the tree and was
  never a deliverable.

**Not modified:** `backend/api/views.py`, `backend/api/serializers.py`,
any other production file, any frontend file, any model/migration,
`PERFORMANCE_OPTIMIZATION_RESULTS.md` (per instruction, left unchanged
this phase), any allocation-owned file, `.env`/`.env.test`, or Docker
configuration. Nothing was committed.

## Limitations

- Synthetic, small-scale fixture only (5 buildings, single-digit
  students/transfers/requests) — timing conclusions ("no query stood
  out") reflect this scale, not necessarily real production table sizes.
- The 32nd conditional query (`ImportBatchSerializer.get_region_breakdown`)
  means the true "fixed" cost is data-dependent (31 with no import
  history for the scope, 32 with any), not a hard constant — this
  refines, but does not contradict, the Phase 2 finding that query count
  is independent of *building* and *student* count.
- Real per-request JWT authentication overhead (bypassed by
  `force_authenticate` in every measurement in this series, not just this
  one) was not measured anywhere in this investigation and is a known gap
  applying equally to the Buildings/Apartments/Rooms/Beds baselines.
- No candidate in this document was implemented or correctness-tested
  beyond the join-structure/fan-out reasoning in §4 — per this phase's
  explicit inspection-only scope.
