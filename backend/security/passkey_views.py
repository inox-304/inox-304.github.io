"""Password + WebAuthn, with personal enrollment authorized by the owner."""
import json
import secrets
import time
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.urls import reverse
from django.utils import timezone
from django.utils.crypto import constant_time_compare
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.debug import sensitive_post_parameters, sensitive_variables
from django.views.decorators.http import require_GET, require_POST
from webauthn import (base64url_to_bytes, generate_authentication_options, generate_registration_options,
                      options_to_json, verify_authentication_response, verify_registration_response)
from webauthn.helpers.exceptions import WebAuthnException
from webauthn.helpers.structs import (AuthenticatorSelectionCriteria, PublicKeyCredentialDescriptor,
                                    ResidentKeyRequirement, UserVerificationRequirement)

from .email_auth import session_digest
from .models import PasskeyChallenge, PasskeyDevice, PasskeyGrant, PasskeyIdentity, SecurityState
from .passkeys import active_devices, configuration, encode_bytes, is_owner
from .services import (PENDING_KEY, VERSION, allow_attempt, audit, complete_login, is_admin_authenticated,
                       pending_user)


def error(message="No se pudo verificar la llave. Inicia un intento nuevo.", status=400):
    return JsonResponse({"error": message}, status=status)


def payload(request):
    if len(request.body) > 32768:
        raise ValueError("Oversized credential")
    value = json.loads(request.body)
    if not isinstance(value, dict):
        raise ValueError("Invalid object")
    return value


def context_valid(request, user, state, purpose):
    if not user.is_active or not user.is_staff:
        return False
    if purpose == "register":
        return (is_admin_authenticated(request) and request.user.pk == user.pk
                and request.session.get(VERSION) == state.session_version
                and constant_time_compare(request.session.get("_auth_user_hash", ""), user.get_session_auth_hash()))
    pending = request.session.get(PENDING_KEY, {})
    return (pending.get("mode") == "passkey" and pending.get("user_id") == user.pk
            and pending.get("expires", 0) > time.time() and pending.get("version") == state.session_version
            and constant_time_compare(pending.get("auth_hash", ""), user.get_session_auth_hash()))


def available_grants(user):
    return PasskeyGrant.objects.filter(user=user, used_at__isnull=True, revoked_at__isnull=True,
        expires_at__gt=timezone.now(), authorized_by__is_active=True, authorized_by__is_staff=True,
        authorized_by__username__iexact=getattr(settings, "SECURITY_OWNER_USERNAME", ""))


def create_challenge(request, user, state, purpose, config, *, label="", grant=None):
    now = timezone.now()
    expires = now + timedelta(minutes=3)
    if purpose == "login":
        expires = min(expires, timezone.datetime.fromtimestamp(request.session[PENDING_KEY]["expires"], tz=timezone.get_default_timezone()))
    PasskeyChallenge.objects.filter(user=user, purpose=purpose, session_digest=session_digest(request),
                                    consumed_at__isnull=True).update(consumed_at=now)
    return PasskeyChallenge.objects.create(user=user, purpose=purpose, challenge=secrets.token_bytes(32),
        session_digest=session_digest(request), auth_hash=user.get_session_auth_hash(), session_version=state.session_version,
        rp_id=config[0], origin=config[1], label=label, grant=grant, expires_at=expires)


def consume_challenge(request, user, state, data, purpose, config):
    if not isinstance(data.get("challenge_id"), str):
        return None
    item = PasskeyChallenge.objects.select_for_update().filter(pk=data.get("challenge_id"), user=user,
                                                               purpose=purpose, consumed_at__isnull=True).first()
    if item is None:
        return None
    valid = (item.expires_at > timezone.now() and item.rp_id == config[0] and item.origin == config[1]
             and item.session_version == state.session_version and context_valid(request, user, state, purpose)
             and constant_time_compare(item.session_digest, session_digest(request))
             and constant_time_compare(item.auth_hash, user.get_session_auth_hash()))
    # A different browser must not consume another session's challenge.
    if not constant_time_compare(item.session_digest, session_digest(request)):
        return None
    item.consumed_at = timezone.now()
    item.save(update_fields=["consumed_at"])
    return item if valid else None


