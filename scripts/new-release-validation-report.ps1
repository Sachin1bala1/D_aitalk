param(
  [Parameter(Mandatory = $true)]
  [string]$Version,
  [string]$OutputDir,
  [string]$TemplatePath,
  [string]$ReleaseOwner = "",
  [string]$InstallSource = "",
  [string]$WindowsVersion = "",
  [switch]$OpenReport
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputDir) {
  $OutputDir = Join-Path $repoRoot "docs\release\reports"
}

if (-not $TemplatePath) {
  $TemplatePath = Join-Path $repoRoot "docs\release\validation-report-template.md"
}

if (-not (Test-Path $TemplatePath)) {
  throw "Validation report template not found: $TemplatePath"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$dateStamp = Get-Date -Format "yyyy-MM-dd"
$fileName = "release-validation-$Version-$dateStamp.md"
$outputPath = Join-Path $OutputDir $fileName

$template = Get-Content $TemplatePath -Raw
$template = [regex]::Replace($template, '^\# Release Validation Report Template\s*', '', 'Singleline')
$header = @"
# Release Validation Report

- Generated: $(Get-Date -Format s)
- Version: $Version
- Release owner: $ReleaseOwner
- Install source: $InstallSource
- Windows version: $WindowsVersion

"@

Set-Content -Path $outputPath -Value ($header + $template) -Encoding UTF8
Write-Host "Created validation report: $outputPath"

if ($OpenReport) {
  Invoke-Item $outputPath
}
