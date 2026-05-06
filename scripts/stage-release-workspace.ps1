param(
  [string]$Destination = "$env:USERPROFILE\Dev\Daitalk\daitalk-v2",
  [switch]$Overwrite,
  [switch]$Fresh
)

$ErrorActionPreference = "Stop"

function Require-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name was not found on PATH."
  }
}

Require-Command robocopy

function Get-UniqueDestination {
  param([string]$BasePath)

  $parent = Split-Path -Parent $BasePath
  $leaf = Split-Path -Leaf $BasePath
  $candidate = Join-Path $parent ("{0}-{1}" -f $leaf, (Get-Date -Format "yyyyMMdd-HHmmss"))
  $counter = 1

  while (Test-Path $candidate) {
    $candidate = Join-Path $parent ("{0}-{1}-{2}" -f $leaf, (Get-Date -Format "yyyyMMdd-HHmmss"), $counter)
    $counter++
  }

  return $candidate
}

$source = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$destinationRoot = Split-Path -Parent $Destination

if (-not (Test-Path $destinationRoot)) {
  New-Item -ItemType Directory -Force -Path $destinationRoot | Out-Null
}

if ((Test-Path $Destination) -and -not $Overwrite -and $Fresh) {
  $original = $Destination
  $Destination = Get-UniqueDestination -BasePath $Destination
  Write-Host "Destination already exists; using fresh staged path instead."
  Write-Host "  Requested: $original"
  Write-Host "  Fresh:     $Destination"
} elseif ((Test-Path $Destination) -and -not $Overwrite) {
  throw "Destination already exists: $Destination. Re-run with -Overwrite to replace staged files, or use -Fresh for a new sibling path."
}

if (Test-Path $Destination) {
  Write-Host "Removing existing staged workspace: $Destination"
  Remove-Item -Recurse -Force -LiteralPath $Destination
}

New-Item -ItemType Directory -Force -Path $Destination | Out-Null

$excludeDirs = @(
  "node_modules",
  "dist",
  ".cargo-target",
  ".git",
  ".vscode",
  "src-tauri\target"
)

$excludeFiles = @(
  "vite-dev.log"
)

$robocopyArgs = @(
  $source,
  $Destination,
  "/E",
  "/R:2",
  "/W:1",
  "/NFL",
  "/NDL",
  "/NJH",
  "/NJS",
  "/NP",
  "/XD"
) + $excludeDirs + @(
  "/XF"
) + $excludeFiles

Write-Host "Staging release workspace"
Write-Host "  Source:      $source"
Write-Host "  Destination: $Destination"

& robocopy @robocopyArgs | Out-Host
$exitCode = $LASTEXITCODE

if ($exitCode -ge 8) {
  throw "robocopy failed with exit code $exitCode"
}

Write-Host ""
Write-Host "Staged workspace ready:"
Write-Host "  $Destination"
Write-Host ""
Write-Host "Recommended next steps:"
Write-Host "  cd $Destination"
Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\windows-release-preflight.ps1"
Write-Host "  npm run tauri:build:secure"

$Destination
