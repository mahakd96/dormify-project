# Apartments API — Baseline Performance Measurement Summary (BLD-02)

Prepared for external AI review. Self-contained record of the BLD-02
baseline measurement phase of the Dormify performance-optimization work.
**No optimization has been implemented — this is measurement only.**
Mirrors the methodology already used and closed for BLD-01 (Buildings) —
see `BUILDINGS_BASELINE_SUMMARY.md` and `BUILDINGS_OPTIMIZATION_SUMMARY.md`
in this same folder.

## Scope

- **Branch:** `donia-performance-optimization`
- **Base commit:** `464c1c8` (unchanged from BLD-01 work).
- **In scope:** measuring `GET /api/apartments/` only, against the code
  inspection finding **BLD-02** in `PERFORMANCE_INSPECTION_SUMMARY.md`.
- **Explicitly not touched:** `ApartmentViewSet`/`ApartmentSerializer`
  production code (unchanged), the already-closed BLD-01 Buildings
  optimization, Rooms, Beds, pagination, frontend code, Docker/Azure
  configuration, migrations, and the allocation algorithm.

## Endpoint

`GET /api/apartments/?building=<id>&is_active=all` — the exact call
`dormInventoryAPI.getApartments({building, is_active:'all'})` makes from
`BuildingsPage.js`'s `selectBuilding()`/`refreshCurrentScope()` whenever
staff select (or refresh) a building on the Buildings page.

## Code-level root cause (BLD-02, confirmed unchanged from Phase 1 inspection)

`backend/api/serializers.py:480-492` — `ApartmentSerializer`:

```python
def get_actual_room_count(self, obj):
    return obj.rooms.filter(is_active=True).count()

def get_bed_count(self, obj):
    return Bed.objects.filter(room__apartment=obj, room__is_active=True).count()

def get_occupied_beds(self, obj):
    return BedAssignment.objects.filter(
        bed__room__apartment=obj, status=BedAssignment.Status.ACTIVE,
    ).values('bed_id').distinct().count()

def get_free_beds(self, obj):
    return max(self.get_bed_count(obj) - self.get_occupied_beds(obj), 0)
```

All four are `SerializerMethodField`s; none of their queries are covered
by `ApartmentViewSet.get_queryset()`'s `select_related('building',
'building__dorm_type', 'building__dorm_type__region')` (forward-FK only —
these are reverse-relation aggregate counts). `get_free_beds` re-runs
`get_bed_count`/`get_occupied_beds` a second time each, duplicating 2 of
the 4 queries — identical shape to the BLD-01 (`BuildingSerializer`)
pattern already fixed.

## Method

- New test module: `backend/api/performance_tests/test_apartments_performance.py`
  in the existing `api/performance_tests/` package (self-contained, same
  `CaptureQueriesContext` + SQL-shape-masking technique used for BLD-01).
- Measured at N = 1, 5, 25 apartments (all under one freshly-created
  `Building` per measurement), matching the same N values used for the
  BLD-01 baseline.
- Run twice end-to-end to confirm query-count reproducibility (identical
  both times).
- **Database used:** the same local, disposable PostgreSQL 16 container
  (`docker compose --profile local-db up -d test_db`) already running from
  the BLD-01 work — not restarted, no new Docker action taken. The real
  Azure database was never connected to.

### Exact commands run

```bash
cd backend
ENV_FILE=.env.test python manage.py test api.performance_tests.test_apartments_performance -v 2
# (run twice, for reproducibility)
```

## Dataset (synthetic, created and torn down by the test itself)

- 1 region, 1 dorm type, 1 `central_admin` user, 1 fresh `Building` per
  measurement.
- Per apartment: 3 rooms → 2 beds/room (6 beds/apartment) — so
  `actual_room_count`, `bed_count`, `occupied_beds`, `free_beds` are all
  genuinely non-trivial and non-zero, not just counted as zero. The first
  bed of the first room of every apartment gets one `ACTIVE`
  `BedAssignment`, giving a uniform, easy-to-verify `occupied_beds=1`,
  `free_beds=5` per apartment.
- Rationale: BLD-02 predicts a fixed extra-query cost **per apartment
  row**, independent of room/bed richness underneath — so apartment count
  (N) is the variable that needs to vary to expose linear scaling.

## Results

| Apartments (N) | Total SQL queries | Queries / apartment | Server-side time (ms, 2 runs) | Response size (bytes) |
|---:|---:|---:|---:|---:|
| 1  | 6   | 6.00 | 11–21   | 470    |
| 5  | 26  | 5.20 | 53–79   | 2,341  |
| 25 | 126 | 5.04 | 235–339 | 11,738 |

- **Marginal queries per additional apartment:** `(126 − 26) / (25 − 5) = 5.00`.
- **Linear fit:** `total_queries = 1 + 5 × N` fits all three data points
  exactly (6 = 1+5·1, 26 = 1+5·5, 126 = 1+5·25) — zero residual.
- **Code-inspection estimate being tested:** ~5 extra queries per
  apartment row. **Result: confirmed exactly (5.00 measured marginal
  cost).**
- Query counts were identical across both full test runs; only timing
  varied (normal wall-clock noise).
- The fixed base cost (`1`, vs. `2` measured for the BLD-01 Buildings
  baseline) differs only because this measurement filters by `building=`
  rather than `region=`, so `ApartmentViewSet.get_queryset()` never calls
  the `_resolve_region()` lookup that added one extra query in the
  Buildings case — this doesn't affect the per-row multiplier being
  tested.

## Scaling behavior

Query count scales **linearly** with apartment count, with **no sign of
tapering** across the 25× range measured (N=1 → N=25) — the defining
symptom of an N+1 pattern, and structurally identical to what was measured
and then fixed for BLD-01.

## Repeated query patterns (N=25 breakdown, 5 queries/apartment = 3 distinct shapes)

| Shape | Occurrences (N=25) | Source |
|---|---:|---|
| `COUNT(*) FROM api_bed JOIN api_room WHERE apartment_id=# AND room.is_active` | ×50 (2/apartment) | `get_bed_count` called directly **and again inside** `get_free_beds` |
| `COUNT(*) FROM (SELECT DISTINCT bedassignment.bed_id ...)` | ×50 (2/apartment) | `get_occupied_beds` called directly **and again inside** `get_free_beds` |
| `COUNT(*) FROM api_room WHERE apartment_id=# AND is_active` | ×25 (1/apartment) | `get_actual_room_count` |

