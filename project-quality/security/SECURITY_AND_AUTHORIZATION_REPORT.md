# Security and Authorization Implementation Report

**Baseline commit:** `23bb2c8` (the only change since the prior audit/revalidation baseline `c486f89` was `README.md` — no security-relevant source changed).

> **Status: Implemented and deployed.** This work was merged and has since completed its full
> production closeout, including the Azure database migration that §4 below originally left
> blocked. See **§14 "Production Closeout"** at the end of this report for what happened after
> deployment. Everything above that section is preserved as the historical record of the
> implementation and review pass that led up to it — read it as "at the time this was written,"
> not as the current state of Azure.

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

Implements remediation for all 24 findings (G3-01 through G3-24) identified in the prior audit/revalidation passes, as one coordinated backend + frontend change. Allocation optimization logic (`backend/allocation/solver.py`, `backend/allocation/live_registry.py`) was explicitly out of scope and was **not modified** — confirmed by `git diff --stat -- backend/allocation/` returning empty throughout this pass.

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
backend/api/migrations/0019_...py (new)  - G3-19 (not applied to Azure at the time this was
                                            written - since applied after cleanup, see §14)
backend/api/security_tests/ (new)        - dedicated security regression package
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

`.env.example` was not updated to include the new environment variables introduced by this pass;
`.env.test` was updated directly instead (see §4a). The environment variables introduced by
this pass are documented in §10 below.

## 4. Migrations created

**One:** `backend/api/migrations/0019_user_unique_region_boss_per_region.py` — adds a partial
`UniqueConstraint` on `User(region)` where `role='region_boss'` (G3-19 DB backstop).

> **Update:** the paragraphs immediately below describe the state **at the time this section was
> originally written** (i.e., before this work was deployed) and are kept as the historical record of why
> the migration wasn't applied yet at that point. That blocker has since been resolved — see
> **§14 "Production Closeout"** for the actual cleanup and migration application that happened
> afterward. Do not read the "NOT applied to Azure" statement below as the current state.

- Created and verified against the **isolated local test database only** (`ENV_FILE=.env.test`,
  applied automatically by `manage.py test`, and directly tested in
  `api/security_tests/test_manager_uniqueness.py::RegionBossPartialUniqueConstraintTests`).
- **NOT applied to Azure at the time of writing.** Azure at that point had **3** `region_boss`
  users for one region (Gush-Elyon) and **0** for another (Technion, temporarily covered by its
  `central_admin` per team decision) — applying this migration to Azure as-is would have failed
  outright (a UNIQUE constraint cannot be created over existing violating rows).
- **Exact blocker as originally stated, verbatim:** *"Production migration requires approved
  cleanup of the existing duplicate Gush-Elyon region_boss records before this constraint can be
  applied."* The known real manager was `regional.manager@example.edu`; the two suspected
  unused/test accounts (`legacy.manager1@example.edu`, `legacy.manager2@example.edu`) were **not
  modified** as part of this implementation pass — no email addresses were hardcoded anywhere in
  the migration or application code. (This cleanup was subsequently carried out
  manually, outside application code — see §14.)
- The **application-level** guard (`accounts/serializers.py`, race-safe via
  `select_for_update()` on the `Region` row) was fully active and enforced independently of this
  migration from the moment this pass was implemented, and never required any Azure cleanup to
  work. It remains active today alongside the now-applied database constraint.

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
file was not modified as part of this pass and was left exactly as previously configured. This is
flagged as a residual item in §11.

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

## 7. Regression Results for Prior Work

Prior work on allocation lifecycle, stop/save/live-preview, assisted/manual allocation,
`StudentRequest` transfer workflow, import batch lifecycle — all still pass (99 + 41 + 201-with-
2-pre-existing-failures = above). No solver/allocation-lifecycle test was rewritten; the one test
edit (§8) is a region-scoping API-contract assertion, not an allocation behavior.

## 8. The one existing test that was intentionally updated

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

**Previously required, operationally, before enabling the G3-19 DB constraint on Azure:** an
approved manual cleanup reducing Gush-Elyon to exactly one `region_boss` (see §4). This was a data
decision for the team, deliberately not automated by this implementation pass — **it has since
been completed and the constraint is now live on Azure; see §14.**

