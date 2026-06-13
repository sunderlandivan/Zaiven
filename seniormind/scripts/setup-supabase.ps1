# SeniorMind Supabase setup (Windows PowerShell)
# Run from seniormind/:  npm run supabase:setup
#
# First run opens browser for Supabase login (one-time).
# After that, this script creates the cloud project, applies schema, and writes .env.local keys.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot/..

Write-Host "`n=== SeniorMind Supabase Setup ===" -ForegroundColor Cyan

# Step 1 — ensure CLI is logged in
$token = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", "User")
if (-not $token) {
  Write-Host "`nOpening browser for Supabase login (one-time)..." -ForegroundColor Yellow
  npx supabase login
  if ($LASTEXITCODE -ne 0) { throw "Supabase login failed." }
}

# Step 2 — find or create project
$projectName = "seniormind"
Write-Host "`nChecking for existing Supabase projects..." -ForegroundColor Cyan
$projectsJson = npx supabase projects list -o json 2>&1 | Out-String
$projects = $projectsJson | ConvertFrom-Json -ErrorAction SilentlyContinue

$project = $null
if ($projects) {
  $project = $projects | Where-Object { $_.name -eq $projectName } | Select-Object -First 1
}

if (-not $project) {
  Write-Host "Creating Supabase project '$projectName'..." -ForegroundColor Cyan
  $orgsJson = npx supabase orgs list -o json 2>&1 | Out-String
  $orgs = $orgsJson | ConvertFrom-Json
  if (-not $orgs -or $orgs.Count -eq 0) { throw "No Supabase organizations found." }
  $orgId = $orgs[0].id

  $createJson = npx supabase projects create $projectName --org-id $orgId --region us-east-1 --plan free -o json 2>&1 | Out-String
  $project = $createJson | ConvertFrom-Json
  Write-Host "Project created. Waiting for provisioning (~60s)..." -ForegroundColor Yellow
  Start-Sleep -Seconds 60
} else {
  Write-Host "Found existing project: $($project.name) ($($project.id))" -ForegroundColor Green
}

$ref = $project.id
if (-not $ref) { throw "Could not determine project ref." }

# Step 3 — link + push schema
Write-Host "`nLinking project and applying database schema..." -ForegroundColor Cyan
npx supabase link --project-ref $ref
if ($LASTEXITCODE -ne 0) { throw "supabase link failed." }

npx supabase db push
if ($LASTEXITCODE -ne 0) { throw "supabase db push failed." }

# Step 4 — fetch API keys and update .env.local
Write-Host "`nFetching API keys..." -ForegroundColor Cyan
$keysJson = npx supabase projects api-keys --project-ref $ref -o json 2>&1 | Out-String
$keys = $keysJson | ConvertFrom-Json

$anonKey = ($keys | Where-Object { $_.name -eq "anon" }).api_key
$serviceKey = ($keys | Where-Object { $_.name -eq "service_role" }).api_key
$url = "https://$ref.supabase.co"

if (-not $anonKey -or -not $serviceKey) { throw "Could not fetch API keys." }

$envPath = Join-Path $PWD ".env.local"
$envContent = Get-Content $envPath -Raw -ErrorAction SilentlyContinue
if (-not $envContent) { $envContent = "" }

function Set-EnvLine($content, $key, $value) {
  if ($content -match "(?m)^$key=.*$") {
    return ($content -replace "(?m)^$key=.*$", "$key=$value")
  }
  return ($content.TrimEnd() + "`n$key=$value`n")
}

$envContent = Set-EnvLine $envContent "NEXT_PUBLIC_SUPABASE_URL" $url
$envContent = Set-EnvLine $envContent "NEXT_PUBLIC_SUPABASE_ANON_KEY" $anonKey
$envContent = Set-EnvLine $envContent "SUPABASE_SERVICE_ROLE_KEY" $serviceKey
Set-Content -Path $envPath -Value $envContent.TrimEnd() -NoNewline
Add-Content -Path $envPath -Value "`n"

Write-Host "`n=== Setup complete ===" -ForegroundColor Green
Write-Host "  Project URL: $url"
Write-Host "  Keys written to .env.local"
Write-Host "`nRestart the dev server: npm run dev`n"
