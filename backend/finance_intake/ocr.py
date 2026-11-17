"""Local, bounded Tesseract OCR. No generative API or outbound request is used."""
from collections import OrderedDict
from io import BytesIO
import math
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 24_000_000
MAX_IMAGE_EDGE = 2200
MAX_TSV_BYTES = 2 * 1024 * 1024
MAX_LOG_BYTES = 64 * 1024
MAX_TEXT_CHARS = 60_000
MAX_WORDS = 12_000
TIMEOUT_SECONDS = 45
HEADER = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext"


class OCRReadError(Exception):
    """Safe operational error; never attach raw parser output or receipt text."""

    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def _error(code):
    messages = {
        "unsupported_type": "La lectura automática admite fotos JPEG o PNG.",
        "image_too_large": "La foto supera el límite de 10 MB o 24 millones de píxeles.",
        "invalid_image": "La foto no es válida o no coincide con su tipo de archivo.",
        "ocr_unavailable": "El lector local todavía no está disponible. Puedes revisar el comprobante manualmente.",
        "ocr_timeout": "La lectura tardó demasiado. Revisa la foto manualmente o envía una más nítida.",
        "ocr_failed": "No se pudo completar la lectura local. El comprobante sigue pendiente de revisión.",
        "ocr_output_invalid": "La lectura produjo un resultado inválido o demasiado extenso. Revisa la foto manualmente.",
    }
    return OCRReadError(code, messages[code])


def _prepare_image(raw, mime, path):
    if mime not in {"image/jpeg", "image/png"}:
        raise _error("unsupported_type")
    if not isinstance(raw, bytes) or not raw:
        raise _error("invalid_image")
    if len(raw) > MAX_IMAGE_BYTES:
        raise _error("image_too_large")
    expected = "JPEG" if mime == "image/jpeg" else "PNG"
    try:
        with Image.open(BytesIO(raw), formats=("JPEG", "PNG")) as source:
            if source.format != expected or getattr(source, "n_frames", 1) != 1:
                raise _error("invalid_image")
            if source.width <= 0 or source.height <= 0 or source.width * source.height > MAX_IMAGE_PIXELS:
                raise _error("image_too_large")
            # Dimensions are checked before decoding. Verify integrity, then
            # reopen because Pillow's verify() invalidates its decoding stream.
            source.verify()
        with Image.open(BytesIO(raw), formats=("JPEG", "PNG")) as source:
            source.load()
            image = ImageOps.exif_transpose(source)
            image.thumbnail((MAX_IMAGE_EDGE, MAX_IMAGE_EDGE), Image.Resampling.LANCZOS)
            if image.mode in {"RGBA", "LA"} or "transparency" in image.info:
                rgba = image.convert("RGBA")
                white = Image.new("RGBA", rgba.size, "white")
                white.alpha_composite(rgba)
                image = white.convert("RGB")
            else:
                image = image.convert("RGB")
            # Fresh PNG strips EXIF, original filenames and ancillary metadata.
            clean = Image.frombytes("RGB", image.size, image.tobytes())
            clean.save(path, format="PNG", dpi=(300, 300))
    except OCRReadError:
        raise
    except Image.DecompressionBombError:
        raise _error("image_too_large") from None
    except (OSError, ValueError, SyntaxError, UnidentifiedImageError):
        raise _error("invalid_image") from None


def _command():
    # Configuration may name one installed binary, never a shell command.
    from django.conf import settings
    value = getattr(settings, "FINANCE_WHATSAPP_TESSERACT_COMMAND", "tesseract")
    if not isinstance(value, str) or not value or "\x00" in value:
        raise _error("ocr_unavailable")
    resolved = shutil.which(value, path=os.defpath)
    if not resolved:
        raise _error("ocr_unavailable")
    return str(Path(resolved).resolve())


