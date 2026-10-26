# Pack everything the other laptop needs that is NOT in git.
# Output goes to OneDrive so the other PC can sync or copy it.
# NEVER commit the transfer folder.
$ErrorActionPreference = 'Stop'
$Tcg = Split-Path $PSScriptRoot -Parent
$Stamp = Get-Date -Format 'yyyy-MM-dd'
$Out = Join-Path $env:USERPROFILE "OneDrive\Documents\Cursor\TCG-HUB-TRANSFER-$Stamp"
$DataSrc = Join-Path $Tcg 'data'

Write-Host "TCG:  $Tcg"
Write-Host "OUT:  $Out"

if (-not (Test-Path $DataSrc)) { throw "Missing data: $DataSrc" }

New-Item -ItemType Directory -Force -Path $Out | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Out 'data') | Out-Null

Write-Host 'Copying data ...'
Copy-Item -Path (Join-Path $DataSrc '*') -Destination (Join-Path $Out 'data') -Recurse -Force

$envNames = @(
  'GMAIL_CLIENT_ID',
  'GMAIL_CLIENT_SECRET',
  'GMAIL_REDIRECT_URI',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'CLAUDE_API_KEY',
  'PORT'
)
$lines = @(
  '# Run ONCE on the new laptop (PowerShell). Sets User env vars from the old hub.',
  '# Then close/reopen terminals and Cursor.',
  '$ErrorActionPreference = ''Stop'''
)
foreach ($n in $envNames) {
  $v = [Environment]::GetEnvironmentVariable($n, 'User')
  if (-not $v) { $v = [Environment]::GetEnvironmentVariable($n, 'Process') }
  if ($v) {
    $esc = $v.Replace("'", "''")
    $lines += "[Environment]::SetEnvironmentVariable('$n', '$esc', 'User')"
    $lines += "Write-Host 'Set $n'"
  } else {
    $lines += "Write-Host 'SKIP $n (not set on source machine)'"
  }
}
$lines += "Write-Host 'Done. Restart Cursor / terminals so they see the new User env.'"
$lines | Set-Content -Path (Join-Path $Out 'set-user-env.ps1') -Encoding UTF8

$dataCount = (Get-ChildItem (Join-Path $Out 'data') -File -Recurse | Measure-Object).Count
$dataMb = [math]::Round(((Get-ChildItem (Join-Path $Out 'data') -File -Recurse | Measure-Object Length -Sum).Sum) / 1MB, 1)

@(
  "PreEminent Store hub transfer pack - $Stamp"
  "Source PC packed from: $Tcg"
  "GitHub code (clone this too): https://github.com/sunderlandivan/Zaiven"
  "Auth Git as: sunderlandivan (not ThePreEminentStore)"
  ""
  "This folder contains:"
  "  data\              - full local ops DBs + OAuth/credential JSON (REQUIRED)"
  "  set-user-env.ps1   - Gmail/API User env vars from the old PC (REQUIRED once)"
  "  INSTALL.txt        - exact steps for a blank laptop"
  ""
  "Also required from OneDrive (same Microsoft account):"
  "  Pictures\Inventory - physical inventory photos"
  ""
  "data file count: $dataCount"
  "data size MB: $dataMb"
) | Set-Content (Join-Path $Out 'MANIFEST.txt') -Encoding UTF8

@'
PREEMINENT STORE - BLANK LAPTOP INSTALL
=======================================

You need THREE things:
  1) This transfer folder (data + set-user-env.ps1)  <- you have it
  2) GitHub repo Zaiven (code)                       <- clone below
  3) OneDrive Pictures\Inventory (photos)            <- same Microsoft account

A) Install prerequisites
  - Git for Windows
  - Node.js LTS (https://nodejs.org)
  - Cursor
  - Sign into the SAME OneDrive / Microsoft account as the old PC
  - Sign into GitHub as sunderlandivan when git asks

B) Clone code
  mkdir "$env:USERPROFILE\OneDrive\Documents\Cursor" -Force
  cd "$env:USERPROFILE\OneDrive\Documents\Cursor"
  git clone https://sunderlandivan@github.com/sunderlandivan/Zaiven.git TCG
  cd TCG

C) Copy secrets/data from THIS transfer pack into TCG\data\
  Example (adjust STAMP folder name if needed):
  New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\OneDrive\Documents\Cursor\TCG\data" | Out-Null
  Copy-Item -Recurse -Force "$env:USERPROFILE\OneDrive\Documents\Cursor\TCG-HUB-TRANSFER-*\data\*" `
    "$env:USERPROFILE\OneDrive\Documents\Cursor\TCG\data\"

D) Apply User env vars (from this transfer pack)
  cd to the TCG-HUB-TRANSFER-* folder, then:
  powershell -ExecutionPolicy Bypass -File .\set-user-env.ps1
  Fully quit and reopen Cursor.

E) Install + start
  cd "$env:USERPROFILE\OneDrive\Documents\Cursor\TCG"
  npm install
  npm start
  Browser: http://localhost:5173

F) In Cursor: File -> Open Folder -> that TCG folder
  New Agent -> open docs/HUB-AGENT-PROMPT.md -> copy the fenced prompt -> send as first message.
  That agent becomes the moved console (portal, site, Google, inventory, Sheet).

G) Cloudflare deploys later: npx wrangler login

DO NOT commit data\ or set-user-env.ps1 to git.
'@ | Set-Content (Join-Path $Out 'INSTALL.txt') -Encoding UTF8

$zip = "$Out.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $Out -DestinationPath $zip -Force

Write-Host ""
Write-Host "PACKED:"
Write-Host "  Folder: $Out"
Write-Host "  Zip:    $zip"
Write-Host "Wait for OneDrive to sync, then on the other laptop open INSTALL.txt"
