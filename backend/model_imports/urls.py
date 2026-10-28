from django.contrib import admin
from django.urls import path

from . import views


app_name = "model_imports"
urlpatterns = [
    path("", admin.site.admin_view(views.index), name="index"),
    path("nuevo/", admin.site.admin_view(views.upload), name="upload"),
    path("<uuid:job_id>/", admin.site.admin_view(views.detail), name="detail"),
    path("<uuid:job_id>/estado/", admin.site.admin_view(views.status), name="status"),
    path("<uuid:job_id>/revisar/", admin.site.admin_view(views.preview), name="preview"),
    path("<uuid:job_id>/original/", admin.site.admin_view(views.source), name="source"),
    path("<uuid:job_id>/resultado/", admin.site.admin_view(views.result), name="result"),
    path("<uuid:job_id>/aplicar/", admin.site.admin_view(views.apply), name="apply"),
    path("<uuid:job_id>/cancelar/", admin.site.admin_view(views.cancel), name="cancel"),
    path("<uuid:job_id>/reintentar/", admin.site.admin_view(views.retry), name="retry"),
]
