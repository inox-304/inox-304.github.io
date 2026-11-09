"""Finance access is explicit per company, separate from sales/catalog roles."""
from django.core.exceptions import PermissionDenied
from security.passkeys import is_owner as security_is_owner


def is_owner(user):
    return security_is_owner(user)


def accessible_companies(user):
    from .models import Company
    if not (user.is_authenticated and user.is_active and user.is_staff):
        return Company.objects.none()
    if is_owner(user):
        return Company.objects.all()
    return Company.objects.filter(accesses__user=user).distinct()


def can_access(user):
    return is_owner(user) or accessible_companies(user).exists()


def can_company(user, company, action="view"):
    from .models import CompanyAccess
    if action not in {"view", "record", "review"}:
        return False
    if is_owner(user):
        return True
    if not (user.is_authenticated and user.is_active and user.is_staff):
        return False
    roles = {"view": ("view", "record", "review"), "record": ("record", "review"), "review": ("review",)}
    company_id = getattr(company, "pk", company)
    return CompanyAccess.objects.filter(user=user, company_id=company_id, role__in=roles[action]).exists()


def require_company(user, company, action="view"):
    if not can_company(user, company, action):
        raise PermissionDenied("No tienes acceso a estas finanzas.")
