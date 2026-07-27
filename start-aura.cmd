@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
  py -3.13 -c "import sys" >nul 2>nul
  if !errorlevel!==0 (
    py -3.13 scripts\start_aura.py %*
    exit /b !errorlevel!
  )
)

python scripts\start_aura.py %*
exit /b %errorlevel%
