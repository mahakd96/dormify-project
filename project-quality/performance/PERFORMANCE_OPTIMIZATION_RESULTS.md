# Performance Optimization Results

This file records baseline and (later) after-fix measurements only. It does
not contain analysis or recommendations — see
`PERFORMANCE_INSPECTION_SUMMARY.md` (code-level findings) and
`PERFORMANCE_OPTIMIZATION_PLAN.md` (approach) for those.

---

# P1 — Buildings API Baseline

## Date
2026-08-10

## Branch
`donia-performance-optimization`

## Commit / base state
`464c1c8` (`2026-08-10 14:51:45 +0300`) — "Build assisted allocation engine
and staff decision workflow". No application code was changed to produce
this baseline; the working tree at measurement time only added the
files listed in "Files created/changed" below.

## Environment

- **Database engine measured against:** PostgreSQL 16, running locally via
  `docker compose --profile local-db up -d test_db` (the `test_db` service
  already defined in this repo's `docker-compose.yml`) — a disposable
  container, isolated from the real database.
- **Real database (not touched):** the project's real `.env` points at a
  managed Postgres host (`DB_HOST` ends in `...re.com`) — consistent with
  Azure Database for PostgreSQL, not the "Neon" database named in
  `README.md`. That README line is stale; see "Documentation issue found"
  below. This baseline run never connected to that host at all — it used
  the local `test_db` container exclusively, via a separate `.env.test`
  (see "Files created/changed").
- **Django's own test database:** Django's test runner additionally
  created and destroyed its own disposable `test_dormify_test` database
  *inside* that local container for each run (standard `manage.py test`
  behavior) — not the `dormify_test` database itself, and never the real
  database.
- **Backend:** Django 4.2.9 / DRF 3.14.0, run directly with a local Python
  3.13 interpreter (not the Docker backend image) — all backend
  dependencies were already installed in the environment used.
- **Frontend / browser / network:** not involved in this measurement. This
  baseline measures the Django endpoint directly via DRF's `APIClient`
  (server-side, no HTTP/network/browser layer), so it isolates backend
  query/serialization cost from network, Azure, and React rendering time.
  That split is intentional — see "Interpretation" below.

## Measurement method

- New dedicated test module:
  `backend/api/performance_tests/test_buildings_performance.py`, in a new
  `api/performance_tests/` package reserved for performance/query-count
  regression tests (business-logic tests for buildings stay in
  `api/tests_inventory.py`, untouched).
- Uses `django.test.utils.CaptureQueriesContext` around a
  `rest_framework.test.APIClient` request — the exact approach already
  established in `api/tests_students_performance.py` for the earlier
  Students-page N+1 investigation.
- For each measured request: captures the full list of executed SQL
  statements, counts them, groups them by "shape" (SQL text with all
  numeric literals masked to `#`, so the same query issued for different
  building/apartment/room pks collapses into one shape) to surface
  repeated/duplicate query patterns, times the request with
  `time.perf_counter()`, and measures `len(response.content)` for payload
  size.
- Command used:
  ```
  cd backend
  ENV_FILE=.env.test python manage.py test api.performance_tests.test_buildings_performance -v 2
  ```
- Run twice in full to confirm reproducibility of the query-count numbers
  (timing naturally varies run to run; query counts did not).
- Cross-check: `ENV_FILE=.env.test python manage.py test api.tests_inventory`
  (the existing buildings/inventory business-logic suite) was also run
  against the same local database to confirm the new test package does not
  interfere with existing test discovery and that no behavior regressed —
  **41/41 tests passed.**

## Dataset description (synthetic, created and torn down by the test itself)

- **Region:** 1 synthetic region (`perf-region`).
- **Dorm type:** 1 synthetic dorm type under that region.
- **User:** 1 synthetic `central_admin` user (`force_authenticate`, no
  region restriction, matches the "sees full building list" case).
- **Per building:** 2 apartments → 2 rooms per apartment → 2 beds per
  room. The first bed of the first room of the first apartment in every
  building gets one `ACTIVE` `BedAssignment` (to a synthetic student), so
  `occupied_beds`/`free_beds` computation is genuinely exercised on every
  building, not just counted as zero.
- **Dataset sizes measured:** N = 1, N = 5, N = 25 buildings (each fully
  rebuilt between measurements via `_reset_inventory()` so every
  measurement is isolated and reproducible).
- **Why representative enough to expose N+1 scaling:** the code-level
  findings in `PERFORMANCE_INSPECTION_SUMMARY.md` (BLD-01) predict a fixed
  number of extra queries *per building row*, independent of how many
  apartments/rooms/beds exist underneath — so the apartment/room/bed
  counts per building only need to be non-trivial (not zero), while the
  *building count* is what needs to vary to expose linear scaling. Varying
  N from 1 → 5 → 25 while holding the per-building shape constant isolates
  exactly that variable.

## Endpoint

`GET /api/buildings/?region=perf-region&is_active=all` — the exact call
`dormInventoryAPI.getBuildings({region, is_active:'all'})` makes from
`BuildingsPage.js` on page load / region change / refresh.

## Results

| Buildings (N) | Total SQL queries | Queries / building | Server-side time (ms)* | Response size (bytes) |
|---:|---:|---:|---:|---:|
| 1  | 8   | 8.00 | ~14–15 | 294  |
| 5  | 32  | 6.40 | ~59–72 | 1,461 |
| 25 | 152 | 6.08 | ~240–270 | 7,338 |

\* Two full runs produced timing in the ranges shown; query counts and
payload sizes were **identical** across both runs (see
`evidence/BUILDINGS_BASELINE_QUERY_COUNTS.txt` and
`evidence/BUILDINGS_BASELINE_TEST_RUN_LOG_run1.txt`). Timing includes
Django request dispatch + ORM execution + DRF serialization, measured via
`APIClient` (no real HTTP/network layer), so it is a lower bound on
real-world latency, not an estimate of it.

**Marginal queries per additional building:** `(152 − 32) / (25 − 5) = 6.00` —
matches the code-inspection estimate in finding BLD-01
(`PERFORMANCE_INSPECTION_SUMMARY.md`) almost exactly. Fitting `total =
base + 6×N` against all three data points gives `base = 2` for every one
of N=1, N=5, N=25 (8 = 2+6·1, 32 = 2+6·5, 152 = 2+6·25) — a clean linear
fit with no residual, i.e. query count is fully explained by a constant
2-query per-request overhead plus exactly 6 queries per building row.

### Duplicate/repeated query patterns observed

For N=25, the 6 per-building queries break down into 4 *distinct* query
shapes, two of which each run **twice per building**:

- `SELECT COUNT(*) ... FROM api_bed JOIN api_room JOIN api_apartment WHERE apartment.building_id = # ...` — **×50** (2× per building × 25 buildings) — this is `BuildingSerializer.get_bed_count`, executed once directly and once again inside `get_free_beds` (`serializers.py:403` and the duplicate call at `serializers.py:412`).
- `SELECT COUNT(*) FROM (SELECT DISTINCT bedassignment.bed_id ...) ...` — **×50** (2× per building × 25 buildings) — this is `BuildingSerializer.get_occupied_beds`, executed once directly and once again inside `get_free_beds` (`serializers.py:406` and `serializers.py:412`).
- `SELECT COUNT(*) FROM api_apartment WHERE building_id = # AND is_active` — **×25** (1× per building) — `get_apartment_count` (`serializers.py:397`).
- `SELECT COUNT(*) FROM api_room JOIN api_apartment WHERE building_id = # AND ...` — **×25** (1× per building) — `get_room_count` (`serializers.py:400`).

This is an exact, empirical confirmation of the duplication described in
finding BLD-01: `get_free_beds` really does re-run the bed-count and
occupied-beds queries a second time for every building, on top of the
already-separate per-row `get_apartment_count`/`get_room_count` queries.

## PASS/FAIL

**Not applicable — this is a BASELINE measurement.** No optimization has
been implemented in this phase; nothing is being graded pass/fail here.

## Interpretation

- The N+1 pattern predicted from code inspection (BLD-01) is not just
  theoretically present — it is observed at exactly the predicted
  magnitude (6 queries/building) and scales perfectly linearly across a
  25× range of building counts (N=1 → N=25), with zero deviation from the
  `2 + 6N` fit.
- Because the multiplier is a flat 6 queries/building with no sign of
  tapering, this will keep scaling the same way at real production
  building counts — a region with e.g. 100 buildings would be predicted
  (extrapolating the same linear fit, not separately measured) to issue
  ~602 queries for one page load of `/api/buildings/`, purely from
  `BuildingSerializer`.
- Two of the four per-building query shapes are exact duplicates of the
  other two (same query re-run inside `get_free_beds`) — so roughly a
  third of the per-building query volume is strictly redundant
  (recomputing a number the serializer already computed one field earlier
  in the same request).
- Response payload size and query count both scale linearly with N in
  this synthetic dataset; this baseline does not measure real network/
  Azure latency, real production data volume, or frontend render time —
  those remain hypotheses per `PERFORMANCE_INSPECTION_SUMMARY.md` and are
  not addressed by this measurement.
- This baseline measured the Django layer only (`APIClient`, no real HTTP
  round trip). Real browser-observed latency for `/api/buildings/` will be
  this server-side cost plus network/Azure transport time, which was not
  measured here and should not be assumed equal to the numbers above.

## Confirmed bottleneck

`BuildingSerializer` (`backend/api/serializers.py:363-412`) — specifically
its five `SerializerMethodField`s (`get_apartment_count`, `get_room_count`,
`get_bed_count`, `get_occupied_beds`, `get_free_beds`) — is confirmed, by
direct measurement (not just code inspection), to add exactly 6 SQL
queries per building row to `GET /api/buildings/`, growing linearly and
unboundedly with the number of buildings returned, with roughly a third of
that volume being an exact duplicate of another query in the same request.
This matches finding BLD-01 in `PERFORMANCE_INSPECTION_SUMMARY.md` and is
now empirically confirmed rather than a hypothesis.

No other endpoint (Apartments, Rooms, Beds) was measured in this phase —
BLD-02/BLD-03/BLD-04 remain code-inspection findings only, not yet
baseline-measured, per the instruction to focus this phase on
`/api/buildings/` alone.

## Documentation issue found (recorded only, not fixed)

`README.md` states the main database is "Neon-hosted." The actual
`DB_HOST` configured in this repo's `.env` resolves to a managed Postgres
host consistent with Azure Database for PostgreSQL, not Neon. This is a
stale-documentation issue only — `README.md` was **not** modified in this
phase, per the phase's scope (only the two `project-quality/performance/`
files plus dedicated test/evidence files may be written). Flagging it here
so it can be corrected separately and explicitly.

