# Import, Data and Inventory Stabilization

**Scope:** Excel import, `ImportBatch` lifecycle, student-field normalization at import time, and the dorm inventory those imports feed into.

---

## 1. Why This Report Exists

The allocation solver only ever sees what the importer wrote into `Student` rows. Several allocation defects that were first investigated as solver problems — an unexpectedly small solver population, a reserved building never receiving its intended occupants, whole categories of applications missing from results — turned out to be caused by the data reaching the solver, not by the solver's own logic.

```
Allocation result looks wrong
        ↓
Solver constraints inspected — logic is correct for the population it received
        ↓
Student population inspected in the database
        ↓
Root cause: the importer classified, derived, or rejected a field incorrectly
```

This pattern recurs across the sections below and is the reason this report exists as its own document rather than being folded into the allocation report: the fixes are import- and data-model corrections, not solver corrections, even though a solver run was usually what first exposed them.

---

## 2. Import-Batch Lifecycle and Data Safety

### Problem

Student uploads originally ran as a single synchronous operation with only two outcomes: succeeded or failed. There was no way to stop a large import mid-run, no way to recover its progress after a page refresh, and — the more serious gap — no controlled way to undo an upload once staff realized the wrong file, or a file with bad data, had already been sent.

### Root Cause

The system had no persistent representation of an import as an ongoing, stoppable, undoable operation. Everything about an upload lived only for the duration of one HTTP request.

### Correction

An import now goes through an explicit lifecycle — created, processing, optionally stop-requested, and a terminal state (completed, stopped, or failed) — with its own database row (`ImportBatch`) tracking progress and holding a durable summary of what happened. This let three real operational needs be supported safely:

- **Stop.** A currently-processing import can be told to stop; it notices on its next row and exits cleanly instead of running to completion.
- **Stop-and-delete, and plain delete.** Undoing an import raises a sharper question than "cancel the request" — *which* rows belong to this batch, which existed before it, and what is safe to remove? Each `Student` row created by an import batch is tagged with the batch that created it (a field kept separate from, and never overwritten by, whichever batch most recently *updated* that row). Deleting a batch's effect therefore only ever removes students that batch itself created — never a pre-existing student it happened to touch, and never any dorm inventory. A student who was created by the batch but has since been given a bed is protected from deletion at the database level and is reported back explicitly rather than silently skipped or allowed to break the rest of the cleanup.
- **Recovery after interruption.** The batch's row persists its own progress and final summary, so a page refresh, a lost connection, or navigating away and back can recover exactly what happened instead of losing it.

This is the same underlying engineering decision as the [allocation-run lifecycle](../allocation/ALLOCATION_ENGINE_AND_LIFECYCLE_REPORT.md#10-allocation-run-lifecycle-and-recovery): a long-running, interruptible operation needs its state to live in the database, not only for the duration of the request or browser tab that started it.

### Verification

`ImportBatchLifecycleTest` exercises the stop/stop-and-delete/recovery sequence directly, including the ownership-scoped deletion behavior described above.

---

## 3. Housing Applications That Required a Gender They Never Had (Z3, Z4, Z6)

### Problem

A visible gap existed in the couple, family, and single-in-a-couple-apartment applications (housing types Z3, Z4, and Z6) reaching allocation — these categories showed up under-represented relative to what the source data actually contained. The solver itself was not at fault: the applications in question never reached it.

### Root Cause

Couple and family applications (Z3/Z4) are evaluated as one household unit, not matched by an individual resident's gender the way ordinary single housing (Z1/Z2) is — the apartments they are placed into are categorized as mixed, not male or female. A Z6 application reserves an entire couple-layout apartment exclusively for one student, again independent of that apartment's stored gender category. The real dorm-office source data reflects this correctly: rows for these housing types frequently arrive with no gender value at all, because the business process behind them never asked for one.

The system's data model did not yet reflect that distinction. The database required every student to have a gender value, with no exception for housing types that do not need one. A genuine, correctly-submitted Z3, Z4, or Z6 application arriving without a gender value therefore could not be saved as a new student at all — it was rejected before it ever became allocable data. An allocation run reviewed afterward would show nothing wrong with its own logic, because the missing applications had already been lost two layers upstream, during import.

### Correction

Two changes were required together, since neither is sufficient alone:

- The requirement itself was corrected at the model level: a student's gender is only required when the housing type actually depends on it. Couple, family, and single-in-a-couple-apartment applications are explicitly exempted, matching the real business rule instead of a blanket database constraint.
- The database schema had to be brought in line with that corrected rule. The model and the deployed schema briefly disagreed after the first change — the code allowed a genderless Z3/Z4/Z6 row, but the database itself did not yet — so a further schema update was needed before the fix actually took effect. This gap was caught during dedicated testing of the change, and the corresponding database migration was completed to close it.
- A fail-early check was added on top of both: if a future deployment is ever missing this schema change, importing a genderless Z3/Z4/Z6 row now raises an explicit, diagnosable error instead of silently rejecting or skipping the row the way the original defect did.

### Impact

This class of bug is a good example of why "the solver looks like it's missing students" and "the solver is broken" are different claims. The correction here did not touch allocation logic at all — it corrected which applications were allowed to become `Student` rows in the first place.

### Verification

The solver's own test suite (`HouseholdExclusivityTest` and related cases) confirms that Z3, Z4, and Z6 applications are treated as complete, independent household units — never matched or grouped by resident gender — at every stage once they do reach the solver, which is the exact distinction this correction was built to preserve at the import boundary.

---

## 4. Accessibility Classification

### Problem

Accessibility and disability applications were reaching the automatic solver as ordinary allocatable students. Operationally this is wrong regardless of what the solver would have done with them: the dorm office's process is to place these students manually, not to let an automatic optimizer decide their bed.

### Root Cause

The importer excluded students who were leaving from the solver's population, but had no equivalent exclusion for accessibility/disability students. Separately, the accessibility flag itself was being set too narrowly — some rows carried no explicit accessibility marker in the dedicated accessibility columns, even though a different column (the student's allocation-group category) already identified them as an accessibility case by its own text.

