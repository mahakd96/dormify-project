# Case 06 - Hard ReligiousTogether conflict

There are 5 strict religious-preference groups but only 4 apartments. With ReligiousTogether hard, each apartment can contain at most one strict preference group.

## Expected result

- Full 20/20 assignment should not be possible.
- Expected successful_assignments should be around 16 if each excluded group has 4 students.
- No apartment should contain two different strict religious_for_placement values.
- The solver should sacrifice one group instead of violating the hard ReligiousTogether rule.

## What to check after running

- Check successful_assignments <= 16.
- Check conflicts >= 4.
- Check every apartment has at most one strict religious_for_placement value.
- Check solver status is OPTIMAL or FEASIBLE, not necessarily INFEASIBLE, because partial assignment is allowed.
