"""Bounded, database-free validation of owner-defined cooktop options."""
import re
import math
from collections import Counter


class CooktopValidationError(ValueError):
    pass


def _fail(message):
    raise CooktopValidationError(message)


def _object(value, keys, label):
    if not isinstance(value, dict) or set(value) != set(keys):
        _fail(f"{label}: los campos no corresponden al formato permitido.")
    return value


def _integer(value, minimum, maximum, label):
    if type(value) is not int or not minimum <= value <= maximum:
        _fail(f"{label}: use un entero entre {minimum} y {maximum}.")
    return value


def _identifier(value, label):
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", value):
        _fail(f"{label}: identificador no válido.")
    return value


def _name(value, label):
    if not isinstance(value, str) or not value.strip() or len(value) > 120 or any(ord(char) < 32 or 0xD800 <= ord(char) <= 0xDFFF for char in value):
        _fail(f"{label}: escriba un nombre de hasta 120 caracteres.")
    return value.strip()


def _list(value, minimum, maximum, label):
    if not isinstance(value, list) or not minimum <= len(value) <= maximum:
        _fail(f"{label}: se admiten entre {minimum} y {maximum} elementos.")
    return value


def _subset(value, choices, label):
    items = _list(value, 1, len(choices), label)
    if any(not isinstance(item, str) or item not in choices for item in items) or len(set(items)) != len(items):
        _fail(f"{label}: elija opciones permitidas sin repetirlas.")
    return list(items)


def _optional_subset(value, choices, label):
    items = _list(value, 0, len(choices), label)
    if any(not isinstance(item, str) or item not in choices for item in items) or len(set(items)) != len(items):
        _fail(f"{label}: elija opciones permitidas sin repetirlas.")
    return list(items)


def _kitchen_config(value):
    data = _object(value, ("family", "ovens", "structures", "supports", "materials", "dimensions"), "Opciones de cocina")
    if data["family"] not in ("linear", "central", "builtin", "home"):
        _fail("Familia de cocina no válida.")
    materials = []
    identifiers = set()
    for source in _list(data["materials"], 0, 24, "Materiales de la cubierta"):
        item = _object(source, ("id", "name", "steel", "thicknessMm"), "Material de la cubierta")
        identifier = _identifier(item["id"], "Material")
        if identifier in identifiers:
            _fail("Los materiales no pueden repetir identificadores.")
        identifiers.add(identifier)
        thickness = item["thicknessMm"]
        if type(thickness) not in (int, float) or not 0 < thickness <= 20 or not math.isfinite(thickness):
            _fail("Espesor de cubierta: use un número mayor que 0 y hasta 20 mm.")
        materials.append({"id": identifier, "name": _name(item["name"], "Material"), "steel": _name(item["steel"], "Calidad de acero"), "thicknessMm": thickness})
    dimensions = None
    if data["dimensions"] is not None:
        dimensions = {}
        for axis, bounds in _object(data["dimensions"], ("widthMm", "depthMm", "heightMm"), "Medidas").items():
            bounds = _object(bounds, ("min", "max", "step"), "Rango de medidas")
            lower = _integer(bounds["min"], 1, 10000, "Medida mínima")
            upper = _integer(bounds["max"], lower, 10000, "Medida máxima")
            step = _integer(bounds["step"], 1, max(1, upper - lower), "Paso de medida")
            dimensions[axis] = {"min": lower, "max": upper, "step": step}
    return {"family": data["family"], "ovens": _optional_subset(data["ovens"], ("none", "gas", "electric"), "Hornos"),
            "structures": _optional_subset(data["structures"], ("open", "cabinet"), "Estructuras"),
            "supports": _optional_subset(data["supports"], ("feet", "wheels"), "Apoyos"), "materials": materials, "dimensions": dimensions}


