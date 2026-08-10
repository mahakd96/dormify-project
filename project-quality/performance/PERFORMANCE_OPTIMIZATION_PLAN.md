# Performance Optimization Plan — Buildings Page / API

**Branch:** `donia-performance-optimization`
**Phase:** 1 — Inspection only (no application code changed)
**Date:** 2026-08-10

---

## 1. Objective

Understand and document, with evidence from the current codebase, why the
Buildings page (`/api/buildings/`, `/api/apartments/`, `/api/rooms/`,
`/api/beds/` and the React `BuildingsPage`) is suspected to be slow, before
any code is changed. Produce a precise, code-grounded basis for an
optimization that a future phase can implement safely.

This document does **not** implement any fix. It records what the code
currently does, what is confirmed, what is only a hypothesis, and what must
be measured before touching anything.

## 2. Scope

In scope for this phase (read-only inspection):
- React `BuildingsPage` (`src/pages/BuildingsPage.js`) and the API helpers it
  calls (`src/services/api.js` — `dormInventoryAPI`, `whatIfAPI`, plus the
  `api`/`regionsAPI` calls used on mount).
- Django URL routing for buildings/apartments/rooms/beds/regions/dorm-types
  (`backend/api/urls.py`).
- The corresponding ViewSets (`RegionViewSet`, `DormTypeViewSet`,
  `BuildingViewSet`, `ApartmentViewSet`, `RoomViewSet`, `BedViewSet` in
  `backend/api/views.py`).
- The corresponding serializers (`backend/api/serializers.py`).
- The corresponding models and computed properties (`backend/api/models.py`
  — `Building`, `Apartment`, `Room`, `Bed`, `BedAssignment`).
- Existing tests touching buildings/inventory/performance
  (`backend/api/tests_inventory.py`, `backend/api/tests_students_performance.py`).

## 3. Non-goals (explicitly out of scope for this phase)

- No changes to Django views, serializers, models, or migrations.
- No changes to React components or frontend API call shape.
- No changes to the allocation algorithm or its tests.
- No changes to Docker configuration or dependencies.
- No changes to database data or schema.
- No performance work on any page other than Buildings (Students-page
  performance work already happened previously — see
  `tests_students_performance.py` — and is referenced here only as prior art
  / a pattern to reuse, not as something to touch).
- No conclusions about Azure, network, Docker, or the database engine being
  the cause — nothing in this repo was inspected that supports or refutes
  that, so it is not claimed either way.

## 4. Current Buildings request/data flow (as implemented today)

1. **Page mount** (`BuildingsPage` `useEffect` at
   `src/pages/BuildingsPage.js:764`): calls
   `loadRegionsAndDormTypes()` → `Promise.all([api.get('/api/regions/'),
   api.get('/api/dorm-types/')])` (2 parallel requests), resolves the
   region to use, then calls `loadBuildings(regionId)` →
   `dormInventoryAPI.getBuildings({ region, is_active: 'all' })` → `GET
   /api/buildings/?region=...&is_active=all`.
2. **Django routing**: `/api/buildings/` → `BuildingViewSet` (DRF router,
   `backend/api/urls.py:12`) → `list()` (default `ModelViewSet.list`, not
   overridden) → `BuildingViewSet.get_queryset()`
   (`backend/api/views.py:725`) → `BuildingSerializer`
   (`backend/api/serializers.py:363`).
3. **Selecting a building** (`selectBuilding`,
   `src/pages/BuildingsPage.js:693`): `Promise.all([
   dormInventoryAPI.getApartments({building, is_active:'all'}),
   dormInventoryAPI.getRooms({building, is_active:'all'}) ])` → `GET
   /api/apartments/?building=...` and `GET /api/rooms/?building=...` in
   parallel → `ApartmentViewSet` / `RoomViewSet` →
   `ApartmentSerializer` / `RoomSerializer`.
4. **Selecting a room** (`selectRoom`, `src/pages/BuildingsPage.js:724`):
   `dormInventoryAPI.getBeds({room: id})` → `GET /api/beds/?room=...` →
   `BedViewSet` → `BedSerializer`.
5. **Refresh** (`refreshCurrentScope`, `src/pages/BuildingsPage.js:748`)
   re-issues whichever of the above calls apply to the current selection.

So a single "open Buildings page, pick a building, pick a room" session
triggers, at minimum: 2 (regions+dormtypes) + 1 (buildings) + 2
(apartments+rooms, parallel) + 1 (beds) = 6 distinct backend requests, each
landing on a queryset+serializer pair analyzed below.

## 5. Confirmed performance risks found in the code

These are stated only where the current code, as read, directly supports
the conclusion. Full detail (file/line/evidence) is in
`PERFORMANCE_INSPECTION_SUMMARY.md`; summarized here:

- **`BuildingSerializer`** (`serializers.py:363-412`) computes
  `apartment_count`, `room_count`, `bed_count`, `occupied_beds`, `free_beds`
  as `SerializerMethodField`s, each running its own DB query per building
  row (classic N+1 on `GET /api/buildings/`), and `get_free_beds` calls
  `get_bed_count`/`get_occupied_beds` a second time internally — so two of
  the five computed fields are queried twice per row.
- **`ApartmentSerializer`** (`serializers.py:415-467`) repeats the identical
  pattern: `actual_room_count`, `bed_count`, `occupied_beds` are per-row
  queries, and `get_free_beds` again duplicates the `bed_count`/
  `occupied_beds` queries.
