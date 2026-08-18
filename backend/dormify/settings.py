"""
DORMIFY - Django Settings
"""

import os
from pathlib import Path
from datetime import timedelta
from dotenv import load_dotenv
from corsheaders.defaults import default_headers
from django.core.exceptions import ImproperlyConfigured

# Build paths
BASE_DIR = Path(__file__).resolve().parent.parent

# Load environment variables
# Default: .env
# For tests: run with ENV_FILE=.env.test
ENV_FILE = os.getenv("ENV_FILE", ".env")
load_dotenv(BASE_DIR.parent / ENV_FILE)

# Security
#
# G3-13: secure by default - DEBUG is False unless the DEBUG environment
# variable explicitly says otherwise. A deployment that forgets to set
# DEBUG at all (the exact scenario this finding is about) now runs
# production-safe, not wide open. Every hardening rule below is gated on
# this same value, so a deployment that never sets DEBUG gets the safe
# behavior automatically.
#
# Local development must therefore set DEBUG=True EXPLICITLY:
#   - docker-compose.yml's `backend` service sets `DEBUG: "True"` directly
#     (that container never reads the repo-root .env at all - it only
#     mounts ./backend, so this is the only place Docker dev gets DEBUG
#     from).
#   - running the backend directly on the host (no Docker) reads it from
#     ENV_FILE (.env / .env.test) via load_dotenv() above - add
#     `DEBUG=True` to your local .env for that flow, the same way
#     .env.test already does for the test suite.
# See project-quality/security/GROUP3_SECURITY_IMPLEMENTATION_REPORT.md
# (G3-13) for the full rationale and the one remaining manual step for a
# real production deployment: DEBUG=False (now the default, but still
# fine to set explicitly for clarity) + a real SECRET_KEY.
DEBUG = os.getenv("DEBUG", "False") == "True"

# No insecure hardcoded fallback once DEBUG is off. A DEBUG=True
# (development) run may still fall back to a fixed placeholder key purely
# for local convenience - it never leaves this process and there is nothing
# session-worthy to protect on a throwaway dev database. Once DEBUG=False,
# the app refuses to start without an operator-supplied SECRET_KEY rather
# than silently running on a public, guessable one.
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "django-insecure-local-dev-only-do-not-use-in-production"
    else:
        raise ImproperlyConfigured(
            "SECRET_KEY environment variable must be set when DEBUG is not "
            "enabled. Refusing to start with no secret key configured."
        )

ALLOWED_HOSTS = [
    h.strip() for h in os.getenv(
        "DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,192.168.1.13"
    ).split(",") if h.strip()
]

# Application definition
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",

    # Third party
    "rest_framework",
    "rest_framework_simplejwt",
    # G3-14: enables server-side refresh-token revocation (blacklist table +
    # BLACKLIST_AFTER_ROTATION below) - previously set in SIMPLE_JWT without
    # this app installed, so blacklisting was silently a no-op.
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",

    # Local apps
    "api",
    "accounts.apps.AccountsConfig",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",  # Must be first!
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "dormify.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "dormify.wsgi.application"

DB_SSLMODE = os.getenv("DB_SSLMODE", "require")

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("DB_NAME"),
        "USER": os.getenv("DB_USER"),
        "PASSWORD": os.getenv("DB_PASSWORD"),
        "HOST": os.getenv("DB_HOST"),
        "PORT": os.getenv("DB_PORT", "5432"),
        "OPTIONS": {
            "connect_timeout": 30,
        },
        "CONN_MAX_AGE": 0,
    }
}

if DB_SSLMODE:
    DATABASES["default"]["OPTIONS"]["sslmode"] = DB_SSLMODE

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# Custom User Model
AUTH_USER_MODEL = "api.User"

# Internationalization
LANGUAGE_CODE = "he"
TIME_ZONE = "Asia/Jerusalem"
USE_I18N = True
USE_TZ = True

# Static files
STATIC_URL = "static/"

# Default primary key
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ===========================================
# REST Framework Configuration
# ===========================================
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    # G3-10: rates for the fixed-scope throttle classes in
    # api/throttling.py. No DEFAULT_THROTTLE_CLASSES is set globally -
    # throttling is applied per-view only on the specific security-
    # sensitive endpoints that use those classes, so ordinary authenticated
    # API traffic (allocation polling, list views, etc.) is never
    # throttled.
    "DEFAULT_THROTTLE_RATES": {
        "auth_login": os.getenv("THROTTLE_AUTH_LOGIN", "10/min"),
        "auth_sensitive": os.getenv("THROTTLE_AUTH_SENSITIVE", "10/min"),
        "staff_create": os.getenv("THROTTLE_STAFF_CREATE", "20/min"),
        "auth_refresh": os.getenv("THROTTLE_AUTH_REFRESH", "30/min"),
        "auth_logout": os.getenv("THROTTLE_AUTH_LOGOUT", "30/min"),
    },
}

