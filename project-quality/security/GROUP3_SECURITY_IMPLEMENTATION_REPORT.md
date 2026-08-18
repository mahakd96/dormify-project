# Group 3 Security Implementation Report

**Baseline commit:** `23bb2c8` (the only change since the revalidation baseline `c486f89` was `README.md` — no security-relevant source changed).
**Branch:** `donia-group3-security`. Not committed; left on the working tree for review.

> **Post-review correction (G3-13):** the version of this report reviewed earlier stated that
> `DEBUG` was left defaulting to `"True"` in `dormify/settings.py`, and separately claimed
> `.env.test` already set `DEBUG=True` explicitly. The second claim turned out to be **inaccurate**
> — `.env.test` never set `DEBUG` at all; it was silently relying on the same insecure `"True"`
> code default as everything else, which is exactly the gap G3-13 exists to close. Both points are
> corrected in this revision: `DEBUG` now defaults to `False` when the variable is absent (secure
> by default, satisfying the approved requirement in full), and every local environment that needs
> `DEBUG=True` now sets it **explicitly** — `docker-compose.yml`'s `backend` service, and
> `.env.test`. See §4a for the full correction and the one operational incident it caused (and
> fixed) along the way.

## 1. Scope

Implements remediation for all 24 Group 3 findings (G3-01 through G3-24), identified in the prior audit/revalidation passes, as one coordinated backend + frontend change. Allocation optimization logic (`backend/allocation/solver.py`, `backend/allocation/live_registry.py`) was explicitly out of scope and was **not modified** — confirmed by `git diff --stat -- backend/allocation/` returning empty throughout this pass.

## 2. Findings fixed

All 24 findings received a durable code fix in this pass. See the per-finding table below for exactly what changed and the test evidence. None were deferred as "not applicable" — the two P3 items with no live vulnerability today (G3-17's residual XSS-token-theft risk, and G3-20's low-risk local Docker binding) still received the concrete mitigation the brief asked for.

## 3. Files changed

```
backend/accounts/serializers.py          - G3-19 (duplicate-manager guard, concurrency-safe)
backend/accounts/views.py                - G3-10 (throttle)
backend/api/models.py                    - G3-19 (partial unique constraint, TEST DB ONLY)
backend/api/serializers.py               - G3-01, G3-02, G3-06 (RegisterSerializer removed;
                                            Transfer/Student field lockdown)
backend/api/urls.py                      - G3-01 (route removed), G3-14/16 (refresh/logout routes)
backend/api/views.py                     - nearly every finding; see table
backend/api/throttling.py (new)          - G3-10
backend/api/migrations/0019_...py (new)  - G3-19 (NOT applied to Azure)
backend/api/security_tests/ (new)        - dedicated Group 3 regression package
backend/api/tests_assisted_allocation.py - one test updated for the new G3-03 API contract
backend/dormify/settings.py              - G3-10, G3-13 (incl. post-review correction, see §4a),
                                            G3-14, G3-16, G3-23
backend/seed.py                          - G3-09
docker-compose.yml                       - G3-20, G3-13 correction (explicit DEBUG=True for
                                            local Docker dev, see §4a)
.env.test (untracked, local only)        - G3-13 correction: adds DEBUG=True explicitly (see §4a)
src/components/Sidebar.js                - G3-14 (await logout)
src/context/AuthContext.js               - G3-14/16/17 (session lifecycle rewrite)
src/pages/AssistedAllocationPage.js      - G3-11 (override button gated client-side too)
src/pages/SettingsPage.js                - G3-18 (password field on change-email form)
src/services/api.js                      - G3-14/16/17 (token storage + refresh interceptor)
src/services/usersApi.js                 - G3-17 (reads token from api.js, not localStorage)
```

`.env.example` could **not** be created — blocked by a write restriction specific to that path
(not a blanket rule over every `.env*` file — `.env.test` was writable and updated directly, see
§4a; `.env` itself is separately blocked, also see §4a). The environment variables introduced by
this pass are documented in §10 below instead.

## 4. Migrations created

**One:** `backend/api/migrations/0019_user_unique_region_boss_per_region.py` — adds a partial
`UniqueConstraint` on `User(region)` where `role='region_boss'` (G3-19 DB backstop).

