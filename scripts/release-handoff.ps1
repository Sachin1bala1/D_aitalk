param(
  [string]$Destination = "$env:USERPROFILE\Dev\Daitalk\daitalk-v2-handoff",
  [string]$CargoTargetDir = "$env:USERPROFILE\Dev\Daitalk\target",
  [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"

function Require-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name was not found on PATH."
  }
}

Require-Command powershell
if (-not $SkipNpmInstall) {
  Require-Command npm
}

$stageScript = Join-Path $PSScriptRoot "stage-release-workspace.ps1"
$manifestScript = Join-Path $PSScriptRoot "collect-packaging-machine-manifest.ps1"
$preflightScript = Join-Path $PSScriptRoot "windows-release-preflight.ps1"

$stagedPath = & $stageScript -Destination $Destination -Fresh | Select-Object -Last 1
if (-not $stagedPath) {
  throw "Unable to resolve staged destination after running stage-release-workspace.ps1"
}

$stagedPath = (Resolve-Path $stagedPath).Path

Push-Location $stagedPath
try {
  if (-not $SkipNpmInstall) {
    npm ci
  }

  & $manifestScript -RepoRoot $stagedPath -CargoTargetDir $CargoTargetDir
  & $preflightScript -RepoRoot $stagedPath -CargoTargetDir $CargoTargetDir -WriteReport
} finally {
  Pop-Location
}

$reportsDir = Join-Path $stagedPath "docs\release\reports"

Write-Host ""
Write-Host "Release handoff workspace ready:"
Write-Host "  Workspace:       $stagedPath"
Write-Host "  CargoTargetDir:  $CargoTargetDir"
Write-Host "  Reports:         $reportsDir"
Write-Host ""
Write-Host "Next steps on the packaging machine:"
Write-Host "  cd $stagedPath"
Write-Host ("  powershell -ExecutionPolicy Bypass -File .\scripts\windows-secure-build.ps1 -SkipLint -CargoTargetDir ""{0}""" -f $CargoTargetDir)
