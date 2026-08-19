# Dormify

**Dormitory allocation and management platform for university housing administration.**

Dormify is a full-stack information system designed to support complex university dormitory operations.

The platform centralizes student data, dormitory inventory, automatic allocation, assisted placement, transfers, reporting, and administrative workflows in one system. Its allocation engine uses constraint-based optimization to generate valid housing assignments while respecting operational rules, available capacity, and configurable preferences.

Dormify is built as a web application with a **React frontend**, **Django REST backend**, **PostgreSQL database**, and an **OR-Tools CP-SAT allocation engine**.

---

## System Overview

Dormify supports the housing allocation process from data ingestion to final placement management.

The main system areas include:

* student and application data management;
* Excel-based data import and batch processing;
* dormitory, building, apartment, room, and bed management;
* automatic constraint-based allocation;
* live allocation monitoring and result management;
* assisted and manual allocation;
* student requests and transfer workflows;
* availability and inventory management;
* role- and region-based access control;
* operational dashboards and analysis;
* Excel report generation;
* allocation, regression, performance, concurrency, and security testing.

The backend is the authoritative layer for permissions, placement validation, assignment integrity, and allocation rules.

---

# Architecture

Dormify follows a client-server architecture.

```text
┌──────────────────────────────┐
│       React Frontend         │
│                              │
│ Pages · Components · UI      │
│ Authentication · API Client  │
└──────────────┬───────────────┘
               │
               │ REST API
               ▼
┌──────────────────────────────┐
│    Django REST Backend       │
│                              │
│ Business Rules               │
│ Authentication & Permissions │
│ Imports & Requests           │
│ Assignment Management        │
│ Reports & Analysis           │
│ Allocation Orchestration     │
└──────────────┬───────────────┘
               │
        ┌──────┴──────┐
        ▼             ▼
┌─────────────┐  ┌────────────────────┐
│ PostgreSQL  │  │ Allocation Engine  │
│             │  │ OR-Tools CP-SAT   │
│ System Data │  │                    │
└─────────────┘  └────────────────────┘
```

The frontend communicates with the backend through REST APIs.

Business-critical decisions are validated by the backend rather than relying on frontend state or controls.

---

# Repository Structure

The repository is divided into frontend, backend, optimization, testing, and engineering-quality areas.

```text
dormify-project/
│
├── backend/
│   │
│   ├── allocation/
│   │   ├── solver.py
│   │   ├── manual_placement.py
│   │   └── live_registry.py
│   │
│   ├── api/
│   │   ├── models.py
│   │   ├── serializers.py
│   │   ├── views.py
│   │   ├── urls.py
│   │   ├── report_exports.py
│   │   ├── migrations/
│   │   ├── management/
│   │   ├── performance_tests/
│   │   ├── concurrency_tests/
│   │   └── security_tests/
│   │
│   ├── accounts/
│   ├── canada_algorithm_tests/
│   ├── dormify/
│   ├── Dockerfile
│   ├── manage.py
│   └── requirements.txt
│
├── src/
│   ├── pages/
│   ├── components/
│   ├── context/
│   ├── services/
│   ├── utils/
│   ├── data/
│   ├── App.js
│   └── index.js
│
├── public/
│
├── project-quality/
│
├── docker-compose.yml
├── Dockerfile.frontend
├── package.json
├── package-lock.json
└── README.md
```

---

# Frontend

The frontend is implemented in **React** and is located primarily under:

```text
src/
```

The main frontend areas are:

### `src/pages/`

Contains the main application screens and operational workflows.

Examples include:

* dashboard;
* students;
* data upload;
* buildings and inventory;
* automatic allocation;
* allocation results;
* assisted allocation;
* requests and transfers;
* availability analysis;
* reports;
* system analysis;
* users and settings.

### `src/components/`

Contains reusable interface components used across pages.

### `src/services/`

Contains the frontend API layer used to communicate with the Django backend.

API communication should be centralized here rather than duplicated directly inside page components.

### `src/context/`

Contains shared application context, including authentication and user/session information.

### `src/utils/`

Contains reusable frontend utilities and shared helper logic.

### `src/App.js`

Defines the main application routing structure.

---

# Backend

The backend is implemented with **Django** and **Django REST Framework** and is located under:

```text
backend/
```

The primary application logic is under:

```text
backend/api/
```

Important backend files include:

### `models.py`

Defines the main system entities and persistent domain state, including students, housing inventory, assignments, requests, allocation runs, and related operational records.

### `serializers.py`

