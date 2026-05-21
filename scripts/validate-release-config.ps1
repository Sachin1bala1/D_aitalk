param(
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [ValidateSet("default", "store")][string]$ReleaseProfile = "default",
  [switch]$WriteReport,
  [string]$ReportPath
)

$ErrorActionPreference = "Stop"

function Write-Result {
  param(
    [string]$Status,
    [string]$Label,
    [string]$Detail
  )

  Write-Host ("[{0}] {1}: {2}" -f $Status, $Label, $Detail)
}

function Add-ReportLine {
  param(
    [System.Collections.Generic.List[string]]$Lines,
    [string]$Status,
    [string]$Label,
    [string]$Detail
  )

  $Lines.Add(("- [{0}] **{1}**: {2}" -f $Status, $Label, $Detail)) | Out-Null
}

function Test-PlaceholderValue {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $true
  }

  return $Value -match "example\.com|<|TBD|todo|placeholder|Owner Name|Replace with|final Microsoft Store short description"
}

$packageJsonPath = Join-Path $RepoRoot "package.json"
$tauriConfigPath = Join-Path $RepoRoot "src-tauri\tauri.conf.json"
$storeTauriConfigPath = Join-Path $RepoRoot "src-tauri\tauri.store.conf.json"
$releaseDocsRoot = Join-Path $RepoRoot "docs\release"
$storeMetadataPath = Join-Path $releaseDocsRoot "store-metadata.json"
$storeMetadataTemplatePath = Join-Path $releaseDocsRoot "store-metadata.template.json"
$validateWorkflowPath = Join-Path $RepoRoot ".github\workflows\validate.yml"
$windowsReleaseWorkflowPath = Join-Path $RepoRoot ".github\workflows\windows-release.yml"

$requiredDocs = @(
  "README.md",
  "microsoft-store-msix.md",
  "microsoft-store-signoff-checklist.md",
  "partner-center-submission-checklist.md",
  "privacy-disclosure-checklist.md",
  "store-submission-copy-pack.md",
  "packaging-handoff-guide.md"
)

$reportLines = [System.Collections.Generic.List[string]]::new()
$errorCount = 0
$warnCount = 0

if (-not (Test-Path $packageJsonPath)) {
  throw "Missing package.json at $packageJsonPath"
}

if (-not (Test-Path $tauriConfigPath)) {
  throw "Missing tauri.conf.json at $tauriConfigPath"
}

$package = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
$tauri = Get-Content $tauriConfigPath -Raw | ConvertFrom-Json
$validateWorkflowRaw = if (Test-Path $validateWorkflowPath) { Get-Content $validateWorkflowPath -Raw } else { "" }
$windowsReleaseWorkflowRaw = if (Test-Path $windowsReleaseWorkflowPath) { Get-Content $windowsReleaseWorkflowPath -Raw } else { "" }
$storeTauri = $null
if ((Test-Path $storeTauriConfigPath)) {
  $storeTauri = Get-Content $storeTauriConfigPath -Raw | ConvertFrom-Json
}

$prodCsp = if ($ReleaseProfile -eq "store" -and $storeTauri) {
  [string]$storeTauri.app.security.csp
} else {
  [string]$tauri.app.security.csp
}
$devCsp = [string]$tauri.app.security.devCsp
$prodScriptSrc = if ($prodCsp -match "script-src\s+([^;]+)") { $Matches[1] } else { "" }

$reportLines.Add("# Release Config Validation Report") | Out-Null
$reportLines.Add("") | Out-Null
$reportLines.Add(("- Generated: {0}" -f (Get-Date -Format s))) | Out-Null
$reportLines.Add(("- RepoRoot: {0}" -f $RepoRoot)) | Out-Null
$reportLines.Add(("- ReleaseProfile: {0}" -f $ReleaseProfile)) | Out-Null
$reportLines.Add("") | Out-Null

Write-Host "Release config validation"
Write-Host "RepoRoot=$RepoRoot"
Write-Host "ReleaseProfile=$ReleaseProfile"

function Check-Pass {
  param([string]$Label, [bool]$Passed, [string]$PassDetail, [string]$FailDetail)

  if ($Passed) {
    Write-Result -Status "PASS" -Label $Label -Detail $PassDetail
    Add-ReportLine -Lines $reportLines -Status "PASS" -Label $Label -Detail $PassDetail
  } else {
    Write-Result -Status "FAIL" -Label $Label -Detail $FailDetail
    Add-ReportLine -Lines $reportLines -Status "FAIL" -Label $Label -Detail $FailDetail
    $script:errorCount++
  }
}

