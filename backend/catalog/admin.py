from uuid import uuid4
from copy import deepcopy

from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils.html import format_html
from django.views.decorators.http import require_safe
from security.passkeys import is_owner

from .audit import TRACKED_MODELS, audit_context
from .forms import GalleryInlineFormSet, VariantInlineFormSet, ProductAdminForm, ProductAdditionalForm, ProductImageForm, ProductVariantForm, persist_uploads
from .models import AuditLog, BusinessSettings, Contact, MediaAsset, Product, ProductAdditional, ProductImage, ProductVariant
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


class ProductVariantInline(admin.StackedInline):
    model = ProductVariant
    form = ProductVariantForm
    formset = VariantInlineFormSet
    extra = 0
    max_num = 100
    fieldsets = (
        (None, {"fields": ("name", "manufacturing_code")}),
        ("Precio y disponibilidad", {"fields": (("price", "cost"), "availability")}),
        ("Foto, modelo y ficha de esta variación", {"fields": ("image_upload", "image_current", "model_upload", "technical_upload", "current_files")}),
        ("Reutilizar archivos guardados", {"fields": ("image_asset", "model_asset", "technical_asset"), "classes": ("collapse",)}),
        ("Puertas y acabados del 3D", {"fields": ("material_variant", "door_animation"), "classes": ("collapse",)}),
        ("Visibilidad", {"fields": (("is_active", "order"),)}),
    )
    readonly_fields = ("image_current", "current_files")
    autocomplete_fields = ("image_asset", "model_asset", "technical_asset")
    classes = ("inox-step", "inox-step-variants")
    verbose_name = "variación"
    verbose_name_plural = "Variaciones (opcional)"

    def get_max_num(self, request, obj=None, **kwargs):
        return max(self.max_num, obj.variants.count()) if obj and obj.pk else self.max_num

    @admin.display(description="Foto guardada")
    def image_current(self, obj):
        if not obj.image_asset_id:
            return "Sin foto propia: usará la imagen principal del equipo."
        url = reverse("admin:catalog_media_download", args=(obj.image_asset_id,))
        return format_html('<a href="{}" target="_blank" rel="noopener"><img src="{}" alt="Foto guardada de la variación" loading="lazy" style="max-width:160px;max-height:120px;object-fit:contain;display:block">Abrir foto guardada</a>', url, url)

    @admin.display(description="Archivos guardados")
    def current_files(self, obj):
        from django.utils.html import format_html_join
        files = [(reverse("admin:catalog_media_download", args=(asset.pk,)), label)
                 for asset, label in ((obj.model_asset, "Abrir modelo 3D"), (obj.technical_asset, "Abrir ficha PDF")) if asset]
        return format_html_join(" · ", '<a href="{}" target="_blank" rel="noopener">{}</a>', files) if files else "Usará los archivos principales hasta que guardes otros."


class ProductImageInline(admin.StackedInline):
    model = ProductImage
    form = ProductImageForm
    formset = GalleryInlineFormSet
    extra = 0
    max_num = 8
    fields = ("upload", "asset", "url", "caption", "order")
    autocomplete_fields = ("asset",)
    classes = ("inox-step", "inox-step-media")
    verbose_name = "foto adicional"
    verbose_name_plural = "Galería de fotos (opcional)"


class ProductAdditionalInline(admin.StackedInline):
    model = ProductAdditional
    form = ProductAdditionalForm
    extra = 0
    fields = ("name", "description", "manufacturing_code", ("price", "show_price"), ("charge_unit", "custom_unit"), "cost", ("is_active", "order"))
    classes = ("inox-step", "inox-step-additionals")
    verbose_name = "opción"
    verbose_name_plural = "Adicionales del equipo (opcional)"