2 of the 3 distinct query shapes are exact in-request duplicates
(`get_free_beds` re-running `bed_count`/`occupied_beds`) — ~40% of the
per-apartment query volume is strictly redundant, the same shape of waste
already identified and fixed for BLD-01.

## Tests / commands run

| Command | Result |
|---|---|
| `ENV_FILE=.env.test python manage.py test api.performance_tests.test_apartments_performance -v 2` (run twice) | 2/2 tests passed both times; identical query counts (6/26/126) both runs |

No `tests_inventory.py` re-run was needed for this phase — no production
code was changed, so no regression risk exists to check.

## Limitations / what this baseline does NOT tell us

- **No real network/Azure latency measured** — DRF `APIClient` only
  (in-process, no HTTP round trip).
- **No real production data volume measured** — synthetic dataset only, up
  to 25 apartments under one building.
- **Rooms and Beds endpoints not measured** — BLD-03 (`RoomSerializer` +
  `Room` model properties) and BLD-04 (`BedSerializer.is_occupied`) remain
  code-inspection-only findings, not yet baseline-measured.
- **Frontend render time not measured.**
- Timing numbers reflect Python/ORM/serialization cost on this local
  machine only — not a production latency claim.

## Exact files created/changed in this phase

- `backend/api/performance_tests/test_apartments_performance.py` — new
  measurement/regression test, `GET /api/apartments/` only. No production
  code touched.
- `project-quality/performance/evidence/APARTMENTS_BASELINE_QUERY_COUNTS.txt`
  — raw evidence, regenerated by the test itself each run.
- `project-quality/performance/evidence/APARTMENTS_BASELINE_TEST_RUN_LOG.txt`
  — full `manage.py test` console output for one run.
- `project-quality/performance/PERFORMANCE_OPTIMIZATION_RESULTS.md` —
  updated with the new "BLD-02 — Apartments API Baseline" section
  (existing BLD-01 sections left untouched).
- `project-quality/performance/APARTMENTS_BASELINE_SUMMARY.md` — this
  file.

**Not modified:** `ApartmentViewSet`, `ApartmentSerializer`, any other
Django view/serializer/model/migration, React code, Django settings,
Docker configuration, business rules, permissions, region-isolation logic,
pagination, the allocation algorithm, or any BLD-01 (Buildings)
file/evidence.

**Docker state:** no change — the local `test_db` container
(`dormify_test_db`), already running from the BLD-01 work, was reused
as-is; nothing was started, stopped, or removed in this phase.

## Recommended next step

Per the same pattern that closed BLD-01: implement a queryset-level
`annotate()`/correlated-`Subquery` fix in `ApartmentViewSet.get_queryset()`
for `actual_room_count`/`bed_count`/`occupied_beds` (with `free_beds`
derived from the other two), preserving exact filter semantics
(`is_active` on rooms; `occupied_beds` deliberately not filtered by
room `is_active`, matching the current asymmetry), then re-run this exact
measurement (`api.performance_tests.test_apartments_performance`) at the
same N values to confirm query count drops to a flat, small number
independent of N — mirroring `BUILDINGS_OPTIMIZATION_SUMMARY.md` step for
step. **Not implemented in this phase, per its explicit scope.**