# Data Analysis Implementation Report

Branch: `donia-data-analysis-fix` · Route: `/analysis` · Entry point: `src/pages/AnalysisPage.js`

No commit, push, branch switch, reset, or destructive Git operation was performed at any
point. The `stash@{0}` "LOCAL BACKUP" entry (and the other stash entries) were never
touched — no `git stash` command was run in this session.

---

## 1. Executive Summary

The working tree already contained an unfinished first-pass redesign (documented in
`DATA_ANALYSIS_REDESIGN_REPORT.md`) that turned the original 1,044-line flat page into a
tabbed, filterable dashboard, but had never been run or verified, and did not yet match
the specific "operational command center" structure requested for this pass (a
misleading multi-scale district chart, a large building-occupancy bar chart, no
district-health overview, no recommended-actions section, no urgency-ranked buildings
table, no drill-down drawer).

This pass builds on that foundation rather than discarding it: it restructures the page
into the requested command-center layout (compact header → 4 KPI cards + secondary
indicators → prioritized Attention Queue → District Health Overview → one real
visualization with a data-derived insight sentence → Recommended Actions → an
urgency-ranked Buildings table → 4 focused deep-dive tabs), removes the misleading
grouped/multi-scale region chart and the separate building-ranking bar chart, adds a
building-details drawer, and — unlike the previous pass — actually runs and verifies
everything: Django checks, the full backend test suite, a production frontend build, and
a manual, screenshot-by-screenshot walkthrough in the browser (Hebrew/RTL, both real
data and interactions).

**Result**: the page loads, is driven entirely by real backend data, is materially
easier to scan and act on than the previous version, and every automated check that
could be run was run. See §8 for exact results and §10 for honest limitations.

---

## 2. Previous Problems

- **One long flat page** (original, pre-any-redesign version): every KPI, chart, and the
  full building table rendered at once, in one 1,044-line component, with heavy repeat
  of the same numbers across cards/charts/table.
- **A misleading multi-scale grouped chart** ("Capacity vs. Demand by Region") plotted
  capacity, assigned, and waiting counts for each region on one shared numeric axis —
  capacity (a ceiling, often in the hundreds) and waiting demand (a much smaller
  headcount) are not comparable at the same visual scale, so the chart made minor
  regions look artificially insignificant next to large ones.
- **A separate, undifferentiated building-occupancy bar chart** duplicated exactly what
  the building table already showed, just less precisely (colored bars instead of exact
  numbers), and had no meaningful cap on "urgency" beyond raw occupancy percentage.
- **No synthesis of "what to do next"**: issues were listed, but nothing translated them
  into a next operational step, and there was no single place that compared districts
  against each other on a normalized, readable scale.
- **No drill-down surface**: clicking a building did nothing; there was no consistent
  way to go from "I see a problem" to "here are this building's exact numbers and my
  options."
- **Un-run backend/frontend changes**: the prior pass's own report explicitly states its
  15 new backend tests, its full test suite run, and any browser verification were never
  executed — "reads correctly" was not verified to actually run.

---

## 3. Final Page Structure

1. **Header** — title (ניתוח נתונים), one-line description, last-updated timestamp, data
   scope chip (region name or system-wide), the uploaded file name, Refresh, Export.
2. **Filter bar** — region select (central admin only, when >1 region), free-text
   building/region search, active-filter chips, **איפוס מסננים** reset action.
3. **4 main KPI cards** — אחוז תפוסה, מקומות פנויות, ממתינים לשיבוץ, בניינים קריטיים —
   each clickable (scrolls to the section that explains it), each with a real
   click-to-reveal definition tooltip, real status coloring, loading skeleton, and a
   handled zero state.
4. **Secondary indicator strip** — pending special requests waiting, general pending
   requests, and (only when real data exists) how long the oldest pending request has
   been waiting.
5. **Attention Queue** ("מה דורש את תשומת הלב שלך?") — ranked, deduplicated, real-data-only
   issues with 4 severity levels (קריטי/גבוה/בינוני/מידע), each with a description that
   states the affected district/building, the exact numbers, and — where a destination
   exists — a working click-through action.
6. **District Health Overview** ("מצב האזורים") — one row per district: name, a single
   normalized occupancy bar (0–100%, not mixed with raw counts), occupancy %, available
   beds, waiting students (plain number), pending special requests (or "—" when not
   resolvable), a status badge that considers shortage/occupancy/waiting-rate together
   (plus a "N buildings full" note when relevant), and a **הצג בניינים** drill-down.