# ===========================================
# JWT Configuration
# ===========================================
SIMPLE_JWT = {
    # G3-16: shortened from a 1440-minute (24h) default to ~20 minutes - a
    # short-lived access token is now viable because a working refresh flow
    # exists (see api/views.py refresh_view and JWT_REFRESH_COOKIE_* below);
    # previously the refresh token was issued but nothing ever consumed it.
    "ACCESS_TOKEN_LIFETIME": timedelta(
        minutes=int(os.getenv("JWT_ACCESS_TOKEN_LIFETIME", 20))
    ),
    "REFRESH_TOKEN_LIFETIME": timedelta(
        minutes=int(os.getenv("JWT_REFRESH_TOKEN_LIFETIME", 10080))
    ),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
}

# ===========================================
# Refresh-token cookie (G3-14 / G3-16 / G3-17)
# ===========================================
# The refresh token is never sent to frontend JS: /api/auth/login/ and
# /api/auth/refresh/ set it as an HttpOnly cookie, and only the backend
# auth endpoints (refresh/logout) ever read it. The access token stays a
# normal Bearer token in the Authorization header, kept in frontend memory
# only - see src/services/api.js. Path is scoped to /api/auth/ so the
# browser doesn't attach this cookie to every unrelated API request.
JWT_REFRESH_COOKIE_NAME = os.getenv("JWT_REFRESH_COOKIE_NAME", "dormify_refresh")
JWT_REFRESH_COOKIE_PATH = os.getenv("JWT_REFRESH_COOKIE_PATH", "/api/auth/")
JWT_REFRESH_COOKIE_SAMESITE = os.getenv("JWT_REFRESH_COOKIE_SAMESITE", "Lax")
# Never Secure on local plain-HTTP dev (the browser would silently refuse to
# ever send it); Secure by default once DEBUG=False, still overridable.
JWT_REFRESH_COOKIE_SECURE = os.getenv(
    "JWT_REFRESH_COOKIE_SECURE", "False" if DEBUG else "True"
) == "True"
JWT_REFRESH_COOKIE_DOMAIN = os.getenv("JWT_REFRESH_COOKIE_DOMAIN") or None

CORS_ALLOWED_ORIGINS = os.getenv(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000,http://192.168.1.13:3000",
).split(",")

CORS_ALLOW_HEADERS = list(default_headers) + [
    "authorization",
]

# Required for the browser to send/accept the HttpOnly refresh cookie
# cross-origin (frontend :3000 -> backend :8000) - already relied on the
# explicit CORS_ALLOWED_ORIGINS list above (never "*", which is invalid
# together with credentials anyway).
CORS_ALLOW_CREDENTIALS = True

# ===========================================
# Production hardening (G3-23)
# ===========================================
# Inert while DEBUG=True, so local Docker dev over plain HTTP is never
# redirected or otherwise broken (SECURE_SSL_REDIRECT=True on plain HTTP
# would just be a permanent redirect loop). A deployment that sets
# DEBUG=False gets all of this automatically. SECURE_PROXY_SSL_HEADER is
# only enabled when DJANGO_BEHIND_HTTPS_PROXY explicitly says the
# deployment sits behind a proxy that terminates TLS and sets that header -
# never turned on by guesswork, since trusting it incorrectly lets a client
# spoof "https" and defeat SECURE_SSL_REDIRECT.
if not DEBUG:
    SECURE_SSL_REDIRECT = os.getenv("SECURE_SSL_REDIRECT", "True") == "True"
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = int(os.getenv("SECURE_HSTS_SECONDS", 31536000))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = os.getenv("SECURE_HSTS_INCLUDE_SUBDOMAINS", "True") == "True"
    SECURE_HSTS_PRELOAD = os.getenv("SECURE_HSTS_PRELOAD", "True") == "True"
    if os.getenv("DJANGO_BEHIND_HTTPS_PROXY", "False") == "True":
        SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
else:
    SECURE_SSL_REDIRECT = False
    SESSION_COOKIE_SECURE = False
    CSRF_COOKIE_SECURE = False