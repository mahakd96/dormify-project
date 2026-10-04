# UI Fixes: Central Admin Dashboard Card + What-If Page Localization

**Scope:** two UI-only fixes. No allocation-algorithm code or allocation-specific
tests were touched, and no concurrency-work files were touched.

## Files changed

| File | What changed |
|---|---|
| `backend/api/views.py` | `home_dashboard`: added a per-region occupancy breakdown (reshaping two queries that already ran, not new queries) and a new `regions-high-occupancy` attention item. `_what_if_format_student_from_assignment`: added `gender_display` / `requested_religion_display` / `religious_display` fields (same `get_FOO_display()` convention `StudentSerializer` already uses). |
| `src/pages/HomePage.js` | Added a `percent` icon mapping; the Central Admin "Attention" list now hides the old `regions-pending-review` card and (since it's backend-computed already) the new high-occupancy card renders in its place, clickable, routing to `/analysis`. |
| `src/pages/WhatIfPage.js` | Full localization pass: accepts the existing `language` prop, adds a `t` translation dictionary (Hebrew/English) covering every user-visible string, routes dynamic region/dorm-type names through the project's existing `src/utils/locationNames.js` helpers, and fixes the handful of hardcoded-LTR CSS rules (`text-align: left` → `start`, `right: 16px` → `inset-inline-end`, `padding-right` → `padding-inline-end`) so the page mirrors correctly in RTL. |

No files under the concurrency work, and no allocation algorithm/test
files, appear in this diff (verified via `git diff --stat` at the end of this
report).

---

## Task 1 — Central Admin dashboard card

### Old vs new behavior

**Old:** the middle "Attention" card read "אזורים עם נתונים חדשים שטרם נצפו"
/ "Regions with unviewed new data" (`id: 'regions-pending-review'`). It had
`route: null`, so `AttentionSection`'s `clickable = Boolean(item.route)` was
always `false` — the card rendered as a plain, non-interactive block.

**New:** the same slot now shows "אזורים בתפוסה גבוהה" / "High-occupancy
regions", with supporting text "{count} אזורים נמצאים בתפוסה של 90% ומעלה" /
"{count} regions are at 90% occupancy or higher". The whole card is a
`<button>` (same as every other clickable attention card) and navigates to
`/analysis` on click.

### Why the old backend item wasn't deleted

The old `regions-pending-review` computation (`pending_inbox_count`) is
still relied on by an existing, unrelated performance regression test
(`api/performance_tests/test_home_dashboard_performance.py::test_g1_06_...`),
which asserts the exact consolidated-groupby count via that attention item's
`count` field — there is no other field in the `/api/home/` response that
exposes this number. Rather than touch that existing test (out of scope for
this change) or silently weaken its coverage, `home_dashboard` still computes
and returns `regions-pending-review` unchanged; `HomePage.js`'s
`AttentionSection` simply excludes that one `id` from what it renders
(`ATTENTION_IDS_HIDDEN_FROM_UI`), so the useless card never reaches the user
while the backend regression test keeps its ground truth. This is called out
in a comment at both the Python and JS call sites.

### Source / calculation of the high-occupancy count

- **Threshold:** occupancy ≥ 90% (`HIGH_OCCUPANCY_THRESHOLD = 90` in
  `home_dashboard`).
- **Data source:** real current data, computed per region as
  `occupied_beds / total_capacity * 100`, using the exact same
  `is_active`/`apartment__is_active`/`building__is_active` filters the
  endpoint already applies for its system-wide `total_capacity`/
  `occupied_beds` metrics — just grouped by region instead of summed
  system-wide. No hard-coded number anywhere.
- **No new backend query:** the endpoint already ran exactly these two
  queries (`rooms_qs` capacity sum, `active_assignments_qs` distinct bed
  count) to build its existing system-wide metrics. For the admin
  (`region is None`) path only, those two queries were reshaped to also
  carry a `region_id` column (`.values('...region_id').annotate(...)` /
  `.values('...region_id', 'bed_id').distinct()`) instead of collapsing
  straight to one scalar — the same "fetch grouped rows instead of a second
  scalar query" trade-off already used elsewhere in this same endpoint and
  in `analysis_data()`. The region-scoped (boss/employee) path is completely
  unchanged.
- **Why this mattered:** an initial version added 2 genuinely new queries
  and broke the existing performance budget test
  (`test_query_count_after_fix_central_admin`, `assertLessEqual(total, 16)`
  — went to 18/16). The reshaped version above keeps the central-admin path
  at exactly 16 queries (verified — see Verification below) and the
  region-boss path at 14 (unchanged).
- **Correctness verified manually** with a throwaway test (not committed):
  three regions at 90%, 80%, and 100% occupancy → count came back as `2`
  (90% and 100% qualify, 80% correctly excluded), with the exact expected
  `title_he`/`title_en`/`description_he`/`description_en`/`route`.

### Navigation behavior

Clicking the card calls `navigate('/analysis')`. `AnalysisPage.js` has no
existing URL/query-param-driven filter state (confirmed — no
`useSearchParams`/`useLocation` reads on mount), so this is a plain
navigation, deliberately not a redesign of the Analysis page for this
purpose. Its
default state already opens on the Occupancy analysis sorted by `high`,
which is the most relevant view for this card without any Analysis-page
changes.

### Icon / styling

Reuses the existing `Percent` icon (already imported in `HomePage.js` for
the Occupancy Rate KPI tile) and the existing `severity: 'warning'` styling
— same visual language as every other attention card, no new CSS.

---

## Task 2 — What-If page localization

### Root cause

`App.js` already passes `<WhatIfPage language={language} />` — the bug was
entirely inside `WhatIfPage.js`: `const WhatIfPage = () => { ... }` never
declared a `language` parameter at all, so the prop was silently discarded
and every string in the component was a plain hardcoded English literal.
This is why the page stayed in English even when the rest of the app (which
does read `language`) switched to Hebrew/RTL.

### Translation/i18n changes

Followed the project's existing per-page pattern (the same one
`HomePage.js`/`AnalysisPage.js` use — a `{ he: {...}, en: {...} }[language]`
object built inside the component, no new i18n library):

