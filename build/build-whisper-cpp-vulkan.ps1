# X-Whisper -- Build whisper.cpp with Vulkan backend from source
#
# Upstream ggerganov/whisper.cpp releases do NOT ship a Windows Vulkan
# binary -- they publish CPU, cuBLAS, and (recently) BLAS variants, but
# Vulkan has to be built locally. This script clones the tag, configures
# cmake with -DGGML_VULKAN=ON, builds Release, and lays the outputs down
# under `<repo>/binaries/whisper-cpp/vulkan/` so the runtime resolver
# can find them.
#
# Prereqs (install once, not scripted):
#   * Visual Studio 2022 with "Desktop development with C++" workload
#   * Vulkan SDK from https://vulkan.lunarg.com (sets VULKAN_SDK env)
#   * cmake >= 3.19 (bundled with VS installer or from cmake.org)
#   * git
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File build-whisper-cpp-vulkan.ps1 `
#       [-Version v1.8.4] [-Force] [-KeepSource]

param(
    [string]$Version = "v1.8.4",
    [switch]$Force,
    [switch]$KeepSource
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir
$DestDir   = Join-Path $RepoRoot "binaries\whisper-cpp\vulkan"
$WorkDir   = Join-Path $env:TEMP "xw-whisper-vulkan-build"
$SrcDir    = Join-Path $WorkDir "whisper.cpp"
$BuildDir  = Join-Path $SrcDir "build"

function Write-Step($msg) { Write-Host "[vulkan-build] $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "[vulkan-build] $msg" -ForegroundColor Yellow }

# --- Prereq checks -------------------------------------------------------

if (-not $env:VULKAN_SDK) {
    throw "VULKAN_SDK environment variable is not set. Install the LunarG Vulkan SDK from https://vulkan.lunarg.com and restart your shell."
}
if (-not (Test-Path $env:VULKAN_SDK)) {
    throw "VULKAN_SDK points at '$env:VULKAN_SDK' but that path does not exist."
}
Write-Step "Vulkan SDK: $env:VULKAN_SDK"

foreach ($tool in @("cmake", "git")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "$tool not found on PATH. Install it and retry."
    }
}

$exe = Join-Path $DestDir "whisper-cli.exe"
if ((Test-Path $exe) -and (-not $Force)) {
    Write-Step "Already built at $exe. Use -Force to rebuild."
    exit 0
}

# --- Fetch source --------------------------------------------------------

if (Test-Path $SrcDir) {
    Write-Step "Reusing existing checkout at $SrcDir"
} else {
    New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null
    Write-Step "Cloning ggerganov/whisper.cpp @ $Version ..."
    git clone --depth 1 --branch $Version https://github.com/ggerganov/whisper.cpp.git $SrcDir
}

# --- Configure + build ---------------------------------------------------

if (Test-Path $BuildDir) { Remove-Item -Recurse -Force $BuildDir }
New-Item -ItemType Directory -Path $BuildDir -Force | Out-Null

Write-Step "Configuring cmake (-DGGML_VULKAN=ON) ..."
cmake -S $SrcDir -B $BuildDir -DGGML_VULKAN=ON -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON
if ($LASTEXITCODE -ne 0) { throw "cmake configure failed" }

Write-Step "Building Release ..."
cmake --build $BuildDir --config Release --target whisper-cli -j
if ($LASTEXITCODE -ne 0) { throw "cmake build failed" }

# --- Stage outputs -------------------------------------------------------

# Release binaries land under build\bin\Release on MSVC multi-config.
$ReleaseBin = Join-Path $BuildDir "bin\Release"
if (-not (Test-Path $ReleaseBin)) {
    # Fallback for single-config generators.
    $ReleaseBin = Join-Path $BuildDir "bin"
}
if (-not (Test-Path (Join-Path $ReleaseBin "whisper-cli.exe"))) {
    throw "whisper-cli.exe not found in $ReleaseBin after build"
}

if (Test-Path $DestDir) { Remove-Item -Recurse -Force $DestDir }
New-Item -ItemType Directory -Path $DestDir -Force | Out-Null

Write-Step "Copying binaries to $DestDir"
# Copy the executable and every DLL it links against. Vulkan backend
# needs ggml-vulkan.dll, ggml.dll, whisper.dll, plus any shared runtime
# helpers the MSVC toolchain emitted.
Copy-Item (Join-Path $ReleaseBin "*.exe") $DestDir -Force
Copy-Item (Join-Path $ReleaseBin "*.dll") $DestDir -Force -ErrorAction SilentlyContinue

# --- Sanity check --------------------------------------------------------

if (-not (Test-Path $exe)) {
    throw "whisper-cli.exe missing from $DestDir after copy"
}

$ggmlVulkan = Join-Path $DestDir "ggml-vulkan.dll"
if (-not (Test-Path $ggmlVulkan)) {
    Write-Warn "ggml-vulkan.dll not present in $DestDir -- binary may fall back to CPU at runtime."
}

if (-not $KeepSource) {
    Write-Step "Cleaning source tree (pass -KeepSource to keep it)"
    Remove-Item -Recurse -Force $WorkDir -ErrorAction SilentlyContinue
}

Write-Step "Done. Vulkan runtime at $exe"
