# Dormify — Data Analysis Page Redesign Report

Branch: `donia-data-analysis-fix` · Route: `/analysis` · Component: `src/pages/AnalysisPage.js`

This report documents a full audit-then-redesign of the Data Analysis page: a small,
additive backend extension to `GET /api/analysis/`, and a ground-up frontend rebuild
into a tabbed, filterable, bilingual operational dashboard built from 13 new
reusable components. **No commit, push, merge, branch switch, or database write was
performed at any point.**

---

## 1. Implementation Summary

The original `/analysis` page was a single 1,044-line file rendering every KPI,
insight, chart, and the building table in one long flat scroll, with a home-grown
`t = { he: {...}, en: {...} }[language]` translation object (the project's existing
i18n convention — there is no `react-i18next`/`i18next` anywhere in this codebase).

The redesign keeps that exact i18n convention (translation now lives in a dedicated
module, still a plain object, still selected by the same `language` prop already
threaded through the whole app from `App.js`) and restructures the page into:

1. A compact header (title, context chips, refresh, export).
2. A global filter bar (region + free-text search, active-filter chips, reset).
3. Six executive KPI cards, each with a real definition tooltip and a status color.
4. A ranked, rule-based "Issues Requiring Attention" panel with working drill-downs.
5. An accessible tab strip (Overview / Occupancy & Capacity / Allocation / Special
   Requests / Student Groups) — only tabs backed by real data exist.
6. A single always-visible, always-connected Building Analytics Table beneath the
   tabs (search, region/status filters, sortable columns, pagination, client-side
   filtered Excel export).
7. A compact "Recent Data Sources" freshness strip.

Every number on the page comes from `GET /api/analysis/`. No mock data, no invented
history, no invented targets were introduced anywhere.

---

## 2. Files Added, Modified, Deleted

### Backend (modified, no new files, no migrations)

| File | Change |
|---|---|
| `backend/api/views.py` | `analysis_data()` extended, additively, with 4 new top-level response fields (see §4). No existing field renamed, removed, or changed in meaning. `recent_runs` is a hand-built minimal representation, not the full `AllocationRunSerializer` (see §4/§6 of the correction log, §21). |
| `backend/api/tests_analysis.py` | **4 new `TestCase` classes, 15 new test methods** covering the new fields, region-fallback logic, permission scoping, and PII minimization. Existing 12 tests (3 classes) untouched. File now totals 7 classes / 27 methods. |

### Frontend

