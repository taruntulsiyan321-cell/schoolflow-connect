# Mark a SQL batch as completed and optionally launch the next one.
# Usage: .\scripts\confirm-migration-batch.ps1 -Batch 1

param(
  [Parameter(Mandatory = $true)][int]$Batch,
  [switch]$Next
)

$Root = Split-Path $PSScriptRoot -Parent
$ProgressFile = Join-Path $Root "supabase\sql-batches\.paste-progress.txt"
Set-Content -Path $ProgressFile -Value $Batch -Encoding UTF8
Write-Host "Marked batch $Batch as done." -ForegroundColor Green

if ($Next) {
  & (Join-Path $PSScriptRoot "paste-next-migration.ps1")
}
