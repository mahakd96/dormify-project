# Engineering Quality and Verification

This directory documents the engineering work performed while Dormify was
stabilized, tested, optimized, and prepared for deployment.

These reports are intentionally retained in the public portfolio because they
show more than the final implementation: they capture debugging methodology,
root-cause analysis, regression prevention, performance work, concurrency
testing, security hardening, data-integrity fixes, UI corrections, and design
decisions made during development.

The public copies are **sanitized**. Real credentials, account identities,
production-only identifiers, confidential operational details, and sensitive
institutional data have been removed or generalized while preserving the
technical reasoning and engineering evidence.

## Reports

- [Allocation engine and lifecycle](allocation/ALLOCATION_ENGINE_AND_LIFECYCLE_REPORT.md)
  — solver behavior, constraint interactions, lifecycle controls, and regression fixes.
- [Assisted allocation and transfer workflow](assisted-allocation/ASSISTED_ALLOCATION_AND_TRANSFER_REPORT.md)
  — staff-assisted placement, transfer decisions, and workflow consistency.
- [Backend API and database](backend/BACKEND_API_AND_DATABASE_REPORT.md)
  — backend corrections, integrity rules, and API/database stabilization.
- [Concurrency and load audit](concurrency/CONCURRENCY_AND_LOAD_AUDIT.md)
  — race-condition analysis, concurrency risks, and load-focused verification.
- [Concurrency and load testing](concurrency/CONCURRENCY_AND_LOAD_TESTING_REPORT.md)
  — controlled test methodology and before/after verification.
- [Data-analysis redesign history](data-analysis-redesign/DATA_ANALYSIS_REDESIGN_DESIGN_HISTORY.md)
  — design evolution, implementation reasoning, and analysis-page decisions.
- [Data-analysis implementation report](data-analysis-redesign/IMPLEMENTATION_REPORT.md)
  — implementation details and verification of the redesigned analytics workflow.
- [Import data and inventory](data-integrity/IMPORT_DATA_AND_INVENTORY_REPORT.md)
  — import validation, data mapping, inventory integrity, and related fixes.
- [Location-name localization](localization/LOCATION_NAME_LOCALIZATION.md)
  — centralized bilingual display-name handling and consistency decisions.
- [Performance report](performance/PERFORMANCE_FINAL_REPORT.md)
  — query-efficiency work, performance bottlenecks, measurements, and improvements.
- [Security and authorization](security/SECURITY_AND_AUTHORIZATION_REPORT.md)
  — authentication, authorization, scope enforcement, and production hardening.
- [System stabilization](system-stabilization/SYSTEM_STABILIZATION_REPORT.md)
  — cross-cutting failures, root causes, and stabilization work.
- [Testing and regression](testing/TESTING_AND_REGRESSION_REPORT.md)
  — regression strategy and representative defect coverage.
- [Dashboard and what-if](ui/DASHBOARD_AND_WHATIF_REPORT.md)
  — dashboard behavior, analysis workflow, and UI verification.
- [Gender terminology](ui/GENDER_TERMINOLOGY_REPORT.md)
  — terminology consistency and data/UI alignment.
- [Transfer and manual allocation](ui/TRANSFER_AND_MANUAL_ALLOCATION_REPORT.md)
  — operational transfer and manual-placement workflow fixes.

## Supporting Evidence

The `concurrency/evidence/` directory contains selected controlled test outputs
used to support the concurrency and load-testing reports. These files contain
test-environment evidence only; production credentials and institutional data
are not included.

## Why these reports are public

The code shows **what** the system became. These documents show **how** the
engineering work was carried out: how defects were isolated, how fixes were
validated, how regressions were prevented, and how deployment-readiness risks
were addressed.

For the system architecture, setup instructions, technology stack, and current
deployment status, see the repository root [README](../README.md).
