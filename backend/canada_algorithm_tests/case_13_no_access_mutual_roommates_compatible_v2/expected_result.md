# case_13_no_access_mutual_roommates_compatible_v2

Checks that mutual roommate requests are rewarded when they are compatible with grouping and hard constraints. No accessibility involved.

## Expected result

- successful_assignments should be 16.
- Mutual roommate pairs should preferably be placed in the same apartment.
- No student should remain unassigned.
- No accessibility-related no_feasible warning should appear.

## What to check after running

- Check successful_assignments == 16.
- Check mutual_roommate_matches is high, preferably 4.
- Check each listed mutual pair is in the same apartment if capacity allows.
- Check no capacity or gender violation.
