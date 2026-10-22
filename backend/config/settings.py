"""Persistent, same-origin backend. Production deliberately requires external configuration."""
import os
import secrets
from pathlib import Path
from urllib.parse import unquote, urlparse
from django.core.exceptions import ImproperlyConfigured
from security.smtp_backend import SUPPORTED_SMTP_BACKENDS

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BASE_DIR.parent
# Only this local ignored configuration is loaded; never ship a production secret.
env_file = BASE_DIR / '.env'
if env_file.is_file():
    for line in env_file.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            os.environ.setdefault(key.strip(), value.strip().strip('\"\''))

ENVIRONMENT = os.getenv('DJANGO_ENV', 'development')
if ENVIRONMENT not in ('development', 'production', 'test'):
    raise ImproperlyConfigured('DJANGO_ENV must be development, production or test.')
DEBUG = ENVIRONMENT == 'development'
DATA_DIR = Path(os.getenv('INOX_DATA_DIR', BASE_DIR / 'data')).resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)
if os.name != 'nt':
    DATA_DIR.chmod(0o700)
SECRET_KEY = os.getenv('DJANGO_SECRET_KEY', '')
if not SECRET_KEY:
    if ENVIRONMENT == 'production':
        raise ImproperlyConfigured('DJANGO_SECRET_KEY is required in production.')
    secret_file = DATA_DIR / '.development-secret'
    if not secret_file.exists():
        try:
            with secret_file.open('x', encoding='utf-8') as output:
                output.write(secrets.token_urlsafe(64))
            secret_file.chmod(0o600)
        except FileExistsError:
            pass
    SECRET_KEY = secret_file.read_text(encoding='utf-8').strip()

ALLOWED_HOSTS = [host.strip() for host in os.getenv('DJANGO_ALLOWED_HOSTS', '127.0.0.1,localhost,[::1]' if DEBUG else '').split(',') if host.strip()]
if ENVIRONMENT == 'production' and (not ALLOWED_HOSTS or '*' in ALLOWED_HOSTS):
    raise ImproperlyConfigured('Explicit DJANGO_ALLOWED_HOSTS are required in production.')
PUBLIC_ORIGIN = os.getenv('PUBLIC_SITE_URL', 'http://127.0.0.1:8000').rstrip('/')
if ENVIRONMENT == 'production' and not PUBLIC_ORIGIN.startswith('https://'):
    raise ImproperlyConfigured('Production PUBLIC_SITE_URL must use HTTPS.')
CSRF_TRUSTED_ORIGINS = [PUBLIC_ORIGIN] if ENVIRONMENT == 'production' else []

INSTALLED_APPS = [
    'config.apps.PrivateAdminConfig', 'django.contrib.auth', 'django.contrib.contenttypes',
    'django.contrib.sessions', 'django.contrib.messages', 'django.contrib.staticfiles',
    'django_otp', 'django_otp.plugins.otp_totp', 'security.apps.SecurityConfig', 'catalog',
]
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware', 'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware', 'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware', 'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django_otp.middleware.OTPMiddleware', 'security.middleware.SecuritySessionMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware', 'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'config.middleware.ResponsePolicyMiddleware',
]
ROOT_URLCONF = 'config.urls'
TEMPLATES = [{
    'BACKEND': 'django.template.backends.django.DjangoTemplates',
    'DIRS': [BASE_DIR / 'templates'], 'APP_DIRS': True,
    'OPTIONS': {'context_processors': ['django.template.context_processors.request', 'django.contrib.auth.context_processors.auth', 'django.contrib.messages.context_processors.messages']},
}]
WSGI_APPLICATION = 'config.wsgi.application'
database_url = os.getenv('DATABASE_URL', '')
if database_url:
    database = urlparse(database_url)
    if database.scheme not in ('postgres', 'postgresql'):
        raise ImproperlyConfigured('DATABASE_URL must use PostgreSQL.')
    DATABASES = {'default': {'ENGINE': 'django.db.backends.postgresql', 'NAME': unquote(database.path.lstrip('/')), 'USER': unquote(database.username or ''), 'PASSWORD': unquote(database.password or ''), 'HOST': database.hostname, 'PORT': database.port or 5432, 'CONN_MAX_AGE': 60, 'OPTIONS': {'sslmode': os.getenv('DATABASE_SSLMODE', 'require')}}}