## Files created/changed during measurement

- `backend/api/performance_tests/__init__.py` — new package for
  performance/query-efficiency regression tests.
- `backend/api/performance_tests/test_buildings_performance.py` — new
  measurement/regression test for `GET /api/buildings/` (query count,
  duplicate-pattern detection, timing, payload size). No production code
  touched.
- `.env.test` (repo root) — new, local-only, non-secret environment file
  pointing `manage.py test` at the local disposable `test_db` Docker
  service instead of the real `.env`. Contains only local Docker Compose
  credentials already visible in `docker-compose.yml` (not a real secret).
- `project-quality/performance/evidence/BUILDINGS_BASELINE_QUERY_COUNTS.txt`
  — raw per-run evidence, auto-generated by the test itself on every run.
- `project-quality/performance/evidence/BUILDINGS_BASELINE_TEST_RUN_LOG_run1.txt`
  — full captured `manage.py test` console output for one full run
  (reproducibility record).
- `project-quality/performance/PERFORMANCE_OPTIMIZATION_RESULTS.md` — this
  file.
- `project-quality/performance/BUILDINGS_BASELINE_SUMMARY.md` — upload-ready
  summary of this baseline for external AI review.

**Docker state change:** the local `test_db` container
(`dormify_test_db`) was started via `docker compose --profile local-db up
-d test_db` (explicit user approval obtained before this action) and was
left running after measurement, for reuse in later phases. It contains no
real data — a fresh Postgres 16 instance with only Django's disposable
test database created and destroyed inside it during test runs.

**No Django views, serializers, models, migrations, React code, settings,
Docker configuration, business rules, permissions, region-isolation logic,
or the allocation algorithm were modified in this phase.**

---

# P1 — Buildings API Optimization Result

## Date
2026-08-10

## Branch
`donia-performance-optimization`

## Scope
Only finding **BLD-01** (`BuildingSerializer` N+1 in the `GET
/api/buildings/` list endpoint). Apartments, Rooms, Beds, Analysis,
Students, Transfers, pagination, the frontend, Docker, migrations, and the
allocation algorithm were **not** touched — per the explicit scope of this
phase.

## Baseline (Phase 2, unchanged — see full detail above and in
`BUILDINGS_BASELINE_SUMMARY.md`)

| N (buildings) | SQL queries (before) |
|---:|---:|
| 1  | 8   |
| 5  | 32  |
| 25 | 152 |

Scaling: `total_queries = 2 + 6 × N` (marginal cost 6.00 queries/building).

## Root cause (recap)
`BuildingSerializer.get_apartment_count` / `get_room_count` /
`get_bed_count` / `get_occupied_beds` / `get_free_beds`
(`backend/api/serializers.py:397-412`, pre-fix) each ran their own query
per `Building` row, with `get_free_beds` re-running two of those queries a
second time.

## Implementation (production code changed)

