@echo off
setlocal
cd /d "%~dp0"
where uv >nul 2>nul
if errorlevel 1 goto missing
uv run --project backend python backend/manage.py setup_access
if errorlevel 1 goto failed
echo.
echo La web local requiere INICIAR-PANEL.cmd. El panel aun no esta publicado en Internet.
pause
exit /b 0
:missing
echo Necesitas uv y Python 3.13. Ejecuta PREPARAR-PANEL.cmd primero.
:failed
echo Revisa la indicacion anterior. No se omite la verificacion de dos pasos.
pause
exit /b 1
