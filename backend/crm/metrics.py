"""Honest cohort metrics: a WhatsApp click is neither a lead nor a sale."""
from datetime import datetime, time, timedelta
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Count, DurationField, ExpressionWrapper, F, Q, Sum
from django.utils import timezone

from .models import Opportunity, WebMetric


def _date(value):
    return value.date() if isinstance(value, datetime) else value


def _rate(numerator, denominator):
    return round(100 * numerator / denominator, 1) if denominator else 0.0


def _midnight(day):
    return timezone.make_aware(datetime.combine(day, time.min), timezone.get_current_timezone())


@transaction.atomic
def record_web_metric(source, event, *, date=None):
    if source not in Opportunity.Source.values or event not in WebMetric.Event.values:
        raise ValidationError("Origen o evento de medición no válido.")
    metric, _ = WebMetric.objects.get_or_create(date=date or timezone.localdate(), source=source, event=event)
    WebMetric.objects.filter(pk=metric.pk).update(count=F("count") + 1)
    return metric.pk


def build_metrics(queryset, *, start=None, end=None, now=None, source=None):
    """Date bounds include their full local days; all sales refer to that cohort.

    Monetary totals use each opportunity's current quoted value, never imply
    payments collected. Confirmed sales count only currently won/delivered
    opportunities; milestone history survives cancellations and reopening.
    Exact response median is
    computed in SQL order with at most two duration values returned to Python.
    Web counters cover events *during* the period, independently of the cohort.
    """
    now = now or timezone.now()
    start, end = _date(start), _date(end)
    if start and end and start > end:
        raise ValidationError("La fecha inicial no puede ser posterior a la final.")
    cohort = queryset.order_by()
    web = WebMetric.objects.all()
    if source:
        if source not in Opportunity.Source.values:
            raise ValidationError("Selecciona un canal válido.")
        cohort = cohort.filter(source=source)
        web = web.filter(source=source)
    if start:
        cohort = cohort.filter(created_at__gte=_midnight(start))
        web = web.filter(date__gte=start)
    if end:
        cohort = cohort.filter(created_at__lt=_midnight(end + timedelta(days=1)))
        web = web.filter(date__lte=end)
    open_stage = ~Q(stage__in=[Opportunity.Stage.WON, Opportunity.Stage.DELIVERED, Opportunity.Stage.LOST])
    confirmed_sale = Q(stage__in=[Opportunity.Stage.WON, Opportunity.Stage.DELIVERED])
    today = timezone.localdate(now)
    totals = cohort.aggregate(
        total=Count("pk"),
        quoted=Count("pk", filter=Q(quoted_at__isnull=False)),
        won=Count("pk", filter=confirmed_sale),
        delivered=Count("pk", filter=Q(stage=Opportunity.Stage.DELIVERED)),
        lost=Count("pk", filter=Q(stage=Opportunity.Stage.LOST)),
        contacted=Count("pk", filter=Q(first_contact_at__isnull=False)),
        overdue=Count("pk", filter=open_stage & Q(next_followup__lt=now)),
        unassigned=Count("pk", filter=open_stage & Q(assignee__isnull=True)),
        due_today=Count("pk", filter=open_stage & Q(next_followup__gte=_midnight(today), next_followup__lt=_midnight(today + timedelta(days=1)))),
    )
    stage_counts = dict.fromkeys(Opportunity.Stage.values, 0)
    stage_counts.update({row["stage"]: row["count"] for row in cohort.values("stage").annotate(count=Count("pk"))})
    source_names = dict(Opportunity.Source.choices)
    source_rows = list(cohort.values("source").annotate(
        leads=Count("pk"), quoted=Count("pk", filter=Q(quoted_at__isnull=False)), won=Count("pk", filter=confirmed_sale),
    ).order_by("-leads", "source"))
    for row in source_rows:
        row.update(label=source_names.get(row["source"], "Sin identificar"), conversion_rate=_rate(row["won"], row["leads"]))
    campaign_rows = list(cohort.exclude(campaign="").values("source", "campaign").annotate(
        leads=Count("pk"), won=Count("pk", filter=confirmed_sale),
    ).order_by("-leads", "source", "campaign")[:10])
    for row in campaign_rows:
        row.update(source_label=source_names.get(row["source"], "Sin identificar"), conversion_rate=_rate(row["won"], row["leads"]))
    loss_names = dict(Opportunity.LossReason.choices)
    loss_rows = list(cohort.filter(stage=Opportunity.Stage.LOST).values("loss_reason").annotate(count=Count("pk")).order_by("-count", "loss_reason"))
    for row in loss_rows:
        row["label"] = loss_names.get(row["loss_reason"], "Sin motivo registrado")
    value_rows = {row["currency"]: row for row in cohort.values("currency").annotate(
        quoted=Sum("quote_amount", filter=Q(quoted_at__isnull=False)),
        won=Sum("quote_amount", filter=confirmed_sale),
    )}
    amounts = [{"currency": currency, "quoted": value_rows.get(currency, {}).get("quoted") or Decimal("0"), "won": value_rows.get(currency, {}).get("won") or Decimal("0")} for currency in Opportunity.Currency.values]
    responded = cohort.filter(first_contact_at__isnull=False, first_contact_at__gte=F("created_at")).annotate(
        response_delay=ExpressionWrapper(F("first_contact_at") - F("created_at"), output_field=DurationField())
    )
    response_count = responded.count()
    median_hours = None
    if response_count:
        offset = (response_count - 1) // 2
        size = 1 if response_count % 2 else 2
        middle = list(responded.order_by("response_delay", "pk").values_list("response_delay", flat=True)[offset:offset + size])
        median_hours = round(sum(item.total_seconds() for item in middle) / len(middle) / 3600, 2)
    web_totals = web.aggregate(
        clicks=Sum("count", filter=Q(event=WebMetric.Event.CLICK_WHATSAPP)),
        submissions=Sum("count", filter=Q(event=WebMetric.Event.CONTACT_SUBMIT)),
    )
    funnel = [{"label": label, "count": totals[key], "percent": _rate(totals[key], totals["total"])} for key, label in [
        ("total", "Oportunidades registradas"), ("contacted", "Contacto realizado"),
        ("quoted", "Cotización registrada"), ("won", "Venta confirmada"), ("delivered", "Entregado"),
    ]]
    return {
        **{key: totals[key] for key in ("total", "quoted", "won", "delivered", "lost", "contacted")},
        "conversion_rate": _rate(totals["won"], totals["total"]),
        "median_response_hours": median_hours,
        "response_sample_count": response_count,
        "stage_counts": stage_counts,
        "source_rows": source_rows,
        "campaign_rows": campaign_rows,
        "loss_rows": loss_rows,
        "amounts": amounts,
        "funnel": funnel,
        "operational_counts": {key: totals[key] for key in ("overdue", "unassigned", "due_today")},
        "web_clicks": web_totals["clicks"] or 0,
        "contact_submissions": web_totals["submissions"] or 0,
        "web_scope": source_names[source] if source else "Toda la web (todos los canales)",
        "start": start,
        "end": end,
    }
