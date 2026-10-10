from django.urls import path

from . import views

app_name = "security"
urlpatterns = [
    path("login/", views.login_view, name="login"),
    path("otp/", views.otp_view, name="otp"),
    path("setup/", views.setup_view, name="setup"),
    path("setup/qr/", views.setup_qr, name="setup_qr"),
    path("recovery-codes/", views.recovery_codes, name="recovery_codes"),
    path("recovery-codes/regenerate/", views.regenerate_codes, name="regenerate_codes"),
    path("logout/", views.logout_view, name="logout"),
]
