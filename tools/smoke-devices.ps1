param(
  [string]$ApiBase = "http://localhost:3001",
  [string]$UserId = "tg:999",
  [string]$Platform = "IOS",
  [string]$NamePrefix = "iphone-smoke",
  [int]$Attempts = 3
)

$ErrorActionPreference = "Stop"

function Escape-SqlLiteral([string]$value) {
  return $value.Replace("'", "''")
}

function Get-ActivePeerCount([string]$deviceId) {
  $safeDeviceId = Escape-SqlLiteral $deviceId
  $sql = 'select count(*) from "Peer" where "deviceId"=''{0}'' and "revokedAt" is null;' -f $safeDeviceId
  $raw = $sql | docker compose exec -T db psql -U cloudgate -d cloudgate -t -A
  return [int]($raw.Trim())
}

function Get-AllowedIps([string]$deviceId) {
  $safeDeviceId = Escape-SqlLiteral $deviceId
  $sql = 'select coalesce(string_agg(distinct "allowedIp", '','' order by "allowedIp"), '''') from "Peer" where "deviceId"=''{0}'';' -f $safeDeviceId
  $raw = $sql | docker compose exec -T db psql -U cloudgate -d cloudgate -t -A
  $value = $raw.Trim()
  if ([string]::IsNullOrWhiteSpace($value)) {
    return @()
  }
  return $value.Split(",")
}

function Wait-ForDb {
  $attempts = 30
  $delaySeconds = 2
  $lastFailure = "PostgreSQL not ready"

  for ($i = 1; $i -le $attempts; $i++) {
    try {
      $null = docker compose exec -T db pg_isready -U cloudgate -d cloudgate 2>$null
      if ($LASTEXITCODE -eq 0) {
        Write-Host "db ready on attempt $i/$attempts"
        return
      }

      $lastFailure = "pg_isready exit code $LASTEXITCODE"
    } catch {
      $lastFailure = $_.Exception.Message
    }

    if ($i -lt $attempts) {
      Start-Sleep -Seconds $delaySeconds
    }
  }

  throw "PostgreSQL did not become ready after $attempts attempts (delay ${delaySeconds}s): $lastFailure"
}

Wait-ForDb

$health = curl.exe -fsS "$ApiBase/health"
Write-Host "health: $health"

$deviceName = "{0}-{1}" -f $NamePrefix, [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$createBody = @{ userId = $UserId; platform = $Platform; name = $deviceName } | ConvertTo-Json -Compress
$createBodyFile = [System.IO.Path]::GetTempFileName()
$createOutFile = [System.IO.Path]::GetTempFileName()
try {
  Set-Content -Path $createBodyFile -Value $createBody -NoNewline -Encoding Ascii
  $createStatus = curl.exe -sS -o $createOutFile -w "%{http_code}" -X POST "$ApiBase/v1/devices" -H "content-type: application/json" --data-binary "@$createBodyFile"
  $createResp = Get-Content -Path $createOutFile -Raw
} finally {
  Remove-Item -Path $createBodyFile -Force -ErrorAction SilentlyContinue
  Remove-Item -Path $createOutFile -Force -ErrorAction SilentlyContinue
}

if ($createStatus -ne "200" -and $createStatus -ne "201") {
  throw "device create failed: status=$createStatus; body=$createResp"
}

$device = $createResp | ConvertFrom-Json

if (-not $device.id) {
  throw "device create failed: missing id; response=$createResp"
}

Write-Host "device.id=$($device.id) device.deviceId=$($device.deviceId)"

$observedIps = New-Object System.Collections.Generic.HashSet[string]

for ($i = 1; $i -le $Attempts; $i++) {
  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    $status = curl.exe -sS -o $tmp -w "%{http_code}" -X POST "$ApiBase/v1/devices/$($device.id)/provision" -H "content-type: application/json" -d "{}"
    $body = Get-Content -Path $tmp -Raw
  } finally {
    Remove-Item -Path $tmp -Force -ErrorAction SilentlyContinue
  }

  if ($status -ne "502") {
    throw "attempt $i expected HTTP 502, got $status; body=$body"
  }

  $activeCount = Get-ActivePeerCount $device.id
  if ($activeCount -ne 0) {
    throw "attempt $i invariant broken: active peers = $activeCount"
  }

  $ips = Get-AllowedIps $device.id
  foreach ($ip in $ips) {
    if (-not [string]::IsNullOrWhiteSpace($ip)) {
      [void]$observedIps.Add($ip)
    }
  }

  if ($observedIps.Count -gt 1) {
    throw "attempt $i invariant broken: allowedIp drift detected ($($observedIps -join ', '))"
  }

  Write-Host "attempt=$i status=$status activePeers=$activeCount allowedIps='$($ips -join ',')'"
}

Write-Host "PASS smoke-devices: no active peer leak and no allowedIp drift"
