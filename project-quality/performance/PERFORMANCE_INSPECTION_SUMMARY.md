# Performance Inspection Summary

## Branch
`donia-performance-optimization`

## Scope

This inspection covers the **Buildings page/API** only: the React
`BuildingsPage`, the frontend API helpers it calls, the Django URL routing,
ViewSets, serializers, and models involved in serving buildings,
apartments, rooms, and beds, plus existing tests that already cover this
area or a directly analogous one (Students page performance).

**Intentionally not changed:** Django views, serializers, models,
migrations, React code, Docker configuration, dependencies, database data,
and the allocation algorithm. This is a read-only inspection phase; the
only files written are this one and
`project-quality/performance/PERFORMANCE_OPTIMIZATION_PLAN.md`.

## Files Inspected

Frontend:
- `src/pages/BuildingsPage.js` — the Buildings page itself; owns all data
  loading (region/dorm-type/building/apartment/room/bed selection state)
  and every API call fired when the page opens or the selection changes.
- `src/services/api.js` — `dormInventoryAPI` (buildings/apartments/rooms/
  beds CRUD + reads), `whatIfAPI` (availability simulate/confirm, used by
  the deactivate dialog), and the plain `api`/`regionsAPI` calls used on
  mount.

Backend routing/views:
- `backend/api/urls.py` — confirms `/api/buildings/`, `/api/apartments/`,
  `/api/rooms/`, `/api/beds/`, `/api/regions/`, `/api/dorm-types/` all route
  through `DefaultRouter` to the corresponding `ViewSet`.
- `backend/api/views.py` — `RegionViewSet` (L659), `DormTypeViewSet`
  (L675), `_parse_is_active_filter` (L691), `BuildingViewSet` (L716),
  `ApartmentViewSet` (L1052), `RoomViewSet` (L1159), `BedViewSet` (L1246),
  and `StudentViewSet`/`StudentRequestViewSet` (L1310, L2836) only for
  comparison (they *do* paginate; the inventory viewsets do not).

Backend serialization:
- `backend/api/serializers.py` — `RegionSerializer` (L120),
  `DormTypeSerializer` (L126/L195, defined twice — see note below),
  `BuildingSerializer` (L363), `ApartmentSerializer` (L415),
  `RoomSerializer` (L470), `BedSerializer` (L515), and the
  `check_*_write_conflict` helpers (L239-L360) which run extra queries on
  writes only (not relevant to page-open reads, noted for completeness).

Backend models:
- `backend/api/models.py` — `Building` (L163), `Apartment` (L204), `Room`
  (L263, including `current_occupancy`/`is_full`/`available_beds`
  properties at L323-L349), `Bed` (L351, including `is_occupied` at
  L368-L370), `BedAssignment` (L590, including its `Meta.constraints`).

Tests:
- `backend/api/tests_inventory.py` (1032 lines) — permission and
  business-rule tests for building/apartment/room/bed create/update/
  deactivate flows. No query-count or response-time assertions.
- `backend/api/tests_students_performance.py` (167 lines) — **not** about
  Buildings, but directly relevant: it is the team's existing pattern for
  proving/fixing an N+1 problem on another list page (Students), using
  `django.test.utils.CaptureQueriesContext` to assert a flat, small query
  count regardless of row count. This is the template baseline tests for
  Buildings should follow.

## Buildings Page Request Flow

1. **React mounts `BuildingsPage`** → `useEffect` init
   (`BuildingsPage.js:764`) calls `loadRegionsAndDormTypes()`
   (`BuildingsPage.js:653`), which fires `Promise.all([api.get('/api/regions/'),
   api.get('/api/dorm-types/')])` — 2 parallel requests.
2. Once a region is resolved, `loadBuildings(regionId)`
   (`BuildingsPage.js:660`) calls `dormInventoryAPI.getBuildings({region,
   is_active:'all'})` (`api.js:883`) → `GET /api/buildings/?region=...&is_active=all`.
3. **Django URL** `/api/buildings/` (`urls.py:12`, router) → **View**
   `BuildingViewSet` (`views.py:716`), default `ModelViewSet.list()` (not
   overridden) → **queryset** `BuildingViewSet.get_queryset()`
   (`views.py:725`): `Building.objects.select_related('dorm_type',
   'dorm_type__region')`, filtered by `is_active` and by region/user scope.
   No pagination — every matching row is returned in one response.
