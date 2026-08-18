"""
G3-10: meaningful rate limiting on security-sensitive authentication
endpoints - repeated abuse eventually gets a 429, normal use does not.
"""

from django.conf import settings
from django.core.cache import cache

from rest_framework.test import APIClient

from .base import SecurityTestCase, TEST_PASSWORD


def _rate_limit(scope):
    """Parses e.g. '10/min' -> 10 from the configured DEFAULT_THROTTLE_RATES."""
    rate = settings.REST_FRAMEWORK['DEFAULT_THROTTLE_RATES'][scope]
    return int(rate.split('/')[0])


class LoginThrottlingTests(SecurityTestCase):
    def setUp(self):
        super().setUp()
        # Throttle counters live in the process-wide cache, not the DB -
        # clear it so each test starts with a fresh window regardless of
        # what ran before it.
        cache.clear()

    def test_normal_login_succeeds(self):
        client = APIClient()
        resp = client.post('/api/auth/login/', {
            'email': self.emp_a.email, 'password': TEST_PASSWORD,
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_repeated_login_abuse_eventually_returns_429(self):
        limit = _rate_limit('auth_login')
        client = APIClient()
        statuses = []
        for _ in range(limit + 3):
            resp = client.post('/api/auth/login/', {
                'email': self.emp_a.email, 'password': 'wrong-password',
            }, format='json')
            statuses.append(resp.status_code)

        # Every attempt up to the limit is processed normally (401 for a
        # genuinely wrong password); once the limit is exceeded, the
        # throttle kicks in.
        self.assertIn(429, statuses)
        self.assertEqual(statuses[:limit], [401] * limit)

    def test_authenticated_normal_api_usage_is_not_throttled(self):
        # Only the specific security-sensitive endpoints carry a throttle -
        # ordinary authenticated traffic must not be affected even after
        # many requests.
        client = self.client_for(self.emp_a)
        limit = _rate_limit('auth_login')
        for _ in range(limit + 5):
            resp = client.get('/api/auth/me/')
            self.assertEqual(resp.status_code, 200)


class SensitiveAccountActionThrottlingTests(SecurityTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()

    def test_repeated_password_change_abuse_returns_429(self):
        limit = _rate_limit('auth_sensitive')
        client = self.client_for(self.emp_a)
        statuses = []
        for _ in range(limit + 2):
            resp = client.put('/api/auth/change-password/', {
                'current_password': 'wrong', 'new_password': 'NewPassword123!',
                'confirm_password': 'NewPassword123!',
            }, format='json')
            statuses.append(resp.status_code)
        self.assertIn(429, statuses)
