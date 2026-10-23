from django.urls import path
from . import views

urlpatterns = [
    path("api/catalog/", views.catalog_api, name="catalog-api"),
    path("api/catalog/<str:code>/quote/", views.public_quote, name="catalog-quote"),
    path("api/catalog/<str:code>/cooktop/", views.public_cooktop, name="catalog-cooktop"),
    path("api/catalog/<str:code>/cooktop/check/", views.check_cooktop_selection, name="catalog-cooktop-check"),
    path("media/<uuid:asset_id>/", views.public_media, name="catalog-media"),
]