4. **Serializer**: each `Building` instance in the queryset is passed
   through `BuildingSerializer` (`serializers.py:363`). Its declared FK
   fields (`dorm_type_name`, `region`, `region_name`, etc.) are covered by
   the `select_related` above, but its five computed fields
   (`apartment_count`, `room_count`, `bed_count`, `occupied_beds`,
   `free_beds`) are `SerializerMethodField`s that each run their **own**
   query against `Apartment`/`Room`/`Bed`/`BedAssignment` — see Finding
   BLD-01.
5. **Response**: a plain JSON array (or `{results: [...]}`—shape depends on
   DRF defaults; no custom pagination wrapper) of building objects reaches
   `dormInventoryAPI.getBuildings`, which returns `data` unchanged to
   `BuildingsPage`, which stores it via `setBuildings(asArray(data))`.
6. **User selects a building** → `selectBuilding` (`BuildingsPage.js:693`)
   fires `Promise.all([getApartments({building, is_active:'all'}),
   getRooms({building, is_active:'all'})])` in parallel. Each follows the
   same URL → View → queryset → serializer → response path as buildings,
   through `ApartmentViewSet`/`RoomViewSet` and
   `ApartmentSerializer`/`RoomSerializer` — see Findings BLD-02, BLD-03.
7. **User selects a room** → `selectRoom` (`BuildingsPage.js:724`) fires
   `getBeds({room: id})` → `BedViewSet` → `BedSerializer` — see Finding
   BLD-04.

## Confirmed Findings

### BLD-01 — `BuildingSerializer`: N+1 queries + duplicated computation per row
- **Severity:** High
- **File:** `backend/api/serializers.py:363-412`
- **Functions:** `BuildingSerializer.get_apartment_count`,
  `.get_room_count`, `.get_bed_count`, `.get_occupied_beds`,
  `.get_free_beds`
- **What the code does:** All five are `SerializerMethodField`s. For every
  `Building` instance serialized, DRF calls each method individually:
  - `get_apartment_count` → `obj.apartments.filter(is_active=True).count()`
  - `get_room_count` → `Room.objects.filter(apartment__building=obj, ...).count()`
  - `get_bed_count` → `Bed.objects.filter(room__apartment__building=obj, ...).count()`
  - `get_occupied_beds` → `BedAssignment.objects.filter(bed__room__apartment__building=obj, status=ACTIVE).values('bed_id').distinct().count()`
  - `get_free_beds` → calls `self.get_bed_count(obj)` **and**
    `self.get_occupied_beds(obj)` again, re-running both of the above
    queries a second time.
- **Why this can cause slowness:** Each is a separate round trip to the
  database. None of this is covered by the `select_related('dorm_type',
  'dorm_type__region')` on the queryset (`views.py:726`), because these are
  reverse-relation aggregate counts, not forward FK lookups —
  `select_related` cannot help here; only `annotate()` at the queryset
  level or a `prefetch_related` + Python-side count could avoid the
  per-row queries.
- **Type of overhead:** N+1 queries (4 queries × N buildings) **plus**
  duplicated computation (`bed_count` and `occupied_beds` each computed
  twice per row) → effectively 6 queries per building row for a `GET
  /api/buildings/` response with N buildings, on top of the 1 list query.
- **Evidence:** Read directly from `serializers.py:397-412`; no
  `annotate()`/`Count()` anywhere in `BuildingViewSet.get_queryset()`
  (`views.py:725-752`) or `BuildingSerializer`.
- **Where it fires from the page:** Every `loadBuildings()` call —
  page mount, region change, and every "Refresh" click
  (`BuildingsPage.js:660, 748`).

### BLD-02 — `ApartmentSerializer`: same N+1 + duplication pattern
- **Severity:** High
- **File:** `backend/api/serializers.py:415-467`
- **Functions:** `ApartmentSerializer.get_actual_room_count`,
  `.get_bed_count`, `.get_occupied_beds`, `.get_free_beds`
- **What the code does:** Identical shape to BLD-01 one level down the
  hierarchy: `get_actual_room_count` queries `Room`, `get_bed_count`
  queries `Bed`, `get_occupied_beds` queries `BedAssignment`, and
  `get_free_beds` (`serializers.py:466`) calls `get_bed_count`/
  `get_occupied_beds` a second time each.
