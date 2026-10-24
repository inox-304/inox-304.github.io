"""Bounded public contract for owner-approved food-cart modules."""

MODULE_IDS = ("broastera", "freidora", "conservadora", "plancha")


class CartValidationError(ValueError):
    pass


def _object(value, keys, label):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise CartValidationError(f"{label}: los campos no corresponden al formato permitido.")
    return value


def validate_cart_config(value):
    if isinstance(value, dict) and not value:
        return {}
    data = _object(value, ("version", "enabled", "modules"), "Configurador del carrito")
    if type(data["version"]) is not int or data["version"] != 1 or type(data["enabled"]) is not bool:
        raise CartValidationError("Versión o activación del configurador no válida.")
    if not isinstance(data["modules"], list) or not 1 <= len(data["modules"]) <= 4:
        raise CartValidationError("El carrito admite entre uno y cuatro módulos aprobados.")
    modules, seen = [], set()
    for item in data["modules"]:
        item = _object(item, ("id", "label", "defaultIncluded"), "Módulo del carrito")
        key, label = item["id"], item["label"]
        if not isinstance(key, str) or key not in MODULE_IDS or key in seen:
            raise CartValidationError("Elija módulos compatibles con el carrito, sin repetirlos.")
        if not isinstance(label, str) or not label.strip() or len(label) > 80 or any(ord(char) < 32 or 0xD800 <= ord(char) <= 0xDFFF for char in label):
            raise CartValidationError("Escriba un nombre de módulo de hasta 80 caracteres.")
        if type(item["defaultIncluded"]) is not bool:
            raise CartValidationError("La inclusión inicial del módulo debe ser sí o no.")
        seen.add(key)
        modules.append({"id": key, "label": label.strip(), "defaultIncluded": item["defaultIncluded"]})
    return {"version": 1, "enabled": data["enabled"], "modules": modules}


def validate_product_cart_config(value, *, supply_type, category, equipment_family):
    config = validate_cart_config(value)
    if config and (supply_type != "manufactured" or category != "linea-caliente" or equipment_family != "carritos-comida"):
        raise CartValidationError("El configurador del carrito requiere fabricación propia, línea caliente y familia Carritos de comida.")
    return config


def validate_cart_selection(config, value):
    config = validate_cart_config(config)
    if not config or not config["enabled"]:
        raise CartValidationError("Este configurador no está habilitado.")
    # Older clients retain the original arrangement when they omit order.
    has_order = isinstance(value, dict) and "order" in value
    data = _object(value, ("included", "order") if has_order else ("included",), "Selección del carrito")
    included = data["included"]
    if not isinstance(included, list) or len(included) > 4:
        raise CartValidationError("Elija hasta cuatro módulos del carrito.")
    allowed = {module["id"] for module in config["modules"]}
    if any(not isinstance(key, str) or key not in allowed for key in included) or len(set(included)) != len(included):
        raise CartValidationError("La selección contiene módulos no aprobados o repetidos.")
    order = data["order"] if has_order else list(MODULE_IDS)
    if not isinstance(order, list) or len(order) != len(MODULE_IDS) or any(not isinstance(key, str) or key not in MODULE_IDS for key in order) or len(set(order)) != len(MODULE_IDS):
        raise CartValidationError("Cada posición debe contener una estación del carrito, sin repetirla.")
    # Inclusion stays canonical; station order is the customer's exact left-to-right arrangement.
    # Unapproved equipment can occupy a placeholder but is never included or named publicly.
    return {"included": [module["id"] for module in config["modules"] if module["id"] in included], "order": list(order)}


def cart_selection_summary(config, selection):
    config = validate_cart_config(config)
    chosen = validate_cart_selection(config, selection)
    labels = {module["id"]: module["label"] for module in config["modules"]}
    return {
        "included": [labels[key] for key in chosen["order"] if key in chosen["included"]],
        "omitted": [module["label"] for module in config["modules"] if module["id"] not in chosen["included"]],
        "orientation": "left-to-right-from-front",
        "positions": [{"position": index + 1, "moduleId": key if key in chosen["included"] else None, "label": labels[key] if key in chosen["included"] else "Superficie de trabajo", "included": key in chosen["included"]} for index, key in enumerate(chosen["order"])],
    }
