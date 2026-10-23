"""Private inventory projection. Google Sheets stays private; no public CSV feeds."""
import json
import os
import re
import tempfile
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

LOCATIONS = ("Tienda", "Taller")
KINDS = ("Materia prima", "Accesorio", "Producto terminado")
TYPES = ("Entrada", "Salida", "Traslado", "Ajuste +", "Ajuste -")
RANGES = ("Inventario!A6:T206", "Movimientos!A6:J506", "Recetas!A6:I206", "Costos!A6:E206")


class InventoryError(ValueError):
    pass


def number(value, label, *, optional=True, signed=False):
    if value is None or value == "":
        if optional:
            return None
        raise InventoryError(f"Falta {label}.")
    try:
        result = Decimal(str(value))
    except InvalidOperation:
        raise InventoryError(f"Revisa {label}: debe ser un número.") from None
    if not result.is_finite() or abs(result) > 100_000_000 or (not signed and result < 0):
        raise InventoryError(f"Revisa {label}: el valor está fuera del rango permitido.")
    return result


def cell(row, index):
    return row[index] if index < len(row) else ""


def text(value, maximum=250):
    return str(value or "").strip()[:maximum]


def movement_date(value):
    try:
        if isinstance(value, (int, float)):
            return (date(1899, 12, 30) + timedelta(days=value)).isoformat()
        return date.fromisoformat(str(value)[:10]).isoformat()
    except (ValueError, OverflowError, TypeError):
        raise InventoryError("Revisa la fecha de un movimiento.") from None


def project(snapshot):
    items = {}
    for row in snapshot.get("inventory", []):
        if not any(v not in ("", None) for v in row):
            continue
        code = text(cell(row, 0), 64)
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", code) or code in items:
            raise InventoryError("Hay códigos de artículo vacíos, duplicados o inválidos.")
        name, kind, unit, currency = (text(cell(row, i)) for i in range(1, 5))
        if not name or kind not in KINDS or not unit or currency not in ("PEN", "USD"):
            raise InventoryError(f"Completa nombre, tipo, unidad y moneda de {code}.")
        items[code] = {
            "code": code, "name": name, "kind": kind, "unit": unit, "currency": currency,
            "cost": number(cell(row, 5), f"costo de {code}"),
            "minimum": {place: number(cell(row, 6 + i), f"mínimo de {code}") for i, place in enumerate(LOCATIONS)},
            "stock": {place: number(cell(row, 8 + i), f"conteo inicial de {code}") for i, place in enumerate(LOCATIONS)},
            "grade": text(cell(row, 16)), "thickness": text(cell(row, 17)),
            "dimensions": text(cell(row, 18)), "notes": text(cell(row, 19), 1000),
        }
    movements = []
    identifiers = set()
    for row in snapshot.get("movements", []):
        if not any(v not in ("", None) for v in row):
            continue
        identity, code, kind = (text(cell(row, i), 64) for i in (1, 2, 3))
        if not identity or identity in identifiers or code not in items or kind not in TYPES:
            raise InventoryError("Revisa identificador, código y tipo de los movimientos.")
        identifiers.add(identity)
        quantity = number(cell(row, 4), "cantidad de movimiento", optional=False)
        if quantity <= 0:
            raise InventoryError("La cantidad de cada movimiento debe ser mayor que cero.")
        origin, target = (text(cell(row, i)) for i in (5, 6))
        incoming = kind in ("Entrada", "Ajuste +")
        outgoing = kind in ("Salida", "Ajuste -")
        if ((incoming and (origin or target not in LOCATIONS))
                or (outgoing and (origin not in LOCATIONS or target))
                or (kind == "Traslado" and (origin not in LOCATIONS or target not in LOCATIONS or origin == target))):
            raise InventoryError(f"Revisa origen y destino del movimiento {identity}.")
        item = items[code]
        if origin and item["stock"][origin] is not None:
            item["stock"][origin] -= quantity
        if target and item["stock"][target] is not None:
            item["stock"][target] += quantity
        movements.append({"id": identity, "date": movement_date(cell(row, 0)), "code": code,
                          "type": kind, "quantity": quantity, "origin": origin, "target": target,
                          "unit": item["unit"], "reference": text(cell(row, 7)), "responsible": text(cell(row, 8))})

    recipes = defaultdict(list)
    for row in snapshot.get("recipes", []):
        if not any(v not in ("", None) for v in row):
            continue
        finished, component = (text(cell(row, i), 64) for i in (0, 1))
        if finished not in items or component not in items or items[finished]["kind"] != "Producto terminado" or items[component]["kind"] == "Producto terminado":
            raise InventoryError("Cada receta debe vincular un producto terminado con una materia prima o accesorio válido.")
        quantity = number(cell(row, 2), "cantidad de receta", optional=False)
        if quantity <= 0:
            raise InventoryError("La cantidad de cada componente debe ser mayor que cero.")
        waste = number(cell(row, 8), "merma de receta") or Decimal(0)
        if waste > 100:
            raise InventoryError("La merma debe estar entre 0 y 100 por ciento.")
        quantity *= 1 + waste / 100
        item = items[component]
        cost = item["cost"]
        recipes[finished].append({"component": component, "quantity": quantity,
                                 "total": None if cost is None or item["currency"] != items[finished]["currency"] else quantity * cost})

    cost_inputs = {}
    for row in snapshot.get("costs", []):
        code = text(cell(row, 0), 64)
        if not code:
            continue
        if code not in items or items[code]["kind"] != "Producto terminado" or code in cost_inputs:
            raise InventoryError("Revisa los códigos de la hoja Costos.")
        cost_inputs[code] = (number(cell(row, 3), f"mano de obra de {code}"), number(cell(row, 4), f"precio de venta de {code}"))
    costs = []
    for code, item in items.items():
        if item["kind"] != "Producto terminado":
            continue
        parts = recipes[code]
        material = sum((part["total"] for part in parts), Decimal(0)) if parts and all(part["total"] is not None for part in parts) else None
        labor, sale = cost_inputs.get(code, (None, None))
        total = material + labor if material is not None and labor is not None else None
        profit = sale - total if sale is not None and total is not None else None
        margin = profit / sale * 100 if profit is not None and sale > 0 else None
        state = "Falta receta" if not parts else "Revisar costos de componentes" if material is None else "Falta mano de obra" if labor is None else "Falta precio de venta" if sale is None or sale == 0 else "Completo"
        costs.append({"code": code, "name": item["name"], "currency": item["currency"], "materials": material,
                      "labor": labor, "total": total, "sale": sale, "profit": profit, "margin": margin, "state": state})
    alerts, pending = [], 0
    for item in items.values():
        for place in LOCATIONS:
            quantity, minimum = item["stock"][place], item["minimum"][place]
            if quantity is None:
                pending += 1
            elif quantity < 0 or (minimum is not None and quantity <= minimum):
                alerts.append({**item, "place": place, "quantity": quantity, "threshold": minimum, "negative": quantity < 0})
    return {"items": list(items.values()), "recipes": dict(recipes), "movements": sorted(movements, key=lambda m: m["date"], reverse=True),
            "costs": costs, "alerts": alerts, "pending": pending}


