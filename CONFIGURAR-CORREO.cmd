@echo off
setlocal
cd /d "%~dp0"
where uv >nul 2>nul
if errorlevel 1 goto missing
uv run --project backend python scripts/configure-mail.py
if errorlevel 1 goto failed
echo Reinicia INICIAR-PANEL.cmd para aplicar la configuracion.
pause
exit /b 0
:missing
echo Instala uv y Python 3.13. Lee docs/PANEL-ADMINISTRACION.md.
:failed
echo No se activo el envio. Revisa la indicacion anterior.
pause
exit /b 1
