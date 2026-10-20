"""Keep Django's TLS mail transport and use Python's valid SMTP greeting."""

from django.core.mail.backends.smtp import EmailBackend as DjangoSMTPBackend


SUPPORTED_SMTP_BACKENDS = (
    "security.smtp_backend.EmailBackend",
    "django.core.mail.backends.smtp.EmailBackend",
)


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
