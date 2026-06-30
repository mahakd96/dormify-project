# Case 20 — Couples vs Singles Housing Type

Expected result:

- Solver status: OPTIMAL
- successful_assignments = 8
- conflicts = 0
- Single female students are assigned only to N20-SF.
- Single male students are assigned only to N20-SM.
- Couple students are assigned only to N20-C1 or N20-C2.
- N20-C01 and N20-C02 must share the same apartment.
- N20-C03 and N20-C04 must share the same apartment.
- N20-C1 has 2 assigned students.
- N20-C2 has 2 assigned students.

Important fixture rule:

The couple relationship is represented using mutual positive roommate requests:

- N20-C01 -> N20-C02 = True
- N20-C02 -> N20-C01 = True
- N20-C03 -> N20-C04 = True
- N20-C04 -> N20-C03 = True