@admin.register(Product)
class ProductAdmin(AuditedAdmin):
    form = ProductAdminForm
    change_form_template = "admin/catalog/product/change_form.html"
    change_list_template = "admin/catalog/product/change_list.html"
    inlines = (ProductVariantInline, ProductAdditionalInline, ProductImageInline)
    list_display = ("code", "name", "category", "supply_type", "brand", "equipment_family", "is_published", "is_active", "featured", "order", "availability", "public_price", "preview_link")
    list_editable = ("is_published", "is_active", "featured", "order", "availability")
    list_filter = ("supply_type", "brand", "equipment_family", "category", "is_published", "is_active", "featured", "availability", "charge_unit")
    search_fields = ("code", "name", "description", "brand", "supplier_model", "equipment_family", "capacity")
    autocomplete_fields = ("contact", "image_asset", "technical_asset", "model_asset", "poster_asset")
    readonly_fields = ("public_price", "created_at", "updated_at", "preview_link", "image_current", "technical_current", "model_current", "poster_current")
    save_on_top = False
    list_per_page = 40
    actions = ("duplicate_products", "hide_products", "publish_products")
    fieldsets = (
        ("Datos del equipo", {"description": "Empieza por el nombre y la línea. Los archivos y las variaciones pueden completarse después.", "fields": ("name", "category", "description", "characteristics"), "classes": ("inox-step", "inox-step-details")}),
        ("Origen, marca y capacidad", {"description": "En productos distribuidos conserva las capacidades y opciones oficiales del fabricante. Cambiar de modelo no significa fabricar a medida. La foto, el PDF y el 3D pueden añadirse después.", "fields": ("supply_type", "brand", "supplier_model", "equipment_family", "capacity", "source_url"), "classes": ("inox-step", "inox-step-details")}),
        ("Identificadores", {"description": "Se crean automáticamente en un equipo nuevo y se conservan al editarlo.", "fields": ("code", "slug"), "classes": ("collapse", "inox-step", "inox-step-details")}),
        ("Configurador de cocina", {"description": "Define las opciones y posiciones que puedes fabricar. El borrador se prepara solo cuando lo solicitas; habilítalo después de revisarlo.", "fields": ("cooktop_config",), "classes": ("inox-step", "inox-step-configurator")}),
        ("Foto principal", {"fields": ("image_upload", "image_current"), "classes": ("inox-step", "inox-step-media")}),
        ("Ficha técnica", {"fields": ("technical_upload", "technical_current"), "classes": ("inox-step", "inox-step-media")}),
        ("Modelo 3D", {"description": "Sube el modelo principal. Cada variación puede tener otro GLB y otra ficha. Abrir puertas requiere un clip animado dentro del archivo; el botón aparece cuando el visor lo reconoce.", "fields": ("model_upload", "model_current", "poster_upload", "poster_current", "door_animation"), "classes": ("inox-step", "inox-step-media")}),
        ("Reutilizar archivos o enlaces existentes", {"description": "Opcional. Para añadir un archivo nuevo usa los botones de arriba. Un archivo subido tiene prioridad sobre su enlace.", "fields": ("image_asset", "image", "technical_asset", "technical_sheet", "model_asset", "model_3d", "poster_asset", "model_poster"), "classes": ("collapse", "inox-step", "inox-step-media")}),
        ("Precio público", {"description": "Puedes dejar el precio vacío para cotizar por consulta. La tarifa final se calcula en el servidor.", "fields": ("price", "currency", "show_price", "charge_unit", "custom_unit", "discount_percent", "additional_flat", "public_price"), "classes": ("inox-step", "inox-step-pricing")}),
        ("Información privada", {"fields": ("cost", "internal_notes"), "classes": ("collapse", "inox-step", "inox-step-pricing")}),
        ("Revisar y guardar", {"description": "Guardar conserva tus cambios. Solo se muestra en la web del servidor cuando está activo y publicado. Los archivos pendientes no impiden guardar un borrador.", "fields": ("is_published", "is_active", "featured", "order", "availability", "contact", "preview_link"), "classes": ("inox-step", "inox-step-review")}),
        ("Fechas", {"fields": ("created_at", "updated_at"), "classes": ("collapse", "inox-step", "inox-step-review")}),
    )

    def get_readonly_fields(self, request, obj=None):
        return self.readonly_fields + (("code", "slug") if obj else ())

    def get_fieldsets(self, request, obj=None):
        can_edit = is_owner(request.user) and (self.has_change_permission(request, obj) if obj else self.has_add_permission(request))
        return tuple(fieldset for fieldset in super().get_fieldsets(request, obj) if can_edit or "cooktop_config" not in fieldset[1]["fields"])

    def get_form(self, request, obj=None, **kwargs):
        base_form = super().get_form(request, obj, **kwargs)
        can_edit_cooktop = is_owner(request.user)

        class RequestProductForm(base_form):
            def __init__(self, *args, **form_kwargs):
                form_kwargs["can_edit_cooktop"] = can_edit_cooktop
                super().__init__(*args, **form_kwargs)

        return RequestProductForm

    def save_model(self, request, obj, form, change):
        if not is_owner(request.user):
            previous = Product.objects.only("cooktop_config").get(pk=obj.pk).cooktop_config if change else {}
            if obj.cooktop_config != previous:
                raise PermissionDenied("Solo el propietario puede modificar el configurador de cocina.")
        super().save_model(request, obj, form, change)

    def render_change_form(self, request, context, *args, **kwargs):
        context["is_nav_sidebar_enabled"] = False
        return super().render_change_form(request, context, *args, **kwargs)

    def _current_file(self, obj, asset_field, url_field, kind):
        asset = getattr(obj, asset_field, None)
        url = reverse("admin:catalog_media_download", args=(asset.pk,)) if asset else getattr(obj, url_field, "")
        if not url:
            return format_html('<span class="inox-file-current" data-inox-saved="false">{}</span>', "Pendiente · puedes añadirlo después.")
        if kind == "image":
            return format_html('<span class="inox-file-current" data-inox-saved="true"><a href="{}" target="_blank" rel="noopener"><img src="{}" alt="Imagen guardada del equipo" loading="lazy" style="max-width:160px;max-height:120px;object-fit:contain;display:block">Abrir imagen guardada</a></span>', url, url)
        return format_html('<span class="inox-file-current" data-inox-saved="true"><a href="{}" target="_blank" rel="noopener">{}</a></span>', url, "Abrir ficha guardada" if kind == "pdf" else "Abrir archivo 3D guardado")

    @admin.display(description="Foto actual")
    def image_current(self, obj):
        return self._current_file(obj, "image_asset", "image", "image")

    @admin.display(description="Ficha actual")
    def technical_current(self, obj):
        return self._current_file(obj, "technical_asset", "technical_sheet", "pdf")

    @admin.display(description="Modelo actual")
    def model_current(self, obj):
        return self._current_file(obj, "model_asset", "model_3d", "glb")

    @admin.display(description="Portada actual")
    def poster_current(self, obj):
        return self._current_file(obj, "poster_asset", "model_poster", "image")

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
        item = public_product(product, preview=True)
        for field, asset in (("image", product.image_asset), ("technicalSheet", product.technical_asset), ("model3d", product.model_asset), ("modelPoster", product.poster_asset)):
            if asset:
                item[field] = reverse("admin:catalog_media_download", args=(asset.pk,))
        for variant_data, variant in zip(item["variants"], product.variants.all()):
            for field, asset in (("image", variant.image_asset), ("model3d", variant.model_asset), ("technicalSheet", variant.technical_asset)):
                if asset:
                    variant_data[field] = reverse("admin:catalog_media_download", args=(asset.pk,))
        item["gallery"] = [reverse("admin:catalog_media_download", args=(image.asset_id,)) if image.asset_id else image.url for image in product.gallery_images.all()]
        data = public_catalog_data()
        data["products"] = [existing for existing in data["products"] if existing["id"] != product.code] + [item]
        return _render_shell("equipo/index.html", data, title=f"Vista previa · {product.name}", description=product.description, canonical=f"/catalogo/{product.slug}/", preview=True, preview_product_id=product.code)

    def has_duplicate_permission(self, request):
        # A duplicate includes variants, additionals and gallery rows. Granting
        # product access alone must not bypass the permissions of those inlines.
        if not self.has_view_or_change_permission(request) or not self.has_add_permission(request):
            return False
        for model in (ProductVariant, ProductAdditional, ProductImage):
            name = model._meta.model_name
            if not request.user.has_perm(f"catalog.add_{name}") or not (
                request.user.has_perm(f"catalog.view_{name}")
                or request.user.has_perm(f"catalog.change_{name}")
            ):
                return False
        return True

    @admin.action(description="Duplicar seleccionados como borradores", permissions=["duplicate"])
    def duplicate_products(self, request, queryset):
        if not self.has_duplicate_permission(request):
            raise PermissionDenied
        with transaction.atomic(), audit_context(request.user):
            for source in queryset:
                if not self.has_view_or_change_permission(request, source):
                    raise PermissionDenied
                token = uuid4().hex[:8]
                values = {field.attname: getattr(source, field.attname) for field in source._meta.concrete_fields if not field.primary_key and field.name not in ("created_at", "updated_at")}
                values.update(code=f"{source.code[:53]}-C-{token}", slug=f"{source.slug[:134]}-copia-{token}", name=f"{source.name[:242]} (copia)", is_published=False)
                if source.cooktop_config:
                    values["cooktop_config"] = {**deepcopy(source.cooktop_config), "enabled": False}
                copy = Product.objects.create(**values)
                for model, items in ((ProductVariant, source.variants.all()), (ProductAdditional, source.additionals.all()), (ProductImage, source.gallery_images.all())):
                    for item in items:
                        values = {field.attname: getattr(item, field.attname) for field in item._meta.concrete_fields if not field.primary_key and field.name != "product"}
                        model.objects.create(product=copy, **values)
        self.message_user(request, "Copias creadas como borradores. Puede editarlas antes de publicarlas.")

    def _visibility_action(self, request, queryset, published):
        if not self.has_change_permission(request):
            raise PermissionDenied
        if request.POST.get("confirm") == "yes":
            with transaction.atomic(), audit_context(request.user):
                for product in queryset:
                    if not self.has_change_permission(request, product):
                        raise PermissionDenied
                    product.is_published = published
                    if published:
                        product.is_active = True
                    product.save()
            self.message_user(request, "Visibilidad actualizada.")
            return None
        return TemplateResponse(request, "admin/catalog/confirm_action.html", {**self.admin_site.each_context(request), "title": "Confirmar publicación" if published else "Confirmar ocultación", "queryset": queryset, "action": "publish_products" if published else "hide_products", "opts": self.model._meta, "action_checkbox_name": admin.helpers.ACTION_CHECKBOX_NAME})

    @admin.action(description="Ocultar seleccionados (conservar datos)", permissions=["change"])
    def hide_products(self, request, queryset):
        return self._visibility_action(request, queryset, False)

    @admin.action(description="Publicar seleccionados", permissions=["change"])
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
                if model in (ProductVariant, ProductAdditional, ProductImage):
                    return HttpResponseRedirect(reverse("admin:catalog_product_change", args=(obj.product_id,)))
                return HttpResponseRedirect(reverse(f"admin:catalog_{model._meta.model_name}_change", args=(obj.pk,)))
        return TemplateResponse(request, "admin/catalog/restore.html", {**self.admin_site.each_context(request), "title": "Restaurar versión anterior", "log": log, "opts": self.model._meta})
