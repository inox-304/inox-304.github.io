from django.urls import path
from . import views

urlpatterns = [
    path("api/catalog/", views.catalog_api, name="catalog-api"),
    path("api/catalog/<str:code>/quote/", views.public_quote, name="catalog-quote"),
    path("media/<uuid:asset_id>/", views.public_media, name="catalog-media"),
]
