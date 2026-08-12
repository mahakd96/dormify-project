# Capacity Shortage Dynamic Test

Copy this folder into:
backend/canada_algorithm_tests/case_capacity_shortage_dynamic_20

Run:
py manage.py run_allocation_case case_capacity_shortage_dynamic_20 --max-seconds 60

Baseline: 20 students, 20 active rooms, capacity 1 each.

To create a shortage:
- Open rooms.csv.
- Set one room, for example F3_R3, is_active from True to False.
- Set allocation_expectations.unassigned_count in case_config.json from 0 to 1.
- Rerun.

For two missing beds, deactivate a second room and set unassigned_count to 2.
