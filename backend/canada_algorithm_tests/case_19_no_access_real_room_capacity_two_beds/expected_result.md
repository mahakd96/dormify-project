# case_19_no_access_real_room_capacity_two_beds

Checks real room capacity=2 behavior. There are 8 students and 4 active rooms. Each room has `capacity=2`, so the test should create 8 beds in total, not only 4.

## Expected result

- Beds loaded should be 8.
- Rooms loaded should be 4.
- successful_assignments should be 8.
- No student should remain unassigned.
- At least one room should contain two students, and ideally all 4 rooms contain two students.
- No room should exceed capacity=2.
- No bed should be assigned more than once.
- No accessibility-related no_feasible warning should appear.

## What to check after running

- Check `Beds loaded: 8`.
- Check `successful_assignments == 8`.
- Check `No unassigned students`.
- Check `Room capacity respected` PASS.
- Check `No bed assigned more than once` PASS.
- Check students_with_no_feasible_beds == [].
