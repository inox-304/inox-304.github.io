from datetime import timedelta

from django.contrib import messages
from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.core.management.base import CommandError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.utils.crypto import constant_time_compare
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.debug import sensitive_post_parameters, sensitive_variables
from django.views.decorators.http import require_GET, require_POST

from .account_forms import AccountAccessForm, AccountCreateForm, OwnerConfirmationForm, ROLE_CHOICES
from .accounts import (assign_role, current_role, effective_permissions, has_confirmed_factor,
                       protected_account, renew_initial_enrollment, role_permissions)
from .management.commands.setup_access import mail_configuration_ready
from .models import EnrollmentPermission, PasskeyGrant, SecurityState
from .passkeys import is_owner
from .services import VERSION, allow_attempt, audit, is_admin_authenticated


def require_owner(request):
    if not is_admin_authenticated(request) or not is_owner(request.user):
        raise PermissionDenied


def render_accounts(request, *, create_form=None, error="", status=200):
    roles = role_permissions()
    rows = []
    for user in get_user_model().objects.prefetch_related("user_permissions", "groups__permissions").order_by("username"):
        role = current_role(user, roles)
        permission = EnrollmentPermission.objects.filter(user=user, used_at__isnull=True).first()
        initial_pending = permission is not None and not has_confirmed_factor(user)
        initial_expired = initial_pending and permission.expires_at <= timezone.now()
        rows.append({"account": user, "protected": protected_account(user), "role": role,
                     "role_label": dict(ROLE_CHOICES).get(role, "Permisos personalizados"),
                     "can_renew": initial_expired and user.is_active and user.is_staff,
                     "initial_expired": initial_expired,
                     "initial_pending": initial_pending, "initial_expires": permission.expires_at if permission else None,
                     "access_form": AccountAccessForm(initial={"role": role}, prefix=f"account-{user.pk}"),
                     "enrollment_form": OwnerConfirmationForm(prefix=f"enrollment-{user.pk}"),
                     "confirmation_form": OwnerConfirmationForm(prefix=f"status-{user.pk}")})
    return render(request, "security/accounts.html", {
        "accounts": rows, "error": error,
        "create_form": create_form or AccountCreateForm(initial={"role": "catalog_inventory",
            "mfa_method": "email" if mail_configuration_ready() else "totp"}),
    }, status=status)


@sensitive_variables()
def revalidate_owner(request, password):
    # Match the MFA lock order. Re-check the persisted actor after acquiring locks.
    state = SecurityState.objects.select_for_update().get(user=request.user)
    actor = get_user_model().objects.select_for_update().get(pk=request.user.pk)
    if (not is_owner(actor) or not is_admin_authenticated(request)
            or request.session.get(VERSION) != state.session_version
            or not constant_time_compare(request.session.get("_auth_user_hash", ""), actor.get_session_auth_hash())
            or not actor.check_password(password)):
        raise ValidationError("Confirma tu contraseña actual de propietario. No se realizó ningún cambio.")
    return actor


@never_cache
@require_GET
def manage(request):
    require_owner(request)
    return render_accounts(request)


@sensitive_post_parameters()
@sensitive_variables()
@csrf_protect
@never_cache
@require_POST
def create(request):
    require_owner(request)
    if not allow_attempt(request, "account_manage", str(request.user.pk)):
        return render_accounts(request, error="Espera unos minutos antes de volver a intentarlo.", status=429)
    form = AccountCreateForm(request.POST)
    if not form.is_valid():
        return render_accounts(request, create_form=form, status=400)
    try:
        with transaction.atomic():
            actor = revalidate_owner(request, form.cleaned_data["owner_password"])
            email = form.cleaned_data["email"]
            if get_user_model().objects.filter(Q(username__iexact=email) | Q(email__iexact=email)).exists():
                raise ValidationError("Ya existe una cuenta con ese correo. No se modificó su acceso.")
            account = get_user_model().objects.create_user(
                username=email, email=email, first_name=form.cleaned_data["name"],
                password=form.cleaned_data["new_password"], is_staff=True, is_superuser=False, is_active=True,
            )
            assign_role(account, form.cleaned_data["role"], role_permissions())
            SecurityState.objects.create(user=account, mfa_method=form.cleaned_data["mfa_method"])
            now = timezone.now()
            EnrollmentPermission.objects.create(user=account, created_at=now, expires_at=now + timedelta(hours=24))
            audit("team_account_created", request, actor, f"account:{account.pk};role:{form.cleaned_data['role']}")
    except (ValidationError, CommandError) as exc:
        form.add_error(None, exc)
        return render_accounts(request, create_form=form, status=400)
    except IntegrityError:
        form.add_error("email", "Ya existe una cuenta con ese correo. No se modificó su acceso.")
        return render_accounts(request, create_form=form, status=400)
    messages.success(request, "Cuenta creada. Comparte la contraseña por un medio privado; la persona tiene 24 horas para completar su primera verificación. Después podrá vincular una llave con tu autorización.")
    return redirect("security:accounts")


