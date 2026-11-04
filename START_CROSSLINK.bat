@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\pythonw.exe" (
 echo Eerst INSTALLEREN.bat uitvoeren.
 pause
 exit /b 1
)
start "PTT-Crosslink" ".venv\Scripts\pythonw.exe" app.py
