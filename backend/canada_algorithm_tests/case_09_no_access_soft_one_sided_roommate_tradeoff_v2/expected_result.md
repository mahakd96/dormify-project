# case_09_no_access_soft_one_sided_roommate_tradeoff_v2

Same as the soft tradeoff idea: N09-S02 asks for N09-S16, but this is one-sided and conflicts with stronger religion/sector/religious grouping. No accessibility fields are active.

## Expected result

- successful_assignments should be 20.
- N09-S02 and N09-S16 should probably NOT be placed in the same apartment.
- The algorithm should prefer stronger global quality: same sector/religion/religious groups.
- No student should remain unassigned.
- No accessibility-related no_feasible warning should appear.

## What to check after running

- Check successful_assignments == 20.
- Check N09-S02 apartment != N09-S16 apartment.
- Check students_with_no_feasible_beds == [].
- Check no capacity or gender violation.
- Check raw_targets/matched_targets is greater than 0, proving roommate columns were read.
