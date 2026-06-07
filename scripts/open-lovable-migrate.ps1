# Opens Lovable project + copies migration SQL to clipboard (Windows)
$projectUrl = "https://lovable.dev/projects/a8554abc-67c9-47a5-aa36-55055c063896"
$sqlPath = Join-Path $PSScriptRoot "..\supabase\LOVABLE_PASTE_ALL_PENDING.sql"
if (-not (Test-Path $sqlPath)) {
  Write-Error "Missing $sqlPath"
  exit 1
}
Get-Content $sqlPath -Raw | Set-Clipboard
$size = (Get-Item $sqlPath).Length
Write-Host "Copied LOVABLE_PASTE_ALL_PENDING.sql to clipboard ($size bytes)."
Start-Process $projectUrl
Write-Host ""
Write-Host "In Lovable: sign in, open chat, paste (Ctrl+V) and send:"
Write-Host "Apply this SQL to the database. Run all statements."
Write-Host ""
Write-Host "Test: arjun.mehta@wisdomcampus.demo / DemoPass123!"