| File | Status |
|---|---|
| `src/pages/AnalysisPage.js` | **Rewritten** (orchestrator only now — state, data fetching, drill-down wiring, the page's single `<style>` stylesheet). |
| `src/components/analysis/analysisUtils.js` | **New** — pure formulas, thresholds, status classification, issue-detection engine, region aggregation. No JSX. |
| `src/components/analysis/analysisTranslations.js` | **New** — the full `{ he, en }` string table. |
| `src/components/analysis/AnalysisPrimitives.js` | **New** — `MetricCard`, `MetricDefinitionTooltip`, `ChartCard`, `StatusBadge`, `SeverityBadge`, `ActiveFilters`, `AllocationProgressBar`, `ExportButton`, `AnalysisLoadingState`, `AnalysisErrorState`, `AnalysisEmptyState`. |
| `src/components/analysis/AnalysisHeader.js` | **New** |
| `src/components/analysis/AnalysisFilterBar.js` | **New** |
| `src/components/analysis/AttentionIssuesPanel.js` | **New** |
| `src/components/analysis/AnalysisTabs.js` | **New** — WAI-ARIA tabs pattern. |
| `src/components/analysis/RegionPressureCharts.js` | **New** — `CapacityDemandChart`, `AllocationStatusChart`, `CapacityPressureScatter`. |
| `src/components/analysis/OccupancyRankingChart.js` | **New** |
| `src/components/analysis/StudentGroupsChart.js` | **New** — adapted from the original inline "distribution" section. |
| `src/components/analysis/SpecialRequestsPanel.js` | **New** |
| `src/components/analysis/BuildingAnalyticsTable.js` | **New** |
| `src/components/analysis/DataFreshnessPanel.js` | **New** |

Nothing else was touched: `App.js`, `src/services/api.js`, `AuthContext.js`, the
sidebar/header shell, and every other page are unchanged. `.env` was **not** opened
or modified (only viewed by the user in their own IDE, per the system reminder).

---

## 3. Design Changes (what actually changed and why)

- **Vertical hierarchy fixed.** Old order: hero header → filters → KPIs → insights →
  one allocation-performance block → one occupancy chart → one distribution chart →
  table → recent sources. New order matches the requested hierarchy: compact
  header+filters → KPIs → issues → tabs (exploration) → **one** persistent table →
  freshness. The table is reachable from every tab via one scroll, not "pushed to
  the bottom of a mile-long page."
- **One long page → tabs.** Occupancy, Allocation, Special Requests and Student
  Groups analytics used to all render at once. They're now behind an accessible
  tab strip; Overview shows only the two most important views (capacity-vs-demand,
  top-building ranking).
- **Passive insight cards → ranked, actionable issue list.** Every issue now carries
  a 4-level severity (Critical/High/Medium/Informational), a badge (not color
  alone), and — where a destination exists — a working click action (route
  navigation, region filter + tab switch, or table filter + scroll-to-table).
- **KPI cards gained context and status color**, not just a number: each has a
  real secondary line ("714 of 1,097 students allocated"), a real definition
  tooltip, and a status derived from the same thresholds used everywhere else
  (never "green because positive").
- **Chart-to-table drill-down** is now real: clicking a region bar in the
  capacity/demand or allocation-status charts applies the region filter (for
  central admins) and scrolls to the table; clicking a building bar sets the
  table's search box to that building and scrolls to it; a "buildings with free
  capacity, zero occupants" issue jumps straight into the matching table filter.
- **Chart-type corrections**: a scatter for capacity-pressure (was absent), a true
  100%-stacked bar for allocation status by region (was absent), a grouped
  horizontal bar for capacity-vs-demand (was absent) — replacing what used to be
  a single "occupancy by region/building" bar as the *only* chart on the page.
- **RTL/LTR isolation for charts**: every chart is wrapped in an explicit
  `dir="ltr"` box so numeric axes can never be mirrored by the page's RTL
  direction, while category labels (building/region names) still render in
  whichever language is active.

---

## 4. Backend API Fields and Calculations

`GET /api/analysis/` (unchanged path/params: optional `?region=<id>`, central-admin
only). All pre-existing response fields are **unchanged**. New, additive fields:

| Field | Shape | Formula |
|---|---|---|
| `students_by_region[].assigned` | int | Count of students in that region (same region-resolution chain as the pre-existing `region`/`count` fields) with an id in the active `BedAssignment` set. |
| `students_by_region[].waiting` | int | `count - assigned` for that region, computed directly (not subtracted) while iterating students once. |
| `requests_by_type` | `[{request_type, count}]` | **PENDING requests only.** `pending_requests_qs.values('request_type').annotate(count=Count('id'))`, where `pending_requests_qs` re-filters the already region-scoped `requests_qs` to `status=PENDING` explicitly (never inherited implicitly). |
| `requests_by_region` | `[{region, count}]` | **PENDING requests only**, grouped by an *attributed* region (best-available evidence, not a verified operational region — see below): `source_region.name` → else the student's `accepted_dorm_type.region.name` → else `requested_by.region.name` (last resort) → else the request is skipped (never a fabricated "unknown" bucket, but still counted in `pending_requests`/`requests_by_type`). |
| `oldest_pending_request_created_at` | ISO datetime or `null` | `min(created_at)` over the same `pending_requests_qs`. |
| `recent_runs` | `[{id, region, region_name, status, successful_assignments, started_at, completed_at}]`, ≤5 | A **minimal, hand-built** representation (not the full `AllocationRunSerializer`) built from the same region-scoped `runs_qs` already used for `latest_run`, ordered `-started_at`, sliced to 5. Excludes `run_by`/`run_by_name` (a staff member's identity), `error_message` (free-text internal diagnostics), and `students_processed`/`roommate_matches`/`conflicts` (unused by the UI) — see §5's PII-minimization note. `latest_run` is unaffected and keeps the full serializer shape for backward compatibility. |

**Why `assigned`/`waiting` per region, not per building:** a `Student` only has a
*region* before assignment (via `accepted_dorm_type`), never a specific building —
so "waiting demand" can only be computed truthfully at region granularity. This
is why the Occupancy Ranking chart's view-mode toggle deliberately excludes a
"highest waiting demand" / "largest shortage" per-building option — that would
require inventing a number the data model doesn't support. For the same reason,
the building-status value previously called "No active demand" was **renamed to
"No current assignments"** (`BUILDING_STATUS.NO_ASSIGNMENTS` / `no_assignments`,
labels "No current assignments" / "ללא שיבוצים נוכחיים"): `assigned === 0` only
proves there are currently zero bed assignments in that building, never that no
one wants to live there — the data model has no per-building demand signal to
support the old label's implicit claim.

**Region attribution for requests — "attributed region", not a verified
operational region.** `requests_by_region` groups each pending request under the
best-available regional signal, in priority order:

1. `source_region` — the student's region snapshot at request-creation time.
   Populated **only** for `room`/`apartment` request types
   (`StudentRequestViewSet.perform_create`); this is the same field the existing
   `TransfersPage.js` already surfaces to users as the request's origin region
   ("אזור מוצא"), so it is trusted, not invented, where it exists.
2. The student's current `accepted_dorm_type.region` — a real, verified region
   tied to the actual student the request concerns (covers `swap`/`remove_student`/
   `other` request types that reference an existing student).
3. `requested_by.region` — the filing staff member's own region, used **only** as
   a last resort for request types with no existing `Student` row yet
   (`add_student`, where the future student's room/region is chosen later, at
   approval time). This tier is a **best-effort proxy, not an independently
   verified operational region**: it assumes the filer is acting on behalf of
   their own office, which is the normal case but is not enforced by any
   server-side constraint at request-creation time. It was deliberately
   **retained** (rather than removed) because it is the only real signal
   available for `add_student` requests, and dropping it would silently remove
   those requests from the by-region breakdown entirely rather than
   approximating correctly; both the backend code comments and the frontend
   chart's subtitle now say this explicitly, and a request where *none* of the
   three tiers resolve is skipped from `requests_by_region` (never a fabricated
   "unknown" region) while still counting toward `pending_requests` and
   `requests_by_type` — covered by
   `test_request_with_no_resolvable_region_is_skipped_but_still_counted`.

Never `target_region`/`target_room` — that is the destination the request is
asking to move *to* (shown separately elsewhere), and would answer a different
question than "where is this request attributed from".

All new aggregation logic reuses `assignments_qs`, `requests_qs`, and `runs_qs`
that were **already** filtered to the caller's authorized region scope earlier in
the function — no new queryset bypasses that scoping.

---

## 5. Permission and Regional-Isolation Review

- No permission class, decorator, or authentication check was touched.
- Every new field is derived from a queryset that inherits region scoping already
  established earlier in `analysis_data()` (`assignments_qs`, `requests_qs`,
  `runs_qs`) — none of the new code queries `Model.objects.all()` directly.
- Verified live against the real dataset via the Django ORM (read-only) that a
  region-scoped call only returns that region's rows, and that the totals are
  internally consistent (`sum(waiting per resolved region) + unresolved-region
  students == summary.unassigned_students`).
- New backend tests explicitly assert cross-region isolation, including an
  explicit role × action matrix (`AnalysisAuthorizationMatrixTests`) covering
  `requests_by_type`, `requests_by_region`, and `recent_runs` together, for
  `central_admin` (default + `?region=` scoping), `region_boss`, and `employee`
  — including the query-param-spoof case (`?region=<other-region>` from a
  non-admin is always ignored server-side, never broadens access):
  `test_regional_user_never_sees_other_regions_requests`,
  `test_request_with_no_resolvable_region_is_skipped_but_still_counted`,
  `test_region_boss_sees_only_own_region_runs`,
  `test_central_admin_sees_runs_across_regions`,
  `test_recent_runs_excludes_unnecessary_fields`,
  `test_latest_run_keeps_full_serializer_shape`,
  `test_central_admin_sees_all_regions_by_default`,
  `test_central_admin_can_scope_via_region_param`,
  `test_region_boss_cannot_access_other_region_via_query_param`,
  `test_employee_cannot_access_other_region_via_query_param`.
- **PII minimization**: `recent_runs` was changed from the full
  `AllocationRunSerializer` to a hand-built minimal dict exposing only
  `id, region, region_name, status, successful_assignments, started_at,
  completed_at` — dropping `run_by`/`run_by_name` (the identity of the staff
  member who triggered the run) and `error_message` (free-text internal
  diagnostics), neither of which the freshness-panel UI displays or needs.
  `latest_run` is untouched and keeps the full serializer shape, preserving
  backward compatibility for any existing consumer of that specific field.
- Frontend: the region `<select>` only renders for `isCentralAdmin() && regions.length > 1`
  (unchanged condition from the original page) — a `region_boss`/`employee` never
  sees a region picker and the backend independently re-enforces this regardless
  of any client-side state.
- The table's client-side Excel export (`xlsx`, already a `package.json`
  dependency) only ever serializes data already fetched for the authorized scope
  — it makes no additional network request, so it cannot leak anything the user
  wasn't already authorized to see. The header's Excel export reuses the existing,
  already-scoped `/api/reports/capacity-report/` endpoint unchanged.
- No new endpoint was created; no existing endpoint's authentication/permission
  classes were modified.

---

## 6. Frontend Components and Architecture

```
src/pages/AnalysisPage.js                     orchestrator: state, fetch, drill-down wiring, stylesheet
src/components/analysis/
  analysisUtils.js                            THRESHOLDS, formatNumber/Percent/Timestamp, daysBetween,
                                               classifyBuildingStatus, buildRegionRows, buildAttentionIssues
  analysisTranslations.js                     ANALYSIS_TEXT { he, en }, getAnalysisText(language)
  AnalysisPrimitives.js                       MetricCard, MetricDefinitionTooltip, ChartCard, StatusBadge,
                                               SeverityBadge, ActiveFilters, AllocationProgressBar,
                                               ExportButton, Loading/Error/Empty states
  AnalysisHeader.js                           title, context chips, refresh, export
  AnalysisFilterBar.js                        region select, search, active-filter chips, reset
  AttentionIssuesPanel.js                     ranked issue list, severity badges, drill-down buttons
  AnalysisTabs.js                             WAI-ARIA tablist (roving tabindex, arrow-key nav)
  RegionPressureCharts.js                     CapacityDemandChart, AllocationStatusChart, CapacityPressureScatter
  OccupancyRankingChart.js                    top-N building ranking, 3 real view modes
  StudentGroupsChart.js                       single-dimension categorical bar (gender/religion/.../priority)
  SpecialRequestsPanel.js                     requests-by-type / by-region charts + oldest-pending callout
  BuildingAnalyticsTable.js                   search/sort/filter/paginate/export table
  DataFreshnessPanel.js                       latest batch, latest run, recent runs list
```

State lives only in `AnalysisPage.js` (`filterRegion`, `search`, `activeTab`,
`tableRegionFilter`, `tableStatusFilter`, plus the fetch/export lifecycle flags)
and is passed down as props — no context provider was introduced, matching the
existing app's prop-drilling convention (`language` itself is drilled the same
way from `App.js`). Expensive derivations (`occupancyRowsAll`, `regionRows`,
`issues`, `kpis`) are memoized with `useMemo`/`useCallback`; inactive tabs simply
don't render their charts (React conditionally renders `activeTab === 'x' && ...`,
so switching tabs is the lazy-render mechanism — no heavy chart library code runs
for a tab that isn't selected).

