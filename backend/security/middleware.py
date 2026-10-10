import time
from urllib.parse import urlencode

from django.contrib.auth import logout
from django.http import JsonResponse
from django.shortcuts import redirect
from django.urls import reverse
from django.utils.cache import add_never_cache_headers
from django.utils.deprecation import MiddlewareMixin

from .services import LAST_SEEN, audit, is_admin_authenticated


class SecuritySessionMiddleware(MiddlewareMixin):
    public_auth_views = {"login", "otp", "setup", "setup_qr", "logout"}

    def process_view(self, request, view_func, view_args, view_kwargs):
        protected = request.path == "/admin" or request.path.startswith("/admin/")
        request.admin_verified = is_admin_authenticated(request)
        if request.session.get("_auth_user_id") and not request.admin_verified:
            user = request.user if request.user.is_authenticated else None
            logout(request)
            audit("session_rejected", request, user)
        if not protected:
            return None
        match = request.resolver_match
        public = match and match.namespace == "security" and match.url_name in self.public_auth_views
        if public:
            return None
        if not request.admin_verified:
            if "application/json" in request.headers.get("Accept", "") or request.path.startswith("/admin/api/"):
                return JsonResponse({"error": "Se requiere una sesión con verificación en dos pasos."}, status=401)
            return redirect(reverse("security:login") + "?" + urlencode({"next": request.path}))
        request.session[LAST_SEEN] = time.time()
        return None

    def process_response(self, request, response):
        if request.path == "/admin" or request.path.startswith("/admin/"):
            add_never_cache_headers(response)
            response["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
            response["Referrer-Policy"] = "same-origin"
            response["X-Robots-Tag"] = "noindex, nofollow"
        return response
