# Case 01 - Balanced solvable Canada case

20 female students, 4 Canada apartments, 5 one-bed rooms per apartment. This checks the normal best-quality assignment.

## Expected result

- Solver status should be OPTIMAL or FEASIBLE.
- successful_assignments should be 20.
- conflicts should be 0.
- S01 must be assigned to an accessible apartment.
- Best grouping should keep the four natural groups together: Arab Muslim religious Year1, Arab Christian non-religious Year3/4, Jewish religious Year1, Jewish non-religious Year3/4.
- Most mutual roommate pairs should be in the same apartment, not necessarily the same room.

## What to check after running

- Check successful_assignments == 20.
- Check conflicts == 0.
- Check S01 apartment has is_accessible=True.
- Check apartment grouping by religion/sector/religious_pref/year_group.
- Check mutual_roommate_matches and one_sided_roommate_matches.
