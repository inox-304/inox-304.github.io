from django.contrib.admin.apps import AdminConfig


class PrivateAdminConfig(AdminConfig):
    default_site = 'security.admin_site.SecureAdminSite'
