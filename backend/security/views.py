import base64
from datetime import timedelta
from io import BytesIO
from urllib.parse import quote

import django_otp
import qrcode
from django.contrib.auth import authenticate, logout
from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import redirect, render
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.debug import sensitive_post_parameters
from django.views.decorators.http import require_GET, require_POST, require_http_methods
from django_otp.plugins.otp_totp.models import TOTPDevice

from .forms import EmailCodeForm, LoginForm, OTPForm, TOTPForm
from .models import EmailDevice, EnrollmentPermission, RecoveryCode, SecurityState
from .services import (PENDING_KEY, VERSION, allow_attempt, audit, complete_login,
                       enrollment_allowed, generate_recovery_codes,
                       is_admin_authenticated, pending_user, revoke_sessions,
                       start_pending, state_for, verify_device)


def limited(request, user=None):
    audit("rate_limited", request, user)
    response = render(request, "security/message.html", {"title": "Espera unos minutos", "message": "Se alcanzó el límite de intentos. Vuelve a intentarlo en 15 minutos."}, status=429)
    response["Retry-After"] = "900"
    return response


def codes_response(request, codes):
    text = "INOX 304 — códigos de recuperación\nCada código funciona una sola vez. Guárdalos fuera de este dispositivo.\n\n" + "\n".join(codes) + "\n"
    return render(request, "security/codes.html", {"codes": codes, "download_url": "data:text/plain;charset=utf-8," + quote(text)})


@sensitive_post_parameters("password")
@csrf_protect
@never_cache
@require_http_methods(["GET", "POST"])
def login_view(request):
    if request.method == "GET" and is_admin_authenticated(request):
        return redirect("admin:index")
    form = LoginForm(request.POST or None)
    if request.method == "POST":
        identity = request.POST.get("email", "").strip().lower()[:254]
        if not allow_attempt(request, "password", identity):
            return limited(request)
        if form.is_valid():
            user = authenticate(request, username=form.cleaned_data["email"], password=form.cleaned_data["password"])
            if user and user.is_active and user.is_staff:
                if state_for(user).mfa_method == "email":
                    has_device = EmailDevice.objects.filter(user=user, confirmed=True, email=user.email).exclude(email="").exists()
                    if has_device or enrollment_allowed(user):
                        from .email_views import send_login_code
                        start_pending(request, user, "email")
                        audit("password_verified", request, user)
                        return send_login_code(request, user)
                    form.add_error(None, "La activación de tu cuenta requiere autorización del responsable del sistema.")
                    return render(request, "security/login.html", {"form": form})
                has_device = TOTPDevice.objects.filter(user=user, confirmed=True).exists()
                if has_device or enrollment_allowed(user):
                    start_pending(request, user, "otp" if has_device else "setup")
                    audit("password_verified", request, user)
                    return redirect("security:otp" if has_device else "security:setup")
            audit("password_rejected", request)
            form.add_error(None, "No fue posible iniciar sesión con esas credenciales. Si necesitas activar el acceso, contacta al responsable del sistema.")
    return render(request, "security/login.html", {"form": form})


@sensitive_post_parameters("token")
@csrf_protect
@never_cache
@require_http_methods(["GET", "POST"])
def otp_view(request):
    user = pending_user(request)
    if user is None:
        return redirect("security:login")
    mode = request.session[PENDING_KEY].get("mode")
    if mode not in ("otp", "email"):
        return redirect("security:login")
    email_mode = mode == "email"
    if email_mode and not EmailDevice.objects.filter(user=user, confirmed=True, email=user.email).exclude(email="").exists():
        return redirect("security:email_verify")
    form = OTPForm(request.POST or None, initial={"method": "recovery" if email_mode else "totp"})
    if email_mode:
        form.fields["method"].choices = [("recovery", "Código de recuperación")]
    if request.method == "POST":
        if not allow_attempt(request, "otp", str(user.pk)):
            return limited(request, user)
        if form.is_valid():
            with transaction.atomic():
                state = SecurityState.objects.select_for_update().get(user=user)
                # A reset in another request invalidates this pending login too.
                if request.session[PENDING_KEY]["version"] != state.session_version:
                    request.session.flush()
                    return redirect("security:login")
                device = verify_device(user, form.cleaned_data["method"], form.cleaned_data["token"])
                if device:
                    version = state.session_version
                    if form.cleaned_data["method"] == "recovery":
                        version = revoke_sessions(user)
                        audit("recovery_code_used", request, user)
                    complete_login(request, user, device, version)
                    return redirect("admin:index")
            audit("otp_rejected", request, user)
            form.add_error("token", "El código no es válido, ya se utilizó o caducó. Espera al siguiente código e inténtalo de nuevo.")
    return render(request, "security/otp.html", {"form": form, "email_mode": email_mode})


