"""Configure Gmail SMTP locally without echoing, logging or committing credentials."""
import getpass
import os
from pathlib import Path
import re
import smtplib
import ssl
import sys
import tempfile


ENV_FILE = Path(__file__).resolve().parent.parent / 'backend' / '.env'


def save_settings(path, values):
    """Preserve unrelated settings; replace only mail settings, atomically."""
    original = path.read_text(encoding='utf-8') if path.exists() else ''
    lines = [line for line in original.splitlines()
             if line.split('=', 1)[0].strip() not in values]
    lines.extend(f'{key}={value}' for key, value in values.items())
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.mail-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8', newline='\n') as output:
            output.write('\n'.join(lines) + '\n')
        if os.name != 'nt':
            os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    print('Conectar Gmail para enviar los codigos de acceso al panel.')
    print('Necesitas una contrasena de aplicacion de Google, no la del panel ni la habitual de Gmail.')
    print('Creala en https://myaccount.google.com/apppasswords con la verificacion en dos pasos activa.')
    address = input('Gmail que enviara los codigos: ').strip().lower()
    if not re.fullmatch(r'[a-z0-9._%+-]+@(?:gmail|googlemail)\.com', address):
        print('Escribe una direccion personal de Gmail valida.')
        return 1
    # Refuse terminals that would fall back to displaying the secret.
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        try:
            password = getpass.getpass('Contrasena de aplicacion (entrada oculta): ').replace(' ', '')
        except getpass.GetPassWarning:
            print('Abre CONFIGURAR-CORREO.cmd en una terminal interactiva privada.')
            return 1
    if not re.fullmatch(r'[A-Za-z]{16}', password):
        print('La contrasena de aplicacion de Google debe tener 16 letras. No se guardo nada.')
        return 1
    try:
        with smtplib.SMTP('smtp.gmail.com', 587, timeout=15) as smtp:
            smtp.ehlo()
            smtp.starttls(context=ssl.create_default_context())
            smtp.ehlo()
            smtp.login(address, password)
    except (smtplib.SMTPException, OSError):
        print('Gmail no pudo autorizar la conexion. Revisa Internet, cuenta y contrasena de aplicacion. No se cambio la configuracion.')
        return 1
    save_settings(ENV_FILE, {
        'SECURITY_EMAIL_ENABLED': '1',
        'EMAIL_BACKEND': 'security.smtp_backend.EmailBackend',
        'EMAIL_HOST': 'smtp.gmail.com', 'EMAIL_PORT': '587',
        'EMAIL_USE_TLS': '1', 'EMAIL_USE_SSL': '0',
        'EMAIL_HOST_USER': address, 'EMAIL_HOST_PASSWORD': password,
        'DEFAULT_FROM_EMAIL': address,
    })
    print('Conexion autorizada. Configuracion guardada en backend/.env, excluida de Git.')
    print('No se envio ningun correo de prueba. Al iniciar sesion se enviara el codigo al usuario autorizado.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (KeyboardInterrupt, EOFError):
        print('\nConfiguracion cancelada.')
        sys.exit(1)
