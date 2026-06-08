# Copies the next remaining SQL batch to clipboard and opens Supabase SQL Editor.
# NO Lovable credits. NO DATABASE_URL needed — you paste + Run in the browser.
#
# Usage: .\scripts\paste-next-migration.ps1
#        .\scripts\paste-next-migration.ps1 -Batch 2

param([int]$Batch = 0)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$BatchDir = Join-Path $Root "supabase\sql-batches"
$ProgressFile = Join-Path $BatchDir ".paste-progress.txt"
$SqlUrl = "https://supabase.com/dashboard/project/kdmjipeksjdyojjdokbi/sql/new"

# Generate fresh remaining batches if missing
if (-not (Test-Path (Join-Path $BatchDir "remaining-01.sql"))) {
  Write-Host "Generating remaining migration batches..." -ForegroundColor Cyan
  Set-Location $Root
  node scripts/generate-remaining-batch.mjs
}

$remaining = Get-ChildItem $BatchDir -Filter "remaining-*.sql" |
  Where-Object { $_.Name -match '^remaining-\d+\.sql$' } |
  Sort-Object Name

if ($remaining.Count -eq 0) {
  Write-Host "No remaining-*.sql files found. Run: npm run db:generate-remaining" -ForegroundColor Red
  exit 1
}

$next = $Batch
if ($next -lt 1) {
  $done = 0
  if (Test-Path $ProgressFile) {
    $done = [int](Get-Content $ProgressFile -Raw).Trim()
  }
  $next = $done + 1
}

if ($next -gt $remaining.Count) {
  Write-Host "All $($remaining.Count) batches marked done." -ForegroundColor Green
  Write-Host "Optional: run remaining-seed-class12.sql in SQL Editor, then npm run db:check-migrations"
  exit 0
}

$file = $remaining[$next - 1]
$sql = Get-Content $file.FullName -Raw -Encoding UTF8
Set-Clipboard -Value $sql

Write-Host ""
Write-Host "=== Batch $next of $($remaining.Count) ===" -ForegroundColor Cyan
Write-Host "File: $($file.Name)"
Write-Host "SQL copied to clipboard ($(($sql.Length / 1KB).ToString('0.0')) KB)"
Write-Host ""
Write-Host "Opening Supabase SQL Editor..." -ForegroundColor Green
Start-Process $SqlUrl
Write-Host ""
Write-Host "IN THE BROWSER:" -ForegroundColor Yellow
Write-Host "  1. Sign in to Supabase (same email as Lovable/GitHub)"
Write-Host "  2. Ctrl+V to paste SQL"
Write-Host "  3. Click RUN"
Write-Host "  4. Wait for green success"
Write-Host "  5. Come back and run: npm run db:confirm-batch -- -Batch $next -Next"
Write-Host ""
