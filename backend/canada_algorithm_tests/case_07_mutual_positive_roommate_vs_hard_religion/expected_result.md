# Case 07 - Mutual positive roommate request conflicts with hard religion

S01 and S16 mutually request each other positively, but they have different strict religious preferences. ReligiousTogether is hard, roommatePositiveOnly is hard, and S01 is a priority student forced to receive an assignment by hard priorityFirst.

## Expected result

- solver_status should be INFEASIBLE.
- successful_assignments should remain 0 because the solver does not persist a partial allocation after an infeasible model.
- conflicts should be 20.
- Reason: hard roommatePositiveOnly requires S01 and S16 to be assigned together in the same apartment; hard ReligiousTogether forbids that; hard priorityFirst prevents leaving priority student S01 unassigned.
- If priorityFirst were relaxed, both S01 and S16 could be left unassigned and an 18-student partial solution could become possible.

## What to check after running

- Check solver_status == INFEASIBLE.
- Check successful_assignments == 0 and conflicts == 20.
- Check that no BedAssignment rows are created.
- Treat this as a whole-model contradiction test, not as a normal partial-allocation test.
