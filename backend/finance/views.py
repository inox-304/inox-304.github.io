"""Private, company-scoped finance workspace behind the existing admin MFA gate."""
import csv
import json
from datetime import date
from urllib.parse import urlencode

from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied, ValidationError
from django.core.paginator import Paginator
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import FileResponse, HttpResponse, HttpResponseBadRequest
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST, require_http_methods

from catalog.storage import open_private_file
from .forms import AccountForm, AttachmentForm, CategoryForm, CompanyForm, ItemForm, LineFormSet, MemberForm, MovementForm, PeriodForm
from .metrics import movement_metrics
from .models import Account, Attachment, Audit, Category, ClosedPeriod, Company, CompanyAccess, CURRENCIES, Item, Movement
from .permissions import accessible_companies, can_access, can_company, is_owner, require_company
from . import services


def require_access(request):
    if not can_access(request.user):
        raise PermissionDenied("El propietario debe darte acceso a Finanzas por empresa.")


def require_owner(request):
    if not is_owner(request.user):
        raise PermissionDenied("Solo el propietario administra empresas y accesos financieros.")


def base_context(request, **kwargs):
    companies = accessible_companies(request.user)
    return {**admin.site.each_context(request), "is_nav_sidebar_enabled": False,
            "owner": is_owner(request.user), "companies": companies,
            "can_record": any(can_company(request.user, company, "record") for company in companies if company.active),
            "pending_count": Movement.objects.filter(company__in=companies, status="draft").count(), **kwargs}


def scoped_movement(request, pk, action="view"):
    obj = get_object_or_404(Movement.objects.select_related("company", "account", "destination_account", "category").filter(company__in=accessible_companies(request.user)), pk=pk)
    require_company(request.user, obj.company, action)
    return obj


def selected_company(request, *, active=False):
    companies = accessible_companies(request.user)
    if active:
        companies = companies.filter(active=True)
    value = request.GET.get("company", "")
    if value:
        if not value.isascii() or not value.isdecimal() or len(value) > 12:
            raise PermissionDenied
        return get_object_or_404(companies, pk=int(value))
    return companies.first()


def filtered_movements(request):
    query = Movement.objects.filter(company__in=accessible_companies(request.user)).select_related("company", "account", "category", "destination_account")
    today = timezone.localdate()
    filters = {key: request.GET.get(key, "")[:160].strip() for key in ("company", "q", "status", "method", "currency", "from", "to")}
    if "from" not in request.GET:
        filters["from"] = today.replace(day=1).isoformat()
    if "to" not in request.GET:
        filters["to"] = today.isoformat()
    errors = []
    if filters["company"]:
        if not filters["company"].isascii() or not filters["company"].isdecimal() or len(filters["company"]) > 12:
            raise PermissionDenied
        company = get_object_or_404(accessible_companies(request.user), pk=int(filters["company"]))
        query = query.filter(company=company)
    for key, lookup in (("from", "occurred_on__gte"), ("to", "occurred_on__lte")):
        if filters[key]:
            try:
                value = date.fromisoformat(filters[key])
            except ValueError:
                errors.append("Usa fechas válidas para consultar movimientos.")
                query = query.none()
            else:
                query = query.filter(**{lookup: value})
    if filters["from"] and filters["to"] and filters["from"] > filters["to"]:
        errors.append("La fecha inicial debe ser anterior o igual a la final.")
        query = query.none()
    if filters["status"] in Movement.Status.values:
        query = query.filter(status=filters["status"])
    else:
        filters["status"] = ""
    if filters["method"] in Account.Method.values:
        query = query.filter(account__method=filters["method"])
    else:
        filters["method"] = ""
    if filters["currency"] in dict(CURRENCIES):
        query = query.filter(currency=filters["currency"])
    else:
        filters["currency"] = ""
    if filters["q"]:
        term = filters["q"]
        search = Q(description__icontains=term) | Q(reference__icontains=term) | Q(account__name__icontains=term)
        code = term.upper().removeprefix("FIN-")
        if code.isascii() and code.isdecimal() and len(code) < 13:
            search |= Q(pk=int(code))
        query = query.filter(search)
    return query, filters, errors


