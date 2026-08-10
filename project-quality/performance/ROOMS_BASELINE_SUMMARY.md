# Rooms API — Baseline Performance Measurement Summary (BLD-03)

Prepared for external AI review. Self-contained record of the BLD-03
baseline measurement phase. Mirrors the methodology used and closed for
BLD-01 (Buildings) and BLD-02 (Apartments) — see `BUILDINGS_BASELINE_SUMMARY.md`,
`BUILDINGS_OPTIMIZATION_SUMMARY.md`, `APARTMENTS_BASELINE_SUMMARY.md`,
`APARTMENTS_OPTIMIZATION_SUMMARY.md`. **No optimization implemented yet —
measurement only.**

## Scope

- **Branch:** `donia-performance-optimization`
- **In scope:** measuring `GET /api/rooms/` only, against code-inspection
  finding **BLD-03** in `PERFORMANCE_INSPECTION_SUMMARY.md`.
- **Not touched:** `RoomViewSet`/`RoomSerializer`/`Room` model production
  code (unchanged), the already-closed BLD-01/BLD-02 optimizations, Beds,
  pagination, frontend code, Docker/Azure configuration, migrations, the
  allocation algorithm.

## Endpoint

`GET /api/rooms/?building=<id>&is_active=all` — the exact call
`dormInventoryAPI.getRooms({building, is_active:'all'})` makes from
`BuildingsPage.js`'s `selectBuilding()`, fired in parallel with the
Apartments call whenever staff select (or refresh) a building.

## Code-level root cause (BLD-03)

`backend/api/serializers.py:517-559` (`RoomSerializer`) +
`backend/api/models.py:323-349` (`Room` properties):

```python
# models.py
@property
def current_occupancy(self):
    return BedAssignment.objects.filter(bed__room=self, status=ACTIVE).count()

@property
def is_full(self):
    if not self.is_active:
        return True
    return self.available_beds <= 0

@property
def available_beds(self):
    if not self.is_active:
        return 0
    used = BedAssignment.objects.filter(bed__room=self, status=ACTIVE).values('bed_id').distinct().count()
    return max(self.beds.count() - used, 0)

# serializers.py
def get_bed_count(self, obj):
    return obj.beds.count()

def get_has_missing_bed_records(self, obj):
    return obj.beds.count() < obj.capacity
```

For an **active** room: `current_occupancy` (1 query) +
`available_beds` (2 queries) + `is_full` (calls `available_beds` again: 2
more queries) + `get_bed_count` (1 query) + `get_has_missing_bed_records`
(1 query) = **7 queries**, of which 4 are structurally identical to
another query already run in the same request (2× `beds.count()` inside
`is_full`'s repeated `available_beds` call + 2× more from
`get_bed_count`/`get_has_missing_bed_records`, and 2× the distinct-
assignment count from `available_beds` being called twice).

For an **inactive** room: `is_full`/`available_beds` short-circuit with no
query, so only `current_occupancy` + `get_bed_count` +
`get_has_missing_bed_records` run = **3 queries**.

## Method

- New test module: `backend/api/performance_tests/test_rooms_performance.py`
  (same `CaptureQueriesContext` + SQL-shape-masking technique as BLD-01/02,
  self-contained).
- Measured at N = 1, 5, 25 rooms (all active, under one `Apartment`/
  `Building` per measurement), matching BLD-01/02's N values.
- A dedicated fourth test measures one **inactive** room separately, to
  document the short-circuit query-count difference.
- Run twice end-to-end for reproducibility (identical query counts both
  times).
- **Database:** same local, disposable PostgreSQL 16 container
  (`docker compose --profile local-db up -d test_db`) already running from
  the BLD-01/02 work — not restarted. Real Azure database never touched.

### Exact commands run

```bash
cd backend
ENV_FILE=.env.test python manage.py test api.performance_tests.test_rooms_performance -v 2
# (run twice, for reproducibility)
```

## Dataset (synthetic, created and torn down by the test itself)

- 1 region, 1 dorm type, 1 `central_admin` user, 1 fresh `Building` → 1
  active `Apartment` → N active `Room`s per measurement.
- Per room: 3 beds, first 2 given an `ACTIVE` `BedAssignment` — giving
  uniform, non-trivial values on every row: `current_occupancy=2`,
  `available_beds=1`, `is_full=False`, `bed_count=3`,
  `has_missing_bed_records=False`.
- Separate one-off fixture: 1 inactive room, capacity=2, 0 beds occupied —
  isolates the short-circuit code path.
- Rationale: BLD-03 predicts a fixed extra-query cost **per room row**
  (different for active vs. inactive rooms), independent of how many
  active assignments/rooms there are elsewhere — so room count (N) is the
  variable that needs to vary to expose linear scaling, while the
  per-room shape (active, non-trivially occupied) only needs to be
  representative.

## Results