@sensitive_post_parameters()
@sensitive_variables()
@csrf_protect
@never_cache
@require_POST
def update(request, user_id):
    require_owner(request)
    target = get_object_or_404(get_user_model(), pk=user_id)
    if protected_account(target) or target.pk == request.user.pk:
        raise PermissionDenied
    if not allow_attempt(request, "account_manage", str(request.user.pk)):
        return render_accounts(request, error="Espera unos minutos antes de volver a intentarlo.", status=429)
    action = request.POST.get("action")
    if action not in ("access", "deactivate", "reactivate", "renew_enrollment"):
        return render_accounts(request, error="Elige una acción válida para la cuenta.", status=400)
    form = (AccountAccessForm(request.POST, prefix=f"account-{user_id}") if action == "access"
            else OwnerConfirmationForm(request.POST, prefix=f"{'enrollment' if action == 'renew_enrollment' else 'status'}-{user_id}"))
    if not form.is_valid():
        return render_accounts(request, error="Revisa el acceso seleccionado y confirma tu contraseña de propietario.", status=400)
    try:
        with transaction.atomic():
            actor = revalidate_owner(request, form.cleaned_data["owner_password"])
            state = SecurityState.objects.select_for_update().filter(user=target).first()
            target = get_user_model().objects.select_for_update().get(pk=user_id)
            if protected_account(target) or target.pk == actor.pk:
                raise PermissionDenied
            if state is None:
                raise ValidationError("La cuenta necesita revisar su configuración de seguridad antes de cambiar el acceso.")
            if action == "access":
                changed = assign_role(target, form.cleaned_data["role"], role_permissions())
            elif action == "renew_enrollment":
                changed = renew_initial_enrollment(target, state)
            else:
                active = action == "reactivate"
                if active and not target.is_staff:
                    raise ValidationError("Primero asigna un acceso autorizado a esta cuenta.")
                if active and effective_permissions(target) - set().union(*role_permissions().values()):
                    raise ValidationError("Esta cuenta tiene permisos especiales y requiere revisión del responsable del servidor antes de reactivarla.")
                changed = target.is_active != active
                target.is_active = active
                if changed:
                    target.save(update_fields=["is_active"])
            if changed:
                state.session_version += 1
                state.save(update_fields=["session_version"])
                if action == "deactivate":
                    PasskeyGrant.objects.filter(user=target, used_at__isnull=True, revoked_at__isnull=True).update(revoked_at=timezone.now())
                detail = f"account:{target.pk};action:{action}"
                if action == "access":
                    detail += f";role:{form.cleaned_data['role']}"
                audit("team_account_access_changed", request, actor, detail)
    except (ValidationError, CommandError) as exc:
        return render_accounts(request, error=" ".join(exc.messages) if isinstance(exc, ValidationError) else str(exc), status=400)
    if action == "renew_enrollment":
        messages.success(request, "Primera activación renovada durante 24 horas. La persona debe iniciar sesión y confirmar su segundo factor. Su contraseña y dispositivos se conservaron." if changed else "La primera activación todavía está vigente. Se conserva su vencimiento.")
    else:
        messages.success(request, "Acceso actualizado. Las sesiones anteriores de esa cuenta ya no permiten entrar; deberá iniciar sesión otra vez." if changed else "La cuenta ya tenía esa configuración. No hubo cambios.")
    return redirect("security:accounts")
