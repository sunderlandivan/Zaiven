# Keeps the PreEminent Portal running in the background (started at Windows logon by the
# "PreEminent Portal" scheduled task). If the server stops for any reason it is restarted.
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$log = Join-Path $root "data\portal-service.log"

foreach ($name in "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REDIRECT_URI") {
  $value = [Environment]::GetEnvironmentVariable($name, "User")
  if ($value) { Set-Item -Path "Env:$name" -Value $value }
}

while ($true) {
  if (-not (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue)) {
    if ((Test-Path $log) -and (Get-Item $log).Length -gt 5MB) { Remove-Item $log -Force }
    Add-Content -Path $log -Value "`n[$(Get-Date -Format s)] starting portal"
    & node server/index.js *>> $log
    Add-Content -Path $log -Value "[$(Get-Date -Format s)] portal stopped (exit $LASTEXITCODE)"
  }
  Start-Sleep -Seconds 15
}
