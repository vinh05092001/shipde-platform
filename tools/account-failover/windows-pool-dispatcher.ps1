param([Parameter(Mandatory)][ValidatePattern('^agy\d{2}$')][string]$Name)
$run = "C:\Tools\agy-runs\$Name"
$request = Join-Path $run 'controller-request.json'
$response = Join-Path $run 'controller-response.json'

$needsController = $false
if (Test-Path $request) {
  if (-not (Test-Path $response)) { $needsController = $true }
  else {
    try {
      $requestId = [string]((Get-Content $request -Raw) | ConvertFrom-Json).request_id
      $responseId = [string]((Get-Content $response -Raw) | ConvertFrom-Json).request_id
      $needsController = $requestId -ne $responseId
    } catch { $needsController = $true }
  }
}

if ($needsController) {
  & 'C:\Tools\agy-pool\windows-pool-worker.ps1' -Name $Name
} else {
  & 'C:\Tools\agy-pool\worker-core.ps1' -Name $Name
}
exit $LASTEXITCODE
