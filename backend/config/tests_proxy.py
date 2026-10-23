import importlib.util
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase, override_settings

from security.services import client_ip


class PlatformProxyTests(SimpleTestCase):
    def load_configuration(self, environment):
        source = Path(__file__).with_name("settings.py")
        original_is_file = Path.is_file
        # Configuration regression checks use synthetic values and never read
        # the operator's local .env or the real installation directory.
        def is_file(path):
            if path == source.parent.parent / ".env":
                return False
            return original_is_file(path)

        with TemporaryDirectory() as directory, \
             patch.dict(os.environ, {
                 "DJANGO_ENV": "test", "INOX_DATA_DIR": directory,
                 "DJANGO_SECRET_KEY": "proxy-test-only-not-a-deployment-key",
                 **environment,
             }, clear=True), patch.object(Path, "is_file", is_file):
            spec = importlib.util.spec_from_file_location("proxy_test_settings", source)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module

    def test_platform_https_trust_does_not_enable_private_ip_header(self):
        configuration = self.load_configuration({"TRUST_HTTPS_PROXY": "1", "TRUST_REVERSE_PROXY": "0"})
        self.assertFalse(configuration.TRUSTED_INOX_PROXY)
        self.assertEqual(configuration.SECURE_PROXY_SSL_HEADER, ("HTTP_X_FORWARDED_PROTO", "https"))
        request = RequestFactory().get(
            "/admin/", REMOTE_ADDR="192.0.2.10",
            HTTP_X_FORWARDED_PROTO="https", HTTP_X_INOX_CLIENT_IP="203.0.113.99",
            HTTP_X_FORWARDED_FOR="203.0.113.98", HTTP_CF_CONNECTING_IP="203.0.113.97",
        )
        with override_settings(TRUSTED_INOX_PROXY=configuration.TRUSTED_INOX_PROXY,
                               SECURE_PROXY_SSL_HEADER=configuration.SECURE_PROXY_SSL_HEADER):
            self.assertTrue(request.is_secure())
            self.assertEqual(client_ip(request), "192.0.2.10")

    def test_forwarded_proto_is_untrusted_without_either_proxy_configuration(self):
        configuration = self.load_configuration({})
        self.assertFalse(configuration.TRUSTED_INOX_PROXY)
        header = getattr(configuration, "SECURE_PROXY_SSL_HEADER", None)
        self.assertIsNone(header)
        request = RequestFactory().get("/admin/", HTTP_X_FORWARDED_PROTO="https")
        with override_settings(SECURE_PROXY_SSL_HEADER=header):
            self.assertFalse(request.is_secure())

    def test_existing_private_caddy_proxy_keeps_https_and_ip_support(self):
        configuration = self.load_configuration({"TRUST_REVERSE_PROXY": "1"})
        self.assertTrue(configuration.TRUSTED_INOX_PROXY)
        self.assertEqual(configuration.SECURE_PROXY_SSL_HEADER, ("HTTP_X_FORWARDED_PROTO", "https"))
        request = RequestFactory().get("/admin/", REMOTE_ADDR="192.0.2.10",
                                       HTTP_X_INOX_CLIENT_IP="203.0.113.99")
        with override_settings(TRUSTED_INOX_PROXY=configuration.TRUSTED_INOX_PROXY):
            self.assertEqual(client_ip(request), "203.0.113.99")
