from django.contrib import admin
from django.urls import path
from . import views, backup_views

app_name = "finance"
urlpatterns = [
    path("", admin.site.admin_view(views.dashboard), name="dashboard"),
    path("nuevo/", admin.site.admin_view(views.create), name="create"),
    path("exportar/", admin.site.admin_view(views.export_csv), name="export_csv"),
    path("respaldo/", admin.site.admin_view(backup_views.download_backup), name="backup"),
    path("configuracion/", admin.site.admin_view(views.settings_view), name="settings"),
    path("configuracion/preparar/", admin.site.admin_view(views.prepare_companies), name="prepare_companies"),
    path("configuracion/accesos/guardar/", admin.site.admin_view(views.member_save), name="member_save"),
    path("configuracion/accesos/<int:pk>/retirar/", admin.site.admin_view(views.member_remove), name="member_remove"),
    path("configuracion/periodo/", admin.site.admin_view(views.period_action), name="period_action"),
    path("configuracion/<slug:kind>/nuevo/", admin.site.admin_view(views.setup_edit), name="setup_create"),
    path("configuracion/<slug:kind>/<int:pk>/", admin.site.admin_view(views.setup_edit), name="setup_edit"),
    path("recepcion/", admin.site.admin_view(views.connections), name="connections"),
    path("recepcion/<int:pk>/revisar/", admin.site.admin_view(views.receipt_action), name="receipt_action"),
    path("documento/<int:pk>/", admin.site.admin_view(views.download), name="download"),
    path("<int:pk>/", admin.site.admin_view(views.detail), name="detail"),
    path("<int:pk>/editar/", admin.site.admin_view(views.edit), name="edit"),
    path("<int:pk>/confirmar/", admin.site.admin_view(views.post), name="post"),
    path("<int:pk>/anular/", admin.site.admin_view(views.void), name="void"),
    path("<int:pk>/comprobante/", admin.site.admin_view(views.upload), name="upload"),
]
