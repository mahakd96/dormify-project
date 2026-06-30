# case_17_no_access_room_capacity_two_beds

Fixed version for the current importer. The previous version used 8 rooms with `capacity=2`, but `run_allocation_case` created only one bed per room row. This version represents 16 bed-slots explicitly as 16 room rows with `capacity=1`, so it matches the current DB loading behavior.

## Expected result

- successful_assignments should be 16.
- No student should remain unassigned.
- Beds loaded should be 16 because the current importer creates one bed per rooms.csv row.
- No room/bed-slot should have more than one student assigned.
- No accessibility-related no_feasible warning should appear.

## What to check after running

- Check Beds loaded == 16.
- Check successful_assignments == 16.
- Check Unassigned students says No unassigned students.
- Check students_with_no_feasible_beds == [].
- Check no capacity or gender violation.
