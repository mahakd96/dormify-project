# Case 03 - Capacity shortage, 20 students but 18 beds

Two rooms are inactive, so only 18 beds exist for 20 students. This checks whether priority students are protected and whether the solver returns the best partial solution.

## Expected result

- successful_assignments should be 18.
- conflicts should be 2.
- Priority students S01, S02, S11, and S16 should be assigned.
- The unassigned students should preferably be low-constraint non-priority students such as S19/S20, but exact identity can vary.

## What to check after running

- Check successful_assignments == 18.
- Check conflicts == 2.
- Check all priority students are assigned.
- Check inactive rooms CAN-A4-R4 and CAN-A4-R5 are not used.
