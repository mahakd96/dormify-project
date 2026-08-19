# UI Fix: Gender Terminology Standardization

Branch: `donia-ui-fixes`. Continuation of the earlier reports
(`DASHBOARD_AND_WHATIF_REPORT.md`, `TRANSFER_AND_MANUAL_ALLOCATION_REPORT.md`), all of
which remain untouched by this pass.

## Old terminology → new terminology

| Value | Old Hebrew | Old English | New Hebrew | New English |
|---|---|---|---|---|
| `male` | זכר | Male | **גבר** | **Man** |
| `female` | נקבה | Female | **אישה** | **Woman** |

Applies to every **student**-gender display and selector in the frontend. Backend/API raw values
(`male` / `female`) are unchanged everywhere.

## Shared helper introduced

Created **`src/utils/genderLabels.js`**, exporting `localizeGender(value, language)`, following the
exact same documented convention as the project's existing `src/utils/locationNames.js` (single
source of truth, "never hardcode a second lookup table", display-only return value). Every file
below now imports and uses this helper instead of maintaining its own male/female map, so future
terminology changes only need to happen in one place.

```js
localizeGender('male', 'he')   // 'גבר'
localizeGender('female', 'en') // 'Woman'
localizeGender('', 'he')       // '' (empty/unknown passes through, never throws)
```

## Files changed

| File | What changed |
|---|---|
| `src/utils/genderLabels.js` **(new)** | The shared `localizeGender` helper |
| `src/pages/StudentsPage.js` | Add/Edit-student gender `<select>` options, the gender filter chip, and the selected-student detail-panel gender row now use `localizeGender` |
| `src/pages/TransfersPage.js` | Add-Student wizard's gender `<select>` options (`T.genderMale`/`T.genderFemale`) now sourced from `localizeGender` |
| `src/pages/AssistedAllocationPage.js` | Gender filter `<select>` options; queue-list student tag and student-detail fact-grid gender row now derived from the raw `gender` value via a new `T.genderOf()` helper (was reading the fixed-Hebrew `gender_display`) |
| `src/pages/WhatIfPage.js` | Affected-Students table's gender column now derives from raw `student.gender` (was reading fixed-Hebrew `gender_display`); Impact-Summary "Males"/"Females" count-card labels updated to the natural plural of the new terms (see note below) |
| `src/pages/AllocationResultsPage.js` | Two places that rendered the **raw, untranslated** `gender`/`gender_display` value directly (a pre-existing bug - literal "male"/"female" or fixed-Hebrew text was shown to users) now use `localizeGender` |
| `src/components/FiltersDrawer.js` | Gender filter's `Male`/`Female` segmented-button labels now use `localizeGender(value, language)` (previously hardcoded English regardless of the page's language - the rest of this component's other labels remain hardcoded English, a pre-existing, unrelated gap intentionally left out of this terminology-only pass) |
| `project-quality/ui/GENDER_TERMINOLOGY_REPORT.md` | This report |

No backend files were changed. Every endpoint the frontend uses already returns the raw `gender`
enum value (`'male'`/`'female'`) alongside `gender_display` (confirmed directly in
`backend/api/views.py` - `_assisted_allocation_student_row`, `StudentListSerializer`,
`StudentSerializer`, and the What-If assignment formatter all already include a raw `gender`
field), so Task 3's "smallest additive backend change" fallback was never needed.

## Plural count-card wording (What-If Impact Summary)

The What-If page's Impact Summary shows two **count** cards - "How many affected students are
male / female" (`summary.male_count` / `summary.female_count`). Applying the singular "Man"/"Woman"
literally to a count card would read unnaturally ("15 Man"), so these two labels were translated to
the natural plural of the same new terminology: **"Men"/"Women"** in English and **"גברים"/"נשים"**
in Hebrew. This keeps the same terminology family (not `Male`/`Female`/`זכר`/`נקבה`) while staying
grammatically natural, consistent with this project's existing "don't mechanically translate where
it would sound unnatural" convention (documented in the earlier localization reports). This is the
only place a plural form was needed; every other surface shows one student's gender at a time and
uses `localizeGender` directly.

## Deliberately out of scope: apartment/building gender **category**, not student gender

