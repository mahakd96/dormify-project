# Engineering Quality Notes

This directory is intentionally minimized in the public portfolio release.

The original project contained detailed internal engineering reports covering
allocation debugging, production hardening, performance measurements,
concurrency investigations, data-import validation, and operational
stabilization. Those reports included environment-specific observations and
institutional details, so they are excluded from the public version.

## Public technical summary

The project was validated using several complementary test categories:

- functional and regression tests for API and workflow behavior;
- deterministic solver scenarios for allocation constraints and preferences;
- performance tests for query growth and large-list endpoints;
- concurrency tests for assignment and inventory race conditions;
- authorization tests for role- and scope-based access controls;
- isolated local PostgreSQL test environments for destructive test cases.

The public repository keeps the implementation and reusable automated tests
that demonstrate these engineering practices, while omitting operational
incident reports, production-specific measurements, real inventory snapshots,
and institution-specific deployment notes.

For architecture and setup information, see the repository root `README.md`.
