# Run this integration test

Copy this folder into:

`backend/canada_algorithm_tests/case_full_integration_simple_names_capacity_1`

Then run from `backend`:

```powershell
py manage.py run_allocation_case case_full_integration_simple_names_capacity_1 --max-seconds 60
```

Apartment naming:
- Female: `F1`, `F2`, `F3`, `F4`, `F5`
- Male: `M1`, `M2`, `M3`, `M4`, `M5`

Room naming:
- `F1_R1`, `F1_R2`, ...
- `M1_R1`, `M1_R2`, ...

Every room has capacity 1.

To experiment with soft weights, change only these in `case_config.json`:
- `sameReligion.weight`
- `sectorMatching.weight`
- `avoidYearMix_1_with_3_4.weight`
- `avoidAtudaimWithHasmaha.weight`
