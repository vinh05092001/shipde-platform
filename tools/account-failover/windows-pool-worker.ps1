param([Parameter(Mandatory)][ValidatePattern('^agy\d{2}$')][string]$Name)
$ErrorActionPreference = 'Stop'
$run = "C:\Tools\agy-runs\$Name"
$requestPath = Join-Path $run 'controller-request.json'
$responsePath = Join-Path $run 'controller-response.json'
$responseTmp = "$responsePath.tmp"

function Publish([hashtable]$Value) {
  [IO.File]::WriteAllText($responseTmp, ($Value | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $responseTmp -Destination $responsePath -Force
}

try {
  $request = Get-Content -LiteralPath $requestPath -Raw | ConvertFrom-Json
  if (-not $request.request_id -or -not $request.prompt) { throw 'invalid controller request' }
  Remove-Item (Join-Path $run 'result.json'), (Join-Path $run 'out.txt'), (Join-Path $run 'err.txt') -Force -ErrorAction SilentlyContinue
  [ordered]@{ cwd=$run; prompt=[string]$request.prompt; options=$request.options } |
    ConvertTo-Json -Depth 6 | Set-Content (Join-Path $run 'job.json') -Encoding UTF8
  & 'C:\Tools\agy-pool\worker-core.ps1' -Name $Name
  $result = Get-Content (Join-Path $run 'result.json') -Raw | ConvertFrom-Json
  $out = Get-Content (Join-Path $run 'out.txt') -Raw -ErrorAction SilentlyContinue
  if ([string]$result.state -eq 'ok') {
    try { $parsed=$out|ConvertFrom-Json; $answer=[string]$parsed.response } catch { $answer=$out }
    Publish @{request_id=[string]$request.request_id;ok=$true;result=$answer}
  } else {
    $kind = if ($result.state -eq 'quota') {'quota'} elseif ($result.state -eq 'login-required') {'auth'} else {'cli'}
    $status = if ($kind -eq 'quota') {429} elseif ($kind -eq 'auth') {401} else {500}
    Publish @{request_id=[string]$request.request_id;ok=$false;error_type=$kind;status_code=$status;error="agy state=$($result.state), exit=$($result.exitCode)"}
  }
} catch {
  $id = try {[string]$request.request_id}catch{''}
  Publish @{request_id=$id;ok=$false;error_type='worker';status_code=500;error=$_.Exception.Message}
  exit 1
}
