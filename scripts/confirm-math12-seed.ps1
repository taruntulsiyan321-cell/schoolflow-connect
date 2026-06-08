param([Parameter(Mandatory = $true)][int]$Batch)
$Root = Split-Path $PSScriptRoot -Parent
$Progress = Join-Path $Root "supabase\sql-batches\seed-math12\.seed-progress.txt"
Set-Content $Progress $Batch -Encoding UTF8
& (Join-Path $PSScriptRoot "paste-math12-seed.ps1")
