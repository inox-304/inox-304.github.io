"""Closed commercial roles; no account deletion, credential resets or owner grants."""
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import Permission
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.utils import timezone

from .management.commands.configure_business_roles import commercial_permission_ids
from .management.commands.setup_access import has_confirmed_device, mail_configuration_ready
from .models import EmailDevice, EnrollmentPermission, PasskeyDevice


def protected_account(user):
    owner = str(getattr(settings, "SECURITY_OWNER_USERNAME", "") or "").casefold()
    return user.is_superuser or bool(owner and user.username.casefold() == owner)


def role_permissions():
    allowed = commercial_permission_ids()
    inventory = set(Permission.objects.filter(content_type__app_label="catalog",
        content_type__model="product", codename="view_inventory").values_list("pk", flat=True))
    if len(inventory) != 1:
        raise ValidationError("Falta completar la instalación de permisos del inventario.")
    return {"catalog_inventory": allowed, "catalog": allowed - inventory, "inventory": inventory}


def effective_permissions(user):
    result = {permission.pk for permission in user.user_permissions.all()}
    for group in user.groups.all():
        result.update(permission.pk for permission in group.permissions.all())
    return result


def current_role(user, roles):
    actual = effective_permissions(user)
    return next((name for name, permissions in roles.items() if actual == permissions), "")


def assign_role(user, role, roles):
    if protected_account(user) or role not in roles:
        raise ValidationError("No se puede modificar esa cuenta desde esta pantalla.")
    actual = effective_permissions(user)
    if actual - roles["catalog_inventory"]:
        raise ValidationError("Esta cuenta tiene permisos especiales y requiere revisión del responsable del servidor. No se modificó su acceso.")
    if actual == roles[role] and user.is_staff:
        return False
    # Remove this account's inherited commercial grants, never modify shared groups.
    commercial_groups = [group for group in user.groups.all() if group.permissions.exists()]
    if commercial_groups:
        user.groups.remove(*commercial_groups)
    user.user_permissions.set(sorted(roles[role]))
    if not user.is_staff:
        user.is_staff = True
        user.save(update_fields=["is_staff"])
    return True


def has_confirmed_factor(user):
    return has_confirmed_device(user) or PasskeyDevice.objects.filter(user=user, confirmed=True).exists()


def renew_initial_enrollment(user, state):
    """Caller holds security state/user locks; this never resets an enrolled account."""
    if not (user.is_active and user.is_staff and user.has_usable_password()) or state.mfa_method not in ("email", "totp"):
        raise ValidationError("La cuenta debe estar activa y tener una contraseña y un método de verificación válidos.")
    if has_confirmed_factor(user):
        raise ValidationError("Esta cuenta ya tiene una verificación confirmada. No se puede reiniciar desde esta pantalla.")
    permission = EnrollmentPermission.objects.select_for_update().filter(user=user, used_at__isnull=True).first()
    if permission is None:
        raise ValidationError("La cuenta no tiene una primera activación pendiente. No se modificó su seguridad.")
    if state.mfa_method == "email":
        validate_email(user.email)
        device = EmailDevice.objects.filter(user=user).first()
        if device and device.email and device.email != user.email:
            raise ValidationError("El correo pendiente requiere revisión del responsable del servidor.")
        if not mail_configuration_ready():
            raise ValidationError("Configura el servicio de correo antes de renovar la primera verificación.")
    now = timezone.now()
    if permission.expires_at > now:
        return False
    permission.created_at = now
    permission.expires_at = now + timedelta(hours=24)
    permission.save(update_fields=["created_at", "expires_at"])
    return True
