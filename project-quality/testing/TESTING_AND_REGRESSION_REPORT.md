# Testing and Regression Engineering Record

**Scope:** Testing methodology and regression coverage across the allocation, assisted-allocation, transfer, import, and inventory work covered by the other reports in this set.

---

## Testing Methodology

The consistent pattern across this history was not "write more tests" as an end in itself — it was using a small, deterministic reproduction to separate a data problem from a logic problem before changing any code:

```
observe failure
  → reproduce with a minimal case
  → inspect the actual input the failing component received (database state, or a deterministic fixture)
  → identify which layer the discrepancy is actually in
  → correct that layer specifically
  → add a regression test that pins the corrected behavior
  → rerun the surrounding suite for that area
```

This is why, for example, the [accessibility-exclusion fix](../data-integrity/IMPORT_DATA_AND_INVENTORY_REPORT.md#4-accessibility-classification) was diagnosed by inspecting real student records before touching solver logic, and why the [reserved-building eligibility bug](../allocation/ALLOCATION_ENGINE_AND_LIFECYCLE_REPORT.md#5-priority-anir-and-building-179) was diagnosed by tracing the rule interaction back to a regression confirmed through real-data validation, rather than assuming the underlying business rule itself was wrong.

---

## Deterministic Known-Answer Cases

Alongside the unit-level test suites, a set of fixture-based integration scenarios with known expected outcomes is run end-to-end against the real solver rather than mocked constraint logic — covering scenarios such as gender pressure, religious constraints under pressure, roommate-versus-hard-constraint tradeoffs, and mixed active/reserved capacity. This kind of case catches an interaction between multiple constraints that a single-constraint unit test cannot exercise on its own — for example, a case where a soft preference and a hard rule pull in different directions, and the correct outcome depends on the hard rule always winning regardless of preference weight.

This fixture methodology was originated by a teammate, Aya Abu-Raya, and substantially expanded over the course of this work rather than replaced — every fixture-driven correction described in this set of reports extends that shared suite.

---

## Coverage by Area

Rather than list every test file and class, coverage is summarized here by the engineering area it protects; the most significant regression cases — the ones added specifically because they pin a fixed bug rather than only exercising a feature — are named where useful.

- **Allocation legality** — gender, religion, exclusive housing types, reserved and gender-restricted buildings, mutual roommate matching.
- **Household exclusivity (Z3/Z4/Z6)** — couple, family, and single-occupant applications treated as complete, independent units, never merged or grouped, including under a mutual roommate request between two such applications; this behavior was confirmed directly against the real business rule rather than assumed.
- **Priority and ANIR** — the import-mapping fix, the solver-side accepted-dorm-type enforcement fix (closing a leak into unrelated dorm types confirmed through real-data validation), and the Building-179 preference-versus-restriction behavior are each covered by dedicated cases, kept separate because they were separate defects.
- **Accessibility classification** — both directions of the correction (the original exclusion gap, and the later narrowing of an over-broad classification) are pinned by dedicated regression cases.
- **Allocation run lifecycle** — status transitions, active-run discovery, live preview, and the stop/stop-and-save/cancel interactions, including cases that exercise a real background watcher thread against committed database state.
- **Import-batch lifecycle** — stop, stop-and-delete, and the ownership-scoped cleanup that ensures only a batch's own created students can be removed.
- **Inventory capacity consistency** — the bed-row auto-repair path and its interaction with an already-loaded in-memory room object are covered directly, alongside general inventory edit-safety.
- **Inventory edit safety** — editing or deactivating buildings, apartments, rooms, and beds cannot silently remove an existing assignment.
- **Assisted allocation** — candidate ranking, manual overrides, safe inventory reconfiguration, and the [post-assignment read-state fix](../assisted-allocation/ASSISTED_ALLOCATION_AND_TRANSFER_REPORT.md#the-post-assignment-state-bug).
- **Region transfer and permissions** — destination-region approval routing, source-region withdrawal authority, and the purpose-specific destination-region endpoint's scope.

---

## Test-Database Isolation

Deterministic solver test cases construct their own students, inventory, and expected outcomes — running them against a shared or production-like database would risk polluting real data with synthetic fixtures, and would make results depend on whatever state that shared database happened to be in at the time. A dedicated, disposable local PostgreSQL test database exists specifically so these tests run against a known-empty, known-consistent starting state every time, isolated from the live Azure-hosted database entirely. Explicit checks in the deterministic-case test runner refuse to proceed unless the database being used is actually the local test database, rather than trusting that whoever ran the command remembered to point at it.

This infrastructure — the local test-database container, the `.env.test` configuration, and the test-runner's own database-identity check — was originated by teammates (Donia Hassan's Docker setup, Aya Abu-Raya's local test-database configuration and initial safety check) rather than by this workstream. It is recorded here because later solver-test expansion in this history builds directly on it and, in one case, strengthened the safety check itself; it is not claimed as this workstream's own infrastructure.

---

## Historical Test-Growth Checkpoints

The test suite grew substantially at several points in this history. These are checkpoints in the evolution of the suite, not additive totals — summing across them would not correspond to anything that ever existed as a single suite at one time. The largest single expansions coincide with the exclusive-apartment correctness work, the broader inventory/allocation overhaul, the two-part accessibility/ANIR correction, the import-batch lifecycle work, and the most recent transfer/manual-allocation consistency fix.

Two numeric checkpoints sometimes associated with this work — a "109/109" and a "138/138" passing-test count — were searched for in the available history and could not be confirmed against any specific commit; they are omitted here rather than asserted.

---

## Verification Status

Every test file and test class referenced across this set of reports was confirmed to exist, by name, in the current codebase, through direct inspection. No suite was executed against the local test database in this pass, so no pass/fail count is claimed for the current state of the code — only the structural coverage described above, which is independently verifiable by inspection. The default database configuration points at a live production database and must never be used for test execution.

---

## Joint Work

The deterministic fixture suite this report and the allocation report both rely on was originated by a teammate, Aya Abu-Raya, and expanded repeatedly over the course of this work rather than rebuilt. Later solver validation and test-case authoring — in particular the dynamic, expanded solver test cases layered on top of that suite — was carried out jointly with her. This report documents the engineering work associated with this workstream; it does not attribute that jointly-built and jointly-validated testing infrastructure to a single contributor, and unrelated work by other contributors on this repository (such as concurrency and load auditing, and performance optimization) is out of scope for this report entirely.
