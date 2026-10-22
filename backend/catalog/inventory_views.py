from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied
from django.http import JsonResponse
from django.shortcuts import redirect
from django.template.response import TemplateResponse
from django.views.decorators.http import require_GET, require_POST

from security.services import audit
from .inventory import InventoryError, dashboard, load_snapshot, manufacturing_plan
from .inventory_sync import refresh_inventory, sync_status


@require_GET
def inventory_dashboard(request):
    if not request.user.has_perm("catalog.view_product"):
        raise PermissionDenied
    context = {**admin.site.each_context(request), "title": "Inventario", "inventory": None, "error": "", "is_nav_sidebar_enabled": False}
    try:
        snapshot = load_snapshot()
        context["sync"] = sync_status(snapshot=snapshot)
        context["sync_ready"] = context["sync"]["enabled"]
        if snapshot:
            location = request.GET.get("ubicacion", "")
            unit = request.GET.get("unidad", "")
            context["inventory"] = dashboard(snapshot, location, unit)
            context["chart_data"] = {key: context["inventory"][key] for key in ("kinds", "states", "monthly")}
            context["sheet_url"] = f'https://docs.google.com/spreadsheets/d/{snapshot["spreadsheetId"]}/edit'
            context["finished_items"] = sorted((item for item in context["inventory"]["items"] if item["kind"] == "Producto terminado"), key=lambda item: item["code"])
            context["extra_slots"] = (request.GET.getlist("adicional") + ["", "", ""])[:3]
            if request.GET.get("equipo"):
                try:
                    context["plan"] = manufacturing_plan(snapshot, request.GET["equipo"], request.GET.get("cantidad", "1"),
                                                         request.GET.get("almacen", "Taller"), tuple(filter(None, request.GET.getlist("adicional"))))
                except InventoryError as error:
                    context["plan_error"] = str(error)
    except (InventoryError, KeyError):
        context["error"] = "No se pudo leer el inventario. Actualiza la copia desde Google Sheets."
        context["sync"] = sync_status()
        context["sync_ready"] = context["sync"]["enabled"]
    return TemplateResponse(request, "admin/inventory/dashboard.html", context)


@require_POST
def inventory_refresh(request):
    # Refresh is a read from Google, never a stock/catalog edit. All inventory
    # readers can keep their private projection up to date, with CSRF protection.
    if not request.user.has_perm("catalog.view_product"):
        raise PermissionDenied
    result = refresh_inventory()
    if result["refreshed"] and result["changed"]:
        audit("inventory_refreshed", request, request.user)
    if "application/json" in request.headers.get("Accept", ""):
        return JsonResponse(result)
    if result["state"] == "connected":
        messages.success(request, "Inventario conectado con Google Sheets. Los cambios se revisan automáticamente cada minuto.")
    else:
        messages.warning(request, result["message"])
    return redirect("inventory-dashboard")


@require_GET
def inventory_status(request):
    if not request.user.has_perm("catalog.view_product"):
        raise PermissionDenied
    return JsonResponse(sync_status())