Several `male`/`female`/`מעורב`(`mixed`) label maps exist in the codebase for a **different**
concept - an apartment's occupant-gender **category** or a building's gender **restriction**
(e.g. "this building only houses male students") - which reuses the same two backend enum values
but describes a physical space's policy, not a specific student's own gender identity. The task's
instructions scope this pass to **student** gender display ("we do NOT want ... for student gender
anywhere in the application"; the enumerated surfaces are all student-facing views). These were
therefore intentionally left unchanged:

- `src/pages/BuildingsPage.js` - building "Gender restriction" / apartment "Category (gender)" labels.
- `src/components/BuildingSetupWizard.js` - same building-setup gender-restriction labels.
- `src/components/BedMatchPicker.js` - `GENDER_LABEL_HE`/`GENDER_LABEL_EN`, used only for an
  apartment's occupant-gender composition (`apartment.apartment_gender`), never for a resident's
  own gender.
- `src/pages/AssistedAllocationPage.js` - `CATEGORY_LABEL_HE`/`CATEGORY_LABEL_EN`, used only for
  apartment-category config-change opportunities (`opportunity.current_category`/
  `proposed_category`), never for `student.gender` (which was fixed - see above).

`src/data/mockData.js` also still contains an old-style `male`/`female` lookup array, but this file
is **not imported anywhere** in the codebase (verified by grep) - it is dead code, never rendered to
a user - so it was left untouched rather than edited for no visible effect.

## Confirmation: raw API/enum values unchanged

No `<option value=...>`, filter parameter, request payload field, model choice, or serializer field
was changed. Verified by inspection of every edited call site:
- `<option value="male">`/`<option value="female">` values in `StudentsPage.js`, `TransfersPage.js`,
  and `AssistedAllocationPage.js` are untouched - only their visible text changed.
- `FiltersDrawer.js`'s `SegmentedButtons` still emit `'male'`/`'female'` as the toggled value; only
  `label` changed.
- `activeFilters.genders`, `params.gender`, `params.genders`, and every `studentsAPI`/
  `assistedAllocationAPI`/`allocationAPI` call still send/receive the raw enum values.
- `localizeGender()`'s return value is never used as a key, filter value, or request parameter
  anywhere it was introduced (grep-verified) - purely a render-time label.

## Verification

1. **Grep sweep for remaining user-facing occurrences** of `זכר`/`נקבה`/`Male`/`Female` after the
   change: only found inside (a) `genderLabels.js`'s own explanatory comment, (b) the dead/unused
   `mockData.js`, and (c) the three apartment/building-category files explicitly scoped out above.
   No remaining occurrence where the new student-gender terminology should have applied.
2. Manually traced both language branches for every changed call site:
   - Hebrew: `localizeGender('male','he')` → `גבר`, `localizeGender('female','he')` → `אישה`.
   - English: `localizeGender('male','en')` → `Man`, `localizeGender('female','en')` → `Woman`.
3. Filters/dropdowns verified: `StudentsPage.js`'s Add/Edit-student gender selects,
   `TransfersPage.js`'s Add-Student-request gender select, `AssistedAllocationPage.js`'s queue
   gender filter, and `FiltersDrawer.js`'s gender segmented buttons all resolve through the same
   shared helper now.
4. Raw backend/API values confirmed unchanged (see section above).
5. `npm run build` (production build, `CI=true`): **Compiled successfully**, no ESLint warnings.
6. No backend production code was changed in this session, so the backend test suite was
   intentionally **not** run, per the task's own instruction.
7. `git diff --stat` reviewed: only `src/utils/genderLabels.js` (new) and the six page/component
   files listed above (plus this report) are part of this change; `backend/api/concurrency_tests/`,
   `project-quality/concurrency/`, and all allocation-algorithm/solver/test code do not appear.
8. Nothing was committed, pushed, or merged.

## Still requiring manual browser verification

1. Visual check, Hebrew: Students page (list filter chip, Add/Edit dialogs, student detail panel),
   Transfer Requests (Add-Student wizard), Manual Allocation (filter + queue tags + student detail),
   What-If (Affected-Students table + Impact-Summary cards), and Allocation Results table - all show
   `גבר`/`אישה` (and `גברים`/`נשים` on the What-If count cards) for real students.
2. Same check in English - all show `Man`/`Woman` (`Men`/`Women` on the What-If count cards).
3. Switching the language toggle live on each of these pages updates the gender label immediately
   without a reload.
4. Confirm gender filters (Students page filter drawer, Manual Allocation gender dropdown) still
   correctly filter results after the label change (values are unchanged, but worth a live check).
5. Browser console check for runtime errors on each of the five pages above, in both languages.
