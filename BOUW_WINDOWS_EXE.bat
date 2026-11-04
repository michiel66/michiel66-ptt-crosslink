@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
 echo Eerst INSTALLEREN.bat uitvoeren.
 pause
 exit /b 1
)
".venv\Scripts\python.exe" -m pip install pyinstaller
if errorlevel 1 goto :error
".venv\Scripts\python.exe" -m PyInstaller --noconfirm --clean --windowed --onefile --name "ptt-crosslink" --add-data "tts_windows.ps1;." app.py
if errorlevel 1 goto :error
echo GEREED. EXE staat in dist\ptt-crosslink.exe
pause
exit /b 0
:error
echo EXE bouw mislukt.
pause
exit /b 1
