# Case 08 - Reserved apartment only priority students can use it

CAN-A1 is reserved. Only 3 students are priority, so only 3 of the 5 reserved rooms should be usable. Other students should not be placed there.

## Expected result

- successful_assignments should be 18: 15 regular beds plus 3 priority students in the reserved apartment.
- conflicts should be 2.
- Only priority students should be assigned to CAN-A1.
- Non-priority students must not use reserved rooms.

## What to check after running

- Check successful_assignments == 18.
- Check conflicts == 2.
- Check CAN-A1 contains only S01/S02/S03 or other priority students.
- Check no non-priority student is assigned to reserved CAN-A1.