@require_GET
def dashboard(request):
    require_access(request)
    query, filters, errors = filtered_movements(request)
    active_companies = accessible_companies(request.user).filter(active=True)
    can_record_selected = any(can_company(request.user, company, "record") for company in active_companies.filter(pk=int(filters["company"]))) if filters["company"] else any(can_company(request.user, company, "record") for company in active_companies)
    return render(request, "admin/finance/dashboard.html", base_context(request, title="Finanzas", section="review" if filters["status"] == "draft" else "dashboard",
        can_record=can_record_selected,
        filters=filters, filter_errors=errors, querystring=urlencode(filters), page_obj=Paginator(query, 30).get_page(request.GET.get("page")),
        summaries=movement_metrics(query), filtered_drafts=query.filter(status="draft").count(),
        has_companies=accessible_companies(request.user).exists(), has_accounts=Account.objects.filter(company__in=accessible_companies(request.user), active=True).exists(),
        currencies=CURRENCIES, statuses=Movement.Status.choices, methods=Account.Method.choices))


def put_errors(form, error):
    if hasattr(error, "message_dict"):
        for field, errors in error.message_dict.items():
            for message in errors:
                form.add_error(field if field in form.fields else None, message)
    else:
        for message in error.messages:
            form.add_error(None, message)


def line_initial(movement):
    if not movement:
        return []
    return [{key: getattr(line, key) for key in ("item", "item_code", "item_name", "unit", "quantity", "unit_price", "unit_cost")} for line in movement.lines.select_related("item").all()]


def line_data(formset):
    result = []
    for form in formset.forms:
        if not form.cleaned_data or form.cleaned_data.get("DELETE") or (not form.has_changed() and not form.initial):
            continue
        data = {key: value for key, value in form.cleaned_data.items() if key != "DELETE"}
        # On new lines, blank fields can use the selected item's current suggestions.
        # Existing snapshots are explicit values and are never silently refreshed.
        if not form.initial:
            data = {key: value for key, value in data.items() if value not in ("", None)}
        result.append(data)
    return result


def movement_form_response(request, company, form, lines, movement=None, status=200):
    line_errors = lines.is_bound and (any(lines.errors) or bool(lines.non_form_errors()))
    return render(request, "admin/finance/form.html", base_context(request, title="Editar borrador" if movement else "Nuevo movimiento", section="review",
        company=company, form=form, lines=lines, movement=movement, record_companies=[c for c in accessible_companies(request.user).filter(active=True) if can_company(request.user, c, "record")],
        line_errors=line_errors, open_lines=line_errors or bool(movement and movement.lines.exists()),
        has_accounts=Account.objects.filter(company=company, active=True).exists()), status=status)


@require_http_methods(["GET", "POST"])
def create(request):
    require_access(request)
    company = selected_company(request, active=True) if request.GET.get("company") else next((company for company in accessible_companies(request.user).filter(active=True) if can_company(request.user, company, "record")), None)
    if company is None:
        if not is_owner(request.user) and accessible_companies(request.user).exists():
            raise PermissionDenied("Tu acceso actual permite consultar, pero no crear movimientos.")
        messages.info(request, "Primero crea una empresa y su cuenta o caja en Configuración.")
        return redirect("finance:settings" if is_owner(request.user) else "finance:dashboard")
    require_company(request.user, company, "record")
    form = MovementForm(request.POST if request.method == "POST" else None, company=company)
    lines = LineFormSet(request.POST if request.method == "POST" else None, prefix="lines", form_kwargs={"company": company})
    if request.method == "POST":
        valid_form, valid_lines = form.is_valid(), lines.is_valid()
        if valid_form and valid_lines:
            data = dict(form.cleaned_data)
            key = data.pop("idempotency_key")
            data.pop("version", None)
            data["company"] = company
            try:
                movement = services.create_draft(data, actor=request.user, lines=line_data(lines), idempotency_key=key)
            except ValidationError as error:
                put_errors(form, error)
            else:
                messages.success(request, f"{movement.code} guardado para revisión. Todavía no suma en los resultados.")
                return redirect("finance:detail", pk=movement.pk)
    return movement_form_response(request, company, form, lines)


@require_http_methods(["GET", "POST"])
def edit(request, pk):
    require_access(request)
    movement = scoped_movement(request, pk, "record")
    if movement.status != "draft":
        messages.error(request, "Este movimiento ya tiene un cierre. Sus datos históricos se conservan.")
        return redirect("finance:detail", pk=pk)
    form = MovementForm(request.POST if request.method == "POST" else None, company=movement.company, instance=movement)
    lines = LineFormSet(request.POST if request.method == "POST" else None, prefix="lines", initial=line_initial(movement), form_kwargs={"company": movement.company})
    if request.method == "POST":
        valid_form, valid_lines = form.is_valid(), lines.is_valid()
        if valid_form and valid_lines:
            data = dict(form.cleaned_data)
            version = data.pop("version")
            data.pop("idempotency_key", None)
            try:
                services.update_draft(pk, data, actor=request.user, expected_version=version, lines=line_data(lines))
            except ValidationError as error:
                put_errors(form, error)
            else:
                messages.success(request, "Borrador actualizado. El cambio quedó en su historial.")
                return redirect("finance:detail", pk=pk)
    return movement_form_response(request, movement.company, form, lines, movement)


