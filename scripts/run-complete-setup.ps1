# One-shot: apply ALL pending migrations + verify + demo login test (no Lovable credits)
# Usage: right-click → Run with PowerShell, OR:
#   cd "C:\Users\tarun\Downloads\New folder\schoolflow-connect"
#   .\scripts\run-complete-setup.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

Write-Host ""
Write-Host "=== SchoolFlow — complete database setup (no Lovable AI) ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Your Supabase personal token (sbp_...) cannot run SQL on Lovable Cloud projects."
Write-Host "You need the Postgres connection string from Lovable:"
Write-Host "  Lovable project → Settings → Supabase → Database URI"
Write-Host ""
Write-Host "Example shape:"
Write-Host "  postgresql://postgres.kdmjipeksjdyojjdokbi:PASSWORD@aws-0-....pooler.supabase.com:6543/postgres"
Write-Host ""

$dbUrl = Read-Host "Paste DATABASE_URL here (input is visible — do not share in chat)"
if ([string]::IsNullOrWhiteSpace($dbUrl)) {
  Write-Host "Cancelled — no URL entered." -ForegroundColor Yellow
  exit 1
}

$envPath = Join-Path $Root ".env.local"
@"
# Created by run-complete-setup.ps1 — do not commit
DATABASE_URL=$dbUrl
"@ | Set-Content -Path $envPath -Encoding UTF8

Write-Host ""
Write-Host "Running migrations (11 files)..." -ForegroundColor Green
npm run db:migrate
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Checking what is applied..." -ForegroundColor Green
npm run db:check-migrations

Write-Host ""
Write-Host "Done. Test login: arjun.mehta@wisdomcampus.demo / DemoPass123!" -ForegroundColor Green
Write-Host "Revoke any Supabase tokens you posted in chat." -ForegroundColor Yellow
Write-Host ""
