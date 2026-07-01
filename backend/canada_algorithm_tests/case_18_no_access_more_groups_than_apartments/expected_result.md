# case_18_no_access_more_groups_than_apartments

Checks a non-perfect grouping scenario: 5 coherent groups but only 4 apartments. The algorithm must mix at least one group while avoiding hard violations. No accessibility involved.

## Expected result

- successful_assignments should be 20.
- No student should remain unassigned.
- At least one apartment will be mixed because there are 5 groups and 4 apartments.
- The mixing should be as limited/reasonable as possible.
- No accessibility-related no_feasible warning should appear.

## What to check after running

- Check successful_assignments == 20.
- Check unassigned students list is empty.
- Check which apartment is mixed.
- Check no capacity or gender violation.
- Check students_with_no_feasible_beds == [].
