"""Purpose-bound email OTPs. Only HMACs of codes are persisted."""
import logging
import re
import secrets
import smtplib
import ssl
import time
from datetime import datetime, timedelta, timezone as datetime_timezone
from email.utils import make_msgid, parseaddr

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.mail import EmailMessage
from django.core.validators import validate_email
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import constant_time_compare, salted_hmac
from django.views.decorators.debug import sensitive_variables

from .models import EmailChallenge, EmailDevice, EnrollmentPermission, SecurityState
from .smtp_backend import SUPPORTED_SMTP_BACKENDS, smtp_status
from .gmail_backend import GmailDeliveryError
from .mail_config import gmail_configuration_ready
from .services import PENDING_KEY, VERSION, audit, seconds

EMAIL_REGENERATE_KEY = "security_email_regenerate"
logger = logging.getLogger(__name__)


def _log_delivery_failure(error):
    # Only fixed categories and numeric SMTP statuses may enter logs. SMTP
    # exception messages can contain recipients, credentials or message bodies.
    categories = (
        GmailDeliveryError,
        smtplib.SMTPAuthenticationError, smtplib.SMTPSenderRefused,
        smtplib.SMTPRecipientsRefused, smtplib.SMTPDataError,
        smtplib.SMTPHeloError, smtplib.SMTPConnectError,
        smtplib.SMTPServerDisconnected, smtplib.SMTPNotSupportedError,
        smtplib.SMTPResponseException, smtplib.SMTPException,
        ssl.SSLError, PermissionError, TimeoutError, ConnectionError,
        OSError, ValueError,
    )
    category = next((kind.__name__ for kind in categories if isinstance(error, kind)), "UnexpectedError")
    smtp_code = smtp_status(error)
    logger.warning("Email verification delivery failed (error=%s, smtp_code=%s)", category, smtp_code)


class EmailDeliveryError(Exception):
    pass


class EmailDeliveryPaused(EmailDeliveryError):
    pass


@sensitive_variables()
def send_verification_message(subject, body, recipient):
    sender = parseaddr(settings.DEFAULT_FROM_EMAIL)[1]
    validate_email(sender)
    # Avoid using a Windows machine name as the Message-ID domain. Keep the
    # configured sender and envelope; this does not guarantee Gmail delivery.
    domain = sender.rsplit("@", 1)[1].encode("idna").decode("ascii")
    message = EmailMessage(subject, body, settings.DEFAULT_FROM_EMAIL, [recipient],
                           headers={"Message-ID": make_msgid(domain=domain)})
    return message.send(fail_silently=False)


class InvalidEmailFlow(Exception):
    pass


class EmailCooldown(Exception):
    def __init__(self, retry_after):
        self.retry_after = max(1, int(retry_after))


def session_digest(request):
    return salted_hmac("inox.email.session", request.session.session_key or "", algorithm="sha256").hexdigest()


@sensitive_variables()
def code_digest(challenge, token):
    return salted_hmac("inox.email.code", f"{challenge.pk}:{challenge.purpose}:{token}", algorithm="sha256").hexdigest()


def valid_context(request, user, state, purpose):
    if purpose not in ("login", "regenerate") or state.mfa_method != "email" or not request.session.session_key:
        return False
    if not user.is_active or not user.is_staff:
        return False
    if purpose == "login":
        pending = request.session.get(PENDING_KEY, {})
        return (pending.get("user_id") == user.pk and pending.get("mode") == "email"
                and pending.get("expires", 0) > time.time()
                and pending.get("version") == state.session_version
                and constant_time_compare(pending.get("auth_hash", ""), user.get_session_auth_hash()))
    return (request.user.is_authenticated and request.user.pk == user.pk
            and request.session.get(VERSION) == state.session_version
            and constant_time_compare(request.session.get("_auth_user_hash", ""), user.get_session_auth_hash()))


