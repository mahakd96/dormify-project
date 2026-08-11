# Dynamic Roommate Hard-Constraint Test — Two Pairs

## Baseline
- 20 students: 10 female + 10 male.
- 20 rooms, each with capacity 1.
- Two mutual-positive roommate pairs:
  - F01 <-> F02
  - M01 <-> M02
- Both pairs are initially fully compatible with the hard constraints.
- Expected baseline: all 20 students assigned, and both pairs share an apartment.

## Dynamic experiment A — create a religious hard conflict for the female pair
In students.csv change F01:
- requested_religion: jewish -> muslim
- religious_for_placement: "" -> religious

Leave F02 as Jewish and not religious.

Then rerun.

Expected behavior:
- The algorithm must NOT place F01 and F02 together if that would violate ReligiousTogether.
- Because roommatePositiveOnly and ReligiousTogether are both hard constraints, this creates a hard conflict.
- Depending on solver semantics, one or both may remain unassigned rather than violating a hard rule.
- The male pair M01/M02 should still remain together.

For this modified run, update the machine-readable expectations in case_config.json before judging PASS/FAIL.

## Dynamic experiment B — restore F01
Restore F01 to:
- requested_religion: jewish
- religious_for_placement: ""

Rerun:
- F01 and F02 should be able to share an apartment again.
- M01 and M02 should still share an apartment.
