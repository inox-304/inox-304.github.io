from io import BytesIO
from pathlib import Path
import tempfile
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, override_settings
from PIL import Image, PngImagePlugin

from . import ocr


def image_bytes(size=(90, 50), image_format="PNG"):
    output = BytesIO()
    image = Image.new("RGB", size, "white")
    if image_format == "PNG":
        metadata = PngImagePlugin.PngInfo()
        metadata.add_text("private_note", "synthetic metadata must not enter OCR")
        image.save(output, format=image_format, pnginfo=metadata)
    else:
        image.save(output, format=image_format)
    return output.getvalue()


def tsv(words=((1, "TOTAL", 95), (1, "S/", 90), (1, "118.00", 85), (2, "Fecha:", 100))):
    return (ocr.HEADER + "\n" + "\n".join(f"5\t1\t1\t1\t{line}\t{index}\t0\t0\t10\t10\t{confidence}\t{word}"
        for index, (line, word, confidence) in enumerate(words, 1)) + "\n").encode()


class LocalOCRTests(SimpleTestCase):
    def assert_code(self, code, callback):
        with self.assertRaises(ocr.OCRReadError) as raised:
            callback()
        self.assertEqual(raised.exception.code, code)
        return str(raised.exception)

    def test_text_lines_and_mean_confidence_are_serializable_suggestions(self):
        result = ocr._parse_tsv(tsv())
        self.assertEqual(result, {"text": "TOTAL S/ 118.00\nFecha:", "confidence": 0.925, "engine": "tesseract"})
        self.assertEqual(ocr._parse_tsv((ocr.HEADER + "\n").encode())["confidence"], 0)

    def test_input_is_reencoded_resized_and_temporary_directory_removed(self):
        paths = []

        def reader(binary, image, base, directory):
            paths.append(directory)
            with Image.open(image) as cleaned:
                self.assertEqual(cleaned.size, (2200, 1100))
                self.assertEqual(cleaned.mode, "RGB")
                self.assertNotIn("private_note", cleaned.info)
            return tsv()

        with patch.object(ocr, "_command", return_value="synthetic-tesseract"), patch.object(ocr, "_run", side_effect=reader):
            result = ocr.read_image(image_bytes((2400, 1200)), "image/png")
        self.assertEqual(result["engine"], "tesseract")
        self.assertTrue(paths)
        self.assertTrue(all(not path.exists() for path in paths))

    def test_corrupt_type_mismatch_and_unsupported_images_never_start_process(self):
        cases = ((b"not an image", "image/png", "invalid_image"),
                 (image_bytes(), "image/jpeg", "invalid_image"),
                 (image_bytes(), "image/svg+xml", "unsupported_type"),
                 (b"", "image/jpeg", "invalid_image"),
                 (b"x" * (ocr.MAX_IMAGE_BYTES + 1), "image/png", "image_too_large"))
        with patch.object(ocr.subprocess, "Popen") as process:
            for raw, mime, code in cases:
                with self.subTest(code=code):
                    self.assert_code(code, lambda: ocr.read_image(raw, mime))
            process.assert_not_called()

    def test_pixel_limit_is_checked_before_image_decoding(self):
        source = MagicMock(format="PNG", width=6000, height=4001, n_frames=1)
        source.__enter__.return_value = source
        with patch.object(ocr.Image, "open", return_value=source), tempfile.TemporaryDirectory() as temporary:
            self.assert_code("image_too_large", lambda: ocr._prepare_image(b"synthetic", "image/png", Path(temporary) / "image.png"))
        source.load.assert_not_called()
        source.verify.assert_not_called()

    def test_jpeg_is_supported_without_preserving_the_original_format(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "image.png"
            ocr._prepare_image(image_bytes(image_format="JPEG"), "image/jpeg", path)
            with Image.open(path) as image:
                self.assertEqual(image.format, "PNG")

    @override_settings(FINANCE_WHATSAPP_TESSERACT_COMMAND="tesseract")
    def test_missing_binary_produces_safe_operational_error(self):
        with patch.object(ocr.shutil, "which", return_value=None):
            self.assert_code("ocr_unavailable", ocr._command)

    def test_subprocess_uses_fixed_arguments_and_does_not_inherit_secrets(self):
        process = MagicMock()
        process.poll.return_value = 0
        inspected = []

        def launch(command, **kwargs):
            inspected.append((command, kwargs))
            Path(command[2]).with_suffix(".tsv").write_bytes(tsv())
            return process

        with tempfile.TemporaryDirectory() as temporary, patch.dict(ocr.os.environ, {"DATABASE_URL": "synthetic-private", "WHATSAPP_ACCESS_TOKEN": "synthetic-token", "TESSDATA_PREFIX": "unsafe"}), patch.object(ocr.subprocess, "Popen", side_effect=launch):
            directory = Path(temporary)
            output = ocr._run("installed-tesseract", directory / "input.png", directory / "receipt", directory)
        self.assertEqual(output, tsv())
        command, options = inspected[0]
        self.assertEqual(command[3:], ["-l", "spa+eng", "--oem", "1", "--psm", "6", "tsv"])
        self.assertFalse(options["shell"])
        self.assertTrue(options["close_fds"])
        # The service supervisor must retain control after the worker crashes.
        self.assertFalse(options["start_new_session"])
        self.assertEqual(options["env"]["OMP_THREAD_LIMIT"], "1")
        self.assertNotIn("DATABASE_URL", options["env"])
        self.assertNotIn("WHATSAPP_ACCESS_TOKEN", options["env"])
        self.assertNotIn("TESSDATA_PREFIX", options["env"])

    def test_timeout_kills_only_the_tesseract_child_without_killing_its_worker_group(self):
        process = MagicMock()
        process.poll.return_value = None
        with patch.object(ocr.os, "kill", side_effect=AssertionError("Do not kill the worker group")), patch.object(ocr.os, "killpg", create=True, side_effect=AssertionError("Do not kill the worker group")):
            ocr._kill(process)
        process.kill.assert_called_once_with()
        process.wait.assert_called_once_with(timeout=5)

    def test_timeout_stops_the_child_and_does_not_expose_output(self):
        process = MagicMock()
        process.poll.return_value = None
        with tempfile.TemporaryDirectory() as temporary, patch.object(ocr.subprocess, "Popen", return_value=process), patch.object(ocr.time, "monotonic", side_effect=[0, 46]), patch.object(ocr, "_kill") as stop:
            directory = Path(temporary)
            self.assert_code("ocr_timeout", lambda: ocr._run("synthetic", directory / "input.png", directory / "receipt", directory))
            stop.assert_called_once_with(process)

    def test_oversized_output_is_rejected_before_parsing(self):
        process = MagicMock()
        process.poll.return_value = 0

        def launch(command, **kwargs):
            Path(command[2]).with_suffix(".tsv").write_bytes(b"x" * (ocr.MAX_TSV_BYTES + 1))
            return process

        with tempfile.TemporaryDirectory() as temporary, patch.object(ocr.subprocess, "Popen", side_effect=launch):
            directory = Path(temporary)
            self.assert_code("ocr_output_invalid", lambda: ocr._run("synthetic", directory / "input.png", directory / "receipt", directory))

    def test_failed_process_does_not_echo_private_diagnostics(self):
        process = MagicMock()
        process.poll.return_value = 1

        def launch(command, **kwargs):
            kwargs["stderr"].write(b"synthetic secret document and filesystem details")
            return process

        with tempfile.TemporaryDirectory() as temporary, patch.object(ocr.subprocess, "Popen", side_effect=launch):
            directory = Path(temporary)
            message = self.assert_code("ocr_failed", lambda: ocr._run("synthetic", directory / "input.png", directory / "receipt", directory))
        self.assertNotIn("synthetic secret", message)
        self.assertNotIn(temporary, message)

    def test_invalid_tsv_scores_and_unbounded_text_are_rejected(self):
        for raw in (b"not tsv", tsv(((1, "word", "nan"),)), tsv(((1, "word", 101),)), tsv(((1, "word", -1),)), tsv(((1, "\x00word", 90),)), tsv(((1, "x" * 60001, 90),))):
            with self.subTest(prefix=raw[:20]):
                self.assert_code("ocr_output_invalid", lambda: ocr._parse_tsv(raw))

    def test_failed_read_still_cleans_the_private_temporary_directory(self):
        directories = []

        def fail(binary, image, base, directory):
            directories.append(directory)
            raise ocr._error("ocr_failed")

        with patch.object(ocr, "_command", return_value="synthetic"), patch.object(ocr, "_run", side_effect=fail):
            self.assert_code("ocr_failed", lambda: ocr.read_image(image_bytes(), "image/png"))
        self.assertTrue(all(not directory.exists() for directory in directories))
