# PreEminent Store hub — run once on the new primary laptop (PowerShell).
# Clones/updates Zaiven, links OneDrive data if present, installs deps, prints env checklist.
$ErrorActionPreference = 'Stop'
$RepoUrl = 'https://sunderlandivan@github.com/sunderlandivan/Zaiven.git'
$Preferred = Join-Path $env:USERPROFILE 'OneDrive\Documents\Cursor\TCG'
$Fallback = Join-Path $env:USERPROFILE 'Documents\Cursor\TCG'
$Root = if (Test-Path (Join-Path $Preferred '.git')) { $Preferred }
  elseif (Test-Path (Join-Path $Fallback '.git')) { $Fallback }
  elseif (Test-Path $Preferred) { $Preferred }
  else { $Fallback }

Write-Host "== Hub root: $Root =="

New-Item -ItemType Directory -Force -Path (Split-Path $Root) | Out-Null
if (-not (Test-Path (Join-Path $Root '.git'))) {
  if (Test-Path $Root) {
    Write-Host "Folder exists but is not a git repo. Clone into a temp name then merge manually if needed."
    git clone $RepoUrl "$Root-from-github"
    Write-Host "Cloned to $Root-from-github — copy data\ from your OneDrive TCG folder into it, then open that folder in Cursor."
    exit 0
  }
  git clone $RepoUrl $Root
} else {
  Push-Location $Root
  git remote set-url origin $RepoUrl
  git fetch origin
  git checkout main
  git pull --ff-only origin main
  Pop-Location
}

$data = Join-Path $Root 'data'
if (-not (Test-Path $data) -or -not (Get-ChildItem $data -File -ErrorAction SilentlyContinue)) {
  Write-Host @"

WARNING: data\ is missing or empty.
Copy the full data\ folder from the old PC (OneDrive\Documents\Cursor\TCG\data)
into: $data
That folder has PayPal/YouTube OAuth, inventory DBs, store settings — it is NOT in git.

"@
} else {
  $n = (Get-ChildItem $data -File).Count
  Write-Host "data\ OK ($n files)."
}

Push-Location $Root
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'ERROR: Node.js not found. Install LTS from https://nodejs.org then re-run.'
  Pop-Location
  exit 1
}
npm install
Pop-Location

$need = @('GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REDIRECT_URI')
$missing = @($need | Where-Object { -not [Environment]::GetEnvironmentVariable($_, 'User') })
if ($missing.Count) {
  Write-Host "Set these as User env vars (same values as the old PC), then open a new terminal:"
  $missing | ForEach-Object { Write-Host "  $_" }
} else {
  Write-Host 'Gmail User env vars present.'
}

Write-Host @"

Next:
  cd `"$Root`"
  npm start
  Open http://localhost:5173
  In Cursor: File → Open Folder → $Root
  For Cloudflare deploys: npx wrangler login (once)

Done.
"@
