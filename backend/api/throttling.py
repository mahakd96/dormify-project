"""
G3-10: rate limiting for security-sensitive authentication endpoints.

Each class below is a small, fixed-scope DRF throttle - deliberately NOT
rest_framework.throttling.ScopedRateThrottle, which reads its scope from a
`view.throttle_scope` attribute that isn't reliably settable on an
@api_view-wrapped function view across DRF versions. SimpleRateThrottle
itself is abstract (get_cache_key() raises NotImplementedError until
overridden) - _FixedScopeRateThrottle below provides the one concrete
implementation every class here shares: throttle by authenticated user id
when logged in, by client IP otherwise (the same behavior DRF's own
UserRateThrottle uses).

Rates are configured in dormify.settings under REST_FRAMEWORK/
DEFAULT_THROTTLE_RATES, keyed by each class's `scope`, so they can be tuned
without touching this file.
"""

from rest_framework.throttling import SimpleRateThrottle


class _FixedScopeRateThrottle(SimpleRateThrottle):
    """Shared get_cache_key for every throttle class below - keyed by
    request.user.pk when authenticated, otherwise by client IP. Subclasses
    only need to set `scope`."""

    def get_cache_key(self, request, view):
        if request.user and request.user.is_authenticated:
            ident = request.user.pk
        else:
            ident = self.get_ident(request)
        return self.cache_format % {'scope': self.scope, 'ident': ident}


class LoginRateThrottle(_FixedScopeRateThrottle):
    """Guards /auth/login/ against credential-stuffing/brute-force. Keyed
    by client IP (the caller isn't authenticated yet)."""
    scope = 'auth_login'


class StaffCreateRateThrottle(_FixedScopeRateThrottle):
    """Guards /api/staff-users/ (the only remaining account-creation
    endpoint, see G3-01) against bulk/automated account creation."""
    scope = 'staff_create'


class SensitiveAccountActionRateThrottle(_FixedScopeRateThrottle):
    """Guards change-password/change-email against automated guessing of
    the caller's current password (both require it) or rapid repeated
    account-detail changes."""
    scope = 'auth_sensitive'


class TokenRefreshRateThrottle(_FixedScopeRateThrottle):
    """Guards the JWT refresh endpoint (G3-16) against refresh-token
    guessing/replay abuse. Generous - refresh is called routinely by a
    legitimate session on access-token expiry."""
    scope = 'auth_refresh'


class LogoutRateThrottle(_FixedScopeRateThrottle):
    """Guards the logout/blacklist endpoint (G3-14)."""
    scope = 'auth_logout'
