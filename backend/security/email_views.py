import django_otp
from django.db import transaction
from django.shortcuts import redirect, render
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.debug import sensitive_post_parameters
from django.views.decorators.http import require_POST, require_http_methods

from .email_auth import (EMAIL_REGENERATE_KEY, EmailCooldown, EmailDeliveryError,
                         InvalidEmailFlow, clear_challenge_pointer,
                         issue_email_challenge, verify_email_challenge)
from .forms import EmailCodeForm
from .models import EmailDevice, EnrollmentPermission, RecoveryCode, SecurityState
from .services import (PENDING_KEY, VERSION, allow_attempt, audit, complete_login,
                       generate_recovery_codes, is_admin_authenticated,
                       pending_user, revoke_sessions, state_for)
from .views import codes_response, limited


def email_error(request, user, error, purpose="login"):
    if isinstance(error, EmailCooldown):
        response = render(request, "security/email_error.html", {
            "title": "Espera antes de reenviar", "message": f"Puedes solicitar otro código en {error.retry_after} segundos.",
            "can_recover": purpose == "login" and EmailDevice.objects.filter(user=user, confirmed=True).exists(),
            "retry_login": purpose == "login", "has_code": bool(request.session.get(PENDING_KEY, {}).get("email_challenge_id")),
        }, status=429)
        response["Retry-After"] = str(error.retry_after)
        return response
    if isinstance(error, InvalidEmailFlow):
        return redirect("security:login")
    audit("email_unavailable", request, user, purpose)
    return render(request, "security/email_error.html", {
        "title": "No pudimos enviar el código", "message": "El servicio de correo no está disponible. Inténtalo más tarde o contacta al responsable del sistema.",
        "can_recover": purpose == "login" and EmailDevice.objects.filter(user=user, confirmed=True).exists(),
        "retry_login": purpose == "login",
    }, status=400)


def send_login_code(request, user):
    if not allow_attempt(request, "email_send", str(user.pk)):
        return limited(request, user)
    try:
        issue_email_challenge(request, user, "login")
    except (EmailDeliveryError, EmailCooldown, InvalidEmailFlow) as error:
        return email_error(request, user, error)
    return redirect("security:email_verify")


@sensitive_post_parameters("token")
@csrf_protect
@never_cache
@require_http_methods(["GET", "POST"])
def email_verify(request):
    user = pending_user(request, "email")
    if user is None:
        return redirect("security:login")
    challenge_id = request.session[PENDING_KEY].get("email_challenge_id")
    if not challenge_id:
        return email_error(request, user, EmailDeliveryError())
    form = EmailCodeForm(request.POST or None)
    if request.method == "POST":
        if not allow_attempt(request, "otp", str(user.pk)):
            return limited(request, user)
        form_valid = form.is_valid()
        with transaction.atomic():
            state = SecurityState.objects.select_for_update().get(user=user)
            device = verify_email_challenge(request, user, challenge_id, request.POST.get("token", "")[:64], "login")
            if device:
                codes = None
                version = state.session_version
                if not device.confirmed:
                    permission = EnrollmentPermission.objects.select_for_update().filter(user=user, used_at__isnull=True, expires_at__gt=timezone.now()).first()
                    if permission is None:
                        request.session.flush()
                        return redirect("security:login")
                    permission.used_at = timezone.now()
                    permission.save(update_fields=["used_at"])
                    device.confirmed = True
                    device.save(update_fields=["confirmed"])
                    version = revoke_sessions(user)
                    _, codes = generate_recovery_codes(user)
                    audit("email_enrolled", request, user)
                complete_login(request, user, device, version)
                return codes_response(request, codes) if codes else redirect("admin:index")
        audit("email_code_rejected", request, user, "login")
        if form_valid:
            form.add_error("token", "El código no es válido, ya se utilizó o caducó.")
    return render(request, "security/email.html", {"form": form, "can_recover": EmailDevice.objects.filter(user=user, confirmed=True).exists()})


@csrf_protect
@never_cache
@require_POST
def email_resend(request):
    user = pending_user(request, "email")
    if user is None:
        return redirect("security:login")
    return send_login_code(request, user)


@csrf_protect
@never_cache
@require_POST
def email_regenerate_send(request):
    if not is_admin_authenticated(request) or state_for(request.user).mfa_method != "email":
        return redirect("security:login")
    if not allow_attempt(request, "email_send", str(request.user.pk)):
        return limited(request, request.user)
    try:
        issue_email_challenge(request, request.user, "regenerate")
    except (EmailDeliveryError, EmailCooldown, InvalidEmailFlow) as error:
        return email_error(request, request.user, error, "regenerate")
    return redirect("security:recovery_codes")


@sensitive_post_parameters("token")
@csrf_protect
@never_cache
@require_POST
def email_regenerate_verify(request):
    if not is_admin_authenticated(request) or state_for(request.user).mfa_method != "email":
        return redirect("security:login")
    if not allow_attempt(request, "otp", str(request.user.pk)):
        return limited(request, request.user)
    form = EmailCodeForm(request.POST)
    form_valid = form.is_valid()
    with transaction.atomic():
        SecurityState.objects.select_for_update().get(user=request.user)
        device = verify_email_challenge(request, request.user, request.session.get(EMAIL_REGENERATE_KEY), request.POST.get("token", "")[:64], "regenerate")
        if device:
            version = revoke_sessions(request.user)
            _, codes = generate_recovery_codes(request.user)
            django_otp.login(request, device)
            request.session[VERSION] = version
            clear_challenge_pointer(request, "regenerate")
            audit("recovery_codes_regenerated", request, request.user, "email")
            return codes_response(request, codes)
    audit("email_code_rejected", request, request.user, "regenerate")
    if form_valid:
        form.add_error("token", "El código no es válido, ya se utilizó o caducó. Solicita un código nuevo para esta operación.")
    remaining = RecoveryCode.objects.filter(device__user=request.user, used_at__isnull=True).count()
    return render(request, "security/recovery.html", {"form": form, "remaining": remaining, "email_mode": True, "email_challenge_pending": bool(request.session.get(EMAIL_REGENERATE_KEY))}, status=400)
