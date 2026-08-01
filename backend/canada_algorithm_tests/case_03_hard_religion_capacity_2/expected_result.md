# case_03_hard_religion_capacity_2

Hard religious-request semantics, all male, rooms of capacity 2.

Expected:

- All 20 students are assigned.
- Gender restrictions are respected.
- Jewish students marked `religious` share only with Jewish students marked `religious`.
- A non-Jewish student marked `religious` shares only with students of the same religion.
- Students without a `religious` request do not impose a hard religion restriction.
