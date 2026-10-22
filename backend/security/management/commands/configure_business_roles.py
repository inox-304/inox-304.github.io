"""Assign existing accounts commercial roles without resetting their access."""
from django.apps import apps
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.core.validators import validate_email
from django.db import transaction
from django.db.models import Q

from security.services import audit


GROUP_NAME = "INOX · Gerencia"
ACTIONS = frozenset(("view", "add", "change", "delete"))


def normalized_email(value):
    value = str(value or "").strip().lower()
    try:
        validate_email(value)
    except ValidationError as exc:
        raise CommandError("Indica correos válidos para las cuentas existentes.") from exc
    return value


def commercial_permission_ids():
    # Use the models' standard permission names, never arbitrary custom grants.
    expected = {
        (model._meta.model_name, f"{action}_{model._meta.model_name}")
        for model in apps.get_app_config("catalog").get_models()
        for action in ACTIONS.intersection(model._meta.default_permissions)
    }
    found = {
        (model, codename): pk
        for pk, model, codename in Permission.objects.filter(
            content_type__app_label="catalog"
        ).values_list("pk", "content_type__model", "codename")
        if (model, codename) in expected
    }
    if not expected or set(found) != expected:
        raise CommandError("Los permisos del catálogo están incompletos. Revisa la instalación antes de asignar roles.")
    return set(found.values())


class Command(BaseCommand):
    help = "Conserva al propietario y asigna gestión comercial a una cuenta existente, sin cambiar su segundo factor."

    def add_arguments(self, parser):
        parser.add_argument("--owner", required=True, help="Correo del propietario ya configurado.")
        parser.add_argument("--manager", required=True, help="Correo de la cuenta administrativa que gestionará el negocio.")

    def handle(self, *args, **options):
        owner_name = normalized_email(options["owner"])
        manager_name = normalized_email(options["manager"])
        if owner_name == manager_name:
            raise CommandError("El propietario y la gerencia deben ser cuentas distintas.")
        configured_owner = str(getattr(settings, "SECURITY_OWNER_USERNAME", "") or "").strip().lower()
        if not configured_owner or configured_owner != owner_name:
            raise CommandError("El propietario debe coincidir con SECURITY_OWNER_USERNAME en la configuración privada.")

        with transaction.atomic():
            # Lock only existing users. No creation, promotion, credential or MFA reset.
            users = list(get_user_model().objects.select_for_update().filter(
                Q(username__iexact=owner_name) | Q(username__iexact=manager_name)
            ).order_by("pk"))
            owners = [user for user in users if user.username.lower() == owner_name]
            managers = [user for user in users if user.username.lower() == manager_name]
            if len(owners) != 1 or len(managers) != 1:
                raise CommandError("Cada correo debe identificar una única cuenta existente.")
            owner, manager = owners[0], managers[0]
            if not all(user.is_active and user.is_staff for user in (owner, manager)):
                raise CommandError("Ambas cuentas deben estar activas y tener acceso administrativo.")
            if not owner.is_superuser:
                raise CommandError("El propietario debe conservar una cuenta de superusuario existente; este comando no la promueve.")
            if get_user_model().objects.filter(is_superuser=True).exclude(pk__in=[owner.pk, manager.pk]).exists():
                raise CommandError("Hay otras cuentas de superusuario. Revisa sus privilegios antes de establecer un único propietario.")

            allowed_ids = commercial_permission_ids()
            direct_ids = set(manager.user_permissions.values_list("pk", flat=True))
            if direct_ids - allowed_ids:
                raise CommandError("La gerencia tiene permisos directos ajenos al catálogo. Revísalos antes de continuar; no se eliminó ninguno.")
            groups = list(Group.objects.select_for_update().filter(user=manager).order_by("pk"))
            for existing in groups:
                if set(existing.permissions.values_list("pk", flat=True)) - allowed_ids:
                    raise CommandError("La gerencia pertenece a un grupo con permisos ajenos al catálogo. No se modificó ese grupo.")
            group = Group.objects.select_for_update().filter(name=GROUP_NAME).first()
            if group and set(group.permissions.values_list("pk", flat=True)) - allowed_ids:
                raise CommandError("El grupo INOX · Gerencia contiene permisos ajenos al catálogo. Requiere revisión; no se modificó.")

            if group is None:
                group = Group.objects.create(name=GROUP_NAME)
            current_ids = set(group.permissions.values_list("pk", flat=True))
            missing_ids = allowed_ids - current_ids
            needs_membership = group.pk not in {existing.pk for existing in groups}
            demote = manager.is_superuser
            if not (missing_ids or needs_membership or demote):
                self.stdout.write("Los roles comerciales ya están configurados. No hubo cambios.")
                return
            if missing_ids:
                group.permissions.add(*sorted(missing_ids))
            if needs_membership:
                manager.groups.add(group)
            if demote:
                manager.is_superuser = False
                manager.save(update_fields=["is_superuser"])
            audit(
                "business_roles_configured_by_cli",
                user=manager,
                detail=(f"owner_id={owner.pk};manager_id={manager.pk};group_id={group.pk};"
                        f"permissions_added={len(missing_ids)};membership_added={int(needs_membership)};"
                        f"manager_demoted={int(demote)}"),
            )
        self.stdout.write(self.style.SUCCESS(
            "Roles configurados: propietario conservado y gerencia limitada al catálogo. "
            "Se conservaron contraseñas, correos, segundo factor y sesiones."
        ))