def _kitchen_selection(config, value):
    chosen = _object(value, ("oven", "structure", "support", "materialId", "widthMm", "depthMm", "heightMm"), "Configuración elegida de cocina")
    result = {}
    for key, options in (("oven", config["ovens"]), ("structure", config["structures"]), ("support", config["supports"]), ("materialId", [item["id"] for item in config["materials"]])):
        option = chosen[key]
        if (not options and option is not None) or (options and (not isinstance(option, str) or option not in options)):
            _fail("La opción de horno, estructura, apoyo o material no está autorizada para esta cocina.")
        result[key] = option
    for axis in ("widthMm", "depthMm", "heightMm"):
        if config["dimensions"] is None:
            if chosen[axis] is not None:
                _fail("Las medidas de esta cocina todavía no están habilitadas.")
            result[axis] = None
        else:
            bounds = config["dimensions"][axis]
            value = _integer(chosen[axis], bounds["min"], bounds["max"], "Medida elegida")
            if (value - bounds["min"]) % bounds["step"]:
                _fail("La medida elegida no respeta los pasos permitidos por el propietario.")
            result[axis] = value
    return result


def _cells(layout, module, anchor):
    total = layout["rows"] * layout["columns"]
    _integer(anchor, 0, total - 1, "Posición")
    row, column = divmod(anchor, layout["columns"])
    if row + module["height"] > layout["rows"] or column + module["width"] > layout["columns"]:
        _fail("El módulo se sale de la distribución elegida.")
    return {r * layout["columns"] + c for r in range(row, row + module["height"]) for c in range(column, column + module["width"])}


def validate_cooktop_config(value):
    """Return an independent whitelisted schema; {} means not configured."""
    if isinstance(value, dict) and not value:
        return {}
    keys = ("version", "kind", "enabled", "energies", "defaultModuleId", "layouts", "modules")
    if isinstance(value, dict) and "kitchen" in value:
        keys += ("kitchen",)
    data = _object(value, keys, "Configurador")
    if type(data["version"]) is not int or data["version"] != 1 or data["kind"] != "cooktop" or type(data["enabled"]) is not bool:
        _fail("Versión, tipo o estado del configurador no válidos.")
    energies = _subset(data["energies"], ("gas", "electric"), "Energías")
    default_id = _identifier(data["defaultModuleId"], "Hornilla de base")
    layouts = []
    layout_by_id = {}
    for item in _list(data["layouts"], 1, 6, "Distribuciones"):
        item = _object(item, ("id", "name", "rows", "columns"), "Distribución")
        identifier = _identifier(item["id"], "Distribución")
        if identifier in layout_by_id:
            _fail("Las distribuciones no pueden repetir identificadores.")
        layout = {"id": identifier, "name": _name(item["name"], "Distribución"),
                  "rows": _integer(item["rows"], 1, 3, "Filas"), "columns": _integer(item["columns"], 1, 12, "Columnas")}
        if layout["rows"] * layout["columns"] > 12:
            _fail("Cada distribución admite hasta 12 posiciones.")
        layouts.append(layout)
        layout_by_id[identifier] = layout
    modules = []
    module_ids = set()
    for item in _list(data["modules"], 1, 12, "Módulos"):
        item = _object(item, ("id", "name", "kind", "width", "height", "energies", "allowedLayouts", "maxQuantity", "anchors"), "Módulo")
        identifier = _identifier(item["id"], "Módulo")
        if identifier in module_ids:
            _fail("Los módulos no pueden repetir identificadores.")
        module_ids.add(identifier)
        if item["kind"] not in ("burner", "wok", "griddle", "grill", "fryer", "other"):
            _fail("Tipo de módulo no permitido.")
        module = {"id": identifier, "name": _name(item["name"], "Módulo"), "kind": item["kind"],
                  "width": _integer(item["width"], 1, 12, "Ancho"), "height": _integer(item["height"], 1, 3, "Alto"),
                  "energies": _subset(item["energies"], energies, "Energías del módulo"),
                  "allowedLayouts": _subset(item["allowedLayouts"], layout_by_id, "Distribuciones del módulo"),
                  "maxQuantity": _integer(item["maxQuantity"], 1, 12, "Cantidad máxima"), "anchors": {}}
        anchors = _object(item["anchors"], module["allowedLayouts"], "Posiciones permitidas")
        for layout_id in module["allowedLayouts"]:
            positions = _list(anchors[layout_id], 1, 12, "Posiciones permitidas")
            for anchor in positions:
                _cells(layout_by_id[layout_id], module, anchor)
            if len(set(positions)) != len(positions):
                _fail("Las posiciones permitidas no pueden repetirse.")
            module["anchors"][layout_id] = list(positions)
        modules.append(module)
    default = next((module for module in modules if module["id"] == default_id), None)
    if default is None or default["kind"] != "burner" or default["width"] != 1 or default["height"] != 1:
        _fail("La base debe ser una hornilla de una posición.")
    if set(default["energies"]) != set(energies) or set(default["allowedLayouts"]) != set(layout_by_id):
        _fail("La hornilla de base debe admitir todas las energías y distribuciones.")
    for layout in layouts:
        total = layout["rows"] * layout["columns"]
        if set(default["anchors"][layout["id"]]) != set(range(total)) or default["maxQuantity"] < total:
            _fail("La hornilla de base debe poder cubrir todas las posiciones.")
    result = {"version": 1, "kind": "cooktop", "enabled": data["enabled"], "energies": energies,
              "defaultModuleId": default_id, "layouts": layouts, "modules": modules}
    if "kitchen" in data:
        result["kitchen"] = _kitchen_config(data["kitchen"])
    return result


