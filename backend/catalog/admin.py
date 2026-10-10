from uuid import uuid4

from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils.html import format_html
from django.views.decorators.http import require_safe

from .audit import TRACKED_MODELS, audit_context
from .forms import GalleryInlineFormSet, ProductAdminForm, ProductImageForm, persist_uploads
from .models import AuditLog, BusinessSettings, Contact, MediaAsset, Product, ProductImage, ProductVariant
from .serializers import catalog_product_queryset, public_catalog_data, public_product


class AuditedAdmin(admin.ModelAdmin):
    def save_model(self, request, obj, form, change):
        with audit_context(request.user):
            persist_uploads(obj)
            super().save_model(request, obj, form, change)

    def save_formset(self, request, form, formset, change):
        with audit_context(request.user):
            instances = formset.save(commit=False)
            for instance in formset.deleted_objects:
                instance.delete()
            for instance in instances:
                persist_uploads(instance)
                instance.save()
            formset.save_m2m()

    def delete_model(self, request, obj):
        with audit_context(request.user):
            super().delete_model(request, obj)

    def delete_queryset(self, request, queryset):
        with audit_context(request.user):
            super().delete_queryset(request, queryset)


class ProductVariantInline(admin.TabularInline):
    model = ProductVariant
    extra = 0
    fields = ("name", "price", "cost", "availability", "is_active", "order")


class ProductImageInline(admin.StackedInline):
    model = ProductImage
    form = ProductImageForm
    formset = GalleryInlineFormSet
    extra = 0
    max_num = 8
    fields = ("upload", "asset", "url", "caption", "order")
    autocomplete_fields = ("asset",)


