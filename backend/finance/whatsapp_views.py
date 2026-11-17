"""Owner-only review of unclassified financial WhatsApp messages."""
from django.contrib import messages
from django.core.exceptions import ValidationError
from django.http import FileResponse, Http404, HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_GET, require_http_methods

from catalog.storage import open_private_file
from finance_intake.models import IntakeMessage
from finance_intake.processing import create_reviewed_draft
from .forms import WhatsAppReviewForm
from .models import Company
from .views import base_context, require_owner


@require_GET
def original(request, pk):
    require_owner(request)
    receipt = get_object_or_404(IntakeMessage, pk=pk)
    if not receipt.original_file:
        raise Http404
    try:
        handle = open_private_file(receipt.original_file.storage, receipt.original_file.name)
    except (OSError, ValueError):
        return HttpResponse("El original no está disponible; el mensaje se conserva.", status=503)
    response = FileResponse(handle, as_attachment=request.GET.get("download") == "1",
                            filename=f"{receipt.code}." + ("png" if receipt.original_content_type == "image/png" else "jpg"),
                            content_type=receipt.original_content_type)
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = "private, no-store"
    response["Content-Security-Policy"] = "default-src 'none'; sandbox"
    return response


@require_http_methods(["GET", "POST"])
def review(request, pk):
    require_owner(request)
    receipt = get_object_or_404(IntakeMessage.objects.select_related("proposed_company", "movement"), pk=pk)
    if receipt.movement_id:
        return redirect("finance:detail", pk=receipt.movement_id)
    if receipt.status == IntakeMessage.Status.IGNORED:
        messages.info(request, "El mensaje se conserva como descartado.")
        return redirect("finance:connections")
    source = request.POST if request.method == "POST" else request.GET
    company_id = source.get("company", "")
    company = None
    if company_id:
        if not company_id.isascii() or not company_id.isdecimal() or len(company_id) > 12:
            raise Http404
        company = get_object_or_404(Company, pk=int(company_id), active=True)
    elif request.method == "GET" and receipt.proposed_company_id and receipt.proposed_company.active:
        company = receipt.proposed_company
    fields = receipt.ocr_fields or {}
    initial = {key: fields.get(key, "") for key in ("amount", "kind", "currency", "description", "reference")}
    initial.update(occurred_on=fields.get("date", ""), expected_version=receipt.processing_version)
    form = WhatsAppReviewForm(request.POST if request.method == "POST" else None,
                              company=company, method=receipt.method, initial=initial)
    # MovementForm's normal manual defaults must never fill OCR unknowns.
    if request.method == "GET":
        form.initial["currency"] = fields.get("currency", "")
    if request.method == "POST" and form.is_valid():
        try:
            data = dict(form.cleaned_data)
            version = data.pop("expected_version")
            data.pop("reviewed")
            movement = create_reviewed_draft(receipt.pk, data, actor=request.user, expected_version=version)
        except ValidationError as error:
            form.add_error(None, error)
        except OSError:
            form.add_error(None, "No se pudo conservar el comprobante. Reintenta; no se confirmó ningún movimiento.")
        else:
            messages.success(request, "Borrador preparado. Revisa sus detalles antes de confirmar el movimiento.")
            return redirect("finance:detail", pk=movement.pk)
    return render(request, "admin/finance/whatsapp_review.html", base_context(request,
        title="Revisar foto de WhatsApp", section="connections", receipt=receipt, form=form,
        selected_company=company, review_companies=Company.objects.filter(active=True)))
