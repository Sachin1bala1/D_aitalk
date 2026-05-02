param(
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$CargoTargetDir = "$env:LOCALAPPDATA\Daitalk\target",
  [switch]$RequireBundleArtifacts,
  [switch]$WriteReport,
  [string]$ReportPath
)

$ErrorActionPreference = "Stop"

function Test-CommandAvailable {
  param([string]$Name)

  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Write-CheckResult {
  param(
    [string]$Label,
    [bool]$Passed,
    [string]$Detail
  )

  $status = if ($Passed) { "PASS" } else { "WARN" }
  Write-Host ("[{0}] {1}: {2}" -f $status, $Label, $Detail)
}

function Add-ReportLine {
  param(
    [System.Collections.Generic.List[string]]$Lines,
    [string]$Label,
    [bool]$Passed,
    [string]$Detail
  )

  $status = if ($Passed) { "PASS" } else { "WARN" }
  $Lines.Add(("- [{0}] **{1}**: {2}" -f $status, $Label, $Detail)) | Out-Null
}

$docsRoot = Join-Path $RepoRoot "docs\release"
$bundleDir = Join-Path $CargoTargetDir "release\bundle"
$requiredDocs = @(
  "README.md",
  "microsoft-store-msix.md",
  "release-execution-runbook.md",
  "partner-center-submission-checklist.md",
  "privacy-disclosure-checklist.md",
  "windows-install-lifecycle-checklist.md",
  "windows-signing-notes.md",
  "validation-report-template.md"
)
$reportLines = [System.Collections.Generic.List[string]]::new()
$warnCount = 0

Write-Host "Windows release preflight"
Write-Host "RepoRoot=$RepoRoot"
Write-Host "CargoTargetDir=$CargoTargetDir"
$reportLines.Add("# Windows Release Preflight Report") | Out-Null
$reportLines.Add("") | Out-Null
$reportLines.Add(("- Generated: {0}" -f (Get-Date -Format s))) | Out-Null
$reportLines.Add(("- RepoRoot: {0}" -f $RepoRoot)) | Out-Null
$reportLines.Add(("- CargoTargetDir: {0}" -f $CargoTargetDir)) | Out-Null
$reportLines.Add("") | Out-Null

$repoExists = Test-Path $RepoRoot
if (-not $repoExists) {
  throw "Repo root does not exist: $RepoRoot"
}

Write-CheckResult -Label "Workspace path" -Passed $true -Detail $RepoRoot
Add-ReportLine -Lines $reportLines -Label "Workspace path" -Passed $true -Detail $RepoRoot

$oneDrivePath = $RepoRoot -match "OneDrive"
if ($oneDrivePath) {
  $oneDriveDetail = "Workspace is under OneDrive; release packaging should run from a non-synced path."
} else {
  $oneDriveDetail = "Workspace is not under OneDrive."
}
Write-CheckResult -Label "OneDrive workspace" -Passed (-not $oneDrivePath) -Detail $oneDriveDetail
Add-ReportLine -Lines $reportLines -Label "OneDrive workspace" -Passed (-not $oneDrivePath) -Detail $oneDriveDetail
if ($oneDrivePath) { $warnCount++ }

foreach ($doc in $requiredDocs) {
  $docPath = Join-Path $docsRoot $doc
  $passed = Test-Path $docPath
  Write-CheckResult -Label "Doc $doc" -Passed $passed -Detail $docPath
  Add-ReportLine -Lines $reportLines -Label "Doc $doc" -Passed $passed -Detail $docPath
  if (-not $passed) { $warnCount++ }
}

$cargoPresent = Test-CommandAvailable -Name "cargo"
$npmPresent = Test-CommandAvailable -Name "npm"
$signtoolPresent = Test-CommandAvailable -Name "signtool.exe"

Write-CheckResult -Label "cargo" -Passed $cargoPresent -Detail "Rust toolchain command availability"
Write-CheckResult -Label "npm" -Passed $npmPresent -Detail "Node package manager command availability"
Write-CheckResult -Label "signtool.exe" -Passed $signtoolPresent -Detail "Needed only for non-Store or explicit signing flows"
Add-ReportLine -Lines $reportLines -Label "cargo" -Passed $cargoPresent -Detail "Rust toolchain command availability"
Add-ReportLine -Lines $reportLines -Label "npm" -Passed $npmPresent -Detail "Node package manager command availability"
Add-ReportLine -Lines $reportLines -Label "signtool.exe" -Passed $signtoolPresent -Detail "Needed only for non-Store or explicit signing flows"
if (-not $cargoPresent) { $warnCount++ }
if (-not $npmPresent) { $warnCount++ }

$bundleExists = Test-Path $bundleDir
Write-CheckResult -Label "Bundle directory" -Passed $bundleExists -Detail $bundleDir
Add-ReportLine -Lines $reportLines -Label "Bundle directory" -Passed $bundleExists -Detail $bundleDir
if (-not $bundleExists) { $warnCount++ }

if ($bundleExists) {
  $artifacts = Get-ChildItem -Path $bundleDir -Recurse -File | Where-Object {
    $_.Extension -in ".msix", ".msixbundle", ".msi", ".exe"
  }

  if ($artifacts) {
    Write-CheckResult -Label "Bundle artifacts" -Passed $true -Detail ("Found {0} release artifact(s)" -f $artifacts.Count)
    Add-ReportLine -Lines $reportLines -Label "Bundle artifacts" -Passed $true -Detail ("Found {0} release artifact(s)" -f $artifacts.Count)
    $reportLines.Add("") | Out-Null
    $reportLines.Add("## Artifact list") | Out-Null
    $artifacts | ForEach-Object {
      Write-Host ("  - {0}" -f $_.FullName)
      $reportLines.Add(("- " + $_.FullName)) | Out-Null
    }
  } else {
    $passed = (-not $RequireBundleArtifacts)
    Write-CheckResult -Label "Bundle artifacts" -Passed $passed -Detail "No .msix/.msixbundle/.msi/.exe artifacts found yet"
    Add-ReportLine -Lines $reportLines -Label "Bundle artifacts" -Passed $passed -Detail "No .msix/.msixbundle/.msi/.exe artifacts found yet"
    if (-not $passed) { $warnCount++ }
  }
} elseif ($RequireBundleArtifacts) {
  Write-CheckResult -Label "Bundle directory required" -Passed $false -Detail "Build the release bundle before using -RequireBundleArtifacts."
  Add-ReportLine -Lines $reportLines -Label "Bundle directory required" -Passed $false -Detail "Build the release bundle before using -RequireBundleArtifacts."
  $warnCount++
}

$reportLines.Add("") | Out-Null
$reportLines.Add("## Summary") | Out-Null
$reportLines.Add(("- Warning count: {0}" -f $warnCount)) | Out-Null
$reportLines.Add("- Next action: Review warnings before packaging or submission.") | Out-Null

if ($WriteReport -or $ReportPath) {
  if (-not $ReportPath) {
    $reportsDir = Join-Path $docsRoot "reports"
    New-Item -ItemType Directory -Force -Path $reportsDir | Out-Null
    $ReportPath = Join-Path $reportsDir ("preflight-{0}.md" -f (Get-Date -Format "yyyy-MM-dd-HHmmss"))
  } else {
    $reportParent = Split-Path -Parent $ReportPath
    if ($reportParent) {
      New-Item -ItemType Directory -Force -Path $reportParent | Out-Null
    }
  }

  Set-Content -Path $ReportPath -Value ($reportLines -join [Environment]::NewLine) -Encoding UTF8
  Write-Host ("Preflight report written: {0}" -f $ReportPath)
}
