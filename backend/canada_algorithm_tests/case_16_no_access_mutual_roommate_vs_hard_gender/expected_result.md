# case_16_no_access_mutual_roommate_vs_hard_gender

Checks that hard gender policy overrides even a mutual roommate request. N16-S01 and N16-S09 request each other but have different genders. No accessibility involved.

## Expected result

- successful_assignments should be 16.
- N16-S01 and N16-S09 should NOT be placed in the same apartment.
- There should be no gender violation.
- mutual_roommate_matches should not count this cross-gender pair as matched.
- No accessibility-related no_feasible warning should appear.

## What to check after running

- Check successful_assignments == 16.
- Check N16-S01 apartment != N16-S09 apartment.
- Check gender violations == [].
- Check students_with_no_feasible_beds == [].
