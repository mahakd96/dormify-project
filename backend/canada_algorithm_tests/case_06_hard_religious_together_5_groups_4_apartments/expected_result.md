# Case 06 - Hard ReligiousTogether packing conflict

The data contains three strict religious_for_placement values with group sizes 8, 8, and 4. Each apartment has capacity 5, and a hard ReligiousTogether rule permits at most one strict value per apartment. Placing all students would require 2 + 2 + 1 = 5 apartments, but only 4 exist.

## Expected result

- Solver status should be OPTIMAL or FEASIBLE.
- successful_assignments should be exactly 17.
- conflicts should be exactly 3.
- No apartment should contain two different non-empty strict religious_for_placement values.
- The 17-student maximum comes from apartment packing: one 8-student group uses 2 apartments, the other 8-student group can use only 1 apartment for 5 students, and the 4-student group uses 1 apartment.

## What to check after running

- Check solver_status is OPTIMAL or FEASIBLE.
- Check successful_assignments == 17 and conflicts == 3.
- For every apartment, collect non-empty religious_for_placement values and check that the set size is at most 1.
- Do not describe this fixture as five preference groups: the solver sees exactly three distinct strict values.
