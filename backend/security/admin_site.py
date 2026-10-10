from django.contrib.admin import AdminSite
from django.shortcuts import redirect

from .services import is_admin_authenticated


class SecureAdminSite(AdminSite):
    site_header = "INOX 304 · Administración"
    site_title = "INOX 304"
    index_title = "Panel de control"
    site_url = "/"

    def has_permission(self, request):
        return is_admin_authenticated(request)

    def login(self, request, extra_context=None):
        return redirect("security:login")

    def logout(self, request, extra_context=None):
        from .views import logout_view
        return logout_view(request)