1. **`backend/api/views.py`**
   - Import line: added `OuterRef, Subquery, IntegerField` to the existing
     `from django.db.models import Q, Count, Prefetch` import, and added
     `from django.db.models.functions import Coalesce`.
   - New module-level helper `_annotate_building_inventory_counts(queryset)`
     (placed just before `BuildingViewSet`): annotates
     `_apartment_count`, `_room_count`, `_bed_count`, `_occupied_beds` onto
     any `Building` queryset, each as an independent `Coalesce(Subquery(...),
     0)` correlated by `OuterRef('pk')` — a separate correlated subquery per
     count, not a joined `Count()` on the same queryset (which would risk
     JOIN-multiplication across the four different related paths). Each
     subquery reproduces the original filter exactly (see "Correctness
     Protection" below).
   - `BuildingViewSet.get_queryset()`: the base queryset
     (`Building.objects.select_related('dorm_type', 'dorm_type__region')`)
     is now wrapped in `_annotate_building_inventory_counts(...)` before the
     existing `is_active`/region-scoping filters are applied (those filters
     are unchanged, just now applied on top of the annotated queryset).
2. **`backend/api/serializers.py`** — `BuildingSerializer`
   - `get_apartment_count` / `get_room_count` / `get_bed_count` /
     `get_occupied_beds`: each now reads the corresponding
     `_apartment_count` / `_room_count` / `_bed_count` / `_occupied_beds`
     attribute via `getattr(obj, '_X', None)` first; if present (the normal
     case — the object came from `get_queryset()`), it's returned directly
     with **zero extra queries**. If absent (only happens for a freshly
     `POST`-created `Building`, whose response is serialized straight from
     `serializer.save()` rather than re-fetched via `get_queryset()`), each
     method falls back to running the **exact original per-object query**
     unchanged — so correctness for that one case is guaranteed by reusing
     the original code, not by new logic.
   - `get_free_beds`: unchanged (`max(self.get_bed_count(obj) -
     self.get_occupied_beds(obj), 0)`), but since `get_bed_count`/
     `get_occupied_beds` are now attribute reads in the common case, this no
     longer costs 2 extra queries — the duplication that made BLD-01 worse
     disappears as a side effect, without needing separate code for it.

## Why this fixes the N+1

The four counts are now computed **inside the single list/detail SQL
statement** DRF already issues for `Building.objects...` (as 4 additional
`SELECT ... FROM ... WHERE ... = building.id` scalar subquery expressions
in that one statement's `SELECT` clause), instead of as 4-6 separate
round-trip queries issued once per building row from Python. Query count
is therefore driven only by fixed per-request overhead (auth/permission
lookups + the one list query), not by `N`.

## Correctness Protection

- **apartment_count** — subquery is `Apartment.objects.filter(building=OuterRef('pk'),
  is_active=True)` grouped/counted per building — identical filter to the
  original `obj.apartments.filter(is_active=True).count()`.
- **room_count** — subquery is `Room.objects.filter(apartment__building=OuterRef('pk'),
  is_active=True, apartment__is_active=True)` — identical filter to the
  original `Room.objects.filter(apartment__building=obj, is_active=True,
  apartment__is_active=True).count()`.
- **bed_count** — subquery is `Bed.objects.filter(room__apartment__building=OuterRef('pk'),
  room__is_active=True, room__apartment__is_active=True)` — identical
  filter to the original `Bed.objects.filter(room__apartment__building=obj,
  room__is_active=True, room__apartment__is_active=True).count()`.
- **occupied_beds** — subquery is `BedAssignment.objects.filter(bed__room__apartment__building=OuterRef('pk'),
  status=ACTIVE)` counted with `Count('bed_id', distinct=True)` — identical
  filter and distinct-bed semantics to the original
  `.values('bed_id').distinct().count()`, and deliberately **not** filtered
  by room/apartment `is_active` — preserving the original asymmetry where
  an occupied bed in a since-deactivated room still counts as occupied
  (`free_beds` still clamps to 0 via the unchanged `max(...)`, exactly as
  before).
- **free_beds** — unchanged formula, `max(bed_count − occupied_beds, 0)`.
- Verified empirically, not just by inspection: new test
  `BuildingCountCorrectnessTests.test_building_counts_match_original_unannotated_queries`
  (`backend/api/performance_tests/test_buildings_performance.py`) builds a
  fixture with an active apartment/active room (one occupied bed, one bed
  whose assignment has since **ended**), an **inactive** room holding a bed
  with a still-**active** assignment (the asymmetry edge case), and a fully
  **inactive** second apartment — then re-runs the *original* unoptimized
  query logic directly against the DB and asserts the live endpoint's
  values are equal, field by field. A second test
  (`test_building_counts_match_expected_values`) asserts the same fixture
  against hand-computed expected numbers
  (`apartment_count=1, room_count=1, bed_count=2, occupied_beds=2,
  free_beds=0`). Both pass.
- **Freshly created building fallback** — `test_freshly_created_building_falls_back_correctly`
  asserts `POST /api/buildings/` still returns
  `apartment_count=room_count=bed_count=occupied_beds=free_beds=0` for a
  brand-new building (exercises the `getattr(...) is None` fallback path).
- **Permissions / region isolation / API contract** — none of
  `BuildingViewSet.get_queryset()`'s existing `is_active`/region/role
  filtering logic was changed (only wrapped with an additional
  `.annotate()` call before those filters run); `create()`/`update()` were
  not touched at all; `BuildingSerializer.Meta.fields` (field names/order)
  is unchanged; every field still returns the same Python type (`int`) as
  before. Confirmed by running the full pre-existing
  `backend/api/tests_inventory.py` suite (permissions, region scoping,
  availability workflow, occupancy-conflict checks, bulk creation) — **41/41
  passed, unchanged**, both before and after this change.

## Before vs After Measurements

| N (buildings) | SQL queries before | SQL queries after | Response time before (ms) | Response time after (ms) | Response size before (bytes) | Response size after (bytes) |
|---:|---:|---:|---:|---:|---:|---:|
| 1  | 8   | 2 | ~14–15  | ~7   | 294   | 294   |
| 5  | 32  | 2 | ~59–72  | ~8   | 1,461 | 1,461 |
| 25 | 152 | 2 | ~240–270 | ~12 | 7,338 | 7,342 |

(Response-time figures are server-side only, measured via DRF's
`APIClient` — see limitations in `BUILDINGS_BASELINE_SUMMARY.md`; they are
directional, not a promise of real-world latency. The 4-byte difference at
N=25 is expected noise from two independent test-database runs assigning
different auto-increment primary keys to the synthetic rows — not a value
change; the dedicated correctness tests confirm field values are identical
using the *same* database state.)

**Absolute query reduction:** 6 (N=1), 30 (N=5), 150 (N=25).
**Percentage query reduction:** 75.0% (N=1), 93.75% (N=5), **98.7% (N=25)**.

## Query Scaling — before vs after

- **Before:** `total_queries = 2 + 6 × N` — linear, unbounded growth with
  building count (marginal cost 6.00 queries/building, confirmed in Phase
  2).
- **After:** `total_queries = 2` at N=1, N=5, **and** N=25 — **flat,
  independent of N** (marginal cost 0.00 queries/building, measured
  directly). Query count for `GET /api/buildings/` is no longer coupled to
  the number of buildings returned.

## Tests Run

| Command | Result |
|---|---|
| `ENV_FILE=.env.test python manage.py check` | No issues (0 silenced) |
| `ENV_FILE=.env.test python manage.py test api.performance_tests.test_buildings_performance -v 2` | **5/5 passed** (2 correctness-value tests, 1 cross-check-vs-original-query test, 1 create-fallback test, 1 flat-scaling regression test, 1 N=1 overhead test) |
| `ENV_FILE=.env.test python manage.py test api.tests_inventory -v 1` | **41/41 passed**, unchanged (permissions, region scoping, availability workflow, occupancy-conflict checks, bulk creation) |

All runs against the same local disposable `test_db` Docker container used
for the Phase 2 baseline — the real Azure database was never touched.

## Files Changed

**Production application files:**
- `backend/api/views.py` — added imports (`OuterRef`, `Subquery`,
  `IntegerField`, `Coalesce`); added
  `_annotate_building_inventory_counts()` helper; changed
  `BuildingViewSet.get_queryset()`'s first line to wrap the base queryset
  in that helper. No other function in this file was touched.
- `backend/api/serializers.py` — `BuildingSerializer.get_apartment_count`
  / `get_room_count` / `get_bed_count` / `get_occupied_beds` changed to
  read-annotation-first-with-fallback. `get_free_beds` and every other
  serializer in the file are unchanged.

**Performance tests:**
- `backend/api/performance_tests/test_buildings_performance.py` — updated:
  scaling test now asserts flat (not linear) query count and writes to a
  new evidence file (`BUILDINGS_AFTER_QUERY_COUNTS.txt`, not the frozen
  baseline file); added `BuildingCountCorrectnessTests` (3 new tests).

**Documentation / evidence:**
- `project-quality/performance/evidence/BUILDINGS_AFTER_QUERY_COUNTS.txt` — new.
- `project-quality/performance/evidence/BUILDINGS_AFTER_TEST_RUN_LOG.txt` — new.
- `project-quality/performance/PERFORMANCE_OPTIMIZATION_RESULTS.md` — this section added; Phase 2 baseline section above left unchanged.
- `project-quality/performance/BUILDINGS_OPTIMIZATION_SUMMARY.md` — new, upload-ready summary.
- Baseline evidence files (`BUILDINGS_BASELINE_QUERY_COUNTS.txt`,
  `BUILDINGS_BASELINE_TEST_RUN_LOG_run1.txt`) — **not modified**, confirmed
  byte-identical to Phase 2.

## Whether permissions/business/API behavior changed

**No.** Permissions, role behavior, region isolation, `is_active`
query-param semantics, ordering, response field names/types, business
rules (availability workflow, occupancy-conflict checks), create/update
behavior, and the allocation algorithm are all unchanged — verified by the
unmodified `tests_inventory.py` suite passing 41/41, and by the new
correctness tests proving field values are identical to the pre-fix
computation.

## Remaining Limitations

- Only `GET /api/buildings/` (list/retrieve via `BuildingViewSet`) was
  optimized. `ApartmentSerializer` (BLD-02), `RoomSerializer`/`Room` model
  properties (BLD-03), and `BedSerializer.is_occupied` (BLD-04) still have
  their original per-row query patterns — out of scope for this phase.
- No pagination was added to `BuildingViewSet` (BLD-05) — still out of
  scope; response size will still grow with total building count in a
  region, just without the query-count multiplier.
- Timing measurements remain server-side-only (DRF `APIClient`, no real
  HTTP/network/Azure layer) — real-world latency improvement was not
  separately measured.
- Real production data volume/shape was not used — synthetic data only,
  per this phase's method (consistent with Phase 2).

## Interpretation

BLD-01 is resolved for `GET /api/buildings/`: query count dropped from
`2 + 6N` to a flat `2`, a 98.7% reduction at N=25, with zero observed
change in returned values, permissions, or any other endpoint behavior.

---

# BLD-02 — Apartments API Baseline

## Date
2026-08-10

## Branch
`donia-performance-optimization`

## Commit / base state
`464c1c8` — same commit as the BLD-01 baseline/optimization above.
`ApartmentViewSet`/`ApartmentSerializer` are **unmodified** — this is a
measurement-only phase, mirroring how BLD-01's Phase 2 baseline was
produced before any Buildings code changed.

## Environment

Identical setup to the BLD-01 baseline: local, disposable PostgreSQL 16
via `docker compose --profile local-db up -d test_db` (already running
from the BLD-01 work, not restarted), with Django's own further-disposable
`test_dormify_test` database created/destroyed inside it per test run, via
`.env.test`. The real Azure database was never connected to. Backend run
directly with the local Python 3.13 interpreter (not the Docker backend
image), same as BLD-01.

## Measurement method

- New dedicated test module:
  `backend/api/performance_tests/test_apartments_performance.py`, in the
  same `api/performance_tests/` package used for BLD-01 (self-contained -
  does not import from `test_buildings_performance.py`, per that
  package's one-module-per-endpoint convention).
- Same technique as BLD-01: `django.test.utils.CaptureQueriesContext`
  around a `rest_framework.test.APIClient` request, SQL "shape" grouping
  (numeric literals masked) to surface repeated/duplicate query patterns,
  `time.perf_counter()` timing, `len(response.content)` payload size.
- Command used:
  ```
  cd backend
  ENV_FILE=.env.test python manage.py test api.performance_tests.test_apartments_performance -v 2
  ```
- Run twice in full to confirm reproducibility of the query-count numbers
  (identical both times: 6 / 26 / 126 for N=1/5/25; only timing varied).

## Dataset description (synthetic, created and torn down by the test itself)

- 1 region, 1 dorm type, 1 `central_admin` user, 1 `Building` per
  measurement (fresh building each call, so `Apartment.number` -
  `unique_together` with `building` - never collides across
  measurements).
- **Per apartment:** 3 rooms → 2 beds per room (6 beds/apartment), so
  `actual_room_count`, `bed_count`, `occupied_beds`, and `free_beds` are
  all genuinely non-trivial and non-zero. The first bed of the first room
  of every apartment gets one `ACTIVE` `BedAssignment`, giving a uniform,
  easy-to-verify `occupied_beds=1`, `free_beds=5` per apartment.
- **Dataset sizes measured:** N = 1, 5, 25 apartments (all under one
  building per measurement), matching the same N values used for the
  BLD-01 baseline for direct comparability.
- **Why representative enough to expose N+1 scaling:** the code-inspection
  finding (BLD-02) predicts a fixed number of extra queries **per
  apartment row**, independent of how many rooms/beds exist underneath -
  so apartment count (N) is the variable that needs to vary to expose
  linear scaling, while per-apartment shape only needs to be non-trivial.

## Endpoint

`GET /api/apartments/?building=<id>&is_active=all` — the exact call
`dormInventoryAPI.getApartments({building, is_active:'all'})` makes from
`BuildingsPage.js`'s `selectBuilding()` (and `refreshCurrentScope()`) when
a building is selected/refreshed on the Buildings page.

## Results

| Apartments (N) | Total SQL queries | Queries / apartment | Server-side time (ms, both runs) | Response size (bytes) |
|---:|---:|---:|---:|---:|
| 1  | 6   | 6.00 | 11–21   | 470    |
| 5  | 26  | 5.20 | 53–79   | 2,341  |
| 25 | 126 | 5.04 | 235–339 | 11,738 |

**Marginal queries per additional apartment:** `(126 − 26) / (25 − 5) = 5.00` —
matches the code-inspection estimate in finding BLD-02
(`PERFORMANCE_INSPECTION_SUMMARY.md`) exactly. Fitting `total = base +
5×N` against all three points gives `base = 1` for every one of N=1, N=5,
N=25 (6 = 1+5·1, 26 = 1+5·5, 126 = 1+5·25) — a clean linear fit with no
residual, same shape as the BLD-01 fit (`base` differs — 1 here vs 2 for
Buildings — because this measurement passes a `building` filter param
rather than a `region` param, so `ApartmentViewSet.get_queryset()` never
calls `_resolve_region()`'s extra lookup query; this is expected and does
not affect the per-row multiplier being measured).

### Duplicate/repeated query patterns observed

For N=25, the 5 per-apartment queries break down into 3 distinct query
shapes, two of which each run **twice per apartment**:

- `SELECT COUNT(*) ... FROM api_bed JOIN api_room WHERE apartment_id = # AND room.is_active` — **×50** (2× per apartment × 25 apartments) — this is `ApartmentSerializer.get_bed_count`, executed once directly and once again inside `get_free_beds` (`serializers.py:483` and the duplicate call at `serializers.py:492`).
- `SELECT COUNT(*) FROM (SELECT DISTINCT bedassignment.bed_id ...) ...` — **×50** (2× per apartment × 25 apartments) — this is `ApartmentSerializer.get_occupied_beds`, executed once directly and once again inside `get_free_beds` (`serializers.py:486` and `serializers.py:492`).
- `SELECT COUNT(*) FROM api_room WHERE apartment_id = # AND is_active` — **×25** (1× per apartment) — `get_actual_room_count` (`serializers.py:480`).

This is the same shape of duplication observed and fixed for BLD-01: two
of the three distinct query shapes are each an exact in-request duplicate
(`get_free_beds` re-running `bed_count`/`occupied_beds`), so roughly 40%
of the per-apartment query volume (2 of 5 queries) is strictly redundant.

## PASS/FAIL

**Not applicable — this is a BASELINE measurement.** No optimization has
been implemented for Apartments in this phase.

## Interpretation

- The N+1 pattern predicted from code inspection (BLD-02) is confirmed at
  essentially the exact predicted magnitude (5.00 queries/apartment,
  vs. the ~5 estimate) and scales perfectly linearly across a 25× range of
  apartment counts, mirroring the BLD-01 result almost exactly in shape
  (`base + k×N`, clean linear fit, ~40% of per-row query volume being
  in-request duplicates from `get_free_beds`).
- Extrapolating the same fit (not separately measured): a building with 50
  apartments would be predicted to issue ~251 queries for one
  `GET /api/apartments/?building=X` call, from `ApartmentSerializer`
  alone.
- This confirms BLD-02 is a real, measured bottleneck with the same root
  cause pattern as BLD-01, not merely a hypothesis.

## Confirmed bottleneck

`ApartmentSerializer` (`backend/api/serializers.py:480-492`) —
specifically its four `SerializerMethodField`s (`get_actual_room_count`,
`get_bed_count`, `get_occupied_beds`, `get_free_beds`) — is confirmed, by
direct measurement, to add exactly 5 SQL queries per apartment row to
`GET /api/apartments/`, growing linearly and unboundedly with the number
of apartments returned, with 2 of those 5 being an exact duplicate of
another query in the same request (`get_free_beds` re-running
`get_bed_count`/`get_occupied_beds`). This matches finding BLD-02 in
`PERFORMANCE_INSPECTION_SUMMARY.md` and is now empirically confirmed
rather than a hypothesis. **Not optimized in this phase** — production
code (`ApartmentViewSet`, `ApartmentSerializer`) is unchanged.

## Files created/changed during measurement

- `backend/api/performance_tests/test_apartments_performance.py` — new
  measurement/regression test for `GET /api/apartments/` (query count,
  duplicate-pattern detection, timing, payload size). No production code
  touched.
- `project-quality/performance/evidence/APARTMENTS_BASELINE_QUERY_COUNTS.txt`
  — raw per-run evidence, auto-generated by the test itself on every run.
- `project-quality/performance/evidence/APARTMENTS_BASELINE_TEST_RUN_LOG.txt`
  — full captured `manage.py test` console output for one full run.
- `project-quality/performance/PERFORMANCE_OPTIMIZATION_RESULTS.md` — this
  section.
- `project-quality/performance/APARTMENTS_BASELINE_SUMMARY.md` —
  upload-ready summary of this baseline for external AI review.

All BLD-01 (Buildings) evidence files
(`BUILDINGS_BASELINE_QUERY_COUNTS.txt`,
`BUILDINGS_BASELINE_TEST_RUN_LOG_run1.txt`, `BUILDINGS_AFTER_QUERY_COUNTS.txt`,
`BUILDINGS_AFTER_TEST_RUN_LOG.txt`) and the BLD-01 sections above are
**unmodified**.

**No Django views, serializers, models, migrations, React code, settings,
Docker configuration, business rules, permissions, region-isolation logic,
pagination, or the allocation algorithm were modified in this phase.
`ApartmentViewSet` and `ApartmentSerializer` are byte-for-byte unchanged
from before this phase.**

---

# BLD-02 — Apartments API Optimization Result

## Date
2026-08-10

## Branch
`donia-performance-optimization`

## Scope
Only finding **BLD-02** (`ApartmentSerializer` N+1 in the `GET
/api/apartments/` list endpoint). Buildings/BLD-01 (already closed),
Rooms, Beds, Analysis, Students, Transfers, pagination, the frontend,
Docker, migrations, and the allocation algorithm were **not** touched —
per the explicit scope of this phase.

## Baseline (unchanged — see full detail above and in
`APARTMENTS_BASELINE_SUMMARY.md`)

| N (apartments) | SQL queries (before) |
|---:|---:|
| 1  | 6   |
| 5  | 26  |
| 25 | 126 |

Scaling: `total_queries = 1 + 5 × N` (marginal cost 5.00 queries/apartment).

## Root cause (recap)
`ApartmentSerializer.get_actual_room_count` / `get_bed_count` /
`get_occupied_beds` / `get_free_beds` (`backend/api/serializers.py:480-492`,
pre-fix) each ran their own query per `Apartment` row, with
`get_free_beds` re-running two of those queries a second time — the same
shape of N+1 already fixed for BLD-01.

## Implementation (production code changed)

1. **`backend/api/views.py`**
   - New module-level helper `_annotate_apartment_inventory_counts(queryset)`
     (placed just before `ApartmentViewSet`): annotates `_actual_room_count`,
     `_bed_count`, `_occupied_beds` onto any `Apartment` queryset, each as
     an independent `Coalesce(Subquery(...), 0)` correlated by
     `OuterRef('pk')` — one correlated subquery per count, not combined
     `Count()` annotations (same JOIN-multiplication-avoidance pattern as
     `_annotate_building_inventory_counts`, BLD-01). No new imports were
     needed — `OuterRef`, `Subquery`, `IntegerField`, `Coalesce`, `Count`,
     `Room`, `Bed`, `BedAssignment` were already imported in this file for
     the BLD-01 fix.
   - `ApartmentViewSet.get_queryset()`: the base queryset
     (`Apartment.objects.select_related('building', 'building__dorm_type',
     'building__dorm_type__region')`) is now wrapped in
     `_annotate_apartment_inventory_counts(...)` before the existing
     `is_active`/`building`/region-scoping filters are applied (those
     filters are unchanged, just now applied on top of the annotated
     queryset). No other function in this file was touched.
2. **`backend/api/serializers.py`** — `ApartmentSerializer`
   - `get_actual_room_count` / `get_bed_count` / `get_occupied_beds`: each
     now reads the corresponding `_actual_room_count` / `_bed_count` /
     `_occupied_beds` attribute via `getattr(obj, '_X', None)` first; if
     present (the normal case — the object came from `get_queryset()`), it's
     returned directly with **zero extra queries**. If absent (only happens
     for a freshly `POST`-created `Apartment`), each method falls back to
     running the **exact original per-object query** unchanged.
   - `get_free_beds`: unchanged formula
     (`max(self.get_bed_count(obj) - self.get_occupied_beds(obj), 0)`); the
     duplicated-query cost inside it disappears as a side effect since its
     two calls are now attribute reads in the common case.

## Why this fixes the N+1

The three counts are now computed **inside the single list/detail SQL
statement** already issued for `Apartment.objects...`, as scalar subquery
expressions, instead of as separate round-trip queries issued once per
apartment row from Python. Query count is therefore driven only by fixed
per-request overhead, not by `N`.

## Correctness Protection

- **actual_room_count** — subquery is `Room.objects.filter(apartment=OuterRef('pk'),
  is_active=True)` grouped/counted per apartment — identical filter to the
  original `obj.rooms.filter(is_active=True).count()`.
- **bed_count** — subquery is `Bed.objects.filter(room__apartment=OuterRef('pk'),
  room__is_active=True)` — identical filter to the original
  `Bed.objects.filter(room__apartment=obj, room__is_active=True).count()`.
- **occupied_beds** — subquery is `BedAssignment.objects.filter(bed__room__apartment=OuterRef('pk'),
  status=ACTIVE)` counted with `Count('bed_id', distinct=True)` — identical
  filter and distinct-bed semantics to the original
  `.values('bed_id').distinct().count()`, and deliberately **not** filtered
  by room `is_active` — preserving the original asymmetry where an
  occupied bed in a since-deactivated room still counts as occupied
  (`free_beds` still clamps to 0 via the unchanged `max(...)`).
- **free_beds** — unchanged formula, `max(bed_count − occupied_beds, 0)`.
- Verified empirically, not just by inspection: new test
  `ApartmentCountCorrectnessTests.test_apartment_counts_match_original_unannotated_queries`
  (`backend/api/performance_tests/test_apartments_performance.py`) builds a
  fixture with an active room (one occupied bed, one bed whose assignment
  has since **ended**) and an **inactive** room holding a bed with a
  still-**active** assignment (the asymmetry edge case) — then re-runs the
  *original* unoptimized query logic directly against the DB and asserts
  the live endpoint's values are equal, field by field. A second test
  (`test_apartment_counts_match_expected_values`) asserts the same fixture
  against hand-computed expected numbers (`actual_room_count=1,
  bed_count=2, occupied_beds=2, free_beds=0`). A third test,
  `test_freshly_created_apartment_falls_back_correctly`, confirms
  `POST /api/apartments/` still returns all-zero counts for a brand-new
  apartment (exercises the `getattr(...) is None` fallback path). All
  three pass. In addition, `ApartmentsListPerformanceTests._measure` now
  asserts every returned apartment's four count fields exactly match the
  known fixture values (`actual_room_count=3, bed_count=6,
  occupied_beds=1, free_beds=5`) at every measured N.
- **Permissions / region isolation / API contract** — none of
  `ApartmentViewSet.get_queryset()`'s existing `is_active`/`building`/
  region/role filtering logic was changed (only wrapped with an additional
  `.annotate()` call before those filters run); `create()`/`update()` were
  not touched at all; `ApartmentSerializer.Meta.fields` (field names/order)
  is unchanged; every field still returns the same Python `int` type as
  before. Confirmed by running the full pre-existing
  `backend/api/tests_inventory.py` suite (permissions, region scoping,
  availability workflow, occupancy-conflict checks, bulk creation) — **41/41
  passed, unchanged**, both before and after this change. The
  already-closed BLD-01 (Buildings) optimization was also re-run
  (`test_buildings_performance`) and confirmed still flat at 2
  queries/request, unaffected by this change (both live in
  `backend/api/views.py`).

## Before vs After Measurements

| N (apartments) | SQL queries before | SQL queries after | Response time before (ms) | Response time after (ms) | Response size before (bytes) | Response size after (bytes) |
|---:|---:|---:|---:|---:|---:|---:|
| 1  | 6   | 1 | ~11–21  | ~20  | 470    | 470    |
| 5  | 26  | 1 | ~53–79  | ~8   | 2,341  | 2,341  |
| 25 | 126 | 1 | ~235–339 | ~14 | 11,738 | 11,742 |

(Response-time figures are server-side only, measured via DRF's
`APIClient` — directional, not a promise of real-world latency. The 4-byte
difference at N=25 is expected noise from two independent test-database
runs assigning different auto-increment primary keys to the synthetic
rows — not a value change; the dedicated correctness tests confirm field
values are identical using the *same* database state.)

**Absolute query reduction:** 5 (N=1), 25 (N=5), 125 (N=25).
**Percentage query reduction:** 83.3% (N=1), 96.2% (N=5), **99.2% (N=25)**.

## Query Scaling — before vs after

- **Before:** `total_queries = 1 + 5 × N` — linear, unbounded growth with
  apartment count (marginal cost 5.00 queries/apartment).
- **After:** `total_queries = 1` at N=1, N=5, **and** N=25 — **flat,
  independent of N** (marginal cost 0.00 queries/apartment, measured
  directly). Query count for `GET /api/apartments/` is no longer coupled
  to the number of apartments returned.

## Tests Run

| Command | Result |
|---|---|
| `ENV_FILE=.env.test python manage.py check` | No issues (0 silenced) |
| `ENV_FILE=.env.test python manage.py test api.performance_tests.test_apartments_performance -v 2` | **5/5 passed** (2 correctness-value tests, 1 cross-check-vs-original-query test, 1 create-fallback test, 1 flat-scaling regression test, 1 N=1 overhead test) |
| `ENV_FILE=.env.test python manage.py test api.tests_inventory -v 1` | **41/41 passed**, unchanged (permissions, region scoping, availability workflow, occupancy-conflict checks, bulk creation) |
| `ENV_FILE=.env.test python manage.py test api.performance_tests.test_buildings_performance -v 1` (sanity re-check) | **5/5 passed**, BLD-01 still flat at 2 queries/request — unaffected by this change |

All runs against the same local disposable `test_db` Docker container used
for the BLD-01/BLD-02 baselines — the real Azure database was never
touched.

## Files Changed

**Production application files (2):**
- `backend/api/views.py` — added `_annotate_apartment_inventory_counts()`
  helper (placed immediately before `ApartmentViewSet`); changed
  `ApartmentViewSet.get_queryset()`'s first statement to wrap the base
  queryset in that helper. No new imports needed (already present from the
  BLD-01 fix). No other function in this file was touched.
- `backend/api/serializers.py` — `ApartmentSerializer.get_actual_room_count`
  / `get_bed_count` / `get_occupied_beds` changed to
  read-annotation-first-with-fallback. `get_free_beds` and every other
  serializer in the file are unchanged.

**Performance tests:**
- `backend/api/performance_tests/test_apartments_performance.py` —
  updated: scaling test now asserts flat (not linear) query count and
  writes to a new evidence file (`APARTMENTS_AFTER_QUERY_COUNTS.txt`, not
  the frozen baseline file); added `ApartmentCountCorrectnessTests` (3 new
  tests); `_measure` now also asserts per-row field correctness.

**Documentation / evidence:**
- `project-quality/performance/evidence/APARTMENTS_AFTER_QUERY_COUNTS.txt` — new.
- `project-quality/performance/evidence/APARTMENTS_AFTER_TEST_RUN_LOG.txt` — new.
- `project-quality/performance/PERFORMANCE_OPTIMIZATION_RESULTS.md` — this section added; BLD-01 and BLD-02-baseline sections above left unchanged.
- `project-quality/performance/APARTMENTS_OPTIMIZATION_SUMMARY.md` — new, upload-ready summary.
- Baseline evidence files (`APARTMENTS_BASELINE_QUERY_COUNTS.txt`,
  `APARTMENTS_BASELINE_TEST_RUN_LOG.txt`) — **not modified**, confirmed
  unchanged.

## Whether permissions/business/API behavior changed

**No.** Permissions, role behavior, region isolation, `building`/
`is_active` query-param semantics, ordering, response field names/types,
business rules (availability workflow, occupancy-conflict checks),
create/update behavior, and the allocation algorithm are all unchanged —
verified by the unmodified `tests_inventory.py` suite passing 41/41, and
by the new correctness tests proving field values are identical to the
pre-fix computation.

## Remaining Limitations

- Only `GET /api/apartments/` (list/retrieve via `ApartmentViewSet`) was
  optimized. `RoomSerializer`/`Room` model properties (BLD-03) and
  `BedSerializer.is_occupied` (BLD-04) still have their original per-row
  query patterns — out of scope for this phase.
- No pagination was added to `ApartmentViewSet` (BLD-05) — still out of
  scope; response size will still grow with total apartment count in a
  building, just without the query-count multiplier.
- Timing measurements remain server-side-only (DRF `APIClient`, no real
  HTTP/network/Azure layer).
- Real production data volume/shape was not used — synthetic data only,
  consistent with the baseline method.

## Interpretation

BLD-02 is resolved for `GET /api/apartments/`: query count dropped from
`1 + 5N` to a flat `1`, a 99.2% reduction at N=25, with zero observed
change in returned values, permissions, or any other endpoint behavior —
and the already-closed BLD-01 fix was confirmed unaffected.

---

# BLD-03 — Rooms API Baseline

## Date
2026-08-10

## Branch
`donia-performance-optimization`

## Commit / base state
Same working tree as BLD-01/BLD-02 (no checkpoint commit exists yet for
this branch). `RoomViewSet`/`RoomSerializer`/`Room` model properties are
**unmodified** at the time this baseline was captured.

## Environment
Identical to BLD-01/BLD-02: local, disposable PostgreSQL 16 via `docker
compose --profile local-db up -d test_db` (already running, not
restarted), Django's own further-disposable `test_dormify_test` database
via `.env.test`. Real Azure database never connected to.

## Root cause (from code inspection, BLD-03)

`backend/api/serializers.py:517-559` (`RoomSerializer`) plus
`backend/api/models.py:323-349` (`Room` properties):

- `current_occupancy` (sourced from the `Room.current_occupancy`
  property) always runs **1 query**
  (`BedAssignment.filter(bed__room=self, status=ACTIVE).count()`).
- `available_beds` (sourced from `Room.available_beds`) **short-circuits
  to 0 with no query when the room is inactive**; otherwise runs **2
  queries** (a distinct-bed ACTIVE-assignment count, plus a total
  `beds.count()`).
- `is_full` (sourced from `Room.is_full`) **short-circuits to `True` with
  no query when the room is inactive**; otherwise calls
  `self.available_beds` again, re-running **both queries above a second
  time**.
- `get_bed_count` always runs `obj.beds.count()` — a third independent
  count of the same bed rows for an active room.
- `get_has_missing_bed_records` always runs `obj.beds.count()` again — a
  fourth independent count.
- **Net:** an **active** room costs up to **7 queries** (1 + 2 + 2 + 1 +
  1); an **inactive** room costs only **3** (current_occupancy always
  runs; available_beds/is_full short-circuit; bed_count and
  has_missing_bed_records still run).

## Measurement method

- New test module: `backend/api/performance_tests/test_rooms_performance.py`.
- Same `CaptureQueriesContext` + SQL-shape-masking technique as BLD-01/02.
- Command:
  ```
  cd backend
  ENV_FILE=.env.test python manage.py test api.performance_tests.test_rooms_performance -v 2
  ```
- Run twice for reproducibility (identical query counts both times: 8 /
  36 / 176 for N=1/5/25 active rooms; 4 for the dedicated inactive-room
  case).

## Dataset

- 1 region, 1 dorm type, 1 `central_admin` user, 1 `Building` → 1 active
  `Apartment` → N active `Room`s per measurement.
- Per room: 3 beds, with the first 2 given an `ACTIVE` `BedAssignment` —
  giving uniform, non-trivial values on every row: `current_occupancy=2`,
  `available_beds=1`, `is_full=False`, `bed_count=3`,
  `has_missing_bed_records=False`.
- A dedicated separate test builds one **inactive** room (capacity=2, 0
  beds occupied) to document the short-circuit query-count difference
  (4 queries vs. 8 for an equivalent active room at N=1).
- **Dataset sizes measured:** N = 1, 5, 25 rooms, matching BLD-01/02.
- Endpoint: `GET /api/rooms/?building=<id>&is_active=all` — the exact call
  `dormInventoryAPI.getRooms({building, is_active:'all'})` makes from
  `BuildingsPage.js`'s `selectBuilding()` (fired in parallel with the
  Apartments call).

## Results

| Rooms (N) | Total SQL queries | Queries / room | Server-side time (ms, 2 runs) | Response size (bytes) |
|---:|---:|---:|---:|---:|
| 1  | 8   | 8.00 | 11–15   | 283   |
| 5  | 36  | 7.20 | 53–61   | 1,406 |
| 25 | 176 | 7.04 | 235–269 | 7,080 |

**Marginal queries per additional (active) room:** `(176 − 36) / (25 − 5) = 7.00` —
matches the code-inspection estimate exactly. Fitting `total = base + 7×N`
gives `base = 1` for all three points (8=1+7·1, 36=1+7·5, 176=1+7·25) —
clean linear fit, same shape as BLD-01/02.

**Inactive-room case:** 1 inactive room costs **4** queries (vs. 8 for an
equivalent active room), confirming the `is_full`/`available_beds`
short-circuit behavior in the code — `current_occupancy` (1) +
`bed_count` (1) + `has_missing_bed_records` (1) + the 1 fixed list query
= 4.

### Duplicate/repeated query patterns observed (N=25, active rooms)

- `SELECT COUNT(*) FROM api_bed WHERE room_id = #` — **×100** (4/room ×
  25 rooms) — `get_bed_count` and `get_has_missing_bed_records` each call
  `obj.beds.count()` once (2×), and `available_beds`'s internal
  `self.beds.count()` runs once directly and once again via `is_full`
  calling `available_beds` a second time (2× more) — 4 total identical
  `beds.count()` queries per room.
- `SELECT COUNT(*) FROM (SELECT DISTINCT bedassignment.bed_id ...)` —
  **×50** (2/room × 25 rooms) — the distinct-active-assignment count
  inside `available_beds`, run once directly and once again via `is_full`.
- `SELECT COUNT(*) FROM api_bedassignment JOIN api_bed WHERE room_id = # AND status='active'` —
  **×25** (1/room) — `current_occupancy`.

This is the most duplicated of the three endpoints measured so far: of
the 7 queries per active room, **4 are exact in-request duplicates** (the
`beds.count()` shape runs 4 times, the distinct-assignment shape runs
twice) — only 2 structurally distinct pieces of information
(bed count, active-assignment count) are being computed, recomputed 4 and
2 times respectively.

## PASS/FAIL

**Not applicable — BASELINE measurement.** No optimization implemented in
this phase.

## Confirmed bottleneck

`RoomSerializer` (`backend/api/serializers.py:517-559`) plus the `Room`
model properties it reads (`backend/api/models.py:323-349`) are confirmed,
by direct measurement, to add exactly 7 SQL queries per active room row to
`GET /api/rooms/` (3 for an inactive room), growing linearly and
unboundedly with the number of rooms returned, with 4 of those 7 being
in-request duplicates. Matches finding BLD-03 in
`PERFORMANCE_INSPECTION_SUMMARY.md`, now empirically confirmed. **Not
optimized in this phase** — production code unchanged.

## Files created during this baseline measurement

- `backend/api/performance_tests/test_rooms_performance.py` — new.
- `project-quality/performance/evidence/ROOMS_BASELINE_QUERY_COUNTS.txt` — new.
- `project-quality/performance/evidence/ROOMS_BASELINE_TEST_RUN_LOG.txt` — new.
- `project-quality/performance/PERFORMANCE_OPTIMIZATION_RESULTS.md` — this section.
- `project-quality/performance/ROOMS_BASELINE_SUMMARY.md` — new.

All BLD-01/BLD-02 evidence and sections above are **unmodified**.
`RoomViewSet`/`RoomSerializer`/`Room` model are byte-for-byte unchanged
from before this phase.

---

# BLD-03 — Rooms API Optimization Result

## Date
2026-08-10

## Branch
`donia-performance-optimization`

## Scope
Only finding **BLD-03** (`RoomSerializer`/`Room` model property N+1 in
`GET /api/rooms/`). Buildings/BLD-01 and Apartments/BLD-02 (both already
closed), Beds, pagination, the frontend, Docker, Azure, migrations, and
the allocation algorithm were **not** touched.

## Baseline (unchanged — see full detail above and in
`ROOMS_BASELINE_SUMMARY.md`)