Handles API serialization and validation for backend resources and write operations.

### `views.py`

Contains the main API workflows and business orchestration.

This includes areas such as:

* student management;
* imports;
* assignments;
* automatic allocation;
* Assisted Allocation;
* transfers and requests;
* availability changes;
* reports;
* analysis;
* dashboard data.

### `urls.py`

Defines and registers the backend REST endpoints.

### `migrations/`

Contains Django database schema migrations.

### `report_exports.py`

Contains backend report-generation functionality.

---

# Allocation Engine

The automatic allocation engine is located under:

```text
backend/allocation/
```

The engine uses **Google OR-Tools CP-SAT** to solve the dormitory allocation problem.

Its purpose is not simply to locate empty beds. It evaluates the available housing inventory together with student requirements, existing occupancy, mandatory rules, and allocation preferences.

The general allocation process is:

```text
Current Database State
        │
        ▼
Student and Inventory Preparation
        │
        ▼
Candidate Generation
        │
        ▼
Hard Constraint Validation
        │
        ▼
CP-SAT Optimization
        │
        ▼
Weighted Preference Evaluation
        │
        ▼
Allocation Result
        │
        ▼
Validation and Persistence
```

The allocation logic distinguishes between:

* **hard constraints**, which determine whether an assignment is valid;
* **soft preferences**, which influence which valid assignment is preferred.

This separation allows the solver to optimize allocation quality without allowing preferences to override mandatory placement rules.

---

## `solver.py`

```text
backend/allocation/solver.py
```

This is the main automatic allocation engine.

It is responsible for areas including:

* preparing allocation candidates;
* evaluating student and inventory compatibility;
* constructing the CP-SAT model;
* enforcing mandatory allocation constraints;
* applying weighted preferences;
* running the optimization process;
* producing assignment proposals;
* generating allocation diagnostics;
* supporting configurable execution time;
* supporting partial and feasible solutions when appropriate.

The solver operates against the current backend data rather than maintaining an independent copy of the housing rules.

---

## `manual_placement.py`

```text
backend/allocation/manual_placement.py
```

Contains logic used by **Assisted Allocation** and controlled manual-placement workflows.

It evaluates whether a proposed placement is compatible, identifies restrictions, and distinguishes between structural restrictions and administrative cases that may be handled through an authorized override workflow.

This allows automatic and staff-assisted allocation to remain aligned with the same underlying placement policies.

---

## `live_registry.py`

```text
backend/allocation/live_registry.py
```

Supports the active allocation lifecycle while the solver is running.

It is used for functionality such as:

* tracking the current solver execution;
* exposing intermediate feasible solutions;
* live allocation preview;
* controlled stopping of an active search;
* Stop & Save behavior;
* coordination between the running solver and allocation APIs.

Persistent allocation-run state is also maintained in the database so the allocation lifecycle is not dependent only on the frontend session.

---

# Assignment Management

Dormify maintains explicit assignment records for student occupancy.

An active `BedAssignment` represents the authoritative assignment state, while related student fields may be maintained as synchronized convenience information.

Assignment workflows are handled by the backend and include validation of:

* destination availability;
* current occupancy;
* capacity;
* placement compatibility;
* active assignments;
* assignment transitions.

Multi-record assignment operations use transactional database logic so that failed operations do not leave partially updated placement state.

---

# Assisted and Manual Allocation

Automatic allocation is only one part of the housing workflow.

Dormify also includes Assisted Allocation for cases that require staff review or cannot be resolved automatically.

The assisted workflow can support:

* reviewing students who remain unallocated;
* handling accessibility-related cases;
* examining candidate housing;
* explaining placement conflicts;
* identifying possible configuration changes;
* manual assignment;
* authorized administrative overrides;
* auditing staff actions.

This functionality is implemented through the backend Assisted Allocation APIs together with:

```text
backend/allocation/manual_placement.py
```

and the corresponding React page:

```text
src/pages/AssistedAllocationPage.js
```

---

# Requests and Transfers

Dormify includes an operational request system for housing changes and student movement.

The active workflow is based on backend student-request records and supports cases such as:

* room changes;
* transfers;
* student swaps;
* cross-region movement;
* administrative follow-up.

Regional scope and approval permissions are revalidated by the backend.

The current transfer interface is located in:

```text
src/pages/TransfersPage.js
```

---

# Inventory Management

Physical housing is represented hierarchically:

```text
Region
└── Dormitory Type
    └── Building
        └── Apartment
            └── Room
                └── Bed
```

The backend maintains this structure through the corresponding models and APIs.