def credential_data(data):
    credential = data.get("credential")
    if not isinstance(credential, dict):
        raise ValueError("Invalid credential")
    response = credential.get("response")
    if (not isinstance(response, dict) or not isinstance(response.get("clientDataJSON"), str)
            or not isinstance(credential.get("id"), str) or not isinstance(credential.get("rawId"), str)):
        raise ValueError("Invalid credential structure")
    client = json.loads(base64url_to_bytes(credential["response"]["clientDataJSON"]))
    if not isinstance(client, dict) or client.get("crossOrigin", False) is not False or "topOrigin" in client:
        raise ValueError("Cross-origin ceremony")
    return credential


@never_cache
@require_GET
def manage(request):
    if not is_admin_authenticated(request):
        return redirect("security:login")
    owner = is_owner(request.user)
    devices = PasskeyDevice.objects.select_related("user").order_by("user_id", "created_at")
    if not owner:
        devices = devices.filter(user=request.user)
    return render(request, "security/passkeys.html", {
        "configured": configuration() is not None, "is_owner": owner, "devices": devices,
        "grants": available_grants(request.user),
        "issued_grants": PasskeyGrant.objects.filter(authorized_by=request.user, used_at__isnull=True, revoked_at__isnull=True,
            expires_at__gt=timezone.now()).select_related("user") if owner else [],
        "managed_users": get_user_model().objects.filter(is_active=True, is_staff=True) if owner else [],
    })


@sensitive_post_parameters()
@csrf_protect
@never_cache
@require_POST
def grant(request):
    if not is_admin_authenticated(request) or not is_owner(request.user):
        return error("Solo el propietario puede autorizar dispositivos.", 403)
    if configuration() is None:
        return error("Falta configurar la dirección segura del panel.", 503)
    if not allow_attempt(request, "passkey_manage", str(request.user.pk)):
        return error("Espera unos minutos antes de volver a intentarlo.", 429)
    label = request.POST.get("label", "").strip()
    if not 1 <= len(label) <= 64:
        return error("Revisa el nombre del dispositivo y tu contraseña.")
    with transaction.atomic():
        state = SecurityState.objects.select_for_update().get(user=request.user)
        actor = get_user_model().objects.select_for_update().get(pk=request.user.pk)
        if (not context_valid(request, actor, state, "register") or not is_owner(actor)
                or not actor.check_password(request.POST.get("password", ""))):
            return error(status=403)
        try:
            target_id = int(request.POST.get("user_id", "0"))
        except ValueError:
            return error("La cuenta seleccionada no está autorizada.")
        target = get_user_model().objects.filter(pk=target_id, is_active=True, is_staff=True).first()
        if target is None:
            return error("La cuenta seleccionada no está autorizada.")
        PasskeyGrant.objects.create(user=target, authorized_by=request.user, label=label,
                                    expires_at=timezone.now() + timedelta(hours=24))
        audit("passkey_enrollment_authorized", request, request.user, f"account:{target.pk}")
    return redirect("security:passkeys")


@sensitive_post_parameters()
@sensitive_variables()
@csrf_protect
@never_cache
@require_POST
def register_options(request):
    config = configuration()
    if not is_admin_authenticated(request):
        return error("Inicia sesión y completa la verificación antes de vincular una llave.", 403)
    if config is None:
        return error("Falta configurar la dirección segura del panel.", 503)
    if not allow_attempt(request, "passkey_manage", str(request.user.pk)):
        return error(status=429)
    try:
        data = payload(request)
        with transaction.atomic():
            state = SecurityState.objects.select_for_update().get(user=request.user)
            user = get_user_model().objects.get(pk=request.user.pk)
            if not context_valid(request, user, state, "register") or not user.check_password(data.get("password", "")):
                return error("Confirma tu contraseña para vincular este dispositivo.", 403)
            authorization = None
            if is_owner(user):
                label = str(data.get("label", "")).strip()
            else:
                authorization = available_grants(user).select_for_update(of=("self",)).filter(pk=data.get("grant_id")).first()
                if authorization is None:
                    return error("El propietario debe autorizar esta vinculación.", 403)
                label = authorization.label
            if not 1 <= len(label) <= 64:
                return error("Escribe un nombre de hasta 64 caracteres para reconocer la llave.")
            identity, _ = PasskeyIdentity.objects.get_or_create(user=user)
            item = create_challenge(request, user, state, "register", config, label=label, grant=authorization)
            options = generate_registration_options(rp_id=config[0], rp_name="INOX 304", user_name=user.username,
                user_id=identity.handle.bytes, challenge=bytes(item.challenge), timeout=120000,
                exclude_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(device.credential_id)) for device in active_devices(user)],
                authenticator_selection=AuthenticatorSelectionCriteria(resident_key=ResidentKeyRequirement.PREFERRED,
                    user_verification=UserVerificationRequirement.REQUIRED))
        return JsonResponse({"publicKey": json.loads(options_to_json(options)), "challengeId": str(item.pk)})
    except (ValueError, TypeError, ValidationError):
        return error()


