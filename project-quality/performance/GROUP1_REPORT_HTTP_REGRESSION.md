# Group 1 — Final Verification: Excel Report HTTP Regression Tests

**Scope:** final targeted verification closing out Group 1 — Backend
Performance & Efficiency. Adds HTTP-level regression tests for the Excel
report/export endpoints so that a runtime failure like the
`NameError: name 'HttpResponse' is not defined` bug (found via manual smoke
testing, fixed by adding `from django.http import HttpResponse` to
`backend/api/views.py`) cannot silently reach production again.

**Did NOT touch:** the allocation algorithm, allocation-specific tests,
frontend code, or deployment configuration. Nothing was committed, pushed,
or merged. Only the local disposable Postgres test database
(`ENV_FILE=.env.test`) was used at any point.

---

## 1. Root Cause Recap

`_excel_response()` (`backend/api/views.py`) builds the HTTP response
wrapper (`HttpResponse(...)` + `Content-Disposition` header) shared by
every Excel report endpoint. `HttpResponse` was used but never imported
anywhere in the file. The pre-existing report tests
(`api/performance_tests/test_reports_performance.py`) call the report
**generator** functions directly (`generate_capacity_report()`,
`generate_manual_review_report()`, ...) — which return an in-memory
`BytesIO` buffer and never touch `_excel_response()` — so the one place the
bug lived was never exercised by any automated test. This gap is exactly
what this module closes.

## 2. Endpoints Tested

Determined by grepping `backend/api/views.py` for every call site of
`_excel_response()` (5 call sites, 5 enclosing view functions), then
cross-referencing `backend/api/urls.py` for the actual routed paths — not
guessed:

| View function | Permission | URL |
|---|---|---|
| `dormify_report` | `IsAuthenticated, IsCentralAdmin` | `GET /api/reports/dormify-report/` |
| `student_allocation_report` (legacy alias) | `IsAuthenticated` | `GET /api/reports/student-allocation-report/` |
| `student_actions_report` | `IsAuthenticated` | `GET /api/reports/student-actions-report/` |
| `capacity_report` | `IsAuthenticated` | `GET /api/reports/capacity-report/` |
| `manual_review_report` | `IsAuthenticated` | `GET /api/reports/manual-review-report/` |

All 5 of the endpoints that use `_excel_response()` are covered — this is
the complete set (confirmed via `Grep` for `_excel_response(` across
`backend/api/`, 5 usages, 5 distinct enclosing views, no others found).

## 3. Authentication / Roles Used

- `g1-http-admin@test.com` — `User.Role.CENTRAL_ADMIN` (required for
  `dormify_report`, which is central-admin-only; also used for
  `capacity_report`).
- `g1-http-boss@test.com` — `User.Role.REGION_BOSS`, scoped to the test
  region (used for `student_allocation_report`, `student_actions_report`,
  `manual_review_report` — exercising the region-scoped `IsAuthenticated`
  path with a non-central-admin role, and used again to confirm
  `dormify_report` correctly **rejects** a non-central-admin caller).

Minimum local test data: one region, one dorm type, one building →
apartment → room with 2 beds, one student with an active bed assignment,
and one unassigned student — just enough for every report generator to run
its normal (non-empty) code path.

All requests go through `rest_framework.test.APIClient` with
`force_authenticate()`, hitting the real Django URL router → permission
classes → view function → `_excel_response()` → HTTP response, exactly the
production request path. `_excel_response()`, the workbook-generation
helpers, and the report generator functions were never called directly in
this module.

## 4. What Each Assertion Verifies

`_assert_valid_excel_response()` (shared helper, called once per endpoint)
checks, per the task's minimum requirements:

1. **`resp.status_code == 200`** — the request completed successfully
   (this alone is what would have failed with the missing import: a
   `NameError` inside `_excel_response()` propagates as an unhandled
   exception, not a clean error response — see §6).
2. **`len(resp.content) > 0`** — the response body is not empty.
3. **`Content-Type == 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'`**
   — the correct MIME type for an `.xlsx` workbook.
4. **`Content-Disposition` contains `attachment` and a `filename="....xlsx"`**
   (via regex) — the response is a genuine download, not an inline
   payload, with a properly named `.xlsx` file.
