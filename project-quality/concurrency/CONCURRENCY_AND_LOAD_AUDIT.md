# Group 2 — Backend Concurrency & Load Audit

**Branch:** `donia-group2-concurrency-load`
**Type:** Audit / measurement / documentation only. **No production fixes were implemented.**

---

## 1. Executive Summary

This audit inspected Dormify's backend for concurrency and load readiness: simultaneous user activity, throughput under concurrent traffic, concurrent reads, concurrent writes, race conditions, transaction/locking discipline, connection/resource behavior, and region isolation during simultaneous multi-manager use.

**Headline results:**

- The codebase already has **real, deliberate concurrency protection** in its most important write path. `assign_student_to_room()` (the single shared function behind every bed assignment — StudentRequest approvals, Transfer approvals, swaps) takes an `Apartment`-level `select_for_update()` lock and re-verifies bed availability *under that lock*. This was **empirically confirmed, not just read in the code**: two students racing for the last free bed in a room always resolve to exactly one winner, with the loser getting a clean `400`, never a `500`, never a double-booked bed (§4, §7, `ConcurrentBedContentionAcrossRequestsTests`).
- A **real, reproducible race condition was found and dynamically confirmed**: `StudentRequestViewSet.approve()` (and, by identical code shape, `TransferViewSet.approve()`/`reject()`) check `.status != PENDING` *before* entering `transaction.atomic()`, with no row lock. Two concurrent approvals of two different `ADD_STUDENT` requests proposing the same new `student_id` were fired at each other; **one run produced exactly the failure mode predicted by code inspection: the losing request received an unhandled `500`** (an uncaught `IntegrityError` from the `Student.student_id` unique constraint), not a clean `4xx` (§6, G2-01/G2-02).
- **An unrelated, pre-existing, non-concurrency bug was discovered incidentally** while building test fixtures: `TransferViewSet.perform_create()` and `.approve()` both reference a `Transfer.movement_type` field that **does not exist on the `Transfer` model** (it belongs to the related `MovementRequest` model). This means creating or approving *any* Transfer via the legacy `/api/transfers/` endpoints currently crashes with an unhandled `500` on a **single, non-concurrent** request — confirmed directly (`Transfer(movement_type='room')` raises `TypeError` immediately). This is **out of Group 2's scope** (it is not a concurrency issue — it fails every single time, with zero timing dependency) and was **not fixed**, but is flagged here for immediate, separate attention since it is more severe than anything actually in scope for this audit.
- Local load measurements (1/5/10/20 concurrent clients) across 5 representative read endpoints (home dashboard, students, requests, analysis, buildings) showed **zero failures, zero exceptions, zero connection errors** at any level, with moderate, expected latency growth (mean latency 3.6×–8.8× from 1→20 concurrent clients) fully explained by this local environment's lack of DB connection pooling (`CONN_MAX_AGE=0`, already flagged in Group 1's audit) and Django's single-process development server — not by any backend-code defect.
- **Two REGION_BOSS users in different regions working simultaneously do not interfere with or meaningfully block each other**: both requests succeeded, each student ended up correctly assigned in their *own* manager's region, and wall-clock time for both running concurrently was close to the slower individual request alone (not close to the sum) — genuine parallelism, not serialization (§9).
- The **existing test suite (62+ test classes, 12 files, plus ~150 Group 1 performance tests) had zero concurrency/threading-based tests before this audit** — every prior test runs strictly sequentially. This audit adds 11 new tests (`api/concurrency_tests/`) that are the first in the codebase to genuinely exercise concurrent database access.

No allocation algorithm code was read for correctness purposes, evaluated, or modified. No frontend code was changed. No fixes were implemented. Nothing was committed, pushed, or merged.

---

## 2. Scope and Exclusions

**In scope:** backend/system concurrency, load, stability, race conditions, and behavior under simultaneous use — across regional managers (different regions), central admin, and general users; concurrent reads and writes on Students, Requests, Transfers, Analysis, Buildings/Apartments/Rooms/Beds, Region Inbox, Reports; transaction/locking discipline; connection/resource behavior; region isolation during concurrent use (concurrency-specific check only, not a full permissions audit).

