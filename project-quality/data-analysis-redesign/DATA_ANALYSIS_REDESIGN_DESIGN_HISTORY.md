# Data Analysis Page Redesign — Final Report (v3)

> **Supporting design/revision history — not the primary report.** This document is the
> chronological design-and-revision log for the `/analysis` page redesign, preserved for its
> detailed design rationale and testing narrative. For the current, primary description of the
> finished feature, see `IMPLEMENTATION_REPORT.md` in this same folder. Nothing below this note
> has been altered — this file's technical content, metrics, and results are unchanged.

---

## READ THIS FIRST: four design revisions

This document was originally written after the **first** redesign pass (§1–24 below: replacing the old 7-section dashboard with a "one analysis at a time" page). A **second** pass (§25, "Second revision (v3.1)") fixed how that first version *looked* by replacing a generic Recharts bar chart with a hand-built ranked-row list. A **third** pass (§26, "Visual Analytics Redesign (v4)") replaced that ranked-row list with four purpose-built chart forms, one per analysis. A **fourth, final** pass — **[§27, "Final Visual/Product Polish (v4.1)"](#27-final-visualproduct-polish-v41)**, at the very end of this file — is the current state of the page: it targets the one thing v4 still got a specific complaint about — the top of the page reading as "pale, flat, empty, not premium enough" — by replacing the plain header + light toolbar with one composed dark analytical-workspace intro panel, and it adds real hover tooltips (replacing native browser tooltips) plus explicit zero-value chart markers so `0%`/`0` always reads as real, intentional data rather than a rendering gap. **Read §27 for the current state of the page.** §1–26 are kept for history; where superseded, §27 says so explicitly.

---

## Summary

- The old Data Analysis page (a crowded dashboard with 5 KPI cards, an insights panel, 2 progress bars, 2 charts, an 8-button distribution switcher, a full sortable table, and a "recent activity" card) was replaced with a single-question page: pick **one** thing to analyze, and the whole page reshapes around it.
- Four analyses are implemented: **Occupancy**, **Available Beds**, **Demand / Waiting**, **Special Requests** — all backed by real data, nothing fabricated.
- A "Compare with previous semester" control was deliberately **not** built — the database has no semester/period field anywhere, so there is nothing real to compare against. It is documented as a clean extension point instead of faked.
- The backend endpoint (`/api/analysis/`) gained two small additive fields (`unassigned_by_region`, `pending_requests_by_type`) to power the new analyses. Nothing existing was removed or changed, and it remains one API call per region change — no new N+1 queries.
- The frontend production build compiles cleanly with **zero lint errors/warnings**, and the existing backend test suite for this endpoint passes **12/12**, plus a temporary test written specifically to check the two new fields — also passed.
- **Live browser verification was not possible at this stage.** No Docker environment or reachable database was available in this environment to stand up a seeded local server. This was the main open item before the work could be considered complete: an on-screen click-through. (This gap was closed in the next revision — see §25.)
- **Assessment at this stage: the implementation was complete and its logic traced by hand and confirmed by every automated check available, but it was not yet "browser-verified."** It was treated as ready for review, not as a finished, rubber-stamped product.

---

## 1. What Changed

The entire `/analysis` (Data Analysis) page was redesigned from a multi-section analytics dashboard into a single-question, single-chart page, with two small, additive backend changes to support it. No other page's functionality, permission logic, or unrelated backend endpoint was touched.

## 2. Why It Changed

The design brief was explicit: the old page "feels too much like a complicated analytics dashboard," and the goal was "ONE analysis at a time" — a manager picks a question, sees one clear answer, and can drill in if they want more. The old page showed 7 sections simultaneously regardless of what the manager actually wanted to know. The new page shows exactly: controls → 3 metrics → 1 chart → insights → (optional) detail panel, and every control reshapes that same structure instead of adding new sections.

## 3. Main frontend files changed

- **`src/pages/AnalysisPage.js`** — completely rewritten (was ~1,044 lines, now ~1,075 lines, but a fundamentally different structure). This is the entire redesign.
- **`src/pages/BuildingsPage.js`** — small addition (~7 lines): the page now reads a `?building=<id>` URL parameter (in addition to the `?region=<id>` it already supported) and pre-selects that building on load. This lets the new Data Analysis page's "View building details" button deep-link straight to a specific building instead of just the region.
- **`src/components/Sidebar.js`** — one-line change: the English nav label for this page changed from "Analytics & Insights" to "Data Analysis" (the Hebrew label, "ניתוח נתונים", already meant "Data Analysis" and was left untouched).

## 4. Main backend files changed

- **`backend/api/views.py`**, function `analysis_data` (the view behind `GET /api/analysis/`) — the only backend file touched. All changes are additive (new fields), nothing existing was removed, renamed, or had its behavior changed.

## 5. Any API changes

`GET /api/analysis/` gained two new fields in its JSON response. Everything else in the response is unchanged (same fields, same shapes, same values).

- **`unassigned_by_region`** — new. A list of `{ region, region_id, total_students, assigned_students, unassigned_students }`, one entry per region that has resolvable students. Powers the "Demand / Waiting" analysis.
- **`pending_requests_by_type`** — new. A list of `{ request_type, count }` — how many *pending* `StudentRequest`s exist for each request type (add student, remove student, room change, apartment change, swap, region transfer, other). Powers the "Special Requests" analysis.

No existing endpoint, field, request parameter, or status code changed. No new endpoint was created — the existing one was reused rather than adding a new route, to avoid unnecessary duplicate API calls.

## 6. Any database/query changes

**No migrations. No schema changes.** Only what the existing `analysis_data` view queries and computes was changed:

- Added one extra lightweight query: `assigned_student_ids = set(assignments_qs.values_list('student_id', flat=True))` — used to classify each student as assigned/unassigned while building `unassigned_by_region`, inside a loop that was *already* iterating over every student for the existing `students_by_region` field. This adds no new per-row queries (no N+1) — it's one query, reused across the whole loop.
- Added one small aggregate query for `pending_requests_by_type`: `requests_qs.values('request_type').annotate(count=Count('id'))` — the same pattern already used elsewhere in this same view for `transfers_by_type`.
- Added one more query to build a `region_name → region_id` lookup (`{r.name: r.id for r in Region.objects.all()}`) — the `Region` table is tiny (a handful of rows), so this is negligible.

Net effect: the endpoint now runs a small, fixed number of additional cheap queries (not proportional to the number of students or buildings) per request — no new N+1 pattern was introduced anywhere.

## 7. How the new Data Analysis page works

Top to bottom:

1. **Header** — "Data Analysis" title + one-line subtitle ("Explore occupancy, capacity, and housing demand across Dormify."), plus a small "last updated" timestamp and a manual Refresh button.
2. **Controls bar** — Analyze, Region (central admin only, and only if there's more than one region to pick from), Group by (only shown when there's a real choice to make), Sort, and a Reset button that only appears once something has changed from the default view.
3. **3 summary metric tiles** — small, compact, contextual to whichever analysis is selected (see §10).
4. **One main chart** — a horizontal bar chart, full width, showing the current analysis grouped and sorted per the controls.
5. **"What should I notice?"** — 2–3 short factual sentences computed from the same data already on screen (see §12).
6. **Detail panel** — appears only after a bar is clicked, and disappears again on close or when Analyze/Region/Group by changes.

Only **one API call** is made per Region change. Changing Analyze, Group by, Sort, or clicking a bar never triggers a new network request — the page just re-shapes the data it already has.

## 8. Which analysis types were implemented

These were chosen based on what the actual Dormify data model can answer reliably. Four analyses, not five or six:

1. **Occupancy** — "How full is each building/region?" Uses the existing per-building capacity/assigned-beds data.
2. **Available Beds** — "Where is there room left?" Same underlying data as Occupancy, different metric and default sort (lowest-availability-first, to surface shortages).
3. **Demand / Waiting** — "Where are students waiting the longest?" Region-level only (a waiting student isn't attached to a building yet).
4. **Special Requests** — "What kinds of requests are piling up?" Grouped by request type (add student, remove student, room change, apartment change, swap, region transfer, other), using the existing pending-request workflow data.

A semester-comparison analysis was **not** implemented — see §19.

## 9. Which filters/grouping/sorting options were implemented

- **Region filter**: "All Regions" or a specific region — shown only to central admins who actually have more than one region to choose from (region bosses/employees are already locked server-side to their own region, exactly as before; the frontend just doesn't show a pointless dropdown for them).
- **Group by**: only offered for Occupancy and Available Beds, and only when the current view spans more than one region — choices are **Region** (default when multiple regions are in view) or **Building** (default/only option when scoped to one region). Demand is always grouped by Region; Special Requests is always grouped by request type — neither shows a Group by control since there's no real choice to make.
- **Sort**: Highest first / Lowest first / Alphabetical, always offered, with a sensible per-analysis default:
  - Occupancy → highest first
  - Available Beds → **lowest first** (surfaces buildings closest to running out)
  - Demand → highest first
  - Special Requests → highest first

## 10. How the summary metrics work

Exactly 3 small tiles, always contextual to the current analysis — never a fixed dashboard KPI set:

- **Occupancy**: Overall occupancy % · Highest (with building/region name) · Lowest (with name).
- **Available Beds**: Total available beds · Highest availability (with name) · Count of buildings/regions with zero availability.
- **Demand**: Total waiting · Highest-demand region (with name) · Count of regions where waiting exceeds currently available capacity.
- **Special Requests**: Total pending requests · Most common request type (with name) · Priority students still unassigned.

All values come directly from the same API response already loaded for the chart — no extra calculation beyond simple client-side min/max/count over the rows already on screen.

## 11. How the graph interaction works

- One horizontal bar chart (Recharts), full-width, with values labeled directly on each bar (no legend needed).
- Bar color is used **meaningfully, not decoratively**: for Occupancy, bars turn amber near capacity and red only when almost full (≥95%); for Available Beds, the same idea in reverse (red when almost nothing is left); for Demand, a bar turns red only when that region's waiting count exceeds its currently available beds. Special Requests uses one consistent color, since it's a plain category breakdown with no risk gradient.
- Hovering a bar shows a tooltip with the exact numbers behind it (e.g. "144/150 beds occupied · 96%").
- Clicking a bar selects it (dims the others slightly, adds a dark outline) and opens the detail panel below; clicking the same bar again closes it.
- If there are more than 12 rows, the chart shows the top 12 by the current sort, with a "View all N" button that expands the rest inside a scrollable, height-capped chart area — bars never get shrunk down to illegibility.
- If there's no data for the current selection, the chart area shows a plain "no data" message instead of an empty white box.

## 12. How the "What should I notice?" insights work

2–3 short, plain-language sentences, computed deterministically from the exact same rows shown in the chart — never generated text, never a guess. Examples of the actual logic (not hardcoded strings — computed from real numbers every time):

- Occupancy: names the highest-occupancy item (with a different phrase if it's ≥90% — "almost full"), the lowest-occupancy item, and (only if more than one) how many items are at ≥90%.
- Available Beds: names the item with the most available beds, then either how many items have zero availability or a positive "all have capacity" statement if none do, then the item with the least (non-zero) availability.
- Demand: either "no students are waiting" (if true), or the highest-demand region plus whether any region's demand currently exceeds its available capacity.
- Special Requests: either "no pending requests" (if true), or the most common request type plus how many priority students are still unassigned.

If there's genuinely nothing to say (e.g., truly no data), the section says so plainly instead of showing something misleading.

## 13. How selected-item details work

Clicking a bar opens a compact panel below the insights (not a new page, not a modal) with facts specific to the clicked item, and — where a real destination exists — a clearly labeled action button:

- **Occupancy / Available Beds, grouped by Building**: occupancy %, beds occupied/total, available beds, plus a **"View building details"** button that navigates to the existing Buildings page with that exact building pre-selected (`/buildings?region=…&building=…`). The Buildings page's apartment/room breakdown was not duplicated here — that page already does it well, so this links to it instead.
- **Occupancy / Available Beds, grouped by Region**: the same facts aggregated for that region, plus a **"View buildings in this region"** button.
- **Demand**: waiting count, assigned/total, available beds in that region (when known), plus the same "View buildings in this region" button.
- **Special Requests**: pending count for that type, plus a **"Review requests"** button to the existing `/transfers` page.

Nothing about these buttons claims a filter it doesn't actually apply — e.g., "Review requests" honestly navigates to the unfiltered request list rather than pretending to pre-filter it, since that page doesn't currently support a type filter via URL.

## 14. RTL/Hebrew support

- The page wrapper sets `dir="rtl"` or `dir="ltr"` based on the app's existing language state, exactly like every other page in the app.
- Every piece of text on the page comes from an inline bilingual dictionary, the same per-page translation pattern already used throughout the codebase (e.g. `HomePage.js`) — nothing is hardcoded English-only.
- Layout uses logical CSS properties (`padding-inline-start`, `inset-inline-start`) instead of hardcoded `left`/`right`, so bullets, spacing, and alignment mirror correctly in Hebrew.
- The one directional icon (the arrow on the detail panel's action button) is flipped in RTL via CSS.
- **Known limitation, inherited from the old page, not introduced by this redesign**: the Recharts bar chart itself always draws left-to-right internally — Recharts has no built-in RTL mirroring for bar charts, and the previous page had the same limitation. The chart's *numbers and labels* are still correct and readable in RTL; only the bar-growth direction doesn't flip.

## 15. Loading, empty, and error states

- **Loading**: a spinner with "Loading analysis…" text replaces the content area while the API call is in flight.
- **Error**: if the API call fails, a red-toned panel shows the error message and a Retry button — the rest of the page (header, controls) stays visible and usable.
- **Empty chart**: if the current analysis/grouping/region combination has zero rows, the chart area shows a plain "No data to display for the current selection" message instead of a blank space or a broken chart.
- **No `undefined`/`null`/`NaN`**: every number is passed through a small `num()` helper that coerces anything invalid to `0` before formatting, and every metric tile falls back to `'—'` rather than showing a broken value when there's genuinely nothing to summarize (e.g., "Highest" when there are zero rows).

## 16. Performance considerations

- Exactly **one API call per Region-filter change** — switching Analyze, Group by, Sort, or clicking a bar never triggers a new request.
- The two new backend fields add a small, fixed number of extra queries (one `values_list` for assigned-student IDs, one aggregate query for request types, one query for the region name→id lookup) — none of these scale with the number of students, buildings, or requests, so there's no new N+1 pattern.
- Region-level chart aggregation (when grouping Occupancy/Available Beds by Region) is done client-side with a simple reduce over the building list already in the response — the same technique, and the same small data volume (tens of buildings), the old page already used.
- Chart height scales with the number of rows and is capped with a scrollable container past 12 rows, so a system with many buildings won't render an unusably tall or illegible chart.

## 17. Tests/Checks Performed

The following checks were executed against the changes:

1. `python -c "import ast; ast.parse(...)"` on `backend/api/views.py` — confirms valid Python syntax after the edits.
2. `python manage.py check` (Django system check, no DB connection required) — passed with no issues.
3. The existing automated test suite `backend/api/tests_analysis.py` (12 tests covering unauthenticated access, empty-database zero-state, region-boss/employee/central-admin region scoping, a test that a region-boss can't escape their scope via a spoofed query parameter, pending-requests scoping, and latest-batch scoping) — run against a **temporary local SQLite database**, since the project's real Postgres database was not reachable in this environment (see §19).
4. A **temporary, purpose-built test** specifically checking the two new fields (`unassigned_by_region`, `pending_requests_by_type`) — seeded two regions with a realistic mix of assigned/unassigned students and three pending requests of two different types, and asserted the exact expected counts came back correctly, and that none of the pre-existing summary numbers were disturbed. This test was deleted after it passed — it was not part of the committed diff, only used for verification.
5. The **full backend test suite** (`manage.py test api`, 361 tests across the whole app, not just analysis) — run to confirm nothing else was broken by editing a shared file.
6. **Frontend production build** (`npx react-scripts build`) — this project's build step includes ESLint, so a clean build is a real signal, not just "it compiles."

## 18. Test results

- `api/tests_analysis.py`: **12/12 passed.**
- The temporary new-field verification test: **1/1 passed**, then deleted.
- Full `manage.py test api`: **340 passed, 21 failed/errored** — each of the 21 was individually checked:
  - All 21 are in `api/tests_allocation.py` (the allocation-**solver** test suite — nothing to do with the Data Analysis page or `analysis_data`).
  - 20 of them are `UnicodeEncodeError` crashes coming from the *test file's own* `print()` debug statements trying to print Hebrew text to this Windows environment's `cp1252` console — an environment issue, not a code-logic failure, and unrelated to any file touched by this change.
  - 1 (`test_existing_occupant_affects_second_bed_choice`) is a genuine solver-assignment assertion mismatch, but it's in the room-matching solver logic, nowhere near `analysis_data` — this appears to be a pre-existing failure, not something introduced by this change.
  - **None of the 21 failures are in `tests_analysis.py`, `tests_home_dashboard.py`, `tests_inventory.py`, or any other test file besides `tests_allocation.py`.**
- `npx react-scripts build`: **compiled successfully, zero ESLint warnings or errors** across the entire frontend (this also confirms `BuildingsPage.js` and `Sidebar.js` still compile correctly after their small edits).
- **No live browser test was run.** See §19 and the Summary above — this was the one item that could not be verified in this environment at this stage.

## 19. Any problems or limitations that remain

- **No live browser verification was possible in this environment at this stage.** No Docker environment was running, and the real database (hosted on Azure) was not reachable from this network. A seeded local server could not be stood up as a substitute either, since environment permission constraints blocked the commands that would be required to do so (e.g. `manage.py migrate`). Everything reported as "tested" above was genuinely tested; on-screen rendering and click behavior were verified by careful manual code review instead of by running the app. A manual click-through against a running instance was recommended before treating this pass as fully verified — see the checklist at the end of this report. (This was completed in the next revision — see §25.)
- **No "Compare with previous semester" control.** `Student`, `ImportBatch`, and `AllocationRun` in `backend/api/models.py` were checked and confirmed to have no semester/period field. Building a comparison control would mean inventing numbers, which the brief explicitly forbade. It was left out entirely (not a disabled/greyed-out control) to avoid dead UI, and documented as a clean extension point — the moment the data model gains a real period concept, the control can be added next to Sort without touching anything else.
- **`unassigned_by_region` can under-count slightly.** It only includes students whose region can actually be resolved (via their accepted dorm type, then dorm-type text, then address text — the exact same fallback chain the pre-existing `students_by_region` field already used). A student with none of that data is invisible to the Demand analysis. This mirrors a pre-existing characteristic of the endpoint, not a new gap introduced by this change.
- **Recharts doesn't mirror for RTL** (see §14) — same limitation the old page had.
- Two regions could theoretically share the same `name` in the database (the `Region.name` field has no uniqueness constraint) — if that ever happened, the `region_name → region_id` lookup would silently keep only one of them. This is extremely unlikely given how regions are seeded in this system, and the pre-existing `students_by_region` field already has the identical assumption, so this isn't a new risk.

## 20. Files created/deleted/modified

**Modified:**
- `backend/api/views.py`
- `src/pages/AnalysisPage.js`
- `src/pages/BuildingsPage.js`
- `src/components/Sidebar.js`

**Created:**
- `project-quality/data-analysis-redesign/IMPLEMENTATION_REPORT.md` (the detailed technical implementation report, in this same folder)
- `DATA_ANALYSIS_REDESIGN_V3_FINAL_REPORT.md` (this file)

**Deleted:** nothing from the shipped code. (During verification, a throwaway Django settings file and a throwaway test file were temporarily created and then deleted before finishing, and were never part of the final change.)

**Not deleted, on purpose:** no backend fields, functions, or underlying capabilities were removed — only the frontend's *use* of most of them was retired. If anything else in the codebase depends on the old fields in `/api/analysis/`'s response, they're all still there.

## 24. Manual Browser Verification Checklist

Since live verification was not possible in this environment at this stage (§19), the following checklist documents what needed to be confirmed against a running instance (docker-compose or an equivalent local setup):

1. Page loads at `/analysis` without console errors.
2. Each of the 4 Analyze options loads real data and changes the chart, metrics, and insights.
3. Region filter (as central admin) actually scopes everything correctly; region bosses/employees never see the region dropdown and only ever see their own region's data.
4. Group by appears only for Occupancy/Available Beds when multiple regions are in view, and switches Building ↔ Region correctly.
5. Sort actually reorders the chart, and each analysis opens with its documented default sort.
6. Clicking a bar opens the correct detail panel content, and clicking it again (or the × button) closes it.
7. "View building details" / "View buildings in this region" navigate to the Buildings page with the right building/region pre-selected.
8. "Review requests" navigates to the Transfers/requests page.
9. "View all N" expands the chart correctly when there are more than 12 rows, and the chart stays readable (scrolls instead of squashing).
10. Empty state: pick a region/analysis combination with no data and confirm it shows a clean "no data" message, not a blank or broken chart.
11. Turn off the backend (or block the request) and confirm the error panel + Retry button work.
12. Toggle the app to Hebrew and confirm the whole page reads correctly right-to-left, including the controls, metric tiles, insights bullets, and detail panel.
13. Resize the browser to a narrow width and confirm the metric tiles stack, controls wrap, and the chart stays usable.
14. Open the browser console and confirm there are no runtime errors while interacting with every control.

---

## 25. Second revision (v3.1) — visual presentation fixes

**This section is the current state of the page.** Everything above (§1–24) describes the first pass, which got the *product direction* right (one analysis at a time) but was never actually seen running, since no Docker/database was reachable at that stage. A running environment was available for this revision, so it was both built **and** clicked through live.

### 25.1 What was wrong with the first redesign, visually

Once the page could actually be looked at instead of just read as code, three problems stood out immediately:

1. **Too empty.** Header → 3 small metric tiles → one big chart → a short insights box, with large flat-white gaps between them and nothing after the insights box.
2. **The chart looked like a generic charting-library demo**, not a Dormify component — a plain Recharts horizontal bar chart with axis lines and a floating value label, no real per-item context next to each bar.
3. **RTL was "not broken" but not designed.** Recharts always draws its bar canvas left-to-right regardless of page direction, so in Hebrew the one thing that mattered most on the page looked subtly foreign. There was also, as it turned out, a real RTL bug hiding in the code itself (§25.6).

### 25.2 What changed

The same `analysis_data` endpoint (**zero backend changes** — every number the new UI needed was already in the existing `summary` object), same four analyses, same permissions/grouping/sorting/insights logic. Only `src/pages/AnalysisPage.js` was revised:

- The Recharts bar chart is **gone**, replaced by a hand-built ranked-row list (plain HTML/CSS progress bars, no charting library).
- A slim **snapshot strip** (Occupancy · Available Beds · Waiting Students · Pending Requests) was added right under the header — 4 always-visible numbers from data already being fetched.
- The old 3 contextual metric tiles were removed (the ranked list and Key Findings now do that job more concretely).
- The controls bar is tighter and more compact.
- The **selected item panel is now always visible**, not click-to-open — the page auto-selects the top row of the current sort on load and on every control change, so the page is immediately useful instead of showing an empty lower half.
- "What should I notice?" is now **Key Findings** (same underlying logic, restyled).
- A new **Status Breakdown** section (small colored chips: Critical/Near capacity/Healthy, or Over/Within capacity, or one chip per request type) was added as the last section on the page.

### 25.3 New layout structure

```
Header  →  Snapshot strip  →  Controls bar
→  [ Ranked analysis list | Selected item panel ]  (two columns, RTL-mirrored)
→  Key Findings  →  Status Breakdown
```

### 25.4 What was added

Rank badge + name + value + progress bar + real-numbers context line + (when notable) a status badge, per row; a snapshot strip with small icons and thin dividers instead of four more bordered boxes; a richer selected-item panel (badge, big metric, 2–3 facts including a client-computed building count for region rows, a two-segment mini breakdown bar, and the same navigation action as before); and the new Status Breakdown chips, which show genuinely new information (a system-wide health count across *every* row, not just the visible top 12) rather than repeating the list.

### 25.5 How the visual presentation improved

Five sections with real content instead of two sections surrounded by whitespace; every number now has a label, a comparison, or a color meaning attached; the ranked list reads as a built Dormify component instead of an embedded chart widget; and RTL is now actively correct rather than "mirrored by default," including a real bug fix (next section).

### 25.6 A real RTL bug found and fixed

Fact values like "assigned / total" (e.g. "0 / 834") were rendering **visually reversed** ("834 / 0") in the Hebrew detail panel. Cause: a pure digits-and-punctuation string has no strong bidi direction, so inside an RTL paragraph the Unicode Bidi Algorithm reorders it to match the surrounding text. Fixed with a small `<NumRatio>` helper that wraps each pair in `<bdi>` — the same isolation trick the original code already used for the header's "last updated" timestamp — applied everywhere an "a / b" pattern appears. This was only caught because the page was opened live in Hebrew this time; it would not have surfaced from a code read-through alone.

### 25.7 What was tested this round

- `npx react-scripts build` — compiled successfully, **zero ESLint warnings/errors** (checked twice: before and after the bidi fix).
- `python manage.py check` — clean.
- `python manage.py test api.tests_analysis` — **12/12 passed**, against the real project database.
- **Live browser click-through** at `localhost:3000/analysis`, logged in as the seeded central-admin user: default load, all 4 Analyze options (including Special Requests' empty state, since this seeded DB has 0 pending requests), Group by toggle, per-analysis sort defaults, row-click selection, auto-select-on-change, and a full Hebrew ⇄ English toggle including layout mirroring — all confirmed working, screenshots taken at each step.
- **Not re-verified this round** (unchanged from the first pass, so still trusted): region/role permission scoping, loading/error panel logic.
- **Not verified**: narrow-viewport/mobile layout — attempting to resize the viewport programmatically did not actually shrink the rendered page in this environment. The mobile CSS breakpoints follow the same pattern already used elsewhere in the app, but were not seen on an actual narrow screen. This remained an open item for manual verification.

### 25.8 Remaining limitations

- Narrow-viewport layout: code-reviewed, not screenshot-verified (see above).
- Special Requests' populated state (non-empty ranked rows, the "share of pending requests" mini bar, request-type status chips) was verified by code review and by the same components working correctly under the other three analyses, but this environment's seeded database has zero pending requests, so it wasn't seen on screen with real non-zero numbers.
- Everything under the original §19 that this revision didn't touch still applies unchanged (the `unassigned_by_region` region-resolution fallback chain, the `Region.name` uniqueness assumption).

## Final summary (v3.1)

The Data Analysis page kept its "one analysis at a time" concept and its real backend data end-to-end, but the presentation was substantially reworked: the generic bar chart is gone, replaced with a designed ranked-row list with real progress bars and per-row context; a compact snapshot strip and a status-breakdown summary were added so the page no longer feels empty; the detail panel is now always visible and auto-selects the top result; and a genuine RTL bidi bug in the number-ratio text was found and fixed along the way. No backend changes were needed this round. The build is clean, the analysis-endpoint tests pass against the real database, and the page was clicked through live in both Hebrew/RTL and English/LTR. The one thing not verified live is narrow-viewport responsiveness, which remained an open item for manual verification.

**This was still not the final revision — see §26 below, which replaced the ranked-row list itself.**

---

## 26. Visual Analytics Redesign (v4)

**This section is the current state of the page**, superseding §1–25. The same `analysis_data` endpoint (**zero backend changes this round** — the redesign is entirely presentational), same four analyses, same permission/grouping/sorting logic, same deterministic-insights approach. Only `src/pages/AnalysisPage.js` changed — it was rewritten from scratch as a product-design pass, not a styling patch.

### 26.1 Why v3.1 was rejected

v3.1 (§25) fixed the "too empty, chart looks like a library demo" problem, but a second, more specific critique came back: it still felt **templated and formulaic**, for reasons that are worth naming precisely, because they're different from "needs more polish":

1. **Every analysis used the exact same visual: a vertical list of horizontal ranked rows.** Occupancy, Available Beds, and Demand were all "rank badge → name → value → one progress bar → context line," with only the numbers and one accent color changing. Special Requests used it too. A reader who opened all four analyses in sequence saw the same shape four times — the page never demonstrated that it understood what made each question different.
2. **The Homepage-style KPI instinct kept creeping back in.** v3.1's snapshot strip (Occupancy · Available Beds · Waiting Students · Pending Requests) was, in substance, a smaller version of the Homepage's 5-tile KPI row, sitting above a page whose entire premise is "don't repeat the Homepage's KPI row."
3. **No real chart, in the sense of a magnitude visualization with a scale.** Progress bars communicate proportion-of-a-track, not comparison against a shared axis, so the reader had no single reference frame to compare a building at 45% against one at 90% — they had to read two separate percentages and do the comparison mentally.
4. **The page was rich in section count but flat in visual language.** White card → white card → white card, all the same border-radius, all the same shadow, no color identity tying a specific analysis to its own visual treatment.

### 26.2 Product-design approach taken

The request was explicit: treat this as product design, not CSS cleanup. Concretely, that meant deciding, *before writing any component*, what job each analysis's data is doing (proportion? remaining capacity? two-quantity comparison? categorical distribution?) and picking a chart form for that job — using the same "form → color → marks → interaction" method a dedicated data-visualization design system would use, rather than reaching for "a bar chart" by default. See §26.4 for the per-analysis reasoning.

No charting library was added. `recharts` is in `package.json` (`^2.10.0`) but is not imported anywhere in the app — it was removed from this page in v3.1 specifically because it cannot mirror a bar canvas for RTL, and that constraint hasn't changed. Every chart in this revision (column, stacked column, grouped column, donut) is hand-built with plain HTML/CSS (flexbox height percentages, `conic-gradient` for the donut) so RTL correctness comes from the browser's own bidi/flex-direction handling, not from library configuration or a mirroring hack.

### 26.3 New information architecture

```
Header (title, subtitle, last-updated, refresh)
Analytics toolbar
   Row 1 — ANALYZE: a primary segmented control, 4 options, each with its own icon and accent colour
   Row 2 — GROUP (when relevant) / SORT / Reset: compact secondary segmented controls
Hero analysis card                                    <- the actual hero of the page
   tinted header: icon badge + title + one-line subtitle + 1-2 contextual stat pills
   the chart itself (form varies by analysis, see §26.4)
   Top-N / "View all" control, only when the row count exceeds 12
   legend + a compact inline status-chip row (Critical/Near capacity/Healthy or similar)
Secondary row (2 columns on desktop, 1 on narrow screens; collapses to 1 column when there's no secondary visual)
   Selected-item detail panel        |  A genuinely different second visual (see §26.5), or nothing
Key Findings — a small grid of bordered insight cards, not a single bulleted list in a big white box
```

No Homepage-style KPI row anywhere on the page. The two numbers that appear near the top (in the hero card's header, as "contextual stat pills") are specific to the selected analysis — e.g. "Overall occupancy 20%" + "Highest: מעונות קנדה 89%" for Occupancy, "Total waiting 2,140" + "Highest demand: מעונות גוש עליון 834" for Demand — and are computed from the same rows already on screen, not a repeat of the Homepage's five system-wide KPIs.

### 26.4 Chart type chosen per analysis, and why

| Analysis | Chart form | Why this form fits this question |
|---|---|---|
| **Occupancy** | Vertical **column chart**, one bar per building/region, 0–100% shared y-axis, bar colour = status tone (green/amber/red by occupancy threshold) | Occupancy is a *proportion against a fixed ceiling* (0–100%) — a column chart with a shared percentage axis is the one form that lets a reader compare "how full" two buildings are at a glance, because both bars are measured against the same scale. Colour by status tone (not by identity) so the chart answers "which ones need attention" without a legend lookup. |
| **Available Beds** | Vertical **stacked column chart**, one bar per building/region, bar *height* ∝ that item's total capacity, split into an occupied segment (grey, de-emphasized) and an available segment (teal, emphasized) | This is a "how much room is left, and how big is the building" question — two numbers, not one. A stacked column lets height carry total capacity (so a 930-bed region and a 104-bed region are visually distinct in size) while the internal split carries the occupied/available breakdown. This is a genuinely different chart *type* from Occupancy's simple column (part-to-whole vs. plain magnitude), not the same chart recoloured. |
| **Demand / Waiting** | **Grouped column chart**, two bars per region (waiting students vs. available capacity) on one shared count axis | The whole point of this analysis is "does demand exceed capacity" — a single-series chart can't show that; it needs two comparable quantities side by side on one axis (never two separate axes — see the "One axis" rule in the design method). Waiting is coloured amber/red (red only when it exceeds capacity for that region); capacity is a neutral grey, so the reader's eye is drawn to the "story" bar, and the two series stay in the same units (a count of people/beds) so the comparison is legitimate, not a fabricated dual-axis correlation. |
| **Special Requests** | **Donut chart** with an always-visible legend/count/percentage list beside it, fixed category-colour order (7 request types max) | This is a small (≤7), closed, mutually-exclusive category set — the textbook case where a donut is appropriate (per the design method: donut for part-to-whole *only* with a small number of clear categories, and only paired with real labels, never decoration). Segment colours are validated for CVD-safety (see §26.6) and assigned by a **fixed request-type order**, not by count rank, so a segment's colour never "jumps" between categories just because the numbers changed. |

Three genuinely different chart mechanics for four analyses (Available Beds and Occupancy share the column-chart *primitive* but differ in whether it's a single bar or a stacked bar — a real structural difference, not a recolour). No two analyses look like the same component with different numbers plugged in.

### 26.5 Supporting (secondary) visuals — added only where they add a second perspective

Per the brief's explicit instruction ("don't add graphs just to fill space"), a secondary visual only appears when it shows something the main chart doesn't:

- **Occupancy → Capacity Breakdown.** One aggregate stacked bar (assigned vs. available beds, summed across every row currently in view, not just the visible top-12) — the main chart compares *entities*, this shows the *system-wide total*, a different question.
- **Available Beds → Highest Availability.** A ranked mini-list of the top 4 by available beds, independent of whatever sort the main chart is using (which defaults to lowest-first, to surface shortages). Genuinely the opposite cut of the same data.
- **Demand / Waiting → Share of Demand by Region.** A small donut showing each region's *share* of total unassigned students — the main chart shows absolute counts per region; this shows relative contribution to the system-wide problem, using a stable region→colour mapping (sorted alphabetically, not by current sort/rank, so a region's colour never changes just because the sort control did).
- **Special Requests → none.** The donut's own legend list already serves this role (count + share per category), so a second chart here would be decorative, not informative — the secondary-panel column collapses to a single centered detail panel instead of leaving an empty box.

### 26.6 Colour, marks, and typography

- **Status tones** (occupancy/available-beds/demand danger colouring) reuse the exact hex values already established elsewhere in the app (`#16a34a` / `#d97706` / `#dc2626` — the same green/amber/red used on Homepage's stage pills and status chips), so "critical" means the same colour everywhere in Dormify.
- **Per-analysis accent identity** (blue/teal/amber/violet for Occupancy/Available/Demand/Requests) is not invented — it's lifted directly from the exact accent+background pairs the Homepage already uses for these same four metrics on its KPI tiles (`accent:'#2563eb', bg:'#dbeafe'` etc.), so switching Analyze visibly ties back to numbers the user has already seen on their dashboard.
- **The Special Requests donut's 7 category colours** come from a validated categorical palette (blue/orange/aqua/yellow/magenta/green/violet) — run through this project's colour-accessibility validator (`scripts/validate_palette.js` from the `dataviz` design skill) before use: all 7 pass the lightness band, chroma floor, and both CVD and normal-vision adjacent-pair separation checks. Three of the seven sit under 3:1 contrast against white by design (a known, documented trade-off of that palette) — the mitigation is that colour is **never the only signal**: every segment has a visible label, a count, and a percentage in the always-present legend list beside the donut.
- **Mark specs**: bars are capped at a comfortable, fixed width (never stretched to fill available space, never shrunk below legibility — see §26.7), rounded only at the data-end (never at the baseline), gridlines are hairline and one step off the card's surface colour (never dashed), and every value is direct-labelled on its own bar/segment rather than requiring a hover to read.
- **Typography**: page title moved from 21px/800 to 24px/800 with tighter letter-spacing; the chart's own title (e.g. "Occupancy by Region") is now 18px/800 with a proper subtitle line underneath, not a small grey caption competing with the page's own H1; the detail panel's headline metric grew from 32px to 36px; findings text grew from 13.5px to a slightly roomier line-height (1.55) inside individual bordered cards instead of a plain bulleted list. All of this stays in the app's existing font (**Heebo**, loaded globally in `public/index.html` and set as the app's `font-family` in `App.js`) — no new typeface was introduced, so Hebrew and English both render in the same family the rest of Dormify already uses.

### 26.7 RTL / Hebrew handling

RTL was treated as a first-class constraint on every chart, not retrofitted after the English version worked:

- **No canvas-based charting library** means there is no internal left-to-right draw direction to fight. Every chart is built from ordinary flexbox rows; a `dir="rtl"` ancestor reverses `flex-direction: row` natively, so bars/columns read right-to-left in Hebrew and left-to-right in English with zero direction-specific chart code.
- **Long Hebrew building names** (e.g. `"מעונות קנדה - בניין 946"`) are handled with a 2-line clamp (`-webkit-line-clamp: 2`) under each column, centred, with the full name available via the native `title` tooltip on hover/focus — verified live with a 96-building "View all" list; no label overlapped or clipped a neighbour.
- **The donut chart is direction-agnostic by construction** (a circle has no reading direction), so no special RTL handling was needed there beyond the legend list, which is a normal flex row and mirrors like any other text row.
- **Numeric ratios** (`"688 / 775"`, `"25 בניינים"` etc.) reuse the `<bdi>`-wrapped `NumRatio` helper introduced in v3.1 to fix the bidi-reordering bug found in that round — carried forward unchanged, still correct.
- **Verified live**: default Hebrew/RTL load, all four analyses, the "View all 96" scrollable building list, the Highest-Availability and Share-of-Demand secondary panels, the detail panel's action button (with its arrow icon correctly flipped via the existing `[dir="rtl"] svg { transform: scaleX(-1) }` rule), and a full toggle to English/LTR with the same interactions repeated — sidebar, toolbar, chart axis position, bar reading order, and secondary-panel column order all mirrored correctly.

### 26.8 What was tested this round

- `CI=true npx react-scripts build` — **compiled successfully, zero ESLint warnings/errors** (run twice: once before, once after the live browser pass).
- `python manage.py test api.tests_analysis --keepdb` — **12/12 passed** against the real project database via the running `dormify_backend`/Postgres containers (no backend changes were made this round, so this reconfirms nothing regressed).
- **Live browser click-through**, `localhost:3000/analysis`, logged in as the seeded central-admin user, against the actual running `docker compose` stack (frontend dev server was restarted so it would pick up the new file — see note below):
  - Default Hebrew/RTL load: toolbar, hero card, column chart, legend, status chips, detail panel, Capacity Breakdown secondary panel, and Key Findings all rendered with real data (a single-region seeded dataset — "קנדה" — so most other rows show 0%, which is real data, not a bug).
  - All 4 Analyze options switched correctly: Occupancy (column), Available Beds (stacked column, confirmed the two-tone segments and in-segment "688" label), Demand/Waiting (grouped column, confirmed the amber/grey pairing and the selected-item ring), Special Requests (confirmed the clean **empty state** — this seeded DB has 0 pending requests — with no layout breakage and the secondary-panel column correctly collapsing to a single, wider detail panel).
  - **Group by** Region ↔ Building on Occupancy: building-level view correctly showed 96 individually-named buildings, Top-12 by default with a "Show top 12 / View all 96" toggle; **View all** switched the chart into its horizontal-scroll mode without shrinking a single bar — confirmed by screenshot at both densities.
  - **Selection**: clicking a different bar in the Demand chart updated the selected ring, the detail panel's headline number/facts, and the mini breakdown bar in the same click — confirmed live.
  - **Secondary panels**: Capacity Breakdown (Occupancy), Highest Availability ranked list (Available Beds), and the Share-of-Demand donut+legend (Demand) all rendered with real numbers and correct percentages.
  - **Hebrew ⇄ English toggle**: repeated the same walkthrough in English — toolbar, chart axis side, bar reading order (high-to-low reads left-to-right in English, right-to-left in Hebrew, both correct for their direction), secondary-panel column order, and the detail panel's flipped action-arrow all confirmed correct.
  - **Console**: no runtime errors at any point; only two pre-existing React Router "future flag" warnings unrelated to this page.
  - **Cross-check**: clicked through to `/buildings?region=…` from the detail panel's action button to confirm the existing deep-link behaviour (added in the first redesign pass, untouched here) still works.
- **Environment caveat worth recording accurately**: intermittent `ERR_NETWORK` failures occurred from the browser to `localhost:8000`/`3000` throughout testing (confirmed, via direct `curl` from the host machine during the *exact same failures*, that both the Django and the CRA dev server were responding instantly and correctly — so the flakiness was in the local test network path, not in the app or this change). Every failure recovered on retry/refresh, and the same flakiness reproduced identically on the unrelated, untouched Homepage and Buildings pages — so it was not attributable to this redesign.
- **Not verified live**: narrow-viewport/mobile layout. The programmatic viewport resize resized the reported window but the app's own layout did not visibly reflow to it in this environment (the same limitation documented in §25.7 for prior rounds — a tooling limitation, not new to this round). The mobile CSS (`@media (max-width: 980px)` collapses the two-column secondary grid to one column; `@media (max-width: 900px)` stacks the header; `@media (max-width: 640px)` stacks the toolbar and donut layout) follows the same breakpoint pattern already shipped and tested on this page in prior rounds, but was not re-confirmed on an actual narrow screen this round. This remained an open item for manual verification.

### 26.9 Limitations

- Narrow-viewport layout is code-reviewed but not screenshot-verified this round (see §26.8) — same open item as prior rounds.
- Special Requests' **populated** donut state (multiple non-zero slices, the legend's percentage math with real numbers) was verified by code review and by the identical `mixWithWhite`/conic-gradient logic being exercised correctly in the Demand-share secondary donut (which did have real non-zero data), but this seeded database has zero pending requests, so the Requests donut itself was only seen in its empty state live.
- The donut chart's individual wedges are not independently hover-interactive (only the legend rows are clickable/selectable) — a deliberate scope trade-off, not an oversight: every value a wedge would show on hover is already visible at all times in the legend list (count + percentage), so nothing is gated behind a hover-only interaction, but a future pass could add per-wedge hover highlighting for a closer "point at what you're curious about" feel.
- Everything listed under §19/§9 that neither this round nor v3.1 touched still applies unchanged (the `unassigned_by_region` region-resolution fallback chain, the `Region.name` uniqueness assumption, no semester/period comparison control since the data model has no such field).

### 26.10 Final summary (v4)

The page kept the same "one analysis at a time" product idea and the same real backend data end-to-end, but the visual design was rebuilt from the ground up around the specific shape of each analytical question: a percentage column chart for Occupancy, a capacity-scaled stacked column for Available Beds, a shared-axis grouped column for Demand vs. Capacity, and a validated categorical donut for Special Requests — four distinct chart mechanics instead of one repeated template, each with its own accent identity borrowed from the Homepage's existing KPI colours, its own secondary visual where a genuinely different cut of the data existed, and RTL correctness built in by construction rather than patched on. No backend changes were required. The production build is clean, the analysis-endpoint tests pass against the real database, and the redesigned page was clicked through live — in both Hebrew/RTL and English/LTR, across all four analyses, including the view-all/scroll path for 96 buildings and the empty-state path for Special Requests — against the actual running Docker stack. The one item not re-verified live this round is narrow-viewport responsiveness, which remains code-reviewed only.

---

## 27. Final Visual/Product Polish (v4.1)

**This section is the current state of the page**, superseding §1–26. The same `analysis_data` endpoint (**zero backend changes this round** — every change is presentational), same four chart forms chosen in §26 (still correct — this round did not touch which chart type each analysis uses). This pass was requested explicitly as "one final comprehensive redesign pass," focused on specific, named complaints about v4 rather than a general "make it nicer": the top of the page still read as pale/flat/empty/not-premium, tooltips were the plain native browser kind, and sparse/zero data needed to look deliberate rather than like a rendering gap.

### 27.1 Why v4 still fell short

v4 (§26) fixed the biggest structural problem — four different chart mechanics instead of one repeated template — but a fresh look at the page surfaced one specific, recurring complaint that had survived every prior round: **the top of the page.** Concretely:

1. **The header and the toolbar were two separate plain-white/light-slate blocks stacked on the page's pale-gray background.** Title, subtitle, and a refresh button in one plain flex row; a `#f8fafc`-tinted box with the Analyze/Region/Group/Sort controls directly underneath. Functionally fine, but visually it read exactly as described: "text and dropdowns dropped onto a pale background," with no layering, no surface contrast, nothing that said "this was designed" before the reader even got to the first chart.
2. **Hover states were the native browser `title` attribute** — functional, but a plain OS tooltip is not what "polished tooltips" or "meaningful hover state" (both called out explicitly in this pass's brief) means in a real analytics product.
3. **Zero-value bars were nearly invisible.** A bar at 0% rendered as a 3px sliver of its status colour sitting on the baseline — technically present (never hidden), but visually indistinguishable from a rendering glitch or a missing bar, especially in a real dataset where several regions/buildings can legitimately be at 0% while one is at 89%.

### 27.2 The analytical workspace intro (the header fix)

The header (`<header>` + `.an-toolbar`) was replaced with one composed panel, `<section className="an-intro">`, built from two visually distinct, seamlessly joined layers — the "layered panel treatment" the brief asked for, without glassmorphism or decorative gradients:

- **Upper layer — a deep, restrained slate gradient** (`linear-gradient(135deg, #0c1424 0%, #16213b 55%, #1c2c4c 100%)`), no radial glow, no greeting text, no username — deliberately *not* a copy of the Homepage's hero (which greets the user by name and shows a workflow-stage pill). Instead it carries:
  - a small uppercase eyebrow kicker ("ANALYTICS" / "אנליטיקה") that names what kind of page this is,
  - the page title in white, 26px/800, and the subtitle in a muted light slate,
  - "Updated …" + a translucent "Refresh" pill button in the corner (the same `rgba(255,255,255,0.08)` translucent-pill treatment the Homepage's own hero action panel already uses — reused, not copied, since it's a generic Dormify pattern, not Homepage-specific content),
  - and, integrated directly into the same dark surface below a hairline divider, the **Analyze** segmented control itself — rendered as light/translucent pills that turn solid white with the selected analysis's own accent colour when active. This is the single biggest visual change: choosing what to analyze is now the dark panel's primary interactive element, immediately visible and high-contrast, instead of a small light-on-light control competing with everything else on the page.
- **Lower layer — a light `#f8fafc` control strip**, seamlessly attached (no gap, no border between the two — colour contrast alone does the separating), holding Region / Group / Sort / Reset exactly as before, functionally unchanged from v4.

This is "rich, not busy": one shadow, one border, two flat colour fields, zero gradients beyond the single header wash, zero blur/glassmorphism. It reuses Dormify's own established dark-surface-plus-translucent-pill vocabulary (already seen on the Homepage hero and its action panel) rather than inventing a new visual language for this one page — satisfying "the dark styling used elsewhere in the system is not inherently a problem" while still reading as a distinct *workspace* intro, not a second greeting hero.

### 27.3 Polished hover tooltips (replacing the native browser tooltip)

Every bar in the three column-based charts (Occupancy, Available Beds, Demand) now has a real floating tooltip — a small dark rounded panel with a pointer arrow, positioned above the bar, revealed on hover **and** keyboard focus (`:hover`/`:focus-within`, so it's reachable without a mouse) via a pure-CSS opacity/transform transition — no JS position tracking, no library. Content is built from the exact same `rowContext()` text each chart's on-chart label and the ranked context lines elsewhere on the page already use (e.g. "688 / 775 beds occupied · 87 available beds"), so the tooltip never says anything different from what's printed elsewhere on the page. The native `title` attribute is kept alongside it as a redundant fallback (harmless, costs nothing, helps touch/assistive-tech cases the custom tooltip doesn't cover). The Demand chart shows one tooltip per region group (covering both the waiting and capacity bar together), since the two numbers are only meaningful read side by side.

### 27.4 Explicit zero-value markers

A bar/column whose underlying value is exactly zero no longer renders as a 3px sliver of its status colour. It now renders as a **distinct dashed-outline marker** — a small (7-8px tall) rounded rect with a 1.5px dashed border in neutral grey and a transparent fill, with its "0%"/"0" value label still shown above it exactly like every other bar. This is visually unambiguous: a reader can tell at a glance that a dashed hollow marker means "this is real, this is genuinely zero" versus a solid coloured bar meaning "this has a value," rather than squinting to tell whether a sliver is real data or a rendering artefact. Applied uniformly to the Occupancy column, the Available-Beds stacked column (for a region/building with zero total capacity), and both bars of the Demand grouped chart (waiting and available capacity independently, since either can legitimately be zero). Selected zero bars still get the selection ring, with the dashed border switching to a solid accent-coloured one so "selected" and "zero" are never visually confused with each other.

### 27.5 What was **not** changed this round

- Chart type per analysis (column / stacked column / grouped column / donut) — unchanged from §26, already correct per the brief's own requirements.
- Secondary visuals (Capacity Breakdown / Highest Availability / Share of Demand) — unchanged.
- Detail panel, Key Findings, status chips, colour system, RTL mechanism — unchanged (all already addressed in §26).
- Backend — zero changes. `analysis_data` was not touched.

### 27.6 Testing performed this round

1. `CI=true npx react-scripts build` — compiled successfully, zero ESLint warnings (run after the JSX/CSS restructuring described above).
2. `docker exec dormify_backend python manage.py test api.tests_analysis --keepdb` — **12/12 passed** (regression check; no backend changes this round).
3. **Live browser verification**, against the actual running `docker compose` stack, logged in as the seeded central-admin user (the frontend dev-server container was restarted so its webpack watcher picked up the new file, same as prior rounds):
   - Confirmed the new dark/light workspace-intro panel renders correctly in **both Hebrew/RTL and English/LTR** — eyebrow kicker, title, subtitle, updated timestamp + refresh pill, the Analyze segmented control's white-active-pill-with-accent-colour state, and the light control strip below it, all screenshotted.
   - Confirmed the custom hover tooltip on the Occupancy chart (dark panel, arrow, correct `rowContext` text, RTL-safe numeric ratio via the existing `<bdi>`-wrapped `NumRatio`) and on the Demand grouped chart (single tooltip per region group).
   - Confirmed the explicit zero-value dashed markers on the Occupancy chart (five buildings/regions at 0% next to one at 89%, in the same seeded single-region dataset used throughout testing) — visually distinct from the solid 89% bar, value label still shown, no layout break.
   - Switched through all four Analyze options and confirmed the dark segmented control's active-pill accent colour changes correctly per analysis (blue/teal/amber/violet), the "Reset" button appears/disappears correctly as the view changes from default, and the Group control correctly disappears for Demand/Requests.
   - Console checked — **no errors**, only the same two pre-existing React Router future-flag warnings unrelated to this page.
4. **Environment note, unchanged from prior rounds**: the network path from the browser to `localhost:3000`/`8000` was intermittently flaky (confirmed via direct host-machine `curl` during earlier rounds that both services respond instantly — the issue was in the local test setup, not the app). No new instance of this was hit during this round's testing beyond what earlier rounds already documented.
5. **Not verified live this round**: narrow-viewport/mobile layout, for the same tooling-limitation reason documented in §26.8/§25.7 — attempting to resize the viewport programmatically does not visibly reflow the rendered page in this environment. The relevant CSS breakpoints were updated (class names changed from `.an-header`/`.an-toolbar-secondary` to `.an-intro-row1`/`.an-intro-controls` to match the new markup) but not re-confirmed on an actual narrow screen.

### 27.7 Limitations

- Narrow-viewport layout remains code-reviewed only, not screenshot-verified, in this environment — same open item carried across every round.
- The donut chart's wedges remain legend-driven rather than individually hover-interactive (documented and accepted in §26.9 — unchanged this round, since the brief's complaints this round were specifically about the header, tooltips, and zero-data, not the donut).
- Everything listed under §26.9/§19/§9 that this round did not touch still applies unchanged.

### 27.8 Final summary (v4.1)

This round targeted three specific, named complaints rather than a general re-polish: the page's top area, tooltip quality, and how zero-value data reads. The header and toolbar were merged into one composed "analytical workspace intro" panel — a deep slate gradient carrying the title, subtitle, refresh control, and a bold light-pill Analyze control, seamlessly joined to a light functional strip for Region/Group/Sort — deliberately distinct from the Homepage's greeting hero while still built from the same dark-surface-plus-translucent-pill vocabulary already established elsewhere in Dormify. Every bar chart gained a real floating hover/focus tooltip built from the same context text already shown elsewhere on the page, replacing the native browser tooltip. Zero-value bars across all three column-based charts now render as an unambiguous dashed marker instead of a near-invisible sliver, so `0%` reads as a deliberate, real data point rather than a gap. No backend changes were made; the chart types, secondary visuals, and RTL mechanism chosen in the prior round (§26) are unchanged and were re-verified working. The production build is clean, the analysis-endpoint tests pass against the real database, and the page was clicked through live in both Hebrew/RTL and English/LTR against the actual running Docker stack. The one item not re-verified live is narrow-viewport responsiveness, carried forward as an open item from every prior round.

---

## 28. System-Wide Location Name Localization

A separate, system-wide bug was fixed after v4.1: region/dorm-type/building names (e.g. `"מעונות קנדה"`) stayed in Hebrew everywhere even when the app language was English, including on this Data Analysis page. Root cause, fix, and full file-by-file coverage are documented in **`project-quality/localization/LOCATION_NAME_LOCALIZATION.md`** — summary: the `Region`/`DormType` models only ever stored one (Hebrew) name, so a new centralized module, **`src/utils/locationNames.js`**, now provides the single source of truth for these translations (including the six official region names supplied directly by the project owner), reused across the Data Analysis page, Buildings and Rooms, the Dormitory Map, Reports, the Sidebar, and several other screens - never a page-local, hardcoded translation table. On this page specifically, only chart-row labels, the region filter dropdown, and the demand-share donut's color-map keying changed (the latter to keep a region's color stable across a language switch); the page's visual design from §26/§27 is otherwise byte-for-byte unchanged, as required. No backend or API changes were needed.