---

## 7. KPIs and Exact Formulas

| KPI | Formula (matches backend exactly) | Status rule |
|---|---|---|
| Total Students | `summary.total_students` | neutral |
| Assigned Students | `summary.assigned_students`; sub-text "X of Y students allocated" | good |
| Pending Assignment | `summary.total_students - summary.assigned_students` | good if 0; critical if >0 and `available_beds === 0`; else warn |
| Occupancy Rate | `assigned_beds / total_capacity` (as returned by backend) | warn if ≥90% or ≤30%; good if ≥40%; else neutral (same THRESHOLDS as building/region classification) |
| Available Beds | `total_capacity - assigned_beds` | neutral |
| Pending Requests | `summary.pending_requests` (count of `StudentRequest` with `status=PENDING` **specifically** — its definition tooltip now says this explicitly, not just "not yet approved or rejected", region-scoped) | warn if >0, else good |

Every KPI has a `MetricDefinitionTooltip` whose text is copied verbatim from the
formula the backend actually computes (see the table above and §4) — never a
description that could drift from the real calculation.

---

## 8. Status and Issue-Detection Rules

All thresholds live in one place: `analysisUtils.js → THRESHOLDS`.

```js
OCCUPANCY_FULL: 100
OCCUPANCY_NEARLY_FULL: 90
OCCUPANCY_HEALTHY_MIN: 40
OCCUPANCY_UNDERUTILIZED_MAX: 30
REGION_HIGH_WAITING_RATE: 0.30   // 30%+ of a region's students still waiting
PENDING_REQUEST_STALE_DAYS: 3
RANKING_DEFAULT_SIZE: 12
```

**Building status** (`classifyBuildingStatus`, used identically by the ranking
chart and the table so a building is never shown with two different statuses):

| Status | Condition |
|---|---|
| Requires review | `total_beds === 0` or `assigned > total_beds` (data anomaly) |
| Full | `occupancy_rate >= 100` |
| Nearly full | `occupancy_rate >= 90` |
| **No current assignments** *(renamed from "No active demand")* | `assigned === 0` (and capacity exists) — reflects **only** that the building currently has zero active bed assignments; it is **not** a claim about demand, since the data model has no per-building waiting-demand field (see §4). The internal constant was also renamed: `BUILDING_STATUS.NO_ASSIGNMENTS` / `'no_assignments'` (previously `NO_DEMAND` / `'no_demand'`), consistently across classification, labels, colors, the table's status filter dropdown, and the "buildings with free capacity, no allocations" issue's drill-down filter payload. |
| Underutilized | `occupancy_rate <= 30` |
| Healthy occupancy | everything else |

**Issue rules** (`buildAttentionIssues`, deterministic, sorted critical→info,
capped at 8). **Corrected this pass**: capacity shortage is now a true unmet-demand
deficit, not merely "the region is busy" — high occupancy and high waiting rate
are separate, independent pressure signals that no longer gate or require each
other:

| Issue | Condition | Severity |
|---|---|---|
| Latest allocation run failed | `latest_run.status === 'failed'` | Critical |
| **Capacity shortage in region** | `shortage = max(waiting - available_beds, 0)`; fires **only when `shortage > 0`** — a real deficit, never merely "occupancy ≥ 90%". The issue description states the exact shortage amount (e.g. "short 12 beds"). | Critical |
| **High occupancy pressure in region** *(new, separate rule)* | `occupancy_rate >= 90`, independent of whether there is currently any unmet demand (`waiting` is not required to be > 0) | High |
| Special-request students waiting | `priority_unassigned_students > 0` | High |
| Requests pending a long time | oldest pending request age ≥ 3 days | High |
| High waiting rate in region | region `waiting / students >= 30%` — **no longer gated on occupancy** (previously required `occupancy_rate < 90`; now a fully independent signal from both rules above) | Medium |
| Unassigned students | `unassigned_students > 0` | Medium |
| Pending requests | `pending_requests > 0` | Medium |
| Buildings with free capacity, no allocations | ≥1 building with `total_beds > 0 && assigned === 0` (status: **No current assignments**) | Medium |
| Spare capacity available | `available_beds > 0 && unassigned_students > 0` | Informational |

