# System Stabilization and Debugging

**Scope:** Cross-layer investigations spanning imported source data, relational inventory, backend APIs, long-running allocation processes, and frontend state. This report is the master record of *how* each failure was traced to its real layer; implementation detail for each fix lives in the companion reports (`MAHA_BACKEND_API_DATABASE_FIXES.md`, `MAHA_IMPORT_DATA_AND_INVENTORY_STABILIZATION.md`, `MAHA_ALLOCATION_ENGINE_AND_LIFECYCLE_FIXES.md`, `MAHA_ASSISTED_ALLOCATION_AND_TRANSFER_FIXES.md`, `MAHA_TESTING_AND_REGRESSION_RECORD.md`) and is not repeated here.

---

## Cross-Layer Debugging Approach

Dormify's workflows span imported source data, relational inventory, backend APIs, long-running allocation processes, and frontend state. A number of failures presented their symptom in a different layer from their actual cause. The consistent discipline across this history was to reproduce the symptom, inspect the actual persisted state working backward through each layer, identify the layer where reality first diverged from what the next layer up assumed, and correct that layer specifically — rather than working around the symptom where it happened to surface.

```
symptom observed here
        ↑
   layer assumed this was already correct
        ↑
   ... continue backward until a layer's own state is actually wrong ...
        ↑
   root cause
```