| N (rooms) | SQL queries (before, active rooms) |
|---:|---:|
| 1  | 8   |
| 5  | 36  |
| 25 | 176 |

Scaling: `total_queries = 1 + 7 × N` (marginal cost 7.00 queries/room).
Inactive room (N=1): 4 queries (vs. 8 for an equivalent active room).

## Root cause (recap)
`RoomSerializer.current_occupancy`/`available_beds`/`is_full` (sourced
from `Room` model properties, `backend/api/models.py:323-349`) plus
`get_bed_count`/`get_has_missing_bed_records`
(`backend/api/serializers.py:551-559`, pre-fix) each ran independent
queries per `Room` row — the worst duplication of the three endpoints
measured so far: 4 of the 7 per-active-room queries were exact in-request
duplicates (`is_full` re-running `available_beds`'s two queries; `bed_count`
and `has_missing_bed_records` each independently re-counting the same
`Bed` rows).

## Implementation (production code changed)

1. **`backend/api/views.py`**
   - Import line: added `Case, When, Value, F, BooleanField` to the
     existing `django.db.models` import, and `Greatest` to the existing
     `django.db.models.functions` import (alongside `Coalesce`).
   - New module-level helper `_annotate_room_inventory_counts(queryset)`
     (placed just before `RoomViewSet`): three chained `.annotate()`
     calls.
     1. Three correlated-subquery counts: `_bed_count` (all beds for the
        room), `_current_occupancy` (count of ACTIVE `BedAssignment`s,
        matching `Room.current_occupancy`'s plain `.count()` exactly), and
        `_used_beds_distinct` (a **separate** subquery using
        `Count('bed_id', distinct=True)`, deliberately not reused from
        `_current_occupancy`, mirroring the original code's two
        differently-written-but-constraint-guaranteed-equal queries
        literally rather than assuming their equivalence).
     2. `_available_beds`: a `Case(When(is_active=False, then=Value(0)),
        default=Greatest(F('_bed_count') - F('_used_beds_distinct'),
        Value(0)))` — reproduces `Room.available_beds`'s is_active
        short-circuit and `max(beds.count() - used, 0)` clamp exactly, as
        one SQL `CASE` expression instead of a Python `if`.
     3. `_is_full` and `_has_missing_bed_records`: further `Case`
        expressions built from the columns above -
        `_is_full = (available_beds <= 0)` (which is automatically `True`
        for inactive rooms too, since `_available_beds` is already forced
        to `0` for them — collapsing the original two-branch property into
        one comparison) and
        `_has_missing_bed_records = (_bed_count < capacity)`.
   - `RoomViewSet.get_queryset()`: the base queryset
     (`Room.objects.select_related('apartment', 'apartment__building',
     'apartment__building__dorm_type',
     'apartment__building__dorm_type__region')`) is now wrapped in
     `_annotate_room_inventory_counts(...)` before the existing
     `is_active`/`apartment`/`building`/region filters are applied.
2. **`backend/api/serializers.py`** — `RoomSerializer`
   - `current_occupancy`, `available_beds`, `is_full` changed from plain
     `IntegerField(read_only=True)`/`BooleanField(read_only=True)` to
     `SerializerMethodField()` (they previously read the value straight
     off the `Room` model property via implicit `getattr`, which cannot be
     redirected to an annotation without a method field).
   - All five getters (`get_current_occupancy`, `get_available_beds`,
     `get_is_full`, `get_bed_count`, `get_has_missing_bed_records`) now
     read the corresponding `_X` annotation via `getattr(obj, '_X', None)`
     first; if present (the normal case), returned directly with **zero
     extra queries**. If absent (a freshly `POST`-created `Room`), each
     falls back to the **exact original property/query** unchanged.

## Why this fixes the N+1

All five derived values are now computed **inside the single list/detail
SQL statement**, as scalar subquery + `CASE` expressions, instead of as
up to 7 separate round-trip queries issued once per room row from Python
(3 for an inactive room, since the short-circuit is now a SQL branch
instead of a Python early-return that skips the query entirely — meaning
an inactive room costs the *same* flat per-request query count as an
active one now, not fewer).

## Correctness Protection

- **current_occupancy** — subquery matches `Room.current_occupancy`'s
  `BedAssignment.filter(bed__room=self, status=ACTIVE).count()` exactly,
  with no `is_active` gate (same as the original).
- **bed_count** — subquery matches `obj.beds.count()` exactly (all Bed
  rows for the room, `Bed` has no `is_active` field).
- **available_beds** — `Case` expression matches
  `Room.available_beds`'s `if not is_active: return 0` /
  `max(beds.count() - used, 0)` exactly, including using a
  **separately-computed** distinct-bed count (not reusing
  `current_occupancy`), matching the original code's literal structure.
- **is_full** — matches `Room.is_full`'s `if not is_active: return True` /
  `available_beds <= 0` exactly (verified equivalent by construction: an
  inactive room's `_available_beds` is already forced to `0`, so
  `_available_beds <= 0` is `True` for it too).
- **has_missing_bed_records** — matches
  `RoomSerializer.get_has_missing_bed_records`'s
  `beds.count() < capacity` exactly, no `is_active` dependency (same as
  original).
- Verified empirically, not just by inspection: new test
  `RoomCountCorrectnessTests.test_room_values_match_original_unannotated_properties`
  (`backend/api/performance_tests/test_rooms_performance.py`) builds three
  rooms — an active room with a normal occupied/ended/free bed mix, an
  active room with fewer materialized beds than capacity (the
  `has_missing_bed_records` edge case), and an **inactive** room with a
  still-**active** assignment (the asymmetry edge case) — then re-runs the
  *original* `Room` model properties/queries directly against the DB and
  asserts the live endpoint's values are equal, field by field, for all
  three rooms. A second test
  (`test_room_values_match_expected_values`) asserts the same fixture
  against hand-computed expected numbers. A third,
  `test_freshly_created_room_falls_back_correctly`, confirms
  `POST /api/rooms/` still returns correct values (including
  `is_full=True`/`has_missing_bed_records=True` for a brand-new,
  unmaterialized room) via the fallback path. All pass. In addition,
  `RoomsListPerformanceTests._measure` asserts every returned room's five
  fields exactly match the known fixture values at every measured N, and
  a dedicated inactive-room performance test confirms the short-circuit
  values (`available_beds=0`, `is_full=True`) are still correct post-fix.
- **Permissions / region isolation / API contract** — none of
  `RoomViewSet.get_queryset()`'s existing `is_active`/`apartment`/
  `building`/region/role filtering, `create()`, or `update()` logic was
  touched — only wrapped with additional `.annotate()` calls before the
  pre-existing filters run. `RoomSerializer.Meta.fields` (names, order) is
  unchanged, and every field still returns the same Python type as before
  (`int`/`bool`). Confirmed by running the full pre-existing
  `backend/api/tests_inventory.py` suite — **41/41 passed, unchanged**.
  The already-closed BLD-01/BLD-02 fixes were also re-run
  (`test_buildings_performance`, `test_apartments_performance`) and
  confirmed still flat (2 and 1 queries/request respectively) —
  unaffected, even though all three viewsets live in the same
  `backend/api/views.py` file.

## Before vs After Measurements

| N (rooms) | SQL queries before | SQL queries after | Response time before (ms) | Response time after (ms) | Response size before (bytes) | Response size after (bytes) |
|---:|---:|---:|---:|---:|---:|---:|
| 1  | 8   | 1 | ~11–15  | ~11  | 283   | 283   |
| 5  | 36  | 1 | ~53–61  | ~15  | 1,406 | 1,411 |
| 25 | 176 | 1 | ~235–269 | ~15 | 7,080 | 7,083 |
| 1 (inactive room) | 4 | 1 | — | — | — | — |

(Response-time figures are server-side only, DRF `APIClient`, directional
only. Small byte differences are expected noise from independent
test-database runs assigning different auto-increment primary keys — not a
value change; the dedicated correctness tests confirm field values are
identical using the *same* database state.)

**Absolute query reduction:** 7 (N=1), 35 (N=5), 175 (N=25); 3 for the
inactive-room case.
**Percentage query reduction:** 87.5% (N=1), 97.2% (N=5), **99.4%
(N=25)**; 75% for the inactive-room case.

## Query Scaling — before vs after

- **Before:** `total_queries = 1 + 7 × N` for active rooms (3 flat for an
  inactive room) — linear, unbounded growth with room count.
- **After:** `total_queries = 1` at N=1, N=5, **and** N=25, for both
  active **and** inactive rooms — **flat, fully independent of N and of
  room active-status** (marginal cost 0.00 queries/room, measured
  directly).

## Tests Run

| Command | Result |
|---|---|
| `ENV_FILE=.env.test python manage.py check` | No issues (0 silenced) |
| `ENV_FILE=.env.test python manage.py test api.performance_tests.test_rooms_performance -v 2` | **6/6 passed** (2 correctness-value tests, 1 cross-check-vs-original-property test, 1 create-fallback test, 1 flat-scaling regression test, 1 N=1 overhead test, 1 inactive-room post-fix test) |
| `ENV_FILE=.env.test python manage.py test api.tests_inventory -v 1` | **41/41 passed**, unchanged |
| `ENV_FILE=.env.test python manage.py test api.performance_tests.test_buildings_performance api.performance_tests.test_apartments_performance -v 1` (sanity re-check) | **10/10 passed**, BLD-01/BLD-02 still flat (2/1 queries) — unaffected |

All runs against the same local disposable `test_db` Docker container used
for the BLD-01/02/03 baselines — the real Azure database was never
touched.

## Files Changed

**Production application files (2):**
- `backend/api/views.py` — added imports (`Case`, `When`, `Value`, `F`,
  `BooleanField`, `Greatest`); added `_annotate_room_inventory_counts()`
  helper; `RoomViewSet.get_queryset()`'s first statement now wraps the
  base queryset in that helper. No other function in this file was
  touched.
- `backend/api/serializers.py` — `RoomSerializer`'s `current_occupancy`/
  `available_beds`/`is_full` changed from plain field types to
  `SerializerMethodField`; all five getters changed to
  read-annotation-first-with-fallback.

**Performance tests:**
- `backend/api/performance_tests/test_rooms_performance.py` — rewritten:
  scaling test now asserts flat (not linear) query count and writes to a
  new evidence file (`ROOMS_AFTER_QUERY_COUNTS.txt`, not the frozen
  baseline file); added `RoomCountCorrectnessTests` (3 new tests); the
  inactive-room test now asserts flat cost instead of documenting the
  short-circuit discount.

**Documentation / evidence:**
- `project-quality/performance/evidence/ROOMS_AFTER_QUERY_COUNTS.txt` — new.
- `project-quality/performance/evidence/ROOMS_AFTER_TEST_RUN_LOG.txt` — new.
- `project-quality/performance/PERFORMANCE_OPTIMIZATION_RESULTS.md` — this section added; earlier sections left unchanged.
- `project-quality/performance/ROOMS_OPTIMIZATION_SUMMARY.md` — new, upload-ready summary.
- Baseline evidence files (`ROOMS_BASELINE_QUERY_COUNTS.txt`,
  `ROOMS_BASELINE_TEST_RUN_LOG.txt`) — **not modified**, confirmed
  unchanged.

## Whether permissions/business/API behavior changed

**No.** Permissions, role behavior, region isolation, `apartment`/
`building`/`is_active` query-param semantics, ordering, response field
names/types, business rules (availability workflow, occupancy-conflict
checks), create/update behavior, and the allocation algorithm are all
unchanged — verified by the unmodified `tests_inventory.py` suite passing
41/41, and by the new correctness tests proving field values are
identical to the pre-fix computation, including the inactive-room/
active-assignment asymmetry.

## Remaining Limitations

- Only `GET /api/rooms/` was optimized. `BedSerializer.is_occupied`
  (BLD-04) still has its original per-row query pattern — out of scope
  for this phase.
- No pagination was added (BLD-05 unchanged).
- Server-side-only timing (no real HTTP/network/Azure layer).
- Synthetic test data only.
- Same `Coalesce`/explicit-`default` dependency noted for BLD-01/02: the
  `getattr(obj, '_X', None) is not None` fallback checks rely on every
  annotation never legitimately being `None` when present, enforced by
  wrapping every raw count in `Coalesce(..., 0)` and every `Case` with an
  explicit `default=`. If a future edit to
  `_annotate_room_inventory_counts` ever dropped one of those, the
  fallback logic would still be correct (just slower more often), not
  wrong — worth knowing for anyone editing that helper later.

## Interpretation

BLD-03 is resolved for `GET /api/rooms/`: query count dropped from
`1 + 7N` (active rooms) to a flat `1` — independent of both room count
**and** active/inactive status — a 99.4% reduction at N=25, with zero
observed change in returned values, permissions, or any other endpoint
behavior, and the already-closed BLD-01/BLD-02 fixes confirmed
unaffected.

---

# BLD-04 — Beds API Baseline

## Date
2026-08-10

## Branch
`donia-performance-optimization`

## Commit / base state
Same working tree as BLD-01/02/03 (no checkpoint commit exists yet for
this branch). `BedViewSet`/`BedSerializer`/`Bed.is_occupied` are
**unmodified** at the time this baseline was captured.

## Environment
Identical to BLD-01/02/03: local, disposable PostgreSQL 16 via `docker
compose --profile local-db up -d test_db` (already running, not
restarted), Django's own further-disposable `test_dormify_test` database
via `.env.test`. Real Azure database never connected to.

## Root cause (from code inspection, BLD-04)

`backend/api/serializers.py:604-629` (`BedSerializer`) +
`backend/api/models.py:368-370` (`Bed.is_occupied`):

```python
# serializers.py
is_occupied = serializers.BooleanField(read_only=True)

# models.py
@property
def is_occupied(self):
    return self.assignments.filter(status=BedAssignment.Status.ACTIVE).exists()
```

`is_occupied` is a plain `BooleanField(read_only=True)`, so DRF reads it
via `getattr(instance, 'is_occupied')`, which hits the `Bed.is_occupied`
model property — running one `.exists()` query per bed row. This is not
covered by `BedViewSet.get_queryset()`'s `select_related` (forward-FK
chain: room → apartment → building → dorm_type → region), because
`assignments` is a **reverse** FK from `Bed` to `BedAssignment`. Unlike
BLD-01/02/03, there is **no internal duplicate call** here — this is the
simplest of the four N+1 patterns: exactly 1 extra query per bed row, no
repeated sub-computation.

