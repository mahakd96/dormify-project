# Canada Algorithm Synthetic Test Cases

These are synthetic fixtures for testing the dorm-allocation solver without touching the real imported buildings, beds, students, or production-like database data.

## Structure

Each case folder includes:

- `<case_name>.json` — apartments, rooms, students, constraints, machine-readable expected metrics, and scenario notes.
- `apartments.csv`, `rooms.csv`, `students.csv` — CSV versions of the same fixture data.
- `expected_result.md` — the expected solver behavior and post-run checks.

Additional files:

- `manifest.csv` — suite index.
- `validate_fixtures.py` — validates fixture structure and JSON/CSV consistency without Django.
- `django_management_command_template.py` — template for loading and running a case safely.
- `TEST_SUITE_AUDIT.md` — detailed coverage review and solver risks found during inspection.

## Canada assumption

- 4 Canada apartments.
- 5 rooms per apartment.
- 1 bed per room.
- Normal total capacity: 20 beds.
- Roommate success means assignment to the same apartment, not the same one-bed room.

## Accessibility decision for the current phase

Accessibility remains in the solver and is **not removed**.

However, accessibility data is not currently provided by the initial uploaded student files. Therefore:

- **Case 09** is the current operational test. All student accessibility values are empty/default-false, so accessibility must not influence the initial allocation.
- **Case 04** is retained as a future regression test for a later phase in which accessibility data is explicitly collected and supplied.
- A newly reported urgent need during the semester may be handled manually until the team and supervisor approve a rerun policy.

This separation prevents the current tests from pretending that unavailable data exists while preserving future accessibility behavior.

## Safe run style

Run every fixture separately in a dedicated test database, or inside a transaction that is always rolled back.

Example after adapting the management command template:

```bash
python manage.py run_synthetic_allocation_case \
  --case canada_algorithm_tests/case_09_initial_run_without_accessibility_data/case_09_initial_run_without_accessibility_data.json \
  --dry-run \
  --assert-expected
```

Never point synthetic tests at the real imported data or production database.

## Cases

1. Balanced solvable allocation.
2. Soft tradeoff against a weak one-sided roommate request.
3. Capacity shortage: 20 students, 18 active beds.
4. Future accessibility shortage regression.
5. Gender incompatibility in a female building.
6. Hard ReligiousTogether apartment-packing conflict.
7. Intentional whole-model infeasibility from three conflicting hard rules.
8. Reserved apartment restricted to priority students.
9. Current initial-semester run with accessibility data unavailable/default-false.
