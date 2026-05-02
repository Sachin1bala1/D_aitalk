param(
  [string]$CargoTargetDir = "$env:LOCALAPPDATA\Daitalk\target"
)

$ErrorActionPreference = "Stop"

if (-not $env:WINDOWS_SIGN_CERT_SHA1) {
  throw "WINDOWS_SIGN_CERT_SHA1 is required."
}

$signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
if (-not $signtool) {
  throw "signtool.exe was not found on PATH."
}

$bundleDir = Join-Path $CargoTargetDir "release\bundle"
if (-not (Test-Path $bundleDir)) {
  throw "Bundle directory not found: $bundleDir"
}

$files = Get-ChildItem -Path $bundleDir -Recurse -File | Where-Object {
  $_.Extension -in ".exe", ".msi"
}

if (-not $files) {
  throw "No .exe or .msi artifacts found under $bundleDir"
}

foreach ($file in $files) {
  Write-Host "Signing $($file.FullName)"
  & $signtool.Source sign /sha1 $env:WINDOWS_SIGN_CERT_SHA1 /tr http://timestamp.digicert.com /td sha256 /fd sha256 $file.FullName
}
