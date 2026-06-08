# Set Google Gemini API key on Supabase Edge Functions (Lovable / self-hosted).
# Get a free key: https://aistudio.google.com/apikey
#
# Usage:
#   $env:GOOGLE_GEMINI_API_KEY = "AIza..."
#   powershell -ExecutionPolicy Bypass -File scripts/set-gemini-secret.ps1
#
# Or with Supabase CLI linked to project kdmjipeksjdyojjdokbi:
#   supabase secrets set GOOGLE_GEMINI_API_KEY=AIza... --project-ref kdmjipeksjdyojjdokbi

$Key = $env:GOOGLE_GEMINI_API_KEY
if (-not $Key) {
  Write-Host "Set GOOGLE_GEMINI_API_KEY first, e.g.:" -ForegroundColor Yellow
  Write-Host '  $env:GOOGLE_GEMINI_API_KEY = "AIza..."'
  Write-Host ""
  Write-Host "Get a key at https://aistudio.google.com/apikey" -ForegroundColor Cyan
  exit 1
}

$projectRef = "kdmjipeksjdyojjdokbi"
Write-Host "Setting GOOGLE_GEMINI_API_KEY on project $projectRef ..." -ForegroundColor Cyan

supabase secrets set "GOOGLE_GEMINI_API_KEY=$Key" --project-ref $projectRef 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "CLI failed — paste manually in Lovable:" -ForegroundColor Yellow
  Write-Host "  Supabase → Project Settings → Edge Functions → Secrets"
  Write-Host "  Name: GOOGLE_GEMINI_API_KEY"
  Write-Host "  Value: (your Gemini API key)"
  exit 1
}

Write-Host "Done. Redeploy edge functions (Lovable sync or supabase functions deploy)." -ForegroundColor Green