- **Why this can cause slowness:** Same as BLD-01 — one query per computed
  field per apartment row, doubled for two of the four fields.
- **Type of overhead:** N+1 queries + duplicated computation → ~5 queries
  per apartment row for a `GET /api/apartments/?building=X` response with N
  apartments.
- **Evidence:** `serializers.py:455-467`; `ApartmentViewSet.get_queryset()`
  (`views.py:1057-1090`) has `select_related` for the building/dorm_type/
  region FK chain only, nothing that would cover these aggregate counts.
- **Where it fires from the page:** Every building selection
  (`selectBuilding`, `BuildingsPage.js:704`) and every refresh while a
  building is selected (`refreshCurrentScope`, `BuildingsPage.js:751`).

### BLD-03 — `RoomSerializer` + `Room` model properties: multiple duplicate per-row queries
- **Severity:** High
- **Files:** `backend/api/serializers.py:470-512`,
  `backend/api/models.py:323-349`
- **Functions:** `RoomSerializer` fields `current_occupancy`,
  `available_beds`, `is_full`, `get_bed_count`,
  `get_has_missing_bed_records`; `Room.current_occupancy`, `Room.is_full`,
  `Room.available_beds` properties.
- **What the code does:**
  - `current_occupancy` (serializer field, `IntegerField(read_only=True)`
    sourced from the model property at `models.py:323-328`) runs 1 query
    (`BedAssignment.objects.filter(bed__room=self, status=ACTIVE).count()`).
  - `available_beds` (serializer field, sourced from the model property at
    `models.py:337-349`) runs 2 queries: a `BedAssignment` distinct count
    (structurally identical to the one above, but computed independently)
    plus `self.beds.count()`.
  - `is_full` (serializer field, sourced from `models.py:330-335`) calls
    `self.available_beds` again internally — re-running **both** queries
    from the previous bullet a second time.
  - `get_bed_count` (`serializers.py:504`) calls `obj.beds.count()` again —
    a third independent count of the same bed rows.
  - `get_has_missing_bed_records` (`serializers.py:507`) calls
    `obj.beds.count()` a **fourth** time.
- **Why this can cause slowness:** Up to 7 separate queries per room row,
  where the underlying data (active-assignment count, total bed count) is
  really only 2 distinct pieces of information, each recomputed 2-4 times.
- **Type of overhead:** N+1 queries + heavy duplicated computation.
- **Evidence:** Directly readable in `serializers.py:477-512` and the
  properties it sources from in `models.py:323-349`; no caching,
  `annotate()`, or memoization anywhere in the chain.
- **Where it fires from the page:** Every building selection (`getRooms`
  call in `selectBuilding`, `BuildingsPage.js:706`) and every refresh.

### BLD-04 — `BedSerializer.is_occupied`: uncovered per-row query
- **Severity:** Medium
- **Files:** `backend/api/serializers.py:527`,
  `backend/api/models.py:368-370`
- **What the code does:** `is_occupied` is a plain `BooleanField(read_only=True)`
  sourced from the `Bed.is_occupied` property, which runs
  `self.assignments.filter(status=ACTIVE).exists()` — one query per bed.
- **Why this can cause slowness:** `BedViewSet.get_queryset()`
  (`views.py:1259-1266`) has a `select_related` chain covering `room` and
  its ancestors (forward FKs), but `assignments` is a **reverse** FK from
  `Bed` to `BedAssignment` — `select_related` cannot cover it; it would
  need `prefetch_related` or an annotation.
- **Type of overhead:** N+1 queries, one per bed row.
- **Evidence:** `serializers.py:515-540`, `models.py:368-370`.
- **Why Medium and not High:** `GET /api/beds/?room=X` is scoped to a
  single room's beds (bounded by room capacity, typically small), so the
  row count N is much smaller here than for buildings/apartments/rooms
  lists. Still a genuine N+1 pattern.
- **Where it fires from the page:** Every room selection (`selectRoom`,
  `BuildingsPage.js:735`).

### BLD-05 — No pagination on inventory list endpoints
- **Severity:** Medium
- **File:** `backend/api/views.py` — `BuildingViewSet` (L716),
  `ApartmentViewSet` (L1052), `RoomViewSet` (L1159), `BedViewSet` (L1246)