The frontend inventory-management workflow is primarily located in:

```text
src/pages/BuildingsPage.js
```

Inventory operations are validated against current occupancy and system rules before changes are applied.

---

# Data Import

Dormify supports Excel-based student-data processing.

Import workflows are handled by the backend and include persistent batch state so long-running uploads can be tracked independently from one browser request.

Import functionality includes:

* file processing;
* validation;
* batch tracking;
* progress information;
* controlled stopping;
* batch cleanup;
* regional processing and inbox workflows.

The frontend upload interface is located in:

```text
src/pages/UploadPage.js
```

---

# Authentication and Authorization

Dormify uses authenticated backend access with role- and region-aware permissions.

The system currently supports administrative roles with different operational scopes, including:

* central administration;
* regional management;
* regional employees.

Frontend visibility is used for usability, while the backend remains responsible for enforcing access control.

A region identifier received from the browser is therefore not treated as sufficient authorization for accessing another region's data.

---

# Testing Architecture

Testing is divided according to the type of behavior being verified.

```text
backend/
│
├── api/
│   ├── tests_*.py
│   ├── performance_tests/
│   ├── concurrency_tests/
│   └── security_tests/
│
└── canada_algorithm_tests/
```

---

## Functional and Regression Tests

```text
backend/api/tests_*.py
```

These tests verify application behavior and protect previously corrected functionality from regression.

They cover multiple backend areas, including allocation, assignments, imports, inventory, Assisted Allocation, requests, transfers, reports, and system workflows.

---

## Controlled Allocation Tests

```text
backend/canada_algorithm_tests/
```

This directory contains controlled allocation scenarios with known inputs and expected behavior.

These scenarios are used to verify solver behavior under specific conditions such as:

* capacity limitations;
* placement restrictions;
* roommate cases;
* priority cases;
* soft-preference trade-offs;
* integrated allocation scenarios.

They provide an isolated way to examine the allocation engine independently from large operational datasets.

---

## Performance Tests

```text
backend/api/performance_tests/
```

Contains tests and measurements for performance-sensitive backend operations.

These tests help detect issues such as:

* unnecessary database queries;
* N+1 query growth;
* inefficient large-list endpoints;
* performance regressions after implementation changes.

---

## Concurrency Tests

```text
backend/api/concurrency_tests/
```

Contains tests for operations where multiple requests may interact with the same database state.

These tests complement transactional backend safeguards and database constraints used by assignment and inventory workflows.

---

## Security Tests

```text
backend/api/security_tests/
```

Contains tests that verify security-relevant backend behavior directly, including:

* region scoping, so a region identifier supplied by the client cannot expose or modify another region's data;
* administrative authorization for Region/DormType writes and for Assisted Allocation assign/override actions;
* the JWT login/refresh/logout lifecycle, including HttpOnly refresh cookies and server-side revocation on logout;
* rate limiting on authentication endpoints;
* removal of public self-registration;
* current-password re-authentication before an account email change;
* uniqueness of a single region_boss per region;
* lockdown of the legacy Transfer API against generic PATCH/PUT and unauthorized deletion;
* protection of `Student.assigned_room` and student/request records against direct or unauthorized modification;
* upload validation ahead of expensive file parsing;
* production-safe default settings (SECRET_KEY, DEBUG-gated HTTPS/cookie hardening) and the absence of hardcoded reusable seed passwords.

---

# Test Environment

Dormify includes a separate PostgreSQL test environment so controlled and automated tests do not need to run against the normal operational database.

Docker Compose defines a dedicated test database service that can be enabled when required.

```text
test_db
```

The local test database is started through the dedicated Docker Compose profile:

```bash
docker compose --profile local-db up -d test_db
```

Tests should be configured to use the isolated test environment rather than the main system database.

This is particularly important for allocation scenarios and tests that intentionally create, modify, assign, or delete records.

---

# Project Quality

Engineering verification and stabilization documentation is maintained under:

```text
project-quality/
```

This directory contains technical records related to areas such as:

* allocation-engine corrections;
* allocation lifecycle improvements;
* backend and database stabilization;
* Assisted Allocation;
* transfer workflows;
* import and inventory integrity;
* regression testing;
* performance optimization;
* concurrency testing;
* frontend and usability corrections;
* localization;
* analysis improvements.

These documents provide additional engineering context for significant system changes and verification work.

They are separate from the application source code and are intended to preserve technical traceability.

---

# Technology Stack

