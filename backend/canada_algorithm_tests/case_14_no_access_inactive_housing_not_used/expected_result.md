# case_14_no_access_inactive_housing_not_used

Checks that inactive housing is not used. There are 12 students. One apartment is inactive and one room in an active apartment is inactive. No accessibility involved.

## Expected result

- successful_assignments should be 11 or 12 depending on how inactive apartments are filtered by the importer.
- No student should be assigned to inactive apartment N14-A4.
- No student should be assigned to inactive room N14-A3-R4.
- No accessibility-related no_feasible warning should appear.

## What to check after running

- Check assignments created.
- Check no assigned room starts with N14-A4.
- Check no assignment uses N14-A3-R4.
- Check students_with_no_feasible_beds == [].