@admin.register(Product)
class ProductAdmin(AuditedAdmin):
    form = ProductAdminForm
    inlines = (ProductVariantInline, ProductImageInline)
    list_display = ("code", "name", "category", "is_published", "is_active", "featured", "order", "availability", "public_price", "preview_link")
    list_editable = ("is_published", "is_active", "featured", "order", "availability")
    list_filter = ("category", "is_published", "is_active", "featured", "availability", "charge_unit")
    search_fields = ("code", "name", "description")
    prepopulated_fields = {"slug": ("name",)}
    autocomplete_fields = ("contact", "image_asset", "technical_asset", "model_asset", "poster_asset")
    readonly_fields = ("public_price", "created_at", "updated_at", "preview_link")
    save_on_top = True
    list_per_page = 40
    actions = ("duplicate_products", "hide_products", "publish_products")
    fieldsets = (
        ("Producto", {"fields": ("code", "name", "slug", "category", "description", "characteristics")}),
        ("Visibilidad y orden", {"fields": ("is_active", "is_published", "featured", "order", "availability", "contact", "preview_link")}),
        ("Precio público", {"description": "Precio final = precio base × (1 − descuento / 100) + adicional fijo. Los cálculos se realizan en el servidor y se redondean a dos decimales.", "fields": ("price", "currency", "show_price", "charge_unit", "custom_unit", "discount_percent", "additional_flat", "public_price")}),
        ("Información privada", {"fields": ("cost", "internal_notes"), "classes": ("collapse",)}),
        ("Imagen principal", {"fields": ("image_upload", "image_asset", "image")}),
        ("Ficha y modelo 3D", {"fields": ("technical_upload", "technical_asset", "technical_sheet", "model_upload", "model_asset", "model_3d", "poster_upload", "poster_asset", "model_poster"), "classes": ("collapse",)}),
        ("Fechas", {"fields": ("created_at", "updated_at"), "classes": ("collapse",)}),
    )

    @admin.display(description="Precio final")
    def public_price(self, obj):
        value = obj.computed_price
        return f"{obj.currency} {value:.2f} / {obj.unit_label}" if value is not None else "Consultar"

    def has_delete_permission(self, request, obj=None):
        return False

    @admin.display(description="Vista previa")
    def preview_link(self, obj):
        if not obj.pk:
            return "Guarde el producto para ver la vista previa."
        return format_html('<a href="{}" target="_blank" rel="noopener">Abrir vista previa privada</a>', reverse("admin:catalog_product_preview", args=(obj.pk,)))

    def get_urls(self):
        return [path("<int:product_id>/preview/", self.admin_site.admin_view(require_safe(self.preview_view)), name="catalog_product_preview")] + super().get_urls()

    def preview_view(self, request, product_id):
        from config.views import _render_shell
        product = get_object_or_404(catalog_product_queryset(), pk=product_id)
        if not self.has_view_or_change_permission(request, product):
            raise PermissionDenied
        item = public_product(product)
        for field, asset in (("image", product.image_asset), ("technicalSheet", product.technical_asset), ("model3d", product.model_asset), ("modelPoster", product.poster_asset)):
            if asset:
                item[field] = reverse("admin:catalog_media_download", args=(asset.pk,))
        item["gallery"] = [reverse("admin:catalog_media_download", args=(image.asset_id,)) if image.asset_id else image.url for image in product.gallery_images.all()]
        data = public_catalog_data()
        data["products"] = [existing for existing in data["products"] if existing["id"] != product.code] + [item]
        return _render_shell("equipo/index.html", data, title=f"Vista previa · {product.name}", description=product.description, canonical=f"/catalogo/{product.slug}/", preview=True, preview_product_id=product.code)

    @admin.action(description="Duplicar seleccionados como borradores")
    def duplicate_products(self, request, queryset):
        with transaction.atomic(), audit_context(request.user):
            for source in queryset:
                token = uuid4().hex[:8]
                values = {field.attname: getattr(source, field.attname) for field in source._meta.concrete_fields if not field.primary_key and field.name not in ("created_at", "updated_at")}
                values.update(code=f"{source.code[:53]}-C-{token}", slug=f"{source.slug[:134]}-copia-{token}", name=f"{source.name[:242]} (copia)", is_published=False)
                copy = Product.objects.create(**values)
                for model, items in ((ProductVariant, source.variants.all()), (ProductImage, source.gallery_images.all())):
                    for item in items:
                        values = {field.attname: getattr(item, field.attname) for field in item._meta.concrete_fields if not field.primary_key and field.name != "product"}
                        model.objects.create(product=copy, **values)
        self.message_user(request, "Copias creadas como borradores. Puede editarlas antes de publicarlas.")

    def _visibility_action(self, request, queryset, published):
        if request.POST.get("confirm") == "yes":
            with transaction.atomic(), audit_context(request.user):
                for product in queryset:
                    product.is_published = published
                    if published:
                        product.is_active = True
                    product.save()
            self.message_user(request, "Visibilidad actualizada.")
            return None
        return TemplateResponse(request, "admin/catalog/confirm_action.html", {**self.admin_site.each_context(request), "title": "Confirmar publicación" if published else "Confirmar ocultación", "queryset": queryset, "action": "publish_products" if published else "hide_products", "opts": self.model._meta, "action_checkbox_name": admin.helpers.ACTION_CHECKBOX_NAME})

    @admin.action(description="Ocultar seleccionados (conservar datos)")
    def hide_products(self, request, queryset):
        return self._visibility_action(request, queryset, False)

    @admin.action(description="Publicar seleccionados")
    def publish_products(self, request, queryset):
        return self._visibility_action(request, queryset, True)


