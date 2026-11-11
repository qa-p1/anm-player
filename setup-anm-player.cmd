@echo off
setlocal DisableDelayedExpansion
set "ANM_SETUP_FILE=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $text=[IO.File]::ReadAllText($env:ANM_SETUP_FILE); $marker=[char]35+' POWERSHELL_PAYLOAD'; & ([ScriptBlock]::Create($text.Substring($text.IndexOf($marker)+$marker.Length)))"
if errorlevel 1 (
  echo.
  echo Setup could not finish. Your music and settings have been kept.
  echo Read the message above, then double-click this file to retry.
  pause
  exit /b 1
)
exit /b 0
# POWERSHELL_PAYLOAD
# ANM Player setup for Windows. Uses this computer's Python, Node.js and FFmpeg;
# anything missing is installed with winget (or Chocolatey).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$bootstrapUrl = 'https://raw.githubusercontent.com/qa-p1/anm-player/main/scripts/bootstrap.py'
$root = if ($env:ANM_INSTALL_ROOT) { $env:ANM_INSTALL_ROOT } else { Join-Path $env:LOCALAPPDATA 'ANMPlayer' }
$root = [IO.Path]::GetFullPath($root)
New-Item -ItemType Directory -Force -Path $root | Out-Null
$stage = Join-Path $root ('.setup-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null

function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = (@($machine, $user, $env:Path) | Where-Object { $_ }) -join ';'
}

# A supported Python (3.13 or 3.14). The Microsoft Store "python" stub is skipped.
function Find-Python {
    $candidates = @()
    if (Get-Command py -ErrorAction SilentlyContinue) {
        foreach ($flag in '-3.14', '-3.13') {
            $path = & py $flag -c 'import sys; print(sys.executable)' 2>$null
            if ($LASTEXITCODE -eq 0 -and $path) { $candidates += $path.Trim() }
        }
    }
    foreach ($name in 'python3.14', 'python3.13', 'python') {
        foreach ($command in @(Get-Command $name -All -ErrorAction SilentlyContinue)) { $candidates += $command.Source }
    }
    foreach ($version in '314', '313') { $candidates += Join-Path $env:LOCALAPPDATA "Programs\Python\Python$version\python.exe" }
    foreach ($candidate in $candidates) {
        if (-not $candidate -or $candidate -like '*\WindowsApps\*' -or -not (Test-Path -LiteralPath $candidate)) { continue }
        & $candidate -c 'import sys, venv; sys.exit(not (3, 13) <= sys.version_info[:2] < (3, 15))' 2>$null
        if ($LASTEXITCODE -eq 0) { return $candidate }
    }
    return $null
}

try {
    Write-Host "`nANM Player setup`nYour music and settings will live in: $root`n"
    $python = Find-Python
    if (-not $python) {
        Write-Host '[setup] Installing Python 3.13 for this computer...'
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            winget install --id Python.Python.3.13 --exact --silent --accept-package-agreements --accept-source-agreements
        } elseif (Get-Command choco -ErrorAction SilentlyContinue) {
            choco install -y python313
        } else {
            throw 'Install Python 3.13 from https://www.python.org/downloads/ (or the App Installer for winget), then run this file again.'
        }
        Update-SessionPath
        $python = Find-Python
        if (-not $python) { throw 'Python 3.13 could not be set up. Install it from https://www.python.org/downloads/, then run this file again.' }
    }
    Write-Host "[setup] Using $python"
    $download = Join-Path $stage 'bootstrap.py'
    Invoke-WebRequest -UseBasicParsing -Uri $bootstrapUrl -OutFile $download
    Move-Item -Force -LiteralPath $download -Destination (Join-Path $root 'bootstrap.py')
    Write-Host '[setup] Preparing ANM Player. The first start takes a few minutes...'
    & $python (Join-Path $root 'bootstrap.py') --root $root
    if ($LASTEXITCODE -ne 0) { throw 'App setup did not finish. Run this file again to retry.' }
} catch {
    Write-Host "`n[setup] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
