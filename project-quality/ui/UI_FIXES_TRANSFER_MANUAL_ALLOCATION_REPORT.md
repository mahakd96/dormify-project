# UI Fixes: Transfer Requests localization, Manual Allocation localization + rename

Branch: `donia-ui-fixes`. Continuation of the earlier `UI_FIXES_DASHBOARD_WHATIF_REPORT.md` work
(Central Admin dashboard card + What-If page localization), which remains untouched by this pass.

## 1. Files changed

| File | Why |
|---|---|
| `src/pages/TransfersPage.js` | Task 1 — full page localization (title, toolbar, wizards, modal, action panel, detail pane) + RTL/LTR fixes |
| `src/components/StudentSearch.js` | Task 1 support — child component used exclusively by TransfersPage; added `language` prop + logical CSS |
| `src/components/BedMatchPicker.js` | Task 1 support — shared component (also used by StudentsPage, untouched there); fixed remaining hardcoded strings, `assignActionLabel` now bilingual |
| `src/pages/AssistedAllocationPage.js` | Task 2 + Task 3 — full page localization + rename to "Manual Allocation" / "שיבוץ ידני" |
| `src/components/AssistedCandidateBrowser.js` | Task 2 support — child component used exclusively by the Manual Allocation page; added `language` prop |
| `src/App.js` | Task 2 — pass `language={language}` into `AssistedAllocationPage` (it never received it before) |
| `src/components/Sidebar.js` | Task 3 — sidebar nav label renamed |
| `project-quality/ui/UI_FIXES_TRANSFER_MANUAL_ALLOCATION_REPORT.md` | This report |

No backend files were changed in this pass. All `_display` fields the pages rely on
(`gender_display`, `religion_display`, `housing_type_display`, `apartment_type_display`,
`action_type_display`, …) already exist on the relevant API responses (confirmed in
`backend/api/views.py`), so no backend addition was needed.

`backend/api/views.py`, `src/pages/HomePage.js`, `src/pages/WhatIfPage.js` also show as modified —
that is the **prior, still-uncommitted** dashboard/What-If work from the earlier session; it was
not touched again here.

## 2. Transfer Requests (`/transfers`) — root cause

`TransfersPage.js` already received `language` from `App.js` and already had a top-level
`const isHe = language === 'he'` — but almost none of the JSX actually used it. Every heading,
button, placeholder, wizard step and error message was a hardcoded Hebrew string literal, and the
root `<div>` had a hardcoded `dir="rtl"`. Switching the global language toggle changed nothing on
this page because the strings were never wired to `language` in the first place — the same root
cause pattern as the earlier What-If page bug, just already-partially-plumbed at the top level.

## 3. Transfer Requests — translations added

Added a single `buildT(isHe)` dictionary (same `t = {he:{...}, en:{...}}`-per-page convention used
elsewhere in Dormify) covering every string on the page and its wizards, then threaded a `T` prop
down through the whole component tree:

`TransfersPage` → `NewRequestModal` → `AddStudentWizard` / `RemoveWizard` / `SwapWizard` /
`TransferWizard`, and `TransfersPage` → `DetailPane` → `ActionPanel`.

Covered: page title/subtitle, refresh/new-request buttons, stat cards (Total/Pending/Approved/
Rejected), search placeholder, status tabs, request-type filter + options, region filter + "All
Regions", request count ("`{n}` requests" via interpolation, not string concatenation), loading
state, all four empty states (no-requests / no-search-results / no-selection / pick-a-request),
every wizard (Add Student, Remove Student, Swap, Transfer/Other) — step labels, field labels,
placeholders, summary rows, footer buttons — the New Request type-picker cards, the Action Panel
(approve/reject/check-options/recheck buttons, assignment confirmation notes, cross-region search
notes), and the Detail Pane (timeline, current-placement rows, request-detail key/value rows,
placement history, rejection banner).

Dynamic template strings (e.g. "Building X · Apt Y · Room Z", "N regions have unviewed data",
placement-history counts) use dictionary **functions** (`T.loc3(...)`, `T.historyToggle(n)`, etc.)
rather than hand-built sentences, so word order is correct in both languages.

