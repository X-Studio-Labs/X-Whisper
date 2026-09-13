# X-Whisper — Engine Launcher
#
# Canonical way to start the Python engine in development. Guarantees
# the engine always runs under the managed Python 3.12 runtime at
# %APPDATA%\X-Whisper\runtime\python\, regardless of what Python is
# (or isn't) on the user's PATH.
#
# Usage:
#   .\run_engine.ps1                 # ensure runtime, launch engine
#   .\run_engine.ps1 -BootstrapOnly  # install runtime, then exit
#   .\run_engine.ps1 -Force          # re-download runtime from scratch

param(
    [switch]$BootstrapOnly,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$engineDir = Join-Path $projectRoot "python-engine"
$runtimeDir = Join-Path $env:APPDATA "X-Whisper\runtime\python"
$managedPython = Join-Path $runtimeDir "python.exe"
$requirementsFile = Join-Path $engineDir "requirements.txt"
$bootstrapScript = Join-Path $engineDir "bootstrap.ps1"

$needsBootstrap = $Force -or -not (Test-Path $managedPython)

if ($needsBootstrap) {
    Write-Host "[x-whisper] Managed Python runtime not found — bootstrapping…"
    $bootstrapArgs = @(
        "-RuntimeDir", $runtimeDir,
        "-RequirementsFile", $requirementsFile
    )
    if ($Force) { $bootstrapArgs += "-Force" }
    & powershell -ExecutionPolicy Bypass -File $bootstrapScript @bootstrapArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[x-whisper] Bootstrap failed (exit $LASTEXITCODE)." -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

if ($BootstrapOnly) {
    Write-Host "[x-whisper] Runtime ready at $managedPython."
    exit 0
}

$mainPy = Join-Path $engineDir "main.py"
Write-Host "[x-whisper] Launching engine: $managedPython $mainPy"
& $managedPython $mainPy
exit $LASTEXITCODE