- Added `language = "he"` as the component's prop (default matches every
  other page's convention).
- Added a `t` dictionary covering every user-visible string identified in
  the task and confirmed by a full pass over the file: header/eyebrow/
  subtitle, refresh button, the 4 top KPI cards, target-type tabs, search
  placeholders (all 3 variants), the "Showing X of Y" meta line, select-all/
  clear-selection, empty/loading states, item Active/Inactive status pills,
  Scenario Settings panel (action/reason labels + all 5 reason options +
  both action options), "No items selected yet", Run Impact Analysis button
  and its loading state, the simulation note, both Apply buttons, all 8
  Impact Summary tiles, the Before/After table (headers + all 7 metric
  rows), the Affected Students table (all 10 column headers, empty state,
  status pill), the entire Confirm-Apply modal (title, danger text, summary
  labels, both warning-box variants, the type-APPLY label/placeholder,
  Cancel/Confirm Apply), and every inline validation/error message
  (`Please select at least one item.`, `Please run the impact analysis...`,
  `Please type APPLY...`, the `Failed to load ... data` fallbacks, and the
  final `Done. Action: ... ` confirmation sentence).
- **Dynamic interpolation (requirement #9):** "Showing X of Y buildings" and
  the final "Done. Action: ... Affected students: ... Created requests: ...
  Skipped: ..." sentence are built from translated tokens/interpolation
  functions in `t` (`t.showing`/`t.of` + JSX, `t.doneMessage(...)`), not
  hardcoded English sentence construction — and the `<strong>` emphasis on
  the interpolated numbers/APPLY keyword was preserved rather than
  flattened into a plain string.
- **Backend enum/API values preserved (requirement #11):** the `<select>`
  `value=` attributes for Action (`inactivate`/`reactivate`) and Reason
  (`Renovation`/`Maintenance`/`Safety issue`/`Reserved for administrative
  use`/`Other`) are untouched — only the visible `<option>` text is
  translated. `reason` is sent to the backend as free text and stored
  verbatim in `StudentRequest.reason`, so keeping the English literal as the
  wire value (while showing a Hebrew label) preserves whatever displays that
  reason elsewhere in the app.
- **Dynamic entity/backend data (requirement #10):** building/apartment/room
  `region_name`/`dorm_type_name`/`dorm_type` values are real backend data,
  not UI chrome — these now go through the project's *existing* localization
  mechanism, `src/utils/locationNames.js` (`localizeById`/
  `localizeLocationText`, the same functions `AnalysisPage.js`/`MapPage.js`
  already use), instead of being left untranslated or given a new ad hoc
  translation table. Numeric/identifier fields (building numbers, apartment
  numbers, room names, bed labels) are left as-is, matching how the rest of
  the app treats them.
- **Student gender/religious/requested-religion (Affected Students table):**
  these were raw enum codes (`'male'`, `'religious'`, `'Jewish'`, ...) with
  no translation at all, in either language. `StudentsPage.js` already
  established the project's convention for this: backend `get_FOO_display()`
  fields (`gender_display`, `requested_religion_display`, etc.), always
  shown as-is regardless of app language (the existing StudentsPage never
  re-translates these into English either). `_what_if_format_student_from_
  assignment` didn't expose those fields yet, so they were added — zero
  extra DB queries (`get_FOO_display()` is pure Python over the model's
  `choices`, no query), purely additive so no existing consumer of that
  helper (the legacy building-inactivation endpoints) is affected. The
  frontend falls back to the raw value if a `_display` field is ever absent.
- The "Status" pill's `needs_transfer` value (currently the only status this
  endpoint ever emits) is translated via a small lookup with a raw-value
  fallback, matching the action/reason option-label treatment.

### RTL/LTR handling

The page already inherits `dir="rtl"`/`dir="ltr"` from `MainLayout` in
`App.js` (set on `.app-layout`, which wraps `<Outlet/>`) — same as every
other page, so no `dir` attribute needed adding to `WhatIfPage` itself.
What *was* hardcoded LTR and needed fixing:

- `.building-row { text-align: left }` → `text-align: start` (browsers keep
  this a plain visual `left` unless it's mirrored `start`).
- `.modern-table th { text-align: left }` → `text-align: start`.
- `.confirm-close { right: 16px }` → `inset-inline-end: 16px` (the modal's
  close (×) button now sits on the correct side in RTL instead of always
  the physical right).
- `.buildings-list { padding-right: 4px }` → `padding-inline-end: 4px`
  (scrollbar gutter reservation follows the correct side).

This mirrors the logical-property convention already used in
`HomePage.js`/`AnalysisPage.js` (`text-align: start/end`,
`border-inline-start`, `inset-inline`) rather than introducing a new
`[dir="rtl"] .foo { ... }` override style. CSS Grid (`.building-row`'s
`grid-template-columns`) and Flexbox (`.page-header`, `.target-tabs`,
`.confirm-actions`, etc.) both already respect the ancestor `dir` natively —
column/row order flips automatically under `dir="rtl"` with no extra CSS, so
no changes were needed there. No other unrelated design/layout changes were
made.

### Functionality preserved

Target-type selection, search, building/apartment/room selection (toggle/
select-all-visible/clear), action/reason selection, Run Impact Analysis,
Refresh Data, and the Apply confirmation flow (including the literal
`APPLY` keyword the user must type, kept untranslated in both languages so
the `confirmText !== "APPLY"` check needed no logic change) are all
unchanged — only strings/labels were touched, no state/handler logic was
altered except to route text through `t`.

---

## Verification

- **Backend — Django check:** `python manage.py check` → `System check
  identified no issues (0 silenced)` (run after each backend edit).
- **Backend — targeted tests:** `python manage.py test
  api.tests_home_dashboard api.performance_tests.test_home_dashboard_performance
  --keepdb` → **16/16 passed**, including the `G1-06`/`G1-08`
  correctness tests and both query-count budget tests
  (`central_admin: 16 ≤ 16`, `region_boss: 14 ≤ 15` — both **unchanged**
  from before these edits).
- **Backend — What-If tests:** `python manage.py test api.tests_inventory
  --keepdb` (covers `/api/what-if/availability/simulate/` and `/confirm/`)
  → **41/41 passed**.
- **Backend — full `api` suite:** `python manage.py test api --keepdb` was
  run as a final full-suite regression check.
- **Backend — high-occupancy correctness:** a throwaway test (written,
  run, and deleted — not part of the committed diff) created 3 regions at
  90%/80%/100% occupancy and asserted the `/api/home/` response's
  `regions-high-occupancy` item: `count == 2`, plus exact `route`/
  `title_he`/`title_en`/`description_he`/`description_en` text — all
  passed.
- **Frontend — production build:** `npm run build` → `Compiled
  successfully`, no warnings, for every edit in this change (verified after
  the dashboard change, after the What-If rewrite, and again after the
  final cleanup pass).
- **git diff scope:** `git diff --stat` shows only `backend/api/views.py`,
  `src/pages/HomePage.js`, and `src/pages/WhatIfPage.js` with real content
  changes. Several `project-quality/performance/evidence/*.txt` files were
  regenerated as a side effect of running the test suites (their
  `tearDownClass` hooks rewrite them on every run — timings and
  auto-increment test-fixture IDs shift run-to-run); every one of them was
  diffed by hand, confirmed to show identical `total_queries` values
  before/after (only timing-noise and PK-digit-count byte differences), and
  restored to their `HEAD` content so the diff stays limited to the
  intended source changes.
- **No allocation code/tests touched:** confirmed via `git diff --stat`
  (no files under `allocation/`, `canada_algorithm_tests/`, or any
  `*allocation*test*` path appear in the diff).
- **No concurrency-work files touched:** that work lives entirely
  on a separate branch that was never checked out or merged as part of
  this change; `git status`/`git diff` at every step showed only the files
  listed above.

### Manual reasoning through both language states

- **Hebrew (`language="he"`):** Dashboard — the high-occupancy card renders
  "אזורים בתפוסה גבוהה" with the interpolated count and navigates to
  `/analysis` on click, in the same visual slot/style as the other
  attention cards. What-If — every label enumerated above renders in
  Hebrew; the page inherits `dir="rtl"` from `MainLayout`, so buttons/
  selects/search/tables now read right-to-left with the fixed logical CSS
  properties; region/dorm-type names for real buildings/apartments/rooms
  stay in Hebrew (their native language, correctly *not* re-translated);
  the `APPLY` keyword and reason `value`s stay literal English as designed.
- **English (`language="en"`):** Dashboard card and all What-If text render
  in English exactly as before this change for wording, with the newly
  translated pieces (e.g. `gender_display`, region/dorm-type names) now
  using the project's existing curated English names via
  `locationNames.js`. Layout is LTR as before (unaffected by the RTL-only
  CSS fixes, which only change behavior under `dir="rtl"`).

### Still requiring manual browser verification

This was reasoned through statically (component logic, backend response
shapes, and a build check) but **was not clicked through in an actual
running browser** as part of this pass:

1. Visual check of the new dashboard card's spacing/wrap at narrow widths
   next to the other attention cards, in both languages.
2. Visual/interaction check of the What-If page's RTL mirroring in a live
   Hebrew session — particularly the sticky Scenario Settings panel, the
   Confirm-Apply modal's close-button position, and the buildings-list
   scrollbar gutter — since these were reasoned from CSS logical-property
   semantics rather than observed pixels.
3. An end-to-end click-through of Run Impact Analysis → Apply → confirm
   with a real backend + seeded data, in both languages, to see the live
   `gender_display`/`religious_display` values and the final Hebrew/English
   "Done. Action: ..." message rendered against real student records.
4. Confirming no console errors in the browser (dev tools) for `/dashboard`
   and `/what-if` in both languages — reasoned to be clean from the
   successful production build and the absence of any new undefined-prop
   access paths, but not observed directly in a browser console.