## Measurement method

- New test module: `backend/api/performance_tests/test_beds_performance.py`.
- Same `CaptureQueriesContext` + SQL-shape-masking technique as BLD-01/02/03.
- **N values:** 1, 10, 50 (larger than the 1/5/25 used for
  Buildings/Apartments/Rooms) — per the task instructions, since Beds is
  the lowest-level/highest-volume endpoint. Documented explicitly in the
  test module: real per-request usage from `BuildingsPage.js`'s
  `selectRoom()` is filtered by a single `room` and bounded by that room's
  actual capacity (realistically 1-6 beds), so N=50 does not represent one
  realistic room's bed count — it exists purely to confirm the
  linear-scaling *shape* conclusively over a wider range, the same purpose
  the larger N values served for the other three endpoints.
- Command:
  ```
  cd backend
  ENV_FILE=.env.test python manage.py test api.performance_tests.test_beds_performance -v 2
  ```
- Run twice for reproducibility (identical query counts both times: 2 /
  11 / 51 for N=1/10/50).

## Dataset

- 1 region, 1 dorm type, 1 `central_admin` user, 1 `Building` → 1 active
  `Apartment` → 1 active `Room` (capacity set to N, purely for internal
  consistency, not realism) → N `Bed`s per measurement.
- **Occupancy:** half of the beds (rounded down) get an `ACTIVE`
  `BedAssignment`; the other half are left free — so `is_occupied` is
  genuinely exercised both ways (`True` and `False`), not just one uniform
  value.
