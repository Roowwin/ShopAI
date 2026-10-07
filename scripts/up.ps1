#Requires -Version 5.1
# Starts the full Phase 1 stack: certs (auto) -> hosts entries -> compose up --wait -> verification.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$scripts = $PSScriptRoot
Set-Location (Split-Path $scripts -Parent)

if (-not (Test-Path '.\infra\nginx\certs\fullchain.pem')) {
    Write-Host 'TLS certs missing - generating...' -ForegroundColor Yellow
    & (Join-Path $scripts 'New-TlsCerts.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'cert generation failed' }
}
try { & (Join-Path $scripts 'Set-Hosts.ps1') *> $null } catch {
    Write-Warning 'hosts entries not set (needs admin) - run scripts\Set-Hosts.ps1 manually'
}

& docker compose up -d --wait
if ($LASTEXITCODE -ne 0) { throw 'docker compose up failed - inspect with: docker compose logs' }
& docker compose ps
& (Join-Path $scripts 'Test-Phase1.ps1')