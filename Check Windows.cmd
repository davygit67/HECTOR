@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0runtime\node.exe" set "PATH=%~dp0runtime;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.12 or newer, then reopen this launcher.
  pause
  exit /b 1
)
node "host\windows-app.mjs" check
set "PM_RESULT=%ERRORLEVEL%"
pause
exit /b %PM_RESULT%