- **Dataset sizes measured:** N = 1, 10, 50 beds.
- Endpoint: `GET /api/beds/?room=<id>` — the exact call
  `dormInventoryAPI.getBeds({room: id})` makes from `BuildingsPage.js`'s
  `selectRoom()` when staff select a room.

## Results

| Beds (N) | Total SQL queries | Queries / bed | Server-side time (ms, 2 runs) | Response size (bytes) |
|---:|---:|---:|---:|---:|
| 1  | 2  | 2.00 | 6–7    | 115   |
| 10 | 11 | 1.10 | 24–30  | 1,128 |
| 50 | 51 | 1.02 | 90–94  | 5,717 |

**Marginal queries per additional bed:** `(51 − 11) / (50 − 10) = 1.00` —
matches the code-inspection estimate exactly. Fitting `total = base + 1×N`
gives `base = 1` for all three points (2=1+1·1, 11=1+1·10, 51=1+1·50) —
clean linear fit, same shape as BLD-01/02/03, but the smallest per-row
multiplier of the four (1 vs. 6/5/7).

### Duplicate/repeated query patterns observed

Only **one** distinct per-row query shape (`SELECT 1 AS "a" FROM
api_bedassignment WHERE bed_id=# AND status='active' LIMIT 1` — the
`.exists()` query), run once per bed with **zero** in-request duplication.
This is the only one of the four endpoints where the per-row query isn't
itself duplicated within the same request — the entire N+1 cost here is
"one query per row," not "one query per row, run twice."

