# Backend Concurrency and Load: Implementation Report

**Type:** Implementation of locally-fixable findings from the concurrency audit, with regression verification.
**Base document:** `project-quality/concurrency/CONCURRENCY_AND_LOAD_AUDIT.md`

---

## 1. Executive Summary

This phase implemented and verified fixes for the two confirmed P1 concurrency findings from the concurrency audit (G2-01, G2-02), resolved the incidental, higher-severity `Transfer.movement_type` bug that had blocked dynamic testing of the equivalent Transfer-side race, applied the same locking pattern to `TransferViewSet.approve()`/`.reject()`, and expanded the permanent regression suite in `backend/api/concurrency_tests/` from 11 to 17 tests — all passing.

**What changed, at a glance:**
- `StudentRequestViewSet.approve()`/`.reject()`: the "already processed?" status check is now re-verified under a `select_for_update()` row lock, inside `transaction.atomic()`, immediately before any mutation — closing the check-then-act race.
- `StudentRequestViewSet.approve()`: now catches `IntegrityError` (the real backstop from `Student.student_id`'s DB-level unique constraint) and converts it into a clean, deterministic `400` instead of letting it escape as an unhandled `500`.
- `TransferViewSet.perform_create()`: removed the invalid `movement_type=...` keyword argument passed to `serializer.save()` — `Transfer` has no such field; it was crashing every single Transfer creation.
- `TransferViewSet.approve()`: now reads `movement_type` from the correct place (`transfer.movement_request.movement_type`, with a safe `None` fallback), fixing an unconditional `AttributeError` on every approval; also gained the same row-lock-and-recheck pattern as `StudentRequestViewSet.approve()`, plus an `IntegrityError` backstop.
- `TransferViewSet.reject()`: gained `transaction.atomic()` (previously had **none** at all) plus the same row-lock-and-recheck pattern.
- Nothing else was changed. `assign_student_to_room()`'s apartment-level locking, the bed-contention protection, multi-region independence, swap locking, building/apartment locking, and all DB unique constraints are untouched and re-verified working.

**Regression results:** 17/17 new concurrency tests pass; 47/47 relevant existing StudentRequest/Transfer/performance tests pass; the broader combined sweep across all concurrency and performance test areas is reported in §11. `python manage.py check` is clean.

No allocation code was touched. No frontend code was touched. No deployment configuration was touched.

---

## 2. Audit Findings Addressed

| ID | Finding | Status after this phase |
|---|---|---|
| G2-01 | `StudentRequestViewSet.approve()`/`.reject()` unlocked check-then-act on `.status` | **FIXED** — row-locked, dynamically re-confirmed fixed |
| G2-02 | `_create_student_from_request_data()`'s `IntegrityError` uncaught, surfaced as `500` | **FIXED** — caught and converted to clean `400` |
| Static Transfer-race finding (audit §6/§11) | `TransferViewSet.approve()`/`.reject()` has the identical unlocked shape as G2-01 | **FIXED** — same locking pattern applied, now dynamically confirmed (previously could only be confirmed by code inspection) |
| INCIDENTAL-1 | `Transfer.movement_type` referenced but does not exist on the model — every Transfer create/approve crashed unconditionally | **FIXED** (see §6) — this was explicitly flagged as out-of-scope-but-urgent in the audit; fixing it was a prerequisite for Priority 2, so it was corrected here (a minimal, surgical fix only, deliberately not a Transfer redesign) |
| G2-04 | Losing racer in a bed-contention race gets a misleading "no bed available" instead of "already processed" | **Unchanged/deprioritized** — as predicted in the audit, this mostly resolves itself once the row lock is in place: in the single-bed racing scenarios re-tested here, the loser now correctly gets "already processed" (see §11 evidence) rather than the old misleading message, because the row lock now rejects it before ever reaching the bed-availability check |
| G2-08 | `assign_student_to_room()` apartment-level locking | **Unchanged, re-confirmed working** (§3, §11) |
| G2-09 | Multi-region manager independence | **Unchanged, re-confirmed working** (§10) |
| G2-11 | Zero concurrency tests existed before the audit | **Addressed** — suite adopted and expanded (§8) |
| G2-12 | `mark_inbox_viewed`/`processed` idempotent, low risk | **Deliberately left unchanged** (§13), per explicit instruction not to over-fix |
| G2-conn-leak | Thread-based test harness needs `connections.close_all()` | **Kept as documented pattern**, unchanged (§13) |
| G2-load-scaling | Connection pooling / WSGI / `CONN_MAX_AGE` | **Deliberately not touched** (§13, §14) — real-environment concern, explicitly out of scope for this work |

---

## 3. Exact Production-Code Changes

All changes are in `backend/api/views.py`. No other production file was modified.

1. **Import added:**
   ```python
   from django.db import transaction, IntegrityError
   ```
   (previously `from django.db import transaction` only).

2. **`_create_student_from_request_data()`** — docstring-only change: added an explanatory comment describing why the check-then-create shape is safe (the caller now catches `IntegrityError`). No logic change. (One unrelated typo introduced by an editing slip during this change — a stray non-Hebrew character in an error string — was caught and corrected immediately via a follow-up diff review before any test ran.)

3. **`StudentRequestViewSet.approve()`**:
   - Inside `with transaction.atomic():`, before any request-type branch, added:
     ```python
     locked_req = StudentRequest.objects.select_for_update().get(pk=req.pk)
     if locked_req.status != StudentRequest.Status.PENDING:
         return Response({'error': 'הבקשה כבר טופלה'}, status=status.HTTP_400_BAD_REQUEST)
     ```
   - Added `except IntegrityError:` to the existing `try/except`, returning a clean `400`.

4. **`StudentRequestViewSet.reject()`**:
   - Wrapped the previously-unwrapped mutation in `with transaction.atomic():`.
   - Added the identical `select_for_update()` + re-check pattern at the top of that block.

5. **`TransferViewSet.perform_create()`**:
   - Removed `movement_type=movement_type` from the `serializer.save(...)` call (Transfer has no such field).

6. **`TransferViewSet.approve()`**:
   - Added the same `select_for_update()` + re-check pattern (locking `Transfer`, not `StudentRequest`).
   - Replaced `transfer.movement_type == MovementRequest.MovementType.PHASE2` with:
     ```python
     movement_type = (
         transfer.movement_request.movement_type
         if transfer.movement_request_id else None
     )
     assignment_type = (
         BedAssignment.AssignmentType.PHASE2
         if movement_type == MovementRequest.MovementType.PHASE2
         else BedAssignment.AssignmentType.TRANSFER
     )
     ```
   - Added `except IntegrityError:` returning a clean `400`.

7. **`TransferViewSet.reject()`**:
   - Wrapped the previously-unwrapped mutation in `with transaction.atomic():`.
   - Added the same `select_for_update()` + re-check pattern.

No other business logic, permission check, region-scoping rule, serializer field, URL, or model was changed.

---

## 4. StudentRequest Locking/Race Fix

**Pattern used:** the existing fast, unlocked pre-check (`req = self.get_object(); if req.status != PENDING: return 400`) is **left in place unchanged** (it is a correct, cheap fast-path for the overwhelming non-racing case, and removing it would be a needless behavior change). A **second, authoritative check** was added immediately inside `transaction.atomic()`:

```python
locked_req = StudentRequest.objects.select_for_update().get(pk=req.pk)
if locked_req.status != StudentRequest.Status.PENDING:
    return Response({'error': 'הבקשה כבר טופלה'}, status=status.HTTP_400_BAD_REQUEST)
```

`select_for_update()` takes a real Postgres row lock on that specific `StudentRequest` row for the duration of the transaction. A second, concurrent `approve()`/`reject()` call for the *same* request blocks on this exact line until the first transaction commits or rolls back, then re-reads the now-updated `status` and correctly bails out with a clean `400` — it can no longer act on a stale `PENDING` read.

**Why the original, richly-prefetched `req` object (from `self.get_object()`, which goes through `get_queryset()`'s `select_related`/`Prefetch` chains) is still used for the actual mutation and response, not the freshly-fetched `locked_req`:** `locked_req` exists purely to acquire the lock and confirm the authoritative status; once we know we're clear to proceed, `req.save()` performs the `UPDATE` on the exact same row, inside the same transaction, while the lock acquired via `locked_req` is still held (Postgres row locks are transaction-scoped, not object-reference-scoped) — this preserves every one of the existing serializer optimizations for the response and avoids reintroducing an N+1-style extra query cost for a single-object detail response.

**Permission/region-scoping preserved exactly:** `self.get_object()` (which applies `get_queryset()`'s region-scoping) and `_user_can_review_request()` are called in the *original* order, *before* the lock is ever acquired — nothing about who is allowed to act on the request changed. Only the "is this request still actionable" check gained a second, authoritative, race-proof verification.

The identical pattern was applied to `reject()`.

---

## 5. Duplicate-Student `IntegrityError` Handling

`_create_student_from_request_data()`'s `Student.objects.filter(student_id=...).exists()` → `.save()` shape is **still** a check-then-act pattern — this was a deliberate choice, not an oversight: there is no natural row to lock (the student doesn't exist yet), so a `select_for_update()`-style fix isn't applicable here. Per the audit's own recommendation, the fix is instead at the **boundary**: `Student.student_id`'s real DB-level `unique=True` constraint remains the actual backstop, and `StudentRequestViewSet.approve()` now has:

```python
except IntegrityError:
    return Response({
        'error': 'הבקשה לא אושרה עקב התנגשות נתונים - ייתכן שסטודנט עם ת.ז זו כבר נוצר או שהבקשה כבר טופלה. נא לרענן ולנסות שוב.',
    }, status=status.HTTP_400_BAD_REQUEST)
```

This message follows the existing API's error-response shape exactly (a Hebrew `'error'` string field, `400`, matching every other validation failure on this endpoint) rather than inventing new error semantics. `transaction.atomic()` guarantees the entire attempt (including the `StudentRequest` row lock acquired earlier in the same block) rolls back cleanly when this fires — no partial writes survive.

**Dynamically re-confirmed fixed** (`DuplicateStudentCreationRaceTests`, §8/§11): two `StudentRequest` rows proposing the same new `student_id`, approved concurrently — result is now deterministically `[200, 400]`, never `[200, 500]`, exactly one `Student` row created.

---

## 6. Transfer `movement_type` Bug: Investigation and Resolution

**Investigation (before any change was made):**
- Read `Transfer` model (`backend/api/models.py`) in full: `student`, `from_room`, `to_room`, `reason`, `status`, `requested_by`, `reviewed_by`, `reviewed_at`, `rejection_reason`, `movement_request` (a nullable `OneToOneField` to `MovementRequest`), `created_at`, `updated_at`. **No `movement_type` field.**
- Read `MovementRequest` model: **has** a `movement_type` field (`CharField`, `MovementType` choices).
- Confirmed directly, before touching any code: `Transfer(movement_type='room')` raises `TypeError: Transfer() got unexpected keyword arguments: 'movement_type'`.
- Read `TransferViewSet.perform_create()`: computes `movement_type = infer_movement_type(from_room, to_room)`, then (bug) passes it into `serializer.save(..., movement_type=movement_type)` for the `Transfer` itself, **and separately** (correctly) stores the same value on the `MovementRequest` it creates immediately afterward (`MovementRequest(..., movement_type=movement_type, ...)`), which is then linked via `transfer.movement_request`.
- Read `TransferViewSet.approve()`: reads `transfer.movement_type` directly — the exact non-existent attribute — unconditionally raising `AttributeError` on every single approval, regardless of concurrency.
- Checked `TransferSerializer.Meta.fields`: no `movement_type` entry (consistent with the model).
- Checked existing test coverage: grepped every `tests_*.py` and `performance_tests/*.py` file for `/api/transfers/` and `TransferViewSet` — found exactly one usage of `Transfer.objects.create()` (in `tests_matching_ranking.py`), used only as inert fixture data, never through the ViewSet's `create`/`approve`/`reject` actions. **No existing test exercised this path at all**, which is how the bug went undetected.
- Checked for frontend usage to determine "dead code" vs "real, broken feature": this repository checkout contains no `frontend/` directory (the frontend lives in a separate build context, per the `dormify_frontend` Docker container observed earlier), so frontend call-sites could not be inspected directly. However, code inspection shows `TransferViewSet` is fully built out — real permission logic (`user_can_approve_transfer`, region-scoping), a complete serializer, and the audit's own investigation found no indication of deprecation (no "legacy, do not use" markers beyond `student_allocation_report`'s own docstring elsewhere, which is unrelated). Given the bug is a simple, narrowly-scoped, one-line-class invalid-field-reference — not evidence of deeper design abandonment — this was judged a real, currently-broken feature, **not** dead code, so it was fixed rather than left undocumented.

**Resolution — confirmed intended source of `movement_type`:** the related `MovementRequest.movement_type`, reached via `transfer.movement_request.movement_type`. This is unambiguous from the model relationships: `perform_create()` already computes the value once and correctly stores it on the `MovementRequest`; `Transfer` was never meant to duplicate that field.

**Minimum safe correction made (§3, items 5–6):**
- `perform_create()`: removed the invalid `movement_type=...` kwarg from `Transfer`'s `serializer.save()` call. (The value is still computed and still correctly stored on the `MovementRequest`, unchanged.)
- `approve()`: reads `transfer.movement_request.movement_type` (with a `None`-safe fallback to the existing `TRANSFER` default for any non-`PHASE2` case, preserving the exact original `PHASE2`-vs-`TRANSFER` decision logic).

**No business semantics were changed.** The `PHASE2` vs. `TRANSFER` assignment-type decision is byte-for-byte the same decision, just correctly sourced. No fields, routes, or serializer contracts were added, removed, or redesigned.

**Sequential regression coverage added** (`TransferCreateAndApproveSequentialTests`, 3 tests — create, approve, reject, all single-client/non-concurrent): all pass, proving the endpoint is now functional. See §8, §11.

---

## 7. Transfer Locking/Race Fix

Applied the identical pattern used for `StudentRequestViewSet` (§4) to both `TransferViewSet.approve()` and `.reject()`:

```python
locked_transfer = Transfer.objects.select_for_update().get(pk=transfer.pk)
if locked_transfer.status != Transfer.Status.PENDING:
    return Response({'error': 'הבקשה כבר טופלה'}, status=status.HTTP_400_BAD_REQUEST)
```

`reject()` previously had **no** `transaction.atomic()` at all — this was also closed (a pre-existing gap where a failure between `transfer.save()` and `transfer.movement_request.save()` could have left inconsistent state; now both writes are atomic).

`approve()` also gained an `except IntegrityError:` backstop, mirroring `StudentRequestViewSet.approve()`.

**Dynamically confirmed** (only possible after the §6 fix unblocked the endpoint) via `TransferDoubleApprovalRaceTests` — two new tests:
- `test_concurrent_approve_same_transfer_single_bed`: two concurrent `approve()` calls on the same Transfer → deterministic `[200, 400]`, never `500`, exactly one active `BedAssignment`.
- `test_concurrent_approve_and_reject_same_transfer`: one `approve()` + one `reject()` racing → exactly one wins, final status unambiguous.

---

## 8. Concurrency Regression Tests Added/Updated

`backend/api/concurrency_tests/` (kept as permanent regression coverage) grew from 11 tests (audit phase) to **17 tests** (implementation phase), all passing. Mapped against the minimum-coverage requirements:

| Requirement | Test(s) |
|---|---|
| A. StudentRequest same-object double approval | `StudentRequestDoubleApprovalRaceTests` — 2 tests: single-bed AND ample-capacity variants (the latter isolates the row-lock specifically, since bed scarcity alone can't be relied on to stop the second racer) |
| B. StudentRequest duplicate-student creation race | `DuplicateStudentCreationRaceTests` — now a true regression test: hard-fails on any `500` |
| C. StudentRequest bed-contention race | `ConcurrentBedContentionAcrossRequestsTests` — unchanged, re-confirmed |
| D. StudentRequest reject/approve conflict | `StudentRequestApproveRejectConflictTests` — **new**: one thread approves, one rejects, the same request, concurrently |
| E. Transfer double approval/rejection race | `TransferDoubleApprovalRaceTests` — **new**, 2 tests (double-approve; approve-vs-reject), now reachable after the §6 fix |
| F. Two REGION_BOSS users, different regions, simultaneous | `MultiRegionConcurrentManagerTests` — unchanged, re-confirmed |
| G. Region inbox idempotent concurrent mark | `RegionInboxDoubleMarkTests` — unchanged, deliberately left unlocked per G2-12 |
| H. Representative concurrent read/load smoke behavior | `test_load_concurrency.py` — unchanged methodology, re-run (§9) |

Plus `TransferCreateAndApproveSequentialTests` (3 sequential, non-concurrent tests) proving the movement_type fix works before layering concurrency on top.

**Methodology unchanged from the audit** (still the correct choice, re-affirmed): `TransactionTestCase` (not `TestCase`) for every race test — `TestCase`'s single-connection outer-transaction wrapping would either hide the race entirely (background threads can't see uncommitted writes) or deadlock (a `select_for_update()` from a background thread against a row the main thread's open transaction touched blocks forever). No sequential test was substituted for a genuine concurrent one anywhere in this suite — every "race" test still uses `ThreadPoolExecutor` + `threading.Barrier`-synchronized concurrent HTTP calls, each on its own `APIClient()`/connection.

Evidence file: `project-quality/concurrency/evidence/GROUP2_RACE_CONDITION_EVIDENCE_AFTER_FIX.txt` (new filename — the audit's original `GROUP2_RACE_CONDITION_EVIDENCE.txt` is preserved unmodified as the "before" record).

---

## 9. Load Measurements: Before vs. After

Re-ran the identical methodology from the audit (`LiveServerTestCase`, real threaded WSGI server, real sockets, `127.0.0.1` explicit to avoid the Windows `"localhost"` DNS artifact diagnosed in the audit) at the same concurrency levels (1/5/10/20) against the same 5 representative GET endpoints. Full data: `project-quality/concurrency/evidence/GROUP2_LOAD_MEASUREMENTS_AFTER_FIX.txt` (new filename; audit's original `GROUP2_LOAD_MEASUREMENTS.txt` preserved unmodified).

| Endpoint | Audit ratio (20/1) | After-fix ratio (20/1) | Failures (after) |
|---|---|---|---|
| `/api/home/` | 4.6× | 8.4× | 0/40 |
| `/api/students/` | 9.8× | 15.2× | 0/40 |
| `/api/requests/` | 4.8× | 4.4× | 0/40 |
| `/api/analysis/` | 8.6× | 7.4× | 0/40 |
| `/api/buildings/` | 4.4× | 6.7× | 0/40 |

**Zero failures, zero exceptions, zero connection errors, no deadlocks** at any level, both before and after — confirming the row-locking changes did not introduce any read-side regression. This is expected: **none of the 5 endpoints measured are affected by the locking changes at all** — the fixes touch only `StudentRequestViewSet.approve()`/`.reject()` and `TransferViewSet.approve()`/`.reject()`/`perform_create()` (write/action endpoints), none of which are GET list/detail endpoints in this load-test set. The ratio numbers moving within a 4.4×–15.2× band (vs. 4.4×–9.8× in the audit) reflects this local Docker/Windows environment's already-documented run-to-run variance (see the prior performance work and the audit itself for prior examples of this), not a locking-caused regression — there is no code-level reason a lock on `StudentRequest`/`Transfer` rows would affect `/api/students/`'s query plan or latency, and the write-path race tests (§8) directly confirm the locking itself behaves correctly and does not deadlock or hang under real concurrent contention.

**No pathological serialization observed**: throughput at N=20 remained in the same ~11–33 req/s ballpark as the audit; no endpoint's latency grew anywhere near what full serialization (an N×-proportional slope) would produce.

As instructed, these absolute local numbers are **not** treated as production performance — see §14.

---

## 10. Multi-Region Concurrency Verification

`MultiRegionConcurrentManagerTests` (unchanged from the audit, re-run after the locking fixes) confirms the new `StudentRequest`-row locking does **not** introduce cross-region blocking: two `REGION_BOSS` users from different regions (`g2-mr-region-a` / `g2-mr-region-b`, per the one-manager-per-region business rule) each approving their own request concurrently still both succeed, still both end up correctly isolated to their own region's room, and wall-clock time for both running concurrently (≈220ms) remained close to a single request alone (≈214–218ms each) rather than their sum (≈432ms) — the new lock is per-`StudentRequest`-row (and the pre-existing lock is per-`Apartment`-row), and two managers in different regions never touch the same row of either kind, so they never contend.

---

## 11. Regression-Test Results

| Suite | Result |
|---|---|
| `api.concurrency_tests.test_race_conditions` (17 tests, all new/updated for this phase) | **17/17 passed** |
| `api.concurrency_tests.test_load_concurrency` (5 tests) | **5/5 passed** |
| `api.tests_requests` (StudentRequest business logic) | passed (part of the 47, see below) |
| `api.tests_transfer_regions` (region-transfer / StudentRequest region flows) | passed |
| `api.tests_matching_ranking` (uses `Transfer.objects.create()` as fixture data) | passed — confirms the Transfer fixes did not disturb this unrelated usage |
| `api.performance_tests.test_requests_performance` (StudentRequestViewSet) | passed — flat query counts unaffected (the new lock is on the action endpoints, not `get_queryset()`) |
| `api.performance_tests.test_transfers_performance` (TransferViewSet) | passed |
| **Combined total (the 5 suites above)** | **47/47 passed** |
| `python manage.py check` | Clean — "System check identified no issues (0 silenced)" |
| Broader combined sweep (all `api.concurrency_tests` + `api.performance_tests` + `tests_requests`/`tests_transfer_regions`/`tests_matching_ranking`/`tests_add_student`/`tests_edit_student`/`tests_home_dashboard`/`tests_inventory`/`tests_students_performance`/`tests_bed_hierarchy`) | **207/207 passed** (`Ran 207 tests in 337.412s` — `OK`) |

No test failure encountered during this phase was left undiagnosed: the initial `TransferCreateAndApproveSequentialTests`/`TransferDoubleApprovalRaceTests` failures were traced to a missing `requested_by` field in the test's own POST payload (`TransferSerializer` requires it as a writable input field even though `perform_create()` also supplies it server-side — a pre-existing serializer/view contract, not something introduced or that needed changing) and a test-fixture that forgot to set the denormalized `Student.assigned_room` field after creating a `BedAssignment` directly via the ORM — both were test-code issues, fixed in the test file only, not production code.

---

## 12. Remaining Risks

- **G2-04 (residual)**: in scenarios where a `StudentRequest`/`Transfer` row-lock loser is rejected for a *different* reason than "already processed" (e.g., genuinely no bed available, independent of any race), the error message is correctly the specific one for that condition — no ambiguity remains from this phase's changes. No further action identified as necessary.
- **`_create_student_from_request_data()`'s inherent check-then-act shape** (§5) remains structurally a check-then-act pattern — this is intentional and safe (the DB constraint plus the new `IntegrityError` handling fully closes the risk), but is noted here for completeness: any future refactor of that function should preserve the caller's `IntegrityError` handling.
- **Other write paths not covered by this phase's locking changes** (e.g., `mark_inbox_viewed`/`processed`, `unassign_student_room`) retain the same low-severity, already-audited characteristics documented in the concurrency audit (G2-12) — deliberately not touched.
- **Bulk import endpoints** (`upload_excel`, `upload_additions_excel`) were noted in the audit as lower-priority (central-admin-only, rare/deliberate operations) and were not investigated further in this implementation phase, consistent with the audit's own scoping.

---

## 13. Items Intentionally NOT Changed

- **G2-12** (`mark_inbox_viewed`/`mark_inbox_processed`): confirmed idempotent and safe under concurrent use in both the audit and this phase's re-run (`RegionInboxDoubleMarkTests`, unchanged). No locking added — no new concrete evidence emerged requiring it.
- **G2-conn-leak**: `connections.close_all()` discipline in the thread-based test harness (`_run_concurrently()`) is retained exactly as documented in the audit. No background-processing redesign was attempted.
- **G2-load-scaling**: `CONN_MAX_AGE`, connection pooling, and WSGI/ASGI/deployment configuration were **not** touched, per explicit instruction — these remain real-environment concerns (§14).
- **Allocation algorithm and allocation-specific tests**: not read for correctness, not evaluated, not modified, anywhere in this phase.
- **Frontend/UI code**: not touched.
- **`Transfer` model/business semantics beyond the single invalid field reference**: no redesign, no new fields, no new endpoints.
- **The fast, unlocked pre-checks in `approve()`/`reject()`** (`if req.status != PENDING: return 400`, before the lock): deliberately left in place as a cheap fast-path for the common non-racing case, rather than removed in favor of the lock alone.

---

## 14. Real-Environment Validation Still Required

Unchanged from the audit's own conclusion, not re-litigated here:

- **Connection pooling / `CONN_MAX_AGE` / WSGI or ASGI production server configuration**: local `LiveServerTestCase` measurements (§9) are a useful *relative* signal (no pathological blocking from the new locks) but are not representative of production absolute performance. This remains a real-environment concern, explicitly out of scope for this work.
- **Production-scale simultaneous-user counts**: the 1/5/10/20 concurrency levels used here are a reasonable local approximation, not a measured production ceiling.
- **The Transfer endpoint's real-world usage**: this repository checkout has no frontend code to inspect, so whether `/api/transfers/` is actively used by the deployed frontend (vs. having been superseded by the newer `StudentRequest`-based region-transfer flow) could not be confirmed from this repo alone. The fix restores correct, tested functionality either way, but confirming real-world usage would help prioritize any further Transfer-related work.
- **Real Postgres row-lock contention at production data volumes and traffic patterns**: local testing used a modest, realistic dataset (matching the fixture scale established by the prior performance work); the new locks' behavior under genuinely high production concurrency has not been (and cannot safely be) measured locally at that scale.

---

## 15. Final Status

**PASSED.**

Both confirmed P1 concurrency findings (G2-01, G2-02) are fixed and dynamically verified via true regression tests that hard-fail on regression (not just observational tests). The higher-severity, out-of-original-scope `Transfer.movement_type` bug that blocked the equivalent Transfer-side verification was resolved with a minimal, surgical, non-redesigning fix, which then allowed the identical locking pattern to be applied to and verified on `TransferViewSet` as well. All previously-confirmed-working concurrency protections (`assign_student_to_room()`'s apartment lock, bed-contention behavior, multi-region independence, swap locking, building/apartment locking, DB unique constraints) were re-run and remain intact. Load measurements show no regression attributable to the new locking. The permanent regression suite (`api/concurrency_tests/`) now covers every scenario the task's minimum-coverage list (A–H) required, at 17 tests, all passing. `manage.py check` is clean.

No allocation code was modified. No frontend or deployment configuration was modified.