def validate_product_cooktop_config(value, *, supply_type, category, equipment_family):
    config = validate_cooktop_config(value)
    if config and (supply_type, category, equipment_family) != ("manufactured", "linea-caliente", "cocinas"):
        _fail("El configurador solo corresponde a cocinas de fabricación propia en Línea caliente.")
    return config


def validate_cooktop_selection(config, selection, *, allow_disabled=False):
    """Only nondefault modules are stored; uncovered cells remain base burners."""
    config = validate_cooktop_config(config)
    if not config or (not config["enabled"] and not allow_disabled):
        _fail("Este configurador no está habilitado.")
    keys = ("layoutId", "energy", "placements") + (("kitchen",) if "kitchen" in config else ())
    selection = _object(selection, keys, "Selección")
    layout_id = _identifier(selection["layoutId"], "Distribución")
    layout = next((item for item in config["layouts"] if item["id"] == layout_id), None)
    if layout is None or selection["energy"] not in config["energies"]:
        _fail("La distribución o energía no pertenece a este equipo.")
    by_id = {item["id"]: item for item in config["modules"]}
    covered = set()
    counts = Counter()
    placements = []
    for placement in _list(selection["placements"], 0, 12, "Módulos elegidos"):
        placement = _object(placement, ("moduleId", "anchor"), "Módulo elegido")
        module_id = _identifier(placement["moduleId"], "Módulo elegido")
        module = by_id.get(module_id)
        if module is None or module_id == config["defaultModuleId"]:
            _fail("El módulo elegido no es una opción adicional de este equipo.")
        if layout_id not in module["allowedLayouts"] or selection["energy"] not in module["energies"]:
            _fail("Este módulo no admite la distribución o energía elegida.")
        cells = _cells(layout, module, placement["anchor"])
        if placement["anchor"] not in module["anchors"][layout_id]:
            _fail("Este módulo no está permitido en la posición elegida.")
        if covered & cells:
            _fail("Los módulos elegidos se superponen. Retire el módulo que ocupa esa posición.")
        counts[module_id] += 1
        if counts[module_id] > module["maxQuantity"]:
            _fail("La selección supera la cantidad máxima permitida para este módulo.")
        covered.update(cells)
        placements.append({"moduleId": module_id, "anchor": placement["anchor"]})
    result = {"layoutId": layout_id, "energy": selection["energy"], "placements": placements}
    if "kitchen" in config:
        result["kitchen"] = _kitchen_selection(config["kitchen"], selection["kitchen"])
    return result


def cooktop_selection_summary(config, selection):
    config = validate_cooktop_config(config)
    selection = validate_cooktop_selection(config, selection)
    layout = next(item for item in config["layouts"] if item["id"] == selection["layoutId"])
    module_counts = []
    occupied = 0
    for module in config["modules"]:
        anchors = [item["anchor"] for item in selection["placements"] if item["moduleId"] == module["id"]]
        if anchors:
            occupied += len(anchors) * module["width"] * module["height"]
            module_counts.append({"moduleId": module["id"], "name": module["name"], "count": len(anchors), "anchors": anchors})
    result = {"layoutId": layout["id"], "energy": selection["energy"],
              "remainingBurners": layout["rows"] * layout["columns"] - occupied, "moduleCounts": module_counts}
    if "kitchen" in selection:
        result["kitchen"] = selection["kitchen"]
    return result
