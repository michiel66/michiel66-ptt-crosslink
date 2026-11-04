@echo off
chcp 65001 > nul
cd /d "%~dp0"
where py >nul 2>&1
if %errorlevel% equ 0 (set "PY=py -3") else (set "PY=python")
echo Installeer PTT-Crosslink in .venv...
%PY% -m venv .venv
if errorlevel 1 goto :error
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto :error
echo.
echo GEREED. Dubbelklik op START_CROSSLINK.bat
pause
exit /b 0
:error
echo Installatie mislukt. Installeer Python 3.11 of 3.12 (64-bit) vanaf python.org.
pause
exit /b 1