def snapshot_path():
    return Path(settings.DATA_DIR) / "inventory" / "snapshot.json"


def inventory_persistence():
    mode = getattr(settings, "INOX_INVENTORY_PERSISTENCE", "file")
    if mode not in ("file", "database"):
        raise ImproperlyConfigured("INOX_INVENTORY_PERSISTENCE must be file or database.")
    return mode


def validate_snapshot(snapshot):
    """Validate before either persistence backend is allowed to replace a copy."""
    if not isinstance(snapshot, dict):
        raise InventoryError("La copia del inventario no tiene un formato válido.")
    for key in ("inventory", "movements", "recipes", "costs"):
        rows = snapshot.get(key, [])
        if not isinstance(rows, list) or any(not isinstance(row, list) for row in rows):
            raise InventoryError("La copia del inventario no tiene tablas válidas.")
    try:
        encoded = json.dumps(snapshot, ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError):
        raise InventoryError("La copia del inventario no tiene un formato válido.") from None
    if len(encoded) > 5_000_000:
        raise InventoryError("La copia del inventario supera el tamaño permitido.")
    project(snapshot)
    return snapshot


def load_snapshot():
    if inventory_persistence() == "database":
        from .models import InventorySyncState
        snapshot = InventorySyncState.objects.filter(pk=1).values_list("snapshot", flat=True).first()
        return validate_snapshot(snapshot) if snapshot is not None else None
    path = snapshot_path()
    if not path.exists():
        return None
    try:
        if path.stat().st_size > 5_000_000:
            raise InventoryError("La copia del inventario supera el tamaño permitido.")
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise InventoryError("No se pudo leer la última copia del inventario.") from error


