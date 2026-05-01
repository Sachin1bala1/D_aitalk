param(
  [string]$CargoTargetDir = "$env:LOCALAPPDATA\Daitalk\target",
  [switch]$SkipLint,
  [switch]$SkipNpmInstall,
  [switch]$Sign,
  [ValidateSet("default", "store")][string]$ReleaseProfile = "default"
)

$ErrorActionPreference = "Stop"

function Require-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name was not found on PATH."
  }
}

if ($PWD.Path -match "OneDrive") {
  Write-Warning "This workspace is under OneDrive. Signed release builds should run from a non-synced path like C:\Dev\Daitalk\daitalk-v2."
}

Require-Command cargo
Require-Command npm

New-Item -ItemType Directory -Force -Path $CargoTargetDir | Out-Null
$env:CARGO_TARGET_DIR = $CargoTargetDir

Write-Host "Using CARGO_TARGET_DIR=$env:CARGO_TARGET_DIR"

if (-not $SkipNpmInstall) {
  npm ci
}

if (-not $SkipLint) {
  npm run lint
}

if ($ReleaseProfile -eq "store") {
  Write-Host "Using Store release profile (src-tauri\\tauri.store.conf.json)"
  npm run tauri:build:store
} else {
  npm run tauri:build
}

if ($Sign) {
  & "$PSScriptRoot\sign-windows-artifacts.ps1" -CargoTargetDir $CargoTargetDir
}
