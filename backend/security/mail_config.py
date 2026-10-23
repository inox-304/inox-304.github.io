"""Configuration checks shared by setup and OTP delivery; never sends mail."""
from email.utils import parseaddr

from .smtp_backend import SUPPORTED_SMTP_BACKENDS

GMAIL_API_BACKEND = 'security.gmail_backend.EmailBackend'


def gmail_configuration_ready(config):
    return bool(config.EMAIL_BACKEND == GMAIL_API_BACKEND
                and all(getattr(config, key, '') for key in (
                    'GMAIL_API_CLIENT_ID', 'GMAIL_API_CLIENT_SECRET',
                    'GMAIL_API_REFRESH_TOKEN', 'GMAIL_API_SENDER', 'DEFAULT_FROM_EMAIL'))
                and parseaddr(config.DEFAULT_FROM_EMAIL)[1].lower() == config.GMAIL_API_SENDER.lower())


def mail_transport_ready(config):
    if gmail_configuration_ready(config):
        return True
    return bool(config.EMAIL_BACKEND in SUPPORTED_SMTP_BACKENDS
                and config.EMAIL_HOST and config.DEFAULT_FROM_EMAIL
                and (config.EMAIL_USE_TLS or config.EMAIL_USE_SSL)
                and bool(config.EMAIL_HOST_USER) == bool(config.EMAIL_HOST_PASSWORD))
