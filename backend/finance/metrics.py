"""Cash totals are exact Decimal sums; no currency conversion or inferred profit."""
from datetime import date
from decimal import Decimal

from django.db.models import Count, Max, Min, Sum
from django.db.models.functions import TruncMonth

from .models import Account, Movement


def movement_metrics(query):
    posted = query.filter(status=Movement.Status.POSTED)
    by_currency = {}
    for row in posted.order_by().values("currency", "kind").annotate(total=Sum("amount"), count=Count("pk")):
        summary = by_currency.setdefault(row["currency"], {"currency": row["currency"], "income": Decimal("0"), "expense": Decimal("0"), "transfer": Decimal("0"), "count": 0})
        summary[row["kind"]] = row["total"]
        summary["count"] += row["count"]
    for summary in by_currency.values():
        summary["net"] = summary["income"] - summary["expense"]
    return list(sorted(by_currency.values(), key=lambda row: row["currency"]))


MONTH_NAMES = ("Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic")


def _month_shift(value, offset):
    index = value.year * 12 + value.month - 1 + offset
    return date(index // 12, index % 12 + 1, 1)


def _bucket(**values):
    return {"income": Decimal("0"), "expense": Decimal("0"), "transfer": Decimal("0"), "net": Decimal("0"), "count": 0, **values}


def _add(bucket, row):
    bucket[row["kind"]] += row["total"]
    bucket["count"] += row["count"]
    bucket["net"] = bucket["income"] - bucket["expense"]


def dashboard_metrics(query):
    """Two grouped reads, independent of movement count; never read current prices.

    The caller supplies the permitted companies and all non-status filters. Only
    confirmed movements contribute. The chart covers the latest twelve calendar
    months containing the selected records; totals still cover the whole range.
    """
    posted = query.filter(status=Movement.Status.POSTED).order_by()
    by_currency, company_buckets, method_buckets = {}, {}, {}
    first, last = None, None
    for row in posted.values("currency", "company_id", "company__name", "account__method", "kind").annotate(total=Sum("amount"), count=Count("pk"), first=Min("occurred_on"), last=Max("occurred_on")):
        currency = row["currency"]
        summary = by_currency.setdefault(currency, _bucket(currency=currency))
        _add(summary, row)
        first = min(first, row["first"]) if first else row["first"]
        last = max(last, row["last"]) if last else row["last"]
        company = company_buckets.setdefault(currency, {}).setdefault(row["company_id"], _bucket(id=row["company_id"], name=row["company__name"]))
        _add(company, row)
        methods = method_buckets.setdefault(currency, {key: _bucket(key=key, label=label) for key, label in Account.Method.choices})
        _add(methods[row["account__method"]], row)
    if not by_currency:
        return []
    last_month = last.replace(day=1)
    first_month = first.replace(day=1)
    chart_start = max(first_month, _month_shift(last_month, -11))
    summaries = [by_currency[currency] for currency in sorted(by_currency)]
    month_buckets = {currency: {} for currency in by_currency}
    for row in posted.filter(occurred_on__gte=chart_start).annotate(month=TruncMonth("occurred_on")).values("currency", "month", "kind").annotate(total=Sum("amount"), count=Count("pk")):
        if row["currency"] not in by_currency:
            continue
        bucket = month_buckets[row["currency"]].setdefault(row["month"], _bucket())
        _add(bucket, row)
    for summary in summaries:
        currency = summary["currency"]
        months = []
        current = chart_start
        while current <= last_month:
            months.append({**month_buckets[currency].get(current, _bucket()), "month": current, "label": f"{MONTH_NAMES[current.month - 1]} {current.year}"})
            current = _month_shift(current, 1)
        maximum = max((max(month["income"], month["expense"]) for month in months), default=Decimal("0"))
        for month in months:
            month["income_pct"] = int(month["income"] / maximum * 100) if maximum else 0
            month["expense_pct"] = int(month["expense"] / maximum * 100) if maximum else 0
        summary.update(methods=list(method_buckets[currency].values()), months=months,
            companies=sorted(company_buckets[currency].values(), key=lambda row: (row["name"].casefold(), row["id"])),
            chart_start=chart_start, chart_end=last_month, chart_truncated=first_month < chart_start, chart_max=maximum)
    return summaries
