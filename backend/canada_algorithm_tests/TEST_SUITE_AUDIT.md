# Test Suite Audit

## Decision recorded

Accessibility is not removed from the solver. The suite now distinguishes:

- **Current initial allocation:** accessibility input is unavailable/default-false. Use Case 09.
- **Future accessibility-aware allocation:** explicit accessibility needs are present. Keep Case 04 as a regression test.
- **Mid-semester urgent changes:** currently expected to be handled manually until the team and supervisor approve a formal rerun policy.

## Case-by-case assessment

| Case | Main rule | Reviewed expected outcome |
|---|---|---|
| 01 | Normal full allocation and soft grouping | 20 assigned, 0 conflicts |
| 02 | Weak one-sided roommate request versus stronger global grouping | 20 assigned, 0 conflicts; S02/S16 should normally remain apart |
| 03 | 18 active beds for 20 students | 18 assigned, 2 conflicts |
| 04 | Future accessibility shortage | 19 assigned, 1 conflict; collective shortage |
| 05 | Male students in a female-only building | 17 assigned, 3 conflicts |
| 06 | Hard ReligiousTogether apartment packing | 17 assigned, 3 conflicts |
| 07 | Conflicting hard priority, hard positive roommate, and hard religion | Entire model INFEASIBLE; 0 persisted assignments |
| 08 | Reserved apartment for priority students only | 18 assigned, 2 conflicts |
| 09 | Initial run without accessibility data | 20 assigned, 0 conflicts; accessibility has no effect |

## Corrections made

### Case 04

The previous expectation implied that the unassigned accessibility student should appear in `students_with_no_feasible_beds`. That is not how the solver builds this list. Every one of the six students individually has five feasible beds, so none has zero individual options. The failure arises only because six students compete for five accessible beds.

### Case 06

The fixture does not contain five solver-visible religious preference values. It contains three values with sizes 8, 8, and 4. Because one apartment may use only one value and each apartment has capacity 5, all students would need five apartments. With four apartments, the exact maximum is 17 assignments.

### Case 07

The old expectation allowed a partial assignment, but the current hard constraints make the whole model infeasible:

1. `priorityFirst` forces priority student S01 to be assigned.
2. `roommatePositiveOnly` forces S01 and S16 to be assigned together in the same apartment.
3. `ReligiousTogether` forbids their two different strict preferences in the same apartment.

The solver therefore returns `INFEASIBLE` and persists no partial result.

## Solver observations relevant to testing

1. Accessibility is currently an unconditional feasibility rule whenever `_needs_accessibility(student)` returns true. There is no `constraints_config` switch for it.
2. Empty/default-false accessibility data is safely ignored, which is exactly what Case 09 verifies.
3. `_needs_accessibility` also infers accessibility from a priority reason containing the Hebrew accessibility keyword. A no-accessibility test must clear both the boolean field and this fallback text.
4. Gender is always hard-coded as a safety rule.
5. A hard positive roommate request can make the entire model infeasible when combined with another hard rule and hard priority.
6. `students_with_no_feasible_beds` reports students with no individual feasible option; it does not report collective capacity shortages.
7. The solver file contains repeated definitions of roommate helper functions. Python uses only the last definition, but this is a maintenance and regression risk and should be cleaned separately.
8. `roommatePositiveOnly` is automatically relaxed when the batch contains zero positive flags. A dedicated warning-path test is still missing.

## Remaining coverage gaps

The current nine scenarios cover the main business rules, but they do not yet fully cover:

- empty student input;
- empty room input;
- all beds already occupied by active assignments;
- inactive apartment rather than inactive room;
- priority supply shortage and automatic hard-priority relaxation;
- zero positive roommate flags with `roommatePositiveOnly` requested;
- roommate matching by Hebrew name, reverse name order, and compact spacing;
- duplicate or ambiguous roommate lookup keys;
- existing active assignment ending and replacement persistence;
- rollback behavior when database persistence fails;
- repeated execution/idempotency;
- solver timeout/UNKNOWN status;
- model-invalid protection;
- multi-bed room capacity greater than one.

These should be implemented as Django integration tests after the fixture loader is connected to the real models.
