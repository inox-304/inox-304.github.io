"""Keep Django's TLS mail transport and use Python's valid SMTP greeting."""

import smtplib

from django.core.mail.backends.smtp import EmailBackend as DjangoSMTPBackend


SUPPORTED_SMTP_BACKENDS = (
    "security.smtp_backend.EmailBackend",
    "django.core.mail.backends.smtp.EmailBackend",
)


def smtp_status(error):
    """Return only a validated status, never server text or recipient details."""
    if isinstance(error, smtplib.SMTPRecipientsRefused):
        if not isinstance(error.recipients, dict) or not error.recipients:
            return None
        codes = []
        for value in error.recipients.values():
            if not isinstance(value, (tuple, list)) or not value:
                return None
            code = value[0]
            if type(code) is not int or not 100 <= code <= 599:
                return None
            codes.append(code)
        # Only treat a multi-recipient refusal as permanent if all replies are
        # permanent. Verification messages normally contain one recipient.
        return next((code for code in codes if code < 500), codes[0])
    elif isinstance(error, smtplib.SMTPResponseException):
        codes = [error.smtp_code]
    else:
        codes = []
    codes = [code for code in codes if type(code) is int and 100 <= code <= 599]
    return codes[0] if codes else None


class EmailBackend(DjangoSMTPBackend):
    @property
    def connection_class(self):
        transport = super().connection_class

        def connect(*args, **kwargs):
            # Django passes a cached machine name even when it is not a FQDN.
            # smtplib instead selects a FQDN or a valid bracketed address literal.
            # Removing only this override preserves TLS, timeouts and credentials.
            kwargs.pop("local_hostname", None)
            return transport(*args, **kwargs)

        return connect
