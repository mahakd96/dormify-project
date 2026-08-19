# Backend, API and Database Fixes

**Scope:** The Django backend's models, migrations, view-level state machines, and API contracts underneath allocation, assisted allocation, and the transfer workflow. Solver internals are covered in `project-quality/allocation/`; import-specific logic is covered in `project-quality/data-integrity/`.

---

## Overview

Several backend defects here were not isolated bugs in a single endpoint — they were places where the API's model of a piece of state disagreed with what a different endpoint, or the frontend, assumed about that same state. A region-transfer request had one reviewer-authority rule in one place and a different one in another. A student's placement was read one way in one endpoint and a different, more authoritative way in another. Fixing these required tracing every place a given piece of state was read or derived and consolidating it behind one shared function, so the different call sites could no longer drift apart.

---

## Region Identity Normalization and Centralized Permissions

**Problem:** A user's region — the single piece of data almost every permission decision in the app depends on — could arrive from the API in several different shapes depending on which endpoint or serializer produced it: a bare id, a nested region object, or a value living under different field names depending on whether it came through a user, an office, or a staff-profile representation. Role and region checks were also being made independently in more than one frontend location rather than through one shared source of truth.

**Root Cause:** Nothing normalized these different serialized shapes into one consistent value before a permission check used it. A check written against one shape could silently misread a user's region if the data happened to arrive in a different shape than the one that check assumed.

**Correction:** A single normalization function resolves a user's region id regardless of which of these shapes it arrives in, and a small set of shared, centrally-defined permission helpers (role checks, region-edit authority) consume that normalized value — so every part of the app answering "can this user act on this region" goes through the same logic rather than re-deriving the answer independently. This is the same underlying discipline the later, more specific [region-transfer review-authority fix](#region-transfer-review-authority) builds on: a single shared function for a piece of authorization state, not several independent, driftable copies of the same check.

**Verification:** Covered by the permission and region-scoping test coverage exercised throughout the region-transfer and assisted-allocation test suites, which depend on this normalization resolving the same user's region consistently across every endpoint they touch.

---

## Region Permissions and the Transfer Dialog

### Problem

A regional employee opening the "transfer to another region" dialog saw an empty list of destination regions.

### Root Cause

The general region-listing endpoint scopes a non-central user to only their own region — correct behavior for almost every other consumer of that endpoint, since a regional employee should not be able to enumerate every other region's data through the general API. The transfer dialog reused that same endpoint, and after excluding the student's current region from the result, nothing was left.

### Correction

Reusing the general region endpoint for this purpose was incorrect precisely because its regional scoping is part of the application's security model, not an incidental limitation — widening it would have solved the dialog's problem by weakening every other caller's scoping at the same time. A narrow, purpose-specific endpoint was introduced instead, exposing only the minimal identity information (region id and name) a destination picker actually needs, with no building, room, or student access granted alongside it. The general endpoint's scoping was left untouched.

### Verification

Dedicated tests confirm the new endpoint's scope and the destination-picker behavior directly.

---

## Region-Transfer Review Authority

### Problem

Approval authority for a region-transfer request was following the student's *current* region — the region the student was asking to leave — rather than the region they were asking to join.

### Root Cause

Every other request type in the system (adding or removing a student, a room or apartment transfer, a swap) is correctly reviewed by the student's own or the target room's region, because in those cases there is only one region involved. A region-transfer request is different: it is a request to move *between* two regions, and the review decision belongs to the region receiving the student, not the one they are leaving. The original logic treated every request type, including this one, through the same rule.

### Correction

Region-transfer requests are now reviewed by the destination region — the region actually accepting or declining the incoming student — with a separate, narrower rule for *withdrawing* a request, which is correctly a decision for the source region instead: a source-region manager can still withdraw a transfer their own region asked for, even though they can no longer approve or reject it. Both the source and destination region can see a pending request; only the destination side (or a central administrator) can act on it.

### Verification

Dedicated tests exercise the destination-region approval path, the source-region withdrawal path, and the visibility rule directly.

---

## Withdrawn vs. Rejected Requests

A request being withdrawn by the person who submitted it, and a request being reviewed and declined by someone else, are different events with different meaning for an audit trail — one records a change of mind before anyone acted, the other records a deliberate decision. The request status model originally had no way to represent the first case without overloading the second, so a distinct "cancelled" outcome was added, reachable only from a still-pending request and using the same concurrency-safe check-and-update pattern already used for approval and rejection.

Region-transfer requests also gained two permanently recorded fields — the region the transfer started from, and a snapshot of the student's assignment at the time of the request — captured once when the request is created and never updated afterward, so the record of where a transfer began remains accurate even after the student is later moved or the request is long since resolved.

---

## Bed-Level Assignment: Correcting the Persistence Model

### Origin

An early stage of this system tracked room occupancy at the room level — a counter or a flag rather than an identified bed. That representation could not say *which* bed a specific student held, could not represent a partially occupied multi-bed room, and could not support moving a student from one specific bed to another. Normalized bed and bed-assignment tables were introduced to replace that approximation, merged carefully alongside the fields the frontend already depended on so the change did not require rewriting the frontend in the same step.

