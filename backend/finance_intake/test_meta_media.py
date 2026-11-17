"""Meta transport tests use synthetic images and a fake HTTPS client only."""
import base64
import hashlib
from io import BytesIO
import json
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings
from PIL import Image
import requests

from .meta_media import MAX_IMAGE_BYTES, MAX_METADATA_BYTES, MediaDownloadError, download_image


CONFIG = {
    "FINANCE_WHATSAPP_ENABLED": True,
    "FINANCE_WHATSAPP_ACCESS_TOKEN": "synthetic-token-not-real",
    "FINANCE_WHATSAPP_GRAPH_API_VERSION": "v27.0",
    "FINANCE_WHATSAPP_PHONE_NUMBER_ID": "123456",
}
MEDIA_ID = "987654"
MEDIA_URL = "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=987654&hash=synthetic"


class Response:
    def __init__(self, data, content_type, status=200, **headers):
        self.data = data
        self.headers = {"Content-Type": content_type, **headers}
        self.status_code = status
        self.closed = False
        self.read_count = 0
        self.offset = 0
        self.raw = self

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.closed = True

    def read1(self, amount, *, decode_content):
        if decode_content:
            raise AssertionError("Compressed responses must not be decoded.")
        self.read_count += 1
        chunk = self.data[self.offset:self.offset + amount]
        self.offset += len(chunk)
        return chunk


class Session:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.calls = []
        self.closed = False
        self.trust_env = True
        self.max_redirects = 30

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.closed = True

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        response = next(self.responses)
        if isinstance(response, Exception):
            raise response
        return response


