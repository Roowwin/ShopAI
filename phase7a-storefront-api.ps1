Save-FromClipboard .\phase7a-storefront-api.ps1
.\phase7a-storefront-api.ps1
docker compose run --rm migrate alembic current     # no-op check: still 0007 (no migration this phase)
.\scripts\Test-Phase7a.ps1
if ($LASTEXITCODE -eq 0) { git add -A ; git commit -m "feat(api): phase 7a - catalog/search APIs, lot-active enforcement, dev simulate-payment" }