- **`RoomSerializer`** (`serializers.py:470-512`) plus the `Room` model
  properties it reads (`models.py:323-349`) stack multiple independent
  per-row queries for overlapping information: `current_occupancy`,
  `available_beds` (which itself runs 2 queries), `is_full` (which calls
  `available_beds` again, duplicating those 2 queries), `bed_count` (a
  third independent `beds.count()`), and `has_missing_bed_records` (a
  fourth independent `beds.count()`).
- **`BedSerializer.is_occupied`** (`serializers.py:527`, backed by
  `Bed.is_occupied` in `models.py:368-370`) runs one query per bed row that
  is not covered by `BedViewSet`'s `select_related` (it's a reverse FK
  lookup, not a forward relation).
- **No pagination** on `BuildingViewSet`, `ApartmentViewSet`,
  `RoomViewSet`, or `BedViewSet` — unlike `StudentViewSet` and
  `StudentRequestViewSet`, which both set `pagination_class =
  StandardResultsPagination` (`views.py:1314`, `views.py:2839`). The four
  inventory viewsets return every matching row in one response, so the
  per-row query multipliers above scale with total inventory size in scope,
  not with what is visible on screen.

None of these require load testing to confirm — they are visible directly
in the serializer/model code. What is *not* yet known is their real-world
magnitude (see next section).

## 6. Hypotheses requiring measurement (not yet confirmed)

- Actual wall-clock response time of each endpoint under realistic data
  volume (current building/apartment/room/bed counts per region).
- Actual SQL query count per request (the counts above are read from code;
  they should be captured with `django.test.utils.CaptureQueriesContext` or
  `django-debug-toolbar`/`nplusone` against real data to confirm magnitude).
- How much of total response time is DB/query time vs. Python/serialization
  time vs. network/transport time.
- Actual response payload size for `/api/buildings/`, `/api/apartments/`,
  `/api/rooms/` at current data volume.
- Whether Azure hosting, network latency, or DB connection setup contribute
  meaningfully — nothing in this inspection points at or away from these;
  they are unverified.
- Frontend render/re-render cost once data arrives (React state updates in
  `BuildingsPage` are straightforward `useState`/`useMemo`, but this was not
  profiled).
- Whether the observed "slow" feeling correlates with a specific region
  (i.e., regions with unusually large building/apartment counts) or is
  uniform.

## 7. Baseline measurements to collect before changing any code

See the detailed checklist in `PERFORMANCE_INSPECTION_SUMMARY.md` §
"Baseline Measurements Required Before Optimization". At minimum: endpoint
response time, SQL query count, duplicate-query count, response size, and
all APIs fired on page open — captured against realistic current data,
before and after any future change, for `/api/buildings/`,
`/api/apartments/`, `/api/rooms/`, `/api/beds/`.

## 8. Proposed optimization approach (not implemented in this phase)

For a later phase, once baseline numbers exist:

1. Replace the per-row `SerializerMethodField` queries in
   `BuildingSerializer`/`ApartmentSerializer`/`RoomSerializer` with
   queryset-level aggregation (Django `annotate()` with `Count`/`Sum` and
   `Case`/`When` or `Q` filters) computed once for the whole page of
   results, instead of once per row.
2. Eliminate the duplicate computation inside `get_free_beds` (Building and
   Apartment serializers) and inside `Room.is_full` /
   `RoomSerializer.bed_count` / `has_missing_bed_records`, so each piece of
   data is computed exactly once per request instead of two–four times.
3. Cover `Bed.is_occupied` with a `prefetch_related`/annotation instead of a
   per-row `.exists()` query.
4. Consider adding pagination (or an explicit, deliberate "return
   everything" decision with a documented reason) to the inventory
   viewsets, matching the precedent already set for `StudentViewSet`.
5. Re-measure after each change against the same baseline scenario to
   confirm the fix worked and nothing else changed.

This is a proposal for a future phase, not an instruction to implement now.

## 9. Verification requirements (for whichever future phase implements this)

- Every optimized endpoint must be re-measured with the same method used
  for the baseline (query count, response time, payload size) and show a
  measurable improvement.
- Django's automated test suite (`backend/api/tests_inventory.py` and any
  new query-count test modeled on `tests_students_performance.py`) must
  pass unchanged in behavior — only query-count/performance assertions may
  be added, not behavior assertions removed.
- A manual smoke test of the Buildings page (React) must confirm the UI
  renders identical data (same buildings, apartments, rooms, beds, counts,
  statuses) before and after.

## 10. API behavior must remain unchanged

Any future optimization must preserve, byte-for-byte where practical and
functionally in all cases:
- The exact JSON shape and field names returned by `/api/buildings/`,
  `/api/apartments/`, `/api/rooms/`, `/api/beds/` (and their sub-actions).
- All permission and region-scoping logic in each `get_queryset()`
  (central admin vs. region boss vs. employee; `region` query param
  handling; `is_active` filter semantics).
- All business rules enforced in `create`/`update` (availability-workflow
  gating, occupancy-conflict checks, duplicate-number checks, etc.).
- The allocation algorithm and everything under `backend/allocation/` —
  none of it is touched by this work and it must stay that way.

## 11. Before/after documentation requirements

For any future phase that implements changes based on this plan:
- Record baseline measurements (per the checklist) **before** any code
  change, committed to this `project-quality/performance/` folder.
- Record the same measurements **after** the change, using the identical
  method/scenario/data as the baseline.
- Document exactly which files/functions changed and why, referencing the
  finding IDs from `PERFORMANCE_INSPECTION_SUMMARY.md` they address.
- State explicitly, with evidence, that API behavior, permissions, returned
  data shape, business rules, and the allocation algorithm were verified
  unchanged (tests + manual smoke check).
- Actual results belong in `PERFORMANCE_OPTIMIZATION_RESULTS.md`, not in
  this plan file, and not in this current inspection phase.