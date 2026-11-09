from django.contrib import messages
from django.core.exceptions import PermissionDenied, ValidationError
from django.http import FileResponse
from django.shortcuts import redirect
from django.utils import timezone
from django.views.decorators.http import require_POST
from botocore.exceptions import BotoCoreError, ClientError

from .backups import build_backup
from .permissions import is_owner


@require_POST
def download_backup(request):
    if not is_owner(request.user):
        raise PermissionDenied
    try:
        output = build_backup(request.user)
    except (ValidationError, OSError, BotoCoreError, ClientError):
        messages.error(request, "No se pudo completar el respaldo. Revisa que todos los comprobantes estén disponibles y que el total no supere 256 MB.")
        return redirect("finance:dashboard")
    response = FileResponse(output, as_attachment=True,
                            filename=f"INOX-finanzas-{timezone.localdate().isoformat()}.zip",
                            content_type="application/zip")
    response["Cache-Control"] = "no-store, private"
    return response
