# case_21_no_access_couple_shortage_does_not_use_single_apartments

Checks that couple applicants are not placed in single apartments when couple capacity is short.

## Expected result

- There are 8 students total.
- There are 4 single beds and only 2 couple beds.
- successful_assignments should be 6.
- Exactly 2 couple applicants should remain unassigned.
- Single students should fill single apartments.
- Couple students should only use N21-C1.
- No couple student should be assigned to N21-SF or N21-SM.
- No capacity or gender violation should occur.

## What to check after running

- Check successful_assignments == 6.
- Check conflicts == 2.
- Check unassigned students are a subset of N21-C01..N21-C04.
- Check exactly two couple applicants are assigned.
- Check Room capacity respected == PASS.
