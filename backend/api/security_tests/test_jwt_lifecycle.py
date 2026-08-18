"""
G3-14 / G3-16 / G3-17: login/refresh/logout/blacklist/session-restoration
lifecycle. The refresh token must live only in an HttpOnly cookie (never
the JSON body), refresh must actually work end-to-end, rotation must
blacklist the previous refresh token, and logout must revoke it
server-side (not just clear client state).
"""

from django.conf import settings
from rest_framework.test import APIClient

from .base import SecurityTestCase, TEST_PASSWORD


class JwtLifecycleTests(SecurityTestCase):
    def test_login_returns_access_only_never_refresh_in_body(self):
        client = APIClient()
        resp = client.post('/api/auth/login/', {
            'email': self.emp_a.email, 'password': TEST_PASSWORD,
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('access', resp.data)
        self.assertNotIn('refresh', resp.data)
        self.assertNotIn('tokens', str(resp.data.keys()))

    def test_refresh_cookie_is_httponly(self):
        client = APIClient()
        resp = client.post('/api/auth/login/', {
            'email': self.emp_a.email, 'password': TEST_PASSWORD,
        }, format='json')
        cookie = resp.cookies.get(settings.JWT_REFRESH_COOKIE_NAME)
        self.assertIsNotNone(cookie)
        self.assertTrue(cookie['httponly'])

    def test_access_token_authorizes_api_calls(self):
        client = APIClient()
        login = client.post('/api/auth/login/', {
            'email': self.emp_a.email, 'password': TEST_PASSWORD,
        }, format='json')
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
        me = client.get('/api/auth/me/')
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.data['user']['email'], self.emp_a.email)

    def test_refresh_endpoint_issues_new_access_token_from_cookie_only(self):
        client = APIClient()
        login = client.post('/api/auth/login/', {
            'email': self.emp_a.email, 'password': TEST_PASSWORD,
        }, format='json')
        cookie = login.cookies.get(settings.JWT_REFRESH_COOKIE_NAME)

        # Fresh client, as if the page was reloaded: only the cookie
        # carries the session forward, nothing read from JS-visible storage.
        fresh_client = APIClient()
        fresh_client.cookies[settings.JWT_REFRESH_COOKIE_NAME] = cookie.value
        refreshed = fresh_client.post('/api/auth/refresh/')
        self.assertEqual(refreshed.status_code, 200, refreshed.content)
        self.assertIn('access', refreshed.data)
        self.assertEqual(refreshed.data['user']['email'], self.emp_a.email)

    def test_refresh_without_cookie_is_rejected(self):
        client = APIClient()
        resp = client.post('/api/auth/refresh/')
        self.assertEqual(resp.status_code, 401)

    def test_rotated_refresh_token_cannot_be_reused(self):
        client = APIClient()
        login = client.post('/api/auth/login/', {
            'email': self.emp_a.email, 'password': TEST_PASSWORD,
        }, format='json')
        old_cookie = login.cookies.get(settings.JWT_REFRESH_COOKIE_NAME)

        first_refresh_client = APIClient()
        first_refresh_client.cookies[settings.JWT_REFRESH_COOKIE_NAME] = old_cookie.value
        first = first_refresh_client.post('/api/auth/refresh/')
        self.assertEqual(first.status_code, 200)

        # The OLD refresh token was rotated away and blacklisted - reusing
        # it must fail even though it hasn't naturally expired.
        replay_client = APIClient()
        replay_client.cookies[settings.JWT_REFRESH_COOKIE_NAME] = old_cookie.value
        replay = replay_client.post('/api/auth/refresh/')
        self.assertEqual(replay.status_code, 401)

    def test_logout_blacklists_refresh_token(self):
        client = APIClient()
        login = client.post('/api/auth/login/', {
            'email': self.emp_a.email, 'password': TEST_PASSWORD,
        }, format='json')
        cookie = login.cookies.get(settings.JWT_REFRESH_COOKIE_NAME)

        logout_client = APIClient()
        logout_client.cookies[settings.JWT_REFRESH_COOKIE_NAME] = cookie.value
        logout_resp = logout_client.post('/api/auth/logout/')
        self.assertEqual(logout_resp.status_code, 200)

        reuse_client = APIClient()
        reuse_client.cookies[settings.JWT_REFRESH_COOKIE_NAME] = cookie.value
        after_logout = reuse_client.post('/api/auth/refresh/')
        self.assertEqual(after_logout.status_code, 401)

    def test_logout_succeeds_even_without_a_valid_access_token(self):
        # Logout must be able to revoke a still-valid refresh cookie even
        # when the short-lived access token has already expired/is absent -
        # requiring IsAuthenticated here would create exactly the gap this
        # test guards against.
        client = APIClient()
        login = client.post('/api/auth/login/', {
            'email': self.emp_a.email, 'password': TEST_PASSWORD,
        }, format='json')
        cookie = login.cookies.get(settings.JWT_REFRESH_COOKIE_NAME)

        anon_client = APIClient()  # no Authorization header at all
        anon_client.cookies[settings.JWT_REFRESH_COOKIE_NAME] = cookie.value
        resp = anon_client.post('/api/auth/logout/')
        self.assertEqual(resp.status_code, 200)

    def test_access_token_lifetime_is_short(self):
        # G3-16: no more 24h (1440 minute) default.
        self.assertLessEqual(
            settings.SIMPLE_JWT['ACCESS_TOKEN_LIFETIME'].total_seconds(), 30 * 60
        )

    def test_blacklist_app_installed(self):
        # G3-14: BLACKLIST_AFTER_ROTATION being True is a no-op without
        # this app - guard against that regressing silently.
        self.assertIn('rest_framework_simplejwt.token_blacklist', settings.INSTALLED_APPS)
        self.assertTrue(settings.SIMPLE_JWT.get('BLACKLIST_AFTER_ROTATION'))