**Recreating the test-DB container** was previously listed here as still required for the G3-20
binding change to take effect (editing the compose file alone does not live-migrate an
already-running container's port binding). **This has since been done — see §14.**

## 11. Known residual risks

- **G3-17 (JWT in browser):** the access token now lives in JS memory only (not localStorage) and
  is never persisted; the refresh token is HttpOnly and never touches JS at all. Residual XSS risk
  is now limited to a live, in-memory access token with a ≤20-minute blast radius, not a
  long-lived token an attacker can exfiltrate and reuse later — this is the realistic mitigation
  achievable without a full cookie-authenticated architecture (out of scope per the brief).
- **G3-20:** ~~binding fix is in the compose file but not yet live on the running container~~ —
  **resolved**, the `test_db` container was recreated and its localhost-only binding verified
  live; see §14.
- **G3-13/G3-23:** now secure by default (§4a) — hardening activates automatically for any
  environment that omits `DEBUG`, no operator action required. The one remaining gap is
  operational, not code: the local (non-Docker) `.env` file has no `DEBUG`/`SECRET_KEY` of its own
  and was not edited as part of this pass (see §4a), so a
  direct `python manage.py runserver`/`check` against it will fail closed until someone adds
  `DEBUG=True` (or a real `SECRET_KEY`) to that file by hand. Docker-based local dev is unaffected
  (fixed in §4a) and is the primary way this project is run locally per `docker-compose.yml`.
- **G3-19 DB constraint:** ~~not live on Azure pending the manual cleanup in §4~~ — **resolved**,
  the cleanup was completed and the constraint applied to Azure after this work was deployed; see §14. The
  constraint guarantees *at most one* `region_boss` per region, not "exactly one" — the no-zero-
  managers side of that guarantee remains the application-level guard's responsibility (§4), not
  something a database constraint alone can express.

## 12. What could not be fully completed

- `.env.example` — not updated as part of this pass; the new variables are documented in §10 instead.
  (`.env.test`, by contrast, was updated directly as part of the G3-13 correction, §4a.)
- The real local `.env` (Azure-connected) — not modified as part of this pass. It now needs
  `DEBUG=True` or a real `SECRET_KEY` added by hand for any direct, non-Docker use of that file to
  keep working (§4a, §11).
- ~~The G3-19 database constraint could not be applied anywhere except the local test database, by
  design (Azure has existing violating data — see §4).~~ **Resolved after this work was deployed** — the
  violating data was cleaned up manually and the constraint is now applied to Azure;
  see §14. This bullet is kept struck through, rather than deleted, as part of the historical
  record of what this implementation pass itself could and couldn't do.
- ~~The docker-compose port-binding fix (G3-20) is written but not yet live on the running
  container — recreating a running container for that specific binding change was judged out of
  scope for a code-only pass (unlike the `backend` service, which had to be recreated as a direct,
  disclosed consequence of the G3-13 correction itself).~~ **Resolved** — the `test_db` container
  was subsequently recreated and its binding verified; see §14. Kept struck through as part of the
  historical record of what this implementation pass itself did and didn't cover.

## 13. Confirmation: allocation optimization logic untouched

```
$ git diff --stat -- backend/allocation/
(no output)
```

Zero changes anywhere under `backend/allocation/` throughout this entire pass. Every fix in this
report targets authorization wrappers, serializers, view-layer permission/region checks, JWT
lifecycle, settings, and their frontend callers — never solver scoring, matching, or CP-SAT
weights/logic.

## 14. Production Closeout

Everything above this section documents the implementation and review pass that led up to the
merge. This section documents what happened **after** that merge, closing out the two items
(G3-19 in §4/§10/§11/§12, and G3-20 in §10/§11/§12) that were explicitly left as operational
follow-ups rather than something this pass could resolve itself.

**1. Merge.** This work was merged into the main codebase.

**2. `token_blacklist` migrations applied to Azure.** The `rest_framework_simplejwt.token_blacklist`
app's own migrations (enabling G3-14's server-side refresh-token revocation) were applied
successfully to the Azure database.

**3. Gush-Elyon duplicate-manager cleanup, completed manually and safely, before touching
`0019`.** With the migration order deliberately cleanup-first:
   - `legacy.manager1@example.edu` was removed.
   - `legacy.manager2@example.edu` was removed.
   - `regional.manager@example.edu` remains — the sole Gush-Elyon regional manager.

**4. Read-only verification, after cleanup.** Confirmed on Azure:
   - No remaining accounts with either removed email address.
   - Gush-Elyon has exactly one active `region_boss`.
   - No region, anywhere, has duplicate `region_boss` users.

**5. Migration plan checked before applying.** `showmigrations`/plan output for
`api.0019_user_unique_region_boss_per_region` showed only that one migration pending — nothing
else queued alongside it.

**6. `api.0019_user_unique_region_boss_per_region` applied to Azure.** Applied successfully, now
that no row violated the constraint.

**7. Confirmed via `showmigrations api`:**

```
[X] 0019_user_unique_region_boss_per_region
```

**8. Therefore: the previous production blocker for G3-19 is RESOLVED.** The condition documented
in §4/§10/§11/§12 above ("cannot apply `0019` to Azure until the Gush-Elyon duplicates are cleaned
up") no longer holds — the cleanup happened first, verified, and the migration was applied after.

**9. Database-level uniqueness protection is now active in Azure.** A partial `UNIQUE` constraint
on `User(region)` where `role='region_boss'` now enforces, at the database layer, that no region
can ever have more than one `region_boss` row — independent of, and in addition to, the
application-level `select_for_update()` guard in `accounts/serializers.py` (§4).

**10. What the constraint does and does not guarantee.** The database constraint guarantees **at
most one** `region_boss` per region — it does **not** by itself guarantee **exactly one**. A
region with zero `region_boss` users (the Technion case, temporarily covered by its
`central_admin` per team decision, §4) does not violate this constraint and is not something a
uniqueness constraint can express. Preventing a region from being left at zero managers (via
deletion, demotion, or reassignment) remains the responsibility of the application-level rules,
not the database constraint.

**11. Allocation optimization logic.** No changes were made to `backend/allocation/solver.py`,
`backend/allocation/live_registry.py`, or any allocation scoring/matching/CP-SAT logic as part of
this closeout — this was a data-cleanup and migration-application step only.

**12. G3-20 (local Docker test-DB binding) closed out.** §10/§11/§12 above previously noted that
the `docker-compose.yml` binding fix (`127.0.0.1:5433:5432` instead of `0.0.0.0:5433:5432`) was
written but not yet live on the running container. Since then:
   - The `test_db` container was recreated.
   - Its active port binding was verified live as `127.0.0.1:5433->5432/tcp`.
   - **G3-20 is now operationally complete** — the fix is both written and live, with no further
     action pending. (This is a disposable local test database, never real data — see §4a/§10 for
     why this was always a low-severity, hygiene-only finding.)

**13. No secrets recorded.** No passwords, tokens, hashes, or credentials are included anywhere in
this section or this report — only account email addresses (already public/known staff identifiers
referenced elsewhere in this same document, §4) and migration/verification/binding outcomes.

This closeout update is documentation-only and changes no application code, migrations, tests,
Docker/config, or frontend/backend source.
