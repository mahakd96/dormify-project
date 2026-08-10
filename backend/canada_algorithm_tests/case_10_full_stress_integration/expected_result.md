# Expected Result — Full Stress Integration

This is the main demonstration case.

- 20 students: 10 female and 10 male.
- Female active capacity = 10.
- Male active capacity = 8 because M_OFF is inactive, so exactly two male students must remain unassigned.
- F01–F04 are religious Jewish students and the hard religious-placement rule must be respected at apartment level.
- F09 and F10 are priority students; F_RES is reserved and may contain only priority students.
- M01 and M02 are priority students and a feasible mutual roommate pair; both must be assigned and should share an apartment.
- F05 and F06 are a feasible mutual roommate pair and should share an apartment.
- F09 and M09 request each other but are different genders; the roommate preference must be rejected.
- M_OFF must never be used.

Expected:
- Exactly **18 assigned / 2 unassigned**.
- All hard constraints pass.
- The two unassigned students are non-priority males from M03–M10.
