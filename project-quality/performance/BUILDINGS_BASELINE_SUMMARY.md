# Buildings API — Baseline Performance Measurement Summary

Prepared for external AI review. This is a self-contained summary of Phase
2 (baseline measurement) of the Dormify performance-optimization work.
**No optimization has been implemented — this is measurement only.**

## Context

- **Project:** Dormify (university dormitory allocation/management system).
- **Branch:** `donia-performance-optimization`
- **Base commit:** `464c1c8` — "Build assisted allocation engine and staff
  decision workflow" (2026-08-10)
- **Phase 1** (prior, already complete): code-inspection-only review of the
  Buildings page/API, documented in `PERFORMANCE_INSPECTION_SUMMARY.md`
  and `PERFORMANCE_OPTIMIZATION_PLAN.md` in this same folder. It identified
  5 confirmed findings from reading the code alone (no measurement),
  labeled BLD-01 through BLD-05.
- **Phase 2** (this document): measures the single heaviest of those
  findings — **BLD-01**, the `BuildingSerializer` N+1 pattern — against a
  real, running database, to confirm or refute the code-level estimate
  before anything is changed.

## What was measured

**Endpoint:** `GET /api/buildings/?region=<id>&is_active=all` — the exact
call `BuildingsPage.js` makes on page load, region change, and refresh
(via `dormInventoryAPI.getBuildings`).

**Not measured in this phase:** Apartments, Rooms, Beds, or any other
endpoint. Findings BLD-02/03/04/05 remain code-inspection-only.

## Environment / database clarification

The project's `README.md` says the main database is "Neon-hosted." That is
**stale documentation** — the real `.env`'s `DB_HOST` resolves to a
managed Postgres host consistent with **Azure Database for PostgreSQL**,
not Neon (confirmed by inspecting the actual `.env` value, not the
README). This baseline measurement did not touch that real database at
all — see below.