### Correction, and a correction to the correction

Accessibility students were excluded from the solver's population directly, and the flag's detection was widened to also recognize confirmed accessibility category values from the allocation-group column, not only the dedicated accessibility columns.

That widening was not correct on its first attempt. Two of the three category values it added turned out not to mean individual accessibility at all: one was a student-category label (veterans, and new students later reclassified as veterans) that happened to be added because it did not contain the expected disability keyword; the other named a program track description that mentions disabled students as part of a general track description, not a marker that the individual student in that specific row is a disability case. Both were found by inspecting the actual affected population after the first fix shipped and recognizing it was now too broad rather than too narrow — the same investigative discipline that found the original gap, applied a second time in the opposite direction. The classification was narrowed back down to the one category value that genuinely, individually means accessibility, and the mis-scoped student-category value was instead routed to where it belonged: the student's category field.

### A related classification bug: a coincidental substring match

A separate, smaller defect in the same area is worth recording on its own, because it is a clean example of a common data-quality failure mode. A student's category (new vs. continuing) was partly classified by checking whether a keyword for "new" appeared anywhere inside the allocation-group text. The veterans category above happens to contain that exact keyword as part of a longer, unrelated phrase — so every student in that category was silently misclassified as "new" by coincidence, not by any real similarity in meaning. The fix checks a small set of confirmed, exact category values first, and only falls back to the keyword search for values outside that confirmed set — so a classification can no longer be decided by an incidental substring match.

### Verification

Regression tests pin both the narrowed accessibility set and the corrected category classification, including the specific values that were removed from the accessibility set and the specific value that had been silently misclassified by the substring match.

---

## 5. ANIR (אנייר) Import Mapping

### Problem

Students belonging to the אנייר (Anir) program were not receiving their intended reserved-building preference during allocation.

### Root Cause

The אנייר designation arrives in the source file through its own dedicated column, separate from the general free-text status columns the rest of the system already reads a student's special status from. That dedicated column was never being copied into the status text the allocation logic actually looks at — the student was imported correctly in every other respect, but the one signal the reserved-building rule depended on never reached it.

### Correction

The dedicated אנייר column is now folded into the same status text every other special-status signal already flows through, so it reaches the same downstream logic without requiring a second, parallel code path.

### Verification

Import-level regression tests confirm an אנייר-flagged source row produces a correctly status-marked student after import.

---

## 6. Reserved-Building (Building 179) Eligibility

