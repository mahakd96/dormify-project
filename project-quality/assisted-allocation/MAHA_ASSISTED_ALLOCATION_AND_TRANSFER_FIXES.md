# Assisted Allocation and Transfer Workflow Stabilization

**Scope:** Manual placement logic and endpoints, assisted-allocation audit tracking, and the region-transfer branch of the request workflow.

---

## Why Assisted Allocation Exists

A physically empty bed is not the same thing as a bed a given student may legally occupy — gender, religion, accepted dorm type, building restrictions, and exclusive-occupancy rules can all make an otherwise-empty bed infeasible for a specific student (see [Hard Constraints](../allocation/MAHA_ALLOCATION_ENGINE_AND_LIFECYCLE_FIXES.md#3-hard-constraints)). The automatic solver correctly leaves such students unallocated rather than silently violating a hard rule. Assisted Allocation is the staff-facing workbench for resolving those cases through controlled human intervention — either finding a candidate the automatic pass could legally reach but did not prioritize, or explicitly reconfiguring safe, empty inventory to create a new legal candidate. Structural placement constraints (housing type, occupancy, exclusive-apartment status, gender, building-level gender restriction, accepted dorm type) are never bypassed; a smaller set of explicitly designated administrative restrictions — religious compatibility and reserved-inventory status — may be waived, but only through the authorized override workflow described below, which records exactly which rule was waived and why.

This workflow replaced an earlier priority-handling page that read from static mock data with no connection to real student, assignment, or inventory state. The replacement was a genuine architecture change, not a redesign of the same feature: real candidate evaluation, backend-validated placement, and a persisted audit trail took the place of a page that could not, under any circumstances, have reflected the actual state of the dorms.

```
mock/static priority page
        ↓
real, database-backed unresolved-student workflow
        ↓
candidate evaluation
        ↓
safe inventory reconfiguration
        ↓
backend-validated placement
        ↓
persisted assignment + audit record
```

---

## Candidate Evaluation and Manual Overrides

Candidates are ranked into three tiers: fully compatible with no rule violations, compatible but lower-ranked, and only reachable through an explicit staff override. Overrides are further split into two kinds — a small set of structural incompatibilities (wrong apartment type, wrong gender category, an apartment already reserved by another exclusive occupant) that can never be overridden under any circumstances, and a smaller set of administrative rules (religious compatibility, a reserved-inventory restriction) that staff may deliberately waive with an explicit, recorded reason. Every override records exactly which rule was waived and why, as a permanent part of the placement's audit trail — never just "an override happened."

Reconfiguring inventory to create a new candidate is only ever offered on apartments with zero current occupants, and reconfiguring never places a student by itself — it only changes what becomes possible for a subsequent, separate placement action. "Has a free bed" and "safe to reconfigure" are kept as deliberately separate questions: an apartment can have a free bed and an active occupant whose existing placement a configuration change would retroactively invalidate.

---

## The Post-Assignment State Bug

### Problem

A manual placement would complete successfully — a confirmed success message, no error — but on refresh, or after selecting the same student again shortly afterward, that student could reappear as unplaced, and staff could attempt to place them a second time.

### Root Cause

The natural first assumption was that the placement had not actually saved. Before changing any persistence logic, the actual database state was checked directly: the active bed assignment, the student's own updated record, and the audit entry from the first placement were all present and correct. The write had worked exactly as intended.

The defect was two layers away, in the endpoints that *read and displayed* a student's state rather than the ones that wrote it. One endpoint derived a student's displayed status only from an accessibility flag, with no case at all for "this student is already placed." A second endpoint computed a full, freely selectable list of placement candidates unconditionally — including for a student who was already placed — so re-selecting that exact student, including via the natural refresh right after a successful placement, showed them as if nothing had happened yet.

### Correction

Both read endpoints were corrected to check whether a student is already placed *before* anything else, and to reflect that state plainly rather than falling through to a stale default. The write endpoints gained the same check as a second, independent line of defense, so a stale browser tab or a direct API call is rejected the same way a normal re-selection now is — backstopped, as a last resort, by the database constraint that prevents two active assignments for the same student from ever existing at once.

### Engineering lesson

A successful response is not proof that every later read of that state is also correct. The concrete database state a write produces is worth checking directly before assuming a persistence defect — in this case, doing so is what identified that the actual defect was two layers further away than it first appeared.

### Verification

A dedicated regression test reproduces the exact symptom — successful placement, followed by re-reading that student's state — and confirms the corrected read behavior.

---

## Region Transfer

### Two different transfer mechanisms, and completing the right one's contract

Two mechanisms in this system are both called "transfer" but exist for different situations and should not be conflated. A direct room/apartment transfer is for a student who is already assigned somewhere — it requires a concrete source room and a concrete destination room, and moves them from one to the other. Assisted Allocation, by contrast, is working with students who are *not yet assigned* — there is no source room to move them from, and often no destination room decided yet either, only an intent to send them to a different region for local staff there to place. That intent is exactly what the pending `region_transfer` request type exists to represent.

An early version of Assisted Allocation's transfer action created that pending request without supplying the destination region the request contract actually required, since a region transfer is meaningless without knowing which region is being asked to receive the student. The correction was not to build a new mechanism or force the unassigned student through the direct-transfer API's assumptions — both would have papered over the real requirement instead of meeting it — but to complete the existing request correctly: the transfer dialog now collects and sends the destination region the request was always supposed to carry.

### The empty destination-list problem

A regional employee opening the "transfer to another region" dialog saw no destinations to choose from. The general region-listing API was working correctly — scoped to the caller's own region, by design, for every other consumer of that endpoint — but after excluding the student's current region from the result, the dialog was left with nothing. The fix was not to widen the general endpoint's access, which would have weakened a real security boundary for every other caller; a narrow, purpose-specific endpoint was introduced instead, exposing only the minimal region-identity information a destination picker needs. Full detail is in [Region Permissions and the Transfer Dialog](../backend/MAHA_BACKEND_API_DATABASE_FIXES.md#region-permissions-and-the-transfer-dialog).

### Blocking conflicting workflows

A student with a pending region-transfer request must not simultaneously be treated as locally actionable — the concrete risk being one staff member requesting a transfer while another, in a different tab, manually places the same student locally. This check is computed by a single shared function reused everywhere a student's actionable state is checked or displayed, specifically so it cannot be computed independently — and therefore inconsistently — in more than one place. The write endpoints reject a local placement attempt for a transfer-pending student on the server, not only in the interface, since a stale tab or a direct request has to be rejected the same way.

### Request lifecycle

```
unallocated, actionable
        ↓  region-transfer request created
transfer pending  (not locally actionable; visible to both regions)
        ↓
   ┌─────────────┬──────────────────────┐
cancelled      rejected             approved + placed
(source        (destination           (destination region)
 withdraws)     declines)                  ↓
   ↓               ↓                    resolved
actionable      actionable
 again           again
```

A withdrawal by the requesting side and a rejection by a reviewer are recorded as distinct outcomes rather than one overloaded status, preserving the audit meaning of a genuine review decision. Approval authority belongs to the destination region — the region actually receiving the student — or a central administrator; a source-region manager retains the separate ability to withdraw a request their own region made, even after they can no longer approve or reject it.

---

## Verification Summary

Regression coverage spans candidate ranking and override protections, safe inventory reconfiguration, the post-assignment state fix, and the full region-transfer lifecycle. Full verification methodology and status are in [Verification Status](../testing/MAHA_TESTING_AND_REGRESSION_RECORD.md#verification-status).

---

## Implementation Traceability

Representative commits:
- `25ccb82` — end-to-end assisted allocation workflow, replacing the earlier mock-data priority page.
- `2138f36` — region-transfer routing, cancellation authority, and the post-assignment state consistency fix.
