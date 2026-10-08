#Requires -Version 5.1
<# RFO restore drill v2: docker cp (binary-safe) -> pg_restore -> count proof. #>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
& docker rm -f rfo-drill *> $null
& docker run --rm -d --name rfo-drill -e POSTGRES_PASSWORD=drill public.ecr.aws/docker/library/postgres:16-alpine *> $null
$deadline = (Get-Date).AddSeconds(60)
$ok = $null
do {
    Start-Sleep -Seconds 2
    $ok = (& docker exec rfo-drill pg_isready -U postgres 2>$null)
} until ($ok -or ((Get-Date) -gt $deadline))
if (-not $ok) { throw 'drill postgres never became ready' }
$dump = (Get-ChildItem .\backups\rfo_*.dump | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
if (-not $dump) { throw 'no dump found in .\backups' }
Write-Host ("  restoring: " + $dump)
& docker cp $dump rfo-drill:/tmp/rfo.dump
if ($LASTEXITCODE -ne 0) { throw 'docker cp failed' }
& docker exec rfo-drill pg_restore -U postgres --dbname=postgres --no-owner --no-privileges /tmp/rfo.dump
if ($LASTEXITCODE -ne 0) { throw 'pg_restore failed' }
$n = ((& docker exec rfo-drill psql -U postgres -d postgres -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public'") | Out-String).Trim()
$a = ((& docker exec rfo-drill psql -U postgres -d postgres -tAc "SELECT count(*) FROM assets") | Out-String).Trim()
if ([int]$n -lt 20) { throw "drill tables=$n" }
if ([int]$a -lt 5000) { throw "drill assets=$a" }
Write-Host ("RESTORE DRILL PASS: " + $n + " tables, " + $a + " assets restored") -ForegroundColor Green
& docker rm -f rfo-drill *> $null