else:
    if ENVIRONMENT == 'production':
        raise ImproperlyConfigured('A persistent PostgreSQL DATABASE_URL is required in production.')
    # Reserve the writer before an atomic block reads throttle/MFA state. A
    # deferred read-to-write upgrade can fail immediately under concurrency,
    # even with a busy timeout; SQLite has no SELECT FOR UPDATE row locks.
    DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': DATA_DIR / 'inox.sqlite3', 'OPTIONS': {'timeout': 20, 'transaction_mode': 'IMMEDIATE'}}}

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
PASSWORD_HASHERS = ['django.contrib.auth.hashers.Argon2PasswordHasher', 'django.contrib.auth.hashers.PBKDF2PasswordHasher']
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 12}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]
LOGIN_URL = '/admin/auth/login/'
LOGIN_REDIRECT_URL = '/admin/'
LOGOUT_REDIRECT_URL = '/admin/auth/login/'
SESSION_ENGINE = 'django.contrib.sessions.backends.db'
SESSION_COOKIE_NAME = 'inox_session'
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Strict'
SESSION_COOKIE_SECURE = ENVIRONMENT == 'production'
SESSION_COOKIE_AGE = 8 * 60 * 60
SESSION_EXPIRE_AT_BROWSER_CLOSE = True
CSRF_COOKIE_SECURE = ENVIRONMENT == 'production'
CSRF_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = 'Strict'
SECURITY_PENDING_SECONDS = 5 * 60
SECURITY_SESSION_SECONDS = 8 * 60 * 60
SECURITY_IDLE_SECONDS = 30 * 60
OTP_TOTP_THROTTLE_FACTOR = 1
SECURE_SSL_REDIRECT = ENVIRONMENT == 'production'
SECURE_HSTS_SECONDS = 31536000 if ENVIRONMENT == 'production' else 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = 'same-origin'
X_FRAME_OPTIONS = 'DENY'
TRUSTED_INOX_PROXY = os.getenv('TRUST_REVERSE_PROXY') == '1'
if TRUSTED_INOX_PROXY:
    # Set only when the application port is private behind our own TLS proxy.
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

LANGUAGE_CODE = 'es-pe'
TIME_ZONE = 'America/Lima'
USE_I18N = True
USE_TZ = True
STATIC_URL = '/admin-static/'
STATIC_ROOT = DATA_DIR / 'admin-static'
STATICFILES_DIRS = [BASE_DIR / 'static']
WHITENOISE_MAX_AGE = 0 if DEBUG else 3600
if ENVIRONMENT == 'production':
    STORAGES = {
        'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
        'staticfiles': {'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage'},
    }
MEDIA_ROOT = DATA_DIR / 'media'
MEDIA_URL = '/media/'
FRONTEND_DIST = Path(os.getenv('FRONTEND_DIST', PROJECT_DIR / 'dist-server')).resolve()
FILE_UPLOAD_MAX_MEMORY_SIZE = 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = 12 * 1024 * 1024
DATA_UPLOAD_MAX_NUMBER_FIELDS = 3000
# Email MFA is disabled until an operator configures a real mail transport.
SECURITY_EMAIL_ENABLED = os.getenv('SECURITY_EMAIL_ENABLED') == '1'
SECURITY_EMAIL_RESEND_SECONDS = 60
SECURITY_EMAIL_CODE_SECONDS = 5 * 60
SECURITY_PASSKEYS_ENABLED = os.getenv('SECURITY_PASSKEYS_ENABLED') == '1'
SECURITY_PASSKEY_RP_ID = os.getenv('SECURITY_PASSKEY_RP_ID', '').strip().lower()
SECURITY_PASSKEY_ORIGIN = os.getenv('SECURITY_PASSKEY_ORIGIN', '').strip().rstrip('/')
SECURITY_OWNER_USERNAME = os.getenv('SECURITY_OWNER_USERNAME', '').strip().lower()
EMAIL_BACKEND = os.getenv('EMAIL_BACKEND', 'security.smtp_backend.EmailBackend')
EMAIL_HOST = os.getenv('EMAIL_HOST', '')
EMAIL_PORT = int(os.getenv('EMAIL_PORT', '587'))
EMAIL_HOST_USER = os.getenv('EMAIL_HOST_USER', '')
EMAIL_HOST_PASSWORD = os.getenv('EMAIL_HOST_PASSWORD', '')
EMAIL_USE_TLS = os.getenv('EMAIL_USE_TLS', '1') == '1'
EMAIL_USE_SSL = os.getenv('EMAIL_USE_SSL', '0') == '1'
EMAIL_TIMEOUT = 10
DEFAULT_FROM_EMAIL = os.getenv('DEFAULT_FROM_EMAIL', EMAIL_HOST_USER)
if EMAIL_USE_TLS and EMAIL_USE_SSL:
    raise ImproperlyConfigured('Choose either EMAIL_USE_TLS or EMAIL_USE_SSL.')
if ENVIRONMENT == 'production' and SECURITY_EMAIL_ENABLED:
    if EMAIL_BACKEND not in SUPPORTED_SMTP_BACKENDS or not EMAIL_HOST or not DEFAULT_FROM_EMAIL:
        raise ImproperlyConfigured('Email verification requires a configured SMTP transport.')
    if not (EMAIL_USE_TLS or EMAIL_USE_SSL):
        raise ImproperlyConfigured('Production SMTP must use TLS.')
