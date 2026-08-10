# BLD-05 — Pagination Analysis Summary

Prepared for external AI review. This is **analysis only** — no pagination
was implemented, no API contracts or settings were changed. Covers
`GET /api/buildings/`, `/api/apartments/`, `/api/rooms/`, `/api/beds/`
(the four endpoints already optimized for query count in BLD-01–04).

## Classification

## **NOT CURRENTLY NECESSARY**

(with an explicit note on what would change this — see "What would flip
this classification" below)

## Why

Three independent lines of evidence, each sufficient on its own, converge
on the same conclusion:

1. **The performance driver pagination would address (N+1 query scaling)
   is already fixed.** BLD-01–04 closed the query-count-scales-with-N
   problem for all four endpoints — query count is now flat (1-2 queries)
   regardless of how many rows are returned. Pagination's main
   traditional justification in this codebase — bounding *database* work
   per request — no longer applies here the way it did before this
   session.
2. **Measured response payload sizes are small at every N tested, and
   stay small under realistic extrapolation** (see "Payload growth"
   below).
3. **The frontend currently depends on receiving the *complete* list per
   request** for client-side search, filtering, and summary-metric
   calculation. Introducing pagination without a coordinated frontend
   change would not fail loudly — it would silently truncate data (see
   "Frontend consumption" below), which is a worse outcome than "no
   pagination yet."

## Endpoint result-size analysis (from BLD-01–04 measured evidence)

All figures are from this session's own `CaptureQueriesContext` +
`len(response.content)` measurements (`project-quality/performance/evidence/*_QUERY_COUNTS.txt`),
against the local disposable test database — not real Azure data (no real
production row counts were available to measure; see "Limitations"
below).

| Endpoint | N | Response bytes | Bytes/row (approx) |
|---|---:|---:|---:|
| `/api/buildings/` | 1 | 294 | — |
| `/api/buildings/` | 5 | 1,461 | ~294 |
| `/api/buildings/` | 25 | 7,342 | ~294 |
| `/api/apartments/` | 1 | 470 | — |
| `/api/apartments/` | 5 | 2,341 | ~470 |
| `/api/apartments/` | 25 | 11,742 | ~470 |
| `/api/rooms/` | 1 | 283 | — |
| `/api/rooms/` | 5 | 1,411 | ~283 |
| `/api/rooms/` | 25 | 7,083 | ~283 |
| `/api/beds/` | 1 | 115 | — |
| `/api/beds/` | 10 | 1,137 | ~114 |
| `/api/beds/` | 50 | 5,717 | ~114 |

Per-row byte cost is stable across N for every endpoint (as expected for a
flat JSON array of similarly-shaped objects) — roughly 294B/building,
470B/apartment, 283B/room, 114B/bed.

### Payload growth (extrapolated from the stable per-row costs above — not separately measured)

| Endpoint | 100 rows | 500 rows | 1,000 rows |
|---|---:|---:|---:|
| Buildings | ~29 KB | ~147 KB | ~294 KB |
| Apartments | ~47 KB | ~235 KB | ~470 KB |
| Rooms | ~28 KB | ~142 KB | ~283 KB |
| Beds | ~11 KB | ~57 KB | ~114 KB |

Even at 500-1,000 rows — a count far larger than a single `GET
/api/buildings/?region=X` or `GET /api/apartments/?building=X` call would
realistically return for one region/building in a university dormitory
system — payloads stay in the tens-to-low-hundreds of KB range, well
within what a modern browser/JSON parser handles without perceptible
delay. This is a projection from measured per-row cost, not a
measurement of real large-N behavior — flagged as a limitation below.

## Realistic likely row counts (not measured — reasoning only)

Not measured against real data (no real-data access in this phase, per
scope). Reasoning from the domain: `/api/buildings/` is scoped to one
**region**, `/api/apartments/`/`/api/rooms/` to one **building**,
`/api/beds/` to one **room**. A university dormitory region plausibly has
low tens to low hundreds of buildings; a single building plausibly has
tens of apartments; a single apartment plausibly has a handful of rooms; a
single room plausibly has 1-6 beds (dorm rooms are rarely larger). None of
these scopes obviously reach the 500-1,000-row range used in the
extrapolation table above within one API call. This reasoning is
explicitly **not** a substitute for measuring real production data — see
"What would flip this classification."

## Frontend consumption analysis

### `asArray()` helper (`src/pages/BuildingsPage.js`)

```javascript
function asArray(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (key && Array.isArray(payload?.[key])) return payload[key];
  return [];
}
```

**Notable finding:** this helper already tolerates DRF's paginated
response shape (`{count, next, previous, results: [...]}`) without
throwing — it falls through to `payload.results` when `payload` isn't a
bare array. So turning on `pagination_class` on these four viewsets would
**not crash the frontend** or produce a visible error.

### But the frontend does not fetch subsequent pages, and depends on the full list

`asArray()` only ever reads the **first** page's `results` — none of
`loadBuildings`, `selectBuilding` (which fetches apartments and rooms),
or `selectRoom` (which fetches beds) reads `next`, requests further pages,
or accumulates results across pages. Everywhere these lists are then
used, the code assumes it already has the *complete* set:

- `filteredBuildings` (`useMemo`, `BuildingsPage.js`) filters the full
  `buildings` array client-side by dorm type, active/inactive status, and
  a free-text search box (`b.number`, `b.dorm_type_name`,
  `b.region_name`) — a search that only works region-wide if every
  building in the region is already in memory.
- `summaryMetrics` (`useMemo`) sums `apartment_count`/`room_count`/
  `bed_count`/`occupied_beds`/`free_beds` across the *entire* `buildings`
  array to show the region-level summary strip at the top of the page —
  this total would silently become "total of page 1 only" under
  pagination.
- `apartmentsForSelectedBuilding` / `roomsForSelectedApartment` similarly
  filter the full `buildingApartments`/`buildingRooms` arrays client-side
  by search text and by `selectedApartmentId`.

**Conclusion:** enabling pagination on these four endpoints today, with
no other change, would not error — it would silently show only the first
25 (or whatever page size) buildings/apartments/rooms/beds, with search,
filtering, and summary totals all silently computed over that truncated
subset instead of the real complete set. That is a **functional
regression that looks like correct behavior**, which is worse than doing
nothing. This is the primary reason pagination is not recommended as a
drop-in change right now, independent of the performance question.

### If pagination were pursued later

It would need to be a coordinated change, not just
`pagination_class = StandardResultsPagination` on the four viewsets:
either (a) move search/filter/summary computation server-side (like
`StudentViewSet` already does, per its `?search=` param and
`StandardResultsPagination`), with the frontend switched to
paginated fetch-as-you-scroll/paged-table UI, or (b) keep "fetch
everything for this scope" semantics but bound it more cheaply some other
way (e.g. a lighter summary-only endpoint for the totals strip, with full
detail loaded lazily). Both are frontend-contract changes, explicitly out
of scope for this backend-only performance session.

## Whether existing `asArray`/helper logic can handle pagination

**Partially.** It can safely *unwrap* one page's `results` without
throwing, but it has no concept of "there are more pages" — so it cannot,
on its own, correctly handle a paginated response for any code path that
needs the complete list (which is every code path in `BuildingsPage.js`
today, per the analysis above).

## Whether pagination would materially improve performance after the N+1 fixes

**Not materially, at currently-known/assumed scale.** The N+1 fixes
(BLD-01–04) already made query count flat and independent of row count —
that was the dominant, measured cost. What's left is JSON payload
size/transfer/parse time, and the measured-and-extrapolated numbers above
suggest that stays modest (tens of KB) well past any row count this
domain plausibly produces per single-region/single-building/single-room
API call. Pagination would reduce payload size further, but at a real
frontend-behavior cost (see above) that is not currently justified by any
measured or reasoned evidence of a payload problem.

## What would flip this classification

This should be re-classified as **RECOMMENDED LATER** (or **NEEDS
REAL-DATA MEASUREMENT** run first) if any of the following becomes true:

- Real production data shows a region with buildings numbering in the
  many hundreds, a building with apartments numbering in the hundreds, or
  similar — none of which was measured in this phase (no real-data access
  in scope).
- Product requirements change such that the Buildings page needs to
  support browsing many more buildings/apartments/rooms than today's
  UI implies.
- A future decision to move search/filtering server-side for other
  reasons (e.g. matching the `StudentViewSet` pattern) makes pagination a
  natural side effect rather than a standalone, frontend-risking change.

## Measurement-only artifacts used for this analysis

No new tests were written for this analysis — it draws entirely on the
already-collected, already-committed-to-evidence measurements from
BLD-01–04:

- `project-quality/performance/evidence/BUILDINGS_BASELINE_QUERY_COUNTS.txt` / `BUILDINGS_AFTER_QUERY_COUNTS.txt`
- `project-quality/performance/evidence/APARTMENTS_BASELINE_QUERY_COUNTS.txt` / `APARTMENTS_AFTER_QUERY_COUNTS.txt`
- `project-quality/performance/evidence/ROOMS_BASELINE_QUERY_COUNTS.txt` / `ROOMS_AFTER_QUERY_COUNTS.txt`
- `project-quality/performance/evidence/BEDS_BASELINE_QUERY_COUNTS.txt` / `BEDS_AFTER_QUERY_COUNTS.txt`

## Limitations

- **No real production data was measured or accessed.** Row-count
  reasoning above is domain reasoning, not measurement — explicitly
  flagged, not presented as fact.
- **No real network/Azure transfer time was measured** for any payload
  size — the KB estimates above are payload *size*, not transfer *time*.
- **No frontend render-time measurement** of how the client-side
  filter/search logic performs against a large in-memory array.
- Payload-growth figures beyond N=25/50 are linear extrapolation from
  measured per-row cost, not directly measured at those larger N.

## Recommendation

Do not implement pagination on `/api/buildings/`, `/api/apartments/`,
`/api/rooms/`, or `/api/beds/` at this time. If real production data
volume is ever measured and shows row counts materially larger than
assumed here, revisit this analysis as a scoped, separately-approved
follow-up that includes the necessary frontend changes (not a
backend-only flip of `pagination_class`).
