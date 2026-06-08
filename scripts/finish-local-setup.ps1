# Finish setup after SQL migrations (seed + .env)
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

Write-Host "`n=== Wisdom Campus — finish local setup ===" -ForegroundColor Cyan

# 1) Math seed via clipboard + SQL Editor
$seed = Join-Path $Root "supabase\seeds\class12_math_templates.sql"
if (Test-Path $seed) {
  Set-Clipboard -Value (Get-Content $seed -Raw -Encoding UTF8)
  Write-Host "Copied class12_math_templates.sql to clipboard (~1373 rows)." -ForegroundColor Green
  Start-Process "https://supabase.com/dashboard/project/imrsjhftejghcrhzdjrl/sql/new"
  Write-Host "Paste in SQL Editor (Ctrl+V) and Run. Large file — wait 1-2 min." -ForegroundColor Yellow
} else {
  Write-Host "Run: npm run seed:math12" -ForegroundColor Yellow
}

# 2) Anon key for .env
Write-Host "`nOpen API keys page — copy the anon / publishable key:" -ForegroundColor Cyan
Start-Process "https://supabase.com/dashboard/project/imrsjhftejghcrhzdjrl/settings/api-keys"
$anon = Read-Host "Paste anon public key (eyJ...)"
if (-not [string]::IsNullOrWhiteSpace($anon)) {
  $envPath = Join-Path $Root ".env"
  $text = Get-Content $envPath -Raw -Encoding UTF8
  $text = $text -replace 'VITE_SUPABASE_PUBLISHABLE_KEY="[^"]*"', "VITE_SUPABASE_PUBLISHABLE_KEY=`"$anon`""
  Set-Content $envPath $text -Encoding UTF8 -NoNewline
  Write-Host "Updated .env with anon key." -ForegroundColor Green
}

# 3) Optional DATABASE_URL for future npm run db:migrate
$db = Read-Host "Paste DATABASE_URL (optional — press Enter to skip)"
if (-not [string]::IsNullOrWhiteSpace($db)) {
  @"
# Local only — do not commit
DATABASE_URL=$db
"@ | Set-Content (Join-Path $Root ".env.local") -Encoding UTF8
  Write-Host "Saved DATABASE_URL to .env.local" -ForegroundColor Green
}

Write-Host "`nStarting dev server..." -ForegroundColor Green
npm run dev
