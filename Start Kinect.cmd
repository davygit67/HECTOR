@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0runtime\node.exe" set "PATH=%~dp0runtime;%PATH%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0sensor-helper\scripts\Start-Kinect.ps1"
pause
