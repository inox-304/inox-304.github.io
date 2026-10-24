from django.urls import path
from . import views

urlpatterns = [
    path("api/catalog/", views.catalog_api, name="catalog-api"),
    path("api/catalog/<str:code>/quote/", views.public_quote, name="catalog-quote"),
    path("api/catalog/<str:code>/cooktop/", views.public_cooktop, name="catalog-cooktop"),
    path("api/catalog/<str:code>/cooktop/check/", views.check_cooktop_selection, name="catalog-cooktop-check"),
    path("api/catalog/<str:code>/cart/", views.public_cart, name="catalog-cart"),
    path("api/catalog/<str:code>/cart/check/", views.check_cart_selection, name="catalog-cart-check"),
    path("media/<uuid:asset_id>/", views.public_media, name="catalog-media"),
]
