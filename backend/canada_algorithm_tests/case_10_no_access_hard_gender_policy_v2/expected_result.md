# case_10_no_access_hard_gender_policy_v2

Checks that gender policy is hard. There are female-only and male-only apartments, and a cross-gender roommate request that must not be honored. No accessibility involved.

## Expected result

- successful_assignments should be 20.
- Female students should only be assigned to N10-A1/N10-A2.
- Male students should only be assigned to N10-A3/N10-A4.
- N10-S01 and N10-S11 should NOT be in the same apartment.
- No accessibility-related no_feasible warning should appear.

## What to check after running

- Check successful_assignments == 20.
- Check no gender policy violation.
- Check N10-S01 apartment != N10-S11 apartment.
- Check students_with_no_feasible_beds == [].
