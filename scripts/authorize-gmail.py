"""Local, explicit Google consent for gmail.send; never sends email or edits .env."""
import argparse
import base64
import ctypes
from ctypes import wintypes
from datetime import datetime, timezone
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import secrets
import sys
import time
from urllib.parse import parse_qs, urlencode, urlsplit

import requests


PROJECT_DIR = Path(__file__).resolve().parent.parent
AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send"
CALLBACK_PATH = "/oauth/callback"
WAIT_SECONDS = 300


class AuthorizationError(Exception):
    """Only fixed, non-secret messages may be supplied to this exception."""


def read_client(path):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8-sig"))
        if data.get("type") == "inox_gmail_oauth_dpapi_v1":
            protected = base64.b64decode(data["ciphertext"], validate=True)
            data = json.loads(windows_protect(protected, decrypt=True).decode("utf-8"))
        client = data["installed"]
        client_id, client_secret = client["client_id"], client["client_secret"]
        if "web" in data or not isinstance(client_id, str) or not isinstance(client_secret, str):
            raise ValueError
        if not client_id.endswith(".apps.googleusercontent.com") or not client_secret:
            raise ValueError
        if client.get("auth_uri", AUTH_ENDPOINT) not in (
            AUTH_ENDPOINT, "https://accounts.google.com/o/oauth2/auth"
        ) or client.get("token_uri", TOKEN_ENDPOINT) != TOKEN_ENDPOINT:
            raise ValueError
        return {"client_id": client_id, "client_secret": client_secret}
    except Exception:
        raise AuthorizationError("No se pudo leer un cliente OAuth de tipo Desktop valido.") from None


def private_output(path):
    root = (PROJECT_DIR / ".work").resolve()
    target = Path(path).resolve()
    if not target.is_relative_to(root) or target.parent == root or target.suffix != ".json":
        raise AuthorizationError("La salida debe ser un JSON dentro de una subcarpeta privada de .work.")
    if target.exists():
        raise AuthorizationError("El archivo de salida ya existe; no se sobrescribira.")
    return target


def restrict_directory(directory):
    directory.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        # Fail before asking for consent if this process cannot access the
        # current user's DPAPI profile (for example, a restricted test sandbox).
        probe = b"INOX OAuth storage check"
        if windows_protect(windows_protect(probe), decrypt=True) != probe:
            raise AuthorizationError("Windows no pudo comprobar el almacenamiento privado.")
    else:
        directory.chmod(0o700)


def windows_protect(data, *, decrypt=False):
    """DPAPI current-user encryption; never use the machine-wide protection flag."""
    if os.name != "nt":
        raise AuthorizationError("Esta credencial cifrada solo se abre con el usuario Windows que la guardo.")
    class Blob(ctypes.Structure):
        _fields_ = [("length", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]

    incoming_buffer = ctypes.create_string_buffer(data)
    incoming = Blob(len(data), ctypes.cast(incoming_buffer, ctypes.POINTER(ctypes.c_ubyte)))
    outgoing = Blob()
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    if decrypt:
        function = crypt32.CryptUnprotectData
        function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p,
                             ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
        arguments = (ctypes.byref(incoming), None, None, None, None, 1, ctypes.byref(outgoing))
    else:
        function = crypt32.CryptProtectData
        function.argtypes = [ctypes.POINTER(Blob), wintypes.LPCWSTR, ctypes.c_void_p,
                             ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
        arguments = (ctypes.byref(incoming), "INOX Gmail OAuth", None, None, None, 1, ctypes.byref(outgoing))
    function.restype = wintypes.BOOL
    if not function(*arguments):
        raise AuthorizationError("Windows no pudo proteger o abrir la credencial para este usuario.")
    try:
        return ctypes.string_at(outgoing.data, outgoing.length)
    finally:
        kernel32.LocalFree(ctypes.cast(outgoing.data, ctypes.c_void_p))


def authorization_url(client_id, redirect_uri, state, verifier, sender):
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).rstrip(b"=").decode("ascii")
    return AUTH_ENDPOINT + "?" + urlencode({
        "client_id": client_id, "redirect_uri": redirect_uri,
        "response_type": "code", "scope": SEND_SCOPE,
        "state": state, "code_challenge": challenge, "code_challenge_method": "S256",
        "access_type": "offline", "prompt": "consent", "login_hint": sender,
    })


def inspect_callback(target, expected_state):
    """Reject unexpected paths, duplicate parameters, CSRF and changed scopes."""
    parsed = urlsplit(target)
    if parsed.scheme or parsed.netloc or parsed.path != CALLBACK_PATH or parsed.fragment:
        return "wrong_path", None
    try:
        query = parse_qs(parsed.query, keep_blank_values=True, max_num_fields=20)
    except ValueError:
        return "invalid", None
    if any(len(values) != 1 for values in query.values()):
        return "invalid", None
    state = query.get("state", [""])[0]
    if not secrets.compare_digest(state.encode("utf-8"), expected_state.encode("utf-8")):
        return "wrong_state", None
    if "scope" in query and set(query["scope"][0].split()) != {SEND_SCOPE}:
        return "wrong_scope", None
    if "error" in query:
        return "denied", None
    code = query.get("code", [""])[0]
    if not code or len(code) > 4096:
        return "invalid", None
    return "accepted", code


class CallbackServer(HTTPServer):
    def __init__(self, state):
        super().__init__(("127.0.0.1", 0), CallbackHandler)
        self.expected_state = state
        self.result = None
        self.code = None
        self.expected_host = f"127.0.0.1:{self.server_port}"

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(2)
        return connection, address

    def handle_error(self, request, client_address):
        # Never log callback URLs, authorization codes or incoming request data.
        pass


class CallbackHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        if self.headers.get("Host") != self.server.expected_host or self.server.result is not None:
            self.reply(403, "Solicitud no valida.")
            return
        status, code = inspect_callback(self.path, self.server.expected_state)
        if status == "accepted":
            self.server.result, self.server.code = status, code
            self.reply(200, "Respuesta recibida. Puedes cerrar esta pestana; la consola comprobara la autorizacion.")
        elif status in ("denied", "wrong_scope"):
            self.server.result = status
            self.reply(400, "No se completo la autorizacion solicitada. Vuelve a la consola.")
        else:
            self.reply(404 if status == "wrong_path" else 403, "Solicitud no valida.")

    def reply(self, status, text):
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)


