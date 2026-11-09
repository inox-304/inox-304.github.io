"""Configuration is server-only; no UI response includes keys or identifiers."""
from dataclasses import dataclass

from django.conf import settings


@dataclass(frozen=True)
class IntakeConfiguration:
    app_secret: str
    verify_token: str
    phone_number_id: str
    operator_id: str
    operator_id_kind: str
    groups: dict


def get_configuration():
    if getattr(settings, "FINANCE_WHATSAPP_ENABLED", False) is not True:
        return None
    names = ("APP_SECRET", "VERIFY_TOKEN", "PHONE_NUMBER_ID", "OPERATOR_ID",
             "GROUP_YAPE", "GROUP_CASH", "GROUP_TRANSFER")
    values = {key: getattr(settings, "FINANCE_WHATSAPP_" + key, "") for key in names}
    if any(not isinstance(value, str) or not value.strip() or len(value) > 512 for value in values.values()):
        return None
    kind = getattr(settings, "FINANCE_WHATSAPP_OPERATOR_ID_KIND", "bsuid")
    if kind not in ("bsuid", "phone"):
        return None
    groups = {values["GROUP_YAPE"]: "yape", values["GROUP_CASH"]: "cash", values["GROUP_TRANSFER"]: "transfer"}
    if len(groups) != 3:
        return None
    return IntakeConfiguration(values["APP_SECRET"], values["VERIFY_TOKEN"], values["PHONE_NUMBER_ID"],
                               values["OPERATOR_ID"], kind, groups)


def connection_status():
    configured = get_configuration() is not None
    return {
        "configured": configured,
        "label": "Recepción habilitada; comprobar entrega real" if configured else "Pendiente de activar WhatsApp",
        "ai_enabled": False,
        "ai_label": "IA pendiente de conectar; revisión manual disponible",
        "groups": ("Yapes", "Efectivo", "Transacciones"),
    }
