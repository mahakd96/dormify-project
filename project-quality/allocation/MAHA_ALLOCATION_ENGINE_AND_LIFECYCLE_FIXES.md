# Allocation Engine and Lifecycle Stabilization

**Scope:** The OR-Tools allocation solver, and the surrounding lifecycle of a long-running allocation run — how it is started, watched, stopped, recovered, and turned into persisted assignments.

---

## 1. The Allocation Pipeline

```
imported Student rows (see MAHA_IMPORT_DATA_AND_INVENTORY_STABILIZATION.md)
        ↓
eligible population (excludes students who are leaving or accessibility cases)
        ↓
inventory + existing active bed assignments
        ↓
constraint model: hard rules + weighted soft preferences
        ↓
solution extraction → persisted bed assignments
        ↓
allocation run record (status, diagnostics, live snapshot)
        ↓
API → frontend
```

A defect in the solver's own rules and a defect in the population or inventory it receives look identical from the outside — both produce "the wrong students in the wrong beds." Distinguishing them required inspecting what the solver actually received before touching its logic. Several corrections in this report turned out to belong to the population or inventory side of this pipeline, not the constraint logic — see [Why This Report Exists](../data-integrity/MAHA_IMPORT_DATA_AND_INVENTORY_STABILIZATION.md#1-why-this-report-exists).

---

## 2. Why the Allocation Workflow Had to Be Reworked

The solver did not reach its current form through a sequence of independent patches. Early versions were built against a simplified picture of the housing domain; as the real inventory, the real range of housing types, and the real operational rules (existing residents, exclusive apartments, reserved buildings, religious and gender restrictions, priority and accessibility handling) were connected, that simplified picture stopped matching production reality. At several points, extending the solver required reconsidering how students, apartments, and constraints were represented together, not adding an isolated condition on top of the existing model.

