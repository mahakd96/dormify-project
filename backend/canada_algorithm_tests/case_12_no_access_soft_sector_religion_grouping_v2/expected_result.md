# case_12_no_access_soft_sector_religion_grouping_v2

Checks soft grouping by sector/religion/religious level when capacity allows clean groups. No accessibility involved.

## Expected result

- successful_assignments should be 16.
- Each apartment should preferably contain a coherent group.
- No student should remain unassigned.
- No accessibility-related no_feasible warning should appear.

## What to check after running

- Check successful_assignments == 16.
- Check unassigned students list is empty.
- Check apartments are mostly homogeneous by sector/religion/religious level.
- Check no capacity or gender violation.
