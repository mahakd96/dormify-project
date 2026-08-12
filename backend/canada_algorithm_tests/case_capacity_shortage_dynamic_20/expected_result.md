# Dynamic Capacity Shortage Test

Baseline:
- 20 students.
- 20 active rooms/beds.
- Capacity 1 in every room.
- Expected: all 20 assigned.

Dynamic test:
1. Run baseline.
2. In rooms.csv change one room, e.g. F3_R3, from is_active=True to is_active=False.
3. Change allocation_expectations.unassigned_count in case_config.json from 0 to 1.
4. Rerun: exactly one student should be unassigned.
5. Deactivate a second room and set unassigned_count=2.
6. Priority students should remain assigned when a legal placement exists.
7. Gender, ReligiousTogether, roommatePositiveOnly and capacity must never be violated.
8. Reactivate the room(s), restore unassigned_count=0 and rerun.