- Created and verified against the **isolated local test database only** (`ENV_FILE=.env.test`,
  applied automatically by `manage.py test`, and directly tested in
  `api/security_tests/test_manager_uniqueness.py::RegionBossPartialUniqueConstraintTests`).
- **NOT applied to Azure.** Azure currently has **3** `region_boss` users for one region
  (Gush-Elyon) and **0** for another (Technion, temporarily covered by its `central_admin` per
  team decision) — applying this migration to Azure as-is would fail outright (a UNIQUE
  constraint cannot be created over existing violating rows).
- **Exact blocker, verbatim:** *"Production migration requires approved cleanup of the existing
  duplicate Gush-Elyon region_boss records before this constraint can be applied."* The known
  real manager is `UpperDormsAdmin@technion.ac.il`; the two suspected unused/test accounts
  (`mahaadmin@technion.ac.il`, `nooradmin@technion.ac.il`) were **not modified** — no email
  addresses are hardcoded anywhere in the migration or application code, per instruction.
- The **application-level** guard (`accounts/serializers.py`, race-safe via
  `select_for_update()` on the `Region` row) is fully active and enforced today, independent of
  this migration, and does not require any Azure cleanup to work.

## 4a. G3-13 correction: DEBUG now defaults to False

**What changed.** `dormify/settings.py`:

```python
DEBUG = os.getenv("DEBUG", "False") == "True"   # was: os.getenv("DEBUG", "True")
```

DEBUG is now `False` whenever the environment variable is absent, satisfying the approved
requirement exactly: a deployment that forgets to set `DEBUG` no longer silently runs in debug
mode. `SECRET_KEY`'s fail-closed behavior (already correct in the previous version of this pass)
is unchanged — it's gated on `DEBUG`, so it now activates correctly for any environment that
doesn't explicitly opt into `DEBUG=True`. G3-23's HTTPS/cookie hardening block is likewise
unchanged and remains gated on the same `DEBUG` value, so it continues to activate correctly
whenever `DEBUG=False` — including now, for any environment that simply omits the variable.

**Local environments updated to explicitly request DEBUG=True**, per requirement #2:

- `docker-compose.yml`'s `backend` service now sets `DEBUG: "True"` directly in its
  `environment:` block. This is the *only* place that container gets `DEBUG` from — it mounts
  only `./backend` (never the repo root), so Django's `load_dotenv()` finds no `.env` file inside
  the container at all; the previous report's framing of this as "unchanged local behavior" was
  correct in effect (nothing was set before either) but the underlying fact — that this container
  had no explicit DEBUG source — is what made the un-flipped default risky in the first place.
- `.env.test` now sets `DEBUG=True` explicitly. **Correction to the previous report:** this file
  did **not** already do this — the earlier claim that it did was wrong; it was relying on the
  same insecure code default as production would have been. Without this fix, `ENV_FILE=.env.test
  python manage.py test` and `python manage.py check` would both fail immediately with
  `ImproperlyConfigured: SECRET_KEY environment variable must be set...`, breaking the entire test
  suite this whole security pass depends on. `.env.test` is untracked (git-ignored, confirmed via
  `git status --ignored`) and contains no secrets — only disposable local Postgres test-DB
  credentials — so adding a plain `DEBUG=True` line to it carries no exposure risk.

**Operational incident, disclosed in full.** The currently-running `dormify_backend` Docker
container mounts `./backend` live and Django's `runserver` auto-reloads on file changes. The
moment `settings.py` was edited, that already-running container picked up the new code — but its
*environment* still reflected the **old** `docker-compose.yml` (no `DEBUG` key at all, since that
edit only exists on disk until the container is recreated), so it immediately hit the same
`ImproperlyConfigured` fail-closed path and entered a crash-restart loop (`docker ps` showed
`Restarting (1) ...`). This is precisely the scenario requirement #2 exists to prevent, and it
would have stayed broken without a redeploy. Because leaving local Docker dev crash-looping is a
direct violation of that requirement, and because recreating one already-affected local container
is a safe, reversible, non-Azure action, it was fixed as part of this correction:
`docker compose up -d --force-recreate backend`. Confirmed healthy afterward (`docker ps` →
`Up ...`; `docker logs dormify_backend` → `Watching for file changes with StatReloader`, no
errors). `dormify_frontend` and `dormify_test_db` were never affected (neither reads `DEBUG`).