def clear_challenge_pointer(request, purpose):
    if purpose == "login" and PENDING_KEY in request.session:
        pending = request.session[PENDING_KEY].copy()
        pending.pop("email_challenge_id", None)
        request.session[PENDING_KEY] = pending
    else:
        request.session.pop(EMAIL_REGENERATE_KEY, None)


@sensitive_variables()
def pending_email_challenge(request, user):
    """Resume only an unconsumed login challenge bound to this exact session."""
    if not getattr(settings, "SECURITY_EMAIL_ENABLED", False):
        return None
    state = SecurityState.objects.filter(user=user).first()
    if state is None or not valid_context(request, user, state, "login"):
        return None
    challenge_id = request.session[PENDING_KEY].get("email_challenge_id")
    try:
        challenge = EmailChallenge.objects.select_related("device").filter(
            pk=challenge_id, device__user=user, purpose="login",
            consumed_at__isnull=True, invalidated_at__isnull=True,
            attempts__lt=5, expires_at__gt=timezone.now(), recipient=user.email,
            session_version=state.session_version,
        ).first()
    except (ValidationError, ValueError, TypeError):
        return None
    if (challenge is None or challenge.device.email != user.email
            or not constant_time_compare(challenge.auth_hash, user.get_session_auth_hash())
            or not constant_time_compare(challenge.session_digest, session_digest(request))):
        return None
    if not challenge.device.confirmed and not EnrollmentPermission.objects.filter(
            user=user, used_at__isnull=True, expires_at__gt=timezone.now()).exists():
        return None
    return challenge


@sensitive_variables()
def issue_email_challenge(request, user, purpose):
    if not getattr(settings, "SECURITY_EMAIL_ENABLED", False):
        raise EmailDeliveryError()
    backend = settings.EMAIL_BACKEND
    test_backend = backend == "django.core.mail.backends.locmem.EmailBackend" and getattr(settings, "ENVIRONMENT", "") == "test"
    smtp_backend = backend in SUPPORTED_SMTP_BACKENDS and bool(settings.EMAIL_HOST) and bool(settings.DEFAULT_FROM_EMAIL)
    if not (smtp_backend or test_backend or gmail_configuration_ready(settings)):
        raise EmailDeliveryError()
    failed = False
    permanently_rejected = False
    with transaction.atomic():
        state = SecurityState.objects.select_for_update().get(user=user)
        user = get_user_model().objects.get(pk=user.pk)
        if not valid_context(request, user, state, purpose):
            raise InvalidEmailFlow()
        try:
            validate_email(user.email)
        except ValidationError as exc:
            raise EmailDeliveryError() from exc
        device, _ = EmailDevice.objects.get_or_create(user=user, defaults={"name": "email", "email": user.email})
        device = EmailDevice.objects.select_for_update().get(pk=device.pk)
        if not device.email and not device.confirmed:
            device.email = user.email
            device.save(update_fields=["email"])
        if device.email != user.email:
            raise InvalidEmailFlow()
        if not device.confirmed and (purpose != "login" or not EnrollmentPermission.objects.filter(user=user, used_at__isnull=True, expires_at__gt=timezone.now()).exists()):
            raise InvalidEmailFlow()
        if device.delivery_paused_at is not None:
            raise EmailDeliveryPaused()
        now = timezone.now()
        cooldown = seconds("SECURITY_EMAIL_RESEND_SECONDS", 60)
        if device.last_sent_at and now < device.last_sent_at + timedelta(seconds=cooldown):
            raise EmailCooldown((device.last_sent_at + timedelta(seconds=cooldown) - now).total_seconds() + 1)
        # One active code per account, including parallel pending browser sessions.
        device.challenges.filter(consumed_at__isnull=True, invalidated_at__isnull=True).update(invalidated_at=now)
        token = f"{secrets.randbelow(1000000):06d}"
        expires_at = now + timedelta(seconds=min(300, seconds("SECURITY_EMAIL_CODE_SECONDS", 300)))
        if purpose == "login":
            pending_expires_at = datetime.fromtimestamp(request.session[PENDING_KEY]["expires"], tz=datetime_timezone.utc)
            expires_at = min(expires_at, pending_expires_at)
        challenge = EmailChallenge(device=device, purpose=purpose, recipient=user.email,
                                   session_digest=session_digest(request), auth_hash=user.get_session_auth_hash(),
                                   session_version=state.session_version, created_at=now,
                                   expires_at=expires_at)
        challenge.token_hash = code_digest(challenge, token)
        challenge.save()
        device.last_sent_at = now
        device.save(update_fields=["last_sent_at"])
        action = "iniciar sesión" if purpose == "login" else "generar nuevos códigos de recuperación"
        deadline = timezone.localtime(challenge.expires_at).strftime("%d/%m/%Y a las %H:%M:%S")
        try:
            delivered = send_verification_message("INOX 304 · Código de seguridad",
                                  f"Tu código para {action} es:\n\n{token}\n\nCaduca el {deadline} (hora del panel) y funciona una sola vez. Su vigencia máxima es de 5 minutos. No compartas este código. Si no lo solicitaste, ignora este mensaje.",
                                  user.email)
            failed = delivered != 1
        except Exception as error:
            _log_delivery_failure(error)
            failed = True
            status = smtp_status(error)
            permanently_rejected = status is not None and status >= 500
            if permanently_rejected:
                device.delivery_paused_at = timezone.now()
                device.delivery_smtp_code = status
                device.save(update_fields=["delivery_paused_at", "delivery_smtp_code"])
                audit("email_delivery_paused", request, user, f"smtp_{status}")
        if failed:
            challenge.invalidated_at = timezone.now()
            challenge.save(update_fields=["invalidated_at"])
            audit("email_delivery_failed", request, user, purpose)
        else:
            audit("email_code_sent", request, user, purpose)
    clear_challenge_pointer(request, purpose)
    if permanently_rejected:
        raise EmailDeliveryPaused()
    if failed:
        raise EmailDeliveryError()
    if purpose == "login":
        pending = request.session[PENDING_KEY].copy()
        pending["email_challenge_id"] = str(challenge.pk)
        request.session[PENDING_KEY] = pending
    else:
        request.session[EMAIL_REGENERATE_KEY] = str(challenge.pk)
    return challenge


