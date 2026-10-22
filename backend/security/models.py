import re
import uuid

from django.conf import settings
from django.contrib.auth.hashers import check_password
from django.db import models
from django.utils import timezone
from django_otp.models import Device, TimestampMixin


class SecurityState(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    session_version = models.PositiveIntegerField(default=0)
    mfa_method = models.CharField(max_length=10, choices=[("totp", "Aplicación de autenticación"), ("email", "Código por correo")], default="totp")


class EmailDevice(TimestampMixin, Device):
    email = models.EmailField(blank=True, default="")
    confirmed = models.BooleanField(default=False)
    last_sent_at = models.DateTimeField(null=True, blank=True)
    delivery_paused_at = models.DateTimeField(null=True, blank=True)
    delivery_smtp_code = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta(Device.Meta):
        constraints = [models.UniqueConstraint(fields=["user"], name="one_email_device_per_user")]

    def verify_token(self, token):
        # Email OTPs require purpose and session binding; generic OTP APIs cannot verify them.
        return False


class EmailChallenge(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    device = models.ForeignKey(EmailDevice, related_name="challenges", on_delete=models.CASCADE)
    purpose = models.CharField(max_length=16, choices=[("login", "Inicio de sesión"), ("regenerate", "Códigos de recuperación")])
    recipient = models.EmailField()
    token_hash = models.CharField(max_length=64)
    session_digest = models.CharField(max_length=64)
    auth_hash = models.CharField(max_length=128)
    session_version = models.PositiveIntegerField()
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
    consumed_at = models.DateTimeField(null=True, blank=True)
    invalidated_at = models.DateTimeField(null=True, blank=True)


class PasskeyIdentity(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    handle = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)


class PasskeyDevice(TimestampMixin, Device):
    credential_id = models.CharField(max_length=1400, unique=True)
    public_key = models.BinaryField()
    sign_count = models.PositiveBigIntegerField(default=0)
    rp_id = models.CharField(max_length=253)
    origin = models.CharField(max_length=300)
    backed_up = models.BooleanField(default=False)
    device_type = models.CharField(max_length=20, default="single_device")
    revoked_at = models.DateTimeField(null=True, blank=True)

    def verify_token(self, token):
        return False  # Only a complete, verified WebAuthn ceremony may authenticate.


class PasskeyGrant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="passkey_grants")
    authorized_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="authorized_passkeys")
    label = models.CharField(max_length=64)
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)


class PasskeyChallenge(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    purpose = models.CharField(max_length=16)
    challenge = models.BinaryField()
    session_digest = models.CharField(max_length=64)
    auth_hash = models.CharField(max_length=128)
    session_version = models.PositiveIntegerField()
    rp_id = models.CharField(max_length=253)
    origin = models.CharField(max_length=300)
    label = models.CharField(max_length=64, blank=True)
    allowed_credentials = models.JSONField(default=list)
    grant = models.ForeignKey(PasskeyGrant, null=True, blank=True, on_delete=models.PROTECT)
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)


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