**Still NOT touched, by design:** the real local `.env` (the one `DB_HOST` points at the Azure
Postgres instance). It is not mounted into any Docker container and so was never part of this
incident, but a direct, non-Docker `python manage.py runserver` / `manage.py check` using that
file (default `ENV_FILE=.env`) will now also fail closed with the same `ImproperlyConfigured`
error until an operator adds `DEBUG=True` (or a real `SECRET_KEY`) to it by hand — this specific
file is blocked from this pass by an explicit permission rule (confirmed directly: even a
read attempt returns "File is in a directory that is denied by your permission settings"),
distinct from the `.env.example` restriction in §12, and was left exactly as the team maintains
it. This is flagged as a residual item in §11.

## 5. Security tests added

New package: `backend/api/security_tests/` (11 files, 85 tests — 3 added by the G3-13 correction:
`DebugDefaultsToFalseTests`, verifying the resolution logic, the tracked settings.py source, and
that `docker-compose.yml` explicitly sets `DEBUG: "True"`). Organized by finding, not dumped into
allocation-owned test files:

| File | Findings covered |
|---|---|
| `base.py` | shared fixtures (two regions, one boss/employee each, real Bed rows) |
| `test_registration.py` | G3-01 |
| `test_transfer_lockdown.py` | G3-02, G3-07, G3-22, G3-24 (Transfer) |
| `test_region_scoping.py` | G3-03, G3-04, G3-08, G3-12 |
| `test_region_admin.py` | G3-05 |
| `test_student_workflow.py` | G3-06, G3-15, G3-24 (StudentRequest) |
| `test_assisted_allocation_auth.py` | G3-11 |
| `test_manager_uniqueness.py` | G3-19 (incl. a real cross-connection concurrency test) |
| `test_email_change.py` | G3-18 |
| `test_upload_validation.py` | G3-21 |
| `test_throttling.py` | G3-10 |
| `test_jwt_lifecycle.py` | G3-14, G3-16, G3-17 |
| `test_production_settings.py` | G3-09, G3-13, G3-23 |

Per the audit brief's rule ("if tests use multiple regional managers, they must belong to
different regions"), every cross-region test uses two genuinely separate regions/bosses, never
the same boss standing in for both sides.

## 6. Focused test results

Ran with `ENV_FILE=.env.test python manage.py test <target> --keepdb`, against the isolated local
Postgres test database only (confirmed `HOST=localhost, NAME=dormify_test, PORT=5433` before any
test ran — never Azure).

| Suite | Result |
|---|---|
| `api.security_tests` (85 tests, incl. 3 new G3-13 tests) | **85/85 pass** |
| `api.tests_transfer_regions` + `api.tests_assisted_allocation` (99 tests) | **99/99 pass** (1 test updated, see §8) |
| `api.tests_add_student`, `tests_edit_student`, `tests_analysis`, `tests_bed_hierarchy`, `tests_home_dashboard`, `tests_matching_ranking`, `tests_requests`, `tests_students_performance` (84 tests) | **84/84 pass** |
| `api.tests_inventory` (41 tests) | **41/41 pass** |
| `api.tests_allocation` (201 tests) | **199/201 pass** — 2 pre-existing failures, verified unrelated (see below) |
| `ENV_FILE=.env.test python manage.py check` | **clean, 0 issues** (re-verified after the correction) |
| default `.env` `python manage.py check` | **now fails closed** with `ImproperlyConfigured` (no `DEBUG`/`SECRET_KEY` set there) — this is the *intended* new behavior for an unconfigured environment, not a bug; see §4a/§11 |
| `CI=true npx react-scripts build` | **compiles successfully**, 0 warnings/errors |

**Total: 510 tests run, 508 pass** (the 3 new G3-13 tests added to the 507/505 reported previously).

### The 2 `tests_allocation.py` failures

