# Fetch ffmpeg for Windows into binaries/ffmpeg/.
#
# We only need ffmpeg.exe — duration probing uses `ffmpeg -i <file>` and
# parses the stderr banner, saving ~180 MB by skipping ffprobe.exe.
# Source: gyan.dev release-essentials build (static, GPL, all audio codecs).

param(
    [string]$Version = "7.1"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$DestDir  = Join-Path $RepoRoot "binaries\ffmpeg"
$DestBin  = Join-Path $DestDir "ffmpeg.exe"

if (Test-Path $DestBin) {
    Write-Host "ffmpeg.exe already present at $DestBin — skipping fetch."
    exit 0
}

New-Item -ItemType Directory -Force -Path $DestDir | Out-Null

$Tmp = New-Item -ItemType Directory -Force -Path (Join-Path $env:TEMP "xw-ffmpeg-fetch")

# gyan.dev publishes versioned zips; use the "essentials" static build.
$Url = "https://github.com/GyanD/codexffmpeg/releases/download/$Version/ffmpeg-$Version-essentials_build.zip"
$Zip = Join-Path $Tmp "ffmpeg.zip"

Write-Host "Downloading ffmpeg $Version essentials build..."
Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing

Write-Host "Extracting..."
$Extract = Join-Path $Tmp "extract"
if (Test-Path $Extract) { Remove-Item -Recurse -Force $Extract }
Expand-Archive -Path $Zip -DestinationPath $Extract -Force

# Zip nests everything under ffmpeg-<ver>-essentials_build/bin/
$Inner = Get-ChildItem -Directory $Extract | Select-Object -First 1
$SrcBin = Join-Path $Inner.FullName "bin\ffmpeg.exe"

if (-not (Test-Path $SrcBin)) {
    throw "ffmpeg.exe not found in extracted archive at $SrcBin"
}

Copy-Item $SrcBin $DestBin -Force
Write-Host "ffmpeg.exe copied to $DestBin"

Remove-Item -Recurse -Force $Tmp
Write-Host "Done."