7. **Capacity Pressure Analysis** — the single primary visualization (a scatter of
   available capacity vs. waiting demand per district, point size = total capacity),
   with one fully data-derived insight sentence underneath. No time-series/trend chart
   is fabricated (see §10 for why).
8. **Recommended Actions** ("פעולות מומלצות") — up to 4 cards, each a forward-looking next
   step derived from the same real signals as the Attention Queue but phrased as an
   action, each linking to an existing workflow (never performs an allocation itself).
9. **Buildings Requiring Attention** — an urgency-ranked table (data anomaly → full →
   nearly full → …, not just occupancy %), collapsed to the top ~10 most urgent
   buildings by default with a **הצג את כל N הבניינים** expander, always-available
   search/region/status filters, sortable columns, pagination once expanded, per-row
   **Details** action, and Excel export of exactly what's on screen.
10. **Building Details Drawer** — opens from the table's Details action: capacity,
    assigned, available, occupancy, a plain-language reason for the current status, and
    action buttons to the buildings list, students list, and (if permitted) the
    allocation workflow. Opens on the side opposite the app's sidebar in both RTL/LTR.
11. **Deep-dive tabs** — שיבוץ (allocation progress bars), בקשות מיוחדות (special-requests
    breakdown), קבוצות סטודנטים (student distribution by dimension), איכות נתונים (data
    source/freshness, moved out of the main overview). See §6 for why a literal
    "Overview"/"Occupancy" tab was deliberately not recreated.

---

## 4. User Interactions

- **Filters**: region (central admin) and free-text search apply consistently across
  KPIs, the Attention Queue, District Health, the visualization, and the table — all
  derived from the same fetched dataset and the same `search`/`filterRegion` state.
  Active filters render as removable chips; **איפוס מסננים** clears all of them at once.
- **Clickable KPI cards**: each of the 4 main cards scrolls to the section that explains
  it (District Health for occupancy/available/waiting, the Buildings table for critical
  buildings) — no dead clicks, and clicking never silently does nothing.
- **Attention Queue / Recommended Actions**: every item with a real destination is
  clickable (route navigation, region filter + scroll to District Health, or a table
  status filter + scroll to the table); items without a permitted action render visibly
  disabled with an explanatory tooltip, never a fake/dead button.
- **District Health rows**: **הצג בניינים** applies the district as a filter (region
  filter for central admins, table-local filter otherwise) and scrolls to the Buildings
  table.
- **Table**: search (shared with the global filter), region/status dropdowns, sortable
  columns (default sort = urgency), pagination once expanded, a details button per row
  that opens the drawer, and an Excel export of exactly the filtered/sorted rows on
  screen.
- **Drawer**: opens on click, closes on the × button, on `Escape`, or on backdrop click;
  focus moves to the close button on open (basic focus management for a modal drawer).
- **Tabs**: full WAI-ARIA tabs pattern (unchanged from the prior pass) — arrow-key
  navigation, `aria-selected`, matching `tabpanel`.

---

## 5. Backend Changes

**No backend files were modified in this session.** `backend/api/views.py` and
`backend/api/tests_analysis.py` already carried the previous pass's additive,
region-scoped extensions to `GET /api/analysis/` (per-region `assigned`/`waiting` split,
`requests_by_type`, `requests_by_region`, `oldest_pending_request_created_at`, a
minimized `recent_runs`) — this pass reused that response shape as-is, because every
new dashboard element (district status, critical-building count, urgency ranking,
recommended actions, the pressure-chart insight) is a deterministic function of fields
already present in that response.

This pass's only backend contribution was **verification**, not code: running Django
checks and the full test suite against the already-modified `views.py` (see §8) to
confirm the prior pass's unverified backend claims actually hold. No endpoint, model,
permission class, or region-scoping query was touched, so the existing permission
review in `DATA_ANALYSIS_REDESIGN_REPORT.md` §5 (region-scoped querysets, PII
minimization on `recent_runs`, the query-param-spoof tests) still applies unchanged.

**Aggregation, status logic, and performance considerations** — all now computed in the
frontend, once per already-fetched response, no additional network calls:
- District/building status classification, urgency scoring, and the Recommended Actions
  list are pure functions over the already-fetched `occupancy_data`/`students_by_region`/
  `requests_by_region` arrays (see §7) — O(buildings + regions) per render, memoized with
  `useMemo`, not recomputed on every keystroke or unrelated re-render.