The אנייר import fix above corrected whether the *signal* reached the solver at all. A separate, independent defect existed on the solver side of the same feature: it is documented under [Priority, ANIR, and Building 179](../allocation/ALLOCATION_ENGINE_AND_LIFECYCLE_REPORT.md#5-priority-anir-and-building-179), together with the diagnostic counters added afterward specifically so a future recurrence of either an import-mapping failure or a solver-side eligibility failure is visible immediately, rather than requiring a fresh investigation.

---

## 7. Inventory: Authoritative Identity and Physical Capacity

### Authoritative dorm identity

An imported student's accepted dorm type is resolved primarily through a business-defined dorm code, not through a name or a database row id. When that code is present in the source file, it is the only thing consulted — the resolution deliberately never falls back to a name, a region, or the underlying database primary key. Name-based matching exists only to support older files where the code column itself is blank. This distinction matters because a name or a database id can drift or collide in ways a stable, externally-defined business code does not; keeping the code authoritative, and everything else a fallback, is what keeps dorm-type resolution predictable as source files evolve.

### Problem: physical capacity versus configured capacity

An apartment has two different numbers that can be called its "capacity," and they answer different questions. One is a configured, declared value used by the building-management tools — useful for planning and for validation, such as refusing to shrink an apartment's declared capacity below its current number of residents. The other is the count of actual, individually identified bed records that physically exist underneath that apartment's rooms. Only the second one is what the solver can actually place a student into. A student cannot occupy a declared number; they occupy a specific bed row.

The system treats this distinction deliberately rather than assuming the two numbers always agree: a room's configured capacity is the upper bound on how many active residents it may ever hold, but if the actual bed rows underneath it fall short of that number, placement logic treats this as a data-integrity problem to be surfaced, not silently worked around. Materializing the missing bed rows is an explicit, admin-triggered operation everywhere outside the solver itself — never something a read or placement path is allowed to do quietly on its own.

### The solver's own self-repair, and a stale in-memory cache

The solver is a deliberate, narrow exception to that rule: when preparing its inventory for a run, it will automatically create any bed rows still missing relative to a room's configured capacity, rather than fail the whole run over what is usually a small, previously unmaterialized gap. This exception introduced its own, purely technical defect. Rooms are loaded in bulk with their bed rows pre-fetched for performance, before the solver's inventory preparation begins. When the self-repair created new bed rows partway through that preparation, the room object's already-loaded, in-memory list of beds did not know about them — so the very next step, reading that same room's beds again to build the solver's candidate list, still saw the old, incomplete list. The repair had genuinely written the missing rows to the database, but the solver's own in-memory view of that room silently continued acting as though they did not exist, for the remainder of that same run.

### Correction

The fix is narrow and specific to where the inconsistency was introduced: immediately after creating the missing bed rows, the room's stale in-memory cache of its own beds is explicitly cleared, so the very next read of that room's beds goes back to the database and sees the rows that were just created. The underlying lesson generalizes beyond this one case: a database write and an already-loaded, in-memory representation of that same data can disagree within a single run unless the in-memory side is deliberately invalidated after the write — a mismatch that has nothing to do with the correctness of the write itself.

### Verification

The solver's inventory-preparation test coverage exercises the missing-bed-row repair path directly, confirming a room's newly created beds are visible to the very same run that created them.

---

## 8. Long Imports and a Stale Database Connection

**Problem:** A large student-import file processes hundreds of rows in a single request. Occasionally, the row-by-row work itself would visibly succeed — students correctly created or updated one at a time — while a step that ran only after the whole loop finished (writing the per-region inbox summary, or the batch's final status) failed.

**Root Cause:** The hosted PostgreSQL connection can go idle and be closed server-side during a long-running request. Django does not automatically detect and recover from this mid-request — the next query on that same connection simply fails. A per-row loop that finishes in well under the idle timeout never hits this; a loop long enough to process a full workbook can outlast it, so the failure lands on whatever runs immediately afterward, not on the import itself.

**Correction:** A small helper checks the connection's health and transparently reconnects if it has gone stale, called explicitly at the boundary after the row loop and before the subsequent metadata writes — and, separately, before the equivalent post-solve persistence step in the allocation engine (see [Persisting Results After a Long Solve](../allocation/ALLOCATION_ENGINE_AND_LIFECYCLE_REPORT.md#persisting-results-after-a-long-solve)), since both share the same shape: a long-running loop followed by a database write that must not inherit a connection the loop has outlived.

**Verification:** Exercised as part of the import-batch lifecycle test coverage; the connection-refresh helper itself is a small, independently reviewable function called at each of these boundaries.

---

## 9. Two Source Files, One Canonical Student State

The dorm office works from two different files: a main placement file, and a separate additions/decisions file recording later per-student housing decisions for students not already in the main file. Reconciling the two into one consistent student record required several rules working together, not one fix:

- **Only positive decisions are imported** from the additions file — a decision row that was not approved is skipped rather than treated as a placement.
- **An existing student's lifecycle category is never overwritten** by the additions file. The category (e.g. new vs. continuing) reflects the main file's own lifecycle tracking; the additions file only enriches other fields, and the category is explicitly re-checked and restored after saving as a second line of defense, not merely excluded from the update once.
- **The official numeric dorm decision code is authoritative.** When it can be resolved to a real dorm type, it is used; when it cannot, the code deliberately does **not** fall back to guessing a dorm type from the file's descriptive dorm-name text — silently substituting a name-based guess for a failed official-code lookup would risk routing a student to the wrong dorm type without any visible sign that a fallback had occurred. An existing student's prior accepted dorm type is preserved in that case, with a warning recorded rather than an error.
- **A legitimate decision is preserved even when its inventory isn't provisioned yet.** If a resolved dorm type currently has no active building inventory, the decision is still saved — deleting or blocking it would destroy a real, approved administrative decision because of a temporary provisioning gap — but a warning is attached so staff know allocation may find no feasible room for that student until inventory catches up.

**Verification:** Import-summary counters and warnings (positive/non-positive decision counts, category-preservation counts, unresolved-dorm-code and missing-inventory warnings) are produced on every additions upload, and dedicated import tests cover the positive-decision filter, category preservation, and the authoritative-code-over-name-guess behavior.

---

## 10. Inventory Consistency

Dorm inventory — buildings, apartments, rooms, and beds — is never modified as a side effect of an import or student-lifecycle operation; the batch-ownership deletion described in [Import-Batch Lifecycle and Data Safety](#2-import-batch-lifecycle-and-data-safety) only ever touches `Student` rows. Editing or deactivating inventory is protected the same way, but not by refusing the deactivation outright: a building, apartment, or room can be deactivated even while it has active residents, going through the dedicated availability ("What-If") workflow rather than a direct field edit. Deactivation never silently unassigns or deletes an affected resident's active `BedAssignment` — the occupant stays exactly where they are — and a pending `StudentRequest` (the same room/apartment-transfer request type staff already work from on the Transfer Requests page) is created for each affected student so the relocation is queued for manual resolution instead of the change simply making them disappear from the workflow.

---

## 11. Verification Summary

Regression coverage across this report spans import-batch lifecycle and safe cleanup, accessibility and category classification (in both directions of the correction), the אנייר mapping fix, the additions-file reconciliation rules, inventory edit-safety, and the bed-row/capacity consistency fix. Full verification methodology and status are in [Verification Status](../testing/TESTING_AND_REGRESSION_REPORT.md#verification-status).

---

## Implementation Traceability

Representative commits:
- `693d78a` — introduced the normalized bed-level schema this pipeline writes into (see [Bed-Level Assignment: Correcting the Persistence Model](../backend/BACKEND_API_AND_DATABASE_REPORT.md#bed-level-assignment-correcting-the-persistence-model)).
- `60aed10` — rebuilt the upload pipeline against real, database-connected inventory in place of an earlier mock-data flow; introduced the stale-connection refresh helper.
- `80c3ebf`/`4b90437` — introduced the additions-file reconciliation rules (positive-decision filter, category preservation, authoritative dorm code).
- `b982895` — first accessibility-exclusion and אנייר-mapping fix.
- `f9ac13e` — narrowed the accessibility classification and corrected the category-parsing substring bug.
- `91ea415` — broader inventory/allocation overhaul that this pipeline's output feeds into.
- `76a2716` — import-batch lifecycle, safe stop-and-delete, and recovery.
- `c72d083` — completed the database migration needed for the [Z3/Z4/Z6 gender fix](#3-housing-applications-that-required-a-gender-they-never-had-z3-z4-z6).
- `5626a16`/`d8506f5` — the stale bed-row cache fix described under [Inventory: Authoritative Identity and Physical Capacity](#7-inventory-authoritative-identity-and-physical-capacity).
