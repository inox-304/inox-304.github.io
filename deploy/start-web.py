"""Start web + optional import worker; never migrate, seed or queue imports."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


PROJECT_DIR = Path(__file__).resolve().parent.parent
POLL_SECONDS = 0.25
SHUTDOWN_SECONDS = 10
MAX_RESTART_DELAY = 30
STABLE_WORKER_SECONDS = 60
KILL_SIGNAL = getattr(signal, "SIGKILL", 9)


def integer_option(name, default, maximum):
    value = os.environ.get(name, str(default))
    if not value.isascii() or not value.isdecimal():
        raise ValueError(f"{name} must be a positive integer.")
    number = int(value)
    if not 1 <= number <= maximum:
        raise ValueError(f"{name} must be between 1 and {maximum}.")
    return number


def worker_enabled():
    default = "1" if os.environ.get("DJANGO_ENV") == "production" else "0"
    value = os.environ.get("MODEL_IMPORT_WORKER", default)
    if value not in ("0", "1"):
        raise ValueError("MODEL_IMPORT_WORKER must be 0 or 1.")
    return value == "1"


def start_process(arguments, cwd):
    options = {"cwd": cwd, "stdin": subprocess.DEVNULL, "close_fds": True}
    if os.name == "posix":
        # A group per service lets shutdown include its children, not only the
        # gunicorn/management-command leader. No shell is involved.
        options["start_new_session"] = True
    elif os.name == "nt":
        options["creationflags"] = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
    return subprocess.Popen(arguments, **options)


def signal_process(process, sig):
    if process is None:
        return
    try:
        if os.name == "posix":
            # Still signal the group if its leader already exited: conversion
            # or gunicorn children may remain alive after a parent crash.
            os.killpg(process.pid, sig)
        elif process.poll() is None:
            if sig == signal.SIGTERM:
                process.terminate()
            else:
                process.kill()
    except ProcessLookupError:
        pass


def stop_processes(processes):
    processes = [process for process in processes if process is not None]
    for process in processes:
        signal_process(process, signal.SIGTERM)
    deadline = time.monotonic() + SHUTDOWN_SECONDS
    try:
        for process in processes:
            try:
                process.wait(timeout=max(0, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                pass
    finally:
        # Also reap descendants of leaders that completed before the deadline.
        for process in processes:
            signal_process(process, KILL_SIGNAL)
        for process in processes:
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                print("A service did not exit after forced shutdown.", file=sys.stderr, flush=True)


def supervise(web_arguments, worker_arguments, cwd):
    """Keep one queue consumer alive while web is alive; back off crash loops."""
    shutdown_signal = None
    previous_handlers = {}
    web = worker = None

    def request_shutdown(signum, _frame):
        nonlocal shutdown_signal
        shutdown_signal = signum

    for sig in (signal.SIGTERM, signal.SIGINT):
        previous_handlers[sig] = signal.signal(sig, request_shutdown)
    try:
        web = start_process(web_arguments, cwd)
        restart_at = 0.0
        restart_delay = 1.0
        started_at = 0.0
        while shutdown_signal is None:
            web_code = web.poll()
            if web_code is not None:
                return web_code if web_code >= 0 else 128 - web_code
            now = time.monotonic()
            if worker is not None and worker.poll() is not None:
                # The queue uses leases to recover interrupted work. Clean up
                # children before starting another consumer for this instance.
                signal_process(worker, KILL_SIGNAL)
                worker.wait()
                worker = None
                if now - started_at >= STABLE_WORKER_SECONDS:
                    restart_delay = 1.0
                restart_at = now + restart_delay
                print(f"Model import worker exited; retrying in {restart_delay:g}s.", file=sys.stderr, flush=True)
                restart_delay = min(restart_delay * 2, MAX_RESTART_DELAY)
            if worker is None and now >= restart_at:
                try:
                    worker = start_process(worker_arguments, cwd)
                    started_at = now
                except OSError:
                    # Keep catalogue/login serving if a worker launch fails.
                    restart_at = now + restart_delay
                    print(f"Model import worker unavailable; retrying in {restart_delay:g}s.", file=sys.stderr, flush=True)
                    restart_delay = min(restart_delay * 2, MAX_RESTART_DELAY)
            time.sleep(POLL_SECONDS)
        return 128 + shutdown_signal
    finally:
        try:
            stop_processes((worker, web))
        finally:
            for sig, handler in previous_handlers.items():
                signal.signal(sig, handler)


def main():
    try:
        port = integer_option("PORT", 8000, 65535)
        workers = integer_option("WEB_CONCURRENCY", 1, 32)
        timeout = integer_option("GUNICORN_TIMEOUT", 60, 300)
        imports_enabled = worker_enabled()
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2

    backend = PROJECT_DIR / "backend"
    # Only rebuild disposable static assets. Never seed, migrate or import here.
    subprocess.run(
        [sys.executable, str(backend / "manage.py"), "collectstatic", "--noinput"],
        cwd=PROJECT_DIR,
        check=True,
    )
    gunicorn = backend / ".venv" / "bin" / "gunicorn"
    os.chdir(backend)
    # Django explicitly controls trusted HTTPS headers. Gunicorn must not add a
    # separate trust path for client-supplied forwarded headers.
    arguments = [
        str(gunicorn), "config.wsgi:application",
        "--bind", f"0.0.0.0:{port}",
        "--workers", str(workers),
        "--timeout", str(timeout),
        "--forwarded-allow-ips", "",
        "--access-logfile", "-", "--error-logfile", "-",
    ]
    if imports_enabled:
        worker_arguments = [sys.executable, str(backend / "manage.py"), "process_model_imports"]
        return supervise(arguments, worker_arguments, backend)
    os.execv(str(gunicorn), arguments)


if __name__ == "__main__":
    raise SystemExit(main())