function Check-Warn {
  param([string]$Label, [bool]$Passed, [string]$PassDetail, [string]$WarnDetail)

  if ($Passed) {
    Write-Result -Status "PASS" -Label $Label -Detail $PassDetail
    Add-ReportLine -Lines $reportLines -Status "PASS" -Label $Label -Detail $PassDetail
  } else {
    Write-Result -Status "WARN" -Label $Label -Detail $WarnDetail
    Add-ReportLine -Lines $reportLines -Status "WARN" -Label $Label -Detail $WarnDetail
    $script:warnCount++
  }
}

Check-Pass -Label "Package/Tauri version parity" `
  -Passed ($package.version -eq $tauri.version) `
  -PassDetail ("package.json and tauri.conf.json both use version {0}" -f $package.version) `
  -FailDetail ("package.json version {0} does not match tauri.conf.json version {1}" -f $package.version, $tauri.version)

Check-Pass -Label "Product identity" `
  -Passed (-not [string]::IsNullOrWhiteSpace([string]$tauri.productName) -and -not [string]::IsNullOrWhiteSpace([string]$tauri.identifier)) `
  -PassDetail ("productName={0}; identifier={1}" -f $tauri.productName, $tauri.identifier) `
  -FailDetail "Missing productName or identifier in tauri.conf.json"

Check-Pass -Label "Bundle active" `
  -Passed ([bool]$tauri.bundle.active) `
  -PassDetail "bundle.active is true" `
  -FailDetail "bundle.active must be true for release packaging"

Check-Pass -Label "Release scripts present" `
  -Passed ($package.scripts.'tauri:build:secure' -and $package.scripts.'tauri:build:store' -and $package.scripts.'tauri:build:ci') `
  -PassDetail "package.json defines tauri:build:secure, tauri:build:store, and tauri:build:ci" `
  -FailDetail "package.json is missing one or more required Windows release scripts"

Check-Pass -Label "Validation workflow runs frontend tests" `
  -Passed ($validateWorkflowRaw -match "npm test") `
  -PassDetail "validate.yml runs npm test" `
  -FailDetail "validate.yml must run npm test"

Check-Pass -Label "Validation workflow runs Rust tests" `
  -Passed ($validateWorkflowRaw -match "cargo test --lib") `
  -PassDetail "validate.yml runs cargo test --lib" `
  -FailDetail "validate.yml must run cargo test --lib"

Check-Pass -Label "Windows release workflow uses secure build path" `
  -Passed ($windowsReleaseWorkflowRaw -match "windows-secure-build\.ps1" -or $windowsReleaseWorkflowRaw -match "tauri:build:ci") `
  -PassDetail "windows-release.yml uses a defined release build path" `
  -FailDetail "windows-release.yml must call windows-secure-build.ps1 or a defined tauri:build:ci script"

Check-Pass -Label "Downgrade policy" `
  -Passed (-not [bool]$tauri.bundle.windows.allowDowngrades) `
  -PassDetail "allowDowngrades is false" `
  -FailDetail "allowDowngrades should be false for production releases"

$iconRelative = [string]$tauri.bundle.icon[0]
$iconPath = Join-Path (Join-Path $RepoRoot "src-tauri") $iconRelative
Check-Pass -Label "Primary Windows icon" `
  -Passed (Test-Path $iconPath) `
  -PassDetail $iconPath `
  -FailDetail ("Missing icon referenced by tauri.conf.json: {0}" -f $iconPath)

Check-Pass -Label "Production CSP present" `
  -Passed (-not [string]::IsNullOrWhiteSpace($prodCsp)) `
  -PassDetail "Production CSP is defined" `
  -FailDetail "Production CSP is empty or missing"

