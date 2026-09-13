# X-Whisper -- Fetch prebuilt whisper.cpp binaries
#
# Downloads the release zips from ggerganov/whisper.cpp and lays them
# out under `<repo>/binaries/whisper-cpp/{cuda,cpu}/`. The provider
# (`python-engine/whisper_cpp_runtime.py`) looks in these folders at
# runtime.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File fetch-whisper-cpp.ps1 `
#       [-Version v1.8.4] [-Force]
#
# Called manually by devs; the release build will call this from CI.

param(
    [string]$Version = "v1.8.4",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir
$DestRoot  = Join-Path $RepoRoot "binaries\whisper-cpp"

function Write-Step($msg) { Write-Host "[whisper.cpp] $msg" -ForegroundColor Cyan }

# (Backend folder name, release asset) pairs. Keep sizes honest in
# comments so devs know what they're pulling.
$Flavors = @(
    @{ Backend = "cpu";  Asset = "whisper-bin-x64.zip" },                 # ~4 MB
    @{ Backend = "cuda"; Asset = "whisper-cublas-12.4.0-bin-x64.zip" }    # ~436 MB
)

foreach ($flavor in $Flavors) {
    $dest = Join-Path $DestRoot $flavor.Backend
    $exe  = Join-Path $dest "whisper-cli.exe"

    if ((Test-Path $exe) -and (-not $Force)) {
        Write-Step "$($flavor.Backend): already present -- skipping (use -Force to re-fetch)"
        continue
    }

    $url = "https://github.com/ggerganov/whisper.cpp/releases/download/$Version/$($flavor.Asset)"
    $zip = Join-Path $env:TEMP "xw-$($flavor.Asset)"

    Write-Step "$($flavor.Backend): downloading $($flavor.Asset) ..."
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

    Write-Step "$($flavor.Backend): extracting to $dest"
    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    New-Item -ItemType Directory -Path $dest -Force | Out-Null

    $staging = Join-Path $env:TEMP "xw-$($flavor.Backend)-stage"
    if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
    Expand-Archive -Path $zip -DestinationPath $staging -Force

    # The release zips nest everything in a `Release\` folder; flatten
    # so `whisper-cli.exe` sits directly under `binaries/whisper-cpp/<backend>/`.
    $releaseDir = Join-Path $staging "Release"
    $sourceDir  = if (Test-Path $releaseDir) { $releaseDir } else { $staging }
    Get-ChildItem -Path $sourceDir | Move-Item -Destination $dest -Force
    Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue

    # Releases before v1.8 shipped `main.exe`; v1.8+ ships both
    # `main.exe` and `whisper-cli.exe`. Normalize to `whisper-cli.exe`
    # so the provider does not need to branch on version.
    if (-not (Test-Path $exe)) {
        $fallback = Join-Path $dest "main.exe"
        if (Test-Path $fallback) {
            Copy-Item $fallback $exe
            Write-Step "$($flavor.Backend): aliased main.exe -> whisper-cli.exe"
        } else {
            throw "Neither whisper-cli.exe nor main.exe found in $dest"
        }
    }

    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    Write-Step "$($flavor.Backend): ready at $exe"
}

Write-Step "Done. Binaries at $DestRoot"
