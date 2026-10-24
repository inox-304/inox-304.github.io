"""Small, strict schema for product-specific option axes and complete variants."""
import re


class VariantOptionsError(ValueError):
    pass


def _object(value, keys, label):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise VariantOptionsError(f"{label}: los campos no corresponden al formato permitido.")
    return value


def _identifier(value):
    if not isinstance(value, str) or value in ("__proto__", "prototype", "constructor") or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", value):
        raise VariantOptionsError("Identificador de opción no válido.")
    return value


def _label(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 120 or any(ord(char) < 32 or 0xD800 <= ord(char) <= 0xDFFF for char in value):
        raise VariantOptionsError("Escribe etiquetas de hasta 120 caracteres, sin caracteres de control.")
    return value.strip()


def validate_variant_axes(value):
    if not isinstance(value, list) or len(value) > 3:
        raise VariantOptionsError("Se permiten hasta 3 tipos de opción por equipo.")
    axes, seen = [], set()
    for raw in value:
        axis = _object(raw, ("id", "label", "options"), "Tipo de opción")
        identifier = _identifier(axis["id"])
        if identifier in seen:
            raise VariantOptionsError("Los tipos de opción no pueden repetir identificadores.")
        seen.add(identifier)
        if not isinstance(axis["options"], list) or not 1 <= len(axis["options"]) <= 10:
            raise VariantOptionsError("Cada tipo de opción admite entre 1 y 10 valores.")
        options, option_ids = [], set()
        for raw_option in axis["options"]:
            option = _object(raw_option, ("id", "label"), "Opción")
            option_id = _identifier(option["id"])
            if option_id in option_ids:
                raise VariantOptionsError("Las opciones de un mismo tipo no pueden repetir identificadores.")
            option_ids.add(option_id)
            options.append({"id": option_id, "label": _label(option["label"])})
        axes.append({"id": identifier, "label": _label(axis["label"]), "options": options})
    return axes


def validate_option_values(axes, value, *, active=False):
    axes = validate_variant_axes(axes)
    if not isinstance(value, dict):
        raise VariantOptionsError("La combinación de opciones no tiene un formato válido.")
    if not value:
        if axes and active:
            raise VariantOptionsError("Completa todos los tipos de opción antes de activar esta variación, o déjala inactiva como borrador.")
        return {}
    _object(value, [axis["id"] for axis in axes], "Combinación de opciones")
    result = {}
    for axis in axes:
        option = value[axis["id"]]
        if not isinstance(option, str) or option not in [item["id"] for item in axis["options"]]:
            raise VariantOptionsError(f"Elige una opción autorizada de {axis['label']} para este equipo.")
        result[axis["id"]] = option
    return result


def combination_key(value):
    return tuple(sorted(value.items())) if value else None


def validate_variant_combinations(axes, variants):
    seen = set()
    for values, active in variants:
        key = combination_key(validate_option_values(axes, values, active=active))
        if key is not None:
            if key in seen:
                raise VariantOptionsError("Esta combinación ya existe en otra variación. Revisa también las variaciones inactivas.")
            seen.add(key)
