from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django_otp.plugins.otp_totp.models import TOTPDevice

from .models import SecurityEvent

# Account authorization and MFA enrollment are explicit server CLI operations.
for protected_model in (get_user_model(), Group, TOTPDevice):
    if admin.site.is_registered(protected_model):
        admin.site.unregister(protected_model)


@admin.register(SecurityEvent)
class SecurityEventAdmin(admin.ModelAdmin):
    list_display = ("created_at", "event", "user", "ip_address", "detail")
    list_filter = ("event", "created_at")
    search_fields = ("user__username", "event")
    readonly_fields = ("created_at", "event", "user", "ip_address", "detail")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def has_view_permission(self, request, obj=None):
        return request.user.is_superuser
