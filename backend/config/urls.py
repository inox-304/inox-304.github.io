from django.contrib import admin
from django.urls import include, path, re_path
from . import views
from catalog import inventory_views
from crm import public_views as crm_public

urlpatterns = [
    path('admin/modelos/', include('model_imports.urls')),
    path('admin/auth/', include('security.urls')),
    path('admin/crm/', include('crm.urls')),
    path('admin/inventario/', admin.site.admin_view(inventory_views.inventory_dashboard), name='inventory-dashboard'),
    path('admin/inventario/actualizar/', admin.site.admin_view(inventory_views.inventory_refresh), name='inventory-refresh'),
    path('admin/inventario/estado/', admin.site.admin_view(inventory_views.inventory_status), name='inventory-status'),
    path('admin/', admin.site.urls),
    path('api/crm/inquiries/', crm_public.inquiries, name='crm-inquiries'),
    path('api/crm/events/', crm_public.events, name='crm-events'),
    path('', include('catalog.urls')),
    path('catalogo/<slug:slug>/', views.product_page, name='product-page'),
    path('sitemap.xml', views.sitemap, name='sitemap'),
    path('robots.txt', views.robots, name='robots'),
    path('health/', views.health, name='health'),
    path('', views.frontend, name='home'),
    path('catalogo/', views.frontend, name='catalog'),
    path('contacto/', views.frontend, name='contact'),
    path('equipo/', views.frontend, name='product-fallback'),
    path('privacidad-acceso/', views.frontend, name='access-privacy'),
    re_path(r'^(?P<asset>(?:_astro|images|fonts|media|models|vendor)/.+|favicon\.svg)$', views.asset, name='frontend-asset'),
]
