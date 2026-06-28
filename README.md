# Dormify

**A constraint-aware dormitory allocation and management platform for university housing administration.**

Dormify is an end-to-end information system that helps university housing teams manage student applications, dormitory inventory, allocation requirements, and accommodation results.

The platform combines structured data processing, a constraint-based optimization engine, backend validation, and a user-friendly administrative interface to support complex dormitory allocation decisions.

## Main Capabilities

* Upload and validate student and housing data.
* Manage dormitories, buildings, apartments, rooms, and allocation capacity.
* Allocate single students, couples, and families.
* Support accessibility and accommodation requirements.
* Separate mandatory hard constraints from adjustable weighted preferences.
* Run the allocation algorithm with a configurable execution time.
* Return optimal, feasible, partial, or unsuccessful allocation outcomes.
* Display allocated and unallocated students clearly.
* Provide progress indicators, validation feedback, and execution summaries.
* Test allocation scenarios using a separate local test database.

## Allocation Engine

Dormify includes a constraint-based optimization engine that assigns students to available housing while considering operational rules and student requirements.

The solver handles:

* Hard constraints that cannot be violated.
* Weighted preferences that influence solution quality.
* Housing capacity and inventory limitations.
* Single, couple, and family accommodation.
* Accessibility-related conditions.
* Partial allocations when a complete allocation is impossible.
* Time-limited solver execution.
* Feasible and optimal solution reporting.

The system distinguishes between different solver outcomes instead of treating every non-optimal result as a failure.

## Allocation Results

Dormify can report the following result states:

* **Optimal solution** — the solver found a valid solution and proved that no better solution exists.
* **Feasible solution** — a valid solution was found, but optimality was not proven within the available execution time.
* **Partial allocation** — the system allocated as many eligible students as possible while reporting those who remained unallocated.
* **No feasible solution** — the current data or constraints do not allow a valid allocation.

## System Workflow

1. Housing inventory is loaded into the system.
2. Student and allocation input files are uploaded.
3. The backend validates and processes the data.
4. The administrator reviews constraints and preferences.
5. The allocation solver processes the available assignments.
6. The backend evaluates and stores the generated results.
7. The frontend displays allocation status, execution information, and unresolved cases.

## Technology Stack

### Frontend

* React
* JavaScript
* Administrative dashboards
* File upload and validation interface
* Allocation configuration and result presentation

### Backend

* Django
* Python
* Data validation and processing
* Allocation execution
* Database and API management

### Optimization

* Constraint-based allocation solver
* Hard-constraint enforcement
* Weighted preference evaluation
* Time-limited execution
* Partial and optimal result handling

### Database

* PostgreSQL
* Neon-hosted main database
* Separate local PostgreSQL test database

### Infrastructure

* Docker
* Docker Compose
* Separate frontend, backend, and test database services

## Testing

Dormify includes controlled artificial test cases that run against an isolated test database.

These tests are used to examine:

* Hard-constraint behavior.
* Capacity shortages.
* Accessibility scenarios.
* Couple and family allocation.
* Partial allocation results.
* Solver execution limits.
* Feasible versus optimal outcomes.
* Regression behavior after algorithm updates.

The test environment is separated from the main Neon database to prevent development data from affecting the production dataset.

## Running the Project

Make sure Docker Desktop is running, then execute:

```bash
docker compose up --build
```

Open the application at:

```text
Frontend: http://localhost:3000
Backend:  http://localhost:8000
```

To stop the project:

```bash
docker compose down
```

## Project Structure

```text
dormify-project/
├── backend/
│   ├── allocation/              # Allocation solver and optimization logic
│   ├── api/                     # Django models, views, and management commands
│   ├── dormify/                 # Django configuration
│   └── manage.py
├── src/
│   ├── pages/                   # Main React pages
│   └── components/              # Reusable frontend components
├── docker-compose.yml
└── README.md
```

## Project Goal

Dormify aims to make university housing allocation more systematic, transparent, scalable, and responsive to complex student and administrative requirements.

The system is designed not only to assign available beds, but also to enforce mandatory conditions, handle limited resources responsibly, and provide administrators with clear and meaningful allocation results.
