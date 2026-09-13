# X-Whisper -- Managed Python Runtime Bootstrap
#
# Installs an isolated Python 3.12 embeddable distribution into the
# user's AppData so the engine runs under a known-good interpreter
# regardless of what Python (if any) is on PATH.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File bootstrap.ps1 `
#       [-RuntimeDir <path>] [-PythonVersion 3.12.8] [-Force]
#
# Exit codes:
#   0 - runtime ready
#   1 - download failed
#   2 - unzip / patch failed
#   3 - pip bootstrap failed
#   4 - baseline requirements install failed

param(
    [string]$RuntimeDir = (Join-Path $env:APPDATA "X-Whisper\runtime\python"),
    [string]$PythonVersion = "3.12.8",
    [string]$RequirementsFile = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # speeds up Invoke-WebRequest

function Write-Step($msg) { Write-Host "[bootstrap] $msg" }
function Write-Err($msg)  { Write-Host "[bootstrap] ERROR: $msg" -ForegroundColor Red }

# -- Idempotency -----------------------------------------------------
$pythonExe = Join-Path $RuntimeDir "python.exe"
if ((Test-Path $pythonExe) -and (-not $Force)) {
    Write-Step "Managed Python already present at $pythonExe - skipping download."
    # Still verify pip works; bootstrap it if it's missing.
    & $pythonExe -c "import pip" 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Step "Runtime healthy."
        exit 0
    }
    Write-Step "pip not bootstrapped yet; continuing to pip step."
} else {
    # -- Download embeddable zip -------------------------------------
    $zipUrl  = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
    $zipPath = Join-Path $env:TEMP "xwhisper-python-$PythonVersion.zip"

    Write-Step "Downloading Python $PythonVersion embeddable from $zipUrl"
    try {
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
    } catch {
        Write-Err "Failed to download Python embeddable: $_"
        exit 1
    }

    # -- Unpack ------------------------------------------------------
    Write-Step "Unpacking to $RuntimeDir"
    try {
        if (Test-Path $RuntimeDir) { Remove-Item -Recurse -Force $RuntimeDir }
        New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
        Expand-Archive -Path $zipPath -DestinationPath $RuntimeDir -Force
        Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Err "Unzip failed: $_"
        exit 2
    }

    # -- Patch ._pth to enable site-packages -------------------------
    # The embeddable distribution disables `import site` by default,
    # which prevents pip from finding installed packages. Easiest
    # fix: remove the ._pth file entirely so Python uses its normal
    # startup path (which honours site-packages next to python.exe).
    $pthFiles = Get-ChildItem -Path $RuntimeDir -Filter "python*._pth" -ErrorAction SilentlyContinue
    foreach ($p in $pthFiles) {
        Write-Step "Removing $($p.Name) to enable site-packages"
        Remove-Item $p.FullName -Force
    }
}

# -- Bootstrap pip via get-pip.py ------------------------------------
Write-Step "Bootstrapping pip"
$getPipPath = Join-Path $env:TEMP "xwhisper-get-pip.py"
try {
    Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $getPipPath -UseBasicParsing
} catch {
    Write-Err "Failed to download get-pip.py: $_"
    exit 3
}

& $pythonExe $getPipPath --no-warn-script-location
if ($LASTEXITCODE -ne 0) {
    Write-Err "get-pip.py exited $LASTEXITCODE"
    Remove-Item $getPipPath -Force -ErrorAction SilentlyContinue
    exit 3
}
Remove-Item $getPipPath -Force -ErrorAction SilentlyContinue

# -- Baseline requirements -------------------------------------------
if ($RequirementsFile -ne "" -and (Test-Path $RequirementsFile)) {
    Write-Step "Installing baseline requirements from $RequirementsFile"
    & $pythonExe -m pip install --upgrade --only-binary ":all:" -r $RequirementsFile
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Baseline requirements install exited $LASTEXITCODE"
        exit 4
    }
}

Write-Step "Managed runtime ready at $pythonExe"
exit 0