Backend/API values preserved exactly: `request_type`/`status`/`transfer_scope` values sent to
`requestsAPI` are untouched; only their **display** labels change (`TYPE_CFG`/`STATUS_CFG`, which
already had `labelHe`/`labelEn` and needed no changes). Dynamic backend data (student names, IDs,
region names already resolved server-side, free-text reasons) is rendered as-is, never
re-translated.

**`assignActionLabel(sel, language)`** (in `BedMatchPicker.js`, shared with `StudentsPage.js`) now
takes an optional `language` parameter (default `'he'`) so `StudentsPage.js`'s single-argument call
sites keep their exact current behavior; `TransfersPage.js` now passes the real page language.

**`StudentSearch.js`** (used exclusively by `TransfersPage.js`) gained a `language` prop and now
localizes its default placeholder, the assigned/unassigned badge, and the "no results" message.

**`BedMatchPicker.js`** (shared with `StudentsPage.js`, which still passes `language="he"`
unchanged) had several strings that were hardcoded Hebrew regardless of the `language` prop it
already accepted: the section title/subtitle, the four summary-card labels (buildings/apartments/
rooms/available beds), the gender label map, the religion-conflict warning override text, and the
"assignment allowed with a warning" tag. All are now `isHe`-aware. `TransfersPage.js`'s four
`<BedMatchPicker language="he" .../>` call sites were changed to `language={language}`.

## 4. RTL / LTR handling

- `TransfersPage.js`: root `dir="rtl"` → `dir={dir}` (`dir = isHe ? 'rtl' : 'ltr'`); the CSS's
  hardcoded `direction: rtl` on `.tp-root` → `direction: ${dir}` (template-literal interpolation).
- Six color-strip rules (`.rq-item-violet` etc.) and the list/detail-pane divider
  (`.detail-outer`) used physical `border-right` — changed to `border-inline-start` so the accent
  strip and pane divider sit on the correct side in both directions (CSS Grid's explicit
  `grid-template-columns` already mirrors the two-pane layout natively under `dir`).
  `.shared-ss-row { text-align: right }` in `StudentSearch.js` → `text-align: start`; the numeric
  ID span keeps `direction: ltr` (IDs are numbers) but its alignment moved to `text-align: end`.
- Directional wizard-navigation arrows ("Back"/"Next" and the type-picker chevrons) now pick
  `ArrowRight`/`ArrowLeft` based on `isHe` via `T.BackArrow`/`T.NextArrow`, mirroring the existing
  `isRTL`-driven icon-selection convention already used in `HomePage.js`.
- No other hardcoded `left`/`right`/`padding-*`/`margin-*` directional CSS remained in either file
  after a full grep pass (verified — see Verification section).

## 5. Manual Allocation (`/assisted-allocation`) — root cause

`AssistedAllocationPage.js` never declared a `language` prop at all, and `App.js` never passed
one (`<AssistedAllocationPage />`, no props). Every string on the page — including six separate
Hebrew-only label maps (`CATEGORY_LABEL_HE`, `RESTRICTION_LABEL_HE`, `TAB_LABEL_HE`,
`REASON_LABEL_HE`, `STATUS_LABEL_HE`, plus the JSX itself) — was hardcoded Hebrew with no English
counterpart anywhere in the file. Its child component, `AssistedCandidateBrowser.js`, had the same
problem. Switching the global language toggle had zero effect on this page.

## 6. Manual Allocation — translations added

- Added `language={language}` to the `/assisted-allocation` route in `App.js`, and
  `AssistedAllocationPage({ language = 'he' })` now reads it.
- Added English counterparts for every existing label map: `CATEGORY_LABEL_EN`,
  `RESTRICTION_LABEL_EN`, `TAB_LABEL_EN`, `REASON_LABEL_EN`, `STATUS_LABEL_EN` — selected via
  `isHe` alongside their Hebrew originals rather than replacing them (so nothing that already
  depended on the exact Hebrew constants broke).
