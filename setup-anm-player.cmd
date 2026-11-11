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
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$uvVersion = '0.13.7'
$bootstrapUrl = 'https://raw.githubusercontent.com/qa-p1/anm-player/v1.0.0/scripts/bootstrap.py'
$root = if ($env:ANM_INSTALL_ROOT) { $env:ANM_INSTALL_ROOT } else { Join-Path $env:LOCALAPPDATA 'ANMPlayer' }
$root = [IO.Path]::GetFullPath($root)
$uvDirectory = Join-Path $root 'tools\uv'
New-Item -ItemType Directory -Force -Path $uvDirectory | Out-Null
$stage = Join-Path $root ('.setup-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
$env:ANM_INSTALL_ROOT = $root
$env:UV_PYTHON_INSTALL_DIR = Join-Path $root 'tools\python'
$env:UV_PYTHON_BIN_DIR = Join-Path $root 'tools\python-bin'
$env:UV_PYTHON_INSTALL_BIN = '0'
$env:UV_CACHE_DIR = Join-Path $root 'tools\cache'
$env:UV_NO_MODIFY_PATH = '1'
try {
    Write-Host "`nANM Player setup`nYour music and settings will live in: $root`n"
    $uv = Join-Path $uvDirectory 'uv.exe'
    if (-not (Test-Path -LiteralPath $uv)) {
        $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'aarch64' } elseif ($env:PROCESSOR_ARCHITECTURE -eq 'AMD64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'AMD64') { 'x86_64' } else { throw 'Automatic setup needs 64-bit Windows.' }
        $archive = "uv-$arch-pc-windows-msvc.zip"
        $url = "https://github.com/astral-sh/uv/releases/download/$uvVersion/$archive"
        Write-Host '[setup] Downloading the private Python manager...'
        $zip = Join-Path $stage 'uv.zip'
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip
        $hashFile = Join-Path $stage 'uv.sha256'
        Invoke-WebRequest -UseBasicParsing -Uri "$url.sha256" -OutFile $hashFile
        $expected = (Get-Content -Raw -LiteralPath $hashFile).Trim().Split()[0].ToLowerInvariant()
        $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($expected -notmatch '^[0-9a-f]{64}$' -or $actual -ne $expected) { throw 'Download integrity check failed. Run setup again to retry.' }
        Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $stage 'uv')
        $binary = @(Get-ChildItem -LiteralPath (Join-Path $stage 'uv') -Recurse -Filter 'uv.exe')
        if ($binary.Count -ne 1) { throw 'The Python manager archive was incomplete.' }
        Copy-Item -LiteralPath $binary[0].FullName -Destination $uv
    }
    $bootstrap = Join-Path $root 'bootstrap.py'
    if (-not (Test-Path -LiteralPath $bootstrap)) {
        $download = Join-Path $stage 'bootstrap.py'
        Invoke-WebRequest -UseBasicParsing -Uri $bootstrapUrl -OutFile $download
        Move-Item -LiteralPath $download -Destination $bootstrap
    }
    Write-Host '[setup] Preparing Python and the app. The first start takes a few minutes...'
    & $uv run --no-config --no-project --managed-python --python 3.13 $bootstrap --root $root
    if ($LASTEXITCODE -ne 0) { throw 'App setup did not finish. Run this file again to retry.' }
} catch {
    Write-Host "`n[setup] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