def save_snapshot(snapshot):
    validate_snapshot(snapshot)  # A failed refresh must never replace the last valid copy.
    if inventory_persistence() == "database":
        from .models import InventorySyncState
        # Explicit imports also invalidate an in-flight refresh of the older copy.
        InventorySyncState.objects.update_or_create(pk=1, defaults={
            "snapshot": snapshot, "lease_token": "", "lease_expires_at": None,
        })
        return
    path = snapshot_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(snapshot, output, ensure_ascii=False)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def export_inventory_state():
    """Portable private data only: never export a worker's live lease."""
    from .inventory_sync import _read_state
    snapshot = load_snapshot()
    if snapshot is not None:
        validate_snapshot(snapshot)
    return {"snapshot": snapshot, "status": _read_state()}


def import_inventory_state(payload, *, only_if_empty=False):
    """Restore a validated private cache without network access or a live lease."""
    if not isinstance(payload, dict):
        raise InventoryError("El respaldo del inventario no tiene un formato válido.")
    snapshot, status = payload.get("snapshot"), payload.get("status", {})
    if snapshot is not None:
        validate_snapshot(snapshot)
    if not isinstance(status, dict):
        raise InventoryError("El estado de sincronización no tiene un formato válido.")
    try:
        encoded = json.dumps(status, ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError):
        raise InventoryError("El estado de sincronización no tiene un formato válido.") from None
    if len(encoded) > 10_000:
        raise InventoryError("El estado de sincronización supera el tamaño permitido.")
    if inventory_persistence() == "database":
        from django.db import transaction
        from .models import InventorySyncState
        with transaction.atomic():
            row, created = InventorySyncState.objects.select_for_update().get_or_create(pk=1)
            if only_if_empty and not created:
                raise InventoryError("Ya existe un estado de inventario; no se reemplazó.")
            row.snapshot, row.status = snapshot, status
            row.lease_token, row.lease_expires_at = "", None
            row.save(update_fields=("snapshot", "status", "lease_token", "lease_expires_at"))
        return
    from .inventory_sync import _state_path, _write_state
    if only_if_empty and (snapshot_path().exists() or _state_path().exists()):
        raise InventoryError("Ya existe un estado de inventario; no se reemplazó.")
    if snapshot is not None:
        save_snapshot(snapshot)
    _write_state(status)


def fetch_sheet(spreadsheet_id):
    if not re.fullmatch(r"[A-Za-z0-9_-]{20,150}", spreadsheet_id or ""):
        raise InventoryError("Configura una hoja de inventario válida.")
    try:
        import google.auth
        from google.auth.transport.requests import Request as GoogleRequest
    except ImportError:
        raise InventoryError("Falta instalar las dependencias de conexión con Google Sheets.") from None
    try:
        credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"])
        transport = GoogleRequest()
        def bounded_request(*args, **kwargs):
            kwargs["timeout"] = 20
            return transport(*args, **kwargs)
        credentials.refresh(bounded_request)
        params = urlencode([*(('ranges', value) for value in RANGES), ('valueRenderOption', 'UNFORMATTED_VALUE'), ('dateTimeRenderOption', 'SERIAL_NUMBER')])
        request = Request(f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values:batchGet?{params}",
                          headers={"Authorization": f"Bearer {credentials.token}"})
        with urlopen(request, timeout=20) as response:
            payload = json.loads(response.read(5_000_001))
        blocks = payload.get("valueRanges", [])
        if len(blocks) != len(RANGES):
            raise InventoryError("La hoja no conserva las cuatro tablas necesarias.")
        for block, limit in zip(blocks, (200, 500, 200, 200)):
            if any(any(value not in ("", None) for value in row) for row in block.get("values", [])[limit:]):
                raise InventoryError("Se alcanzó la capacidad preparada. Amplía las tablas y fórmulas antes de actualizar; se conserva la copia anterior.")
        return {"schemaVersion": 1, "spreadsheetId": spreadsheet_id,
                "url": f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit",
                "fetchedAt": datetime.now(timezone.utc).isoformat(),
                **{key: block.get("values", []) for key, block in zip(("inventory", "movements", "recipes", "costs"), blocks)}}
    except InventoryError:
        raise
    except Exception:
        # Never expose tokens, service-account keys or provider response bodies.
        raise InventoryError("No se pudo actualizar desde Google Sheets. Revisa la autorización de lectura y la conexión; se conserva la última copia.") from None