@admin.register(Contact)
class ContactAdmin(AuditedAdmin):
    list_display = ("name", "code", "whatsapp", "email", "is_active")
    list_editable = ("is_active",)
    search_fields = ("name", "code", "whatsapp", "email")

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(MediaAsset)
class MediaAssetAdmin(AuditedAdmin):
    list_display = ("name", "kind", "created_at")
    list_filter = ("kind",)
    search_fields = ("name",)
    readonly_fields = ("created_at", "content_type", "download_link")

    def get_readonly_fields(self, request, obj=None):
        return self.readonly_fields + (("kind",) if obj else ())

    def get_fields(self, request, obj=None):
        return ("name", "kind", "download_link", "content_type", "created_at") if obj else ("name", "kind", "file")

    @admin.display(description="Archivo privado")
    def download_link(self, obj):
        return format_html('<a href="{}">Abrir archivo con acceso privado</a>', reverse("admin:catalog_media_download", args=(obj.pk,))) if obj else ""

    def get_urls(self):
        return [path("<uuid:asset_id>/file/", self.admin_site.admin_view(require_safe(self.download_view)), name="catalog_media_download")] + super().get_urls()

    def download_view(self, request, asset_id):
        from .views import media_response
        asset = get_object_or_404(MediaAsset, pk=asset_id)
        if not self.has_view_or_change_permission(request, asset):
            raise PermissionDenied
        response = media_response(asset)
        response["Cache-Control"] = "no-store"
        response["X-Robots-Tag"] = "noindex, nofollow"
        return response

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(BusinessSettings)
class BusinessSettingsAdmin(AuditedAdmin):
    autocomplete_fields = ("contact_main", "contact_installation", "contact_custom", "contact_form")
    fieldsets = (
        ("Negocio", {"fields": ("company", "address", "address_reference", "hours")}),
        ("Redes sociales", {"fields": ("facebook", "instagram", "tiktok")}),
        ("Textos de inicio", {"fields": ("hero_title", "hero_description", "home_text")}),
        ("Contactos predeterminados", {"fields": ("contact_main", "contact_installation", "contact_custom", "contact_form")}),
    )

    def has_add_permission(self, request):
        return not BusinessSettings.objects.exists() and super().has_add_permission(request)

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("created_at", "actor", "operation", "label", "entity")
    list_filter = ("entity", "operation", "actor")
    search_fields = ("label", "object_id")
    readonly_fields = ("created_at", "actor", "entity", "object_id", "label", "operation", "before", "after", "restore_link")
    fields = readonly_fields

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    @admin.display(description="Recuperar versión")
    def restore_link(self, obj):
        if not obj.before or obj.entity == "catalog.mediaasset":
            return "No hay una versión anterior restaurable."
        return format_html('<a href="{}">Revisar y restaurar el estado anterior</a>', reverse("admin:catalog_audit_restore", args=(obj.pk,)))

    def get_urls(self):
        return [path("<int:log_id>/restore/", self.admin_site.admin_view(self.restore_view), name="catalog_audit_restore")] + super().get_urls()

    def restore_view(self, request, log_id):
        log = get_object_or_404(AuditLog, pk=log_id)
        model = next((model for model in TRACKED_MODELS if model._meta.label_lower == log.entity), None)
        if not model or model is MediaAsset or not request.user.has_perm(f"catalog.change_{model._meta.model_name}") or not log.before:
            raise PermissionDenied
        obj = get_object_or_404(model, pk=log.object_id)
        if request.method == "POST":
            try:
                with transaction.atomic(), audit_context(request.user, "restore"):
                    obj = model.objects.select_for_update().get(pk=obj.pk)
                    for field in model._meta.concrete_fields:
                        if not field.primary_key and field.editable and field.name in log.before:
                            value = log.before[field.name]
                            setattr(obj, field.attname, field.target_field.to_python(value) if field.is_relation else field.to_python(value))
                    obj.save()
            except ValidationError as exc:
                self.message_user(request, "No se pudo restaurar: " + "; ".join(exc.messages), messages.ERROR)
            else:
                self.message_user(request, "Versión anterior restaurada; la operación quedó registrada en el historial.")
                return HttpResponseRedirect(reverse(f"admin:catalog_{model._meta.model_name}_change", args=(obj.pk,)))
        return TemplateResponse(request, "admin/catalog/restore.html", {**self.admin_site.each_context(request), "title": "Restaurar versión anterior", "log": log, "opts": self.model._meta})