**Database actually used for this measurement:** a local, disposable
PostgreSQL 16 container (`docker compose --profile local-db up -d
test_db`, service already defined in this repo's `docker-compose.yml`),
started with the user's explicit approval. Django's own test runner then
created/destroyed its own further-disposable `test_dormify_test` database
inside that container for each test run — standard `manage.py test`
behavior. **The real Azure/production database was never connected to.**

A new local-only `.env.test` (repo root, not committed as a secret — it
only contains the same non-secret local Docker Compose credentials already
visible in `docker-compose.yml`) points `manage.py test` at that local
container instead of the real `.env`.

## Method

1. New test module: `backend/api/performance_tests/test_buildings_performance.py`,
   in a new `api/performance_tests/` package created specifically to hold
   performance/query-count regression tests going forward (Apartments,
   Rooms, Beds, Analysis, etc. will get their own modules there in later
   phases). Business-logic/permission tests for buildings remain
   untouched in `api/tests_inventory.py`.
2. Each measurement:
   - Rebuilds a small synthetic building hierarchy (see "Dataset" below).
   - Wraps one `GET /api/buildings/` call (via DRF's `APIClient`) in
     `django.test.utils.CaptureQueriesContext` — the same technique
     already used in this repo's `api/tests_students_performance.py` for
     a prior, separate N+1 investigation on the Students page.
   - Records: total SQL query count, query "shapes" (SQL text with
     numeric literals masked, to detect repeated/duplicate query
     patterns), wall-clock time via `time.perf_counter()`, and
     `len(response.content)` for payload size.
3. Measured at three building counts (N = 1, 5, 25) to check whether query
   count scales linearly with N (the defining symptom of N+1).
4. Run twice end-to-end to confirm the query-count numbers are
   reproducible (they were, byte-for-byte; timing varied slightly, as
   expected).
5. Cross-check: the pre-existing `api/tests_inventory.py` suite (41 tests,
   permissions/business rules for buildings/apartments/rooms/beds) was run
   against the same local database — **41/41 passed**, confirming the new
   test package doesn't interfere with anything and no behavior changed.

### Exact commands run

```bash
# One-time: start the local disposable test database (explicit user approval obtained)
docker compose --profile local-db up -d test_db

# Baseline measurement
cd backend
ENV_FILE=.env.test python manage.py test api.performance_tests.test_buildings_performance -v 2

# Regression/sanity check against the same local DB
ENV_FILE=.env.test python manage.py test api.tests_inventory -v 1
```

## Dataset (synthetic, created and torn down by the test itself)

- 1 region, 1 dorm type, 1 `central_admin` user (`force_authenticate`).
- Per building: 2 apartments → 2 rooms/apartment → 2 beds/room, plus one
  `ACTIVE` `BedAssignment` on the first bed of the first room of the first
  apartment (so `occupied_beds`/`free_beds` computation is genuinely
  exercised, not just counted as zero).
- Measured at N = 1, 5, and 25 buildings, each a fully independent,
  isolated measurement (inventory reset between runs).
- Rationale: the code-inspection finding predicts a fixed number of extra
  queries **per building row**, independent of apartment/room/bed
  richness underneath — so building count (N) is the variable that needs
  to change to expose linear scaling, while per-building shape only needs
  to be non-trivial.

## Results

| Buildings (N) | Total SQL queries | Queries / building | Server-side time (ms, 2 runs) | Response size (bytes) |
|---:|---:|---:|---:|---:|
| 1  | 8   | 8.00 | 14–15   | 294   |
| 5  | 32  | 6.40 | 59–72   | 1,461 |
| 25 | 152 | 6.08 | 240–270 | 7,338 |

- **Marginal queries per additional building:** `(152 − 32) / (25 − 5) = 6.00`.
- **Linear fit:** `total_queries = 2 + 6 × N` fits all three data points
  exactly (8 = 2+6·1, 32 = 2+6·5, 152 = 2+6·25) — zero residual.
- **Code-inspection estimate being tested:** ~6 extra queries per building
  row, from `BuildingSerializer`'s five `SerializerMethodField`s. **Result:
  confirmed almost exactly (6.00 measured marginal cost).**
- **Query counts were identical across both full test runs**; only timing
  varied (normal wall-clock noise).

### Duplicate query patterns (N=25 breakdown, 6 queries/building = 4 distinct shapes)

| Shape | Occurrences (N=25) | Source |
|---|---:|---|
| `COUNT(*) FROM api_bed JOIN api_room JOIN api_apartment WHERE building_id=#` | ×50 (2/building) | `get_bed_count` called directly **and again inside** `get_free_beds` |
| `COUNT(*) FROM (SELECT DISTINCT bedassignment.bed_id ...)` | ×50 (2/building) | `get_occupied_beds` called directly **and again inside** `get_free_beds` |
| `COUNT(*) FROM api_apartment WHERE building_id=# AND is_active` | ×25 (1/building) | `get_apartment_count` |
| `COUNT(*) FROM api_room JOIN api_apartment WHERE building_id=# ...` | ×25 (1/building) | `get_room_count` |

Two of the four query shapes are **exact duplicates within the same
request** — `get_free_beds` (`backend/api/serializers.py:411-412`)
recomputes `bed_count` and `occupied_beds` a second time instead of
reusing the values already computed for the sibling fields in the same
row. Roughly a third of the per-building query volume is strictly
redundant.

## Interpretation

- The N+1 pattern predicted purely from reading the code (finding BLD-01
  in `PERFORMANCE_INSPECTION_SUMMARY.md`) is confirmed by direct
  measurement, at essentially the exact predicted magnitude, with perfect
  linear scaling across a 25× range of building counts.
- Extrapolating the same fitted line (not separately measured): a region
  with 100 buildings would be predicted to issue ~602 queries for a single
  `/api/buildings/` page load, from this one serializer alone.
- This is now an empirically confirmed bottleneck, not a hypothesis.

## Limitations / what this baseline does NOT tell us

- **No real network/Azure latency measured.** This used DRF's `APIClient`
  (in-process, no real HTTP round trip), so it isolates backend query +
  serialization cost only. Real browser-observed latency = this cost +
  network/Azure transport time, which was not measured.
- **No real production data volume measured.** The dataset is synthetic
  and small-to-medium (up to 25 buildings); real regions may have more or
  fewer buildings, apartments, rooms, and beds, and real query planner
  behavior can differ with larger tables/indexes/data skew.
- **Apartments, Rooms, Beds endpoints not measured yet** — only
  `/api/buildings/` per this phase's explicit scope. Findings BLD-02/03/04
  remain code-inspection-only until a similar measurement is done for
  each.
- **Frontend render time not measured.**
- Timing numbers (14–270ms range) reflect Python/ORM/serialization cost on
  this local machine only — not a promise about production latency.

## Confirmed bottleneck

`backend/api/serializers.py:363-412` — `BuildingSerializer`'s five
`SerializerMethodField`s (`get_apartment_count`, `get_room_count`,
`get_bed_count`, `get_occupied_beds`, `get_free_beds`). Confirmed by
measurement to cost exactly 6 SQL queries per building row, growing
linearly and unboundedly with building count, with ~2/6 of that volume
being an exact in-request duplicate (`get_free_beds` re-running two
queries already run by sibling fields).

## Exact files created/changed in this phase

- `backend/api/performance_tests/__init__.py` — new package for
  performance/query-count regression tests (reserved for this and future
  endpoints).
- `backend/api/performance_tests/test_buildings_performance.py` — new
  measurement/regression test, `GET /api/buildings/` only. No production
  code touched.
- `.env.test` (repo root) — new, local-only, non-secret env file pointing
  test runs at the local disposable `test_db` container.
- `project-quality/performance/evidence/BUILDINGS_BASELINE_QUERY_COUNTS.txt`
  — raw evidence, regenerated by the test itself each run.
- `project-quality/performance/evidence/BUILDINGS_BASELINE_TEST_RUN_LOG_run1.txt`
  — full `manage.py test` console output for one run.
- `project-quality/performance/PERFORMANCE_OPTIMIZATION_RESULTS.md` —
  updated with the "P1 — Buildings API Baseline" section (full detail).
- `project-quality/performance/BUILDINGS_BASELINE_SUMMARY.md` — this file.

**Docker state:** the local `test_db` container (`dormify_test_db`) was
started with explicit user approval and left running for reuse in later
phases; it holds no real data.

**Not modified:** any Django view, serializer, model, migration, React
component, Django setting, Docker configuration (only used, not edited),
business rule, permission/role logic, region-isolation logic, the
allocation algorithm, or `README.md` (the stale Neon reference was flagged
above but intentionally left uncorrected, per this phase's scope).

## Next step

Per `PERFORMANCE_OPTIMIZATION_PLAN.md` § "Recommended First
Optimization": `BuildingSerializer` is both the first query cost incurred
on every Buildings-page load and now the most rigorously confirmed
bottleneck of the five inspection findings. A future phase should
implement the proposed `annotate()`-based fix, then re-run this exact same
measurement (`api.performance_tests.test_buildings_performance`) against
the same dataset sizes to confirm the query count drops to a flat, small
number independent of N, before touching any other endpoint.