# Case 07 - Mutual positive roommate request conflicts with hard religion

S01 and S16 mutually request each other positively, but they have different strict religious preferences and ReligiousTogether is hard.

## Expected result

- The solver should not place S01 and S16 in the same apartment because it would violate hard ReligiousTogether.
- Because roommatePositiveOnly is hard, it may assign at most one of S01/S16, or leave one unassigned.
- This is an intentional impossible-preference test.
- Check whether the algorithm reports/reflects the conflict clearly.

## What to check after running

- Check S01 and S16 are not in the same apartment.
- Check at least one of S01/S16 may be unassigned.
- Check no apartment contains mixed strict religious preferences.
- Check warnings/conflicts.
