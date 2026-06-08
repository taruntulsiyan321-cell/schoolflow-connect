# One-click: rebuild bundle, copy to clipboard, open Lovable project
$Root = Split-Path $PSScriptRoot -Parent
$sqlPath = Join-Path $Root "supabase\LOVABLE_PASTE_ALL_PENDING.sql"
$projectUrl = "https://lovable.dev/projects/a8554abc-67c9-47a5-aa36-55055c063896"

Write-Host "Building single SQL file..." -ForegroundColor Cyan
Push-Location $Root
npm run db:generate-lovable-paste 2>&1 | Out-Host
Pop-Location

if (-not (Test-Path $sqlPath)) {
  Write-Error "Missing $sqlPath"
  exit 1
}

Get-Content $sqlPath -Raw -Encoding UTF8 | Set-Clipboard
$kb = [math]::Round((Get-Item $sqlPath).Length / 1KB, 1)
Write-Host ""
Write-Host "Copied to clipboard ($kb KB) - ONE file, all migrations + demo + math questions." -ForegroundColor Green
Start-Process $projectUrl
Write-Host ""
Write-Host "In Lovable (after you sign in):" -ForegroundColor Yellow
Write-Host "  1. Open your SchoolFlow project"
Write-Host "  2. Go to Supabase, then SQL Editor, then New query"
Write-Host "  3. Paste (Ctrl+V) and click RUN once"
Write-Host ""
Write-Host 'Demo login after success: arjun.mehta@wisdomcampus.demo / DemoPass123!'
