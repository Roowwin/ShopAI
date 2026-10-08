#Requires -Version 5.1
<# RFO stack control: detach + self-managed health wait + idempotent init + verification.
   Replaces compose --wait (which fails on one-shot init containers that exit 0 by design). #>
[CmdletBinding()]
param([int]$TimeoutSeconds = 180)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location (Split-Path $PSScriptRoot -Parent)

$services = 'postgres','pgbouncer','redis','storage','nginx','api','worker','backoffice','storefront'

if (-not (Test-Path '.\infra\nginx\certs\fullchain.pem')) {
    Write-Host 'TLS certs missing - generating...' -ForegroundColor Yellow
    & (Join-Path $PSScriptRoot 'New-TlsCerts.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'cert generation failed' }
}
try { & (Join-Path $PSScriptRoot 'Set-Hosts.ps1') *> $null } catch {
    Write-Warning 'hosts entries not set (needs admin) - run scripts\Set-Hosts.ps1 manually'
}

& docker compose up -d --remove-orphans
if ($LASTEXITCODE -ne 0) { throw 'docker compose up failed - inspect with: docker compose logs' }

Write-Host "`nWaiting for healthy services (timeout ${TimeoutSeconds}s)..." -ForegroundColor Cyan
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$pending  = @($services)
while ($pending.Count -gt 0) {
    if ((Get-Date) -gt $deadline) {
        throw "health timeout - still not healthy: $($pending -join ', '). Inspect: docker compose logs <service>"
    }
    $stillPending = @()
    foreach ($s in $pending) {
        $id = (& docker compose ps -q $s) -join ''
        if ([string]::IsNullOrWhiteSpace($id)) { $stillPending += $s; continue }
        $health = (& docker inspect --format '{{.State.Health.Status}}' $id) -join ''
        if ($health -ne 'healthy') { $stillPending += $s }
    }
    $pending = $stillPending
    if ($pending.Count -gt 0) { Start-Sleep -Seconds 3 }
}
Write-Host '  ok      all services healthy' -ForegroundColor Green

& docker compose up -d --force-recreate nginx
$ndeadline = (Get-Date).AddSeconds(90)
do { Start-Sleep -Seconds 3; $nh = (& docker inspect rfo-nginx-1 --format '{{.State.Health.Status}}' 2>$null) -join '''' } while ($nh -ne 'healthy' -and (Get-Date) -lt $ndeadline)
if ($nh -ne 'healthy') { throw 'nginx unhealthy - paste docker compose logs nginx' }

& docker compose run --rm storage-init
if ($LASTEXITCODE -ne 0) { throw 'storage-init failed' }
Write-Host '  ok      storage initialized (bucket exists)' -ForegroundColor Green

& docker compose ps
& (Join-Path $PSScriptRoot 'Test-Phase1.ps1')
if ($LASTEXITCODE -ne 0) { throw 'verification failed - paste the FAIL lines' }