**Explicitly out of scope (per instructions), and NOT investigated:**
- The allocation algorithm's internal correctness, scoring, or solver logic (`allocation/solver.py` and friends) — only its *duplicate-run concurrency guard* (a generic locking pattern) was noted, not evaluated.
- Frontend/UI code and design.
- Full authorization/privacy testing (Group 3's job) — only the concurrency-specific "do two regions' simultaneous actions interfere" check was performed.
- Deployment configuration changes.
- Any load/testing against the real Azure database — **all measurement in this audit ran exclusively against the local disposable Postgres test database** (`ENV_FILE=.env.test`, `dormify_test` on `localhost:5433`, confirmed via direct settings inspection before any test ran).
- Destructive/extreme stress testing intended only to crash the local machine.

**Business rule honored:** every multi-manager test in this audit uses `REGION_BOSS` users from **different** regions (`g2-mr-region-a` / `g2-mr-region-b`), matching the stated one-manager-per-region rule. No test simulates two bosses in the same region.

---

## 3. Test Environment and Methodology

- **Database:** local disposable Postgres 16 in Docker (`dormify_test_db` container), accessed only via `ENV_FILE=.env.test` (`localhost:5433`, `dormify_test`). Confirmed programmatically before any test ran; never touched the real Azure database.
- **Why `TransactionTestCase`, not `TestCase`, for race-condition tests:** Django's plain `TestCase` wraps each test body in one outer transaction on one connection; a background thread started inside such a test gets its own thread-local connection that can never see the main thread's *uncommitted* writes, and a `select_for_update()` taken by a background thread against a row the main thread's still-open transaction touched simply blocks forever (a **test hang**, not a race reproduction). `TransactionTestCase` does not wrap the test body in a transaction (it truncates tables between tests instead), so every thread's connection genuinely commits and becomes visible to every other thread — the only test class that can actually reproduce a race rather than mask or deadlock on it. This is documented directly in `api/concurrency_tests/test_race_conditions.py`'s module docstring.
- **Why `LiveServerTestCase`, not `APIClient`, for load measurements:** `APIClient` calls the view function in-process — no socket, no WSGI dispatch, no real per-request DB connection lifecycle. Section 7 of this audit specifically needs to observe real Django development-server behavior under concurrent HTTP traffic (real `accept()`/thread-per-request cycle, real per-request Postgres connections given `CONN_MAX_AGE=0`). `LiveServerTestCase` starts an actual threaded WSGI server on a real local port; the `requests` library was used as a genuinely independent HTTP client, exactly as the real frontend or a browser would connect.
- **Thread orchestration:** `threading.Barrier` synchronizes worker-thread start times so concurrent requests fire as close to simultaneously as achievable in Python; each worker thread builds its **own** `APIClient()`/HTTP connection (never a shared client object) and explicitly calls `django.db.connections.close_all()` on exit (see §7 finding G2-EVIDENCE-conn-leak).
- **Authentication:** real JWT access tokens (`RefreshToken.for_user()`), sent as normal `Authorization: Bearer` headers — the same mechanism the real frontend uses, not a test-only shortcut.
- New test packages created:
  - `backend/api/concurrency_tests/test_race_conditions.py` — 6 test classes, 6 tests (race conditions, bed contention, multi-region isolation, inbox double-mark, the incidental Transfer bug).
  - `backend/api/concurrency_tests/test_load_concurrency.py` — 1 test class, 5 tests (load/throughput at N=1/5/10/20 across 5 endpoints).
- Evidence: `project-quality/concurrency/evidence/GROUP2_RACE_CONDITION_EVIDENCE.txt`, `project-quality/concurrency/evidence/GROUP2_LOAD_MEASUREMENTS.txt` (both regenerated directly by the test runs below).

---

## 4. Concurrent-Read Findings

Measured via `LoadConcurrencyTests` (§8 has the full numbers). Across `/api/home/`, `/api/students/`, `/api/requests/`, `/api/analysis/`, `/api/buildings/` at 1/5/10/20 concurrent GET clients:

- **100% success rate at every concurrency level, every endpoint** (100/100 requests across all 5 endpoints × 4 levels succeeded with HTTP 200; zero failures, zero request-level exceptions).
- No evidence of read/read contention, incorrect data mixing between concurrent requesters, or stale-cache leakage between users. Each concurrent GET independently computed and returned its own correct response.
- No endpoint tested shows pathologically disproportionate degradation (all mean-latency-at-20 vs mean-latency-at-1 ratios were 1.2×–8.8×, not the 20×+ that would indicate serialized/blocking reads) — see §8 for the full table and the caveat about this local environment's absolute latency floor.
- Group 1's prior audit/implementation work (N+1 elimination across these exact endpoints) is a direct concurrency enabler: fewer queries per request means less time each request holds a DB connection open, which is precisely what determines how many concurrent requests this environment's connection-per-request model (`CONN_MAX_AGE=0`) can sustain before requests start queueing for a connection. This audit's load numbers are a *downstream confirmation* that Group 1's fixes help concurrent load too, not just single-request latency.

**No confirmed concurrent-read correctness issues.**

---

## 5. Concurrent-Write Findings

| Scenario | Result |
|---|---|
| Two students racing for the **last free bed** in a room (two different `StudentRequest`s, concurrent `approve()`) | **Correctly protected.** Exactly one winner (`200`), one clean loser (`400 "No available bed in selected room."`), exactly 1 active `BedAssignment` in the room afterward. No double-booking, no `500`. (`ConcurrentBedContentionAcrossRequestsTests`) |
| Two `StudentRequest`s (`ADD_STUDENT`) proposing to create a **new student with the same `student_id`**, approved concurrently | **DB integrity held** (exactly 1 `Student` row created, guaranteed by the real `unique=True` constraint) **but the HTTP layer did not fail cleanly**: one confirmed run returned `(200, 500)` — the loser got an unhandled `500` instead of a `400`. (`DuplicateStudentCreationRaceTests`, G2-01/G2-02) |
| Two `REGION_BOSS` users in **different** regions, each approving their own request in their own region, concurrently | **No interference.** Both succeeded (`200`/`200`); each student ended up assigned in their manager's own region only; wall-clock time for both concurrently (≈202ms) was close to one alone (≈195–215ms each), not their sum (≈377–426ms) — genuine parallelism. (`MultiRegionConcurrentManagerTests`) |
| Region inbox item marked "processed" twice concurrently | **Idempotent, safe.** Both calls returned `200`; final status correctly `processed`; no crash, no corruption (the write has no side effects beyond its own two fields). (`RegionInboxDoubleMarkTests`) |
| Transfer approval (legacy `/api/transfers/` flow) | **Currently broken on a single, non-concurrent request** by an unrelated bug (§1, §6) — dynamic race-condition testing of this endpoint was blocked by that bug; the equivalent check-then-act shape was confirmed by code inspection only (see §6). |

**No lost updates, no duplicate persisted records, and no double-booked beds were found in any scenario tested** — the one confirmed defect (G2-01/G2-02) is an *unhandled-exception / bad-error-response* problem under a race, not a *data-integrity* problem (the DB constraint is the real backstop and it held).

---

## 6. Race-Condition Findings

### G2-01 / G2-02 — Check-then-act status race on `approve()`/`reject()` (CONFIRMED)

**Affected code:** `StudentRequestViewSet.approve()` and `.reject()`, `TransferViewSet.approve()` and `.reject()` (`backend/api/views.py`).

**Pattern:**
```python
req = self.get_object()                       # plain SELECT, no lock
if req.status != StudentRequest.Status.PENDING:
    return Response({'error': '...'}, status=400)
...
with transaction.atomic():                      # lock/atomicity starts HERE, too late
    ...
    req.status = StudentRequest.Status.APPROVED
    req.save()
```

The "already processed?" check happens **before** any lock or transaction. Two concurrent requests against the *same* object can both read `status == PENDING` before either commits, and both proceed to process the request.

**Evidence (dynamically confirmed):** `DuplicateStudentCreationRaceTests.test_concurrent_add_student_approvals_same_student_id` — two `ADD_STUDENT` `StudentRequest` rows, same proposed `student_id`, approved via two real concurrent HTTP `PUT .../approve/` calls. One run: `thread A -> 200`, `thread B -> 500` (raw Django error page, not a DRF-formatted error — confirms it's a genuinely *unhandled* exception, not a deliberate 4xx). `Student.objects.filter(student_id=...).count()` was correctly `1` — the DB constraint prevented data corruption, but the HTTP contract was violated (a client should never see a bare `500` for "someone else already handled this").

**Root cause:** `_create_student_from_request_data()` (`views.py`) does `Student.objects.filter(student_id=...).exists()` then `.save()` — the same check-then-act shape one level deeper — and the resulting `IntegrityError` from the DB's real unique constraint is caught nowhere on the path (`approve()`'s `except (ValueError, ValidationError)` does not catch `IntegrityError`).

**For bed-contention (not duplicate-student) races**, the *outer* consequence of this same unlocked check is much milder: `assign_student_to_room()`'s own apartment-level lock still protects the bed itself, so the loser reliably gets a clean `400 "No available bed"` rather than a `500` — see `ConcurrentBedContentionAcrossRequestsTests` and `StudentRequestDoubleApprovalRaceTests`. The error *message* is misleading in that case ("no bed available" rather than "already processed"), but not a crash.

**Confirmed by code inspection only** for `TransferViewSet.approve()`/`.reject()` (same unlocked-check-before-atomic shape) — dynamic reproduction was blocked by the unrelated `movement_type` bug (§1). Once that bug is fixed, this same race almost certainly applies there too.

- **Severity:** P1.
- **Can be fixed locally:** Yes — `select_for_update()` on the `StudentRequest`/`Transfer` row (or re-checking `status` a second time *inside* `transaction.atomic()` after acquiring a lock) is a small, well-understood, low-risk change, plus explicitly catching `IntegrityError` around `_create_student_from_request_data()`'s creation as a defensive backstop.
- **Real-environment validation still required:** No — this is a pure application-logic fix; local Postgres already demonstrates the exact race and the fix's correctness can be fully validated locally.

### G2-08 — `assign_student_to_room()` apartment-level locking (CONFIRMED PROTECTED, not a defect)

Already covered in §1/§5. Empirically confirmed via `ConcurrentBedContentionAcrossRequestsTests`: exactly one of two concurrent requesters wins the last free bed, the loser gets a clean `400`, and the room never ends up with more active assignments than beds. This is the *positive* counterexample showing the codebase already knows how to do this correctly — the gap is specifically the *outer* status-check race (G2-01), not the bed-assignment mechanism itself.

- **Severity:** N/A (protection confirmed working). No fix needed.

### G2-12 — `mark_inbox_viewed`/`mark_inbox_processed` unlocked check-then-act (CREDIBLE RISK, LOW SEVERITY)

Same unlocked-read-then-write shape as G2-01, but the write itself (`status`/`viewed_at`/`processed_at` only) has no side effects and is naturally idempotent — confirmed via `RegionInboxDoubleMarkTests` (`200`/`200`, correct final state, no crash). Not realistically exploitable for anything worse than a redundant timestamp overwrite.

- **Severity:** P3.

### Not investigated (out of scope): allocation-algorithm write paths

`AllocationRun` creation/retry/finalization endpoints already use a `Region`-level `select_for_update()` duplicate-run guard (confirmed present at 3 call sites via code inspection: run, retry, and a third lifecycle action) — noted as a *generic locking pattern* only. The allocation solver's internal logic, correctness, and scoring were not read, evaluated, or tested, per the explicit scope boundary.

---

## 7. Transaction/Locking Assessment

**Well-protected, confirmed by code inspection (and, where noted, dynamically):**

| Code path | Protection | Confirmed how |
|---|---|---|
| `assign_student_to_room()` (shared by every real bed assignment) | `Apartment`-level `select_for_update()`, bed re-verified free *under* the lock, DB `UniqueConstraint`s (`unique_active_assignment_per_bed`, `unique_active_assignment_per_student`) as final backstop | Dynamically (§6, G2-08) |
| `BuildingViewSet.update()` (gender-restriction changes) | `Building` + every `Apartment` under it locked before re-checking occupancy | Code inspection |
| `_execute_swap()` (student swap) | Both `BedAssignment` rows locked via `select_for_update(of=('self',))` before either is touched; validates both directions before writing either | Code inspection |
| `AllocationRun` creation/retry | `Region`-level `select_for_update()` duplicate-RUNNING-run guard | Code inspection (algorithm internals not evaluated) |
| `Student.student_id`, `Bed(room, label)`, `Building(dorm_type, number)` | Real DB-level `UniqueConstraint`/`unique=True` | Code inspection + G2-01 evidence (constraint held even when the application-level race was hit) |

**Missing/incomplete protection:**

| Code path | Gap | Severity |
|---|---|---|
| `StudentRequestViewSet.approve()`/`.reject()`, `TransferViewSet.approve()`/`.reject()` | Status check happens before `transaction.atomic()`/before any row lock | P1 (G2-01) |
| `_create_student_from_request_data()` | Check-then-create on `student_id`; resulting `IntegrityError` uncaught | P1 (G2-02, same finding as above, one layer deeper) |
| `mark_inbox_viewed`/`mark_inbox_processed` | No lock, but idempotent | P3 (G2-12) |
| `unassign_student_room` | `current_assignment` fetched without lock before ending it | P3 — worst case is a harmless duplicate ENDED timestamp; not tested dynamically this round given low severity |

No F-expression / atomic-counter patterns were found needing review (Dormify does not appear to maintain any non-derived numeric counters updated via read-modify-write Python code — capacity/occupancy figures are computed via live queries/aggregates, not stored counters, which sidesteps an entire class of race conditions by construction).

---

## 8. Load/Scaling Measurements

Full raw output: `project-quality/concurrency/evidence/GROUP2_LOAD_MEASUREMENTS.txt`. Dataset: 3 buildings × 2 rooms × 4 beds (24 beds), 20 students (12 assigned), 10 pending requests — rebuilt fresh per test method (comparable scale to Group 1's performance fixtures).

**Important methodology correction made during this audit:** the first measurement pass showed a suspicious, near-identical ≈2.0–2.6 second floor on *every* endpoint regardless of complexity or concurrency level. Investigation (a raw `socket.create_connection()` timing probe) isolated the cause precisely: connecting to the hostname `"localhost"` on this Windows machine takes **~2020ms** per TCP connect, vs **~13ms** connecting to `127.0.0.1` against the exact same listening port — a well-documented Windows IPv6-then-IPv4-fallback DNS/connect quirk, **entirely a local-machine artifact with zero relation to Django or this backend's code** (see below, Category B). All measurements below use `127.0.0.1` directly, removing that artifact.

| Endpoint | N=1 mean ms | N=5 mean ms | N=10 mean ms | N=20 mean ms | Ratio (20/1) | Failures |
|---|---|---|---|---|---|---|
| `/api/home/` | 87.0 | 156.4 | 270.3 | 402.1 | 4.6× | 0/40 |
| `/api/students/` | 75.3 | 125.8 | 302.9 | 741.0 | 9.8× | 0/40 |
| `/api/requests/` | 157.0 | 320.1 | 641.5 | 749.0 | 4.8× | 0/40 |
| `/api/analysis/` | 117.3 | 279.5 | 494.4 | 1007.8 | 8.6× | 0/40 |
| `/api/buildings/` | 71.1 | 163.5 | 244.1 | 311.9 | 4.4× | 0/40 |

(Final confirmation run; a first pass produced similar-shape numbers — e.g. `/api/buildings/` 3.6×, `/api/home/` 6.4× — within the same 3.6×–9.8× band across two independent runs, consistent with ordinary run-to-run variance in this local Docker/Windows environment rather than a flaky measurement.)

Throughput (`requests/sec`, wall-clock-derived) plateaus in the **~15–34 req/s** range across all 5 endpoints regardless of concurrency level — consistent with a single-process Django development server plus `CONN_MAX_AGE=0` (a brand-new Postgres connection is opened and closed on every single request; there is no pooling to amortize that cost across concurrent requests). This matches and empirically reinforces Group 1's prior finding (G1-21/G1-22/G1-23: no connection pooling, dev-server-only locally, WSGI worker-count unknown in production) — this audit does not re-litigate that decision (explicitly marked "needs real-environment validation" in Group 1's report) but does provide fresh, direct local evidence of its concurrent-load impact.

**Category classification (per the audit's own required distinction):**
- **A. Application/backend issue:** none identified in the load numbers themselves — zero failures/exceptions at any level tested; the *relative* latency growth (3.6×–8.8×, not 20×+) indicates ordinary linear-ish cost under contention, not a serialization bug.
- **B. Local dev-environment limitation:** the `"localhost"` DNS/connect quirk (methodology artifact, fixed by testing against `127.0.0.1`); Django's single-process development server itself (not what production would run).
- **C. Production/deployment concern, cannot be validated locally:** `CONN_MAX_AGE=0` + no connection pooling + unknown production WSGI worker/thread count — all already flagged in Group 1's audit as requiring real-environment measurement, not something this local test can resolve either way.

No meaningless extreme stress test was run; 20 concurrent clients against a locally-seeded, modest dataset was judged a sensible upper bound for this environment and this application's realistic simultaneous-user scale (a university dorm system with a handful of regional managers and staff, not a public consumer app).

---

## 9. Multi-Region Simultaneous-Manager Behavior

Directly tested (`MultiRegionConcurrentManagerTests`, per the stated one-manager-per-region business rule — two `REGION_BOSS` users from **different** regions, never the same region):

- Both managers' `approve()` calls succeeded independently (`200`/`200`).
- **Region isolation held**: `student_a` ended up assigned to `room_a` (region A) and `student_b` to `room_b` (region B) — neither manager's action touched the other region's data.
- **No serialization/blocking observed**: wall-clock time for both running concurrently (≈202–222ms) was close to a single request's own time (≈182–215ms each), far below the sum of both running sequentially (≈377–426ms) — confirming the two managers' work is **not** meaningfully queued behind one another. This makes sense given the architecture: each manager's `assign_student_to_room()` call locks only *its own* `Apartment` row (different regions imply different buildings/apartments), so the two `select_for_update()` calls never contend for the same lock.

This is a genuinely positive, confirmed finding: the "one manager per region" architecture pairs naturally with the existing apartment-scoped locking to give real regional concurrency without cross-region interference or unnecessary blocking.

---

## 10. Existing Test Coverage and Gaps

**Before this audit:** 62+ test classes across 12 dedicated test files (`tests_add_student.py`, `tests_allocation.py`, `tests_analysis.py`, `tests_assisted_allocation.py`, `tests_bed_hierarchy.py`, `tests_edit_student.py`, `tests_home_dashboard.py`, `tests_inventory.py`, `tests_matching_ranking.py`, `tests_requests.py`, `tests_students_performance.py`, `tests_transfer_regions.py`), plus ~150 tests added during Group 1's performance work (`api/performance_tests/`) — **confirmed via grep: zero of them use `Thread`, `ThreadPoolExecutor`, or any other concurrency primitive.** Every single existing automated test in this codebase runs strictly sequentially. This is precisely why G2-01/G2-02 (a real, confirmed race condition) and the `TransferViewSet.movement_type` bug (a real, confirmed *non-concurrency* crash) could both exist undetected: the former needs concurrent execution to surface at all; the latter needs the endpoint to be exercised even once via a real HTTP call (which, it appears, none of the existing Transfer-related tests do — `tests_transfer_regions.py` exercises the newer `StudentRequest`-based region-transfer flow, a different code path entirely, not the legacy `TransferViewSet`).

**What this audit adds:** `backend/api/concurrency_tests/` — 2 new files, 11 new tests, all passing:
- `test_race_conditions.py`: 6 tests (duplicate-student race, bed-contention protection, multi-region isolation, inbox double-mark, the incidental Transfer bug).
- `test_load_concurrency.py`: 5 tests (load/throughput at 4 concurrency levels × 5 endpoints).

**Recommended for Group 2's implementation phase (not built here, per the audit-only scope of this task):**
- A regression test asserting the fix for G2-01/G2-02 (once implemented) — i.e. a test that currently fails/flags the race and should pass cleanly (no `500`) once `select_for_update()` is added.
- Equivalent Transfer-approval race tests, once the unrelated `movement_type` bug is fixed and the endpoint is reachable at all.
- A CI-friendly, faster-running subset of the load tests (the full 4-level × 5-endpoint sweep is useful for audits but may be too slow for routine CI; a 1-and-10-only smoke variant would catch gross regressions cheaply).

---

## 11. Prioritized Issue Table

| ID | Severity | Area | Summary | Fix locally? | Real-env validation still required? |
|---|---|---|---|---|---|
| G2-01 | **P1** | Race condition | `StudentRequestViewSet.approve()`/`.reject()` check `.status != PENDING` before any lock/`transaction.atomic()` — confirmed dynamically to let two concurrent approvals both proceed | Yes | No |
| G2-02 | **P1** | Race condition | `_create_student_from_request_data()`'s check-then-create on `student_id` lets a losing racer's `IntegrityError` propagate as an unhandled `500` instead of a clean `400` | Yes | No |
| G2-04 | P2 | UX/diagnostics | Losing racer in a bed-contention race gets a misleading "no bed available" message instead of "already processed" (not a crash, just confusing) | Yes | No |
| G2-11 | P2 | Test coverage | Zero concurrency tests existed anywhere in the codebase before this audit; the new suite (11 tests) should become permanent CI coverage | Yes (adopt suite) | No |
| G2-code-static | P1 (by inspection, not dynamically confirmed) | Race condition | `TransferViewSet.approve()`/`.reject()` has the identical unlocked-check shape as G2-01; dynamic proof blocked by the unrelated bug below | Yes, once endpoint is reachable | No |
| G2-12 | P3 | Race condition (low risk) | `mark_inbox_viewed`/`mark_inbox_processed` unlocked but idempotent | Optional | No |
| G2-conn-leak | P3 | Connection/resource | Raw background threads that touch the ORM leak DB connections unless `connections.close_all()` is called explicitly (observed while building this audit's own harness; relevant to any current/future background-worker code) | Yes (document as a pattern to follow) | No |
| G2-localhost-dns | P3 (informational) | Local environment (Category B) | `"localhost"` resolution adds ~2s per TCP connect on this Windows machine; irrelevant to production, initially confounded this audit's own measurements until diagnosed | N/A (test-methodology note only) | No |
| G2-load-scaling | P2 (informational) | Load/scaling (Category C) | Throughput plateaus ~20–32 req/s locally; latency grows 3.6×–8.8× from 1→20 concurrent clients, consistent with `CONN_MAX_AGE=0` + no pooling + single-process dev server (already flagged in Group 1 as G1-21/22/23) | No — needs real deployment | **Yes** |
| **INCIDENTAL-1** | **P0 (non-concurrency)** — **out of Group 2 scope** | Correctness bug | `TransferViewSet.perform_create()`/`.approve()` reference `Transfer.movement_type`, a field that does not exist on the model — every Transfer creation/approval currently crashes with an unhandled `500` on a single sequential request, no timing involved | N/A — not fixed here, flagged for a separate ticket | No — reproduces 100% locally already |

**Positive/confirmed-protected findings (not defects, listed for completeness):**
- G2-08: `assign_student_to_room()` apartment-level locking correctly prevents bed double-booking under concurrent contention (dynamically confirmed).
- G2-09: Two region bosses in different regions run genuinely concurrently with no interference and no unnecessary serialization (dynamically confirmed).
- Building/apartment gender-restriction changes and student swaps are both correctly locked (code inspection).
- AllocationRun creation has a working region-level duplicate-run guard (code inspection; algorithm internals out of scope).

**Severity counts among IN-SCOPE Group 2 findings:** P0: 0 · P1: 3 (G2-01, G2-02, and the static Transfer-race finding) · P2: 3 (G2-04, G2-11, G2-load-scaling) · P3: 3 (G2-12, G2-conn-leak, G2-localhost-dns). The one P0-severity item found (INCIDENTAL-1) is explicitly a non-concurrency correctness bug, outside Group 2's scope, and is reported separately rather than folded into these counts.

---

## 12. What Can Be Fixed Locally

- G2-01 / G2-02 / the static Transfer-approval race: add `select_for_update()` (or a locked re-check inside `transaction.atomic()`) to `StudentRequestViewSet.approve()`/`.reject()` and `TransferViewSet.approve()`/`.reject()`; wrap `_create_student_from_request_data()`'s creation with an explicit `IntegrityError` catch as a defensive backstop. Fully testable and verifiable against the local Postgres test database — no production-scale data or real-environment behavior is needed to prove correctness.
- G2-04: once G2-01 is fixed with a proper row lock, the second racer will naturally hit the (now-locked) "already processed" check instead of falling through to "no bed available" — likely resolves as a side effect of the G2-01 fix.
- G2-12: optional `select_for_update()` for `mark_inbox_viewed`/`mark_inbox_processed`, low priority given the idempotent nature of the current behavior.
- G2-11: adopt `api/concurrency_tests/` as permanent, CI-run regression coverage.
- G2-conn-leak: document `connections.close_all()` as a required pattern for any thread-based background code (this audit's own tests already follow it).

## 13. What Requires Production/Real-Environment Validation

- G2-load-scaling (and, by extension, Group 1's G1-21/G1-22/G1-23): connection pooling (`CONN_MAX_AGE` or an external pooler like PgBouncer), the real production WSGI/ASGI server and its worker/thread configuration, and Postgres's real `max_connections` under genuine concurrent multi-user production traffic. Local measurement in this audit is a useful *relative* signal (no pathological blocking observed) but the *absolute* numbers are not representative of production and should not be used as an SLA baseline.
- The static Transfer-approval race finding cannot be dynamically re-confirmed until the unrelated `movement_type` bug (INCIDENTAL-1) is fixed in a separate, non-Group-2 change.
- True production-scale simultaneous-user counts (how many regional managers and staff are realistically active at once) were not available to this audit; the 1/5/10/20 levels chosen are a reasonable local approximation, not a measured production ceiling.

## 14. Recommended Group 2 Implementation Plan

1. **P1 fixes first:** add row-level locking to `StudentRequestViewSet.approve()`/`.reject()` and `TransferViewSet.approve()`/`.reject()` (G2-01), plus an `IntegrityError` safety net around student creation (G2-02). Write a regression test that currently fails against the unfixed code and passes once fixed (this audit's `DuplicateStudentCreationRaceTests` is a ready-made starting point).
2. **Escalate INCIDENTAL-1 immediately, outside Group 2**, given its severity (a core legacy feature is completely non-functional) — even though it is not a concurrency issue, it is more urgent than anything in this audit's own scope.
3. **Adopt the new `api/concurrency_tests/` suite as permanent CI coverage** (G2-11) so future changes cannot silently reintroduce a race in these same write paths.
4. **P2/P3 cleanup:** clearer error messaging for lost races (G2-04), optional locking for inbox status transitions (G2-12), document the connection-cleanup pattern for any future background/async code (G2-conn-leak).
5. **Defer to real-environment work:** connection pooling and WSGI/production server configuration (G2-load-scaling) — do not attempt to "fix" this locally; it needs real deployment measurement, consistent with Group 1's existing recommendation.

---

## Appendix: Files Added

- `backend/api/concurrency_tests/__init__.py`
- `backend/api/concurrency_tests/test_race_conditions.py` (6 tests)
- `backend/api/concurrency_tests/test_load_concurrency.py` (5 tests)
- `project-quality/concurrency/evidence/GROUP2_RACE_CONDITION_EVIDENCE.txt`
- `project-quality/concurrency/evidence/GROUP2_LOAD_MEASUREMENTS.txt`
- `project-quality/concurrency/CONCURRENCY_AND_LOAD_AUDIT.md` (this file)

No other files were modified. No allocation code was touched. No frontend code was touched. Nothing was committed, pushed, or merged.
