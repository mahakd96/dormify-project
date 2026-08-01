# Dormify hard-constraint tests 01-10

Place this entire folder at:

`dormify/backend/canada_algorithm_tests`

Each case contains exactly the files expected by `run_allocation_case.py`:

- `students.csv`
- `apartments.csv`
- `rooms.csv`
- `expected_result.md`
- `case_config.json`

The directory name remains `canada_algorithm_tests` only because the current Django command has that path hard-coded. The fixtures themselves are general hard-constraint tests.