## PASS/FAIL

**Not applicable — BASELINE measurement.** No optimization implemented in
this phase.

## Confirmed bottleneck

`BedSerializer.is_occupied` (`backend/api/serializers.py:616`, backed by
`Bed.is_occupied` in `backend/api/models.py:368-370`) is confirmed, by
direct measurement, to add exactly 1 SQL query per bed row to
`GET /api/beds/`, growing linearly and unboundedly with the number of beds
returned. Matches finding BLD-04 in `PERFORMANCE_INSPECTION_SUMMARY.md`,
now empirically confirmed. **Not optimized in this phase** — production
code unchanged.

## Files created during this baseline measurement

- `backend/api/performance_tests/test_beds_performance.py` — new.
- `project-quality/performance/evidence/BEDS_BASELINE_QUERY_COUNTS.txt` — new.
- `project-quality/performance/evidence/BEDS_BASELINE_TEST_RUN_LOG.txt` — new.
- `project-quality/performance/PERFORMANCE_OPTIMIZATION_RESULTS.md` — this section.
- `project-quality/performance/BEDS_BASELINE_SUMMARY.md` — new.

All BLD-01/02/03 evidence and sections above are **unmodified**.
`BedViewSet`/`BedSerializer`/`Bed` model are byte-for-byte unchanged from
before this phase.

---

# BLD-04 — Beds API Optimization Result

## Date
2026-08-10

## Branch
`donia-performance-optimization`

