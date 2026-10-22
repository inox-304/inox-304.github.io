from django.urls import path

from . import views
from . import email_views
from . import passkey_views

app_name = "security"
urlpatterns = [
    path("keys/", passkey_views.manage, name="passkeys"),
    path("keys/grants/", passkey_views.grant, name="passkey_grant"),
    path("keys/grants/<uuid:grant_id>/revoke/", passkey_views.revoke_grant, name="passkey_grant_revoke"),
    path("keys/register/options/", passkey_views.register_options, name="passkey_register_options"),
    path("keys/register/verify/", passkey_views.register_verify, name="passkey_register_verify"),
    path("keys/<int:device_id>/revoke/", passkey_views.revoke, name="passkey_revoke"),
    path("passkey/", passkey_views.login_page, name="passkey_login"),
    path("passkey/options/", passkey_views.login_options, name="passkey_login_options"),
    path("passkey/verify/", passkey_views.login_verify, name="passkey_login_verify"),
    path("passkey/email/", passkey_views.email_fallback, name="passkey_email_fallback"),
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
