@echo off
setlocal
cd /d "%~dp0"
where git >nul 2>&1
if errorlevel 1 (
  echo FOUT: Git ontbreekt. Installeer Git for Windows en voer dit script opnieuw uit.
  pause
  exit /b 1
)
set "GIT_URL=https://github.com/michiel66/michiel66-ptt-crosslink.git"
set "WORK=%TEMP%\PTT-Crosslink-v02-Upload"
if exist "%WORK%" rmdir /s /q "%WORK%"
echo PTT-Crosslink v0.2 naar GitHub uploaden...
git clone "%GIT_URL%" "%WORK%"
if errorlevel 1 goto fail
copy /y "main.cjs" "%WORK%\" >nul
copy /y "preload.cjs" "%WORK%\" >nul
copy /y "package.json" "%WORK%\" >nul
copy /y "README.md" "%WORK%\" >nul
copy /y "tts_windows.ps1" "%WORK%\" >nul
copy /y ".gitignore" "%WORK%\" >nul
if not exist "%WORK%\bridge" mkdir "%WORK%\bridge"
if not exist "%WORK%\ui" mkdir "%WORK%\ui"
if not exist "%WORK%\tests" mkdir "%WORK%\tests"
if not exist "%WORK%\.github\workflows" mkdir "%WORK%\.github\workflows"
copy /y "bridge\*.cjs" "%WORK%\bridge\" >nul
copy /y "ui\*.*" "%WORK%\ui\" >nul
copy /y "tests\*.test.cjs" "%WORK%\tests\" >nul
copy /y ".github\workflows\windows-direct-v02.yml" "%WORK%\.github\workflows\" >nul
pushd "%WORK%"
git add README.md main.cjs preload.cjs package.json tts_windows.ps1 .gitignore bridge ui tests .github/workflows/windows-direct-v02.yml
git commit -m "PTT-Crosslink v0.2: directe TS3 Opus crosslink en Windows app"
if errorlevel 1 (
 echo Geen wijzigingen om te uploaden, of commit niet mogelijk.
 popd
 pause
 exit /b 1
)
git push origin main
if errorlevel 1 (
 echo GitHub push geweigerd. Controleer GitHub login en schrijfrechten.
 popd
 pause
 exit /b 1
)
popd
echo.
echo GEREED. Bekijk Actions op GitHub:
echo https://github.com/michiel66/michiel66-ptt-crosslink/actions
pause
exit /b 0
:fail
echo Git clone is mislukt.
pause
exit /b 1
