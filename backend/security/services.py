import hashlib
import ipaddress
import secrets
import time
from datetime import timedelta

import django_otp
from django.conf import settings
from django.contrib.auth import get_user_model, login, logout
from django.contrib.auth.hashers import make_password
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import constant_time_compare
from django_otp.plugins.otp_totp.models import TOTPDevice

from .models import EnrollmentPermission, LoginThrottle, RecoveryCode, RecoveryDevice, SecurityEvent, SecurityState

PENDING_KEY = "security_pending"
AUTH_AT = "security_authenticated_at"
LAST_SEEN = "security_last_seen"
VERSION = "security_session_version"


def seconds(name, default):
    return int(getattr(settings, name, default))


def client_ip(request):
    # Only our private, explicitly trusted proxy may provide this overwritten header.
    # X-Forwarded-For and generic forwarded headers are never accepted here.
    value = request.META.get("REMOTE_ADDR", "")
    if getattr(settings, "TRUSTED_INOX_PROXY", False):
        value = request.META.get("HTTP_X_INOX_CLIENT_IP", value)
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        return None


def audit(event, request=None, user=None, detail=""):
    SecurityEvent.objects.create(event=event, user=user, ip_address=client_ip(request) if request else None, detail=detail[:200])


def state_for(user):
    return SecurityState.objects.get_or_create(user=user)[0]


def reserve_attempt(scope, identity, limit, window_seconds=900):
    """Reserve a request in a shared database window, including concurrent requests."""
    key = hashlib.sha256(f"{scope}:{identity}".encode()).hexdigest()
    now = timezone.now()
    with transaction.atomic():
        LoginThrottle.objects.get_or_create(key=key)
        throttle = LoginThrottle.objects.select_for_update().get(key=key)
        if throttle.locked_until and throttle.locked_until > now:
            return False
        if now >= throttle.window_started + timedelta(seconds=window_seconds):
            throttle.window_started = now
            throttle.attempts = 0
            throttle.locked_until = None
        throttle.attempts += 1
        allowed = throttle.attempts <= limit
        if not allowed:
            throttle.locked_until = throttle.window_started + timedelta(seconds=window_seconds)
        throttle.save(update_fields=["window_started", "attempts", "locked_until"])
        return allowed


def allow_attempt(request, stage, identity):
    ip_limit = 30 if stage == "password" else 25
    user_limit = 8 if stage == "password" else 5
    ip_allowed = reserve_attempt(f"{stage}:ip", client_ip(request) or "unknown", ip_limit)
    user_allowed = reserve_attempt(f"{stage}:account", identity, user_limit)
    return ip_allowed and user_allowed


def start_pending(request, user, mode):
    logout(request)
    request.session.cycle_key()
    request.session[PENDING_KEY] = {
        "user_id": user.pk,
        "auth_hash": user.get_session_auth_hash(),
        "version": state_for(user).session_version,
        "expires": time.time() + seconds("SECURITY_PENDING_SECONDS", 300),
        "mode": mode,
    }
    request.session.set_expiry(seconds("SECURITY_PENDING_SECONDS", 300))


def pending_user(request, mode=None):
    pending = request.session.get(PENDING_KEY)
    if not isinstance(pending, dict):
        return None
    if pending.get("expires", 0) <= time.time() or (mode and pending.get("mode") != mode):
        request.session.flush()
        return None
    user = get_user_model().objects.filter(pk=pending.get("user_id"), is_active=True, is_staff=True).first()
    if user is None or not constant_time_compare(pending.get("auth_hash", ""), user.get_session_auth_hash()) or pending.get("version") != state_for(user).session_version:
        request.session.flush()
        return None
    return user


def enrollment_allowed(user):
    return EnrollmentPermission.objects.filter(user=user, used_at__isnull=True, expires_at__gt=timezone.now()).exists()


def is_admin_authenticated(request):
    user = request.user
    if not (user.is_authenticated and user.is_active and user.is_staff and getattr(user, "is_verified", lambda: False)()):
        return False
    device = user.otp_device
    if not device.confirmed or device.user_id != user.pk:
        return False
    now = time.time()
    authenticated_at = request.session.get(AUTH_AT, 0)
    last_seen = request.session.get(LAST_SEEN, 0)
    if not authenticated_at or now >= authenticated_at + seconds("SECURITY_SESSION_SECONDS", 28800):
        return False
    if not last_seen or now >= last_seen + seconds("SECURITY_IDLE_SECONDS", 1800):
        return False
    return request.session.get(VERSION) == state_for(user).session_version


def complete_login(request, user, device, version=None):
    request.session.flush()
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    django_otp.login(request, device)
    now = time.time()
    request.session[AUTH_AT] = now
    request.session[LAST_SEEN] = now
    request.session[VERSION] = version if version is not None else state_for(user).session_version
    request.session.set_expiry(seconds("SECURITY_SESSION_SECONDS", 28800))
    audit("login_success", request, user, "recovery" if isinstance(device, RecoveryDevice) else "totp")


def revoke_sessions(user):
    """Call inside a transaction; session checks reject all previous versions."""
    state_for(user)
    state = SecurityState.objects.select_for_update().get(user=user)
    state.session_version += 1
    state.save(update_fields=["session_version"])
    return state.session_version


def generate_recovery_codes(user):
    """The plaintext result goes only to this response, never to the session."""
    RecoveryDevice.objects.filter(user=user).delete()
    device = RecoveryDevice.objects.create(user=user, name="recovery", confirmed=True)
    codes = []
    for _ in range(10):
        token = secrets.token_hex(16).upper()
        RecoveryCode.objects.create(device=device, selector=token[:8], token_hash=make_password(token))
        codes.append("-".join(token[index:index + 8] for index in range(0, 32, 8)))
    return device, codes


def verify_device(user, method, token):
    """Verify and consume the token under a database row lock."""
    model = RecoveryDevice if method == "recovery" else TOTPDevice
    device = model.objects.select_for_update().filter(user=user, confirmed=True).first()
    if device is None:
        return None
    # DB request quotas remain in force; clear exponential delays after a cooldown.
    if isinstance(device, TOTPDevice) and device.throttling_failure_timestamp and device.throttling_failure_timestamp <= timezone.now() - timedelta(minutes=15):
        device.throttle_reset()
    return device if device.verify_token(token) else None