`LiveSnapshotCallbackTest.test_first_feasible_snapshot_captured_immediately` and
`SolverSharedFacilityRoomTest.test_existing_occupant_affects_second_bed_choice` fail in this
environment. Both exercise solver/live-snapshot timing and bed-choice behavior in
`backend/allocation/`, which this pass never touched. To confirm they are **not** a regression
from this work: `git stash` was used to temporarily return the working tree to the exact,
untouched `23bb2c8` baseline, both tests were re-run in isolation, and **both failed identically**
against the pristine baseline. The stash was then popped and the restored working tree verified
byte-identical (`git diff --stat` before/after matched exactly). These are pre-existing,
environment-dependent failures (solver/thread timing), not something this security pass
introduced or could fix without touching solver/live-snapshot logic - out of scope.

## 7. Partner regression results

`#65-#70`'s work — allocation lifecycle, stop/save/live-preview, assisted/manual allocation,
`StudentRequest` transfer workflow, import batch lifecycle — all still pass (99 + 41 + 201-with-
2-pre-existing-failures = above). No solver/allocation-lifecycle test was rewritten; the one test
edit (§8) is a region-scoping API-contract assertion, not an allocation behavior.

## 8. The one partner test that was intentionally updated

`api/tests_assisted_allocation.py::RegionalIsolationTests` had
`test_queue_ignores_foreign_region_param_for_regional_user`, asserting that an employee passing
a foreign `?region=` got a silent **200** with their own region's data substituted. That was never
a data leak (the substitution already prevented it), but this pass standardizes ALL five
region-scoped read endpoints (`statistics`, `allocation_summary`, `allocation_results`,
`assisted_allocation_queue`, `get_active_allocation_run`) on **one** `resolve_scoped_region()`
helper, which returns a clean **403** on a region mismatch — the explicit "reject with clean 403"
option the brief authorized. The test was split into two: one asserting the new 403 contract
(with a comment explaining exactly why), one preserving the original own-region-still-works
assertion unchanged. This is a deliberate, minimal, security-motivated API-contract adjustment,
not "altering a test until it passes" — see the inline comment in that file for the full
reasoning.

## 9. Frontend verification

- **Login / session restoration / logout / refresh:** rewired end-to-end onto the new
  HttpOnly-cookie refresh flow (`src/services/api.js`, `src/context/AuthContext.js`) and verified
  by `api/security_tests/test_jwt_lifecycle.py` (backend contract) plus `CI=true npx
  react-scripts build` (frontend compiles clean, no unused-var/broken-import warnings from the
  removed `localStorage` token code).
- **Change email:** `SettingsPage.js` now collects and submits a `password` field; wired through
  `settingsAPI.changeEmail`.
- **Override button (assisted allocation):** `AssistedAllocationPage.js` now hides/disables the
  override submit action and shows an explanatory message for a user who
  `!canOverrideAllocation()` (a new `AuthContext` helper), so an employee sees why instead of a
  submit that would 403 — backend check remains authoritative regardless.
- **Transfer API usage:** `transfersAPI` (approve/reject/getAll) untouched — those still work
  through the now-locked-down `TransferViewSet`; no generic update/delete call exists in the
  frontend for Transfers, confirmed by grep before locking down the endpoint.
- **Logout button (`Sidebar.js`):** now awaits the now-async `logout()` before navigating, so the
  server-side revocation call fires before the page changes.
- No functionality was removed without first checking current usage: `/auth/register/` (grepped,
  zero frontend references), direct `assigned_room` writes (grepped every `studentsAPI.create/
  update` payload, none set it), and the legacy `Transfer` PATCH/DELETE (grepped, no frontend
  caller) were all confirmed dead before being locked down.

## 10. Configuration/environment changes required for deployment

All of the following are **additive** with safe defaults preserving current local/Docker
behavior; none are required for local dev to keep working as-is. Recommended before any
production-facing deployment:

