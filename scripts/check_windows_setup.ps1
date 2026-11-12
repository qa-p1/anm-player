# Run with Windows PowerShell 5.1, the host used by the downloaded .cmd.
param([switch]$InstallFallback)
$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\setup-anm-player.cmd'))
$marker = '# POWERSHELL_PAYLOAD'
$payload = $source.Substring($source.IndexOf($marker) + $marker.Length)
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($payload, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
# Import the real functions without running setup or downloading the app.
foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
    . ([ScriptBlock]::Create($definition.Extent.Text))
}

function Assert-Equal($Actual, $Expected, [string]$Label) {
    if ($Actual -ne $Expected) { throw "${Label}: expected '$Expected', got '$Actual'" }
    Write-Host "PASS: $Label"
}

$temporary = Join-Path ([IO.Path]::GetTempPath()) ('anm-python-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
$originalPath = $env:Path
$originalLocal = $env:LOCALAPPDATA
$originalTarget = $env:ANM_TEST_PYTHON
try {
    $env:ANM_TEST_PYTHON = (& python -c 'import sys; print(sys.executable)').Trim()
    $launcher = Join-Path $temporary 'py.exe'
    Add-Type -TypeDefinition @'
using System;
public static class LauncherFixture {
    public static int Main(string[] args) {
        if (args[0] == "-3.13") {
            Console.WriteLine(Environment.GetEnvironmentVariable("ANM_TEST_PYTHON"));
            return 0;
        }
        if (args[0] == "--warning") {
            Console.Error.WriteLine("Harmless native warning");
            Console.WriteLine(Environment.GetEnvironmentVariable("ANM_TEST_PYTHON"));
            return 0;
        }
        Console.Error.WriteLine("No suitable Python runtime found");
        return 103;
    }
}
'@ -OutputAssembly $launcher -OutputType ConsoleApplication
    if ($PSVersionTable.PSVersion.Major -eq 5) {
        $failed = $false
        try { $ignored = & $launcher -3.14 2>$null } catch { $failed = $true }
        Assert-Equal $failed $true 'Reproduced the old PowerShell 5.1 failure'
    }
    Assert-Equal (Invoke-PythonProbe -Executable $launcher -Arguments @('-3.14')) $null 'Missing launcher runtime is nonfatal'
    Assert-Equal (Invoke-PythonProbe -Executable $launcher -Arguments @('--warning')) $env:ANM_TEST_PYTHON 'stderr on a successful probe is nonfatal'
    Assert-Equal $ErrorActionPreference 'Stop' 'Probe preserves error handling for real setup failures'

    $env:Path = "$temporary;$originalPath"
    Assert-Equal (Find-Python) $env:ANM_TEST_PYTHON 'Missing 3.14 continues to installed 3.13'

    # Exercise real validation with a newer/default executable before supported 3.13.
    $unsupported = Join-Path $temporary 'python315.cmd'
    [IO.File]::WriteAllText($unsupported, "@echo off`r`necho Unsupported Python 3.15 1>&2`r`nexit /b 1`r`n")
    $script:TestCandidates = @($unsupported, $env:ANM_TEST_PYTHON)
    function Get-PythonCandidates { return $script:TestCandidates }
    Assert-Equal (Find-Python) $env:ANM_TEST_PYTHON 'Unsupported default does not hide a compatible runtime'
    $script:TestCandidates = @($unsupported)
    Assert-Equal (Find-Python) $null 'Only unsupported runtimes requests installation'

    if ($InstallFallback) {
        # A real per-user Python installation, not a mocked download or process.
        $stage = $temporary
        Install-OfficialPython
        $installed = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python314\python.exe'
        $version = & $installed -I -c "import sys, venv, ensurepip; print('%d.%d' % sys.version_info[:2])"
        Assert-Equal $LASTEXITCODE 0 'Official Python installer runs successfully'
        Assert-Equal $version '3.14' 'Official fallback supplies Python with venv and pip'
    }

    # Orchestration tests use no package downloads and never modify system Python.
    function Find-Python { if ($script:Installed) { return $env:ANM_TEST_PYTHON }; return $null }
    function Update-SessionPath { }
    function Install-OfficialPython { $script:OfficialCalls++; $script:Installed = $true }
    function Get-Command { return $null }
    $script:Installed = $true
    $script:OfficialCalls = 0
    Assert-Equal (Get-OrInstallPython) $env:ANM_TEST_PYTHON 'Existing Python is reused'
    Assert-Equal $script:OfficialCalls 0 'Existing Python never downloads another runtime'
    $script:Installed = $false
    Assert-Equal (Get-OrInstallPython) $env:ANM_TEST_PYTHON 'No Python or package manager uses the official installer'
    Assert-Equal $script:OfficialCalls 1 'Official fallback runs once'

    function Get-Command { return @{ Source = 'fixture' } }
    $script:Managers = @()
    function Invoke-PythonPackageManager { param($Executable, $Arguments) $script:Managers += $Executable }
    $script:Installed = $false
    Assert-Equal (Get-OrInstallPython) $env:ANM_TEST_PYTHON 'Failed package managers still reach the official installer'
    Assert-Equal ($script:Managers -join ',') 'winget,choco' 'Both package managers are tried'
    Assert-Equal $script:OfficialCalls 2 'Broken package managers trigger the fallback'
    $script:Managers = @()
    function Invoke-PythonPackageManager { param($Executable, $Arguments) $script:Managers += $Executable; $script:Installed = $true }
    $script:Installed = $false
    Assert-Equal (Get-OrInstallPython) $env:ANM_TEST_PYTHON 'Successful package-manager install is discovered'
    Assert-Equal ($script:Managers -join ',') 'winget' 'Successful install stops further installers'
    Assert-Equal $script:OfficialCalls 2 'Successful package manager avoids a second runtime'
} finally {
    $env:Path = $originalPath
    $env:LOCALAPPDATA = $originalLocal
    $env:ANM_TEST_PYTHON = $originalTarget
    Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
}
