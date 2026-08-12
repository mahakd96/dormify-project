# Full Integration – Simple Apartment Names – Room Capacity 1

## Structure
- 20 students: 10 female + 10 male.
- Every room has capacity **1**.
- Female apartments: `F1`, `F2`, `F3`, `F4`, `F5`.
- Male apartments: `M1`, `M2`, `M3`, `M4`, `M5`.
- Rooms are named consistently, for example `F1_R1`, `F1_R2`, `M1_R1`, etc.
- `F5` and `M5` are inactive apartments and must never be used.
- `F4` and `M4` are reserved apartments.

## Hard constraints represented
1. Gender.
2. Priority.
3. ReligiousTogether.
4. Positive roommate request.
5. Capacity / inactive housing / reserved housing.

## Soft constraints represented
Baseline weights:
- `sameReligion = 6`
- `sectorMatching = 7`
- `avoidYearMix_1_with_3_4 = 4`
- `avoidAtudaimWithHasmaha = 4`

The goal is to keep the same CSV data and change only the soft weights in `case_config.json`,
then rerun the same test and compare who is grouped with whom.

## Baseline expected result
- All 20 students can be assigned.
- No hard constraint may be violated.
- M04 and M05 must share an apartment.
- F09 and F10 must be in `F4`.
- M09 and M10 must be in `M4`.
- `F5` and `M5` must remain unused.
