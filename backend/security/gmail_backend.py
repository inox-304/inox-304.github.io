"""Send MIME messages over Google's HTTPS API with the gmail.send scope only."""
import base64
from email.utils import parseaddr

from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend
from django.views.decorators.debug import sensitive_variables
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
import requests

from .mail_config import gmail_configuration_ready

SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
SEND_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'


class GmailDeliveryError(Exception):
    """Contains only a safe fixed message and optional HTTP status; never API data."""
    def __init__(self, status=None):
        self.http_status = status if type(status) is int and 100 <= status <= 599 else None
        super().__init__('Gmail HTTPS delivery failed.')


class EmailBackend(BaseEmailBackend):
    @sensitive_variables()
    def send_messages(self, email_messages):
        if not email_messages:
            return 0
        sent = 0
        try:
            if not gmail_configuration_ready(settings):
                raise GmailDeliveryError()
            credentials = Credentials(
                token=None, refresh_token=settings.GMAIL_API_REFRESH_TOKEN,
                token_uri=TOKEN_ENDPOINT, client_id=settings.GMAIL_API_CLIENT_ID,
                client_secret=settings.GMAIL_API_CLIENT_SECRET, scopes=[SEND_SCOPE],
            )
            with requests.Session() as session:
                auth_request = Request(session=session)
                # Bound token refresh as well as message delivery; don't retry
                # sends after ambiguous timeouts, which could duplicate an OTP.
                def bounded_request(*args, **kwargs):
                    kwargs['timeout'] = settings.EMAIL_TIMEOUT
                    kwargs['allow_redirects'] = False
                    return auth_request(*args, **kwargs)
                credentials.refresh(bounded_request)
                for message in email_messages:
                    if not message.recipients():
                        continue
                    if parseaddr(message.from_email)[1].lower() != settings.GMAIL_API_SENDER.lower():
                        raise GmailDeliveryError()
                    raw = base64.urlsafe_b64encode(message.message().as_bytes()).decode('ascii')
                    response = session.post(
                        SEND_ENDPOINT, json={'raw': raw},
                        headers={'Authorization': f'Bearer {credentials.token}'},
                        timeout=settings.EMAIL_TIMEOUT, allow_redirects=False,
                    )
                    try:
                        if response.status_code != 200:
                            raise GmailDeliveryError(response.status_code)
                        payload = response.json()
                        if not isinstance(payload, dict) or not payload.get('id'):
                            raise GmailDeliveryError()
                        sent += 1
                    finally:
                        response.close()
        except Exception as error:
            if not self.fail_silently:
                # OAuth and HTTP exceptions may contain secrets or recipients.
                # HTTP failure is not SMTP rejection and must not pause a user.
                raise GmailDeliveryError(getattr(error, 'http_status', None)) from None
        return sent