### Why it mattered

This moved assignment state from a room-level approximation to an auditable, bed-level persistence model used consistently by automatic allocation, manual placement, and transfers. Every later feature in this system that needs to know exactly who occupies which bed — capacity calculations, manual placement, swaps, assignment history — depends on this correction having happened first.

### Current invariant

The active `BedAssignment` record is the authoritative source of a student's occupancy — it is what every capacity, availability, and history calculation queries against. `Student.assigned_room` is a denormalized convenience field on the student record itself, kept synchronized by the same assignment workflow that creates the `BedAssignment` row, so callers that only need "which room is this student in right now" do not have to join through the assignment table for it. The two are expected to agree because one write path updates both together, not because they are two independent records of equal standing. A database-level constraint backstops this — it prevents two active assignments for the same student from ever existing at once — but that constraint is deliberately the last line of defense, not the primary one; application-level checks exist specifically so the constraint is rarely, if ever, the thing that actually catches a conflict (see [The Post-Assignment State Bug](../assisted-allocation/ASSISTED_ALLOCATION_AND_TRANSFER_REPORT.md#the-post-assignment-state-bug)).

A related but separate distinction exists on the student record itself: which import batch last *touched* a student's data is tracked separately from which batch originally *created* that student, specifically so an import's cleanup logic can safely remove only the students it created — never one it merely updated (see [Import-Batch Lifecycle and Data Safety](../data-integrity/IMPORT_DATA_AND_INVENTORY_REPORT.md#2-import-batch-lifecycle-and-data-safety)).

---

## Allocation Run Lifecycle

An allocation run's status model grew from a simple running/completed/failed model into a fuller lifecycle — queued, actively searching, a stop or stop-and-save requested but not yet honored, and several distinct terminal states (stopped, completed, failed, deleted, approved). This exists for the same reason the import-batch lifecycle does: a long-running, interruptible server-side process needs a state that means "a stop was requested but the operation hasn't noticed yet," which a simple two- or three-state model has no way to represent. Why this state lives in the database rather than only in the frontend is explained fully in [Allocation Run Lifecycle and Recovery](../allocation/ALLOCATION_ENGINE_AND_LIFECYCLE_REPORT.md#10-allocation-run-lifecycle-and-recovery) — a long-running search outlives any single request or browser tab, so the frontend can only ever be a view onto this record, never the authority on whether a run is still active.

**Problem:** Stopping or deleting a run needed to remove the bed assignments it had made — but "remove every active bed assignment" is not the same operation, and doing that instead would have ended placements the run never touched, including ones from earlier runs or from manual placement.

**Root Cause:** Nothing on a `BedAssignment` row originally recorded *which run* had created it. Cleanup logic had no reliable way to distinguish "this run's own output" from "every other active assignment that happens to exist right now."

**Correction:** `BedAssignment` gained a nullable foreign key to the allocation run that created it. Stop/delete cleanup filters strictly on that field — cancelling or deleting a run's active assignments and restoring the affected students, without touching any assignment the field doesn't attribute to that run. This mirrors the same ownership-scoping principle used for import-batch cleanup (see [Import-Batch Lifecycle and Data Safety](../data-integrity/IMPORT_DATA_AND_INVENTORY_REPORT.md#2-import-batch-lifecycle-and-data-safety)): a bulk destructive action is only ever as safe as its ability to prove what it's about to touch actually belongs to the thing being cleaned up.

**Verification:** Dedicated tests cover stopping and deleting a run and confirm assignments outside that run — pre-existing or from a different run — are left untouched.

---

## Authentication

A shared loading flag was being reused for two unrelated purposes: gating the app's initial "is there a valid session" check on boot, and indicating a login attempt was in progress. Because the login screen unmounts while that flag is true, setting it on every login attempt — not just app boot — caused a failed login to unmount the form mid-submit, wiping the error message and whatever the user had typed before they could read it. Per-attempt loading state was separated from the app-wide session-restore flag to fix this. The same change also stopped distinguishing "wrong email" from "wrong password" in the message shown to the user, so a failed login attempt cannot be used to determine whether a given email address has an account.

---

## Verification Summary

Regression coverage spans region-transfer approval routing and the destination-region endpoint's scope, region-scoped access from the assisted-allocation side, and allocation-run lifecycle transitions. Full verification methodology and status are in [Verification Status](../testing/TESTING_AND_REGRESSION_REPORT.md#verification-status).

---

## Implementation Traceability

Representative commits:
- `693d78a` — introduced the normalized bed/bed-assignment schema.
- `1acb844` — early auth/API integration work this identity normalization built on.
- `971e60b` — region identity normalization and centralized permissions; migration-history cleanup.
- `ddc7014` — allocation run lifecycle, stop/delete controls, and the run-owned `BedAssignment` cleanup.
- `25ccb82` — assisted allocation workflow, replacing an earlier mock-data page.
- `91ea415` — broader backend/inventory overhaul.
- `4f6ae12` — login-state and error-message fix.
- `2138f36` — region-transfer routing and manual-allocation state-consistency fixes.
