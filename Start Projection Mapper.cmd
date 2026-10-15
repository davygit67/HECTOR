@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0runtime\node.exe" set "PATH=%~dp0runtime;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Extract the complete handoff folder first, including its runtime folder.
  echo For a source checkout without runtime, install Node.js 22.12 or newer.
  pause
  exit /b 1
)
node "host\windows-app.mjs" start
set "PM_RESULT=%ERRORLEVEL%"
if "%PM_RESULT%"=="0" start "" "http://127.0.0.1:5173/"
if not "%PM_RESULT%"=="0" pause
exit /b %PM_RESULT%
