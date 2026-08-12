# Two-Pair Roommate Hard Constraint Test

Copy this folder into:
backend/canada_algorithm_tests/case_roommate_hard_dynamic_two_pairs

Run:
```powershell
py manage.py run_allocation_case case_roommate_hard_dynamic_two_pairs --max-seconds 60
```

Baseline:
- F01/F02 must share an apartment.
- M01/M02 must share an apartment.
- All 20 students should be assigned.

Suggested live modification:
1. In students.csv change F01 to:
   - requested_religion = muslim
   - religious_for_placement = religious
2. Leave F02 Jewish and non-religious.
3. Rerun and inspect how the solver handles the hard conflict between
   roommatePositiveOnly and ReligiousTogether.
4. Restore F01 and rerun.
