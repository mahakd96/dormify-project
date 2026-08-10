# Corrected Canada Algorithm Integration Tests

This package contains 10 integration scenarios (maximum 20 students each).

## Important hierarchy used in these tests

Hard / never violated:
- Gender
- Religious placement (`ReligiousTogether`) for students who explicitly request it
- Capacity
- Inactive housing
- Reserved-apartment eligibility
- Priority assignment when `priorityFirst` is configured as hard

Soft optimization:
- Roommate matching
- Same religion (when there is no hard religious-placement request)
- Sector matching
- Year-mix avoidance
- Atudaim/Hasmaha preference

`roommatePositiveOnly` is therefore not configured as a hard requirement in this corrected suite; roommate requests are tested through the `roommateMatch` optimization objective.

## Scenarios

1. Full integration balanced — 20 students / 20 compatible beds.
2. Gender under pressure — 12 females for 10 female beds while male beds remain free.
3. Religious hard constraint under pressure — apartment-level fragmentation creates one unavoidable unassigned student despite nominal capacity.
4. Same-religion preference disabled — ordinary religion matching is not hard.
5. Roommate optimization — four feasible mutual pairs.
6. Roommate vs hard constraints — gender/religious placement win.
7. Soft trade-off — roommate weight vs religion weight.
8. Priority with shortage — 20 students / 16 beds.
9. Inactive + reserved + mixed capacity.
10. Full stress integration — main instructor demo.

## Run

From `backend` with the local test DB configured:

```powershell
py manage.py run_allocation_case case_01_full_integration_balanced --max-seconds 60
```

Replace the case name for cases 02–10.