5. **`openpyxl.load_workbook(BytesIO(resp.content))` succeeds and the
   workbook has at least one sheet** — proves the bytes are a real,
   readable Excel workbook, not merely non-empty/arbitrary bytes.

Two endpoints (`dormify_report`, `student_actions_report`,
`capacity_report`, `manual_review_report`) additionally assert one
expected sheet name is present (`'סיכום'`, `'תמצית סטודנטים'`, `'תפוסה לפי
חדרים'`, `'תמצית חריגים'`) as a light content sanity check — full content
correctness for these reports is already covered by
`test_reports_performance.py` and is intentionally not re-derived here.

`test_dormify_report_http_rejects_non_central_admin` additionally verifies
the real HTTP permission path: a `REGION_BOSS` calling the central-admin-only
endpoint gets `403`, not a report.

`test_all_report_endpoints_return_valid_xlsx` re-runs all 5 endpoints in
one parametrized sweep (`subTest` per endpoint) as a single, easy-to-read
pass/fail signal for the whole set.

## 5. Test Results

New file: `backend/api/performance_tests/test_report_http_regression.py`.

```
Ran 7 tests in 11.075s
OK
```

All 7 tests passed:
- `test_dormify_report_http_returns_valid_xlsx`
- `test_dormify_report_http_rejects_non_central_admin`
- `test_student_allocation_report_http_returns_valid_xlsx`
- `test_student_actions_report_http_returns_valid_xlsx`
- `test_capacity_report_http_returns_valid_xlsx`
- `test_manual_review_report_http_returns_valid_xlsx`
- `test_all_report_endpoints_return_valid_xlsx` (all 5 endpoints, one sweep)

Existing, related report tests re-run alongside for safety:

```
api.performance_tests.test_report_http_regression + api.performance_tests.test_reports_performance
Ran 10 tests in 14.257s
OK
```

`python manage.py check`:

```
System check identified no issues (0 silenced).
```

## 6. Proof These Tests Would Have Failed Before the Fix

The `from django.http import HttpResponse` import was temporarily removed
from `backend/api/views.py` and the new suite re-run:

```
ERROR: test_student_allocation_report_http_returns_valid_xlsx
...
  File "backend\api\views.py", line 11056, in student_allocation_report
    return _excel_response(...)
  File "backend\api\views.py", line 10960, in _excel_response
    response = HttpResponse(
               ^^^^^^^^^^^^
NameError: name 'HttpResponse' is not defined
----------------------------------------------------------------------
Ran 7 tests in 11.787s

FAILED (errors=10)
```

All 7 tests failed (10 errors, counting the `subTest` failures inside
`test_all_report_endpoints_return_valid_xlsx`), each with the exact
`NameError: name 'HttpResponse' is not defined` traceback pointing at
`_excel_response()` — the identical failure manual smoke testing found.
Django's test client re-raises unhandled view exceptions by default, so
this isn't a soft assertion failure the suite could quietly tolerate — the
request itself errors out. The import was then restored and the full
suite re-confirmed green (§5). This satisfies the requirement that these
tests would have caught the original bug.

## 7. Additional Bugs Found

**None.** All 5 endpoints, exercised through the real HTTP path with both
`CENTRAL_ADMIN` and `REGION_BOSS` roles, returned correct, valid,
non-empty `.xlsx` workbooks with correct headers, and the
central-admin-only permission check on `dormify_report` correctly rejected
a non-admin caller. No production-code changes beyond the previously
applied `HttpResponse` import were necessary.

## 8. Production Code Changes Made (this task)

**None.** The `HttpResponse` import fix was already applied in a prior
task; this task only added the missing test coverage
(`backend/api/performance_tests/test_report_http_regression.py`) and this
report. (The import was briefly, deliberately removed and restored purely
to generate the before/after proof in §6 — the working tree ends in the
same state it started in, fix included.)

## 9. Final Conclusion

The Excel report HTTP path (`dormify_report`, `student_allocation_report`,
`student_actions_report`, `capacity_report`, `manual_review_report` — all
5 endpoints that route through `_excel_response()`) is now protected by
automated regression tests that exercise the real Django/DRF HTTP request
path end-to-end (routing → permissions → view → `_excel_response()` →
response), independently of the existing report-content tests that call
the generator functions directly. These tests were empirically proven to
fail with the exact original bug and pass with the fix in place.

**FINAL GROUP 1 VERIFICATION: PASSED.**
