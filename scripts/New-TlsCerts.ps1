#Requires -Version 5.1
# Local TLS for *.rfo.localhost. mkcert preferred (trusted by browsers); openssl fallback warns.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$certs = Join-Path (Split-Path $PSScriptRoot -Parent) 'infra\nginx\certs'
New-Item -ItemType Directory -Force -Path $certs | Out-Null

if (Get-Command mkcert -ErrorAction SilentlyContinue) {
    & mkcert -install
    & mkcert -cert-file (Join-Path $certs 'fullchain.pem') -key-file (Join-Path $certs 'key.pem') '*.rfo.localhost' 'rfo.localhost'
} else {
    Write-Warning 'mkcert not found - generating self-signed cert (browsers will warn).'
    Write-Warning 'For trusted local TLS: winget install -e --id FiloSottile.mkcert'
    & docker run --rm -v "${certs}:/certs" nginx:alpine sh -c "openssl req -x509 -nodes -newkey rsa:2048 -days 825 -keyout /certs/key.pem -out /certs/fullchain.pem -subj '/CN=rfo.local' -addext 'subjectAltName=DNS:*.rfo.localhost,DNS:rfo.localhost'"
}
if ($LASTEXITCODE -ne 0) { throw 'certificate generation failed' }
& icacls (Join-Path $certs 'key.pem') /inheritance:r /grant:r "$($env:USERDOMAIN)\$($env:USERNAME):F" *> $null
Write-Host "Certificates written to $certs" -ForegroundColor Green