@sensitive_post_parameters()
@sensitive_variables()
@csrf_protect
@never_cache
@require_POST
def register_verify(request):
    config = configuration()
    if not is_admin_authenticated(request) or config is None:
        return error(status=403)
    if not allow_attempt(request, "passkey_verify", str(request.user.pk)):
        return error(status=429)
    try:
        data = payload(request)
        with transaction.atomic():
            state = SecurityState.objects.select_for_update().get(user=request.user)
            user = get_user_model().objects.get(pk=request.user.pk)
            item = consume_challenge(request, user, state, data, "register", config)
            if item is None:
                return error()
            authorization = None
            if item.grant_id:
                authorization = available_grants(user).select_for_update(of=("self",)).filter(pk=item.grant_id).first()
                if authorization is None:
                    return error("La autorización ya no está vigente.", 403)
            elif not is_owner(user):
                return error(status=403)
            try:
                verification = verify_registration_response(credential=credential_data(data), expected_challenge=bytes(item.challenge),
                    expected_rp_id=config[0], expected_origin=config[1], require_user_verification=True)
                if not 1 <= len(verification.credential_id) <= 1023:
                    raise ValueError("Invalid credential ID length")
            except (WebAuthnException, ValueError, TypeError, KeyError):
                audit("passkey_registration_rejected", request, user)
                return error()
            try:
                with transaction.atomic():
                    device = PasskeyDevice.objects.create(user=user, name=item.label, confirmed=True,
                        credential_id=encode_bytes(verification.credential_id), public_key=verification.credential_public_key,
                        sign_count=verification.sign_count, rp_id=config[0], origin=config[1], backed_up=verification.credential_backed_up,
                        device_type=verification.credential_device_type.value)
            except IntegrityError:
                return error("Esta llave ya está registrada.", 409)
            if authorization:
                authorization.used_at = timezone.now()
                authorization.save(update_fields=["used_at"])
            audit("passkey_registered", request, user, f"key:{device.pk}")
        return JsonResponse({"redirect": reverse("security:passkeys")})
    except (ValueError, TypeError, ValidationError):
        return error()


@never_cache
@require_GET
def login_page(request):
    user = pending_user(request, "passkey")
    if user is None:
        return redirect("security:login")
    return render(request, "security/passkey_login.html", {"configured": configuration() is not None,
        "email_fallback": SecurityState.objects.get(user=user).mfa_method == "email"})


@csrf_protect
@never_cache
@require_POST
def login_options(request):
    user = pending_user(request, "passkey")
    config = configuration()
    if user is None or config is None:
        return error(status=403)
    if not allow_attempt(request, "passkey_options", str(user.pk)):
        return error(status=429)
    with transaction.atomic():
        state = SecurityState.objects.select_for_update().get(user=user)
        user = get_user_model().objects.get(pk=user.pk)
        if not context_valid(request, user, state, "login"):
            return error(status=403)
        devices = list(active_devices(user))
        if not devices:
            return error("No hay una llave activa. Utiliza tu recuperación.")
        item = create_challenge(request, user, state, "login", config)
        item.allowed_credentials = [device.credential_id for device in devices]
        item.save(update_fields=["allowed_credentials"])
        options = generate_authentication_options(rp_id=config[0], challenge=bytes(item.challenge), timeout=120000,
            allow_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(device.credential_id)) for device in devices],
            user_verification=UserVerificationRequirement.REQUIRED)
    return JsonResponse({"publicKey": json.loads(options_to_json(options)), "challengeId": str(item.pk)})


