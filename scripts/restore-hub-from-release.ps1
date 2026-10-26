# Restore PreEminent hub secrets/data from the private GitHub release onto this laptop.
# Run from any folder. Prefer the real clone: Documents\Cursor\TCG (not empty OneDrive shells).
$ErrorActionPreference = 'Stop'
$Tag = 'hub-transfer-2026-10-26'
$Asset = 'TCG-HUB-TRANSFER-2026-10-26.zip'
$Repo = 'sunderlandivan/Zaiven'

$candidates = @(
  (Join-Path $env:USERPROFILE 'Documents\Cursor\TCG'),
  (Join-Path $env:USERPROFILE 'OneDrive\Documents\Cursor\TCG')
)
$Root = $candidates | Where-Object { Test-Path (Join-Path $_ 'package.json') } | Select-Object -First 1
if (-not $Root) {
  $Root = Join-Path $env:USERPROFILE 'Documents\Cursor\TCG'
  New-Item -ItemType Directory -Force -Path $Root | Out-Null
  Write-Host "Cloning Zaiven into $Root ..."
  git clone "https://sunderlandivan@github.com/$Repo.git" $Root
}

Write-Host "Hub root: $Root"

$credIn = "protocol=https`nhost=github.com`nusername=sunderlandivan`n`n"
$credOut = $credIn | git credential fill
$token = ($credOut | Select-String -Pattern '^password=(.+)$').Matches.Groups[1].Value
if (-not $token) { throw 'No GitHub token for sunderlandivan. Sign into GitHub (git push once) then retry.' }

$relJson = curl.exe -s -H "Authorization: Bearer $token" -H "Accept: application/vnd.github+json" -H "User-Agent: TCG-hub-restore" `
  "https://api.github.com/repos/$Repo/releases/tags/$Tag"
$rel = $relJson | ConvertFrom-Json
$assetId = ($rel.assets | Where-Object { $_.name -eq $Asset } | Select-Object -First 1).id
if (-not $assetId) { throw "Release tag $Tag has no asset named $Asset" }

$zipPath = Join-Path $env:TEMP $Asset
Write-Host "Downloading release asset $Asset (id $assetId) ..."
curl.exe -sL -H "Authorization: Bearer $token" -H "Accept: application/octet-stream" -H "User-Agent: TCG-hub-restore" `
  -o $zipPath "https://api.github.com/repos/$Repo/releases/assets/$assetId"
if (-not (Test-Path $zipPath) -or (Get-Item $zipPath).Length -lt 1000000) {
  throw "Download failed or zip too small: $zipPath"
}
Write-Host "Downloaded $((Get-Item $zipPath).Length) bytes"

$extract = Join-Path $env:TEMP 'TCG-HUB-TRANSFER-extract'
if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
Expand-Archive -Path $zipPath -DestinationPath $extract -Force
# Zip may contain a top-level folder
$packRoot = Get-ChildItem $extract -Directory | Select-Object -First 1
if (-not $packRoot) { $packRoot = Get-Item $extract }
elseif (Test-Path (Join-Path $packRoot.FullName 'data')) { }
else {
  $nested = Get-ChildItem $extract -Recurse -Directory -Filter 'data' | Select-Object -First 1
  if ($nested) { $packRoot = $nested.Parent }
}

$dataSrc = Join-Path $packRoot.FullName 'data'
if (-not (Test-Path $dataSrc)) { throw "No data\ folder inside zip at $extract" }

$dataDst = Join-Path $Root 'data'
New-Item -ItemType Directory -Force -Path $dataDst | Out-Null
Write-Host "Copying data\ -> $dataDst"
Copy-Item -Recurse -Force (Join-Path $dataSrc '*') $dataDst

$envScript = Join-Path $packRoot.FullName 'set-user-env.ps1'
if (Test-Path $envScript) {
  Write-Host 'Applying User env vars...'
  & powershell -ExecutionPolicy Bypass -File $envScript
} else {
  Write-Host 'WARN: set-user-env.ps1 missing in pack'
}

Push-Location $Root
if (-not (Test-Path 'node_modules')) { npm install }
# Free port 5173 then start
$conns = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conns) {
  try { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
}
Start-Sleep -Milliseconds 400
Write-Host 'Starting server on 5173...'
Start-Process -FilePath 'node' -ArgumentList 'server/index.js' -WorkingDirectory $Root -WindowStyle Hidden
Start-Sleep -Seconds 2
$up = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
Write-Host $(if ($up) { 'SERVER UP http://localhost:5173' } else { 'SERVER did not bind — check logs' })
Pop-Location

Write-Host @"

Restore complete.
  data files: $((Get-ChildItem $dataDst -File).Count)
  Open Cursor on: $Root
  Fully quit/reopen Cursor so Gmail User env is visible.
"@
