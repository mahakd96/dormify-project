# Case 04 - Accessibility shortage

Only one apartment is accessible and it has 5 one-bed rooms, but 6 students need accessibility.

## Expected result

- successful_assignments should be 19.
- conflicts should be 1.
- Exactly 5 accessibility-needing students should be placed in CAN-A1.
- One accessibility-needing student should appear in students_with_no_feasible_beds or remain unassigned.
- No accessibility-needing student should be assigned to a non-accessible apartment.

## What to check after running

- Check successful_assignments == 19.
- Check conflicts == 1.
- Check every assigned student with needs_accessibility=True is in is_accessible=True apartment.
- Check warning/no feasible list.