- This was a deliberate choice over adding new backend fields: the dataset already
  fully round-trips per region-scoped request (at most a few hundred building rows), so
  computing "critical buildings count" or "district status" server-side would add
  response-shape churn for zero performance benefit at this data scale.

---

## 6. Frontend Changes

**New components** (`src/components/analysis/`):
- `DistrictHealthOverview.js` — replaces the old grouped/multi-scale region chart with a
  readable per-district row table (one normalized bar, not mixed-scale bars).
- `RecommendedActions.js` — converts real signals into actionable, non-duplicated next
  steps.
- `BuildingDetailsDrawer.js` — the building drill-down surface (Section 8).
- `DataQualityPanel.js` — replaces `DataFreshnessPanel.js`; same real data, now also
  flags when the latest upload is ≥14 days old, and lives in its own "איכות נתונים" tab
  instead of occupying overview space.

**Removed** (superseded, not merely restyled):
- `OccupancyRankingChart.js` — the separate building-ranking bar chart; the Buildings
  table now serves this purpose with exact numbers and true urgency ranking instead of
  approximate bar lengths.
- `DataFreshnessPanel.js` — replaced by `DataQualityPanel.js` (see above).
- `CapacityDemandChart`/`AllocationStatusChart` (previously exported from
  `RegionPressureCharts.js`) — the misleading multi-scale grouped bar and the
  100%-stacked allocation bar; both are superseded by District Health Overview, which
  shows the same underlying numbers without the misleading shared axis.
- Dead code: `RANKING_VIEWS`/`sortForRankingView` (only used by the removed ranking
  chart) and now-unused translation keys were deleted rather than left behind.

**Modified**:
- `src/pages/AnalysisPage.js` — restructured orchestration: new KPI set (4 main +
  secondary strip), District Health section, Recommended Actions, urgency-sorted table,
  drawer state, a single `handleAction` dispatcher shared by the Attention Queue,
  Recommended Actions, and District Health drill-downs (one action-shape, one place it's
  interpreted — see the code comment in `AnalysisPage.js`).
- `src/components/analysis/analysisUtils.js` — added `classifyRegionStatus`/
  `REGION_STATUS*` (district health status, considers shortage + occupancy + waiting
  rate together, not occupancy alone), `computeBuildingUrgency`/
  `countCriticalBuildings`/`isCriticalBuildingStatus` (table default sort + KPI count),
  `buildRecommendedActions` (Section 6), `buildPressureInsight` (Section 5's
  data-derived sentence), and extended `buildRegionRows` to also carry each district's
  full-building count and attributed pending-request count.
- `src/components/analysis/BuildingAnalyticsTable.js` — default sort changed from
  occupancy % to urgency; added the collapsed top-10/"show all" behavior and a
  per-row Details action wired to the new drawer.
