# Paste next math12 seed batch to clipboard + open SQL Editor
param([int]$Batch = 0)

$Root = Split-Path $PSScriptRoot -Parent
$Dir = Join-Path $Root "supabase\sql-batches\seed-math12"
$Progress = Join-Path $Dir ".seed-progress.txt"
$Url = "https://supabase.com/dashboard/project/imrsjhftejghcrhzdjrl/sql/new"

if (-not (Test-Path (Join-Path $Dir "seed-math12-01.sql"))) {
  node (Join-Path $Root "scripts\split-math12-seed.mjs")
}

$files = Get-ChildItem $Dir -Filter "seed-math12-*.sql" | Sort-Object Name
$next = if ($Batch -gt 0) { $Batch } else {
  $done = 0
  if (Test-Path $Progress) { $done = [int](Get-Content $Progress -Raw).Trim() }
  $done + 1
}

if ($next -gt $files.Count) {
  Write-Host "All $($files.Count) seed batches done. Verify: SELECT count(*) FROM question_templates;" -ForegroundColor Green
  exit 0
}

$f = $files[$next - 1]
Set-Clipboard -Value (Get-Content $f.FullName -Raw -Encoding UTF8)
Start-Process $Url
Write-Host "Batch $next of $($files.Count): $($f.Name) copied to clipboard. Paste (Ctrl+V) and Run." -ForegroundColor Cyan
Write-Host "After success: .\scripts\paste-math12-seed.ps1 -Batch $next; then run with -Batch $($next+1) or just .\scripts\paste-math12-seed.ps1 again"
