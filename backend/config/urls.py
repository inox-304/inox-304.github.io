from django.contrib import admin
from django.urls import include, path, re_path
from . import views

urlpatterns = [
    path('admin/auth/', include('security.urls')),
    path('admin/', admin.site.urls),
    path('', include('catalog.urls')),
    path('catalogo/<slug:slug>/', views.product_page, name='product-page'),
    path('sitemap.xml', views.sitemap, name='sitemap'),
    path('robots.txt', views.robots, name='robots'),
    path('health/', views.health, name='health'),
    path('', views.frontend, name='home'),
    path('catalogo/', views.frontend, name='catalog'),
    path('contacto/', views.frontend, name='contact'),
    path('equipo/', views.frontend, name='product-fallback'),
    re_path(r'^(?P<asset>(?:_astro|images|fonts|media|models|vendor)/.+|favicon\.svg)$', views.asset, name='frontend-asset'),
]
