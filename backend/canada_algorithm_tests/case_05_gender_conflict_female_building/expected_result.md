# Case 05 - Gender conflict in female Canada building

All Canada apartments are female, but 3 students are male. Gender is a hard safety rule in the algorithm.

## Expected result

- successful_assignments should be 17.
- conflicts should be 3.
- Male students S18, S19, S20 should not be assigned.
- No male student should be placed in a female apartment.

## What to check after running

- Check successful_assignments == 17.
- Check conflicts == 3.
- Check S18/S19/S20 are unassigned.
- Check no gender hard violation.
