"""Private sales workspace. Every route also passes the existing MFA admin gate."""
import csv
from datetime import timedelta
from urllib.parse import urlencode

from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied, ValidationError
from django.core.paginator import Paginator
from django.db.models import Count, Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST, require_http_methods

from .forms import OpportunityForm
from .metrics import build_metrics
from .models import Opportunity
from .services import add_note, create_opportunity, mark_contacted, update_opportunity


CLOSED = ("won", "delivered", "lost")


def require_access(request, action="view"):
    if not request.user.has_perm("crm.view_opportunity") or not request.user.has_perm(f"crm.{action}_opportunity"):
        raise PermissionDenied


def context(request, **values):
    return {**admin.site.each_context(request), "can_add": request.user.has_perm("crm.add_opportunity"),
        "can_edit": request.user.has_perm("crm.change_opportunity"), "now": timezone.now(),
        "today": timezone.localdate(), **values}


def filtered(request):
    query = Opportunity.objects.select_related("assignee")
    filters = {key: request.GET.get(key, "")[:160].strip() for key in ("q", "stage", "source", "assignee", "focus", "period")}
    if filters["q"]:
        term = filters["q"]
        search = Q(name__icontains=term) | Q(company__icontains=term) | Q(phone__icontains=term) | Q(email__icontains=term) | Q(product_code__icontains=term) | Q(interest__icontains=term)
        code = term.upper().removeprefix("CRM-")
        if code.isascii() and code.isdecimal() and len(code) < 12:
            search |= Q(pk=int(code))
        query = query.filter(search)
    if filters["stage"] in Opportunity.Stage.values:
        query = query.filter(stage=filters["stage"])
    else:
        filters["stage"] = ""
    if filters["source"] in Opportunity.Source.values:
        query = query.filter(source=filters["source"])
    else:
        filters["source"] = ""
    assigned = filters["assignee"]
    if assigned == "me":
        query = query.filter(assignee=request.user)
    elif assigned == "unassigned":
        query = query.filter(assignee__isnull=True)
    elif assigned.isascii() and assigned.isdecimal() and len(assigned) < 12:
        query = query.filter(assignee_id=int(assigned))
    else:
        filters["assignee"] = ""
    focus = filters["focus"]
    if focus == "overdue":
        query = query.exclude(stage__in=CLOSED).filter(next_followup__lt=timezone.now())
    elif focus == "today":
        query = query.exclude(stage__in=CLOSED).filter(next_followup__date=timezone.localdate())
    elif focus == "unassigned":
        query = query.exclude(stage__in=CLOSED).filter(assignee__isnull=True)
    else:
        filters["focus"] = "all"
    if filters["period"] not in ("7", "30", "90"):
        filters["period"] = "30"
    return query, filters


@require_GET
def dashboard(request):
    require_access(request)
    tab = request.GET.get("tab", "today")
    if tab not in ("today", "pipeline", "metrics"):
        tab = "today"
    query, filters = filtered(request)
    open_query = query.exclude(stage__in=CLOSED)
    now, today = timezone.now(), timezone.localdate()
    counts = Opportunity.objects.exclude(stage__in=CLOSED).aggregate(open=Count("pk"), overdue=Count("pk", filter=Q(next_followup__lt=now)),
        today=Count("pk", filter=Q(next_followup__date=today)), unassigned=Count("pk", filter=Q(assignee__isnull=True)))
    page_obj, columns, metrics = None, [], None
    if tab == "today":
        from django.db.models import F
        listing = query if filters["stage"] else open_query
        page_obj = Paginator(listing.order_by(F("next_followup").asc(nulls_last=True), "-created_at"), 25).get_page(request.GET.get("page"))
    elif tab == "pipeline":
        totals = dict(query.values_list("stage").annotate(total=Count("pk")))
        for value, label in Opportunity.Stage.choices:
            columns.append({"value": value, "label": label, "total": totals.get(value, 0),
                "url": reverse("crm:dashboard") + "?" + urlencode({**filters, "tab": "today", "stage": value}),
                "items": list(query.filter(stage=value).order_by("-updated_at")[:30])})
    else:
        metrics = build_metrics(query, start=today - timedelta(days=int(filters["period"]) - 1), end=today, now=now, source=filters["source"] or None)
    return render(request, "admin/crm/dashboard.html", context(request, title="Ventas · CRM", tab=tab,
        filters=filters, querystring=urlencode({"tab": tab, **filters}), page_obj=page_obj,
        counts=counts, stage_columns=columns, metrics=metrics, has_opportunities=Opportunity.objects.exists(), stage_choices=Opportunity.Stage.choices,
        source_choices=Opportunity.Source.choices, assignees=OpportunityForm(user=request.user).fields["assignee"].queryset))


def form_data(form):
    data = dict(form.cleaned_data)
    data.pop("version", None)
    return data


