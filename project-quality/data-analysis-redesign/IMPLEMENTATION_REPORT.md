# Data Analysis Page Redesign — Implementation Report

**Scope:** `/analysis` page only. No changes to allocation, requests, buildings CRUD, or auth logic.

---

## 1. Previous state

The `/analysis` route (`src/pages/AnalysisPage.js`) was a dense, dashboard-style page:

- A 5-tile KPI row (total students, assigned, unassigned, occupancy, available beds), always shown together.
- An "Insights & Attention" panel with up to 6 mixed-severity items.
- Two stacked "Allocation Performance" progress bars (all students, priority students).
- An occupancy bar chart (by region or top-12 buildings, not user-selectable).
- A second bar chart with an 6–8-button "distribution dimension" switcher (gender, religion, religious preference, category, housing type, region, allocation status, priority).
- A full sortable/searchable data table of every building.
- A "Recent Data Sources" card (latest upload, latest allocation run).

Everything rendered at once, all the time. There was no way to ask one question and get one answer — every visit showed the same seven sections regardless of what the manager actually wanted to know, and the page read as a generic analytics dashboard rather than a Dormify-specific tool. Earlier redesign attempts went in the direction of *more* panels (data freshness, data quality, pressure charts), which this redesign deliberately reverses.

## 2. New product direction — "one analysis at a time"

The manager picks **one question** from **Analyze**, and the whole page reshapes around it:

1. Header (title + one-line subtitle) — static.
2. Controls: **Analyze**, **Region** (central admin only), **Group by** (only when there's a real choice), **Sort**.
3. Exactly 3 summary tiles, contextual to the selected analysis.
4. One large horizontal bar chart.
5. "What should I notice?" — 2–3 deterministic facts.
6. An optional detail panel that appears only after clicking a bar.

Changing any control never adds or removes a *section* — it only reshapes the same five sections. There is exactly one chart on screen at any time.

## 3. Changes made

| File | Change |
|---|---|
| `src/pages/AnalysisPage.js` | Full rewrite (was ~1,044 lines of dashboard UI; now ~1,075 lines implementing the single-analysis page, its chart, insights, and detail panel). |
| `backend/api/views.py` (`analysis_data`) | Additive only — two new response fields, computed from data the endpoint was already querying (see §5). No existing field, computation, or permission check was changed. |
| `src/pages/BuildingsPage.js` | Added support for a `?building=<id>` URL param (alongside the existing `?region=<id>`) so "View building details" can deep-link straight to a pre-selected building instead of just the region. ~7 lines. |
| `src/components/Sidebar.js` | English nav label changed from "Analytics & Insights" to "Data Analysis" to match the new page title (Hebrew label was already "ניתוח נתונים" / "Data Analysis" and is unchanged). |

Nothing was deleted from the backend — `analysis_data` still returns every field the old page used (`students_by_gender`, `students_by_religion`, `transfers_by_status`, etc.), it's just that the new page doesn't consume most of them anymore. Removing them was avoided on purpose: other code (or a future page) may still rely on the same endpoint, and trimming the payload was out of scope for a UX redesign.

## 4. Analysis types implemented

Four analyses, chosen because they are the ones Dormify's actual data can answer reliably (a fifth — semester-over-semester comparison — was deliberately **not** built; see §9):

- **Occupancy** — "How full is each building/region?" Grouped by Building or Region (Region only offered when the current view spans more than one region). Sorted highest-first by default.
- **Available Beds** — "Where is there room left?" Same grouping as Occupancy, same source data, different metric and coloring. Sorted **lowest-first** by default, so buildings closest to running out surface first.
- **Demand / Waiting** — "Where are students waiting the longest?" Grouped by Region only (a waiting student isn't tied to a building yet, so building-level grouping isn't meaningful). Sorted highest-first.
- **Special Requests** — "What kinds of requests are piling up?" Grouped by request type (add student, remove student, room change, apartment change, swap, region transfer, other). Sorted highest-first.

Each analysis has its own 3 summary tiles, its own bar coloring logic, and its own 2–3 insight sentences — see the page's `getSummaryMetrics`/`buildInsights` logic in `AnalysisPage.js`.

## 5. Data sources

Everything comes from the existing `GET /api/analysis/` endpoint — the page still makes **exactly one API call per region-filter change**; switching Analyze/Group by/Sort re-shapes the already-fetched payload on the client and issues no new request.

| Analysis | Backend field(s) | Notes |
|---|---|---|
| Occupancy / Available Beds | `occupancy_data` (existing, per-building: capacity, assigned beds, region) | Region-level rows are aggregated from `occupancy_data` on the client with a plain `reduce` (a few dozen buildings, not an expensive operation) — the same technique the old page already used for its region view. |
| Demand / Waiting | `unassigned_by_region` (**new**) | Per region: total students, assigned, unassigned. Built inside the same single-pass, already-existing student loop that produces `students_by_region` (region resolution via `accepted_dorm_type` → `current_dorm_type` text → `current_address` text, unchanged) — one extra query (`assigned_student_ids` set) and O(1) bookkeeping per student, no N+1. |
| Special Requests | `pending_requests_by_type` (**new**) | `StudentRequest.objects.filter(status=PENDING).values('request_type').annotate(count=Count('id'))` — a single aggregate query, scoped by the same region logic (`requested_by`/`student`/`target_room` region) already used for `pending_requests`. |
| All analyses | `summary.*` (existing) | Overall occupancy, available beds, unassigned students, pending requests, priority-unassigned — reused as-is for the first summary tile of each analysis. |

Region scoping, and the central-admin-only ability to pick a region, are entirely server-side and untouched (`analysis_data`'s existing `is_central_admin` branch); the frontend still only *offers* the region dropdown when `isCentralAdmin() && regions.length > 1`, exactly as before.

## 6. UX behavior

- **Analyze** resets Group by, Sort (to that analysis's sensible default), the current selection, and "view all" — so switching questions never leaves stale state from a different question.
- **Region** resets Group by/selection/"view all" but keeps the chosen analysis and sort.
- **Group by** only appears for Occupancy/Available Beds, and only when the current view actually spans more than one region (otherwise there's nothing to choose — Building is the only option and the control is hidden).
- **Sort** is always Highest first / Lowest first / Alphabetical, with a per-analysis default (Occupancy → highest; Available Beds → lowest, to surface shortages; Demand → highest; Special Requests → highest).
- **Top N + View all**: charts show the top 12 rows by default; a "View all N" toggle expands the rest inside a scrollable, height-capped chart area rather than shrinking every bar to fit.
- **Selection**: clicking a bar toggles a compact detail panel below the insights (click again, or the panel's close button, to deselect). Selection survives sort changes but resets on Analyze/Region/Group-by changes, since those change what's on screen.
- **Detail panel** is analysis-aware:
  - Occupancy/Available Beds → occupancy %, beds occupied/total, available beds, and either **"View building details"** (deep-links to `/buildings?region=…&building=…`, which now pre-selects that building) or **"View buildings in this region"** (`/buildings?region=…`) depending on the grouping. This intentionally reuses the existing Buildings page instead of duplicating its apartment/room breakdown.
  - Demand → waiting count, assigned/total, available beds in that region (when known), with the same "View buildings in this region" action.
  - Special Requests → pending count for that type, with a **"Review requests"** action to `/transfers` (the existing unified request-review page).
- **RTL/Hebrew**: the page shell uses `dir={isHebrew ? 'rtl' : 'ltr'}` exactly like the rest of the app; all copy comes from an inline `t` dictionary (the codebase's existing per-page translation convention — see `HomePage.js`); logical CSS properties (`padding-inline-start`, `inset-inline-start`) are used instead of `left`/`right` so bullets, chips, and layout mirror correctly; the one directional icon (the detail panel's arrow) is flipped with `[dir="rtl"] .an-detail-action svg { transform: scaleX(-1) }`. Recharts itself does not mirror the bar chart's internal layout for RTL — the surrounding page does, but the chart canvas always draws left-to-right internally. This matches the previous page's behavior and is a Recharts limitation, not something introduced here.
- **Responsiveness**: controls wrap; the 3-tile metrics row collapses to a single column under 640px; the chart's `ResponsiveContainer` already handles width; nothing is hidden on narrow screens.
- **States**: loading spinner, error panel with Retry, and a per-chart empty state (`t.noData`) are all handled; numbers are always passed through `num()`/`formatNumber()` so `undefined`/`null`/`NaN` can never reach the screen — a missing value falls back to `0` (or `'—'` for a metric tile with no rows to summarize), never a raw `undefined`.

## 7. Performance

- **One network request** per region-filter change (unchanged from before); Analyze/Group by/Sort/selection are pure client-side re-derivations (`useMemo`) of the same payload — no re-fetching, no request storms from re-renders.
- The two new backend fields add **at most one extra query** (`assigned_student_ids`, a flat `values_list`) and **one small aggregate query** (`pending_requests_by_type`) to a request that already ran several similar queries — no N+1, no per-building or per-student round trips. `unassigned_by_region` costs nothing extra beyond that single query: it's computed inside the loop that already exists for `students_by_region`.
- Region-level aggregation (occupancy/available beds "by region") is done client-side over the building list already returned in the same response — the same technique, and the same data volume (tens of buildings, not thousands), the old page already used for its region view.
- Chart height scales with row count and is capped with a scrollable container past 12 rows, so a system with many buildings doesn't make the page hang or render an unreasonably tall/illegible chart.

## 8. Verification

**Verification constraints at this stage:** no reachable database or running application server was available yet, so the app could not be exercised end-to-end in a live browser against real data during this phase — that live verification was completed in the next revision (§10).

**What was actually run:**
1. `python -c "import ast; ast.parse(...)"` and `python manage.py check` (Django system check) against `backend/api/views.py` — clean, no syntax/import errors.
2. Existing `api/tests_analysis.py` suite (12 tests: unauthenticated access, empty-DB zero state, region-boss/employee/central-admin scoping, query-param spoofing rejected, pending-requests scoping, latest-batch scoping) — run against a throwaway local SQLite DB (Postgres unreachable) — **12/12 passed**, confirming the edits didn't change any existing behavior.
3. A temporary, purpose-built test (deleted after use) seeding two regions with a mix of assigned/unassigned students and three `StudentRequest`s of two types — verified `unassigned_by_region` and `pending_requests_by_type` return exactly the expected per-region and per-type counts, and that the pre-existing `summary` numbers are unaffected — **passed**.
4. Full `python manage.py test api` (361 tests) — **340 passed**; the 21 failures/errors are all in `api/tests_allocation.py` (the allocation-solver test suite, unrelated to `analysis_data`) and are pre-existing environment issues: 20 are `UnicodeEncodeError` from the tests' own `print()` debug output hitting Hebrew text on this Windows machine's `cp1252` console (nothing to do with any code change), and 1 (`test_existing_occupant_affects_second_bed_choice`) is a solver-assignment assertion that has no code path anywhere near `analysis_data`. None of the analysis tests are in this list.
5. `npx react-scripts build` — **compiled successfully, zero ESLint warnings/errors** across the whole app (this project's build treats its lint config as part of the compile step, so a clean build is a meaningful signal — it also confirms `BuildingsPage.js` and `Sidebar.js` still compile correctly).
6. Manual code trace against the task's 20-point checklist (permissions logic diffed line-by-line against the untouched original `analysis_data` scoping code; every `useMemo`/handler reset path traced by hand for each Analyze/Region/Group-by/Sort combination; every string interpolation checked for `undefined`/`NaN` exposure).

**Not verified (be honest about this):** actual on-screen rendering, click interactions, and RTL layout were **not** visually confirmed in a running browser, because no reachable backend was available in this environment to serve real (or seeded) data to the dev server. Before this ships, it should be clicked through manually against the real (or docker-compose) stack — Analyze/Region/Group by/Sort combinations, the empty-region/empty-database case, and Hebrew ↔ English toggling — using the checklist in the task description.

## 9. Remaining limitations

- **No "Compare with previous semester" control.** `Student`, `ImportBatch`, and `AllocationRun` carry no semester/period field anywhere in the schema (verified by inspecting `backend/api/models.py`), so there is no real historical dataset to compare against. Building the control would mean fabricating comparison numbers, which the task explicitly forbids. The control was left out entirely rather than shipped disabled, to avoid dead UI. If the data model gains a genuine period concept, a "Compare with" control can be added next to Sort without touching anything else on the page.
- **`unassigned_by_region` only counts students whose region can be resolved** (via `accepted_dorm_type`, then `current_dorm_type` text, then `current_address` text — the same fallback chain `students_by_region` already used). A student with none of those set is invisible to the Demand analysis, so the sum of `unassigned_by_region` can be slightly less than `summary.unassigned_students` system-wide. This mirrors a pre-existing characteristic of `students_by_region`, not a new gap.
- **Recharts does not mirror the bar chart canvas for RTL.** The page shell, controls, and text are fully RTL-aware; the chart itself always draws left-to-right internally, matching the previous page's behavior.
- **No live browser verification in this environment** (§8) — recommend a manual click-through against a reachable backend before merging.

**Note: §9's Recharts/RTL limitation and the "no live browser verification" limitation were both resolved in the second revision below — the chart was removed entirely, and this time Docker was running, so the page was clicked through live.**

---

## 10. Second revision (v3.1) — visual/UX polish pass

The first redesign (§1–9 above) fixed the *product direction* — one analysis at a time instead of a seven-section dashboard. It did **not** fix the *visual execution*: once it could actually be looked at in a running browser, it was clear the page still read as unfinished. This section documents the second pass, on the same backend, same four analyses.

### 10.1 What was wrong with the first redesign, visually

Looking at the live page instead of just the code:

- **The page felt too empty.** Header → 3 small metric tiles → one big chart → insights box → nothing. Large areas of flat white with little going on.
- **The chart itself looked like a generic demo.** A plain Recharts horizontal bar chart with axis lines, gridlines, and a `LabelList` — visually indistinguishable from a tutorial chart, not something that reads as "a Dormify tool."
- **Label/value presentation was weak.** Category labels sat in a fixed-width axis column that clipped or crowded long building names in Hebrew; the value label floated to the right of each bar with no supporting context (no "X of Y", no available-beds count) next to it.
- **RTL was only "not broken," not "designed."** Recharts draws its bar canvas left-to-right no matter the page direction (documented as a known limitation in §9), so the one visual element that mattered most looked subtly foreign in Hebrew.
- **The bottom of the page was weak.** "What should I notice?" was the last thing on the page, a plain bulleted list with nothing after it — the page just stopped.
- **No persistent detail view.** The detail panel only existed after a click, so the very first thing a manager saw on load was the chart and nothing else — no worked example of "what does *this* number actually mean."

### 10.2 What changed in this revision

Same `analysis_data` endpoint (**zero backend changes this round** — every field the new UI needed, including the four snapshot-strip numbers, was already in the existing `summary` object), same four analyses, same permission/grouping/sorting logic, same deterministic-insights approach. Only `src/pages/AnalysisPage.js` changed:

- The Recharts bar chart was **removed entirely** and replaced with a custom-built ranked row list (plain HTML/CSS, no charting library) — see §10.3.
- A slim **snapshot strip** was added under the header: four always-visible global numbers (Occupancy, Available Beds, Waiting Students, Pending Requests), sourced directly from the same `summary` object every analysis already reads — no new request, no new field.
- The 3 contextual metric tiles were **removed** — their job (surfacing the highest/lowest/most-notable item) is now done more concretely by the ranked list itself (which literally *is* sorted by that metric) and by Key Findings.
- The controls bar was **tightened**: smaller paddings, a shorter row, no separate label/value stacking beyond what's needed.
- The detail panel became **always visible**, not click-triggered: the page auto-selects the top row of the current sort on load and on every Analyze/Region/Group-by/Sort change (an effect keyed on the sorted row list, not on the selection itself, so clicking a different row never gets stomped by the auto-select). Clicking any row simply swaps the selection — there is no more "click again to close," since the panel is now a permanent part of the layout.
- "What should I notice?" was renamed **Key Findings** and restyled with a header icon; the underlying `buildInsights()` logic is untouched.
- A new **Status Breakdown** section was added below Key Findings — small colored chips summarizing the *entire* current row set (not just the visible top 12) into Critical/Near capacity/Healthy counts (Occupancy, Available Beds), Over capacity/Within capacity counts (Demand), or one chip per request type (Special Requests).
- A real, pre-existing RTL bug in the number-ratio strings (e.g. "assigned / total") was found and fixed while building this — see §10.6.

### 10.3 New layout structure

```
Header (title, subtitle, last-updated, refresh)
Snapshot strip (Occupancy · Available Beds · Waiting Students · Pending Requests)
Controls bar (Analyze · Region · Group by · Sort · Reset)
┌─────────────────────────────┬───────────────────────┐
│ Ranked analysis list          │ Selected item panel   │
│ (rank · name · value ·        │ (badge, big metric,   │
│  progress bar · context ·     │  facts, mini          │
│  status badge)                │  breakdown bar,       │
│                                │  action button)       │
└─────────────────────────────┴───────────────────────┘
Key Findings (2–3 deterministic bullets)
Status Breakdown (compact colored chips)
```
Two-column on desktop (`grid-template-columns: 1.6fr 1fr`), single column (list, then panel) under 980px. In RTL the grid direction mirrors automatically — the ranked list lands on the visual right (reading start) and the detail panel on the visual left, matching how a Hebrew reader's eye moves through the page; this was confirmed live, not just assumed.

### 10.4 What was added, concretely

- **Ranked rows** (replacing the chart): each row is rank number → name → value → a full-width progress-bar track whose fill uses `width: X%` inside a plain block element — no `left`/`right`, no manual RTL mirroring code. Because the fill is just normal block-flow content, it starts from the reading-start edge on its own (right edge in Hebrew, left edge in English) with zero direction-specific CSS. That single choice is what fixes the Recharts RTL limitation called out in §9 — not a workaround, the underlying cause (a canvas-based charting library with a fixed internal draw direction) is simply gone.
- Below the bar: a context line with real numbers (`688 / 775 beds occupied · 87 available beds`, `834 waiting · 0 / 834 assigned`, etc.) and, when notable, a small colored badge (Critical / Near capacity / Over capacity) — never a "Healthy" badge on every single row, to keep the list scannable instead of noisy.
- **Snapshot strip**: 4 numbers with small icons (`lucide-react`'s `Building2`, `BedDouble`, `Users`, `ClipboardList`), separated by thin vertical dividers instead of 4 separate bordered cards — reads as one compact strip, not four more empty boxes.
- **Selected item panel**: eyebrow label ("Selected") + name + status badge, a large primary metric, 2–3 fact pairs (occupied/total, available beds, and — for region rows — a building count computed client-side from the same building list already in memory), a two-segment mini breakdown bar with a text legend (e.g. "assigned: 688 · available beds: 87"), and the existing navigation action ("View building details" / "View buildings in this region" / "Review requests") — unchanged destinations, just restyled.
- **Status Breakdown chips**: computed with the same `getRowTone()` classification the rows already use, just aggregated over every row instead of shown per-row — genuinely new information (a system-wide health count), not a restyled duplicate of the list.

### 10.5 How the visual presentation improved

- The page now has five distinct sections with real content in each, instead of two sections (chart + insights) surrounded by whitespace.
- Every number on screen now has a label, a comparison, or a color meaning attached to it — nothing is a bare digit in isolation.
- The ranked list reads as a **designed Dormify component** (rank badges, colored status pills, custom progress bars) rather than an embedded charting-library widget.
- RTL is no longer "the same as LTR but mirrored by the browser's default block flow" — it is **actively correct**, including a fixed bidi bug (§10.6) that the first redesign's own code had already introduced without noticing, because a chart library doesn't run into this class of bug the way inline ratio text does.

### 10.6 A real bug found and fixed during this pass

While reviewing the live Hebrew page, `assigned / total` style fact values (e.g. "0 / 834") were rendering **visually reversed** ("834 / 0") inside the RTL detail panel. Root cause: `"0 / 834"` has no strong-direction character (digits are bidi-weak, `/` and spaces are neutral), so inside a right-to-left paragraph the Unicode Bidi Algorithm reorders the neutral/weak run to match the surrounding paragraph direction. The fix — a small `<NumRatio>` helper that wraps the pair in `<bdi>` (the same isolation technique the original code already used for the header's last-updated timestamp) — pins the ratio to a stable left-to-right reading order regardless of the surrounding language. Applied everywhere a `"a / b"` pattern appears (ranked-row context text, detail-panel facts). This was caught only because the page was actually opened live in Hebrew — it's the kind of bug that a code read-through, however careful, does not surface.

### 10.7 What was tested this round

- `CI=true npx react-scripts build` — **compiled successfully, zero ESLint warnings/errors** (twice: once before the bidi fix, once after).
- `python manage.py check` — clean (no backend changes were made, so this just re-confirms nothing regressed).
- `python manage.py test api.tests_analysis` — **12/12 passed**, run against the real project database via the running `dormify_backend`/Postgres containers.
- **Live browser click-through** (`dormify_frontend` at `localhost:3000`, logged in as the seeded central-admin user), covering:
  - Default load in Hebrew/RTL: snapshot strip, controls, ranked list, auto-selected top row's detail panel, Key Findings, Status Breakdown all rendered with real data.
  - Switching **Analyze** through all four analyses (Occupancy, Available Beds, Demand/Waiting, Special Requests) — list, detail panel, findings, and status chips all updated correctly each time; Special Requests correctly showed the empty state (this seeded dataset has 0 pending requests) without any layout breakage.
  - **Group by** (Region ↔ Building) on Available Beds — control appears/disappears correctly, badges and facts recompute.
  - **Sort** default per analysis (Occupancy → highest-first, Available Beds → lowest-first) confirmed correct on switch.
  - **Clicking a row** to change the selection — confirmed the panel updates and the rank badge highlights.
  - **Auto-select-top-row** behavior — confirmed on every Analyze/Region/Group-by/Sort change.
  - **Hebrew ⇄ English toggle** — full page re-rendered correctly in LTR, including the ranked-list/detail-panel column order mirroring, the fixed number ratios, and the action button's arrow direction.
  - Fixed and re-verified the RTL number-ratio bug described in §10.6.
- **Not independently re-verified this round** (unchanged from §1–9 and not touched by this revision, so treated as still valid): region/role permission scoping (the exact same `canPickRegion` line and server-side `analysis_data` scoping), the loading spinner and network-error panel (logic untouched, only restyled).
- **Not verified in this environment**: narrow-viewport (mobile) responsiveness could not be visually confirmed — attempting to resize the viewport programmatically did not actually shrink the rendered page in this environment (it reported success but `window.innerWidth` stayed at the wide value). The mobile CSS (`@media (max-width: 980px)` collapses the two-column grid to one column; `@media (max-width: 640px)` stacks the snapshot strip and controls) follows the same breakpoint pattern already used and shipped in this codebase, but it was not literally seen on a narrow screen this round — treat this specific claim as code-reviewed, not screenshot-verified.

### 10.8 Remaining limitations after this revision

- Narrow-viewport layout is untested live in this environment (§10.7) — worth a quick manual check on an actual small window or device before merging.
- The seeded local database used for this round's live testing has **zero pending `StudentRequest`s**, so the Special Requests analysis's populated state (ranked rows with request-type badges, the detail panel's "share of all pending requests" mini bar, and the Status Breakdown request-type chips) was verified by code review and by the same rendering components working correctly for the other three analyses, but not seen on screen with real non-zero request data.
- Everything listed under §9 that this revision did not touch (the `unassigned_by_region` region-resolution fallback chain, the `Region.name` uniqueness assumption) still applies unchanged.

---

## 11. Visual Analytics Redesign (v4)

**Current state of the page**, superseding §1–10. This round was commissioned explicitly as a product-design task ("not just a CSS cleanup") because v3.1's ranked-row list, while no longer empty or chart-generic, still made every analysis look like the same component with different numbers — the exact failure mode this round exists to fix. Full narrative, screenshots-in-prose, and design rationale live in the supporting design-history document, `DATA_ANALYSIS_REDESIGN_DESIGN_HISTORY.md` §26 ("Visual Analytics Redesign (v4)"); this section is the technical-implementation summary.

### 11.1 What changed, technically

`src/pages/AnalysisPage.js` only — full rewrite (was ~1,323 lines in v3.1, now a larger file implementing four distinct hand-built chart components instead of one ranked-row component). **Zero backend changes** — every field the new charts need was already in the `analysis_data` payload from v3/v3.1 (`occupancy_data`, `unassigned_by_region`, `pending_requests_by_type`, `summary`). No new dependency was added; `recharts` remains in `package.json` unused, as it has been since v3.1, because it cannot mirror for RTL.

### 11.2 New chart components (all hand-built, no charting library)

| Component | Analysis | Mechanism |
|---|---|---|
| `OccupancyColumnChart` | Occupancy | Flexbox columns, height % = occupancy rate (0–100 shared scale), fill colour = status tone |
| `AvailableStackedChart` | Available Beds | Flexbox columns, height % = `total_beds / max(total_beds)` across the current view, two absolutely-positioned segments inside (occupied grey, available teal) sized by their share of that bar |
| `DemandGroupedChart` | Demand / Waiting | Two flexbox columns per region (waiting, available capacity), both scaled against one shared `max(waiting, available)` value — never two separate axes |
| `RequestsDonut` | Special Requests | A single `conic-gradient` div per state (active/muted), computed in JS from a **fixed** category-key order (`REQUEST_TYPE_ORDER`), with a `mixWithWhite()` helper to compute the de-emphasised "muted" colour for non-selected slices on the fly rather than hand-picking a second hex per colour |

Plus three secondary-visual components (`CapacityBreakdownPanel`, `TopAvailablePanel`, `DemandSharePanel`) that render only for their respective analysis and only when they show a genuinely different cut of the data than the main chart (see rationale in the final report §26.5); `Special Requests` renders no secondary panel, and the secondary-grid CSS collapses from a 2-column to a 1-column layout in that case (`.an-secondary-grid.is-single`) rather than leaving an empty box.

### 11.3 Colour system

- Reused, unchanged: the existing status-tone hexes (`#16a34a`/`#d97706`/`#dc2626`) already used across the app for healthy/caution/critical.
- New: `ANALYSIS_META`, a 4-entry table mapping each analysis to an accent/tint/icon-background triple, copied **verbatim** from the exact values `HomePage.js`'s `KpiRow` already uses for these same four metrics (occupancy blue `#2563eb`/`#dbeafe`, beds teal `#0d9488`/`#ccfbf1`, unassigned/demand amber `#d97706`/`#fef3c7`, requests violet `#7c3aed`/`#ede9fe`) — a direct, intentional visual tie back to the Homepage without duplicating its layout.
- New: `CATEGORICAL_PALETTE`, an 8-hue array (blue/orange/aqua/yellow/magenta/green/violet/red) used for the Special Requests donut (first 7 slots) and the Demand-share secondary donut (all 8, cycled). This is the dataviz design skill's documented default categorical order, chosen because it is pre-validated rather than because it's a Dormify brand colour — see the validation run below. `REQUEST_TYPE_COLORS` maps each of the 7 fixed request-type keys to a fixed slot so a category's colour never changes regardless of sort order or live counts.

**Validation performed**: `node scripts/validate_palette.js "#2a78d6,#eb6834,#1baf7a,#eda100,#e87ba4,#008300,#4a3aa7" --mode light` (the dataviz skill's own validator, run against the exact 7 hex values used) — **all checks passed**: lightness band, chroma floor, CVD adjacent-pair separation (worst case ΔE 9.1, above the ≥8 target), and normal-vision adjacent-pair separation (worst case ΔE 19.6). The contrast-vs-surface check WARNs on 3 of the 7 slots (aqua/yellow/magenta, all under 3:1 against white) — this is a documented, accepted trade-off of that palette, mitigated in this UI by never using colour alone: every donut segment has a persistent label + count + percentage in the legend list, never gated behind hover.

### 11.4 RTL mechanism (why no per-chart RTL code was needed)

Every chart is built from ordinary CSS flexbox rows (`display:flex; flex-direction:row`) inside an element that inherits `dir="rtl"`/`dir="ltr"` from the page root. Flexbox's `row` axis is direction-aware by specification, so bar order reverses automatically with zero direction-conditional CSS or JS in any chart component. The one exception in the whole page is the existing `[dir="rtl"] .an-detail-action svg { transform: scaleX(-1) }` rule (unchanged from v3/v3.1) for the detail panel's directional arrow icon. Long Hebrew building/region names are handled with `-webkit-line-clamp: 2` under each column plus the native `title` attribute for the full string on hover/focus — this was chosen deliberately over truncation-with-ellipsis so no information is silently hidden.

### 11.5 Testing performed this round

1. `CI=true npx react-scripts build` — compiled successfully, zero ESLint warnings, run twice (before and after the live browser session).
2. `docker exec dormify_backend python manage.py test api.tests_analysis --keepdb` — **12/12 passed** against the real project database (no backend changes this round, so this is a regression check, not new coverage).
3. `node scripts/validate_palette.js` (dataviz skill) — the categorical palette check described in §11.3.
4. **Live browser verification**, via automated browser testing against the actual running `docker compose` stack (`dormify_frontend`/`dormify_backend`/`dormify_test_db` containers), logged in as the seeded central-admin user:
   - All 4 analyses switched and rendered with real data, in both Hebrew/RTL and English/LTR.
   - `Group by` Region ↔ Building on Occupancy, including the 96-building "View all" scrollable state.
   - Row/bar selection updating the detail panel live (clicked a different Demand region bar, confirmed the ring, headline number, and facts all updated together).
   - The Special Requests **empty state** (0 pending requests in this seeded DB) — clean messaging, no layout break, secondary column correctly collapsed to 1 column.
   - Console checked for runtime errors at each step — none found (only 2 pre-existing React Router future-flag warnings, unrelated).
   - Cross-check: the detail panel's "View buildings in this region" action still deep-links to `/buildings?region=…` correctly (unchanged navigation logic from the first redesign pass).
5. **Environment note**: intermittent `ERR_NETWORK` failures occurred from the browser to `localhost:8000`/`3000` during testing. Confirmed via direct `curl` from the host machine, during the same failures, that both Django and the CRA dev server were responding instantly — the flakiness was in the local test network path, not the app. The identical flakiness was reproduced on the unrelated, untouched Homepage and Buildings pages, confirming it was environmental. Every failure recovered on retry.
6. **Not verified live**: narrow-viewport responsiveness — the programmatic viewport resize did not visibly reflow the rendered page in this environment (a repeat of the same tooling limitation documented in §10.7/§25.7 for prior rounds). The CSS breakpoints are unchanged in structure from the already-shipped prior rounds' pattern.

### 11.6 Remaining limitations

Same as §10.8, plus: the donut's individual wedges are legend-driven (click/hover a legend row to select), not independently hover-interactive per wedge — a scope decision, not an oversight, since every value a wedge hover would reveal is already permanently visible in the legend. Narrow-viewport layout remains code-reviewed only, not screenshot-verified, in this environment.

---

## 12. Final Visual/Product Polish (v4.1)

**Current state of the page**, superseding §1–11. Requested as one final comprehensive pass, targeting three specific, named gaps in v4 rather than a general re-polish: the top-of-page header still read as pale/flat/empty, hover states used the native browser tooltip, and zero-value bars were near-invisible slivers. Full narrative and rationale in the supporting design-history document, `DATA_ANALYSIS_REDESIGN_DESIGN_HISTORY.md` §27; this section is the technical summary. **Zero backend changes.** Chart types chosen per analysis in §11 are unchanged.

### 12.1 What changed, technically

`src/pages/AnalysisPage.js` only, three isolated changes:

1. **Header/toolbar merge.** The plain `<header className="an-header">` and the separate `.an-toolbar` block were replaced by one composed `<section className="an-intro">` with two child layers: `.an-intro-dark` (a `linear-gradient(135deg, #0c1424, #16213b, #1c2c4c)` panel holding the eyebrow kicker, title, subtitle, updated/refresh, and — moved inside the same dark surface — the Analyze segmented control as light pills, `.an-seg-dark`) and `.an-intro-controls` (the pre-existing light `#f8fafc` strip holding Region/Group/Sort/Reset, functionally unchanged, just relocated and restyled to sit flush under the dark panel with no gap). All state/handlers (`handleAnalysisChange`, `handleRegionChange`, `handleGroupByChange`, `handleSortChange`, `handleReset`) are untouched — this is a pure markup/CSS relocation, no logic changed. Old CSS classes (`.an-header`, `.an-subtitle`, `.an-header-actions`, `.an-updated`, `.an-refresh-btn`, `.an-toolbar*`, `.an-seg-primary`) were removed and replaced by their `.an-intro-*`/`.an-seg-dark` equivalents; the two `@media` blocks that referenced the old class names were updated to the new ones (`.an-intro-row1`, `.an-intro-meta`, `.an-intro-dark`, `.an-intro-controls`).
2. **Tooltips.** A new shared `BarTooltip({ label, children })` component renders a `.an-tooltip` div (dark rounded panel, pointer-arrow via `::after`, `opacity`/`transform` CSS transition) as the last child of each chart item (`.an-col-item`, `.an-group-item`, both now `position: relative`), revealed via `:hover`/`:focus-within` on the parent — no JS mouse-position tracking. Content is the existing `rowContext(analysis, row, t, language)` function (already used for each chart's on-screen context text), so the tooltip text is guaranteed to match what the ranked context line elsewhere already says. Native `title` attributes were kept on every bar button as a redundant accessibility/touch fallback.
3. **Zero-value markers.** Each of the three column-based chart components (`OccupancyColumnChart`, `AvailableStackedChart`, `DemandGroupedChart`) now computes an `isZero` boolean per bar (`pct <= 0` / `totalPct <= 0` / `waitPct <= 0` and `availIsZero` independently for the Demand chart's second bar) and, when true, renders the bar with a fixed small height (`7px`/`6px`), `background: transparent`, and an added `is-zero` class that applies a `1.5px dashed #cbd5e1` border via CSS — replacing what was previously a `min-height: 3px` sliver of the bar's normal fill colour. The value label above the bar (`0%`/`0`) is unaffected and still renders. Selected zero bars get `border-style: solid; border-color: var(--accent)` so "selected" reads distinctly from "zero, unselected."

### 12.2 Design rationale (condensed — see design history §27 for full detail)

The header change specifically avoids two things the brief called out: it does not copy the Homepage's greeting hero (no username, no "good afternoon," no workflow-stage pill — an uppercase "ANALYTICS" kicker instead names the page as a workspace), and it does not reintroduce a KPI-card row (the dark panel's only numeric content is the existing per-analysis stat pills in the hero chart card below, unchanged from v4). It does reuse Dormify's own established dark-surface + translucent-pill vocabulary (the Homepage hero's `rgba(255,255,255,0.08)` action-panel treatment), which is the intended kind of "still looks like Dormify" continuity, applied to different content and a different, more restrained gradient with no radial glow.

### 12.3 Testing performed this round

1. `CI=true npx react-scripts build` — compiled successfully, zero ESLint warnings.
2. `docker exec dormify_backend python manage.py test api.tests_analysis --keepdb` — **12/12 passed** (regression check only; no backend changes).
3. **Live browser verification**, via automated browser testing against the running `docker compose` stack (frontend container was restarted so its webpack watcher picked up the file change, as in prior rounds), logged in as the seeded central-admin user:
   - New dark/light workspace-intro panel confirmed rendering correctly in both Hebrew/RTL and English/LTR — screenshotted at each step.
   - Custom hover tooltip confirmed on the Occupancy chart (dark panel with arrow, correct `rowContext` text including the `<bdi>`-wrapped ratio) and on the Demand grouped chart (one tooltip per region group).
   - Zero-value dashed markers confirmed visually distinct from solid bars on the Occupancy chart (five 0% buildings next to one 89% building in the seeded dataset), value labels still shown, no layout break.
   - All four Analyze options switched correctly with the dark segmented control's active-pill accent colour changing per analysis; Reset button and Group control appear/disappear correctly per analysis.
   - Console checked — no errors, only the pre-existing unrelated React Router future-flag warnings.
4. **Not verified live**: narrow-viewport responsiveness — same tooling limitation as every prior round (programmatic viewport resize does not visibly reflow the rendered page in this environment). Media-query selectors were updated to match the new markup but not re-confirmed on an actual narrow screen.

### 12.4 Remaining limitations

Same as §11.6, unchanged. Narrow-viewport layout remains the one open item carried across every round of this work.
