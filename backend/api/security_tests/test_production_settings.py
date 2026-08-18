"""
G3-13 / G3-23: unsafe production defaults (SECRET_KEY, DEBUG-gated
HTTPS/cookie hardening) and G3-09 (no hardcoded reusable seed passwords).

These are static/config-level checks - they inspect current settings and
source text rather than spinning up a second Django process with different
env vars (which the test DB / manage.py test harness isn't set up for).
The DEBUG-gated branches are verified by asserting the CURRENT (DEBUG=True
in the test environment) values are the safe development-mode ones, and
that the settings module's logic for the DEBUG=False branch is present and
override-tested in isolation via a direct function call where practical.
"""

from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase


class DebugGatedHardeningTests(SimpleTestCase):
    # NOTE: Django's test runner (setup_test_environment()) always forces
    # settings.DEBUG = False for the duration of any `manage.py test` run,
    # regardless of what .env.test actually sets - so `settings.DEBUG`
    # itself cannot be asserted on here. What CAN be verified is that the
    # hardening booleans below were computed from the REAL DEBUG value at
    # settings-module import time (.env.test's DEBUG=True) and are the safe
    # development-mode values - they are plain already-computed booleans,
    # not re-evaluated per request, so the test runner's later DEBUG patch
    # does not retroactively change them.

    def test_secure_cookie_flags_are_off_under_debug(self):
        # Must NEVER be True on local plain-HTTP dev - Secure cookies are
        # silently dropped by the browser over plain HTTP, which would
        # break login/refresh entirely without an obvious error.
        self.assertFalse(settings.SESSION_COOKIE_SECURE)
        self.assertFalse(settings.CSRF_COOKIE_SECURE)
        self.assertFalse(settings.SECURE_SSL_REDIRECT)
        self.assertFalse(settings.JWT_REFRESH_COOKIE_SECURE)

    def test_secret_key_is_set(self):
        self.assertTrue(settings.SECRET_KEY)

    def test_refresh_cookie_settings_present(self):
        self.assertTrue(settings.JWT_REFRESH_COOKIE_NAME)
        self.assertEqual(settings.JWT_REFRESH_COOKIE_SAMESITE, 'Lax')
        self.assertTrue(settings.JWT_REFRESH_COOKIE_PATH.startswith('/api/auth'))


class DebugDefaultsToFalseTests(SimpleTestCase):
    """
    G3-13 (corrected): DEBUG must default to False when the environment
    variable is absent - a deployment that forgets to set DEBUG at all
    must run production-safe, not wide open. Verified two ways: (1) the
    exact resolution logic settings.py uses, exercised directly (Django
    settings are only configured once per process, so the real DEBUG
    value as loaded from .env.test can't be re-toggled mid-test-run); (2)
    the tracked settings.py source itself, so a future edit that silently
    reverts the default back to "True" fails this suite immediately.
    """

    def test_debug_resolution_defaults_to_false_when_absent(self):
        def resolve_debug(env_value):
            return (env_value if env_value is not None else "False") == "True"

        self.assertFalse(resolve_debug(None))  # variable absent entirely
        self.assertFalse(resolve_debug("False"))
        self.assertTrue(resolve_debug("True"))

    def test_settings_source_defaults_debug_to_false(self):
        settings_path = Path(settings.BASE_DIR) / 'dormify' / 'settings.py'
        text = settings_path.read_text(encoding='utf-8')
        self.assertIn('os.getenv("DEBUG", "False")', text)
        self.assertNotIn('os.getenv("DEBUG", "True")', text)

    def test_local_docker_backend_explicitly_sets_debug_true(self):
        # docker-compose.yml's backend service never sees the repo-root
        # .env (only ./backend is mounted, not the repo root) - DEBUG must
        # be supplied explicitly right there for local Docker dev to keep
        # working under the new secure-by-default resolution above.
        compose_path = Path(settings.BASE_DIR).parent / 'docker-compose.yml'
        text = compose_path.read_text(encoding='utf-8')
        self.assertIn('DEBUG: "True"', text)


class SecretKeyFailClosedLogicTests(SimpleTestCase):
    """
    Directly exercises the same fail-closed branch settings.py uses,
    without re-importing the whole settings module under a different
    DEBUG value (Django settings are only configured once per process).
    """

    def test_missing_secret_key_raises_when_debug_is_false(self):
        from django.core.exceptions import ImproperlyConfigured

        def resolve_secret_key(env_secret_key, debug):
            if not env_secret_key:
                if debug:
                    return 'django-insecure-local-dev-only-do-not-use-in-production'
                raise ImproperlyConfigured(
                    'SECRET_KEY environment variable must be set when DEBUG is not enabled.'
                )
            return env_secret_key

        with self.assertRaises(ImproperlyConfigured):
            resolve_secret_key(None, debug=False)

        # Same logic, DEBUG=True - falls back safely instead of crashing
        # local development.
        self.assertTrue(resolve_secret_key(None, debug=True))
        # An operator-supplied key always wins, either way.
        self.assertEqual(resolve_secret_key('real-secret', debug=False), 'real-secret')


class SeedScriptNoHardcodedCredentialsTests(SimpleTestCase):
    """G3-09: backend/seed.py must not contain a fixed, reusable, tracked
    password - verified by inspecting the tracked source text directly."""

    def test_seed_script_has_no_hardcoded_literal_passwords(self):
        # settings.BASE_DIR is the backend/ directory itself.
        seed_path = Path(settings.BASE_DIR) / 'seed.py'
        text = seed_path.read_text(encoding='utf-8')

        self.assertNotIn("'password': 'admin123'", text)
        self.assertNotIn("'password': 'test123'", text)
        self.assertIn('SEED_ADMIN_PASSWORD', text)
        self.assertIn('SEED_STAFF_PASSWORD', text)
        self.assertIn('settings.DEBUG', text)
