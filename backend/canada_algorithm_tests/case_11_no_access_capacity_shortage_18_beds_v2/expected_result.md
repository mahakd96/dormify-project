# case_11_no_access_capacity_shortage_18_beds_v2

Checks pure capacity shortage. There are 20 students and 18 beds. No accessibility involved.

## Expected result

- successful_assignments should be 18.
- Exactly 2 students should remain unassigned.
- No capacity violation should occur.
- No accessibility-related no_feasible warning should appear.

## What to check after running

- Check successful_assignments == 18.
- Check unassigned students count == 2.
- Check capacity is not violated.
- Check any warning is about capacity only, not accessibility.
