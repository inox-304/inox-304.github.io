"""Configuration is server-only; no UI response includes keys or identifiers."""
from dataclasses import dataclass, field
import re

from django.conf import settings


@dataclass(frozen=True)
class IntakeConfiguration:
    app_secret: str = field(repr=False)
    verify_token: str = field(repr=False)
    phone_number_id: str
    operator_id: str
    operator_id_kind: str
    groups: dict


@dataclass(frozen=True)
class MediaConfiguration:
    token: str = field(repr=False)
    version: str
    phone_number_id: str


def _valid_value(value):
    return (isinstance(value, str) and bool(value) and value == value.strip()
            and len(value) <= 512 and not any(ord(character) < 32 or ord(character) == 127 for character in value))


def get_verification_token():
    """Bootstrap the Meta callback without enabling message ingestion."""
    if getattr(settings, "FINANCE_WHATSAPP_ENABLED", False) is not True:
        return None
    token = getattr(settings, "FINANCE_WHATSAPP_VERIFY_TOKEN", "")
    return token if _valid_value(token) else None


def get_configuration():
    if getattr(settings, "FINANCE_WHATSAPP_ENABLED", False) is not True:
        return None
    names = ("APP_SECRET", "VERIFY_TOKEN", "PHONE_NUMBER_ID", "OPERATOR_ID",
             "GROUP_YAPE", "GROUP_CASH", "GROUP_TRANSFER")
    values = {key: getattr(settings, "FINANCE_WHATSAPP_" + key, "") for key in names}
    if any(not _valid_value(value) for value in values.values()):
        return None
    if (re.fullmatch(r"[0-9]{1,64}", values["PHONE_NUMBER_ID"]) is None
            or len(values["OPERATOR_ID"]) > 256):
        return None
    kind = getattr(settings, "FINANCE_WHATSAPP_OPERATOR_ID_KIND", "bsuid")
    if kind not in ("bsuid", "phone"):
        return None
    groups = {values["GROUP_YAPE"]: "yape", values["GROUP_CASH"]: "cash", values["GROUP_TRANSFER"]: "transfer"}
    if len(groups) != 3:
        return None
    return IntakeConfiguration(values["APP_SECRET"], values["VERIFY_TOKEN"], values["PHONE_NUMBER_ID"],
                               values["OPERATOR_ID"], kind, groups)


def get_media_configuration():
    if getattr(settings, "FINANCE_WHATSAPP_ENABLED", False) is not True:
        return None
    token = getattr(settings, "FINANCE_WHATSAPP_ACCESS_TOKEN", "")
    version = getattr(settings, "FINANCE_WHATSAPP_GRAPH_API_VERSION", "")
    phone = getattr(settings, "FINANCE_WHATSAPP_PHONE_NUMBER_ID", "")
    if (not isinstance(token, str) or not token or len(token) > 4096
            or not token.isascii() or any(ord(character) <= 32 or ord(character) == 127 for character in token)
            or not isinstance(version, str) or re.fullmatch(r"v[0-9]{1,3}\.0", version) is None
            or not isinstance(phone, str) or re.fullmatch(r"[0-9]{1,64}", phone) is None):
        return None
    return MediaConfiguration(token=token, version=version, phone_number_id=phone)


def connection_status():
    configured = get_configuration() is not None
    missing = []
    if not configured:
        missing.append("Completar la recepción autorizada del operador y los tres grupos.")
    if getattr(settings, "FINANCE_WHATSAPP_AUTO_PROCESS_ENABLED", False) is not True:
        missing.append("Habilitar el procesamiento automático de fotos.")
    if get_media_configuration() is None:
        missing.append("Configurar el acceso privado a los medios de WhatsApp.")
    return {
        "configured": configured,
        "ready": configured,
        "verification_ready": get_verification_token() is not None,
        "processing_ready": not missing,
        "processing_missing": tuple(missing),
        "label": "Recepción habilitada; comprobar entrega real" if configured else "Pendiente de activar WhatsApp",
        "ai_enabled": False,
        "ai_label": "IA pendiente de conectar; revisión manual disponible",
        "groups": ("Yapes", "Efectivo", "Transacciones"),
    }