Two corrections underlie nearly everything else in this history and are worth naming once, up front, rather than repeating in every case below: assignment state moved from a room-level approximation to an [auditable, bed-level persistence model](../backend/MAHA_BACKEND_API_DATABASE_FIXES.md#bed-level-assignment-correcting-the-persistence-model) used consistently by allocation, manual placement, and transfers; and the student data model was corrected to stop requiring information — resident gender — that [a real class of housing applications never had in the first place](../data-integrity/MAHA_IMPORT_DATA_AND_INVENTORY_STABILIZATION.md#3-housing-applications-that-required-a-gender-they-never-had-z3-z4-z6).

---

## Representative Cases

### 1. Allocation population looked wrong — the population itself was wrong

An unexpectedly present accessibility-affected population in solver results led to inspecting student records directly rather than the solver's constraint logic. This surfaced two real defects at once — accessibility students had no exclusion from the automatic solver at all, and the exclusion's own detection was too narrow — and, two weeks later, a second correction to the same classification once real data showed the widened rule had become too broad in the other direction. See [Accessibility Classification](../data-integrity/MAHA_IMPORT_DATA_AND_INVENTORY_STABILIZATION.md#4-accessibility-classification).

### 2. Whole categories of applications were missing, and the solver was never the cause

Couple, family, and single-occupant-apartment applications require no individual resident gender by their own business rule, but the data model required one from every student regardless of housing type. Genuine applications of these types were being rejected before they ever became allocable data — the solver's results looked incomplete for a reason that had nothing to do with the solver. See [Housing Applications That Required a Gender They Never Had](../data-integrity/MAHA_IMPORT_DATA_AND_INVENTORY_STABILIZATION.md#3-housing-applications-that-required-a-gender-they-never-had-z3-z4-z6).

### 3. One signal, two independent failures with the same symptom

Students belonging to a reserved-building program were not receiving their intended preferential placement. One cause was an import-mapping gap — the field never reached the student record at all. A separate, unrelated cause was a rule interaction inside the solver: an existing, pre-existing bypass for generic priority students was inadvertently also applying to this group, because the import process happened to set both flags together — silently skipping a restriction that should have stayed in force and letting a real, observed set of students leak into unrelated dorm types. Both were confirmed independently, one from data inspection and one from a real-data-validated count of affected students, rather than assumed to be the same defect. See [Priority, ANIR, and Building 179](../allocation/MAHA_ALLOCATION_ENGINE_AND_LIFECYCLE_FIXES.md#5-priority-anir-and-building-179).

### 4. The frontend looked idle while the backend was still working

The allocation page could show an idle, ready-to-start state while a search was, in fact, still active on the server. The frontend had been using its own local component state — which does not survive a navigation or refresh — as its only signal for whether a backend process was running. The fix made the persisted run record, not frontend state, the authoritative source the page re-derives its view from. See [Allocation Run Lifecycle and Recovery](../allocation/MAHA_ALLOCATION_ENGINE_AND_LIFECYCLE_FIXES.md#10-allocation-run-lifecycle-and-recovery).

### 5. A placement looked lost; the database proved it was not

A manual placement appeared to succeed, then the same student reappeared as unplaced after a refresh. Before touching any persistence logic, the actual database state was checked directly — the assignment, the student's own record, and the audit trail were all already correct. The defect was two layers away, in endpoints that read and displayed student state without accounting for a placement that had, in fact, already happened. See [The Post-Assignment State Bug](../assisted-allocation/MAHA_ASSISTED_ALLOCATION_AND_TRANSFER_FIXES.md#the-post-assignment-state-bug).

### 6. A security-scoped endpoint was reused for the wrong purpose

A regional employee opening the transfer dialog saw no destination regions to choose from. The general region-listing endpoint was working exactly as designed — scoped to the caller's own region, which is correct for almost every other use of that endpoint — but the transfer dialog needed something that endpoint was never meant to provide. The fix was a narrow, purpose-specific endpoint exposing only the minimal identity information a destination picker needs, leaving the general endpoint's scoping untouched. See [Region Permissions and the Transfer Dialog](../backend/MAHA_BACKEND_API_DATABASE_FIXES.md#region-permissions-and-the-transfer-dialog).

### 7. Available inventory was not the same as usable inventory

Physical free capacity and legally usable capacity are different questions throughout this system — a free bed in a building whose current residents make it incompatible for a given student is not actually available to them. Several apparent shortages were, on inspection, this distinction rather than a real lack of space; diagnostics were added specifically to make the difference visible without a fresh investigation each time. See [Soft Preferences](../allocation/MAHA_ALLOCATION_ENGINE_AND_LIFECYCLE_FIXES.md#4-soft-preferences) and [Allocation Diagnostics](../allocation/MAHA_ALLOCATION_ENGINE_AND_LIFECYCLE_FIXES.md#9-allocation-diagnostics).

### 8. A database write and an already-loaded in-memory view disagreed within one run

The solver can auto-repair a room whose physical bed records fall short of its configured capacity, creating the missing rows on the spot rather than failing the run. Because rooms were loaded in bulk with their bed records pre-fetched for performance, the newly created rows were correctly written to the database but invisible to the very same room object's already-loaded, in-memory list for the rest of that run — the repair had genuinely happened, and the solver still acted as though it hadn't. The fix explicitly invalidates that in-memory list immediately after the write, so the next read goes back to the database instead of the stale cache. See [Inventory: Authoritative Identity and Physical Capacity](../data-integrity/MAHA_IMPORT_DATA_AND_INVENTORY_STABILIZATION.md#7-inventory-authoritative-identity-and-physical-capacity).

---

## Resulting Reliability Safeguards

- A standing diagnostics record that turns "why is this student unallocated" from a repeat manual investigation into a persisted counter set.
- A single, reused function for "is this student currently actionable," rather than several independent computations of the same fact that could quietly drift apart.
- An explicit database-connection health check at the boundary between a long-running loop and the write that follows it, applied at both ends of this system that have that shape — the tail of a long Excel import, and the persistence step after a long solver run (see [Long Imports and a Stale Database Connection](../data-integrity/MAHA_IMPORT_DATA_AND_INVENTORY_STABILIZATION.md#8-long-imports-and-a-stale-database-connection)).
- Backend-persisted lifecycle state for both allocation runs and import batches, so the frontend is always a *view* onto that state rather than a second, competing source of truth.
- A database-level constraint preventing two active bed assignments for the same student, kept as the last-resort backstop behind every application-level check described above.