A single region can now legitimately show more than one of the three
region-level pressure issues at once (e.g. both "capacity shortage" and "high
occupancy pressure") — this is intentional: each answers a different question
("is there unmet demand right now" vs. "how much slack remains regardless of
current demand"), not duplicate noise.

---

## 9. Charts — data, interactions, and why each type was chosen

| Chart | Type | Data | Why this type |
|---|---|---|---|
| Capacity vs. Demand by Region | Grouped horizontal bar (capacity / assigned / waiting) | `regionRows` (built by joining `occupancy_data` capacity per region with `students_by_region` demand per region), sorted by waiting desc | 3 comparable counts across regions with long Hebrew names → horizontal grouped bars, sorted by urgency not alphabet, per spec. |
| Allocation Status by Region | 100%-stacked horizontal bar (assigned % / waiting %) | `regionRows`, pre-normalized to percentages so stacks always sum to 100 | Proportional composition across many regions → 100% stacked bar, not a pie (spec explicitly rules out pie for many-category comparison). |
| Building Occupancy Ranking | Horizontal bar, top 12, 3 real view modes | `occupancy_data`, view = highest / lowest / most-available | Long building names → horizontal; capped at 12 so it's never "every building in one chart." |
| Capacity Pressure Analysis | Scatter (x = available beds, y = waiting demand, size = total capacity) | `regionRows`, only rendered when ≥2 regions have real data — otherwise a ranked table would communicate the same thing better | Two independent numeric measures across regions → scatter is the correct semantic type; explicitly guarded against a meaningless single-point scatter. |
| Pending Requests by Type / by Region | Horizontal bar ×2 | `requests_by_type`, `requests_by_region` — **PENDING requests only**, stated in both the chart titles ("Pending Requests by …") and a clarifying subtitle under each chart (the by-region subtitle also explains the region-attribution fallback in plain language) | Category comparison, potentially long labels → horizontal bar. |
| Student Distribution (5 tabs' worth of dimensions) | Single-series horizontal bar, one dimension at a time | `students_by_*` | One chart answers exactly one question, per spec — dimensions are never combined. |
| Allocation performance (system-wide / priority) | Segmented progress bar (kept from the original page) | `summary` totals + `priority_students`/`priority_unassigned_students` | Preserved existing, still-real functionality; a simple 2-segment share is clearer as a bar than a chart. |

**Omitted by design (documented, not silently dropped):**
- *Historical trends (line chart).* No periodic snapshot table exists — `AllocationRun`
  rows are per-execution events (17 exist in the real dataset, only across 2 of 7
  regions), not a time series of system-wide occupancy/waiting. Building a real
  line chart would require a new backend capability (a scheduled snapshot job
  writing e.g. `AnalyticsSnapshot(occupancy_rate, waiting, ts)` rows). Instead,
  `recent_runs` (5 most recent, real) is surfaced as a compact list in the
  Allocation tab / freshness panel — real data, honestly presented as discrete
  events, not a fabricated trend.
- *"Highest waiting demand" / "largest shortage" building-ranking views* — omitted
  because waiting demand is not knowable per building (see §4).
- *Manual-review / blocked allocation statuses* — omitted from the
  allocation-status chart because `StudentRequest.Status` only has
  `pending`/`approved`/`rejected` and there is no such status on `BedAssignment`
  either; only real `assigned`/`waiting` are shown.

---

## 10. Filters and Drill-Down Interactions

| Filter | Scope | Effect |
|---|---|---|
| Region (`<select>`, central admin + >1 region only) | Global | Re-fetches `/api/analysis/?region=<id>`; changes KPIs, issues, all charts, and the table. |
| Free-text search | Global | Client-side filter over `building`/`region` name; narrows the Occupancy Ranking chart and pre-fills the table's own search box (same state, single source of truth). |
| Table region refine | Table-local | Only lists regions actually present in the current building rows (never an empty-effect option). |
| Table status filter | Table-local | One of the 6 real `BUILDING_STATUS` values; driven manually or via an issue's drill-down action. |
| Reset filters | Global | Clears region, search, and both table-local filters in one action. |

**Drill-downs implemented:**
- Issue → route (`/students`, `/priority`, `/transfers`, `/allocation`) when a
  destination page and permission exist; the button renders disabled (not hidden)
  when the user lacks the permission for that action's route.
- Issue → region filter + switch to Occupancy tab + scroll to table (capacity
  shortage / high-occupancy-pressure / high-waiting-rate issues — all three
  region-level pressure signals share this same drill-down).
- Issue → table status filter (`no_assignments`) + switch tab + scroll to table
  ("buildings with free capacity, no allocations" issue).
- Chart bar (region, in Capacity-vs-Demand / Allocation-Status charts) → applies
  the global region filter (central admin) and scrolls to the table.
- Chart bar (building, in Occupancy Ranking) → sets the search box to that
  building's name and scrolls to the table.
- Special Requests panel → "View all requests" routes to the existing
  `/transfers` page (record-level action lives there; this panel stays purely
  analytical, avoiding a duplicate requests table).

All active filters are visible as removable chips; nothing is a hidden filter
state.

---

## 11. Translation Key Inventory

All strings live in `src/components/analysis/analysisTranslations.js` as a flat
`{ he: {...}, en: {...} }` object (same convention as every other page in this
codebase). Full key list (identical key set in both languages), grouped by area:

- **Header:** `pageTitle, pageSubtitle, lastUpdated, dataSource, noBatch, refresh, refreshing, exportAction, exporting, exportError, systemWide`
- **Filter bar:** `regionFilterLabel, allRegions, searchLabel, searchPlaceholder, resetFilters, removeFilterAria`
- **States:** `loadingTitle, loadError, retry, noData, noMatch, noMatchSub`
- **KPIs:** `kpiTotalStudents(+Def), kpiAssigned(+Def), kpiWaiting(+Def), kpiOccupancy(+Def), kpiAvailableBeds(+Def), kpiPendingRequests(+Def), ofStudentsAllocated(fn), stillWaitingCtx(fn), bedsOccupiedCtx(fn), readyForAssignment, pendingReviewCtx`
- **Issues:** `issuesTitle, issuesSubtitle, noIssuesTitle, noIssuesSub, severityCritical, severityHigh, severityMedium, severityInfo`
- **Tabs:** `tabsAriaLabel, tabOverview, tabOccupancy, tabAllocation, tabRequests, tabGroups`
- **Capacity/Demand:** `capacityDemandTitle, capacityDemandSubtitle, seriesCapacity, seriesAssigned, seriesWaiting, unitBeds, unitStudents`
- **Occupancy ranking:** `occupancyRankingTitle, occupancyRankingSubtitle, viewHighest, viewLowest, viewMostAvailable`
- **Allocation status:** `allocationStatusTitle, allocationStatusSubtitle`
- **Capacity pressure:** `pressureTitle, pressureSubtitle, axisAvailableCapacity, axisWaitingDemand`
- **Special requests:** `requestsTitle, requestsSubtitle, requestsByTypeTitle, requestsByTypeSubtitle, requestsByRegionTitle, requestsByRegionSubtitle, oldestPendingLabel, noRequests, noRequestsSub, viewAllRequestsAction, requestType{7 keys}` — the two `*Subtitle` keys were added this pass to state explicitly, under each chart, that only PENDING requests are counted (and, for the by-region chart, to explain the region-attribution fallback in plain language).
- **Student groups:** `distributionTitle, distributionSubtitle, dimGender, dimReligion, dimReligious, dimCategory, dimHousing, dimRegion, dimAllocation, dimPriority, unknown, noSpecialRequest, assigned, waiting`
- **Table:** `tableTitle, tableSubtitle, tableSearchPlaceholder, filterStatusLabel, filterStatusAll, filterRegionAll, colBuilding, colRegion, colCapacity, colAssigned, colAvailable, colOccupancy, colStatus, showing, of, exportTableAction, pageOf(fn), prevPage, nextPage, sortAria(fn)`
- **Freshness:** `freshnessTitle, latestUpload, latestRun, recentRunsTitle, students, assignments, runStatus{8 keys}`

Building-status labels (`Requires review / Full / Nearly full / Healthy
occupancy / Underutilized / No current assignments` — the last one renamed this
pass from "No active demand"; see §8) are **not** duplicated here — they live
once, next to the classification logic they describe, in
`analysisUtils.js → BUILDING_STATUS_LABELS`, so a status can never show a
different label in two places.

Every key exists in both `he` and `en` with equivalent (not word-for-word
transliterated) grammar — e.g. `ofStudentsAllocated` produces natural Hebrew
("714 מתוך 1,097 סטודנטים שובצו") and natural English ("714 of 1,097 students
allocated") from the same two numbers, via a small formatter function per
language rather than string concatenation.

---

## 12. RTL and LTR Handling

- Page root: `dir={isHebrew ? 'rtl' : 'ltr'}` (unchanged mechanism from the
  original page / `App.js`'s `MainLayout`).
- All spacing/alignment CSS uses logical properties (`border-inline-start`,
  `text-align: start/end`, `inset-inline-end`, `margin-inline-start`) instead of
  physical `left`/`right`, so the whole layout mirrors correctly under both
  directions without direction-specific overrides, except where a control
  genuinely needs one (documented below).
- **Charts**: every chart is wrapped in an explicit `<div dir="ltr">` — this is
  the one deliberate, documented exception. Recharts' SVG coordinate system is
  always numerically left-to-right internally; forcing `dir="ltr"` on the
  container makes that intentional so the page's RTL direction can never flip a
  numeric axis, while `dataKey`-driven category labels (building/region names)
  still render in whichever language is active, since they're plain SVG `<text>`
  content, not layout-direction-dependent.
- **Table**: numeric columns (`colCapacity/colAssigned/colAvailable/colOccupancy`)
  use `.an-td-num { text-align: end; font-variant-numeric: tabular-nums }` so
  digits stay right-aligned and consistently columnar in both directions (in
  LTR, "end" = right, matching normal numeric-table convention; in RTL, "end" =
  left, which keeps the numbers visually anchored the same way relative to their
  header). Text columns use `.an-td-text { text-align: start }`.
- **Pagination arrows**: `AnalysisEmptyState`/pagination glyphs are swapped by
  `isHebrew` so the "previous"/"next" chevrons still point the direction that
  matches reading order (`›`/`‹` flip between the two branches).
- **Header actions column**: `[dir="rtl"] .an-header-actions { align-items:
  flex-start }` — the one physical-property override, needed because the flex
  alignment keyword itself (`flex-end`/`flex-start`) doesn't have a logical
  equivalent that flips automatically with `dir`.
- Long labels: building/region names are not truncated by CSS in the table
  (`white-space: nowrap` inside a horizontally-scrollable `.an-table-wrap`) so no
  information is ever hidden without recourse; in charts, the Y-axis category
  width (130–170px) combined with the exact value always available in the
  tooltip satisfies "truncate only when necessary, always provide the full value
  via tooltip."

---

## 13. Accessibility and Responsive Behavior

- **Tabs**: full WAI-ARIA tabs pattern (`role="tablist"/"tab"`, `aria-selected`,
  `aria-controls`/matching tabpanel `id`, roving `tabIndex`, `Home`/`End`/arrow-key
  navigation in `AnalysisTabs.js`).
- **Icon-only controls**: the definition-tooltip trigger and every filter-chip
  remove button carry a translated `aria-label`; the search input has an
  associated (visually-hidden but screen-reader-visible) `<label>`.
- **Status is never color-only**: every status/severity badge (`StatusBadge`,
  `SeverityBadge`) renders a text label plus an icon/dot, never a bare color
  swatch.
- **Loading/error states** use `role="status"`/`role="alert"` with
  `aria-live="polite"` so they're announced without the user needing to find them.
- **Focus**: all interactive elements are real `<button>`/`<select>`/`<input>`
  elements (never a `<div onClick>`), so default browser focus rings apply; the
  tab strip additionally gets an explicit `:focus-visible` outline.
- **Table**: sortable headers are real `<button>` elements inside `<th>` with a
  translated `aria-label` ("Sort by …" / "מיון לפי …"); the header row uses
  `position: sticky` so column meaning stays visible while scrolling a long
  table.
- **Responsive**: KPI row is a 6→3→2 column CSS grid by breakpoint; the requests
  panel drops from 3 columns to 1; the table wraps in `overflow-x: auto` instead
  of shrinking text; charts render inside `ResponsiveContainer` so they resize
  with their card rather than overflowing it.

---

## 14. Tests Added or Modified

`backend/api/tests_analysis.py` — **4 new `TestCase` classes, 15 new test
methods** (recounted directly from the file's current contents — the previous
version of this report incorrectly said "17"). Existing 3 classes / 12 methods
are untouched. File now totals **7 classes / 27 methods**.

- **`AnalysisRegionalBreakdownTests`** (1 method) — `students_by_region[].assigned/waiting`
  split is correct and `count === assigned + waiting` (backward compatibility).
- **`AnalysisSpecialRequestsBreakdownTests`** (6 methods) — region-attribution
  fallback chain (`source_region` → student's region → filer's region → skip),
  resolved (approved) requests excluded from `requests_by_type`/
  `oldest_pending_request_created_at`, full cross-region isolation for a
  regional user, and (added this pass) a request for which **none** of the
  three attribution tiers resolve is skipped from `requests_by_region` while
  still counting toward `pending_requests`/`requests_by_type`
  (`test_request_with_no_resolvable_region_is_skipped_but_still_counted`).
- **`AnalysisRecentRunsScopingTests`** (4 methods) — `recent_runs` respects the
  same region scope as `latest_run` for both a regional user and a central
  admin; and (added this pass) `recent_runs` items expose **only**
  `{id, region, region_name, status, successful_assignments, started_at,
  completed_at}` — never `run_by`/`run_by_name`/`error_message`
  (`test_recent_runs_excludes_unnecessary_fields`) — while `latest_run`
  independently keeps its full serializer shape
  (`test_latest_run_keeps_full_serializer_shape`).
- **`AnalysisAuthorizationMatrixTests`** (4 methods, new this pass) — an
  explicit role × action matrix covering `requests_by_type`,
  `requests_by_region`, and `recent_runs` together: a central admin sees all
  regions by default and can scope via `?region=`; a `region_boss` and an
  `employee` each stay confined to their own region even when explicitly
  supplying `?region=<other-region>` (the query-param spoof is ignored
  server-side for non-admins, per the pre-existing pattern this endpoint
  already used for `summary`, now proven for these fields too).

All new tests follow the existing file's conventions exactly (`_make_user`,
`_make_dorm_type`, `_make_room`, `_make_student` helpers; `APIClient` +
`force_authenticate`).

---

## 15. Tests / Commands NOT Run (shell execution was disabled for this phase)

Per instruction, no Bash/Docker/git/package-manager/test/lint/build command was
executed after that restriction was put in place. Specifically **not** run in
this final phase:

- `docker exec dormify_backend python manage.py test api.tests_analysis` (to
  confirm all 27 test methods — the 12 pre-existing plus the 15 added across
  both this pass and the previous one — actually pass against the disposable
  test DB; **none of the 15 have been executed yet, including the correction
  made in this pass**)
- `docker exec dormify_backend python manage.py test` (full backend suite, to
  confirm no unrelated regression)
- `npm run build` / CRA dev-server compile (to confirm zero JSX/import errors
  across all frontend files, including this pass's edits)
- Any ESLint run (to confirm no residual unused-var/import warnings)
- Manual browser verification at `http://localhost:3000/analysis` in Hebrew and
  English, at multiple widths — in particular, re-verifying the corrected
  shortage/high-occupancy/high-waiting-rate issue wording and the renamed
  "No current assignments" building status, none of which have been visually
  confirmed in a browser

**What *was* verified**, all read-only, before the shell restriction:
- `python -c "import ast; ast.parse(...)"` against the modified `views.py` —
  syntactically valid.
- The full pre-existing `api.tests_analysis` suite (12/12) run and passing
  *before* the shell restriction, confirming the backend change is
  backward-compatible.
- The live `analysis_data` view called directly (via `APIRequestFactory` +
  `force_authenticate`, read-only) against the real dev database, confirming the
  new fields (`students_by_region[].assigned/waiting`, `requests_by_type`,
  `requests_by_region`, `oldest_pending_request_created_at`, `recent_runs`)
  return correct, internally-consistent values (e.g. `sum(waiting per resolved
  region) + unresolved-region students == summary.unassigned_students`).
- Every frontend file was re-read in full after writing, cross-checking every
  prop passed against every prop destructured, every `t.xxx` reference against
  the translation file's actual key set (all resolved; several genuinely unused
  keys were found and deleted), and every import against actual usage.
- One real bug was caught and fixed during this review: the table's Export
  button reused the dark-header button style and would have rendered
  low-contrast white-on-white on the table's white card — split into
  `ExportButton variant="dark"|"light"`.
- A missing error handler on the table's client-side Excel export (`try {…}
  finally {…}` with no `catch`) was found and fixed.
- A hardcoded English `aria-label="Analysis sections"` on the tab list was found
  and replaced with a translated key.

**This correction pass** (shortage-rule fix, building-status rename, PENDING-only
wording, attribution documentation, PII minimization, authorization tests) was
also reviewed statically only — no test/build/lint command was executed. What
*was* checked by reading: every remaining reference to the old `NO_DEMAND`/
`no_demand` constant and "No active demand"/"ללא ביקוש פעיל" label was located
(`grep`-equivalent search across `src/`) and updated — one live reference
remained in `BuildingAnalyticsTable.js`'s status-filter dropdown and has been
renamed; `DataFreshnessPanel.js` was re-read in full to confirm it does not
reference any of the fields dropped from `recent_runs` (`run_by`, `run_by_name`,
`error_message`, `status_display`, `students_processed`, `roommate_matches`,
`conflicts`) — it only ever read `id/region_name/status/successful_assignments/
started_at/completed_at`, all of which are retained, so **no frontend file
needed a corresponding edit** for the `recent_runs` shape change.

---

## 16. Exact Safe Commands to Run Next

```bash
# 1. Backend tests (new + existing, disposable test DB only)
docker exec dormify_backend python manage.py test api.tests_analysis -v 2

# 2. Full backend suite (confirm no unrelated regression)
docker exec dormify_backend python manage.py test

# 3. Confirm the frontend dev server compiles the new files cleanly
#    (watch the terminal dormify_frontend is already running in / docker logs)
docker logs -f dormify_frontend

# 4. Manual verification
#    http://localhost:3000/analysis
#    - toggle EN/HE via the header globe button, confirm dir flips and every
#      string changes (no leftover English in Hebrew mode or vice versa)
#    - resize the window to ~1280px, ~1024px, ~768px
#    - as a central_admin: change the region filter, confirm KPIs/issues/
#      charts/table all update; as a region_boss: confirm no region picker
#      appears and data is pre-scoped
#    - click an issue with a route action; click a region bar in the Capacity
#      vs Demand chart; click a building bar in the Occupancy Ranking chart;
#      confirm the table scrolls into view and reflects the drill-down
#    - use the table's search/sort/status filter/pagination; export the table;
#      export from the header; open both .xlsx files and confirm Hebrew text
#      renders correctly (not mojibake)
```

---

## 17. Known Limitations and Remaining Risks

- **Not executed this session**: the new backend tests, a full lint/build pass,
  and manual browser verification — all listed explicitly in §15/§16. The code
  was reviewed as thoroughly as static reading allows, but "reads correctly" is
  not a substitute for actually running it.
- **Table export vs. header export scope differ on purpose**: the header's
  "Export to Excel" button produces the full authorized-region capacity report
  (multi-sheet, server-generated, unfiltered by the table's local search/status
  refinements). The table's own "Export table" button produces exactly the
  currently filtered/sorted rows (client-side, single sheet). This is
  intentional — the existing `capacity_report` endpoint has no parameter for
  "only these building statuses" — but it means the two buttons are not
  interchangeable, and a user could reasonably expect them to match.
- **Historical trends are absent by design** (§9) — pending a real backend
  snapshot capability, which was out of scope to build in this pass.
- **Sticky table header** relies on the page's own document-level scroll (no
  independent scroll container was introduced), which is correct for this
  layout but has not been visually confirmed.
- **`xlsx` dynamic import** (`await import('xlsx')`) was not exercised at
  runtime this session; the package is a pre-existing `package.json` dependency
  (present before this change, previously unused anywhere in `src/`), so no new
  install step is required, but the actual browser code path (dynamic
  code-splitting, `XLSX.writeFile` triggering a browser download) should be
  manually confirmed per §16.
- **Real dataset is currently thin in places** — e.g. `requests_by_type` will
  show only one bar ("Room change") until other request types are actually
  filed, and only 2 of 7 regions have any `AllocationRun` history. This is
  expected, honest behavior given real data, not a bug.
- **`requested_by.region` remains a best-effort (not verified) attribution
  tier** for `requests_by_region`, used only for `add_student` requests (§4).
  This was a deliberate keep-and-document decision, not an oversight — but it
  means a region_boss/employee whose regional office frequently files
  `add_student` requests on behalf of a *different* region's dorms (if that is
  ever actually possible in this system — it was not independently verified
  against approval-time logic) would see those requests misattributed. No
  evidence of that scenario was found in the request-creation flow, but it was
  not exhaustively ruled out either.
- **A region can now surface two related but distinct pressure issues at
  once** (e.g. both "Capacity shortage" and "High occupancy pressure" for the
  same region) since the corrected rules no longer suppress one in favor of
  the other. This is intentional (§8) but has not been visually confirmed to
  read clearly side-by-side in the Issues panel.
- **None of this correction pass's changes have been executed or visually
  verified** — see §15/§16.

---

## 18. Manual Browser-Testing Checklist

**Hebrew (RTL):**
- [ ] Page loads at `/analysis`, header/subtitle/KPI labels all Hebrew, no mixed/garbled text
- [ ] `dir="rtl"` on page root; sidebar stays on the right, content mirrors correctly
- [ ] KPI card sub-text reads naturally ("714 מתוך 1,097 סטודנטים שובצו"), not reversed word order
- [ ] Definition tooltip opens on click, Hebrew text readable, closes on blur
- [ ] Issues panel: severity badges show Hebrew labels + icon, not color alone
- [ ] Tabs: click through all 5, keyboard arrow-keys move focus and selection correctly
- [ ] Charts: bar/axis labels in Hebrew, not corrupted; numeric axis still reads left→right internally (not mirrored)
- [ ] Table: Hebrew building/region names right-aligned as text, numbers right-aligned as numbers, sort works, pagination arrows point the correct reading direction
- [ ] Region filter dropdown (central admin) opens in a usable direction, values are Hebrew region names
- [ ] Reset filters clears region + search + table-local filters in one click
- [ ] Export (header and table) downloads an `.xlsx`; opening it shows correct Hebrew (not `?????`/mojibake)

**English (LTR):**
- [ ] Same page, `dir="ltr"`, sidebar on the left
- [ ] All strings in natural English word order (not Hebrew-order English)
- [ ] Same KPI/issue/chart/table checks as above, mirrored for LTR
- [ ] Switching EN→HE→EN preserves the selected tab and active filters (no reset)

**Both languages, responsive:**
- [ ] ~1440px: 6 KPI columns
- [ ] ~1100px: 3 KPI columns, requests panel collapses to 1 column
- [ ] ~700px: 2 KPI columns, issues list single column, table scrolls horizontally instead of squeezing

**Roles:**
- [ ] `central_admin`: region picker visible, "All Regions" default, can switch regions
- [ ] `region_boss` / `employee`: no region picker, data pre-scoped to their region, issue actions requiring a permission they lack render disabled (not a dead click)

**Errors/empty:**
- [ ] Kill the backend momentarily, refresh → error panel with retry, not a blank page
- [ ] Filter/search to a combination with zero table rows → "No results match the current filters" message, not a blank table
- [ ] A region with zero buildings/students → charts show their own empty state, not a crash

**This correction pass (verify explicitly):**
- [ ] A region with high occupancy but zero waiting students shows a "High
      occupancy pressure" issue but **not** a "Capacity shortage" issue
- [ ] A region with real unmet demand shows "Capacity shortage" with the exact
      shortage number in the description (e.g. "short 12 beds" / "חסרות 12 מיטות")
- [ ] A building with `assigned === 0` shows status "No current assignments" /
      "ללא שיבוצים נוכחיים" everywhere it appears (ranking chart bar color,
      table badge, table status filter dropdown) — no leftover "No active
      demand" / "ללא ביקוש פעיל" text anywhere
- [ ] Both "Pending Requests by Type" and "Pending Requests by Region" chart
      cards show their new clarifying subtitle, in both languages
- [ ] The Pending Requests KPI's definition tooltip explicitly mentions
      PENDING status, in both languages
- [ ] Recent allocation runs list still renders correctly (region, status,
      successful assignments, date) with the trimmed backend field set

---

## 19. Git Status

Branch: `donia-data-analysis-fix` (unchanged, still checked out).
No `git add`, `git commit`, `git push`, `git merge`, `git rebase`, `git reset`, or
`git checkout` was executed at any point in this session — only `Read`/`Grep`/
`Glob`/`Edit`/`Write` tools were used for all work after the repository audit.
The working tree therefore contains only uncommitted edits to the files listed
in §2 (as corrected in this pass), plus **one** new report file at the repo
root, `DATA_ANALYSIS_REDESIGN_REPORT.md` (the previous version of this section
incorrectly said "two new report files" while listing only one — corrected
here). `git status`/`git diff` were not executed as a command in this or the
prior phase (shell disabled per instruction); the file list is derived
directly from the write/edit history of this session, which is exhaustive.

---

## 20. Recommended Reviewer Starting Points

1. **`backend/api/views.py`**, the `analysis_data` function's new sections (search
   for `students_by_region_counts`, `pending_requests_qs`) — the most
   security-sensitive change (region-scoped aggregation).
2. **`backend/api/tests_analysis.py`** — run it first, before reading frontend
   code, to get an automated confidence signal on the backend change.
3. **`src/components/analysis/analysisUtils.js`** — every threshold and business
   rule the rest of the UI depends on lives here; reading this file first makes
   every component that imports it easier to review.
4. **`src/pages/AnalysisPage.js`** — the orchestrator; shows how filters/tabs/
   drill-downs connect everything else.
5. Manually load `/analysis` in both languages per §18 before approving.

---

## 21. Correction Log (this pass)

A follow-up review requested 8 specific correctness/verification fixes to the
implementation above (not a redesign). All 8 were applied; no shell command was
executed (per instruction). Summary:

1. **Regional capacity-shortage rule corrected.** Was: `waiting > 0 && occupancy_rate >= 90`
   (flagged a region as "shortage" merely for being busy). Now:
   `shortage = max(waiting - available_beds, 0)`, fires only when `shortage > 0`,
   and the issue description states the exact shortage amount. High occupancy
   (`>= 90%`, independent of `waiting`) is now its own separate "High occupancy
   pressure" issue; high waiting rate is no longer gated on occupancy either —
   all three are independent pressure signals. Files:
   `src/components/analysis/analysisUtils.js`.
2. **Building status "No active demand" renamed** to "No current assignments" /
   "ללא שיבוצים נוכחיים" everywhere: the constant (`NO_DEMAND`→`NO_ASSIGNMENTS`,
   `'no_demand'`→`'no_assignments'`), its label, its color entry, the table's
   status-filter dropdown, and the "empty buildings" issue's drill-down filter
   payload. No frontend automated tests existed to update (this codebase has no
   frontend test files at all — confirmed by a repo-wide search before this
   engagement began). Files: `analysisUtils.js`, `BuildingAnalyticsTable.js`.
3. **PENDING-only wording clarified** on `requests_by_type`/`requests_by_region`:
   chart titles already read "Pending Requests by Type/Region" (verified
   unchanged from the original implementation); added a clarifying subtitle
   under each chart, and strengthened the Pending Requests KPI's definition
   tooltip to explicitly name the `PENDING` status rather than only describing
   it indirectly. Files: `analysisTranslations.js`, `SpecialRequestsPanel.js`.
4. **Request region attribution re-reviewed.** Confirmed `source_region` is
   populated only for room/apartment requests and is the same field
   `TransfersPage.js` already surfaces as the request's origin region;
   confirmed the student's `accepted_dorm_type.region` is a verified signal for
   request types tied to an existing student; determined `requested_by.region`
   is **not independently guaranteed** to represent the request's operational
   region (it is only reached for `add_student` requests, where no server-side
   constraint ties the filer's region to the eventual target) — **retained**
   as a documented last-resort tier rather than removed, since it is the only
   available signal for that case and removing it would silently drop those
   requests from the breakdown. Backend variable renamed `req_region` →
   `attributed_region`; both backend comments and a new frontend chart
   subtitle now explain the three-tier fallback in plain language. Added
   `test_request_with_no_resolvable_region_is_skipped_but_still_counted`
   covering the case where none of the three tiers resolve. Files:
   `backend/api/views.py`, `backend/api/tests_analysis.py`,
   `analysisTranslations.js`.
5. **Authorization tests strengthened.** Added `AnalysisAuthorizationMatrixTests`
   (4 methods) covering `requests_by_type`/`requests_by_region`/`recent_runs`
   together for: central admin default (all regions) and `?region=`-scoped
   access; `region_boss` and `employee` each confined to their own region even
   when explicitly passing `?region=<other-region>` (spoof attempt ignored
   server-side, matching the pre-existing pattern already proven for
   `summary`). File: `backend/api/tests_analysis.py`.
6. **`AllocationRunSerializer` exposure inspected.** Its full field list
   includes `run_by`/`run_by_name` (a staff member's identity) and
   `error_message` (free-text diagnostics) — neither used by the "recent
   allocation runs" freshness-panel UI. `recent_runs` now returns a hand-built
   minimal dict (`id, region, region_name, status, successful_assignments,
   started_at, completed_at`) instead of the full serializer.
   `latest_run` is untouched, preserving backward compatibility for that
   field. Added `test_recent_runs_excludes_unnecessary_fields` and
   `test_latest_run_keeps_full_serializer_shape`. Confirmed (by re-reading the
   file) that `DataFreshnessPanel.js` never referenced any of the dropped
   fields, so no frontend change was needed. File: `backend/api/views.py`.
7. **Report corrected** (this document): test-method count fixed from an
   incorrect "17" to the accurate **15 new methods across 4 new classes**
   (27 methods / 7 classes total); the report-file count fixed from an
   incorrect "two new report files" to the accurate **one**
   (`DATA_ANALYSIS_REDESIGN_REPORT.md`); every description of the shortage
   rule, the renamed building status, and the pending-request charts updated
   throughout §4, §5, §7, §8, §9, §10, §11, §14, §17, §18, §19. No statement in
   the previous version claimed the *new* tests had passed — the one "12/12
   passing" claim in §15 refers only to the **pre-existing** suite, run
   *before* the shell restriction, which remains accurate and is left as-is.
8. **Final static review performed**: confirmed every `he`/`en` translation
   key referenced via `t.xxx` across all analysis components resolves to a
   defined key (no missing keys); confirmed zero remaining references to
   `NO_DEMAND`/`no_demand`/"No active demand"/"ללא ביקוש פעיל" anywhere in
   `src/`; confirmed zero remaining references to the old ungated shortage
   condition; no unused imports were introduced by this pass's edits; no
   `console.log`/debug output exists in any changed file; confirmed the only
   files touched in this pass are the ones listed above plus this report —
   no unrelated file (including `.env`) was opened or modified.

**Not run in this pass** (shell disabled, per instruction): the 15 new/updated
test methods, the full backend suite, a frontend build/lint pass, and manual
browser verification. See §16 for the exact commands to run, and the new
checklist items added to §18.

---

## 22. Build Fix — `react-hooks/exhaustive-deps` Rule Not Found

The production frontend build failed with three ESLint errors, all in
`src/pages/AnalysisPage.js`:

```
Line 85:5   Definition for rule 'react-hooks/exhaustive-deps' was not found
Line 98:5   Definition for rule 'react-hooks/exhaustive-deps' was not found
Line 174:5  Definition for rule 'react-hooks/exhaustive-deps' was not found
```

**Root cause**: this project's active ESLint configuration for the production
build does not register `eslint-plugin-react-hooks` (the rule is not defined),
so the three `// eslint-disable-next-line react-hooks/exhaustive-deps` comments
left in place by the original redesign — each disabling a *real* missing-dependency
situation rather than a false positive — became hard configuration errors
instead of being silently accepted. Per the task, no dependency was installed
and no lint config was touched; instead, each of the three underlying
dependency issues was fixed properly so no disable comment is needed at all.

**What was changed around each of the three lines** (line numbers below refer to
the file *before* this fix; see the diff summary after for the actual code):

1. **Line 85 — inside the `fetchAnalysis` `useCallback`.** The callback read
   `t.loadError` (a translated string) as a fallback error message, making
   `t.loadError` a genuine dependency — but including it meant `fetchAnalysis`
   got a new identity on every language switch (since the Hebrew and English
   strings are different values), which the disable comment was masking rather
   than fixing. **Fix**: `fetchAnalysis` no longer touches `t`/`language` at
   all — it now stores only the raw API error message (or `''` when the API
   gave none) in state; the translated fallback is applied where the error is
   *displayed* instead (`error || t.loadError` in the JSX), which also means
   an already-visible error message now re-translates instantly on a language
   switch instead of staying stale until the next fetch. `fetchAnalysis`'s
   dependency array is now the genuinely-correct `[]` — it is fully stable and
   never changes identity.
2. **Line 98 — the `useEffect` that calls `fetchAnalysis(filterRegion)`.** It
   called `fetchAnalysis` without listing it as a dependency — a real
   exhaustive-deps violation the comment was suppressing. **Fix**: now that
   `fetchAnalysis` is stable (previous point), it was added to this effect's
   dependency array (`[filterRegion, fetchAnalysis]`) with no behavior change:
   since `fetchAnalysis`'s identity never changes, the effect still only
   re-runs when `filterRegion` changes, exactly as before — not on every
   render and not on a language switch.
3. **Line 174 — inside the `issues` `useMemo` (built from `buildAttentionIssues`).**
   The memo read `canRunAllocation()`/`canAssignPriority()` — both functions
   from `useAuth()` — without listing `canRunAllocation`/`canAssignPriority`
   themselves as dependencies. **Fix**: both were added to the dependency
   array. They are independently `useCallback`-memoized inside `AuthContext`
   (stable unless the signed-in user's role/permissions actually change), so
   this does not cause extra recomputation on unrelated re-renders — it only
   makes the memoized issue list correctly recompute on the rare occasion
   permissions actually change.

**Did any callback or dependency arrays change?** Yes, all three:
- `fetchAnalysis`: `[t.loadError]` → `[]`
- the `filterRegion` `useEffect`: `[filterRegion]` → `[filterRegion, fetchAnalysis]`
- the `issues` `useMemo`: `[summary, occupancyRowsAll, regionRows, data, language]`
  → `[summary, occupancyRowsAll, regionRows, data, language, canRunAllocation, canAssignPriority]`

The `error` piece of state also changed shape as a direct consequence of fix
#1: it now holds `null` (no error) or a string (`''` or a real message,
meaning an error occurred), instead of always holding a non-empty string on
error. The two JSX render conditions that gate on it were updated to match
(`error !== null` / `error === null`, with `error || t.loadError` used for
display text) — this preserves the exact previous visible behavior (a real
API message shown as-is, or the translated generic message when none exists)
while removing the stale-language bug described above.

**Static review performed after editing** (per the task's explicit checklist):
- **Missing hook dependencies**: none remaining — every `useEffect`/`useCallback`/
  `useMemo` in the file (13 total: 2 effects, 5 callbacks, 6 memos) was
  individually re-read; all reference only stable setters, primitives already
  listed, or values now correctly listed.
- **Unstable callback references**: `fetchAnalysis` is now genuinely stable
  (`[]`). `handleIssueAction`/`handleSelectRegionFromChart` call the plain
  (non-memoized) `scrollToTable` helper, which only reads `tableRef.current` —
  a ref, not reactive state — so a fresh function reference each render carries
  no staleness risk and was left as-is (in scope: fix only the three reported
  errors and directly-resulting hook issues, not an unrelated refactor).
- **Duplicated fetches**: none — `regionsAPI.getAll()` still runs exactly once
  on mount (`[]`); `analysisAPI.getData()` (via `fetchAnalysis`) still runs
  once on mount and again only on an actual `filterRegion` change or an
  explicit user action (refresh/retry button), unchanged from before this fix.
- **Effects that could loop**: none — the one effect that depends on a
  function (`fetchAnalysis`) depends on a *stable* one, so it cannot
  self-trigger; no effect sets state that is also in its own dependency array
  in a way that would cycle.
- **Unused imports**: none found — every import at the top of the file
  (React hooks, icons, API modules, all 10 child components, all 7 named
  utility exports) is used somewhere in the file; no import was added or
  removed by this fix.

**Requirement-by-requirement confirmation**: filter behavior (region change
still triggers exactly one fetch), refresh behavior (still calls `fetchAnalysis`
with `isRefresh=true`), language-switch behavior (still never triggers a
refetch — and now additionally re-translates a visible error message live),
tab behavior (untouched), and export behavior (`handleHeaderExport`, the
table's own export — untouched) are all preserved exactly. No dependency was
installed, `package.json`/`package-lock.json` were not touched, no
Browserslist command was run, and no unrelated part of the page was changed.

**Files changed in this pass**: `src/pages/AnalysisPage.js` only (backend and
other component files were not touched by this fix). This report file.

**Not run in this pass** (shell disabled, per instruction): the production
build itself was not re-run to confirm the three errors are gone, and no
lint/test command was executed. The fix was verified by static re-reading of
the full file and a repo-wide search confirming zero remaining
`eslint-disable.*react-hooks` comments anywhere in `src/`.

**Exact command to confirm the fix**:
```bash
docker exec dormify_frontend npm run build
```