Two changes illustrate this most clearly. Introducing [bed-level assignment tracking](../backend/MAHA_BACKEND_API_DATABASE_FIXES.md#bed-level-assignment-correcting-the-persistence-model) changed what the solver was even allocating *into* — from room-level occupancy to individually identified beds — which every constraint and every persistence step downstream had to be built against. And representing couple, family, and single-in-an-apartment applications correctly (see [Couples, Families, and Single-Occupant Apartments](#7-couples-families-and-single-occupant-apartments-z3-z4-z6) below) required treating an entire apartment, not a single bed, as the unit being allocated for those housing types — a distinction the earlier, single-student-per-bed model had no way to express. Later work extended and strengthened this model considerably (stronger religious and gender rules, existing-occupant protection, reserved-building policy, diagnostics, live search control) without needing another change of this kind, because the underlying representation was now capable of holding the real domain.

---

## 3. Hard Constraints

These define what a *legal* placement is — the solver cannot produce an assignment that violates one, regardless of preference weighting:

| Constraint | What it enforces |
|---|---|
| Gender / housing-type match | A student's housing type must match the apartment's category, except where a housing type is explicitly gender-neutral (see [Couples, Families, and Single-Occupant Apartments](#7-couples-families-and-single-occupant-apartments-z3-z4-z6)) |
| Building-level gender restriction | When a building has a gender restriction set, it overrides the individual apartment's own category for matching purposes in every room of that building — a conflicting or mislabeled apartment-level category can neither admit a student who doesn't match the building restriction nor block one who does. An existing occupant who no longer matches a restriction set *after* they moved in does not get relocated to fix it; instead the whole building is frozen to further automatic assignment until staff resolve the conflict manually, since adding anyone else (either gender) cannot fix a conflict that already exists |
| Religious compatibility | Two-directional: existing religious occupants restrict who may join an apartment (or, for shared-facility layouts, a specific room — see below), *and* an incoming religious student's own restriction is checked against who already lives there. Either direction alone can rule out a candidate |
| Exclusive housing types | Couple, family, and single-in-an-apartment applications occupy their apartment exclusively — no other student may share it |
| Accepted dorm type | A student may only be placed within the dorm type they were accepted into, with narrow, explicitly-defined exceptions |
| Reserved apartments | Reserved inventory is only usable by students the reservation is actually for |
| Building 179 / Upper Dorm Office reservation | Non-eligible students can never automatically consume Building 179; eligible אנייר students accepted into its dorm type are preferred there but not confined to it, and may legally overflow into any other compatible building within that same accepted dorm type. The rule does not apply to manual placement (see [Manual Overrides](../assisted-allocation/MAHA_ASSISTED_ALLOCATION_AND_TRANSFER_FIXES.md#candidate-evaluation-and-manual-overrides)) |
| Mutual roommate requests | A hard roommate pairing is only honored when both students requested each other — see [Roommate Identity Normalization](#roommate-identity-normalization) for how "the same student" is reliably determined across different request formats |

## 4. Soft Preferences

Below the hard rules, the solver optimizes for a set of weighted preferences — same religion, roommate match quality, sector matching, and reducing certain student-year and program mixes — plus a smaller preference for clustering priority and reserved-building placements together where legally possible. A physically free bed is not always a *usable* one: a free bed in a building whose current residents make it religion- or gender-incompatible with a given student is legally unusable for them even though it counts as available capacity. This is why [allocation diagnostics](#9-allocation-diagnostics) distinguish free capacity from feasible capacity rather than reporting only the former.

---

## 5. Priority, ANIR, and Building 179

### The final rule

Building 179 is a reserved building inside one specific dorm type (כפר הסמכה). Eligibility for it is narrow and precisely defined: a student must both carry the אנייר designation *and* actually be accepted into that same dorm type — the אנייר marker alone is not sufficient. A student who does not meet both conditions can never be placed there automatically, regardless of priority status or any other flag. This half of the rule is a hard restriction with no exceptions.

The other half is not a restriction at all: an eligible אנייר student is *preferred* for Building 179 over the rest of their dorm type, not confined to it. If Building 179 cannot accommodate them, they can still be placed in any other compatible building within the same accepted dorm type — the preference is a reward the solver's optimizer chases when it can, not a hard requirement that leaves a student unplaced when it can't. A non-eligible student can never consume Building 179's capacity in the first place, so this overflow behavior does not come at their expense.

### A confirmed regression: priority status silently bypassing the accepted dorm type

A real, observed regression illustrates why this had to be encoded carefully rather than as a single combined flag. Separately from Building 179 itself, students with a generic priority status have an existing code path that bypasses the ordinary accepted-dorm-type restriction — a path that predates the Building-179 policy, is unrelated to אנייר students, and was left unchanged when that policy was introduced. The two rules collided: because the אנייר import process also sets the same generic priority flag as a side effect, an אנייר student was very often *also* a generic-priority student — and if the generic bypass were allowed to apply to them too, their accepted-dorm-type restriction would be silently skipped entirely, not merely relaxed toward Building 179's own dorm type.

Real-data validation caught exactly this: a subset of affected students eligible אנייר students were found placed in unrelated dorm types they had no connection to at all. The correction makes enforcement of the accepted-dorm-type restriction unconditional for any אנייר-marked student, regardless of their priority status — closing the bypass specifically for this group while leaving the original, unrelated generic-priority bypass intact for everyone else. This does not narrow an eligible אנייר student's real options: their own dorm type already includes Building 179 and every legitimate overflow building, so enforcing the restriction only ever removes candidates they were never supposed to have.

### The import-mapping layer

A separate, earlier defect existed one layer up from this: the אנייר signal from the source file was, at one point, not reaching the student record the solver reads from at all — described fully in the [ANIR import mapping section](../data-integrity/MAHA_IMPORT_DATA_AND_INVENTORY_STABILIZATION.md#5-anir-אנייר-import-mapping) of that report. That defect and the regression above are independent — one is about whether the signal reaches the student record at all, the other is about how the solver reasons once it has that signal — and are kept as two separate corrections for that reason.

A standing diagnostic distinguishes *imported* אנייר students, from *eligible* ones, from ones who actually had the reserved building available as a real candidate at solve time, so a future recurrence of either layer's failure is visible immediately as a mismatch between those counters, rather than requiring a fresh investigation.

### Verification

Dedicated regression cases cover the import-mapping fix, the accepted-dorm-type enforcement fix, and the Building-179 preference-versus-restriction behavior separately, so each layer's correction is independently protected.

---

## 6. Group-Capacity Search Performance

A soft-grouping preference (used for sector matching and similar rules) tracks, per group and apartment, whether that group is present there at all. That correctly models legality but leaves the solver's own internal search looser than it needs to be — nothing directly told it how many students from a group could realistically fit at a given apartment, so it could spend time exploring branches a tighter bound would have ruled out immediately.

A redundant capacity bound was added per group: the number of students from that group actually placed cannot exceed the group's available capacity across the apartments it could go to. "Redundant" here is the operative property — the bound is mathematically implied by rules the model already enforced, so it introduces no new business rule, changes no legal outcome, and cannot change an already-optimal result. It only helps the solver reach the same answer with less wasted search. This was validated explicitly against the existing solver test suite before and after the change, confirming identical legality and identical objective outcomes on the same scenarios, with reduced search effort.

---

## 7. Couples, Families, and Single-Occupant Apartments (Z3, Z4, Z6)

Ordinary single-student housing is matched to an apartment by resident gender. Three housing types are deliberately not handled this way, and the solver treats them as a distinct case rather than a variation on the single-student rule:

- **Couple and family applications** are evaluated as one household unit occupying an entire apartment, placed into apartments categorized as mixed rather than male or female — matching by individual resident gender does not apply to them.
- **Single-occupant, couple-layout applications** reserve an entire couple-layout apartment exclusively for one student, independent of that apartment's stored gender category.

In every one of these cases, one student record represents one complete, independent application. This was deliberately confirmed against the real business process rather than assumed: an alternative design was explored where two same-type records linked by a mutual roommate request could be treated as verified members of one household, sharing an apartment's bed capacity. That approach was checked against the actual business rule and found incorrect — there is no such thing as a household's second member stored as its own student record in this system — and was not carried forward. The rule that shipped is simpler and stricter: two such records are always two different applications, never merged or grouped, regardless of any roommate request between them.

This distinction mattered in practice, not only in principle. A capacity rule enforcing "at most one exclusive application per apartment" interacts with the solver's general roommate-pairing logic, which otherwise assumes two paired students are meant to end up together. Exclusive-type applications were not originally excluded from that general pairing machinery, so a mutual roommate request between two unrelated couple, family, or single-occupant applicants could interact with the one-application-per-apartment rule in a way that incorrectly constrained both applications, even though they could never legally share an apartment in the first place. The fix excludes exclusive-type applications from the general roommate-pairing machinery entirely, so a stray or coincidental mutual request between two such applicants can no longer affect either one's placement.

Existing residents in these apartment types are respected the same way as any other occupied inventory — a reserved, exclusive apartment is never treated as available capacity for a second, unrelated application. And the same failure mode already described for accessibility and gender-nullability (see [Housing Applications That Required a Gender They Never Had](../data-integrity/MAHA_IMPORT_DATA_AND_INVENTORY_STABILIZATION.md#3-housing-applications-that-required-a-gender-they-never-had-z3-z4-z6)) applied here too before that fix: rejecting a legitimate application for lacking information that was never actually relevant to it.

**Verification:** the solver's household-exclusivity test suite covers this directly — one application per unit, no cross-application grouping including under a mutual roommate request, and correct handling when capacity is tight across multiple independent applications of the same type.

---

## 8. Existing-Occupant Protection

Re-running allocation must never treat an occupied bed as free. Existing active assignments are accounted for the same way a newly proposed assignment would be, and are never modified as a side effect of a later run. Where an existing occupant no longer matches a rule that was configured after they were placed (for example, a building's gender restriction changed after someone already lived there), this is surfaced as a diagnostic warning, never as an automatic move.

The inventory a run is protecting also has to be internally consistent within that same run — including a case where the solver's own bed-count self-repair could contradict itself mid-run. That defect and its correction are described in [Inventory: Authoritative Identity and Physical Capacity](../data-integrity/MAHA_IMPORT_DATA_AND_INVENTORY_STABILIZATION.md#7-inventory-authoritative-identity-and-physical-capacity).

---

## 9. Allocation Diagnostics

A persisted diagnostics record exists specifically to answer "why does this student remain unallocated" without a fresh manual investigation each time — distinguishing, for example, how many אנייר students were imported, how many were actually eligible for their reserved building, and how many of those eligible students had that building available as a real candidate once the solver ran. Collapsing what would otherwise be a multi-step database investigation into one standing counter set is the direct, practical payoff of this mechanism.

---

## 10. Allocation Run Lifecycle and Recovery

### Problem

The allocation page could appear idle — as if no search were running — while a search was, in fact, still active on the backend. Navigating away and back, or simply refreshing, could lose track of a genuinely in-progress run.

### Root Cause

The frontend was using its own local, component-scoped state as its only signal for whether a search was active. A backend search can run for minutes and is entirely independent of any browser tab watching it; local component state does not survive a remount, but the backend process does.

### Correction

The persisted allocation-run record — its status, when the search actually started, and its latest live snapshot — became the single authoritative source the frontend re-derives its view from on every load and every poll, rather than trusting whatever local state happened to survive a remount. This also enabled a duplicate-run check on page load, so a fresh page load can discover and resume watching an already-active run instead of assuming none exists and allowing a second, conflicting run to start.

### Verification

Dedicated tests cover run-status transitions, active-run discovery, and the timing values the frontend anchors its display to.

---

## 11. Live Preview and Stop-and-Save

### Why this exists

The solver provides no reliable signal for "percent complete" beyond elapsed time against a configured limit — completion progress and search-time progress are not the same thing, and the allocation page is explicit about which one it shows. Staff needed a way to see the current best solution mid-search and, when the remaining wait was not worth it, to deliberately accept the best solution found so far rather than only ever being able to wait for the full timeout or get nothing.

### Correction

The solver periodically captures its current best solution to a small in-memory registry as it searches, with a throttled copy also persisted to the database so a preview request can be served even by a different process than the one actually solving. Two distinct actions exist for ending a run early: a plain stop, which discards the run with no result persisted, and stop-and-save, which persists whatever the best solution found so far was. Viewing the current result is a pure read that never touches the solver or persisted assignment state, so it stays available even while a stop request is already in flight.

Every returned solution — automatic or manually stopped — carries an explicit flag stating whether it was mathematically proven optimal or only the best solution found within the available time or search budget. This distinction predates the live-preview work itself and is what the "stopped manually, not proven optimal" indicator on a manually-ended run is built on.

### Configurable search runtime

The "configured limit" the search runs against is itself a per-run, staff-selectable value, not a fixed constant. When a run is started without an explicit value, the search defaults to 500 seconds; staff may otherwise select any duration from 1 second up to 36,000 seconds (10 hours). The requested value is validated against those same bounds twice — once when the run is created, and again independently inside the solver itself, so a malformed or bypassed request can never reach the search with an unreasonable duration — and is persisted on the run record (`AllocationRun.max_search_seconds`) alongside when the search actually started (`AllocationRun.search_started_at`), which is what the frontend's elapsed-time display and progress indicator anchor to on every poll rather than timing anything client-side.

### Verification

Dedicated tests cover the live-snapshot mechanism, the preview endpoint, and the stop-and-save/stop race conditions directly, including cases exercising a real background watcher thread against committed database state.

---

## Room-Level Compatibility for Shared-Facility Apartments

Most apartments in this system are private-room layouts, where an apartment and the room a student actually sleeps in are effectively the same unit. Some apartments are not: a shared-facility layout has several rooms under one apartment, with individual rooms holding more than one student each. For those, evaluating religion and roommate compatibility at the *apartment* level is too coarse — it would treat two students who will never actually share a room as if they needed to be compatible, and could block a legal room-level pairing because of an unrelated occupant elsewhere in the same apartment.

The solver routes shared-facility apartments through a room-level candidate and compatibility path instead of the ordinary apartment-level one, evaluating religion, roommate requests, and related preferences against the actual room a pairing would occupy. Ordinary single-room (or several-single-bed-room) apartments are left entirely on the existing apartment-level path, since room and apartment are equivalent there and nothing changes. This was a modeling addition, not a roommate feature on its own — it exists because "who is compatible with whom" stopped being answerable at the apartment granularity once shared-facility layouts entered the real inventory.

**Verification:** dedicated solver test cases cover shared-facility apartments directly, including cases where an apartment-level view would have wrongly blocked or wrongly permitted a placement that the room-level view resolves correctly.

---

## Roommate Identity Normalization

**Problem:** Two students' mutual roommate request has to be recognized reliably for hard-roommate matching (and its exclusion from exclusive-type applications, see [Couples, Families, and Single-Occupant Apartments](#7-couples-families-and-single-occupant-apartments-z3-z4-z6)) to work at all.

**Root Cause:** A roommate request can reference the other student in more than one way depending on which import era or field a given student's data came through — a business student id in a structured per-slot field, a simpler list/CSV-style field, or an older free-text field that may hold a name instead of an id. A name, in turn, can appear in either order ("first last" or "last first") with inconsistent spacing, punctuation, or capitalization. None of these representations could be compared directly against each other or against a student's own identity fields.

**Correction:** Requests are read through one function that reconciles the different field generations into a single list of `{target, positive}` pairs, falling through from the current structured fields to the older ones only when the current ones are empty. Comparing a request's target against a candidate student is done by generating a small set of normalized match keys on both sides — the raw identifier, both name-order combinations, each in a whitespace-normalized form and again with punctuation stripped — and checking for any overlap, rather than requiring one exact string match.

**Verification:** Roommate-matching test cases cover mutual requests expressed through different field generations and different name formats, confirming they resolve to the same match result.

---

## Persisting Results After a Long Solve

**Problem:** After a long CP-SAT search completed successfully, saving its result could itself fail or hang.

**Root Cause:** Results were originally persisted by looping over each assigned student and saving that student's assignment individually as the solution was extracted. Two problems compounded: a long solve can leave the database connection stale by the time persistence starts (see [Long Imports and a Stale Database Connection](../data-integrity/MAHA_IMPORT_DATA_AND_INVENTORY_STABILIZATION.md#8-long-imports-and-a-stale-database-connection) for the same failure mode in the import pipeline), and a per-student loop of individual saves is exactly the shape of code most exposed to a connection problem appearing partway through, potentially leaving a run partially persisted.

**Correction:** The solver now builds the full set of assignments to create and students to update as plain in-memory objects first, refreshes the database connection immediately before touching the database, and then persists everything in one short transaction using bulk operations — one bulk insert for the new bed assignments, one bulk update for the affected students — rather than one round-trip per student. This is a database-reliability change, separate from the CP-SAT search-performance work in [Group-Capacity Search Performance](#6-group-capacity-search-performance): it affects how a completed solution is saved, not how the search itself reaches that solution.

**Verification:** Covered by the same persistence-path tests exercising post-solve assignment creation; the transaction is short and atomic, so a failure part-way through leaves no partial result.

---

## Persisted Results, Not Transient State

Results shown to staff are read back from the database — active bed assignments tied to that specific allocation run — rather than served from whatever the solver happened to return in memory or from an undifferentiated history of all past assignments. This matters for the same reason run lifecycle state has to live in the database at all (see [Allocation Run Lifecycle and Recovery](#10-allocation-run-lifecycle-and-recovery)): a results page can be opened well after the run that produced it, by a different request or a different process than the one that solved it, and must show exactly that run's outcome — not a global assignment list that has since moved on, and not a solver return value that no longer exists once the process that computed it has finished.

---

## 12. Verification Summary

Regression coverage across this report spans hard-constraint legality (gender, religion, exclusive housing types, reserved and restricted inventory), the reserved-building eligibility fix in both its import and solver layers, the group-capacity performance change, run-lifecycle transitions, and the live-preview/stop-and-save mechanism. A deterministic, known-answer fixture suite exercises many of these scenarios end-to-end against the real solver rather than through mocked constraint logic; that suite predates this work and was substantially extended over its course rather than replaced. Full verification methodology and status are in [Verification Status](../testing/MAHA_TESTING_AND_REGRESSION_RECORD.md#verification-status).

---

## Implementation Traceability

Representative commits:
- `693d78a` — bed-level schema foundation this solver's persistence layer depends on.
- `60aed10` — rebuilt the solver against real, database-connected inventory.
- `9b81598` — introduced the proven-optimal vs. best-effort distinction; substantially expanded the pre-existing deterministic fixture suite.
- `4b90437`/`80c3ebf` — major end-to-end refactor separating hard constraints from weighted preferences.
- `5626a16`/`d8506f5` — exclusive-apartment correctness, room-level shared-facility compatibility, and expanded solver test coverage.
- `6196376`/`3c4f98c` — introduced the bulk-persistence and stale-connection-refresh pattern for post-solve results, and the dedicated allocation-results page reading persisted, run-scoped state.
- `b982895`, `f9ac13e` — early ANIR/accessibility import-mapping corrections.
- `91ea415`/`c2979a9` — the accepted-dorm-type enforcement fix described in [Priority, ANIR, and Building 179](#5-priority-anir-and-building-179), closing the cross-dormtype leak confirmed through real-data validation.
- `983a25a` — live preview and stop-and-save.
- `67bb252` — run-recovery and group-capacity search-performance work.
