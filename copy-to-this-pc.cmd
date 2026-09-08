@echo off
setlocal
rem Double-click this from the practice gold copy (the shared folder).
rem It copies Medicus Suite onto this PC and prints the Load unpacked path.
rem Do not Load unpacked from the share itself — Chrome and Edge drop it after a restart.

set "SCRIPT=%~dp0copy-to-this-pc.ps1"
if not exist "%SCRIPT%" (
    echo Could not find copy-to-this-pc.ps1 next to this file.
    echo Expected: %SCRIPT%
    pause
    exit /b 1
)

rem Optional first argument is the gold-copy folder. Default: this folder.
if "%~1"=="" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -Source "%~1"
)

set "ERR=%ERRORLEVEL%"
if not "%ERR%"=="0" (
    echo.
    echo Copy failed. See the message above.
    pause
    exit /b %ERR%
)

echo.
echo Folder to Load unpacked: %LOCALAPPDATA%\MedicusSuite
echo.
pause
endlocal
