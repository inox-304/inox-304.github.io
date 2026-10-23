@echo off
setlocal
cd /d "%~dp0"
rem Reuse the preserved installation and its independent background launcher.
if not exist "CONTEXTO\PORTABLE.ps1" goto standard
if not exist "HERRAMIENTAS\python313\python.exe" goto standard
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0CONTEXTO\PORTABLE.ps1" -Mode start
if errorlevel 1 (pause & exit /b 1)
exit /b 0

:standard
if not exist dist-server\index.html (
  echo Ejecuta PREPARAR-PANEL.cmd una vez antes de iniciar.
  pause
  exit /b 1
)
echo Web: http://127.0.0.1:8000/  Panel: http://127.0.0.1:8000/admin/
echo Esta ventana mantiene la prueba local. No es el alojamiento de Internet.
echo.
echo Iniciar no modifica la base ni reconfigura las cuentas.
uv run --project backend python backend/manage.py runserver 127.0.0.1:8000 --noreload
pause