| Rooms (N) | Total SQL queries | Queries / room | Server-side time (ms, 2 runs) | Response size (bytes) |
|---:|---:|---:|---:|---:|
| 1  | 8   | 8.00 | 11–15   | 283   |
| 5  | 36  | 7.20 | 53–61   | 1,406 |
| 25 | 176 | 7.04 | 235–269 | 7,080 |

- **Marginal queries per additional room:** `(176 − 36) / (25 − 5) = 7.00`.
- **Linear fit:** `total_queries = 1 + 7 × N` fits all three points exactly
  (8=1+7·1, 36=1+7·5, 176=1+7·25) — zero residual.
- **Code-inspection estimate being tested:** up to ~7 extra queries per
  active room row. **Result: confirmed exactly (7.00 measured marginal
  cost).**
- **Inactive room:** 1 room costs **4** queries total (1 fixed list query
  + 3 per-row), vs. 8 for an equivalent active room (1 + 7) — confirms the
  `is_full`/`available_beds` short-circuit is real and measurable.
- Query counts identical across both full test runs; only timing varied.

## Scaling behavior

Query count scales **linearly** with (active) room count, with no sign of
tapering across the 25× range measured — same shape as BLD-01/02, and the
worst per-row multiplier of the three so far (7 vs. 6 for Buildings, 5 for
Apartments).

## Repeated query patterns (N=25 breakdown, 7 queries/room = 3 distinct shapes)

| Shape | Occurrences (N=25) | Source |
|---|---:|---|
| `COUNT(*) FROM api_bed WHERE room_id=#` | ×100 (4/room) | `get_bed_count` + `get_has_missing_bed_records` (1 each) + `available_beds`'s internal `beds.count()` called once directly and once again via `is_full` (2 more) |
| `COUNT(*) FROM (SELECT DISTINCT bedassignment.bed_id ...)` | ×50 (2/room) | `available_beds`'s distinct-active-assignment count, run directly and again via `is_full` |
| `COUNT(*) FROM api_bedassignment JOIN api_bed WHERE room_id=# AND status='active'` | ×25 (1/room) | `current_occupancy` |

4 of the 7 per-room queries are exact in-request duplicates — the highest
duplication ratio of the three endpoints measured (BLD-01: 2/6, BLD-02:
2/5, BLD-03: 4/7).

## Tests / commands run

| Command | Result |
|---|---|
| `ENV_FILE=.env.test python manage.py test api.performance_tests.test_rooms_performance -v 2` (run twice) | 3/3 tests passed both times; identical query counts (4/8/36/176) both runs |

No `tests_inventory.py` re-run needed for this phase — no production code
changed.

## Limitations / what this baseline does NOT tell us

- No real network/Azure latency measured (DRF `APIClient` only).
- No real production data volume measured — synthetic dataset only, up to
  25 rooms under one apartment.
- Beds endpoint not measured yet — BLD-04 (`BedSerializer.is_occupied`)
  remains code-inspection-only.
- Frontend render time not measured.
- Timing numbers reflect local-machine Python/ORM/serialization cost
  only.

## Exact files created/changed in this phase

- `backend/api/performance_tests/test_rooms_performance.py` — new.
  measurement/regression test, `GET /api/rooms/` only. No production code
  touched.
- `project-quality/performance/evidence/ROOMS_BASELINE_QUERY_COUNTS.txt` — new.
- `project-quality/performance/evidence/ROOMS_BASELINE_TEST_RUN_LOG.txt` — new.
- `project-quality/performance/PERFORMANCE_OPTIMIZATION_RESULTS.md` —
  updated with the new "BLD-03 — Rooms API Baseline" section (BLD-01/02
  sections left untouched).
- `project-quality/performance/ROOMS_BASELINE_SUMMARY.md` — this file.

**Not modified:** `RoomViewSet`, `RoomSerializer`, `Room` model, any other
Django view/serializer/model/migration, React code, Django settings,
Docker configuration, business rules, permissions, region-isolation logic,
pagination, the allocation algorithm, or any BLD-01/BLD-02 file/evidence.

**Docker state:** no change — the local `test_db` container, already
running, was reused as-is.

## Recommended next step

Implement a queryset-level `annotate()`/correlated-`Subquery` fix in
`RoomViewSet.get_queryset()` for `current_occupancy`/`available_beds`/
`is_full`/`bed_count`/`has_missing_bed_records`, preserving:
- the `is_active` short-circuit semantics for `available_beds`/`is_full`
  (an inactive room must still report `available_beds=0`, `is_full=True`),
- the exact distinct-bed counting semantics for `available_beds`,
- `has_missing_bed_records` comparing bed count against `capacity`,

then re-measure at the same N values to confirm query count drops to a
flat, small number independent of N — mirroring
`BUILDINGS_OPTIMIZATION_SUMMARY.md`/`APARTMENTS_OPTIMIZATION_SUMMARY.md`
step for step. **Not implemented in this phase, per its explicit scope.**