- **What the code does:** None of these four `ModelViewSet`s set a
  `pagination_class`, and `REST_FRAMEWORK` in
  `backend/dormify/settings.py` (L121-128) has no
  `DEFAULT_PAGINATION_CLASS`. `list()` is not overridden on any of them, so
  DRF's default (unpaginated) behavior applies: every row matching the
  queryset filters is serialized and returned in one response.
- **Contrast:** `StudentViewSet` (`views.py:1310`) and
  `StudentRequestViewSet` (`views.py:2836`) both explicitly set
  `pagination_class = StandardResultsPagination` — a precedent already
  exists in this codebase for paginating a list endpoint that was
  previously unbounded (see `tests_students_performance.py`, which tests
  exactly this).
- **Why this can cause slowness:** Combined with BLD-01/02/03/04, response
  time and query count for these endpoints scale with the **total**
  building/apartment/room/bed count in the requested scope (a whole
  region), not with what is actually rendered on screen at once.
- **Type of overhead:** Unbounded/unnecessary data loading; large response
  payloads at scale.
- **Evidence:** Absence of `pagination_class` on the four viewsets, vs. its
  explicit presence on the two Student-related viewsets, in the same file.

## Hypotheses Requiring Measurement

None of the following are confirmed by this code inspection — they require
actual measurement against realistic data before being treated as
problems:

- **Actual response time** of `/api/buildings/`, `/api/apartments/`,
  `/api/rooms/`, `/api/beds/` under current production-like data volume.
- **Actual SQL query count** per request (the counts in the findings above
  are derived from reading the code, not from running it — they should be
  confirmed with `CaptureQueriesContext` or equivalent, per building/
  apartment/room count actually present).
- **Duplicate SQL query count** — how many of the counted queries are
  byte-for-byte identical (e.g., the `beds.count()` called 3-4 times per
  room in BLD-03) versus merely similar.
- **Database vs. serialization time split** — how much of total latency is
  spent executing SQL vs. Python-side serialization/looping.
- **Azure/network latency** — not inspected; no evidence for or against it
  contributing.
- **Database connection overhead** — not inspected.
- **Frontend render time** — `BuildingsPage.js` state management was read
  but not profiled in a running browser.
- **Actual response payload size** for each endpoint at current data
  volume.
- **Whether slowness is uniform or concentrated** in specific regions/
  buildings with unusually large inventory.

## Existing Tests Relevant to This Work

- `backend/api/tests_inventory.py` (1032 lines): covers create/update
  permissions (boss vs. employee vs. cross-region), duplicate-number
  rejection, capacity-vs-occupancy conflict checks, the availability
  ("what-if") deactivate/reactivate workflow and its impact-report
  behavior, and bulk inventory creation. **Protects:** permissions, region
  isolation, and business rules for buildings/apartments/rooms/beds. Does
  **not** assert anything about query count, response time, or payload
  size — a future optimization must keep every one of these tests passing
  unchanged.
- `backend/api/tests_students_performance.py` (167 lines): not about
  Buildings, but the direct precedent for this kind of work. In
  particular `test_students_list_query_count_is_flat`
  (`tests_students_performance.py:86-96`) uses
  `django.test.utils.CaptureQueriesContext` to assert the students list
  stays under a fixed query-count ceiling regardless of row count, with an
  explicit comment that the *old* code issued one extra query per student.
  This is the template a Buildings-page query-count test should follow.

No test file currently exercises `/api/buildings/`, `/api/apartments/`,
`/api/rooms/`, or `/api/beds/` for query count, response time, or payload
size.

## Baseline Measurements Required Before Optimization

Checklist to run against realistic current data, **before** any code
change, for each of `/api/buildings/`, `/api/apartments/`, `/api/rooms/`,
`/api/beds/`:

- [ ] Endpoint response time (server-side, e.g. via Django logging or
      `time.perf_counter()` around the view, and client-side via browser
      devtools Network tab).
- [ ] SQL query count per request (`CaptureQueriesContext` in a test, or
      `django-debug-toolbar` against a running server with realistic data).
- [ ] Duplicate SQL query count — how many of those queries are identical
      (structure + parameters) to another query in the same request.