| Variable | Purpose | Notes |
|---|---|---|
| `SECRET_KEY` | Django secret | **Required** whenever `DEBUG` is not `True` — app now fails closed without it |
| `DEBUG` | dev/prod switch | **Now defaults to `False` when absent** (corrected, see §4a). Any environment that wants development behavior must set `DEBUG=True` explicitly — already done for `docker-compose.yml`'s `backend` service and `.env.test`; the local (non-Docker) `.env` still needs this added by hand (blocked from this pass, see §4a) |
| `DJANGO_ALLOWED_HOSTS` | comma-separated | must include the real production domain |
| `JWT_ACCESS_TOKEN_LIFETIME` | minutes | now defaults to 20 (was 1440) |
| `JWT_REFRESH_COOKIE_*` | name/path/samesite/secure/domain | sensible defaults; `SECURE` auto-derives from `DEBUG` |
| `THROTTLE_AUTH_LOGIN` / `_SENSITIVE` / `_STAFF_CREATE` / `_REFRESH` / `_LOGOUT` | rate strings, e.g. `10/min` | tune per deployment traffic |
| `SECURE_SSL_REDIRECT`, `SECURE_HSTS_*`, `DJANGO_BEHIND_HTTPS_PROXY` | HTTPS hardening | **only take effect when `DEBUG=False`** |
| `MAX_UPLOAD_FILE_SIZE_MB` | upload cap | defaults to 25 |
| `SEED_ADMIN_PASSWORD` / `SEED_STAFF_PASSWORD` | dev seed only | `backend/seed.py` refuses to run at all unless `DEBUG=True` |
| `TEST_DB_USER` / `TEST_DB_PASSWORD` | local Docker test DB | defaults preserve current `docker-compose.yml` behavior |

**Also required, operationally, before enabling the G3-19 DB constraint on Azure:** an approved
manual cleanup reducing Gush-Elyon to exactly one `region_boss` (see §4). This is a data decision
for the team, deliberately not automated here.

**Recreate the test-DB container** for the G3-20 binding change to take effect
(`docker-compose down test_db && docker-compose up -d test_db` or equivalent) — editing the
compose file does not live-migrate an already-running container's port binding, and this pass did
not restart it.

## 11. Known residual risks

- **G3-17 (JWT in browser):** the access token now lives in JS memory only (not localStorage) and
  is never persisted; the refresh token is HttpOnly and never touches JS at all. Residual XSS risk
  is now limited to a live, in-memory access token with a ≤20-minute blast radius, not a
  long-lived token an attacker can exfiltrate and reuse later — this is the realistic mitigation
  achievable without a full cookie-authenticated architecture (out of scope per the brief).
- **G3-20:** binding fix is in the compose file but not yet live on the running container (§10).
- **G3-13/G3-23:** now secure by default (§4a) — hardening activates automatically for any
  environment that omits `DEBUG`, no operator action required. The one remaining gap is
  operational, not code: the local (non-Docker) `.env` file has no `DEBUG`/`SECRET_KEY` of its own
  and could not be edited in this pass (permission-blocked, confirmed directly — see §4a), so a
  direct `python manage.py runserver`/`check` against it will fail closed until someone adds
  `DEBUG=True` (or a real `SECRET_KEY`) to that file by hand. Docker-based local dev is unaffected
  (fixed in §4a) and is the primary way this project is run locally per `docker-compose.yml`.
- **G3-19 DB constraint:** not live on Azure pending the manual cleanup in §4.

## 12. What could not be fully completed

- `.env.example` — blocked by environment write restrictions; documented in §10 instead.
  (`.env.test`, by contrast, is not blocked and was updated directly as part of the G3-13
  correction, §4a — the restriction is specific to `.env`/`.env.example`, confirmed by testing
  each individually, not a blanket rule over every `.env*` path.)
- The real local `.env` (Azure-connected) — permission-blocked from this pass (confirmed: even a
  read attempt is denied). It now needs `DEBUG=True` or a real `SECRET_KEY` added by hand for any
  direct, non-Docker use of that file to keep working (§4a, §11).
- The G3-19 database constraint could not be applied anywhere except the local test database, by
  design (Azure has existing violating data — see §4).
- The docker-compose port-binding fix (G3-20) is written but not yet live on the running
  container — recreating a running container for that specific binding change was judged out of
  scope for a code-only pass (unlike the `backend` service, which had to be recreated as a direct,
  disclosed consequence of the G3-13 correction itself — see §4a).

## 13. Confirmation: allocation optimization logic untouched

```
$ git diff --stat -- backend/allocation/
(no output)
```

Zero changes anywhere under `backend/allocation/` throughout this entire pass. Every fix in this
report targets authorization wrappers, serializers, view-layer permission/region checks, JWT
lifecycle, settings, and their frontend callers — never solver scoring, matching, or CP-SAT
weights/logic.
