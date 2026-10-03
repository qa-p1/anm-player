@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

rem The shared launcher exits after background startup. Use --stop to shut down.
where py >nul 2>nul
if %errorlevel%==0 (
  py -3.13 -c "import sys" >nul 2>nul
  if !errorlevel!==0 (
    py -3.13 "%~dp0scripts\start_aura.py" %*
    exit /b !errorlevel!
  )
)

python "%~dp0scripts\start_aura.py" %*
exit /b %errorlevel%