def dashboard(snapshot, location="", unit=""):
    data = project(snapshot)
    places = [location] if location in LOCATIONS else list(LOCATIONS)
    rows = []
    for item in sorted(data["items"], key=lambda item: item["code"]):
        if unit and item["unit"] != unit:
            continue
        for place in places:
            quantity, minimum = item["stock"][place], item["minimum"][place]
            state = "Por contar" if quantity is None else "Revisar saldo" if quantity < 0 else "Reponer" if minimum is not None and quantity <= minimum else "Sin mínimo" if minimum is None else "Disponible"
            rows.append({**item, "place": place, "quantity": quantity, "state": state,
                         "value": None if quantity is None or item["cost"] is None else quantity * item["cost"]})
    states = Counter(row["state"] for row in rows)
    kinds = [{"label": kind, "value": len({row["code"] for row in rows if row["kind"] == kind})} for kind in KINDS]
    month_counts = defaultdict(Counter)
    for move in data["movements"]:
        if (not location or location in (move["origin"], move["target"])) and (not unit or move["unit"] == unit):
            month_counts[move["date"][:7]][move["type"]] += 1
    monthly = [{"label": key, **{kind: values[kind] for kind in TYPES}} for key, values in sorted(month_counts.items())]
    return {**data, "rows": rows, "kinds": kinds, "states": dict(states), "monthly": monthly,
            "units": sorted({item["unit"] for item in data["items"]}), "locations": LOCATIONS,
            "references": len({row["code"] for row in rows}), "counted": sum(row["quantity"] is not None for row in rows),
            "low": states["Reponer"] + states["Revisar saldo"], "uncounted": states["Por contar"],
            "source": snapshot, "selected_location": location, "selected_unit": unit}


def manufacturing_plan(snapshot, code, quantity=1, location="Taller", additionals=()):
    """Read-only simulation: a configuration is a complete recipe; extras add recipes."""
    data = project(snapshot)
    items = {item["code"]: item for item in data["items"]}
    codes = [code, *additionals]
    if location not in LOCATIONS or len(codes) != len(set(codes)) or len(codes) > 4:
        raise InventoryError("Elige una ubicación y adicionales distintos del equipo.")
    if any(key not in items or items[key]["kind"] != "Producto terminado" for key in codes):
        raise InventoryError("Elige códigos de equipos o configuraciones válidos.")
    quantity = number(quantity, "cantidad de equipos", optional=False)
    if quantity <= 0 or quantity != quantity.to_integral_value() or quantity > 10000:
        raise InventoryError("La cantidad de equipos debe ser un entero entre 1 y 10 000.")
    missing = [key for key in codes if not data["recipes"].get(key)]
    if any(items[key]["currency"] != items[code]["currency"] for key in codes):
        raise InventoryError("El equipo y sus adicionales deben usar la misma moneda.")
    quantities = defaultdict(Decimal)
    for key in codes:
        for part in data["recipes"].get(key, []):
            quantities[part["component"]] += part["quantity"]
    rows, capacities = [], []
    for component, per_unit in sorted(quantities.items()):
        item = items[component]
        stock = item["stock"][location]
        needed = per_unit * quantity
        shortage = None if stock is None else max(Decimal(0), needed - stock)
        capacities.append(None if stock is None else max(0, int(stock // per_unit)))
        rows.append({**item, "per_unit": per_unit, "needed": needed, "available": stock,
                     "shortage": shortage, "state": "Por contar" if stock is None else "Falta material" if shortage else "Disponible"})
    selected_costs = [cost for cost in data["costs"] if cost["code"] in codes]
    def total(field):
        values = [cost[field] for cost in selected_costs]
        return sum(values, Decimal(0)) * quantity if len(values) == len(codes) and all(value is not None for value in values) else None
    capacity = min(capacities) if capacities and not missing and all(n is not None for n in capacities) else None
    return {"code": code, "name": items[code]["name"], "quantity": quantity, "location": location,
            "additionals": list(additionals), "rows": rows, "missing": missing, "capacity": capacity,
            "materials": total("materials"), "labor": total("labor"), "total": total("total"),
            "currency": items[code]["currency"],
            "ready": capacity is not None and capacity >= quantity}
