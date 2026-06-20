# Case 04 - Accessibility shortage (future regression case)

Future accessibility regression case: one apartment is accessible and has 5 one-bed rooms, while 6 students explicitly require accessibility. This case is not the current initial-import workflow.

**Operational note:** Retained for future use. During the current initial allocation, accessibility data is not imported and students should normally have needs_accessibility=False/default. Use Case 09 for the current workflow.

## Expected result

- Solver status should be OPTIMAL or FEASIBLE.
- successful_assignments should be 19.
- conflicts should be 1.
- Exactly 5 accessibility-needing students should be placed in CAN-A1.
- One of the 6 accessibility-needing students should remain unassigned.
- No accessibility-needing student should be assigned to a non-accessible apartment.
- students_with_no_feasible_beds is expected to remain empty because every accessibility-needing student individually has the same 5 feasible beds; the shortage is collective, not individual.

## What to check after running

- Check solver_status is OPTIMAL or FEASIBLE.
- Check successful_assignments == 19 and conflicts == 1.
- Check exactly 5 of the 6 accessibility-needing students are assigned to CAN-A1.
- Check the sixth accessibility-needing student is unassigned.
- Check no accessibility-needing student is assigned outside CAN-A1.
- Do not require students_with_no_feasible_beds to contain the unassigned student; this list detects zero individual options, not shared-capacity shortages.
