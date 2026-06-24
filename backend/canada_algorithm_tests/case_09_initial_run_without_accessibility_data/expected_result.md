# Case 09 - Initial allocation without accessibility data

Current operational workflow: the uploaded student files do not include accessibility information at the start of the semester. All student accessibility flags therefore remain at their empty/default-false state, while the accessibility logic stays in the solver for future use.

**Operational note:** Accessibility is intentionally not used as an initial allocation input. If an urgent accessibility need is reported later, staff may handle the change manually until the supervisor decides whether and how accessibility should be integrated into reruns.

## Expected result

- Solver status should be OPTIMAL or FEASIBLE.
- successful_assignments should be 20.
- conflicts should be 0.
- No student should be restricted to an accessible apartment because no student has an accessibility requirement at initial-run time.
- The solver may place any student in CAN-A1 or in the non-accessible apartments according to the other constraints.
- This test confirms that keeping accessibility code in place does not affect allocation when the imported accessibility fields are empty/default-false.

## What to check after running

- Check solver_status is OPTIMAL or FEASIBLE.
- Check successful_assignments == 20 and conflicts == 0.
- Check all students have needs_accessibility=False/default in the loaded test data.
- Check no priority_reason contains an accessibility keyword that would trigger the solver fallback.
- Do not require any specific student to be assigned to CAN-A1.
