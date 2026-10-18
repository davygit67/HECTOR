@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0runtime\node.exe" set "PATH=%~dp0runtime;%PATH%"
node host\rtabmap-export.mjs %*
pause
