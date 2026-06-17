# Canada Algorithm Synthetic Test Cases

These files are synthetic test fixtures for testing the dorm allocation algorithm without touching the real imported buildings/beds.

## Structure

Each case folder includes:
- `<case_name>.json` — full case data: apartments, rooms, students, constraints_config, expected_result.
- `apartments.csv` — same apartments data in CSV format.
- `rooms.csv` — same rooms data in CSV format.
- `students.csv` — same students data in CSV format.
- `expected_result.md` — expected behavior after running the solver.

## Canada assumption used here

- 4 Canada apartments.
- Each apartment has 5 rooms.
- Each room has capacity 1 bed.
- Total normal capacity: 20 beds.

## Important

Your current solver treats roommate success as being in the same apartment, not necessarily the same physical room.
That fits Canada because each student has a separate one-bed room inside the apartment.

## Recommended run style

Run each JSON file separately with a dry-run management command or a local loader.
Do not run these cases directly on the real imported production-like data unless you wrap it in a rollback transaction or use a separate test database.

Example command name you can implement:

python manage.py run_synthetic_allocation_case --case canada_algorithm_tests/case_01_balanced_solvable/case_01_balanced_solvable.json --dry-run

## Cases

1. Balanced solvable case.
2. Soft tradeoff: bad one-sided roommate request.
3. Capacity shortage: 20 students, 18 beds.
4. Accessibility shortage.
5. Gender conflict.
6. Hard ReligiousTogether conflict.
7. Mutual positive roommate request conflicts with hard religion.
8. Reserved apartment priority-only behavior.