- `src/components/analysis/AnalysisPrimitives.js` — added `AnalysisSkeleton` (loading
  skeleton, Section 10) and `SecondaryStat`; **fixed** a pre-existing (not introduced
  this pass, but small/safe to correct per the task's scope rules) invalid-HTML bug in
  `MetricCard`: it rendered as a `<button>` while also containing
  `MetricDefinitionTooltip`'s own `<button>`, producing a React
  `validateDOMNesting` console error and ambiguous keyboard semantics. Fixed by making
  the card a `<div role="button" tabIndex={0}>` with explicit Enter/Space handling
  instead of a real nested button, and stopping event propagation on the inner tooltip
  trigger so it no longer also fires the card's own click.
- `src/components/analysis/RegionPressureCharts.js` — trimmed to export only
  `CapacityPressureScatter` (now the dashboard's one visualization), with an `insight`
  prop for the data-derived sentence.
- `src/components/analysis/analysisTranslations.js` — added/renamed strings for every
  new section in both `he` and `en` (kept the codebase's existing flat-object i18n
  convention — no new library introduced); removed keys that became unused once the old
  charts were removed.

**State management**: unchanged convention — all state lives in `AnalysisPage.js` and is
passed down as props (no context provider introduced, matching the rest of the app);
expensive derivations (`regionRows`, `issues`, `recommendedActions`,
`criticalBuildingsCount`, `pressureInsight`) are `useMemo`-memoized off the same
dependency chain as before.

**Responsive/RTL**: KPI grid is now 4→2→2 columns (was 6→3→2, since there are 4 main
cards instead of 6); the drawer opens via `inset-inline-end`/flex-direction so it is
always on the side opposite the sidebar regardless of `dir`; all new tables/rows reuse
the existing logical-property CSS conventions (`text-align: start/end`,
`border-inline-start`) already established by the prior pass. Verified in the browser
at ~1430px, ~820px (see §9) with zero horizontal page overflow at either width.

---

## 7. Calculations

| Metric | Formula | Notes |
|---|---|---|
| KPI: אחוז תפוסה | `summary.occupancy_rate` (backend: `assigned_beds / total_capacity`) | status: warn if ≥90% or ≤30%, good if ≥40%, else neutral |
| KPI: מקומות פנויים | `summary.available_beds` | `total_capacity - assigned_beds`, backend-computed, floored at 0 |
| KPI: ממתינים לשיבוץ | `summary.unassigned_students` | `total_students - assigned_students`; status: good if 0, critical if >0 and `available_beds===0`, else warn |
| KPI: בניינים קריטיים | `countCriticalBuildings(occupancy_data)` | count of buildings whose status (see below) is `review`, `full`, or `nearly_full`; sub-text shows `N of <active_buildings>` using the backend's own `summary.active_buildings` |
| Secondary: בקשות מיוחדות ממתינות | `summary.priority_unassigned_students` | students with `is_priority=True` and no active bed assignment, excluding LEAVING/accessibility-flagged (same population as the solver) |
| Secondary: בקשות ממתינות | `summary.pending_requests` | count of `StudentRequest` with `status=PENDING`, region-scoped |
| Building status | `classifyBuildingStatus` | unchanged from the prior pass: `review` (capacity 0 or over-assigned) → `full` (≥100%) → `nearly_full` (≥90%) → `no_assignments` (0 assigned, capacity>0) → `underutilized` (≤30%) → `healthy` |
| Building urgency (table sort) | `computeBuildingUrgency` | `statusWeight×1000 + occupancy_rate`, weights: review=5, full=4, nearly_full=3, no_assignments=1, underutilized/healthy=0. Deliberately does **not** rank by per-building waiting demand — the data model only knows waiting demand per region (a `Student` has a region, never a specific building, before assignment), so a per-building waiting number would be invented, not real. |
| District status | `classifyRegionStatus` | `shortage` (real deficit: `waiting > available_beds`) → `high_pressure` (occupancy ≥90%, independent of waiting) → `elevated_waiting` (waiting ≥30% of the district's own students) → `underutilized` (≤30%) → `healthy`. Considers shortage + occupancy + waiting-rate together, per the brief, rather than occupancy alone; each district row additionally surfaces its full-building count and attributed pending-request count as extra context (not folded into the status itself, to avoid a metric no one asked to see hidden inside a single color). |
| Capacity-pressure chart insight | `buildPressureInsight` | counts districts where `waiting > available_beds`, names the most-pressured one by that same deficit, or (if none) names the district with the most spare capacity — a plain description of the current numbers, never a prediction |
| Recommended Actions | `buildRecommendedActions` | up to 4 cards from: cross-district capacity comparison (only when a real shortage district *and* a real spare-capacity district both exist — never asserts they're "compatible", only that reviewing them together may be worthwhile), special-request backlog, general pending-requests backlog, idle capacity + waiting students, empty-but-capacitated buildings, and stale data source (≥14 days) |

Every one of these mirrors a formula already documented (and, for the backend fields,
already tested — see §14 of `DATA_ANALYSIS_REDESIGN_REPORT.md`) in the prior pass; none
of it was changed, only consumed differently by new frontend logic.

---

## 8. Tests and Commands Run

| Command | Result |
|---|---|
| `docker exec dormify_backend python manage.py check` | **Passed** — "System check identified no issues (0 silenced)." |
| `docker exec dormify_backend python manage.py test api.tests_analysis -v 2` | **Passed — 27/27** (all analysis-endpoint tests: scoping, empty-state, region-boss/employee/central-admin authorization matrix, special-requests attribution, recent-runs field minimization) |
| `docker exec dormify_backend python manage.py test` (full backend suite) | **313/315 passed.** 2 failures, both in `api.tests_allocation` (`test_returns_completed_draft`, `test_existing_occupant_affects_second_bed_choice`) — **pre-existing**, unrelated to this work: no backend file was modified in this session (see §5), and neither failing test touches the analysis endpoint or any file this pass changed. Not fixed, per the task's scope-control instructions ("fix only if it blocks this work… otherwise document it") — see §10. |
| `docker exec dormify_frontend npm run build` (production build) | **Passed** — "Compiled successfully." No ESLint errors/warnings surfaced (CRA's build-time lint pass is part of this step). |
| Frontend dev server (`docker logs dormify_frontend`) | **Compiled successfully**, webpack watch active, page served at `http://localhost:3000/analysis` |

---

## 9. Manual Validation

Performed live in Chrome against the running `dormify_frontend`/`dormify_backend`
containers, as a `central_admin` user, in Hebrew/RTL:

- Page loads at `/analysis` with real data (708/3,365 beds occupied, 21% occupancy, 389
  waiting, 21 critical buildings, real region names, a real uploaded filename and
  timestamp) — no mock/placeholder values anywhere.
- All 4 KPI cards render with correct values, colors, and click targets.
- Attention Queue renders 8 real, correctly-severity-colored, non-duplicated issues with
  working chevron affordance.
- District Health Overview renders one row per real district with a normalized bar,
  correct status badges (including a shortage district showing its full-building
  count), and a working **הצג בניינים** action.
- Capacity Pressure scatter renders with correctly colored/sized points and a real,
  data-derived insight sentence beneath it.
- Recommended Actions renders real, non-generic cards with working CTA buttons.
- Buildings table: collapsed top-10-by-urgency view confirmed (data-anomaly and
  full-occupancy buildings sorted first, ahead of higher-numbered but less urgent
  buildings), "מוצגים 10 מתוך 93" counter correct, **הצג את כל 93 הבניינים** expander
  present.
- Building Details Drawer: opened via a row's **פרטים** button, confirmed it renders on
  the side opposite the sidebar, shows correct capacity/assigned/available/occupancy
  numbers, the correct plain-language status reason, and working navigation buttons;
  closes via the × button.
- Tabs: switched to שיבוץ (progress bars render correctly) and איכות נתונים (data-source
  chips and recent-runs list render correctly, no stale-data warning shown because the
  latest upload was under the 14-day threshold — confirming that branch is correctly
  gated, not just present).
- **Console check**: found and fixed one real bug (§6 — the nested-button
  `validateDOMNesting` warning on `MetricCard`); after the fix, re-verified with a fresh
  page load that zero console errors/exceptions remain.
- **Responsive check**: resized to ~820px (tablet) — KPI grid reflows to 2 columns,
  header wraps cleanly, no clipped content; confirmed via `document.documentElement
  .scrollWidth <= clientWidth` (`hasHOverflow: false`) at both ~1430px and ~820px — no
  horizontal page overflow at either width.

**Not manually verified this pass**: the English/LTR rendering (the language toggle
itself was not exercised — the existing i18n mechanism is unchanged from the prior
pass, which did document an LTR checklist, but this pass's new sections were only
visually confirmed in Hebrew); a non-central-admin role's view (no `region_boss`/
`employee` test credentials were available in this session — the backend's
authorization tests for those roles did pass, see §8, but the frontend chrome around
them — e.g., the missing region picker — was not re-screenshotted this pass); the
Excel export's actual downloaded file contents (the button and its loading/error state
were confirmed present in code, not re-downloaded and opened this pass).

---

## 10. Remaining Limitations

- **No historical trend chart.** As documented already in the prior pass's audit, the
  data model has no periodic occupancy/waiting snapshot table — `AllocationRun` rows are
  discrete execution events, not a time series. Building a real trend would require a
  new backend capability (a scheduled snapshot job). Per the brief's explicit
  instruction ("do not manufacture a trend… replace with a useful normalized
  capacity-pressure comparison"), the Capacity Pressure scatter fills that role instead.
  The code is structured so a trend panel could be added later without touching any
  other section (it would slot in as a sibling of `CapacityPressureScatter` in
  `AnalysisPage.js`).
- **Per-building waiting demand is not knowable.** A `Student` only has a *region*
  before assignment, never a specific building — so building urgency (§7) and the
  Buildings table cannot rank by "waiting students for this specific building," only by
  status/occupancy. This is a data-model limitation, not an oversight, and is documented
  in the code (`analysisUtils.js`) rather than worked around with an invented number.
- **Two pre-existing backend test failures** in `api.tests_allocation` (§8), unrelated
  to any file touched this session. Left unfixed and documented per the task's
  scope-control rule, since fixing them would mean debugging the allocation solver, not
  the Analysis dashboard.
- **English/LTR and non-admin-role views were not re-verified visually this pass** (§9)
  — the underlying mechanism (the same `language`/`dir` prop threading, the same
  region-scoping already covered by the passing backend authorization tests) is
  unchanged from the previously-reviewed implementation, but a fresh screenshot pass in
  those two configurations was not repeated here.
- **Academic year / semester / student-group filters were not added.** The brief asked
  for "whichever filters are genuinely supported by existing data" — the data model
  exposes region (district) and building/region free-text search, both already wired;
  it has no academic-year/semester field on `Student` or `BedAssignment` and no generic
  student-group dimension beyond the ones already shown in the "קבוצות סטודנטים" tab
  (gender/religion/category/housing/etc., which are dimensions, not filters, since
  filtering the whole dashboard by e.g. gender was not requested and would fragment an
  already-thin real dataset further). Adding fake filter controls for fields that don't
  exist would violate the "no fake data" rule.
- **Excel export contents were not re-opened/verified this pass** (§9) — the button,
  loading state, and error handling were confirmed present in code and unchanged from
  the prior pass's implementation, which did document opening and checking the actual
  file.

---

## 11. Files Changed

**Created**
- `src/components/analysis/DistrictHealthOverview.js`
- `src/components/analysis/RecommendedActions.js`
- `src/components/analysis/BuildingDetailsDrawer.js`
- `src/components/analysis/DataQualityPanel.js`
- `DATA_ANALYSIS_IMPLEMENTATION_REPORT.md` (this file)

**Modified**
- `src/pages/AnalysisPage.js`
- `src/components/analysis/analysisUtils.js`
- `src/components/analysis/analysisTranslations.js`
- `src/components/analysis/AnalysisPrimitives.js`
- `src/components/analysis/BuildingAnalyticsTable.js`
- `src/components/analysis/RegionPressureCharts.js`

**Deleted** (superseded — see §6 for why)
- `src/components/analysis/OccupancyRankingChart.js`
- `src/components/analysis/DataFreshnessPanel.js`

**Unchanged this session** (already modified by the prior, unverified pass; re-verified
but not edited)
- `backend/api/views.py`
- `backend/api/tests_analysis.py`

**Untouched** (out of scope, confirmed via repo-wide search — see §6)
- Every other page, `App.js`, `src/services/api.js`, `AuthContext.js`, the sidebar/header
  shell, `.env`.

---

## 12. How to Run

```bash
# Containers were already running for this session; if not:
docker compose up -d backend frontend

# Backend checks
docker exec dormify_backend python manage.py check
docker exec dormify_backend python manage.py test api.tests_analysis -v 2
docker exec dormify_backend python manage.py test        # full suite

# Frontend production build check
docker exec dormify_frontend npm run build

# Manual verification
# open http://localhost:3000/analysis, sign in as a central_admin
#   - confirm KPI cards, Attention Queue, District Health, the Capacity Pressure
#     chart + insight sentence, Recommended Actions, and the Buildings table all render
#   - click a KPI card, a district's "הצג בניינים", and a building's "פרטים" button
#   - try the region filter / search / table status filter, then "איפוס מסננים"
#   - switch through the שיבוץ / בקשות מיוחדות / קבוצות סטודנטים / איכות נתונים tabs
#   - resize the window to confirm no horizontal overflow and a clean 2-column
#     KPI reflow at tablet widths
```

---

## 13. Recommended Next Steps

1. **Add a real occupancy/waiting snapshot table** (e.g. a nightly job writing
   `AnalyticsSnapshot(date, region, occupancy_rate, waiting, available_beds)`), so the
   Capacity Pressure section can be upgraded to an honest trend line instead of a
   point-in-time scatter — the frontend is already structured so this would be an
   additive change, not a rewrite.
2. **Re-run the manual browser checklist in English/LTR and as a `region_boss`/
   `employee`** (credentials permitting) to visually confirm the new sections mirror
   correctly and that the region picker is correctly absent for non-admins.
3. **Consider a lightweight frontend test file** (e.g. for `classifyRegionStatus`/
   `computeBuildingUrgency`/`buildRecommendedActions` in `analysisUtils.js`) — this
   codebase currently has zero frontend automated tests at all (confirmed by search),
   so this would be a new capability, not a gap in this specific page.
4. **Address the 2 pre-existing `api.tests_allocation` failures** (§8/§10) as a separate,
   dedicated piece of work — they are in the allocation solver, not the Analysis
   dashboard, and were out of scope here.