@override_settings(**CONFIG)
class MetaMediaTests(SimpleTestCase):
    def setUp(self):
        output = BytesIO()
        Image.new("RGB", (3, 2), (10, 20, 30)).save(output, "PNG")
        self.image = output.getvalue()
        self.digest = hashlib.sha256(self.image).hexdigest()

    def metadata(self, **changes):
        value = {"id": MEDIA_ID, "messaging_product": "whatsapp", "url": MEDIA_URL,
                 "file_size": len(self.image), "mime_type": "image/png", "sha256": self.digest}
        value.update(changes)
        return Response(json.dumps(value).encode(), "application/json")

    def download(self, metadata=None, media=None, **kwargs):
        session = Session([metadata or self.metadata(), media or Response(self.image, "image/png")])
        with patch("finance_intake.meta_media.requests.Session", return_value=session):
            result = download_image(MEDIA_ID, **kwargs)
        return result, session

    def test_verified_original_is_returned_with_phone_binding_and_no_environment_proxy(self):
        result, session = self.download(expected_sha256=self.digest, expected_mime="image/png")
        self.assertEqual(result.data, self.image)
        self.assertEqual(result.sha256, self.digest)
        self.assertEqual(result.content_type, "image/png")
        self.assertFalse(session.trust_env)
        self.assertEqual(session.max_redirects, 0)
        self.assertTrue(session.closed)
        self.assertEqual(session.calls[0][0], "https://graph.facebook.com/v27.0/987654?phone_number_id=123456")
        self.assertEqual(session.calls[1][0], MEDIA_URL)
        for url, options in session.calls:
            self.assertNotIn(CONFIG["FINANCE_WHATSAPP_ACCESS_TOKEN"], url)
            self.assertFalse(options["allow_redirects"])
            self.assertTrue(options["stream"])
            self.assertEqual(options["timeout"], (5, 15))
            self.assertEqual(options["headers"]["Authorization"], "Bearer " + CONFIG["FINANCE_WHATSAPP_ACCESS_TOKEN"])

    def test_hexadecimal_and_base64_sha256_formats_are_accepted(self):
        encoded = base64.b64encode(bytes.fromhex(self.digest)).decode()
        for metadata_hash, expected in ((encoded, self.digest.upper()), (self.digest, encoded)):
            with self.subTest(metadata_hash=metadata_hash):
                result, _ = self.download(self.metadata(sha256=metadata_hash), expected_sha256=expected)
                self.assertEqual(result.sha256, self.digest)

    def test_configuration_and_media_ids_are_validated_before_any_request(self):
        configurations = ({"FINANCE_WHATSAPP_ENABLED": False}, {"FINANCE_WHATSAPP_ACCESS_TOKEN": ""},
                          {"FINANCE_WHATSAPP_ACCESS_TOKEN": "token\r\nother"},
                          {"FINANCE_WHATSAPP_GRAPH_API_VERSION": "v27.0/../../me"},
                          {"FINANCE_WHATSAPP_PHONE_NUMBER_ID": "123&other=1"})
        for config in configurations:
            with self.subTest(config=config), override_settings(**config), patch("finance_intake.meta_media.requests.Session") as factory:
                with self.assertRaises(MediaDownloadError):
                    download_image(MEDIA_ID)
                factory.assert_not_called()
        for invalid in ("https://attacker.invalid/", "123/../me", "123?fields=token", "１２３", "", 123):
            with self.subTest(media_id=invalid), patch("finance_intake.meta_media.requests.Session") as factory:
                with self.assertRaises(MediaDownloadError):
                    download_image(invalid)
                factory.assert_not_called()

    def test_untrusted_media_urls_do_not_receive_bearer_credentials(self):
        urls = ["https://attacker.invalid/", "http://lookaside.fbsbx.com/whatsapp_business/attachments/",
                "https://lookaside.fbsbx.com.attacker.invalid/whatsapp_business/attachments/",
                "https://127.0.0.1/whatsapp_business/attachments/", "https://[::1]/",
                "https://lookaside.fbsbx.com@attacker.invalid/whatsapp_business/attachments/",
                "https://user@lookaside.fbsbx.com/whatsapp_business/attachments/",
                "https://lookaside.fbsbx.com:8443/whatsapp_business/attachments/",
                "https://lookaside.fbsbx.com/other-path", MEDIA_URL + "#fragment", MEDIA_URL + "\n",
                "https://lookaside.fbsbx.com\\@attacker.invalid/whatsapp_business/attachments/"]
        for url in urls:
            session = Session([self.metadata(url=url)])
            with self.subTest(url=url), patch("finance_intake.meta_media.requests.Session", return_value=session):
                with self.assertRaises(MediaDownloadError):
                    download_image(MEDIA_ID)
                self.assertEqual(len(session.calls), 1)
                self.assertTrue(session.closed)

    def test_redirects_and_provider_error_bodies_are_not_followed_or_read(self):
        for status, retryable in ((301, False), (302, False), (307, False), (401, False), (404, False), (429, True), (503, True)):
            response = Response(b"provider text must remain private", "application/json", status=status, Location="https://attacker.invalid")
            session = Session([response])
            with self.subTest(status=status), patch("finance_intake.meta_media.requests.Session", return_value=session):
                with self.assertRaises(MediaDownloadError) as error:
                    download_image(MEDIA_ID)
                self.assertEqual(error.exception.retryable, retryable)
                self.assertEqual(len(session.calls), 1)
                self.assertEqual(response.read_count, 0)
                self.assertTrue(response.closed)
                self.assertNotIn("provider text", str(error.exception))

    def test_metadata_and_image_sizes_are_bounded_when_length_missing_or_false(self):
        cases = [
            (Response(b"x" * (MAX_METADATA_BYTES + 1), "application/json"), None),
            (Response(b"{}", "application/json", **{"Content-Length": str(MAX_METADATA_BYTES + 1)}), None),
            (self.metadata(file_size=MAX_IMAGE_BYTES + 1), None),
            (self.metadata(), Response(b"x" * (MAX_IMAGE_BYTES + 1), "image/png")),
            (self.metadata(), Response(self.image, "image/png", **{"Content-Length": str(MAX_IMAGE_BYTES + 1)})),
            (self.metadata(), Response(self.image, "image/png", **{"Content-Length": "1"})),
        ]
        for metadata, media in cases:
            with self.subTest(metadata=metadata.headers, media=media is not None), self.assertRaises(MediaDownloadError):
                self.download(metadata, media)

    def test_metadata_shapes_and_digest_mime_and_size_mismatches_fail_closed(self):
        for changes in ({"id": "another"}, {"messaging_product": "other"}, {"mime_type": []},
                        {"mime_type": "application/pdf"}, {"file_size": True}, {"file_size": "-1"},
                        {"file_size": len(self.image) + 1}, {"sha256": "invalid"}, {"sha256": "0" * 64}):
            with self.subTest(changes=changes), self.assertRaises(MediaDownloadError):
                self.download(self.metadata(**changes))
        for raw in (b"null", b"[]", b"not-json", b"[" * 2000 + b"]" * 2000):
            with self.subTest(raw_length=len(raw)), self.assertRaises(MediaDownloadError):
                self.download(Response(raw, "application/json"))
        with self.assertRaises(MediaDownloadError):
            self.download(expected_sha256="0" * 64)
        with self.assertRaises(MediaDownloadError):
            self.download(expected_mime="image/jpeg")
        with self.assertRaises(MediaDownloadError):
            self.download(media=Response(self.image, "image/jpeg"))
        with self.assertRaises(MediaDownloadError):
            self.download(media=Response(self.image, "image/png", **{"Content-Encoding": "gzip"}))

    def test_transport_errors_are_retryable_without_exposing_url_or_token(self):
        session = Session([requests.Timeout("synthetic-token-not-real signed-url=private")])
        with patch("finance_intake.meta_media.requests.Session", return_value=session):
            with self.assertRaises(MediaDownloadError) as error:
                download_image(MEDIA_ID)
        self.assertTrue(error.exception.retryable)
        self.assertTrue(session.closed)
        self.assertNotIn("synthetic-token-not-real", str(error.exception))
        self.assertNotIn("private", str(error.exception))

    def test_expired_download_url_can_retry_with_a_new_metadata_request(self):
        with self.assertRaises(MediaDownloadError) as error:
            self.download(media=Response(b"expired signed URL", "application/json", status=404))
        self.assertTrue(error.exception.retryable)

    def test_transfer_deadline_stops_slow_stream(self):
        with patch("finance_intake.meta_media.time.monotonic", side_effect=[0, 31]):
            with self.assertRaises(MediaDownloadError) as error:
                self.download()
        self.assertEqual(error.exception.code, "download_timeout")
        self.assertTrue(error.exception.retryable)

    def test_small_available_reads_cannot_reset_total_transfer_budget(self):
        response = self.metadata()
        original = response.read1
        response.read1 = lambda amount, **kwargs: original(1, **kwargs)
        with patch("finance_intake.meta_media.time.monotonic", side_effect=[0, 0, 16, 31]):
            with self.assertRaises(MediaDownloadError) as error:
                self.download(metadata=response)
        self.assertEqual(response.read_count, 2)
        self.assertTrue(response.closed)
        self.assertEqual(error.exception.code, "download_timeout")

    def test_decoded_format_must_be_static_valid_image_with_bounded_dimensions(self):
        for image in (b"not-an-image", b"\x89PNG\r\n\x1a\ncorrupt"):
            metadata = self.metadata(file_size=len(image), sha256=hashlib.sha256(image).hexdigest())
            with self.subTest(size=len(image)), self.assertRaises(MediaDownloadError):
                self.download(metadata, Response(image, "image/png"))
        with patch("finance_intake.meta_media.MAX_IMAGE_PIXELS", 5), self.assertRaises(MediaDownloadError):
            self.download()

    def test_metadata_decimal_size_and_jpeg_image_are_supported(self):
        output = BytesIO()
        Image.new("RGB", (3, 2), (10, 20, 30)).save(output, "JPEG")
        self.image = output.getvalue()
        self.digest = hashlib.sha256(self.image).hexdigest()
        result, _ = self.download(self.metadata(file_size=str(len(self.image)), mime_type="image/jpeg"),
                                  Response(self.image, "image/jpeg"))
        self.assertEqual(result.content_type, "image/jpeg")