@require_GET
def detail(request, pk):
    require_access(request)
    movement = scoped_movement(request, pk)
    return render(request, "admin/finance/detail.html", base_context(request, title=movement.code, section="review", movement=movement,
        can_edit=can_company(request.user, movement.company, "record"), can_review=can_company(request.user, movement.company, "review"),
        attachment_form=AttachmentForm(), audit=movement.audit_entries.select_related("actor")[:100]))


@require_POST
def post(request, pk):
    require_access(request)
    scoped_movement(request, pk, "review")
    try:
        services.post_movement(pk, actor=request.user, expected_version=request.POST.get("version"))
    except ValidationError as error:
        messages.error(request, " ".join(error.messages))
    else:
        messages.success(request, "Movimiento confirmado. Sus importes y detalles históricos quedan protegidos.")
    return redirect("finance:detail", pk=pk)


@require_POST
def void(request, pk):
    require_access(request)
    scoped_movement(request, pk, "review")
    try:
        services.void_movement(pk, actor=request.user, expected_version=request.POST.get("version"), reason=request.POST.get("reason", ""))
    except ValidationError as error:
        messages.error(request, " ".join(error.messages))
    else:
        messages.success(request, "Movimiento anulado con motivo. Se conserva en el historial y deja de sumar en resultados.")
    return redirect("finance:detail", pk=pk)


@require_POST
def upload(request, pk):
    require_access(request)
    scoped_movement(request, pk, "record")
    form = AttachmentForm(request.POST, request.FILES)
    if form.is_valid():
        try:
            services.attach_document(pk, form.cleaned_data["document"], actor=request.user)
        except ValidationError as error:
            messages.error(request, " ".join(error.messages))
        except OSError:
            messages.error(request, "No se pudo conservar el archivo. Inténtalo de nuevo; el movimiento sigue guardado.")
        else:
            messages.success(request, "Comprobante conservado en privado. Adjuntarlo no registra un segundo pago.")
    else:
        messages.error(request, "Selecciona un comprobante válido para adjuntar.")
    return redirect("finance:detail", pk=pk)


@require_GET
def download(request, pk):
    require_access(request)
    attachment = get_object_or_404(Attachment.objects.select_related("movement__company").filter(movement__company__in=accessible_companies(request.user)), pk=pk)
    require_company(request.user, attachment.movement.company)
    try:
        handle = open_private_file(attachment.file.storage, attachment.file.name)
    except (OSError, ValueError):
        return HttpResponse("El archivo no está disponible. El registro se conserva; contacta al propietario.", status=503, content_type="text/plain; charset=utf-8")
    response = FileResponse(handle, as_attachment=True, filename=attachment.name, content_type=attachment.content_type)
    response["X-Content-Type-Options"] = "nosniff"
    return response


def csv_cell(value):
    text = "" if value is None else str(value)
    if text.lstrip().startswith(("=", "+", "-", "@", "\t", "\r", "\n")):
        text = "'" + text
    return text


