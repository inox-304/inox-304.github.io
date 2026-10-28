"""One bounded conversion process with no server credentials in its environment."""
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time

from django.conf import settings
from django.core.files import File
from django.db import close_old_connections

from catalog.models import MediaAsset
from catalog.storage import open_private_file
from .services import finish_job, heartbeat


class JobFailure(Exception):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def child_environment(directory):
    # No inherited DB, Gmail, Sheets, AWS, S3, shell profiles or Python settings.
    result = {"PATH": os.defpath, "HOME": str(directory), "TMPDIR": str(directory),
              "TEMP": str(directory), "TMP": str(directory), "LANG": "C.UTF-8",
              "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1", "MKL_NUM_THREADS": "1"}
    if os.name == "nt":
        for key in ("SYSTEMROOT", "WINDIR"):
            if os.environ.get(key):
                result[key] = os.environ[key]
    return result


def _terminate(process):
    if os.name == "posix":
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    elif process.poll() is None:
        process.kill()
    process.wait(timeout=10)


def _rss_mb(pid):
    if sys.platform != "linux":
        return 0
    try:
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) / 1024
    except (OSError, ValueError):
        pass
    return 0


BOOTSTRAP = """
import os, sys
if sys.platform == 'linux':
    import ctypes, signal
    expected_parent = int(sys.argv.pop(1))
    # Also kill the converter if its supervisor is OOM-killed or crashes.
    if ctypes.CDLL(None, use_errno=True).prctl(1, signal.SIGKILL, 0, 0, 0) != 0:
        raise SystemExit(1)
    if os.getppid() != expected_parent:
        raise SystemExit(1)
    import resource
    resource.setrlimit(resource.RLIMIT_CPU, (120, 120))
    resource.setrlimit(resource.RLIMIT_AS, (1536*1024*1024, 1536*1024*1024))
    resource.setrlimit(resource.RLIMIT_FSIZE, (16*1024*1024, 16*1024*1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
root = sys.argv.pop(1)
sys.path.insert(0, root)
portable = os.path.join(root, '.portable-python')
if os.path.isdir(portable):
    sys.path.append(portable)
from model_imports.converter import main
raise SystemExit(main(sys.argv[1:]))
"""


def convert_process(source, output, *, alive):
    directory = source.parent
    arguments = [str(os.getpid())] if sys.platform == "linux" else []
    command = [sys.executable, "-I", "-c", BOOTSTRAP, *arguments, str(settings.BASE_DIR), str(source), str(output)]
    with (directory / "result.json").open("wb") as stdout, (directory / "errors.txt").open("wb") as stderr:
        process = subprocess.Popen(command, cwd=directory, env=child_environment(directory),
                                   stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                   start_new_session=os.name == "posix")
        started, next_check = time.monotonic(), 0
        try:
            while process.poll() is None:
                now = time.monotonic()
                if now - started > settings.MODEL_IMPORT_TIMEOUT_SECONDS:
                    raise JobFailure("timeout", "El modelo tardó demasiado. Purga elementos sin usar y vuelve a intentarlo.")
                if _rss_mb(process.pid) > settings.MODEL_IMPORT_MAX_RSS_MB:
                    raise JobFailure("memory_limit", "El modelo necesita demasiada memoria. Reduce texturas o componentes antes de subirlo.")
                if (directory / "result.json").stat().st_size > 128 * 1024 or (directory / "errors.txt").stat().st_size > 64 * 1024:
                    raise JobFailure("conversion_failed", "El conversor no pudo interpretar este archivo de forma segura.")
                if now >= next_check:
                    close_old_connections()
                    if not alive():
                        raise JobFailure("cancelled", "La conversión se canceló o pasó a otro proceso.")
                    next_check = now + 5
                time.sleep(.25)
        finally:
            _terminate(process)
    raw = (directory / "result.json").read_bytes()
    if len(raw) > 128 * 1024:
        raise JobFailure("conversion_failed", "La respuesta del conversor no es válida.")
    try:
        result = json.loads(raw)
    except (ValueError, UnicodeError):
        raise JobFailure("conversion_failed", "No se pudo completar el modelo dentro de los límites del servicio.") from None
    if not isinstance(result, dict) or process.returncode != 0 or result.get("ok") is not True:
        # Only our own fixed messages are returned, never raw parser output.
        code = result.get("code", "conversion_failed") if isinstance(result, dict) else "conversion_failed"
        message = result.get("message", "No se pudo convertir el modelo.") if isinstance(result, dict) else "No se pudo convertir el modelo."
        if not isinstance(code, str) or len(code) > 40 or not isinstance(message, str) or len(message) > 500:
            raise JobFailure("conversion_failed", "No se pudo convertir el modelo.")
        raise JobFailure(code, message)
    if output.is_symlink() or not output.is_file() or output.stat().st_size > 8 * 1024 * 1024:
        raise JobFailure("output_too_large", "El GLB supera 8 MB. Reduce texturas y detalles antes de convertirlo.")
    result.pop("ok", None)
    return result


def process_job(job):
    asset = None
    try:
        with tempfile.TemporaryDirectory(prefix="inox-skp-") as name:
            directory = Path(name)
            if os.name == "posix":
                directory.chmod(0o700)
            source, output = directory / "source.skp", directory / "model.glb"
            digest, size = hashlib.sha256(), 0
            with open_private_file(job.source.storage, job.source.name) as original, source.open("wb") as target:
                while chunk := original.read(1024 * 1024):
                    size += len(chunk)
                    if size > settings.MODEL_IMPORT_MAX_SOURCE_BYTES:
                        raise JobFailure("source_too_large", "El archivo supera el límite permitido.")
                    digest.update(chunk)
                    target.write(chunk)
            if size != job.source_size or digest.hexdigest() != job.source_sha256:
                raise JobFailure("source_changed", "El archivo guardado no coincide con el original. Sube otra copia.")
            if not heartbeat(job):
                return
            stats = convert_process(source, output, alive=lambda: heartbeat(job))
            if not heartbeat(job):
                return
            with output.open("rb") as model:
                asset = MediaAsset(name=f"{job.product.code} · SketchUp revisable"[:180], kind="glb")
                asset.file = File(model, name="model.glb")
                asset.save()  # Existing GLB validator runs before the storage write.
            if finish_job(job, asset=asset, stats=stats):
                asset = None  # Job now owns the result; public access still needs approval.
    except JobFailure as error:
        finish_job(job, error_code=error.code, error_message=str(error))
    except Exception:
        # Never log file contents, storage credentials or exception URLs.
        finish_job(job, error_code="conversion_failed", error_message="No se pudo preparar el modelo. El original está guardado; puedes reintentar.")
    finally:
        if asset is not None:
            name, storage = f"catalog/{asset.pk}.glb", asset.file.storage
            if not asset._state.adding:
                asset.delete()
            storage.delete(name)
