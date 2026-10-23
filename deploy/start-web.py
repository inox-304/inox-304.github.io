"""Start the web process; database migrations and imports are separate operations."""
import os
from pathlib import Path
import subprocess
import sys


PROJECT_DIR = Path(__file__).resolve().parent.parent


def integer_option(name, default, maximum):
    value = os.environ.get(name, str(default))
    if not value.isascii() or not value.isdecimal():
        raise ValueError(f"{name} must be a positive integer.")
    number = int(value)
    if not 1 <= number <= maximum:
        raise ValueError(f"{name} must be between 1 and {maximum}.")
    return number


def main():
    try:
        port = integer_option("PORT", 8000, 65535)
        workers = integer_option("WEB_CONCURRENCY", 1, 32)
        timeout = integer_option("GUNICORN_TIMEOUT", 60, 300)
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
    os.execv(str(gunicorn), arguments)


if __name__ == "__main__":
    raise SystemExit(main())