def form_error(form, error):
    # Include model/service validation without assuming all keys exist in this form.
    if hasattr(error, "message_dict"):
        for field, errors in error.message_dict.items():
            for message in errors:
                form.add_error(field if field in form.fields else None, message)
    else:
        for message in error.messages:
            form.add_error(None, message)


@require_http_methods(["GET", "POST"])
def create(request):
    require_access(request, "add")
    form = OpportunityForm(request.POST if request.method == "POST" else None, user=request.user)
    if request.method == "POST" and form.is_valid():
        try:
            lead = create_opportunity(form_data(form), actor=request.user)
        except ValidationError as error:
            form_error(form, error)
        else:
            messages.success(request, f"{lead.code}: consulta guardada. Ya puedes organizar su seguimiento.")
            return redirect("crm:detail", pk=lead.pk)
    return render(request, "admin/crm/form.html", context(request, title="Nueva consulta", form=form))


def detail_response(request, lead, form=None, status=200):
    return render(request, "admin/crm/detail.html", context(request, title=f"{lead.code} · {lead.name}",
        opportunity=lead, form=form or OpportunityForm(instance=lead, user=request.user),
        activities=lead.activities.select_related("actor").order_by("-created_at", "-pk")[:100]), status=status)


@require_GET
def detail(request, pk):
    require_access(request)
    return detail_response(request, get_object_or_404(Opportunity.objects.select_related("assignee"), pk=pk))


@require_POST
def update(request, pk):
    require_access(request, "change")
    lead = get_object_or_404(Opportunity.objects.select_related("assignee"), pk=pk)
    form = OpportunityForm(request.POST, instance=lead, user=request.user)
    if form.is_valid():
        try:
            update_opportunity(pk, form_data(form), actor=request.user, expected_version=form.cleaned_data["version"])
        except ValidationError as error:
            form_error(form, error)
        else:
            messages.success(request, "Cambios guardados y registrados en el historial.")
            return redirect("crm:detail", pk=pk)
    # Bound form retains the submitted version and input. A conflict must be reviewed.
    lead = get_object_or_404(Opportunity.objects.select_related("assignee"), pk=pk)
    return detail_response(request, lead, form=form, status=400)


def action_error(request, error):
    messages.error(request, " ".join(error.messages))


@require_POST
def note(request, pk):
    require_access(request, "change")
    get_object_or_404(Opportunity, pk=pk)
    try:
        add_note(pk, request.POST.get("body", ""), actor=request.user, expected_version=request.POST.get("version"))
    except ValidationError as error:
        action_error(request, error)
    else:
        messages.success(request, "Nota añadida al historial.")
    return redirect("crm:detail", pk=pk)


@require_POST
def contact(request, pk):
    require_access(request, "change")
    get_object_or_404(Opportunity, pk=pk)
    try:
        mark_contacted(pk, actor=request.user, expected_version=request.POST.get("version"), body=request.POST.get("body", ""))
    except ValidationError as error:
        action_error(request, error)
    else:
        messages.success(request, "Contacto registrado. Revisa cuándo será el próximo seguimiento.")
    return redirect("crm:detail", pk=pk)


def csv_cell(value):
    value = "" if value is None else str(value)
    return "'" + value if value.lstrip().startswith(("=", "+", "-", "@")) or value.startswith(("\t", "\r", "\n")) else value


@require_GET
def export_csv(request):
    require_access(request)
    query, filters = filtered(request)
    if request.GET.get("tab", "today") == "today" and not filters["stage"]:
        query = query.exclude(stage__in=CLOSED)
    if request.GET.get("tab") == "metrics":
        today = timezone.localdate()
        query = query.filter(created_at__date__range=(today - timedelta(days=int(filters["period"]) - 1), today))
    if query.count() > 10000:
        messages.error(request, "Reduce los filtros para exportar un máximo de 10 000 consultas por archivo.")
        return redirect(reverse("crm:dashboard") + "?" + urlencode(filters))
    response = HttpResponse(content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = 'attachment; filename="inox304-ventas.csv"'
    response.write("\ufeff")
    writer = csv.writer(response)
    writer.writerow(["Código", "Nombre", "Empresa", "Teléfono", "Correo", "Ciudad", "Interés", "Equipo", "Configuración", "Origen", "Campaña", "Etapa", "Responsable", "Próximo contacto", "Importe", "Moneda", "Creada"])
    for lead in query.order_by("-created_at").iterator(chunk_size=500):
        writer.writerow([csv_cell(value) for value in [lead.code, lead.name, lead.company, lead.phone, lead.email,
            lead.city, lead.interest, lead.product_code, lead.configuration, lead.get_source_display(), lead.campaign,
            lead.get_stage_display(), lead.assignee.get_full_name() or lead.assignee.username if lead.assignee else "",
            timezone.localtime(lead.next_followup).isoformat() if lead.next_followup else "",
            lead.quote_amount if lead.quote_amount is not None else "", lead.currency, timezone.localtime(lead.created_at).isoformat()]])
    return response
