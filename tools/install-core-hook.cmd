@echo off
setlocal
echo ------------------------------------------------------------
echo  whip_postals - installa l'hook in whip_core/html/index.html
echo  Manuale: nessun processo automatico lo esegue.
echo ------------------------------------------------------------
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-core-hook.ps1" -Manual
echo.
pause
