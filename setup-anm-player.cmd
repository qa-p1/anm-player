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
# anything missing is installed with winget (or Chocolatey). Python also has a
# verified python.org installer fallback when neither package manager works.
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

# Windows PowerShell 5.1 turns redirected native stderr into a terminating error
# under Stop. A missing py -3.14 must not prevent trying an installed 3.13.
function Invoke-PythonProbe {
    param([string]$Executable, [string[]]$Arguments)
    $ErrorActionPreference = 'Continue'
    $PSNativeCommandUseErrorActionPreference = $false
    try {
        $output = & $Executable @Arguments 2>$null
        if ($LASTEXITCODE -eq 0 -and $output) { return ($output -join "`n").Trim() }
    } catch { }
    return $null
}

function Get-PythonCandidates {
    $candidates = @()
    $probe = "import sys, venv, ensurepip; ok=(3, 13) <= sys.version_info[:2] < (3, 15); print(sys.executable if ok else ''); sys.exit(not ok)"
    foreach ($launcher in @(Get-Command py -All -CommandType Application -ErrorAction SilentlyContinue)) {
        foreach ($flag in '-3.14', '-3.13') {
            $path = Invoke-PythonProbe -Executable $launcher.Source -Arguments @($flag, '-I', '-c', $probe)
            if ($path) { $candidates += $path }
        }
    }
    foreach ($name in 'python3.14', 'python3.13', 'python3', 'python') {
        foreach ($command in @(Get-Command $name -All -CommandType Application -ErrorAction SilentlyContinue)) { $candidates += $command.Source }
    }
    # Python need not be on PATH. PEP 514 records custom and all-user installs.
    foreach ($registry in 'HKCU:\Software\Python\PythonCore', 'HKLM:\Software\Python\PythonCore', 'HKLM:\Software\WOW6432Node\Python\PythonCore') {
        foreach ($key in @(Get-Item -Path "$registry\*\InstallPath" -ErrorAction SilentlyContinue)) {
            $executable = $key.GetValue('ExecutablePath')
            if ($executable) { $candidates += $executable }
            $directory = $key.GetValue('')
            if ($directory) { $candidates += Join-Path $directory 'python.exe' }
        }
    }
    foreach ($version in '314', '313') {
        foreach ($directory in @((Join-Path $env:LOCALAPPDATA 'Programs\Python'), $env:ProgramFiles, ${env:ProgramFiles(x86)}, ($env:SystemDrive + '\'))) {
            if ($directory) { $candidates += Join-Path $directory "Python$version\python.exe" }
        }
    }
    return $candidates
}

# Skip the Microsoft Store execution stub, but allow actual Store installations.
function Find-Python {
    $probe = "import sys, venv, ensurepip; ok=(3, 13) <= sys.version_info[:2] < (3, 15); print(sys.executable if ok else ''); sys.exit(not ok)"
    foreach ($candidate in @(Get-PythonCandidates | Select-Object -Unique)) {
        if (-not $candidate -or $candidate -like '*\Microsoft\WindowsApps\*' -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        $path = Invoke-PythonProbe -Executable $candidate -Arguments @('-I', '-c', $probe)
        if ($path -and (Test-Path -LiteralPath $path -PathType Leaf)) { return $path }
    }
    return $null
}

function Invoke-PythonPackageManager {
    param([string]$Executable, [string[]]$Arguments)
    $ErrorActionPreference = 'Continue'
    $PSNativeCommandUseErrorActionPreference = $false
    try { & $Executable @Arguments | Out-Host } catch { Write-Host "[setup] $Executable could not install Python; trying the next installer." }
}

function Install-OfficialPython {
    # SHA-256 values published at python.org/downloads/release/python-31410/.
    $architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    $suffix, $sha256 = switch ($architecture) {
        'ARM64' { 'arm64'; '5b9547e4edae2f6fb2fbfec5e26cf91b4ea191e3b07f7727d5a2c5c2cca93ed3' }
        'AMD64' { 'amd64'; '92480239264744fe0386a1bd8275786fefa126e3129e56a68e22b52c73329965' }
        'x86' { ''; 'c8f1a16db9afd76ca74b5f8e28eeaad408bca10894c9d080443bde83def3ed09' }
        default { throw "Unsupported Windows architecture: $architecture" }
    }
    $filename = 'python-3.14.10' + $(if ($suffix) { '-' + $suffix }) + '.exe'
    $installer = Join-Path $stage $filename
    Write-Host '[setup] Downloading the Python 3.14 installer from python.org...'
    Invoke-WebRequest -UseBasicParsing -Uri "https://www.python.org/ftp/python/3.14.10/$filename" -OutFile $installer
    if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ne $sha256) { throw 'The Python installer failed its integrity check. Please run setup again.' }
    $target = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python314'
    $process = Start-Process -FilePath $installer -ArgumentList @('/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_launcher=0', 'Include_test=0', 'Include_pip=1', ('TargetDir="' + $target + '"')) -Wait -PassThru
    if ($process.ExitCode -notin 0, 3010) { throw "The Python installer failed (exit $($process.ExitCode)). Run setup again to retry." }
}

function Get-OrInstallPython {
    $python = Find-Python
    if ($python) { return $python }
    Write-Host '[setup] Installing a supported Python for this computer...'
    foreach ($manager in 'winget', 'choco') {
        if (-not (Get-Command $manager -CommandType Application -ErrorAction SilentlyContinue)) { continue }
        if ($manager -eq 'winget') {
            Invoke-PythonPackageManager -Executable $manager -Arguments @('install', '--id', 'Python.Python.3.13', '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements')
        } else {
            Invoke-PythonPackageManager -Executable $manager -Arguments @('install', '-y', 'python313')
        }
        Update-SessionPath
        $python = Find-Python
        if ($python) { return $python }
    }
    Install-OfficialPython
    Update-SessionPath
    $python = Find-Python
    if (-not $python) { throw 'Python could not be set up. Install Python 3.13 or 3.14 from https://www.python.org/downloads/, then run this file again.' }
    return $python
}

try {
    Write-Host "`nANM Player setup`nYour music and settings will live in: $root`n"
    $python = Get-OrInstallPython
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