- Added a `buildT(isHe)` dictionary (same convention as Transfers/What-If) covering: page
  heading/subtitle, region selector + "All Regions", the five metric chips, queue search
  placeholder, gender filter, all four empty-queue states (per tab), the "select a student" prompt,
  the student fact grid (ID/gender/religion/region/dorm type/housing type), priority/accessibility/
  roommate-request note lines, the no-match reason banner fallback, all three "tier" section
  headings + hints (assignment options, apartment-configuration-change opportunities, send-for-
  transfer) with their dynamic dorm-type-name suffix and candidate-count-dependent hint text, the
  action-history section, both dialogs (apartment-configuration-change, transfer-request) including
  field labels/placeholders/confirm-button text, and every success/error message from the six
  API-calling handlers (`fetchQueue`, student-detail load, recommendations load, confirm-selection,
  confirm-config-change, confirm-transfer).
- `GroupBadge`, `StudentRow`, `ConfigOpportunityCard`, `SelectionPanel`, `ConfirmDialog` (all local
  sub-components) now take a `T` (and where needed `isHe`) prop instead of hardcoding Hebrew.
- `AssistedCandidateBrowser.js` gained a `language` prop (default `'he'`) and an internal `t`
  dictionary covering the tier filter chips, search placeholder, summary line, per-building/
  apartment/room/bed labels, status pills, and both empty states. `AssistedAllocationPage.js` now
  passes `language={language}` into it.
- Dynamic backend data (student names/IDs, region names, dorm-type names, `*_display` fields,
  building/apartment/room numbers, free-text reasons/notes) is rendered as-is. The `*_display`
  fields (`gender_display`, `religion_display`, `housing_type_display`, `apartment_type_display`,
  `category_display`, `action_type_display`) already exist server-side via Django's
  `get_FOO_display()` convention (same pattern `StudentsPage.js`/`StudentSerializer` already use);
  no backend change was needed or made.
- Backend/API values preserved exactly: `assisted_status` ("recommended"/"possible"/
  "override_required"), `apartment_category`/`gender_restriction` values, `request_type` sent to
  `requestsAPI.create`, and the `tab`/`gender` query params sent to `assistedAllocationAPI.getQueue`
  are all untouched — only their **display** labels are translated.

## 7. RTL / LTR handling (Manual Allocation)

- `.aa-page`'s hardcoded `direction: rtl` → `direction: ${dir}` (`dir = isHe ? 'rtl' : 'ltr'`),
  applied via the same template-literal-interpolated `<style>` block pattern as TransfersPage; the
  root `<div className="aa-page">` also now sets `dir={dir}`.
  `.aa-modal`'s hardcoded `direction: rtl` was fixed the same way.
- `.aa-row { text-align: right }` → `text-align: start`. All other spacing in this file
  (`margin-inline-start`, etc.) was already written with logical properties, so no further CSS
  changes were required.

## 8. Old name → new name — locations changed

| Location | Old | New |
|---|---|---|
| `src/components/Sidebar.js` nav item | `שיבוץ מסייע` / `Assisted Allocation` | `שיבוץ ידני` / `Manual Allocation` |
| `src/pages/AssistedAllocationPage.js` page `<h1>` | `שיבוץ מסייע` | `שיבוץ ידני` / `Manual Allocation` (via `T.pageTitle`) |

A project-wide grep for `שיבוץ מסייע` / `"Assisted Allocation"` after the change found only one
remaining hit — an in-code comment in `AssistedAllocationPage.js` documenting the rename itself;
no other user-facing navigation text, dashboard link, breadcrumb, or tooltip referenced the old
name anywhere in `src/`.

The component/file is still named `AssistedAllocationPage` internally (not renamed), and internal
identifiers (`assistedAllocationAPI`, `canAssistAllocation()`, code comments in `StudentSearch.js`/
`TransfersPage.js` referencing "Assisted Allocation" as the historical page name) were left as-is —
per the task's explicit instruction that this is a user-facing terminology change, not an internal
refactor.

## 9. Route preserved

`/assisted-allocation` is unchanged in `App.js` — no technical reason required changing it, and it
wasn't touched. The `/priority` → `/assisted-allocation` redirect alias is also unchanged.

## 10. Backend/API enum values preserved

Confirmed unchanged and unreferenced by any of this session's edits:
- Transfer requests: `request_type` (`room`/`apartment`/`other`/`add_student`/`remove_student`/
  `swap`), `status` (`pending`/`approved`/`rejected`), `transfer_scope`
  (`same_region`/`cross_region`), `same_apartment` booleans, `destination_regions` region-slug PKs.
