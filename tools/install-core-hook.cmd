@echo off
setlocal
echo ------------------------------------------------------------
echo  whip_postals - install the hook in whip_core/html/index.html
echo  Manual only: no automatic process runs this.
echo ------------------------------------------------------------
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-core-hook.ps1" -Manual
echo.
pause
