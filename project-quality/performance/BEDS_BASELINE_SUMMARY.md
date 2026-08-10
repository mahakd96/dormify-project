# Beds API — Baseline Performance Measurement Summary (BLD-04)

Prepared for external AI review. Self-contained record of the BLD-04
baseline measurement phase. Mirrors the methodology used and closed for
BLD-01 (Buildings), BLD-02 (Apartments), and BLD-03 (Rooms). **No
optimization implemented yet — measurement only.**

## Scope

- **Branch:** `donia-performance-optimization`
- **In scope:** measuring `GET /api/beds/` only, against code-inspection
  finding **BLD-04** in `PERFORMANCE_INSPECTION_SUMMARY.md`.
- **Not touched:** `BedViewSet`/`BedSerializer`/`Bed` model production code
  (unchanged), the already-closed BLD-01/02/03 optimizations, pagination,
  frontend code, Docker/Azure configuration, migrations, the allocation
  algorithm.

## Endpoint

`GET /api/beds/?room=<id>` — the exact call
`dormInventoryAPI.getBeds({room: id})` makes from `BuildingsPage.js`'s
`selectRoom()` whenever staff select a room.

## Code-level root cause (BLD-04)

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

`is_occupied` is a plain field, so DRF calls `getattr(instance,
'is_occupied')`, hitting the `Bed.is_occupied` property — one `.exists()`
query per bed row, not covered by `select_related` (which only covers the
forward FK chain `room → apartment → building → dorm_type → region`;
`assignments` is a reverse FK). **No internal duplication** — the simplest
of the four N+1 patterns inspected so far.

## Method

- New test module: `backend/api/performance_tests/test_beds_performance.py`
  (self-contained, same technique as BLD-01/02/03).
- **N values: 1, 10, 50** — larger than the 1/5/25 used for
  Buildings/Apartments/Rooms, per the task instructions. Documented
  explicitly: real usage from `selectRoom()` is bounded by one room's
  actual capacity (realistically 1-6 beds); N=50 exists purely to confirm
  the linear-scaling *shape* over a wider range, not to represent a
  realistic single room.
- Run twice end-to-end for reproducibility (identical query counts both
  times).
- **Database:** same local, disposable PostgreSQL 16 container already
  running from BLD-01/02/03 — not restarted. Real Azure database never
  touched.

### Exact commands run

```bash
cd backend
ENV_FILE=.env.test python manage.py test api.performance_tests.test_beds_performance -v 2
# (run twice, for reproducibility)
```

## Dataset (synthetic, created and torn down by the test itself)

- 1 region, 1 dorm type, 1 `central_admin` user, 1 fresh `Building` → 1
  active `Apartment` → 1 active `Room` (capacity set to N for internal
  consistency only) → N `Bed`s per measurement.
- Half the beds (rounded down) get an `ACTIVE` `BedAssignment`; the rest
  are free — `is_occupied` genuinely exercised both `True` and `False`.
- Rationale: BLD-04 predicts a fixed extra-query cost **per bed row**,
  independent of anything else — so bed count (N) is the only variable
  that needs to vary to expose linear scaling.

## Results

| Beds (N) | Total SQL queries | Queries / bed | Server-side time (ms, 2 runs) | Response size (bytes) |
|---:|---:|---:|---:|---:|
| 1  | 2  | 2.00 | 6–7   | 115   |
| 10 | 11 | 1.10 | 24–30 | 1,128 |
| 50 | 51 | 1.02 | 90–94 | 5,717 |

- **Marginal queries per additional bed:** `(51 − 11) / (50 − 10) = 1.00`.
- **Linear fit:** `total_queries = 1 + 1 × N` fits all three points exactly
  (2=1+1·1, 11=1+1·10, 51=1+1·50) — zero residual.
- **Code-inspection estimate being tested:** ~1 extra query per bed row.
  **Result: confirmed exactly.**
- Query counts identical across both full test runs; only timing varied.

## Scaling behavior

Query count scales **linearly** with bed count, with no sign of tapering
across the 50× range measured — same shape as BLD-01/02/03, but the
smallest per-row multiplier of the four measured so far (1 vs. 6/5/7).

## Repeated query patterns

Only **one** distinct per-row query shape (the `.exists()` query), run
exactly once per bed, with **zero** in-request duplication — unlike
BLD-01/02/03, which each had `get_free_beds`/`is_full` re-running earlier
queries. Beds' N+1 cost is purely "1 query × N rows," nothing more.

## Tests / commands run

| Command | Result |
|---|---|
| `ENV_FILE=.env.test python manage.py test api.performance_tests.test_beds_performance -v 2` (run twice) | 2/2 tests passed both times; identical query counts (2/11/51) both runs |

No `tests_inventory.py` re-run needed for this phase — no production code
changed.

## Limitations / what this baseline does NOT tell us

- No real network/Azure latency measured (DRF `APIClient` only).
- No real production data volume measured — synthetic dataset; N=50
  deliberately exceeds any single room's realistic bed count (see
  above).
- Frontend render time not measured.
- Timing numbers reflect local-machine Python/ORM/serialization cost
  only.

## Exact files created/changed in this phase

- `backend/api/performance_tests/test_beds_performance.py` — new.
  measurement/regression test, `GET /api/beds/` only. No production code
  touched.
- `project-quality/performance/evidence/BEDS_BASELINE_QUERY_COUNTS.txt` — new.
- `project-quality/performance/evidence/BEDS_BASELINE_TEST_RUN_LOG.txt` — new.
- `project-quality/performance/PERFORMANCE_OPTIMIZATION_RESULTS.md` —
  updated with the new "BLD-04 — Beds API Baseline" section (BLD-01/02/03
  sections left untouched).
- `project-quality/performance/BEDS_BASELINE_SUMMARY.md` — this file.

**Not modified:** `BedViewSet`, `BedSerializer`, `Bed` model, any other
Django view/serializer/model/migration, React code, Django settings,
Docker configuration, business rules, permissions, region-isolation logic,
pagination, the allocation algorithm, or any BLD-01/02/03 file/evidence.

**Docker state:** no change — the local `test_db` container, already
running, was reused as-is.

## Recommended next step

Implement an `Exists(BedAssignment.objects.filter(bed=OuterRef('pk'),
status=ACTIVE))` annotation in `BedViewSet.get_queryset()` for
`is_occupied` — checking exactly the same ACTIVE-assignment condition as
the current `Bed.is_occupied` property — then re-measure at the same N
values to confirm query count drops to a flat, small number independent
of N. **Not implemented in this phase, per its explicit scope.**
