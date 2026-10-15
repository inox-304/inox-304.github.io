@echo off
setlocal
cd /d "%~dp0"
if not exist dist-server\index.html (
  echo Ejecuta PREPARAR-PANEL.cmd una vez antes de iniciar.
  pause
  exit /b 1
)
echo Web: http://127.0.0.1:8000/  Panel: http://127.0.0.1:8000/admin/
echo Esta ventana mantiene la prueba local. No es el alojamiento de Internet.
uv run --project backend python backend/manage.py migrate
if errorlevel 1 (pause & exit /b 1)
uv run --project backend python backend/manage.py setup_access --status
echo.
echo Para configurar tu cuenta abre CONFIGURAR-ACCESO.cmd.
echo Tambien puedes abrir el acceso con seis toques al logo del pie de pagina.
uv run --project backend python backend/manage.py runserver 127.0.0.1:8000
pause