@require_GET
def export_csv(request):
    require_access(request)
    query, filters, errors = filtered_movements(request)
    if errors:
        return HttpResponseBadRequest("Revisa las fechas del filtro antes de exportar.")
    if query.count() > 5000:
        return HttpResponseBadRequest("Limita la exportación a 5.000 movimientos usando empresa y fechas.")
    response = HttpResponse(content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = 'attachment; filename="inox-finanzas-movimientos.csv"'
    response.write("\ufeff")
    writer = csv.writer(response)
    writer.writerow(["Código", "Empresa", "Fecha", "Tipo", "Estado", "Medio", "Cuenta", "Destino", "Categoría", "Moneda", "Importe", "Detalle", "Referencia", "Motivo anulación", "Detalles históricos (JSON)"])
    for obj in query.prefetch_related("lines").iterator(chunk_size=200):
        snapshots = [{"codigo": line.item_code, "concepto": line.item_name, "unidad": line.unit, "cantidad": str(line.quantity), "precio_unitario": str(line.unit_price), "costo_unitario": None if line.unit_cost is None else str(line.unit_cost)} for line in obj.lines.all()]
        writer.writerow([csv_cell(value) for value in [obj.code, obj.company.name, obj.occurred_on, obj.get_kind_display(), obj.get_status_display(), obj.account.get_method_display(), obj.account.name, obj.destination_account.name if obj.destination_account_id else "", obj.category.name if obj.category_id else "", obj.currency, obj.amount, obj.description, obj.reference, obj.void_reason, json.dumps(snapshots, ensure_ascii=False)]])
    return response


@require_GET
def settings_view(request):
    require_owner(request)
    company = selected_company(request)
    tab = request.GET.get("tab", "companies")
    if tab not in ("companies", "accounts", "categories", "items", "access", "periods"):
        tab = "companies"
    mapping = {"accounts": Account, "categories": Category, "items": Item, "access": CompanyAccess, "periods": ClosedPeriod}
    records = Company.objects.all() if tab == "companies" else (mapping[tab].objects.filter(company=company) if company else mapping[tab].objects.none())
    if tab == "access":
        records = records.select_related("user")
    return render(request, "admin/finance/settings.html", base_context(request, title="Configurar Finanzas", section="settings", tab=tab, company=company,
        records=records[:500], member_form=MemberForm(), period_form=PeriodForm(initial={"year": timezone.localdate().year, "month": timezone.localdate().month})))


@require_POST
def prepare_companies(request):
    require_owner(request)
    created_count = 0
    with transaction.atomic():
        for code, name in (("INOX304", "INOX 304"), ("ARMOSAC", "Armosac"), ("VICTOR", "Victor"), ("SHAMO", "Shamo")):
            company, created = Company.objects.get_or_create(code=code, defaults={"name": name, "default_currency": "PEN"})
            if created:
                created_count += 1
                Audit.objects.create(company=company, actor=request.user, action="company_created", body="Empresa preparada por el propietario. Moneda inicial PEN pendiente de confirmar; sin cuentas, saldos ni movimientos.")
    messages.success(request, f"{created_count} empresa(s) preparada(s). Puedes editar nombres, confirmar monedas y añadir más empresas.")
    return redirect("finance:settings")


SETUP_MODELS = {"companies": (Company, CompanyForm, "empresa"), "accounts": (Account, AccountForm, "cuenta"), "categories": (Category, CategoryForm, "categoría"), "items": (Item, ItemForm, "ítem")}


@require_http_methods(["GET", "POST"])
def setup_edit(request, kind, pk=None):
    require_owner(request)
    if kind not in SETUP_MODELS:
        raise PermissionDenied
    model, form_class, label = SETUP_MODELS[kind]
    company = None if kind == "companies" else selected_company(request)
    if kind != "companies" and company is None:
        messages.error(request, "Crea una empresa antes de añadir su configuración.")
        return redirect("finance:settings")
    instance = get_object_or_404(model.objects.all() if kind == "companies" else model.objects.filter(company=company), pk=pk) if pk else model()
    if company:
        instance.company = company
    form = form_class(request.POST if request.method == "POST" else None, instance=instance)
    if request.method == "POST" and form.is_valid():
        try:
            with transaction.atomic():
                # Configuration edits are audited; operation snapshots stay separate.
                if company:
                    Company.objects.select_for_update().get(pk=company.pk)
                elif pk:
                    Company.objects.select_for_update().get(pk=pk)
                saved = form.save()
                Audit.objects.create(company=saved if kind == "companies" else company, actor=request.user, action=f"{kind}_saved",
                    body=f"{label.capitalize()} {saved.pk} {'actualizada' if pk else 'creada'}: {saved}. Campos: {', '.join(form.changed_data) or 'sin cambios'}."[:4000])
        except ValidationError as error:
            put_errors(form, error)
        except IntegrityError:
            form.add_error(None, "Ya existe un registro con esos datos. Revisa el código o el nombre.")
        else:
            messages.success(request, f"{label.capitalize()} guardada. Los movimientos históricos se mantienen.")
            return redirect(reverse("finance:settings") + "?" + urlencode({"tab": kind, "company": (saved.pk if kind == "companies" else company.pk)}))
    return render(request, "admin/finance/setup_form.html", base_context(request, title=f"{'Editar' if pk else 'Nueva configuración:'} {label}", section="settings", kind=kind, company=company, form=form, label=label))


@require_POST
def member_save(request):
    require_owner(request)
    company = selected_company(request)
    if company is None:
        return HttpResponseBadRequest("Selecciona una empresa.")
    form = MemberForm(request.POST)
    if form.is_valid():
        with transaction.atomic():
            Company.objects.select_for_update().get(pk=company.pk)
            member, _ = CompanyAccess.objects.update_or_create(company=company, user=form.cleaned_data["user"], defaults={"role": form.cleaned_data["role"]})
            Audit.objects.create(company=company, actor=request.user, action="access_changed", body=f"Acceso explícito a {member.user.username}: {member.get_role_display()}.")
        messages.success(request, "Acceso financiero guardado solo para esta empresa. Los demás permisos del panel no cambiaron.")
    else:
        messages.error(request, "Elige una cuenta activa del panel y un permiso válido.")
    return redirect(reverse("finance:settings") + f"?tab=access&company={company.pk}")


@require_POST
def member_remove(request, pk):
    require_owner(request)
    member = get_object_or_404(CompanyAccess.objects.select_related("company", "user"), pk=pk)
    company = member.company
    with transaction.atomic():
        Company.objects.select_for_update().get(pk=company.pk)
        Audit.objects.create(company=company, actor=request.user, action="access_removed", body=f"Acceso financiero retirado a {member.user.username} para esta empresa.")
        member.delete()
    messages.success(request, "Acceso financiero retirado para esta empresa.")
    return redirect(reverse("finance:settings") + f"?tab=access&company={company.pk}")


@require_POST
def period_action(request):
    require_owner(request)
    company = selected_company(request)
    if company is None:
        return HttpResponseBadRequest("Selecciona una empresa.")
    form = PeriodForm(request.POST)
    if form.is_valid():
        try:
            action = request.POST.get("action")
            if action == "close":
                services.close_period(company, form.cleaned_data["year"], form.cleaned_data["month"], actor=request.user)
            elif action == "reopen":
                services.reopen_period(company, form.cleaned_data["year"], form.cleaned_data["month"], actor=request.user, reason=form.cleaned_data["reason"])
            else:
                raise ValidationError("Elige una acción válida.")
        except ValidationError as error:
            messages.error(request, " ".join(error.messages))
        else:
            messages.success(request, "Estado del periodo actualizado y registrado en el historial.")
    else:
        messages.error(request, "Revisa el año, mes y motivo de la operación.")
    return redirect(reverse("finance:settings") + f"?tab=periods&company={company.pk}")


@require_GET
def connections(request):
    require_access(request)
    from finance_intake.models import IntakeMessage
    from finance_intake.services import connection_status
    owner = is_owner(request.user)
    receipt_status = request.GET.get("received_status", "pending")
    if receipt_status not in ("pending", "linked", "ignored", "all"):
        receipt_status = "pending"
    query = IntakeMessage.objects.select_related("movement") if owner else IntakeMessage.objects.none()
    if receipt_status == "pending":
        query = query.filter(status__in=("pending", "needs_review"))
    elif receipt_status != "all":
        query = query.filter(status=receipt_status)
    receipt_page = Paginator(query, 25).get_page(request.GET.get("page"))
    drafts = Movement.objects.filter(status="draft", company__active=True).select_related("company", "account")[:50] if owner else []
    return render(request, "admin/finance/connections.html", base_context(request, title="Recepción y conexiones", section="connections", connection=connection_status(),
        receipts=receipt_page, receipt_page=receipt_page, receipt_status=receipt_status, drafts=drafts))


@require_POST
def receipt_action(request, pk):
    require_owner(request)
    from finance_intake.models import IntakeMessage
    from finance_intake.services import ignore_receipt, link_receipt
    get_object_or_404(IntakeMessage, pk=pk)
    try:
        if request.POST.get("action") == "link":
            value = (request.POST.get("movement_code", "").strip() or request.POST.get("movement", "")).upper().removeprefix("FIN-")
            if not value.isascii() or not value.isdecimal() or len(value) > 12:
                raise ValidationError("Selecciona un borrador para vincular el mensaje.")
            movement = scoped_movement(request, int(value), "record")
            link_receipt(pk, movement, actor=request.user)
        elif request.POST.get("action") == "ignore":
            ignore_receipt(pk, request.POST.get("reason", ""), actor=request.user)
        else:
            raise ValidationError("Selecciona una acción válida.")
    except ValidationError as error:
        messages.error(request, " ".join(error.messages))
    else:
        messages.success(request, "Mensaje revisado. Vincularlo no confirma ni duplica el movimiento.")
    return redirect("finance:connections")
