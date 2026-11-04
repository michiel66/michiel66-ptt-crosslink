@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where git >nul 2>&1
if errorlevel 1 (
  echo Git voor Windows ontbreekt. Installeer Git eerst via https://git-scm.com/downloads/win
  pause
  exit /b 1
)
echo.
echo PTT-Crosslink naar https://github.com/michiel66/ptt-crosslink
 echo LET OP: maak die lege repository eerst aan op GitHub.
echo.
if not exist ".git" (
  git init
  if errorlevel 1 goto error
)
git branch -M main
if errorlevel 1 goto error
git add .
if errorlevel 1 goto error
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "PTT-Crosslink v0.1 met automatische Windows build"
  if errorlevel 1 goto error
)
git remote get-url origin >nul 2>&1
if errorlevel 1 (
  git remote add origin https://github.com/michiel66/ptt-crosslink.git
  if errorlevel 1 goto error
)
git push -u origin main
if errorlevel 1 goto error
echo.
echo GEREED. Open GitHub, tab Actions, voor ptt-crosslink-windows-x64.
pause
exit /b 0
:error
echo.
echo GitHub upload mislukt. Controleer of repository bestaat en of je bent ingelogd.
pause
exit /b 1
