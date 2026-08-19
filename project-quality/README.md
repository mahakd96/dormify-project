# Project Quality — Index

Engineering reports documenting the quality, correctness, and performance
work done on Dormify, organized by area. Each folder below is
self-contained; the report listed is the best starting point for that
area.

| Folder | Covers | Read first |
|---|---|---|
| `allocation/` | The automatic allocation engine (solver) and allocation-run lifecycle | [`ALLOCATION_ENGINE_AND_LIFECYCLE_REPORT.md`](allocation/ALLOCATION_ENGINE_AND_LIFECYCLE_REPORT.md) |
| `assisted-allocation/` | The staff-facing manual/assisted allocation workbench and transfer workflow | [`ASSISTED_ALLOCATION_AND_TRANSFER_REPORT.md`](assisted-allocation/ASSISTED_ALLOCATION_AND_TRANSFER_REPORT.md) |
| `backend/` | Backend API and database-layer fixes | [`BACKEND_API_AND_DATABASE_REPORT.md`](backend/BACKEND_API_AND_DATABASE_REPORT.md) |
| `concurrency/` | Concurrency and load testing/audit | [`CONCURRENCY_AND_LOAD_AUDIT.md`](concurrency/CONCURRENCY_AND_LOAD_AUDIT.md) (base document; `CONCURRENCY_AND_LOAD_TESTING_REPORT.md` is the follow-up implementation) |
| `data-analysis-redesign/` | Redesign of the Analysis page/dashboard | [`IMPLEMENTATION_REPORT.md`](data-analysis-redesign/IMPLEMENTATION_REPORT.md) (`DATA_ANALYSIS_REDESIGN_DESIGN_HISTORY.md` is supporting design history) |
| `data-integrity/` | Import pipeline and inventory data correctness | [`IMPORT_DATA_AND_INVENTORY_REPORT.md`](data-integrity/IMPORT_DATA_AND_INVENTORY_REPORT.md) |
| `localization/` | Hebrew/English location-name localization | [`LOCATION_NAME_LOCALIZATION.md`](localization/LOCATION_NAME_LOCALIZATION.md) |
| `performance/` | Backend query-efficiency and pagination work | [`PERFORMANCE_FINAL_REPORT.md`](performance/PERFORMANCE_FINAL_REPORT.md) |
| `security/` | Security and authorization | [`SECURITY_AND_AUTHORIZATION_REPORT.md`](security/SECURITY_AND_AUTHORIZATION_REPORT.md) |
| `system-stabilization/` | Cross-layer debugging and stabilization, master record | [`SYSTEM_STABILIZATION_REPORT.md`](system-stabilization/SYSTEM_STABILIZATION_REPORT.md) |
| `testing/` | Testing and regression coverage record | [`TESTING_AND_REGRESSION_REPORT.md`](testing/TESTING_AND_REGRESSION_REPORT.md) |
| `ui/` | UI localization and terminology fixes (dashboard, what-if, transfers, manual allocation, gender terminology) | [`DASHBOARD_AND_WHATIF_REPORT.md`](ui/DASHBOARD_AND_WHATIF_REPORT.md) (first of three; `TRANSFER_AND_MANUAL_ALLOCATION_REPORT.md` and `GENDER_TERMINOLOGY_REPORT.md` continue it) |

For the performance work specifically, `performance/PERFORMANCE_FINAL_REPORT.md`
is the single primary document; earlier phase-by-phase reports and raw
evidence are archived outside the repository.
