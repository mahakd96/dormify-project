# System-Defined Location Name Localization

**Branch:** `donia-data-analysis-redesign-v3`. Not committed. Not pushed. Not merged.

## The bug

When the app language was set to English, region/dorm-type/building names (e.g. `"מעונות קנדה"`) kept displaying in Hebrew everywhere, including the just-redesigned Data Analysis page (chart labels, tooltips, findings, the selected-item panel), the Buildings and Rooms page, the Dormitory Map, and several other screens.

## Root cause

The `Region` and `DormType` models (`backend/api/models.py`) each store exactly **one** `name` field, in Hebrew — there is no `name_en`/`english_name` column anywhere in the schema, and `Building` has no name field at all (it's identified only by `number` + a `DormType` foreign key). Two frontend files (`AllocationPage.js`, `UsersPage.js`) already contained `isHebrew ? region.name : (region.nameEn || region.name_en || region.name)`-style ternaries — clearly written with the *intent* of showing an English name — but since the API never actually returns `nameEn`/`name_en` (only ever `name`), that branch silently fell through to the Hebrew name every time. Every other page that displayed one of these names (Data Analysis, Buildings, Reports, Students, etc.) didn't even attempt a translation; it just printed the raw `name`/`region_name`/`dorm_type_name` field it got back from the API.

The one partial exception was `src/pages/MapPage.js`, which had its own **local**, hand-maintained `dormLabels = { key: { he, en } }` dictionary for the 8 dorm areas shown as map hotspots — a real bilingual mapping, but scoped to that one file and not reusable anywhere else, exactly the kind of "separate hardcoded translation object" the fix needed to eliminate.

## The fix: one centralized module

**`src/utils/locationNames.js`** is now the single source of truth for these translations. It exports:

| Function | Use when you have… |
|---|---|
| `localizeRegionName(region, language)` | a `{id, name}` region object (from `regionsAPI.getAll()`, a `RegionSerializer`, etc.) |
| `localizeDormTypeName(dormType, language)` | a `{code, name}` dorm-type object (`DormTypeSerializer`, or a building's `dorm_type_code`/`dorm_type_name` pair) |
| `localizeBuildingLabel(label, language)` | a composed building label built server-side as `"<dorm type name> - בניין <N>"` (e.g. `analysis_data`'s `occupancy_data` rows) |
| `localizeById(id, rawName, language)` | both a stable id/code **and** a raw name string, id preferred when known |
| `localizeLocationText(name, language)` | only a raw Hebrew name string and nothing else (an aggregated API field, a `destination_region_names` array entry, etc.) |

Every function: returns the original Hebrew string unchanged when `language !== 'en'`; returns the curated English name when the input is a known canonical name; and **falls back to the original Hebrew string** (never blank, never throws) if the name isn't in the dictionary yet — so an unmapped future region/dorm type still displays *something* meaningful instead of disappearing.

### Why id-based lookup is preferred, and how the fallback works

Every backend serializer that exposes one of these names also exposes the raw id/code next to it (`region` + `region_name`, `dorm_type_code` + `dorm_type_name`, etc. — verified across `serializers.py`), so most call sites can pass both and get the most robust lookup. Where only a raw name string is available (e.g. an aggregated analysis-endpoint field), the module falls back to a **text-keyed dictionary** — safe here specifically because `DormType.name` carries a database `unique=True` constraint, so the Hebrew string itself is already a stable, unambiguous identifier for that tier. `Region.name` has no such DB constraint (a known, pre-existing, low-risk gap — see the v3 report's §19), so region lookups always prefer the `id`-keyed table first.

## The six official region names

The six top-level region names (`Region.name`, always carrying a `"מעונות"` prefix) use the **exact English names supplied directly by the project owner**, sourced from the Technion Dean of Students / dormitory website's own English terminology — not derived, not machine-translated:

| Hebrew (`Region.name`) | English (as supplied) |
|---|---|
| מעונות קנדה | Canada Dormitories |
| מעונות ברושים | Broshim Dormitories |
| מעונות מזרח | East Dormitory Block |
| מעונות גוש עליון | Upper Dormitory Block |
| מעונות גוש תחתון | Lower Campus Dormitories |
| מעונות סגל זוטר | Junior Faculty Dormitories |

Two more region-level names exist purely for edge cases and are **not** part of that official list: `"הטכניון"` → `"Technion"` (the university's own name, already used elsewhere in this app's own UI — e.g. `LoginPage.js`'s "Technion Dormitories Management System" heading — so not a guess) and `"אזור אחר"` → `"Other Region"` (appears only in backend test fixtures, never in real data).

**These six names are region-level only.** The next tier down — `DormType.name`, the bare name without the `"מעונות"` prefix (e.g. `"סגל זוטר"` rather than `"מעונות סגל זוטר"`) — is what building labels are actually composed from, and is a **different string** the official list does not cover.

## Dorm-type-level names (no official source found)

`DormType.name` values (Rifkin, Canada, Kassel, Couples, Mizrah (Old/New), Neve America, Senate, Families, Single Room, Elyon Amim, Segel Zutar, Kfar Mishtalmim, Kfar Hasmaha, Ruth Cohen, Broshim, New Senate — the full canonical list from `EXCEL_DORM_NAME_TO_OFFICIAL_CODE` in `backend/api/views.py`) were **not found published in English anywhere** (not on the Dean of Students site excerpt available to this task, not in any prior code or document in this repository). Per instruction, these were **not guessed freely** — instead:

- Where `MapPage.js`'s pre-existing local dictionary already had an English name for one (Rifkin, Canada, Neve America, Senate, Broshim, Kfar Hasmaha, Kfar Mishtalmim, Segel Zutar), that **exact existing spelling was reused**, so this refactor changes zero visible text on the Map page.
- For the remainder (Kassel, Couples, Families, Single Room, Elyon Amim, Ruth Cohen, New Senate, Mizrah (Old)/(New)) — which have no prior art anywhere in the codebase — a consistent, literal-or-transliterated English name was chosen and documented in `locationNames.js`'s comments, per the original task's "if no English version exists, choose a clear consistent name and document the mapping" instruction.

**If any of these dorm-type-level names should instead use the Dean of Students site's official terminology, please supply it the same way the six region names were supplied**, and it's a one-line change per name in `DORM_TYPE_EN_BY_CODE` / `NAME_EN_BY_HEBREW_TEXT` — every screen that shows dorm-type names will pick it up automatically.

## Display only — never an identifier

Every function in `locationNames.js` returns a string for **rendering only**. No return value from this module is ever used as a lookup/map key, a filter or search-match value, a query parameter, an `<option value=...>`, or anything compared against backend data or sent back to an API — those all continue to use the real `id`/`code`, or (where an id genuinely isn't available) the original Hebrew `name`, exactly as before. Concretely:

- Every `<option value={r.id}>` still submits the real id; only the text node inside the option was changed.
- `BuildingsPage.js`'s search-filter matching (`[b.number, b.dorm_type_name, b.region_name].join(...).includes(query)`) was deliberately **left untouched** — it still matches against the raw Hebrew fields, so search behavior is unchanged.
- `AnalysisPage.js`'s demand-share color assignment previously keyed its color map by the (now-localized) display `label`, which would have re-shuffled a region's donut color every time the language was switched. It was changed to key by the raw `region_id`/`region` value instead (see `regionColorMap` in `AnalysisPage.js`) — a correctness fix required *by* the localization change, not a design change.
- No backend model, migration, serializer, or API field was changed. No permission/region-scoping logic was touched.

## Where this was applied

| File | What changed |
|---|---|
| `src/utils/locationNames.js` | **New.** The centralized module described above. |
| `src/pages/AnalysisPage.js` | Chart row labels (building/region names), the region filter dropdown, and the demand-share color-map keying. Zero layout/design changes — this was an explicit constraint for this page. |
| `src/pages/BuildingsPage.js` | Region/dorm-type breadcrumbs, dropdowns, detail rows, the building-setup wizard's region-name prop, and the dorm-type label helper. |
| `src/pages/MapPage.js` | Refactored to source its English labels from the central module instead of a local, duplicate `en` field — zero visible change (the exact same English text was already established there and reused as-is). |
| `src/pages/ReportsPage.js` | Region filter dropdown. |
| `src/components/Sidebar.js` | The current-region badge (e.g. `"Technion"`). |
| `src/pages/StudentsPage.js` | Region/dorm-type dropdowns across the add-student form, the request-transfer region picker, and the assign-bed region-scope selector; the `getRegionName()` helper used in active filter chips. |
| `src/pages/UsersPage.js` | The `getRegionName()` helper and two region `<select>` dropdowns — these already had the broken `isHebrew ? ... : (nameEn || ...)` pattern described above; now genuinely correct. |
| `src/pages/AllocationPage.js` | The `regionLabel` shown on the allocation summary — same kind of previously-broken ternary as UsersPage, now fixed. |

### Pages found with the same underlying bug, deliberately **not** touched

`TransfersPage.js`, `AssistedAllocationPage.js`, `WhatIfPage.js`, and the shared components `FiltersDrawer.js`, `BuildingSetupWizard.js`, `AssistedCandidateBrowser.js`, and `BedMatchPicker.js` also render raw region/dorm-type/building names without translation — but on inspection, **none of these files branch on the `language` prop for *any* of their UI text** (every label, heading, and button in them is hardcoded Hebrew regardless of the app's language setting; verified by grepping each file for `language ===`/`isHebrew` conditionals). Localizing only the entity *names* in a screen that is otherwise 100% Hebrew text would look inconsistent (a correct English region name surrounded by Hebrew labels) and doesn't fix the actual gap in those screens, which is that they were never given English translations at all — a materially larger task (a full per-page translation pass) than this one. These are flagged here rather than partially patched, per the instruction to report findings instead of guessing scope.

## How to display one of these names in new code

```jsx
import { localizeRegionName, localizeDormTypeName } from '../utils/locationNames';

// have a {id, name} region object:
<span>{localizeRegionName(region, language)}</span>

// have a {code, name} dorm type object:
<span>{localizeDormTypeName(dormType, language)}</span>
```

Never write a new `language === 'he' ? x.name : x.nameEn` (or similar) ternary in a component — extend the dictionaries in `src/utils/locationNames.js` instead, so every screen that shows the same entity stays in sync automatically.
