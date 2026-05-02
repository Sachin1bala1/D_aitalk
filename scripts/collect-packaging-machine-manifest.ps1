param(
  [string]$RepoRoot = (Get-Location).Path,
  [string]$CargoTargetDir = "$env:USERPROFILE\Dev\Daitalk\target",
  [string]$OutputPath
)

$ErrorActionPreference = "Stop"

function Get-CommandVersion {
  param([string]$Name, [string[]]$Args = @("--version"))

  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) {
    return @{
      present = $false
      value = $null
    }
  }

  $output = (& $cmd.Source @Args 2>&1 | Select-Object -First 1)
  return @{
    present = $true
    value = [string]$output
  }
}

if (-not $OutputPath) {
  $reportsDir = Join-Path $RepoRoot "docs\release\reports"
  New-Item -ItemType Directory -Force -Path $reportsDir | Out-Null
  $OutputPath = Join-Path $reportsDir ("packaging-machine-manifest-{0}.md" -f (Get-Date -Format "yyyy-MM-dd-HHmmss"))
} else {
  $parent = Split-Path -Parent $OutputPath
  if ($parent) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
}

$os = Get-CimInstance Win32_OperatingSystem
$computer = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$memoryGb = [math]::Round(($computer.TotalPhysicalMemory / 1GB), 2)

$cargo = Get-CommandVersion "cargo"
$rustc = Get-CommandVersion "rustc"
$npm = Get-CommandVersion "npm"
$node = Get-CommandVersion "node"
$signtool = Get-CommandVersion "signtool.exe" @()

$content = @(
  "# Packaging Machine Manifest",
  "",
  "- Generated: $(Get-Date -Format s)",
  "- Computer name: $env:COMPUTERNAME",
  "- Current user: $env:USERNAME",
  "- RepoRoot: $RepoRoot",
  "- CargoTargetDir: $CargoTargetDir",
  "",
  "## Operating system",
  "",
  "- Caption: $($os.Caption)",
  "- Version: $($os.Version)",
  "- Build number: $($os.BuildNumber)",
  "- Architecture: $($os.OSArchitecture)",
  "",
  "## Hardware summary",
  "",
  "- Manufacturer: $($computer.Manufacturer)",
  "- Model: $($computer.Model)",
  "- CPU: $($cpu.Name)",
  "- Logical processors: $($cpu.NumberOfLogicalProcessors)",
  "- Memory (GB): $memoryGb",
  "",
  "## Toolchain",
  "",
  "- cargo present: $($cargo.present)",
  "- cargo version: $($cargo.value)",
  "- rustc present: $($rustc.present)",
  "- rustc version: $($rustc.value)",
  "- node present: $($node.present)",
  "- node version: $($node.value)",
  "- npm present: $($npm.present)",
  "- npm version: $($npm.value)",
  "- signtool present: $($signtool.present)",
  "- signtool version: $($signtool.value)",
  "",
  "## Path and policy notes",
  "",
  "- Repo under OneDrive: $([bool]($RepoRoot -match 'OneDrive'))",
  "- Target under OneDrive: $([bool]($CargoTargetDir -match 'OneDrive'))",
  "- Workspace should be outside OneDrive and other synced locations.",
  "- Packaging machine must allow Cargo-generated build-script executables to run without `os error 4551`.",
  "",
  "## Recommended verification",
  "",
  "1. Run powershell -ExecutionPolicy Bypass -File .\\scripts\\windows-release-preflight.ps1 -WriteReport",
  ("2. Run powershell -ExecutionPolicy Bypass -File .\\scripts\\windows-secure-build.ps1 -SkipLint -CargoTargetDir ""{0}""" -f $CargoTargetDir),
  "3. Attach this manifest to the release evidence bundle."
)

Set-Content -Path $OutputPath -Value ($content -join [Environment]::NewLine) -Encoding UTF8
Write-Host "Packaging machine manifest written: $OutputPath"
