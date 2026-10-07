#Requires -Version 5.1
# Stops the stack. -PurgeData ALSO deletes volumes (required after secret rotation).
[CmdletBinding()]
param([switch]$PurgeData)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if ($PurgeData) {
    Write-Warning 'PURGING ALL DATA VOLUMES (postgres/redis/minio)'
    & docker compose down -v --remove-orphans
} else {
    & docker compose down --remove-orphans
}
if ($LASTEXITCODE -ne 0) { throw 'docker compose down failed' }