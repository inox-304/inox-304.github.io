from django.urls import path

from . import views
from . import email_views

app_name = "security"
urlpatterns = [
    path("login/", views.login_view, name="login"),
    path("otp/", views.otp_view, name="otp"),
    path("email/", email_views.email_verify, name="email_verify"),
    path("email/resend/", email_views.email_resend, name="email_resend"),
    path("email/recovery-codes/send/", email_views.email_regenerate_send, name="email_regenerate_send"),
    path("email/recovery-codes/verify/", email_views.email_regenerate_verify, name="email_regenerate_verify"),
    path("setup/", views.setup_view, name="setup"),
    path("setup/qr/", views.setup_qr, name="setup_qr"),
    path("recovery-codes/", views.recovery_codes, name="recovery_codes"),
    path("recovery-codes/regenerate/", views.regenerate_codes, name="regenerate_codes"),
    path("logout/", views.logout_view, name="logout"),
]
