param(
  [string]$ApiBase = "http://localhost:3001",
  [string]$UserId = ("tg:e2e:{0}" -f [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()),
  [string]$Platform = "IOS",
  [string]$NamePrefix = "iphone-e2e",
  [int]$TokenTtlSeconds = 1800
)

$ErrorActionPreference = "Stop"

function Import-DotEnv([string]$Path) {
  if (-not (Test-Path $Path)) { return }

  Get-Content -Path $Path | ForEach-Object {
    $line = $_.Trim()
    if ([string]::IsNullOrWhiteSpace($line)) { return }
    if ($line.StartsWith("#")) { return }

    $parts = $line -split "=", 2
    if ($parts.Count -ne 2) { return }

    $key = $parts[0].Trim()
    $value = $parts[1].Trim()

    if ([string]::IsNullOrWhiteSpace($key)) { return }
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($key))) {
      [Environment]::SetEnvironmentVariable($key, $value)
    }
  }
}

function Invoke-ComposeCapture([string[]]$Args) {
  $output = & docker compose @Args 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose failed: docker compose $($Args -join ' ')`n$output"
  }
  return $output
}

function Invoke-ApiJson {
  param(
    [ValidateSet("GET", "POST", "DELETE", "PUT", "PATCH")]
    [string]$Method,
    [string]$Path,
    [hashtable]$Body = @{},
    [string[]]$ExpectedStatuses = @("200")
  )

  $url = "$ApiBase$Path"
  $outFile = [System.IO.Path]::GetTempFileName()
  $bodyFile = $null

  try {
    $args = @("-sS", "-o", $outFile, "-w", "%{http_code}", "-X", $Method, $url, "-H", "content-type: application/json")

    if ($Method -ne "GET") {
      $bodyFile = [System.IO.Path]::GetTempFileName()
      $payload = ($Body | ConvertTo-Json -Compress)
      Set-Content -Path $bodyFile -Value $payload -NoNewline -Encoding Ascii
      $args += @("--data-binary", "@$bodyFile")
    }

    $status = & curl.exe @args
    if ($LASTEXITCODE -ne 0) {
      throw "curl failed for $Method $url"
    }

    $raw = Get-Content -Path $outFile -Raw
    if ($ExpectedStatuses -notcontains $status) {
      throw "unexpected status $status for $Method $Path; body=$raw"
    }

    $json = $null
    if (-not [string]::IsNullOrWhiteSpace($raw)) {
      $json = $raw | ConvertFrom-Json
    }

    return @{
      Status = $status
      Raw = $raw
      Json = $json
    }
  } finally {
    Remove-Item -Path $outFile -Force -ErrorAction SilentlyContinue
    if ($bodyFile) {
      Remove-Item -Path $bodyFile -Force -ErrorAction SilentlyContinue
    }
  }
}

function Invoke-SshWgShow([string]$Host, [string]$User, [string]$Interface, [string]$SshOpts) {
  $args = @()
  if (-not [string]::IsNullOrWhiteSpace($SshOpts)) {
    $args += $SshOpts -split "\s+" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  }
  $args += "$User@$Host"
  $args += "sudo -n wg show $Interface"

  $output = & ssh @args 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    throw "ssh wg show failed: $output"
  }
  return $output
}

Import-DotEnv ".env"

$sshHost = $env:WG_NODE_SSH_HOST
$sshUser = $env:WG_NODE_SSH_USER

if ([string]::IsNullOrWhiteSpace($sshHost) -or [string]::IsNullOrWhiteSpace($sshUser)) {
  Write-Host "SKIP (no host/user)"
  exit 0
}

$wgInterface = if ([string]::IsNullOrWhiteSpace($env:WG_INTERFACE)) { "wg0" } else { $env:WG_INTERFACE }
$sshOpts = $env:WG_NODE_SSH_OPTS

$health = Invoke-ApiJson -Method "GET" -Path "/health" -ExpectedStatuses @("200")
if (-not $health.Json.ok) {
  throw "health check failed: $($health.Raw)"
}
Write-Host "health: $($health.Raw)"

$name = "{0}-{1}" -f $NamePrefix, [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$create = Invoke-ApiJson -Method "POST" -Path "/v1/devices" -Body @{
  userId = $UserId
  platform = $Platform
  name = $name
} -ExpectedStatuses @("200", "201")

if (-not $create.Json.id -or -not $create.Json.deviceId) {
  throw "device create failed: $($create.Raw)"
}

$deviceId = [string]$create.Json.id
$deviceExternalId = [string]$create.Json.deviceId
Write-Host "device.id=$deviceId device.deviceId=$deviceExternalId"

$tokenOutput = Invoke-ComposeCapture @(
  "exec", "-T", "api",
  "pnpm", "--filter", "@cloudgate/api",
  "tsx", "tools/gen-connect-token.ts",
  "--userId", $UserId,
  "--deviceId", $deviceExternalId,
  "--ttl", $TokenTtlSeconds.ToString()
)

$tokenOutputClean = [regex]::Replace($tokenOutput, "\x1B\[[0-9;]*[A-Za-z]", "")
$tokenMatch = [regex]::Match($tokenOutputClean, "(?m)^\s*token=(.+?)\s*$")
if (-not $tokenMatch.Success) {
  throw "connect token not found in generator output"
}
$token = $tokenMatch.Groups[1].Value.Trim()
if ([string]::IsNullOrWhiteSpace($token)) {
  throw "empty connect token"
}

$keypairRaw = Invoke-ComposeCapture @(
  "exec", "-T", "api",
  "node", "-e",
  "const nacl=require('tweetnacl');const priv=nacl.randomBytes(32);const pub=nacl.scalarMult.base(priv);console.log(JSON.stringify({privateKey:Buffer.from(priv).toString('base64'),publicKey:Buffer.from(pub).toString('base64')}));"
)

$keypairJsonLine = $keypairRaw -split "`r?`n" | Where-Object { $_.Trim().StartsWith('{') } | Select-Object -Last 1
if (-not $keypairJsonLine) {
  throw "failed to parse generated keypair"
}
$keypair = $keypairJsonLine | ConvertFrom-Json
if (-not $keypair.publicKey -or -not $keypair.privateKey) {
  throw "generated keypair is incomplete"
}

$provision = Invoke-ApiJson -Method "POST" -Path "/v1/connect/$token/provision" -Body @{
  publicKey = [string]$keypair.publicKey
} -ExpectedStatuses @("200", "201")

if (-not $provision.Json.peerId) {
  throw "provision response missing peerId: $($provision.Raw)"
}

$peerId = [string]$provision.Json.peerId
$publicKey = [string]$keypair.publicKey
Write-Host "provision.peerId=$peerId publicKey=$publicKey"

$wgBeforeRevoke = Invoke-SshWgShow -Host $sshHost -User $sshUser -Interface $wgInterface -SshOpts $sshOpts
if ($wgBeforeRevoke -notmatch [regex]::Escape($publicKey)) {
  throw "peer publicKey not found on wg node after provision"
}
Write-Host "wg.show: peer present"

$revoke = Invoke-ApiJson -Method "POST" -Path "/v1/connect/$token/revoke" -Body @{} -ExpectedStatuses @("200")
if (-not $revoke.Json.revoked) {
  throw "revoke expected revoked=true, got: $($revoke.Raw)"
}
Write-Host "revoke.peerId=$($revoke.Json.peerId)"

$wgAfterRevoke = Invoke-SshWgShow -Host $sshHost -User $sshUser -Interface $wgInterface -SshOpts $sshOpts
if ($wgAfterRevoke -match [regex]::Escape($publicKey)) {
  throw "peer publicKey still present on wg node after revoke"
}
Write-Host "wg.show: peer absent"

Write-Host "PASS e2e-connect"
