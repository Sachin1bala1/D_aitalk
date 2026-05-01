param(
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$releaseDocsRoot = Join-Path $RepoRoot "docs\release"
$templatePath = Join-Path $releaseDocsRoot "store-metadata.template.json"
$targetPath = Join-Path $releaseDocsRoot "store-metadata.json"

if (-not (Test-Path $templatePath)) {
  throw "Missing template file: $templatePath"
}

if ((Test-Path $targetPath) -and -not $Force) {
  throw "Target already exists: $targetPath. Re-run with -Force to overwrite it."
}

Copy-Item -Path $templatePath -Destination $targetPath -Force

Write-Host "Store metadata file initialized:"
Write-Host "  $targetPath"
Write-Host ""
Write-Host "Next step:"
Write-Host "  Replace all placeholder values before running Store-profile validation."
