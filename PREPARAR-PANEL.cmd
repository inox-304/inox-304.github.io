@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missing
where uv >nul 2>nul
if errorlevel 1 goto missing
call npm ci
if errorlevel 1 goto failed
call npm run build:server
if errorlevel 1 goto failed
uv sync --project backend --locked
if errorlevel 1 goto failed
uv run --project backend python backend/manage.py migrate
if errorlevel 1 goto failed
uv run --project backend python backend/manage.py seed_catalog
if errorlevel 1 goto failed
echo.
echo Elige una cuenta existente o crea otro propietario.
echo Puedes conservar tu contrasena. El acceso por correo requiere CONFIGURAR-CORREO.cmd.
uv run --project backend python backend/manage.py setup_access
if errorlevel 1 goto failed
pause
exit /b
:missing
echo Necesitas Node.js 24 y uv con Python 3.13. Lee docs/PANEL-ADMINISTRACION.md.
:failed
echo Revisa el error. Los datos existentes no se sustituyen por el catalogo inicial.
pause
exit /b 1
