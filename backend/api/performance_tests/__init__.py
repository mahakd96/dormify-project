"""
Dedicated home for performance / SQL-query-efficiency regression tests.

These tests measure and guard against N+1 queries, duplicated computation,
response size, and similar performance characteristics of specific
endpoints. They are NOT business-logic/permission tests (those stay in the
existing top-level api/tests_*.py modules) - this package is reserved for
performance measurement and regression coverage only.

Discoverable via:
    python manage.py test api.performance_tests
    python manage.py test api.performance_tests.test_buildings_performance
    python manage.py test api   # (recursive discovery picks this package up too)

Naming convention: one test_<area>_performance.py module per page/endpoint
area (e.g. test_buildings_performance.py, and future
test_apartments_performance.py, test_rooms_performance.py,
test_beds_performance.py, test_analysis_performance.py, ...).
"""