- Manual Allocation: `assisted_status` (`recommended`/`possible`/`override_required`), apartment
  `category` and building `gender_restriction` values sent to `dormInventoryAPI`, `request_type:
  'region_transfer'` sent to `requestsAPI.create`, and the `tab`/`gender`/`region` query params
  sent to `assistedAllocationAPI.getQueue`.

Only display **labels** were translated; every value written to or read from the wire is untouched.

## 11. Tests / build results

- No frontend automated test files exist in this project (`src/**/*.test.js` / `*.spec.js` — none
  found), so there were no "relevant frontend tests" to run beyond the build.
- `npm run build` (production build, `CI=true`): **Compiled successfully**, no ESLint warnings, run
  three times across the session (after Transfers changes, after Manual Allocation changes, and as
  a final check) — clean every time.
- No backend production code was changed in this session, so per the task's own instruction the
  backend test suite was **not** run.
- `git diff --stat` reviewed: only the 8 intended source files (+ this report) are modified;
  `backend/api/concurrency_tests/`, `project-quality/concurrency/`, the allocation solver/algorithm
  code, and allocation-specific test files do not appear anywhere in the diff.
- The 5 `project-quality/performance/evidence/*.txt` files show as modified in `git status` but
  `git diff` against them is empty (a pre-existing line-ending/`core.autocrlf` quirk in this
  checkout, not a content change) — confirmed by direct diff inspection.

## 12. Manual reasoning through both language states

- **Hebrew**: `dir="rtl"` on both page roots, CSS `direction: rtl` — wizards, filters, and the
  two-pane Transfers layout read right-to-left; the new "שיבוץ ידני" label appears in the sidebar
  and page heading; all dictionary strings resolve to their Hebrew branch.
- **English**: `dir="ltr"`, CSS `direction: ltr` — the color-strip/divider borders and the wizard
  back/next arrows flip to the correct side; "Manual Allocation" appears in the sidebar and page
  heading; every dictionary string resolves to its English branch; interpolated counts
  (`"{n} requests"`, `"Showing X of Y buildings"` inside `BedMatchPicker`, history counts) read as
  natural English sentences, not concatenated fragments.
- Confirmed by full-file grep (see report sections 3/4/6/7) that no stray hardcoded Hebrew or
  incorrect physical-direction CSS remained in any of the edited files after the pass.

## 13. Still requiring manual browser verification

### Transfer Requests
1. Visual RTL appearance (Hebrew) and LTR appearance (English) side by side — spacing, arrow
   directions, color-strip/divider placement.
2. Region/type-filter/search/status-tab interactions in both languages.
3. Full "New Request" flow for each of the 5 request types (add student, remove student, transfer,
   swap, other), including the feasibility/bed-picker step, in both languages.
4. Approve/reject actions from the Action Panel, including the cross-region "check options" flow.
5. Browser console check for runtime errors/warnings while switching languages on this page.

### Manual Allocation
1. Sidebar now reads `שיבוץ ידני` (Hebrew) / `Manual Allocation` (English) — visual confirmation.
2. Page heading reflects the same new name in both languages.
3. Hebrew appearance vs. English appearance of the queue list, student detail panel, and candidate
   browser (student list badges, filters, tier chips).
4. Selecting a student, browsing/selecting a recommended bed, and the confirm/override panel,
   including the apartment-configuration-change and send-for-transfer dialogs, in both languages.
5. RTL/LTR layout correctness end to end.
6. Browser console check for runtime errors/warnings while switching languages on this page.

## Scope confirmation

- Current branch: `donia-ui-fixes`.
- Group 2 concurrency files (`backend/api/concurrency_tests/`, `project-quality/concurrency/`) do
  not appear anywhere in the diff.
- Allocation algorithm/solver/scoring/matching code and allocation-specific tests were not touched;
  `AssistedAllocationPage.js` changes are strictly display/localization/terminology, with the
  candidate-ranking data (`rec.candidates`, `assisted_status`, `matched_reasons`, `warnings`,
  `override_violations`) consumed and rendered exactly as the backend returns it.
- Nothing was committed, pushed, or merged.