def exchange_code(client, code, redirect_uri, verifier, sender):
    try:
        with requests.Session() as session:
            response = session.post(TOKEN_ENDPOINT, data={
                **client, "code": code, "redirect_uri": redirect_uri,
                "grant_type": "authorization_code", "code_verifier": verifier,
            }, timeout=15, allow_redirects=False)
            try:
                if response.status_code != 200:
                    raise AuthorizationError("Google no completo el intercambio de autorizacion.")
                payload = response.json()
            finally:
                response.close()
        if not isinstance(payload, dict) or set(str(payload.get("scope", "")).split()) != {SEND_SCOPE}:
            raise AuthorizationError("Google no devolvio exclusivamente el permiso gmail.send solicitado.")
        if str(payload.get("token_type", "")).lower() != "bearer" or not payload.get("access_token"):
            raise AuthorizationError("Google devolvio una respuesta de autorizacion incompleta.")
        refresh_token = payload.get("refresh_token")
        if not isinstance(refresh_token, str) or not refresh_token:
            raise AuthorizationError("Falta el refresh token; no se guardo ninguna credencial.")
        return {
            "type": "authorized_user", **client, "refresh_token": refresh_token,
            "token_uri": TOKEN_ENDPOINT, "scopes": [SEND_SCOPE],
            "configured_sender": sender,
            "sender_identity_verified": False,
            "authorized_at": datetime.now(timezone.utc).isoformat(),
        }
    except AuthorizationError:
        raise
    except Exception:
        raise AuthorizationError("No se pudo completar la autorizacion con Google.") from None


def save_credentials(output, credentials):
    # Exclusive creation prevents replacing an existing working credential.
    if os.name == "nt":
        protected = windows_protect(json.dumps(credentials).encode("utf-8"))
        payload = {"type": "inox_gmail_oauth_dpapi_v1", "ciphertext": base64.b64encode(protected).decode("ascii")}
    else:
        payload = credentials
    try:
        descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise AuthorizationError("El archivo de salida ya existe; no se sobrescribira.") from None
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as destination:
            json.dump(payload, destination, ensure_ascii=True, indent=2)
            destination.write("\n")
            destination.flush()
            os.fsync(destination.fileno())
    except Exception:
        # Remove only the new, incomplete file created by this invocation.
        output.unlink(missing_ok=True)
        raise AuthorizationError("No se pudo guardar la credencial privada.") from None


def read_credentials(path):
    """Operator use only: return credentials in memory, never print them."""
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        if payload.get("type") == "inox_gmail_oauth_dpapi_v1":
            protected = base64.b64decode(payload["ciphertext"], validate=True)
            payload = json.loads(windows_protect(protected, decrypt=True).decode("utf-8"))
        if payload.get("type") != "authorized_user" or payload.get("scopes") != [SEND_SCOPE]:
            raise ValueError
        if not all(payload.get(key) for key in ("client_id", "client_secret", "refresh_token")):
            raise ValueError
        return payload
    except Exception:
        raise AuthorizationError("No se pudo abrir una credencial privada valida.") from None


def run(args):
    output = private_output(args.output)
    client = read_client(args.client_file)
    sender = args.sender.strip().lower()
    if "@" not in sender or any(character.isspace() for character in sender):
        raise AuthorizationError("Indica el correo remitente que el propietario autorizara en Google.")
    restrict_directory(output.parent)
    state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(64)
    with CallbackServer(state) as server:
        redirect_uri = f"http://{server.expected_host}{CALLBACK_PATH}"
        print("El propietario debe abrir esta URL y consentir personalmente en Google. Tiempo: 5 minutos.", flush=True)
        print(authorization_url(client["client_id"], redirect_uri, state, verifier, sender), flush=True)
        deadline = time.monotonic() + WAIT_SECONDS
        while server.result is None and time.monotonic() < deadline:
            server.timeout = min(1, max(0.01, deadline - time.monotonic()))
            server.handle_request()
        if server.result is None:
            raise AuthorizationError("La espera de autorizacion vencio; no se guardo ninguna credencial.")
        if server.result != "accepted":
            raise AuthorizationError("No se autorizo exclusivamente el permiso gmail.send.")
        credentials = exchange_code(client, server.code, redirect_uri, verifier, sender)
    save_credentials(output, credentials)
    print("Credencial privada guardada en la ruta solicitada. No se modifico el servidor ni se enviaron correos.", flush=True)
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client-file", required=True, help="JSON Desktop descargado desde Google Cloud.")
    parser.add_argument("--sender", required=True, help="Remitente que el propietario debe elegir en Google.")
    parser.add_argument("--output", required=True, help="Archivo JSON nuevo bajo .work/subcarpeta/.")
    args = parser.parse_args(argv)
    try:
        return run(args)
    except AuthorizationError as error:
        print(str(error), file=sys.stderr)
    except KeyboardInterrupt:
        print("Autorizacion cancelada.", file=sys.stderr)
    except Exception:
        print("No se pudo completar la autorizacion privada. No se modifico la configuracion del servidor.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
