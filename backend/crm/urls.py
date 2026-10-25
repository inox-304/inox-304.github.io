from django.contrib import admin
from django.urls import path
from . import views

app_name = "crm"
urlpatterns = [
    path("", admin.site.admin_view(views.dashboard), name="dashboard"),
    path("nueva/", admin.site.admin_view(views.create), name="create"),
    path("exportar/", admin.site.admin_view(views.export_csv), name="export_csv"),
    path("<int:pk>/", admin.site.admin_view(views.detail), name="detail"),
    path("<int:pk>/guardar/", admin.site.admin_view(views.update), name="update"),
    path("<int:pk>/contacto/", admin.site.admin_view(views.contact), name="contact"),
    path("<int:pk>/nota/", admin.site.admin_view(views.note), name="note"),
]
