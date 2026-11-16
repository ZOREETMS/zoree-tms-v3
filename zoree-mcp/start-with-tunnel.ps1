# ════════════════════════════════════════════════════════════════════
# start-with-tunnel.ps1 — run zoree-mcp on this PC behind a Cloudflare
# quick tunnel so Claude can reach it over HTTPS. For testing only.
#
# The tunnel (cloudflared) runs in its own minimized window and is left
# running when this window closes. Running this script again REUSES that
# tunnel, so the connector URL in Claude stays the same across server
# restarts. A new URL is only issued after a reboot or if you close the
# cloudflared window — then re-add the connector with the new URL.
# Production = fixed domain (README §4).
#
# Prereqs: the ZoreeTMS API running on :3010 (npm run dev at repo root)
#          and cloudflared.exe in zoree-mcp\bin (or on PATH).
# Run:     start-zoree-mcp.bat  (or: powershell -ExecutionPolicy Bypass -File start-with-tunnel.ps1)
# ════════════════════════════════════════════════════════════════════
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# First run: create .env from .env.example with a fresh random MCP_SECRET.
$envFile = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path $envFile)) {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $secret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  (Get-Content (Join-Path $PSScriptRoot '.env.example')) -replace '^MCP_SECRET=$', "MCP_SECRET=$secret" |
    Set-Content -Encoding ascii $envFile
  Write-Host 'Created zoree-mcp\.env with a new MCP_SECRET'
}

$port = if ($env:PORT) { $env:PORT } else { '3030' }
$log  = Join-Path $PSScriptRoot 'tunnel.log'
$urlPattern = 'https://[a-z0-9-]+\.trycloudflare\.com'

# Prefer the copy in zoree-mcp\bin, then fall back to cloudflared on PATH.
$cloudflared = Join-Path $PSScriptRoot 'bin\cloudflared.exe'
if (-not (Test-Path $cloudflared)) {
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if (-not $cmd) { throw 'cloudflared not found. Put cloudflared.exe in zoree-mcp\bin or run: winget install Cloudflare.cloudflared' }
  $cloudflared = $cmd.Source
}

function Get-TunnelUrl {
  if (-not (Test-Path $log)) { return $null }
  $m = Select-String -Path $log -Pattern $urlPattern | Select-Object -Last 1
  if ($m) { return $m.Matches[0].Value } else { return $null }
}

# Reuse a tunnel that is still running from an earlier start.
$running = Get-Process cloudflared -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -and ((Resolve-Path $_.Path).Path -eq (Resolve-Path $cloudflared).Path) }
$url = if ($running) { Get-TunnelUrl } else { $null }

if ($url) {
  Write-Host "Reusing the running tunnel (connector URL unchanged)."
} else {
  $running | Stop-Process -ErrorAction SilentlyContinue
  Remove-Item $log -ErrorAction SilentlyContinue
  Start-Process $cloudflared -ArgumentList "tunnel --url http://localhost:$port --logfile `"$log`"" `
    -WindowStyle Minimized | Out-Null
  for ($i = 0; $i -lt 60 -and -not $url; $i++) {
    Start-Sleep -Seconds 1
    $url = Get-TunnelUrl
  }
  if (-not $url) { throw 'cloudflared did not report a tunnel URL within 60 seconds (see tunnel.log)' }
  Write-Host "NEW tunnel URL - add or update the connector in Claude." -ForegroundColor Yellow
}

$env:PUBLIC_URL = $url
Write-Host ''
Write-Host "  Claude > Customize > Connectors > ZoreeTMS URL:" -ForegroundColor Cyan
Write-Host "  $url/mcp" -ForegroundColor Green
Write-Host ''

# --watch-path: code changes in src/ reload the server without touching the
# tunnel. The tunnel keeps running after this window closes (see header).
node --watch-path=src src/index.js
