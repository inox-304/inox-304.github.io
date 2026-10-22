"""Permission-scoped, read-only summary for the administration home."""

from django import template
from django.db.models import Count, Q

from catalog.models import Product

register = template.Library()


@register.simple_tag(takes_context=True)
def catalog_overview(context):
    request = context.get("request")
    if request is None or not (
        request.user.has_perm("catalog.view_product")
        or request.user.has_perm("catalog.change_product")
    ):
        return None
    return Product.objects.aggregate(
        total=Count("pk"),
        published=Count("pk", filter=Q(is_active=True, is_published=True)),
        drafts=Count("pk", filter=Q(is_published=False)),
    )