| Layer                       | Technology             |
| --------------------------- | ---------------------- |
| Frontend                    | React 18, JavaScript   |
| API                         | Django REST Framework  |
| Backend                     | Django 4.2, Python     |
| Optimization                | Google OR-Tools CP-SAT |
| Database                    | PostgreSQL             |
| Authentication              | JWT                    |
| Data Processing             | pandas, openpyxl       |
| Frontend API Client         | Axios                  |
| Mapping                     | ArcGIS                 |
| Reporting / File Processing | XLSX, openpyxl         |
| Infrastructure              | Docker, Docker Compose |

---

# Running the Project

Dormify is containerized using **Docker** and **Docker Compose**.

The containerized structure is intended to provide a consistent environment for development and deployment.

The project is currently operated through the Docker environment while deployment to the target institutional server is being prepared. The same container-based project structure is intended to support that deployment once the server environment is available.

---

## Requirements

Install:

* Git
* Docker
* Docker Compose

---

## Clone the Repository

```bash
git clone <repository-url>
cd dormify-project
```

---

## Environment Configuration

The backend reads database and application configuration from environment variables.

Configure the required environment before starting the application.

Database credentials, application secrets, and deployment-specific configuration should not be committed to the repository.

Environment values depend on the target development or deployment environment.

---

## Build and Start

From the project root:

```bash
docker compose up --build
```

Docker Compose builds and starts the application services.

For the current local development configuration:

```text
Frontend: http://localhost:3000
Backend:  http://localhost:8000
```

These addresses represent the local Docker environment and may differ in a deployed server configuration.

---

## Apply Database Migrations

When database migrations are required:

```bash
docker compose exec backend python manage.py migrate
```

---

## Stop the Application

```bash
docker compose down
```

---

# Development Entry Points

For developers joining the project, the following files are useful starting points.

| Area                       | Entry Point                              |
| -------------------------- | ---------------------------------------- |
| Frontend routing           | `src/App.js`                             |
| Frontend pages             | `src/pages/`                             |
| Shared frontend components | `src/components/`                        |
| Frontend API layer         | `src/services/`                          |
| Authentication context     | `src/context/`                           |
| Backend domain models      | `backend/api/models.py`                  |
| Backend API workflows      | `backend/api/views.py`                   |
| API routing                | `backend/api/urls.py`                    |
| API validation             | `backend/api/serializers.py`             |
| Automatic allocation       | `backend/allocation/solver.py`           |
| Assisted placement rules   | `backend/allocation/manual_placement.py` |
| Live allocation state      | `backend/allocation/live_registry.py`    |
| Functional tests           | `backend/api/tests_*.py`                 |
| Controlled solver tests    | `backend/canada_algorithm_tests/`        |
| Performance tests          | `backend/api/performance_tests/`         |
| Concurrency tests          | `backend/api/concurrency_tests/`         |
| Security tests             | `backend/api/security_tests/`            |
| Engineering records        | `project-quality/`                       |

---

# Main Operational Flow

At a high level, Dormify supports the following workflow:

```text
Student & Housing Data
        │
        ▼
Import and Validation
        │
        ▼
Inventory Review
        │
        ▼
Automatic Allocation
        │
        ▼
Allocation Results
        │
        ├──────────────► Completed Placements
        │
        ▼
Unresolved / Special Cases
        │
        ▼
Assisted or Manual Allocation
        │
        ▼
Transfers · Requests · Follow-up
        │
        ▼
Reports and Analysis
```

Each workflow is backed by server-side validation and persistent database state.

---

# Development Principles

When extending Dormify:

1. Keep business-critical validation in the backend.
2. Reuse existing assignment and allocation logic rather than implementing parallel rule systems.
3. Treat the database assignment state as authoritative.
4. Enforce permissions and regional scope server-side.
5. Preserve assignment history during movement operations.
6. Use transactional writes for multi-record state changes.
7. Revalidate availability when committing assignments.
8. Add regression coverage when changing business rules.
9. Use the isolated test environment for destructive or controlled test scenarios.
10. Review related automatic, assisted, and manual workflows when changing allocation rules.

---

# Project Purpose

Dormify was developed to support housing administrators in managing allocation as a complete operational process rather than as a standalone optimization problem.

The project combines:

* structured housing and student data;
* constraint-based optimization;
* administrative decision support;
* manual and assisted workflows;
* assignment integrity;
* regional authorization;
* operational reporting;
* testing and engineering verification.

The goal is to provide a system in which dormitory assignments are **valid, explainable, traceable, and manageable throughout their lifecycle**.
