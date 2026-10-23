from contextlib import redirect_stderr, redirect_stdout
import hashlib
import base64
import importlib.util
from io import StringIO
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlencode, urlsplit

from django.test import SimpleTestCase


class GmailAuthorizationTests(SimpleTestCase):
    def setUp(self):
        source = Path(__file__).resolve().parents[2] / "scripts" / "authorize-gmail.py"
        spec = importlib.util.spec_from_file_location("inox_gmail_authorization", source)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.client = {"client_id": "test.apps.googleusercontent.com", "client_secret": "SYNTHETIC_SECRET"}
        self.state = "EXPECTED_STATE"

    def callback(self, **query):
        return self.module.CALLBACK_PATH + "?" + urlencode(query)

    def test_authorization_url_has_only_send_scope_state_and_pkce_s256(self):
        verifier = "v" * 64
        url = self.module.authorization_url(self.client["client_id"], "http://127.0.0.1:1234/oauth/callback", self.state, verifier, "owner@example.com")
        parsed = urlsplit(url)
        self.assertEqual(parsed.scheme + "://" + parsed.netloc + parsed.path, self.module.AUTH_ENDPOINT)
        query = parse_qs(parsed.query)
        self.assertEqual(query["scope"], [self.module.SEND_SCOPE])
        self.assertEqual(query["state"], [self.state])
        self.assertEqual(query["code_challenge_method"], ["S256"])
        expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        self.assertEqual(query["code_challenge"], [expected])
        self.assertNotIn(verifier, url)
        self.assertEqual(query["access_type"], ["offline"])

    def test_callback_rejects_csrf_path_duplicates_and_broader_scope(self):
        cases = [
            (self.callback(state="other", code="PRIVATE_CODE"), "wrong_state"),
            ("/wrong?" + urlencode({"state": self.state, "code": "PRIVATE_CODE"}), "wrong_path"),
            (self.callback(state=self.state, code="PRIVATE_CODE") + "&state=other", "invalid"),
            (self.callback(state=self.state, code="PRIVATE_CODE", scope=self.module.SEND_SCOPE + " openid"), "wrong_scope"),
            (self.callback(state=self.state, error="access_denied"), "denied"),
        ]
        for target, expected in cases:
            with self.subTest(expected=expected):
                self.assertEqual(self.module.inspect_callback(target, self.state), (expected, None))
        with patch.object(self.module.secrets, "compare_digest", wraps=self.module.secrets.compare_digest) as comparison:
            self.assertEqual(self.module.inspect_callback(self.callback(state=self.state, code="PRIVATE_CODE"), self.state), ("accepted", "PRIVATE_CODE"))
            comparison.assert_called_once()

    def test_token_exchange_is_fixed_https_no_redirect_and_does_not_keep_access_token(self):
        session = MagicMock()
        response = session.post.return_value
        response.status_code = 200
        response.json.return_value = {"scope": self.module.SEND_SCOPE, "token_type": "Bearer", "access_token": "TRANSIENT_ACCESS", "refresh_token": "PRIVATE_REFRESH"}
        with patch.object(self.module.requests, "Session") as constructor:
            constructor.return_value.__enter__.return_value = session
            saved = self.module.exchange_code(self.client, "PRIVATE_CODE", "http://127.0.0.1:1234/oauth/callback", "PRIVATE_VERIFIER", "owner@example.com")
        self.assertEqual(session.post.call_args.args, (self.module.TOKEN_ENDPOINT,))
        self.assertFalse(session.post.call_args.kwargs["allow_redirects"])
        self.assertEqual(session.post.call_args.kwargs["data"]["code_verifier"], "PRIVATE_VERIFIER")
        self.assertEqual(saved["refresh_token"], "PRIVATE_REFRESH")
        self.assertNotIn("TRANSIENT_ACCESS", json.dumps(saved))
        self.assertFalse(saved["sender_identity_verified"])
        response.close.assert_called_once()

    def test_callback_host_and_replay_are_rejected_without_exposing_code(self):
        handler = object.__new__(self.module.CallbackHandler)
        handler.server = SimpleNamespace(expected_host="127.0.0.1:1234", expected_state=self.state, result=None, code=None)
        handler.path = self.callback(state=self.state, code="PRIVATE_CODE")
        handler.reply = MagicMock()
        handler.headers = {"Host": "untrusted.invalid"}
        handler.do_GET()
        self.assertEqual(handler.reply.call_args.args[0], 403)
        self.assertIsNone(handler.server.code)
        handler.headers = {"Host": "127.0.0.1:1234"}
        handler.do_GET()
        self.assertEqual(handler.reply.call_args.args[0], 200)
        self.assertEqual(handler.server.code, "PRIVATE_CODE")
        handler.do_GET()
        self.assertEqual(handler.reply.call_args.args[0], 403)
        self.assertNotIn("PRIVATE_CODE", str(handler.reply.call_args_list))

    def test_missing_refresh_or_wrong_scope_aborts_without_retaining_tokens(self):
        base = {"scope": self.module.SEND_SCOPE, "token_type": "Bearer", "access_token": "PRIVATE_ACCESS"}
        for payload in (base, {**base, "scope": "https://mail.google.com/", "refresh_token": "PRIVATE_REFRESH"}):
            session = MagicMock()
            session.post.return_value.status_code = 200
            session.post.return_value.json.return_value = payload
            with patch.object(self.module.requests, "Session") as constructor:
                constructor.return_value.__enter__.return_value = session
                with self.assertRaises(self.module.AuthorizationError) as caught:
                    self.module.exchange_code(self.client, "PRIVATE_CODE", "http://127.0.0.1:1234/oauth/callback", "PRIVATE_VERIFIER", "owner@example.com")
            self.assertNotIn("PRIVATE", str(caught.exception))

    def test_api_errors_do_not_leak_tokens_or_server_response_to_console(self):
        with patch.object(self.module, "run", side_effect=RuntimeError("PRIVATE_REFRESH PRIVATE_SECRET PRIVATE_CODE")), redirect_stdout(StringIO()) as stdout, redirect_stderr(StringIO()) as stderr:
            result = self.module.main(["--client-file", "ignored", "--sender", "owner@example.com", "--output", "ignored"])
        self.assertEqual(result, 1)
        self.assertNotIn("PRIVATE", stdout.getvalue() + stderr.getvalue())

    def test_desktop_client_requires_fixed_google_endpoints(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "desktop.json"
            rejected = (
                {"installed": {**self.client, "token_uri": "https://untrusted.invalid/token"}},
                {"installed": {**self.client, "auth_uri": "https://untrusted.invalid/auth"}},
                {"web": self.client},
                {"installed": self.client, "web": self.client},
            )
            for payload in rejected:
                with self.subTest(payload_keys=tuple(payload)):
                    path.write_text(json.dumps(payload))
                    with self.assertRaises(self.module.AuthorizationError):
                        self.module.read_client(path)
            path.write_text(json.dumps({"installed": self.client}))
            self.assertEqual(self.module.read_client(path), self.client)

    def test_desktop_client_encrypted_roundtrip_preserves_validation_and_hides_secret(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "desktop-protected.json"
            self.module.save_credentials(path, {"installed": {
                **self.client, "auth_uri": self.module.AUTH_ENDPOINT,
                "token_uri": self.module.TOKEN_ENDPOINT,
            }})
            contents = path.read_text()
            if os.name == "nt":
                self.assertEqual(json.loads(contents)["type"], "inox_gmail_oauth_dpapi_v1")
                self.assertNotIn("SYNTHETIC_SECRET", contents)
                self.assertNotIn(self.client["client_id"], contents)
            self.assertEqual(self.module.read_client(path), self.client)

            rejected = (
                {"web": self.client},
                {"installed": self.client, "web": self.client},
                {"installed": {**self.client, "token_uri": "https://untrusted.invalid/token"}},
                {"installed": {**self.client, "auth_uri": "https://untrusted.invalid/auth"}},
            )
            for index, payload in enumerate(rejected):
                with self.subTest(index=index):
                    invalid_path = Path(directory) / f"invalid-{index}.json"
                    self.module.save_credentials(invalid_path, payload)
                    with self.assertRaises(self.module.AuthorizationError) as caught:
                        self.module.read_client(invalid_path)
                    self.assertNotIn("SYNTHETIC_SECRET", str(caught.exception))

    def test_output_cannot_escape_private_workspace_or_overwrite_existing_file(self):
        with TemporaryDirectory() as directory, patch.object(self.module, "PROJECT_DIR", Path(directory)):
            for relative in ("public/credential.json", ".work/credential.json", ".work/../credential.json"):
                with self.subTest(relative=relative), self.assertRaises(self.module.AuthorizationError):
                    self.module.private_output(Path(directory) / relative)
            path = Path(directory) / ".work" / "oauth" / "credential.json"
            path.parent.mkdir(parents=True)
            self.assertEqual(self.module.private_output(path), path)
            credential = {"type": "authorized_user", **self.client, "scopes": [self.module.SEND_SCOPE], "refresh_token": "PRIVATE_REFRESH"}
            self.module.save_credentials(path, credential)
            with self.assertRaises(self.module.AuthorizationError):
                self.module.save_credentials(path, {"refresh_token": "REPLACEMENT"})
            self.assertEqual(self.module.read_credentials(path)["refresh_token"], "PRIVATE_REFRESH")
            if os.name == "nt":
                contents = path.read_text()
                self.assertNotIn("PRIVATE_REFRESH", contents)
                self.assertNotIn("SYNTHETIC_SECRET", contents)
                self.assertEqual(json.loads(contents)["type"], "inox_gmail_oauth_dpapi_v1")

    def test_fifteen_minute_timeout_does_not_exchange_or_write_credentials(self):
        fake_server = MagicMock()
        fake_server.expected_host = "127.0.0.1:1234"
        fake_server.result = None
        with patch.object(self.module, "private_output", return_value=Path("unused")), \
             patch.object(self.module, "read_client", return_value=self.client), \
             patch.object(self.module, "restrict_directory"), \
             patch.object(self.module, "CallbackServer") as constructor, \
             patch.object(self.module.time, "monotonic", side_effect=[0, 901]), \
             patch.object(self.module, "exchange_code") as exchange, \
             patch.object(self.module, "save_credentials") as save, \
             redirect_stdout(StringIO()):
            constructor.return_value.__enter__.return_value = fake_server
            with self.assertRaises(self.module.AuthorizationError):
                self.module.run(SimpleNamespace(output="unused", client_file="unused", sender="owner@example.com"))
        self.assertEqual(self.module.WAIT_SECONDS, 900)
        exchange.assert_not_called()
        save.assert_not_called()
