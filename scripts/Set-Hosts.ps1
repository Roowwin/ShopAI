#Requires -Version 5.1
#Requires -RunAsAdministrator
# Adds *.rfo.localhost -> 127.0.0.1 (Windows does not resolve subdomains of localhost natively).
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$vars = @{}
Get-Content (Join-Path $root '.env') | ForEach-Object {
    if ($_ -match '^([A-Z0-9_]+)=(.*)$') { $vars[$Matches[1]] = $Matches[2] }
}
$domains = @($vars['DOMAIN_STORE'], $vars['DOMAIN_ADMIN'], $vars['DOMAIN_API'])
if ($domains -contains $null) { throw 'DOMAIN_* missing in .env' }
$marker = '# RFO local domains'
$hfile  = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
if (-not (Select-String -Path $hfile -Pattern ([regex]::Escape($marker)) -Quiet)) {
    Add-Content -Path $hfile -Value ("`n$marker`n127.0.0.1`t" + ($domains -join ' ')) -Encoding ascii
    Write-Host 'hosts entries added' -ForegroundColor Green
} else {
    Write-Host 'hosts entries already present' -ForegroundColor DarkGray
}