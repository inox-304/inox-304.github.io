@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules (
  call npm ci
  if errorlevel 1 (pause & exit /b 1)
)
call npm run build:published
if errorlevel 1 (
  echo No se publico nada. Revisa el error anterior; la web en Internet sigue igual.
) else (
  echo Copia local preparada en dist. Para publicar, ejecuta Deploy to GitHub Pages en GitHub Actions.
)
pause