## Scope
Only finding **BLD-04** (`BedSerializer.is_occupied` N+1 in `GET
/api/beds/`). Buildings/BLD-01, Apartments/BLD-02, Rooms/BLD-03 (all
already closed), pagination, the frontend, Docker, Azure, migrations, and
the allocation algorithm were **not** touched.

## Baseline (unchanged — see full detail above and in
`BEDS_BASELINE_SUMMARY.md`)

| N (beds) | SQL queries (before) |
|---:|---:|
| 1  | 2  |
| 10 | 11 |
| 50 | 51 |

Scaling: `total_queries = 1 + 1 × N` (marginal cost 1.00 queries/bed) —
the smallest per-row multiplier of the four endpoints, and the only one
with no in-request duplication.

## Root cause (recap)
`BedSerializer.is_occupied` (`backend/api/serializers.py:616`, pre-fix), a
plain `BooleanField(read_only=True)` sourced from `Bed.is_occupied`
(`backend/api/models.py:368-370`), ran one `.exists()` query per bed row —
a reverse-FK lookup not coverable by `select_related`.

## Implementation (production code changed)

1. **`backend/api/views.py`**
   - Import line: added `Exists` to the existing `django.db.models`
     import (alongside `Case, When, Value, F, BooleanField` added for
     BLD-03).
   - New module-level helper `_annotate_bed_occupancy(queryset)` (placed
     just before `BedViewSet`): a single
     `queryset.annotate(_is_occupied=Exists(BedAssignment.objects.filter(bed=OuterRef('pk'),
     status=ACTIVE)))`. Unlike BLD-01/02/03 (all counts, needing
     `Subquery`+`Coalesce`), this is a single boolean check, so `Exists()`
     is the natural, simpler fit — it compiles to a correlated `EXISTS
     (SELECT 1 FROM ... WHERE ...)` per row inside the same SQL statement,
     with no JOIN-multiplication risk (nothing else is being annotated
     here to multiply against).
   - `BedViewSet.get_queryset()`: the base queryset
     (`Bed.objects.select_related('room', 'room__apartment',
     'room__apartment__building', 'room__apartment__building__dorm_type',
     'room__apartment__building__dorm_type__region')`) is now wrapped in
     `_annotate_bed_occupancy(...)` before the existing `room`/
     `apartment`/region filters are applied. No other function in this
     file was touched.
2. **`backend/api/serializers.py`** — `BedSerializer`
   - `is_occupied` changed from plain `BooleanField(read_only=True)` to
     `SerializerMethodField()`.
   - `get_is_occupied`: reads `getattr(obj, '_is_occupied', None)` first
     (fast path, zero extra queries); falls back to the original
     `obj.is_occupied` property when absent. Since `BedViewSet` has no
     create endpoint (`http_method_names = ['get', 'patch', 'head',
     'options']`), the only realistic unannotated case is a `Bed`
     instance fetched some other way (e.g. directly via the ORM outside
     `get_queryset()`) — the fallback keeps that path correct regardless.

## Why this fixes the N+1

`is_occupied` is now computed **inside the single list/detail SQL
statement**, as a correlated `EXISTS` subquery expression, instead of as
a separate round-trip query issued once per bed row from Python.

## Correctness Protection

- **is_occupied** — `Exists(BedAssignment.filter(bed=OuterRef('pk'),
  status=ACTIVE))` matches `Bed.is_occupied`'s
  `self.assignments.filter(status=ACTIVE).exists()` exactly, field for
  field.
- Verified empirically, not just by inspection: new test
  `BedOccupancyCorrectnessTests.test_is_occupied_matches_original_unannotated_property`
  (`backend/api/performance_tests/test_beds_performance.py`) builds three
  beds — one with an **ACTIVE** assignment, one with **no** assignment at
  all, and one whose assignment has since transitioned to **ENDED** (must
  not count as occupied) — then re-runs the *original* `Bed.is_occupied`
  property directly against the DB and asserts the live endpoint's values
  are equal for all three beds. A second test
  (`test_is_occupied_matches_expected_values`) asserts the same fixture
  against hand-computed expected booleans. A third,
  `test_unannotated_bed_falls_back_correctly`, directly serializes a
  `Bed` instance fetched with a plain `Bed.objects.get(pk=...)` (bypassing
  the annotated `get_queryset()` entirely) and confirms `BedSerializer`'s
  fallback path still returns the correct value for both an occupied and
  a free bed. All pass. In addition, `BedsListPerformanceTests._measure`
  asserts the count of occupied beds returned matches the known fixture
  count at every measured N.
- **Permissions / region isolation / API contract** — none of
  `BedViewSet.get_queryset()`'s existing `room`/`apartment`/region/role
  filtering, or its `update()` (label-only edit) logic, was touched —
  only wrapped with an additional `.annotate()` call before the
  pre-existing filters run. `BedSerializer.Meta.fields` (names, order) is
  unchanged, and the field still returns the same Python `bool` type as
  before. Confirmed by running the full pre-existing
  `backend/api/tests_inventory.py` suite — **41/41 passed, unchanged**.
  The already-closed BLD-01/BLD-02/BLD-03 fixes were also re-run
  (`test_buildings_performance`, `test_apartments_performance`,
  `test_rooms_performance` — 16 tests total) and confirmed still flat (2,
  1, and 1 queries/request respectively) — unaffected, even though all
  four viewsets live in the same `backend/api/views.py` file.

## Before vs After Measurements

| N (beds) | SQL queries before | SQL queries after | Response time before (ms) | Response time after (ms) | Response size before (bytes) | Response size after (bytes) |
|---:|---:|---:|---:|---:|---:|---:|
| 1  | 2  | 1 | ~6–7   | ~7   | 115   | 115   |
| 10 | 11 | 1 | ~24–30 | ~6   | 1,128 | 1,137 |
| 50 | 51 | 1 | ~90–94 | ~11  | 5,717 | 5,717 |

(Response-time figures are server-side only, DRF `APIClient`, directional
only. Small byte differences are expected noise from independent
test-database runs assigning different auto-increment primary keys — not
a value change; the correctness tests confirm field values are identical
using the *same* database state.)

**Absolute query reduction:** 1 (N=1), 10 (N=10), 50 (N=50).
**Percentage query reduction:** 50.0% (N=1), 90.9% (N=10), **98.0%
(N=50)**.

## Query Scaling — before vs after

- **Before:** `total_queries = 1 + 1 × N` — linear, unbounded growth with
  bed count.
- **After:** `total_queries = 1` at N=1, N=10, **and** N=50 — **flat,
  fully independent of N** (marginal cost 0.00 queries/bed, measured
  directly).

## Tests Run

| Command | Result |
|---|---|
| `ENV_FILE=.env.test python manage.py check` | No issues (0 silenced) |
| `ENV_FILE=.env.test python manage.py test api.performance_tests.test_beds_performance -v 2` | **5/5 passed** (2 correctness-value tests, 1 fallback test, 1 flat-scaling regression test, 1 N=1 overhead test) |
| `ENV_FILE=.env.test python manage.py test api.tests_inventory -v 1` | **41/41 passed**, unchanged |
| `ENV_FILE=.env.test python manage.py test api.performance_tests.test_buildings_performance api.performance_tests.test_apartments_performance api.performance_tests.test_rooms_performance -v 1` (sanity re-check) | **16/16 passed**, BLD-01/02/03 still flat — unaffected |

All runs against the same local disposable `test_db` Docker container used
throughout this session — the real Azure database was never touched.

## Files Changed

**Production application files (2):**
- `backend/api/views.py` — added `Exists` import; added
  `_annotate_bed_occupancy()` helper; `BedViewSet.get_queryset()` wraps
  its base queryset in that helper.
- `backend/api/serializers.py` — `BedSerializer.is_occupied` changed to
  `SerializerMethodField` with annotation-first-with-fallback getter.

**Performance tests:**
- `backend/api/performance_tests/test_beds_performance.py` — rewritten:
  scaling test now asserts flat (not linear) query count and writes to a
  new evidence file (`BEDS_AFTER_QUERY_COUNTS.txt`, not the frozen
  baseline file); added `BedOccupancyCorrectnessTests` (3 new tests).

**Documentation / evidence:**
- `project-quality/performance/evidence/BEDS_AFTER_QUERY_COUNTS.txt` — new.
- `project-quality/performance/evidence/BEDS_AFTER_TEST_RUN_LOG.txt` — new.
- `project-quality/performance/PERFORMANCE_OPTIMIZATION_RESULTS.md` — this section added; earlier sections left unchanged.
- `project-quality/performance/BEDS_OPTIMIZATION_SUMMARY.md` — new, upload-ready summary.
- Baseline evidence files (`BEDS_BASELINE_QUERY_COUNTS.txt`,
  `BEDS_BASELINE_TEST_RUN_LOG.txt`) — **not modified**, confirmed
  unchanged.

## Whether permissions/business/API behavior changed

**No.** Permissions, role behavior, region isolation, `room`/`apartment`
query-param semantics, ordering, response field names/types, the
label-only edit rule (`update()`), and the allocation algorithm are all
unchanged — verified by the unmodified `tests_inventory.py` suite passing
41/41, and by the new correctness tests proving the field value is
identical to the pre-fix computation, including the ACTIVE-vs-ENDED
assignment distinction.

## Remaining Limitations

- All four confirmed Buildings-page N+1 findings (BLD-01 through BLD-04)
  are now resolved. BLD-05 (pagination) remains open — analysis only, no
  implementation, per session scope.
- Server-side-only timing (no real HTTP/network/Azure layer).
- Synthetic test data only.
- Same `Exists()`-never-NULL dependency as the `Coalesce`/explicit-`default`
  pattern used for BLD-01/02/03: the `getattr(obj, '_is_occupied', None)
  is not None` fallback check relies on the annotation never legitimately
  being `None` when present — true by construction, since `Exists()`
  always evaluates to a real boolean, never NULL.

## Interpretation

BLD-04 is resolved for `GET /api/beds/`: query count dropped from
`1 + 1N` to a flat `1`, a 98.0% reduction at N=50, with zero observed
change in returned values, permissions, or any other endpoint behavior,
and the already-closed BLD-01/BLD-02/BLD-03 fixes confirmed unaffected.
This closes all four confirmed Buildings-page N+1 findings from the
original code inspection.