def _environment(directory):
    environment = {"PATH": os.defpath, "HOME": str(directory), "TMPDIR": str(directory), "TMP": str(directory), "TEMP": str(directory),
                   "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "OMP_THREAD_LIMIT": "1", "OMP_NUM_THREADS": "1"}
    if os.name == "nt":
        for name in ("SystemRoot", "WINDIR"):
            value = os.environ.get(name)
            if value:
                environment[name] = value
    return environment


def _kill(process):
    if process.poll() is not None:
        return
    try:
        # Tesseract does not spawn a process tree. Keep it in the worker's
        # group so the supervisor also kills it after a worker crash/restart.
        process.kill()
    except (OSError, ProcessLookupError):
        pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def _run(binary, image, base, directory):
    output, error_log = base.with_suffix(".tsv"), directory / "stderr.log"
    command = [binary, str(image), str(base), "-l", "spa+eng", "--oem", "1", "--psm", "6", "tsv"]
    process = None
    try:
        with error_log.open("wb") as errors:
            process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=errors,
                shell=False, cwd=directory, env=_environment(directory), close_fds=True,
                start_new_session=False, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            deadline = time.monotonic() + TIMEOUT_SECONDS
            while True:
                status = process.poll()
                if (output.exists() and (output.is_symlink() or output.stat().st_size > MAX_TSV_BYTES)) or error_log.stat().st_size > MAX_LOG_BYTES:
                    raise _error("ocr_output_invalid")
                if status is not None:
                    break
                if time.monotonic() >= deadline:
                    raise _error("ocr_timeout")
                time.sleep(0.1)
            if status != 0:
                raise _error("ocr_failed")
        if not output.is_file() or output.is_symlink() or output.stat().st_size > MAX_TSV_BYTES:
            raise _error("ocr_output_invalid")
        with output.open("rb") as source:
            raw = source.read(MAX_TSV_BYTES + 1)
        if len(raw) > MAX_TSV_BYTES:
            raise _error("ocr_output_invalid")
        return raw
    except OCRReadError:
        raise
    except OSError:
        raise _error("ocr_failed") from None
    finally:
        if process is not None:
            _kill(process)


def _parse_tsv(raw):
    try:
        text = raw.decode("utf-8-sig", errors="strict")
    except UnicodeDecodeError:
        raise _error("ocr_output_invalid") from None
    rows = text.splitlines()
    if not rows or rows[0] != HEADER or len(rows) > MAX_WORDS * 2:
        raise _error("ocr_output_invalid")
    lines = OrderedDict()
    scores, word_count, total_chars = [], 0, 0
    for row in rows[1:]:
        values = row.split("\t", 11)
        if len(values) != 12:
            raise _error("ocr_output_invalid")
        if values[0] != "5":
            continue
        word = values[11].strip()
        if not word:
            continue
        try:
            key = tuple(int(value) for value in values[1:5])
            confidence = float(values[10])
        except ValueError:
            raise _error("ocr_output_invalid") from None
        if not math.isfinite(confidence) or confidence < 0 or confidence > 100 or any(value < 0 for value in key) or any(ord(char) < 32 for char in word):
            raise _error("ocr_output_invalid")
        word_count += 1
        total_chars += len(word) + 1
        if word_count > MAX_WORDS or total_chars > MAX_TEXT_CHARS or len(lines) >= 1200 and key not in lines:
            raise _error("ocr_output_invalid")
        lines.setdefault(key, []).append(word)
        scores.append(confidence)
    # This is Tesseract's average word score, not a calibrated accuracy rate
    # and not a guarantee about totals or any individual financial field.
    return {"text": "\n".join(" ".join(words) for words in lines.values()),
            "confidence": round(sum(scores) / (100 * len(scores)), 4) if scores else 0.0,
            "engine": "tesseract"}


def read_image(raw, mime):
    """Return local OCR suggestions; caller must preserve manual confirmation."""
    with tempfile.TemporaryDirectory(prefix="inox-receipt-ocr-") as temporary:
        directory = Path(temporary)
        if os.name != "nt":
            directory.chmod(0o700)
        image, base = directory / "input.png", directory / "receipt"
        _prepare_image(raw, mime, image)
        return _parse_tsv(_run(_command(), image, base, directory))