@sensitive_variables()
def verify_email_challenge(request, user, challenge_id, token, purpose):
    if not getattr(settings, "SECURITY_EMAIL_ENABLED", False):
        return None
    with transaction.atomic():
        state = SecurityState.objects.select_for_update().get(user=user)
        user = get_user_model().objects.get(pk=user.pk)
        if not valid_context(request, user, state, purpose):
            return None
        device = EmailDevice.objects.select_for_update().filter(user=user).first()
        if device is None or device.email != user.email:
            return None
        if not device.confirmed and (purpose != "login" or not EnrollmentPermission.objects.filter(user=user, used_at__isnull=True, expires_at__gt=timezone.now()).exists()):
            return None
        try:
            challenge = EmailChallenge.objects.select_for_update().filter(pk=challenge_id, device=device, purpose=purpose).first()
        except (ValidationError, ValueError, TypeError):
            return None
        now = timezone.now()
        if (challenge is None or challenge.consumed_at or challenge.invalidated_at or challenge.attempts >= 5
                or challenge.expires_at <= now or challenge.recipient != user.email
                or challenge.session_version != state.session_version
                or not constant_time_compare(challenge.auth_hash, user.get_session_auth_hash())
                or not constant_time_compare(challenge.session_digest, session_digest(request))):
            return None
        challenge.attempts += 1
        token = str(token).strip()
        accepted = bool(re.fullmatch(r"[0-9]{6}", token)) and constant_time_compare(challenge.token_hash, code_digest(challenge, token))
        if accepted:
            challenge.consumed_at = now
            device.set_last_used_timestamp()
        elif challenge.attempts >= 5:
            challenge.invalidated_at = now
        challenge.save(update_fields=["attempts", "consumed_at", "invalidated_at"])
        return device if accepted else None
