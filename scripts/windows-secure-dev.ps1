param(
  [string]$CargoTargetDir = "$env:LOCALAPPDATA\Daitalk\target"
)

$ErrorActionPreference = "Stop"

if ($PWD.Path -match "OneDrive") {
  Write-Warning "This workspace is under OneDrive. For reliable Tauri builds, move it to a non-synced path like C:\Dev\Daitalk\daitalk-v2."
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  throw "cargo was not found on PATH."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm was not found on PATH."
}

New-Item -ItemType Directory -Force -Path $CargoTargetDir | Out-Null
$env:CARGO_TARGET_DIR = $CargoTargetDir

Write-Host "Using CARGO_TARGET_DIR=$env:CARGO_TARGET_DIR"
npm run tauri:dev