- [ ] Response payload size (bytes) for each endpoint's response body.
- [ ] Full list of APIs actually called when opening the Buildings page in
      the browser (Network tab trace of: page load → select a building →
      select a room), to confirm the flow documented above matches reality.
- [ ] Frontend page-load timing (time from navigation to
      `BuildingsPage` to buildings list rendered) via browser devtools.
- [ ] Split of total endpoint time between DB/query time and
      Python/serialization time (e.g., via Django's query timing in debug
      mode, or wrapping the queryset execution vs. serializer `.data` call).
- [ ] All of the above measured against the **current real data volume**
      (actual building/apartment/room/bed counts per region in the
      environment being tested), not a trivial/empty dataset — the N+1
      findings above only matter at scale.

## Recommended First Optimization

**Not implemented in this phase.** Based on the inspection:

- **Exact code area:** `BuildingSerializer` in
  `backend/api/serializers.py:363-412`, specifically its five
  `SerializerMethodField`s, paired with `BuildingViewSet.get_queryset()` in
  `backend/api/views.py:725-752`.
- **Why it should be first:** It is the first and heaviest query load on
  every single Buildings-page open (page mount, not gated behind any user
  action), it has the clearest N+1 shape of all four findings, and it has
  the most duplicated computation relative to its field count
  (`get_free_beds` alone doubles two of the five fields). Fixing it via
  queryset-level `annotate()` would collapse ~6 queries/row down to 0
  extra queries/row (all counts computed in the single list query),
  independent of how many buildings are in scope.
- **What behavior must remain unchanged:** The exact JSON field names and
  values currently returned (`apartment_count`, `room_count`, `bed_count`,
  `occupied_beds`, `free_beds` must mean exactly what they mean today —
  same `is_active` filtering semantics on apartments/rooms/beds, same
  "distinct bed" counting for `occupied_beds`); all permission/region
  scoping in `get_queryset()`; the `is_active`/`region` query-param
  filtering behavior; every existing test in `tests_inventory.py`.
- **How to verify afterward:** Re-run the same baseline measurement
  (query count via `CaptureQueriesContext`, response time, payload size)
  against the same data and confirm query count drops and stays flat as
  building count grows; run the full `tests_inventory.py` suite unchanged;
  add a new query-count-ceiling test modeled on
  `test_students_list_query_count_is_flat`; manually verify the Buildings
  page renders identical numbers before/after.

## Risks / Things Not To Change

- **Permissions** — the `is_central_admin` / `is_boss` / region-boss /
  employee branching in every `get_queryset()` and every `create`/`update`
  override must not change.
- **Role behavior** — who can create/edit buildings, apartments, rooms,
  and bed labels (boss-only for writes; view-only for others) must not
  change.
- **Region/data isolation** — the `dorm_type__region` filtering that scopes
  non-central-admin users to their own region (in all four inventory
  viewsets) must not change or weaken.
- **API response contract** — field names, types, and semantics returned by
  `/api/buildings/`, `/api/apartments/`, `/api/rooms/`, `/api/beds/` must
  not change unless a future change is explicitly proposed and separately
  approved.
- **Business rules** — the availability ("what-if") workflow gating direct
  `is_active` edits, the occupancy-vs-capacity conflict checks, the
  gender-restriction/category conflict checks in
  `check_building_write_conflict`/`check_apartment_write_conflict`/
  `check_room_write_conflict` (`serializers.py:239-360`) must not change.
- **Allocation algorithm** — nothing under `backend/allocation/` is in
  scope for this work and it must not be touched.
- **Database data** — no data changes of any kind in this phase or as a
  side effect of a future optimization.
- **Migrations** — none expected for a query-optimization fix (annotate/
  prefetch changes don't require schema changes); if a future phase
  believes a migration (e.g., an index) is genuinely needed, that must be
  proposed and separately approved, not bundled silently into a query fix.

## Next Step

Collect the baseline measurements listed above (query count, response
time, payload size, full API trace, frontend load timing) against the
current real data volume for `/api/buildings/`, `/api/apartments/`,
`/api/rooms/`, `/api/beds/`, and record the results in
`PERFORMANCE_OPTIMIZATION_RESULTS.md`. Only after that baseline exists
should any optimization from § "Recommended First Optimization" be
implemented, on a scoped follow-up branch, verified against the same
baseline method.