def setup_device(request, user):
    """Only an unconsumed CLI authorization may create an unconfirmed device."""
    with transaction.atomic():
        permission = EnrollmentPermission.objects.select_for_update().filter(user=user, used_at__isnull=True, expires_at__gt=timezone.now()).first()
        if permission is None or TOTPDevice.objects.filter(user=user, confirmed=True).exists():
            return None
        pending = request.session[PENDING_KEY]
        device = TOTPDevice.objects.filter(pk=pending.get("device_id"), user=user, confirmed=False).first()
        if device is None:
            device = TOTPDevice.objects.create(user=user, name="default", confirmed=False, tolerance=1)
            pending["device_id"] = device.pk
            request.session[PENDING_KEY] = pending
        return device


@sensitive_post_parameters("token")
@csrf_protect
@never_cache
@require_http_methods(["GET", "POST"])
def setup_view(request):
    user = pending_user(request, "setup")
    if user is None:
        return redirect("security:login")
    device = setup_device(request, user)
    if device is None:
        request.session.flush()
        return redirect("security:login")
    form = TOTPForm(request.POST or None)
    if request.method == "POST":
        if not allow_attempt(request, "otp", str(user.pk)):
            return limited(request, user)
        if form.is_valid():
            with transaction.atomic():
                state = SecurityState.objects.select_for_update().get(user=user)
                permission = EnrollmentPermission.objects.select_for_update().filter(user=user, used_at__isnull=True, expires_at__gt=timezone.now()).first()
                device = TOTPDevice.objects.select_for_update().filter(pk=device.pk, user=user, confirmed=False).first()
                if permission is None or device is None or state.session_version != request.session[PENDING_KEY]["version"] or TOTPDevice.objects.filter(user=user, confirmed=True).exists():
                    request.session.flush()
                    return redirect("security:login")
                if device.verify_token(form.cleaned_data["token"]):
                    device.confirmed = True
                    device.save(update_fields=["confirmed"])
                    permission.used_at = timezone.now()
                    permission.save(update_fields=["used_at"])
                    version = revoke_sessions(user)
                    _, codes = generate_recovery_codes(user)
                    TOTPDevice.objects.filter(user=user, confirmed=False).delete()
                    complete_login(request, user, device, version)
                    audit("totp_enrolled", request, user)
                    return codes_response(request, codes)
            audit("enrollment_code_rejected", request, user)
            form.add_error("token", "El código no coincide. Revisa la hora del teléfono y usa el código actual.")
    secret = base64.b32encode(device.bin_key).decode()
    return render(request, "security/setup.html", {"form": form, "secret": secret})


@never_cache
@require_GET
def setup_qr(request):
    user = pending_user(request, "setup")
    if user is None or not enrollment_allowed(user):
        return HttpResponse(status=404)
    device = TOTPDevice.objects.filter(pk=request.session[PENDING_KEY].get("device_id"), user=user, confirmed=False).first()
    if device is None:
        return HttpResponse(status=404)
    output = BytesIO()
    qrcode.make(device.config_url).save(output, format="PNG")
    return HttpResponse(output.getvalue(), content_type="image/png")


@never_cache
@require_GET
def recovery_codes(request):
    if not is_admin_authenticated(request):
        return redirect("security:login")
    remaining = RecoveryCode.objects.filter(device__user=request.user, used_at__isnull=True).count()
    from .email_auth import EMAIL_REGENERATE_KEY
    email_mode = state_for(request.user).mfa_method == "email"
    return render(request, "security/recovery.html", {"form": EmailCodeForm() if email_mode else TOTPForm(), "remaining": remaining, "email_mode": email_mode, "email_challenge_pending": bool(request.session.get(EMAIL_REGENERATE_KEY))})


@sensitive_post_parameters("token")
@csrf_protect
@never_cache
@require_POST
def regenerate_codes(request):
    if not is_admin_authenticated(request):
        return redirect("security:login")
    if state_for(request.user).mfa_method == "email":
        return redirect("security:recovery_codes")
    if not allow_attempt(request, "otp", str(request.user.pk)):
        return limited(request, request.user)
    form = TOTPForm(request.POST)
    if form.is_valid():
        with transaction.atomic():
            state = SecurityState.objects.select_for_update().get(user=request.user)
            if request.session.get(VERSION) != state.session_version:
                logout(request)
                return redirect("security:login")
            device = verify_device(request.user, "totp", form.cleaned_data["token"])
            if device:
                version = revoke_sessions(request.user)
                _, codes = generate_recovery_codes(request.user)
                django_otp.login(request, device)
                request.session[VERSION] = version
                audit("recovery_codes_regenerated", request, request.user)
                return codes_response(request, codes)
        audit("otp_rejected", request, request.user, "regenerate")
        form.add_error("token", "El código no es válido o ya se utilizó. Espera al siguiente código.")
    remaining = RecoveryCode.objects.filter(device__user=request.user, used_at__isnull=True).count()
    return render(request, "security/recovery.html", {"form": form, "remaining": remaining}, status=400)


@csrf_protect
@never_cache
@require_POST
def logout_view(request):
    user = request.user if request.user.is_authenticated else None
    audit("logout", request, user)
    logout(request)
    return redirect("security:login")
