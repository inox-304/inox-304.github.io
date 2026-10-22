"""Throttled, private Sheets reads shared by all open inventory tabs/workers."""
import hashlib
import json
import math
import os
import tempfile
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone

from .inventory import InventoryError, fetch_sheet, load_snapshot, save_snapshot, snapshot_path


POLL_SECONDS = 60
_thread_lock = threading.Lock()


def sync_enabled():
    return os.getenv("INOX_INVENTORY_REFRESH_ENABLED", "0") == "1"


def _state_path():
    return snapshot_path().with_name("sync-status.json")


def _read_state():
    try:
        path = _state_path()
        if path.stat().st_size > 10_000:
            return {}
        state = json.loads(path.read_text(encoding="utf-8"))
        return state if isinstance(state, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_state(state):
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(state, output, ensure_ascii=False)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextmanager
def _refresh_lock():
    """OS locks release on worker exit; no stale lock files can block a restart."""
    if not _thread_lock.acquire(blocking=False):
        yield False
        return
    handle = None
    locked = False
    try:
        path = snapshot_path().with_name("sync.lock")
        path.parent.mkdir(parents=True, exist_ok=True)
        handle = path.open("a+b")
        if path.stat().st_size == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            locked = True
        except (OSError, BlockingIOError):
            pass
        yield locked
    finally:
        if handle:
            if locked:
                handle.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            handle.close()
        _thread_lock.release()


def snapshot_revision(snapshot):
    if not snapshot:
        return ""
    source = {key: snapshot.get(key) for key in ("spreadsheetId", "inventory", "movements", "recipes", "costs")}
    return hashlib.sha256(json.dumps(source, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def _number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else 0
    except (ValueError, TypeError):
        return 0


def sync_status(*, snapshot=None):
    """Report cached status only; GET requests never contact Google or write files."""
    state = _read_state()
    if snapshot is None:
        try:
            snapshot = load_snapshot()
        except InventoryError:
            snapshot = None
    enabled = sync_enabled()
    now = time.time()
    attempted = _number(state.get("attempted"))
    verified = _number(state.get("verified"))
    source_id = os.getenv("INOX_INVENTORY_SHEET_ID", "") or (snapshot or {}).get("spreadsheetId", "")
    same_source = state.get("spreadsheetId") == source_id
    if not enabled:
        status, message = "pending", "Falta conectar Google Sheets con el servidor."
    elif not same_source or not verified:
        status, message = "waiting", "Comprobando la conexión con Google Sheets…"
    elif state.get("error"):
        status, message = "error", state["error"]
    elif now - verified > POLL_SECONDS * 3:
        status, message = "stale", "La última comprobación está pendiente de renovarse."
    else:
        status, message = "connected", "Conectado · revisión automática cada minuto."
    # Show the first failed attempt too, even if Google has never succeeded.
    if enabled and same_source and state.get("error"):
        status, message = "error", state["error"]
    return {"enabled": enabled, "state": status, "message": message,
            "revision": snapshot_revision(snapshot), "fetchedAt": (snapshot or {}).get("fetchedAt", ""),
            "checkedAt": datetime.fromtimestamp(verified, timezone.utc).isoformat() if verified else "",
            "retryAfter": max(1, math.ceil(POLL_SECONDS - max(0, now - attempted))) if same_source else 1,
            "interval": POLL_SECONDS}


def refresh_inventory():
    """Read at most once per minute across tabs, threads and server workers."""
    if not sync_enabled():
        return {**sync_status(), "refreshed": False, "changed": False}
    try:
        with _refresh_lock() as acquired:
            if not acquired:
                return {**sync_status(), "refreshed": False, "changed": False, "busy": True, "retryAfter": 5}
            try:
                current = load_snapshot() or {}
            except InventoryError:
                current = {}
            source_id = os.getenv("INOX_INVENTORY_SHEET_ID", "") or current.get("spreadsheetId", "")
            state = _read_state()
            now = time.time()
            attempted = _number(state.get("attempted"))
            if state.get("spreadsheetId") == source_id and 0 <= now - attempted < POLL_SECONDS:
                return {**sync_status(snapshot=current), "refreshed": False, "changed": False}
            if state.get("spreadsheetId") != source_id:
                state = {}
            state = {**state, "spreadsheetId": source_id, "attempted": now}
            # Persist the attempt first, so errors/restarts cannot hammer the API.
            _write_state(state)
            try:
                snapshot = fetch_sheet(source_id)
                save_snapshot(snapshot)  # Validation precedes the atomic replacement.
            except InventoryError as error:
                _write_state({**state, "error": str(error)})
                return {**sync_status(snapshot=current), "refreshed": False, "changed": False}
            _write_state({**state, "verified": time.time(), "error": ""})
            return {**sync_status(snapshot=snapshot), "refreshed": True,
                    "changed": snapshot_revision(current) != snapshot_revision(snapshot)}
    except OSError:
        return {**sync_status(), "state": "error", "refreshed": False, "changed": False,
                "message": "No se pudo guardar la actualización. Se conserva la última copia disponible.",
                "retryAfter": POLL_SECONDS}