if ($ReleaseProfile -eq "store") {
  Check-Pass -Label "Store profile config present" `
    -Passed (Test-Path $storeTauriConfigPath) `
    -PassDetail $storeTauriConfigPath `
    -FailDetail ("Missing store config overlay: {0}" -f $storeTauriConfigPath)
}

Check-Pass -Label "Dev CSP present" `
  -Passed (-not [string]::IsNullOrWhiteSpace($devCsp)) `
  -PassDetail "Dev CSP is defined" `
  -FailDetail "Dev CSP is empty or missing"

Check-Pass -Label "No dev Vite endpoint in production CSP" `
  -Passed ($prodCsp -notmatch "localhost:1420|127\.0\.0\.1:1420|ws://localhost:1420|ws://127\.0\.0\.1:1420") `
  -PassDetail "Production CSP does not include Vite dev endpoints" `
  -FailDetail "Production CSP still includes Vite dev endpoints"

Check-Pass -Label "No wildcard in production connect-src" `
  -Passed ($prodCsp -notmatch "connect-src[^;]*\*") `
  -PassDetail "Production connect-src does not use wildcard hosts" `
  -FailDetail "Production connect-src contains wildcard hosts"

Check-Pass -Label "No unsafe script allowances in production CSP" `
  -Passed ($prodScriptSrc -notmatch "unsafe-inline|unsafe-eval") `
  -PassDetail "Production script-src is free of unsafe-inline/unsafe-eval" `
  -FailDetail "Production CSP allows unsafe-inline or unsafe-eval in scripts"

if ($ReleaseProfile -eq "store") {
  Check-Pass -Label "No local Ollama endpoints in Store CSP" `
    -Passed ($prodCsp -notmatch "127\.0\.0\.1:11434|localhost:11434") `
    -PassDetail "Store CSP excludes local Ollama endpoints" `
    -FailDetail "Store CSP still includes local Ollama endpoints"
} else {
  Check-Warn -Label "Local Ollama release decision" `
    -Passed ($prodCsp -notmatch "127\.0\.0\.1:11434|localhost:11434") `
    -PassDetail "Production CSP does not include local Ollama endpoints" `
    -WarnDetail "Production CSP still allows local Ollama endpoints; confirm this is intentional for non-Store release"
}

foreach ($doc in $requiredDocs) {
  $path = Join-Path $releaseDocsRoot $doc
  Check-Pass -Label "Release doc $doc" `
    -Passed (Test-Path $path) `
    -PassDetail $path `
    -FailDetail ("Missing required release doc: {0}" -f $path)
}

$storeMetadataExists = Test-Path $storeMetadataPath
if ($ReleaseProfile -eq "store") {
  Check-Pass -Label "Store metadata file" `
    -Passed $storeMetadataExists `
    -PassDetail $storeMetadataPath `
    -FailDetail ("Create {0} from {1} before final Store submission." -f $storeMetadataPath, $storeMetadataTemplatePath)
} else {
  Check-Warn -Label "Store metadata file" `
    -Passed $storeMetadataExists `
    -PassDetail $storeMetadataPath `
    -WarnDetail ("Create {0} from {1} before final submission." -f $storeMetadataPath, $storeMetadataTemplatePath)
}

if ($storeMetadataExists) {
  $storeMetadata = Get-Content $storeMetadataPath -Raw | ConvertFrom-Json
  $metadataChecks = @(
    @{ Label = "Store metadata supportUrl"; Value = [string]$storeMetadata.supportUrl },
    @{ Label = "Store metadata privacyPolicyUrl"; Value = [string]$storeMetadata.privacyPolicyUrl },
    @{ Label = "Store metadata publisherContactEmail"; Value = [string]$storeMetadata.publisherContactEmail },
    @{ Label = "Store metadata shortDescription"; Value = [string]$storeMetadata.shortDescription },
    @{ Label = "Store metadata category"; Value = [string]$storeMetadata.category }
  )

  foreach ($entry in $metadataChecks) {
    if ($ReleaseProfile -eq "store") {
      Check-Pass -Label $entry.Label `
        -Passed (-not (Test-PlaceholderValue -Value $entry.Value)) `
        -PassDetail $entry.Value `
        -FailDetail "Missing or placeholder value"
    } else {
      Check-Warn -Label $entry.Label `
        -Passed (-not (Test-PlaceholderValue -Value $entry.Value)) `
        -PassDetail $entry.Value `
        -WarnDetail "Missing or placeholder value"
    }
  }
}

$reportLines.Add("") | Out-Null
$reportLines.Add("## Summary") | Out-Null
$reportLines.Add(("- Error count: {0}" -f $errorCount)) | Out-Null
$reportLines.Add(("- Warning count: {0}" -f $warnCount)) | Out-Null

if ($WriteReport -or $ReportPath) {
  if (-not $ReportPath) {
    $reportsDir = Join-Path $releaseDocsRoot "reports"
    New-Item -ItemType Directory -Force -Path $reportsDir | Out-Null
    $ReportPath = Join-Path $reportsDir ("release-config-validation-{0}.md" -f (Get-Date -Format "yyyy-MM-dd-HHmmss"))
  } else {
    $parent = Split-Path -Parent $ReportPath
    if ($parent) {
      New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
  }

  Set-Content -Path $ReportPath -Value ($reportLines -join [Environment]::NewLine) -Encoding UTF8
  Write-Host ("Validation report written: {0}" -f $ReportPath)
}

if ($errorCount -gt 0) {
  throw "Release config validation failed with $errorCount error(s)."
}