@sensitive_post_parameters()
@sensitive_variables()
@csrf_protect
@never_cache
@require_POST
def login_verify(request):
    user = pending_user(request, "passkey")
    config = configuration()
    if user is None or config is None:
        return error(status=403)
    if not allow_attempt(request, "otp", str(user.pk)):
        return error(status=429)
    try:
        data = payload(request)
        with transaction.atomic():
            state = SecurityState.objects.select_for_update().get(user=user)
            user = get_user_model().objects.get(pk=user.pk)
            item = consume_challenge(request, user, state, data, "login", config)
            if item is None:
                return error()
            try:
                credential = credential_data(data)
                credential_id = encode_bytes(base64url_to_bytes(credential["id"]))
                device = active_devices(user).select_for_update().filter(credential_id=credential_id,
                    credential_id__in=item.allowed_credentials).first()
                if device is None:
                    return error()
                handle = credential["response"].get("userHandle")
                identity = PasskeyIdentity.objects.get(user=user)
                if handle is not None and not constant_time_compare(base64url_to_bytes(handle), identity.handle.bytes):
                    return error()
                verification = verify_authentication_response(credential=credential, expected_challenge=bytes(item.challenge),
                    expected_rp_id=config[0], expected_origin=config[1], credential_public_key=bytes(device.public_key),
                    credential_current_sign_count=device.sign_count, require_user_verification=True)
                if verification.credential_device_type.value != device.device_type:
                    return error()
            except (WebAuthnException, ValueError, TypeError, KeyError, PasskeyIdentity.DoesNotExist):
                audit("passkey_login_rejected", request, user)
                return error()
            device.sign_count = verification.new_sign_count
            device.backed_up = verification.credential_backed_up
            device.last_used_at = timezone.now()
            device.save(update_fields=["sign_count", "backed_up", "last_used_at"])
            complete_login(request, user, device, state.session_version)
        return JsonResponse({"redirect": reverse("admin:index")})
    except (ValueError, TypeError, ValidationError):
        return error()


@sensitive_post_parameters("password")
@csrf_protect
@never_cache
@require_POST
def revoke(request, device_id):
    if not is_admin_authenticated(request) or not is_owner(request.user):
        return error("Solo el propietario puede revocar llaves.", 403)
    if configuration() is None:
        return error("Falta configurar la dirección segura del panel.", 503)
    if not allow_attempt(request, "passkey_manage", str(request.user.pk)):
        return error(status=429)
    with transaction.atomic():
        state = SecurityState.objects.select_for_update().get(user=request.user)
        actor = get_user_model().objects.select_for_update().get(pk=request.user.pk)
        if (not context_valid(request, actor, state, "register") or not is_owner(actor)
                or not actor.check_password(request.POST.get("password", ""))):
            return error(status=403)
        device = PasskeyDevice.objects.select_for_update().filter(pk=device_id, revoked_at__isnull=True).first()
        if device is None:
            return error(status=404)
        device.revoked_at = timezone.now()
        device.confirmed = False
        device.save(update_fields=["revoked_at", "confirmed"])
        audit("passkey_revoked", request, request.user, f"key:{device.pk};account:{device.user_id}")
    return redirect("security:passkeys")


@csrf_protect
@never_cache
@require_POST
def email_fallback(request):
    user = pending_user(request, "passkey")
    if user is None or SecurityState.objects.get(user=user).mfa_method != "email":
        return error(status=403)
    # An explicit choice is required; canceling WebAuthn never sends mail.
    pending = request.session[PENDING_KEY].copy()
    pending["mode"] = "email"
    request.session[PENDING_KEY] = pending
    from .email_views import send_login_code
    return send_login_code(request, user)


@sensitive_post_parameters("password")
@csrf_protect
@never_cache
@require_POST
def revoke_grant(request, grant_id):
    if not is_admin_authenticated(request) or not is_owner(request.user):
        return error("Solo el propietario puede revocar autorizaciones.", 403)
    if configuration() is None:
        return error(status=503)
    if not allow_attempt(request, "passkey_manage", str(request.user.pk)):
        return error(status=429)
    with transaction.atomic():
        state = SecurityState.objects.select_for_update().get(user=request.user)
        actor = get_user_model().objects.select_for_update().get(pk=request.user.pk)
        if (not context_valid(request, actor, state, "register") or not is_owner(actor)
                or not actor.check_password(request.POST.get("password", ""))):
            return error(status=403)
        authorization = PasskeyGrant.objects.select_for_update().filter(pk=grant_id, used_at__isnull=True,
            revoked_at__isnull=True).first()
        if authorization is None:
            return error(status=404)
        authorization.revoked_at = timezone.now()
        authorization.save(update_fields=["revoked_at"])
        audit("passkey_grant_revoked", request, actor, f"grant:{authorization.pk}")
    return redirect("security:passkeys")
