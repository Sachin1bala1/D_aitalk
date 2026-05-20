$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $PSScriptRoot
$devPort = 1420

function Stop-StaleDevServer {
  param(
    [int]$Port
  )

  $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $listeners) {
    return
  }

  foreach ($listener in $listeners) {
    try {
      $proc = Get-Process -Id $listener.OwningProcess -ErrorAction Stop
    } catch {
      continue
    }

    if ($proc.ProcessName -ne "node") {
      throw "Port $Port is already in use by process '$($proc.ProcessName)' (PID $($proc.Id)). Stop it manually before running tauri:dev."
    }

    Write-Host "Stopping stale Vite dev server on port $Port (PID $($proc.Id))..."
    Stop-Process -Id $proc.Id -Force
  }
}

Set-Location $workspace
Stop-StaleDevServer -Port $devPort
npx tauri dev
