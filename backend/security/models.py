import re

from django.conf import settings
from django.contrib.auth.hashers import check_password
from django.db import models
from django.utils import timezone
from django_otp.models import Device, TimestampMixin


class SecurityState(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    session_version = models.PositiveIntegerField(default=0)


class EnrollmentPermission(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)


class LoginThrottle(models.Model):
    key = models.CharField(max_length=64, unique=True)
    window_started = models.DateTimeField(default=timezone.now)
    attempts = models.PositiveIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)


class RecoveryDevice(TimestampMixin, Device):
    class Meta(Device.Meta):
        verbose_name = "dispositivo de recuperación"
        constraints = [models.UniqueConstraint(fields=["user"], name="one_recovery_device_per_user")]

    def verify_token(self, token):
        # Callers hold the device row lock inside a transaction.
        normalized = re.sub(r"[\s-]", "", str(token)).upper()
        if not self.confirmed or not re.fullmatch(r"[0-9A-F]{32}", normalized):
            return False
        code = self.codes.select_for_update().filter(
            selector=normalized[:8], used_at__isnull=True
        ).first()
        if code is None or not check_password(normalized, code.token_hash):
            return False
        code.used_at = timezone.now()
        code.save(update_fields=["used_at"])
        self.set_last_used_timestamp()
        return True


class RecoveryCode(models.Model):
    device = models.ForeignKey(RecoveryDevice, related_name="codes", on_delete=models.CASCADE)
    selector = models.CharField(max_length=8)
    token_hash = models.CharField(max_length=255)
    created_at = models.DateTimeField(default=timezone.now)
    used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["device", "selector"], name="unique_recovery_selector")]


class SecurityEvent(models.Model):
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    event = models.CharField(max_length=64)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    detail = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "evento de seguridad"
        verbose_name_plural = "eventos de seguridad"

    def __str__(self):
        return f"{self.created_at:%Y-%m-%d %H:%M} · {self.event}"
