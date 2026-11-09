"""Cash totals are exact Decimal sums; no currency conversion or inferred profit."""
from decimal import Decimal

from django.db.models import Count, Sum

from .models import Movement


def movement_metrics(query):
    posted = query.filter(status=Movement.Status.POSTED)
    by_currency = {}
    for row in posted.values("currency", "kind").annotate(total=Sum("amount"), count=Count("pk")):
        summary = by_currency.setdefault(row["currency"], {"currency": row["currency"], "income": Decimal("0"), "expense": Decimal("0"), "transfer": Decimal("0"), "count": 0})
        summary[row["kind"]] = row["total"]
        summary["count"] += row["count"]
    for summary in by_currency.values():
        summary["net"] = summary["income"] - summary["expense"]
    return list(sorted(by_currency.values(), key=lambda row: row["currency"]))
