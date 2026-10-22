"""Trusted relying-party configuration and credential selection."""
import base64
import ipaddress
from urllib.parse import urlsplit

from django.conf import settings

from .models import PasskeyDevice


def configuration():
    if not getattr(settings, "SECURITY_PASSKEYS_ENABLED", False):
        return None
    rp_id = getattr(settings, "SECURITY_PASSKEY_RP_ID", "")
    origin = getattr(settings, "SECURITY_PASSKEY_ORIGIN", "")
    try:
        parsed = urlsplit(origin)
        if not rp_id or parsed.hostname != rp_id or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
            return None
        try:
            ipaddress.ip_address(rp_id)
            return None
        except ValueError:
            pass
        local = rp_id == "localhost" and getattr(settings, "ENVIRONMENT", "") != "production"
        if parsed.scheme != "https" and not (local and parsed.scheme == "http"):
            return None
        if not local and ("." not in rp_id or any(not part or not part.replace("-", "").isalnum() for part in rp_id.split("."))):
            return None
        parsed.port  # Reject malformed port numbers.
    except ValueError:
        return None
    return rp_id, origin


def is_owner(user):
    owner = getattr(settings, "SECURITY_OWNER_USERNAME", "")
    return bool(owner and user.is_authenticated and user.is_active and user.is_staff
                and user.username.casefold() == owner.casefold())


def active_devices(user):
    config = configuration()
    if config is None:
        return PasskeyDevice.objects.none()
    return PasskeyDevice.objects.filter(user=user, confirmed=True, revoked_at__isnull=True,
                                        rp_id=config[0], origin=config[1])


def encode_bytes(value):
    return base64.urlsafe_b64encode(bytes(value)).rstrip(b"=").decode("ascii")
