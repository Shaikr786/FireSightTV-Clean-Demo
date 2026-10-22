$ErrorActionPreference = "Stop"
$base = "http://localhost:8000"
$checks = @(
  @{ Name = "Health"; Url = "$base/health" },
  @{ Name = "Tracking status"; Url = "$base/api/v1/live/status" },
  @{ Name = "Detections"; Url = "$base/api/v1/live/detections" },
  @{ Name = "API docs"; Url = "$base/docs" },
  @{ Name = "AI status"; Url = "$base/api/v1/ai/status" }
)
foreach ($check in $checks) {
  try {
    $response = Invoke-RestMethod -Uri $check.Url -TimeoutSec 5
    if ($check.Name -eq "Health" -and ($response.status -ne "ok" -or $response.seeded -ne $false)) {
      throw "Health must return status=ok and seeded=false."
    }
    if ($check.Name -eq "AI status" -and $response.available -ne $false) {
      throw "AI status must not claim an AI integration that is not present."
    }
    Write-Host "PASS  $($check.Name)" -ForegroundColor Green
  } catch {
    Write-Host "FAIL  $($check.Name): $($_.Exception.Message)" -ForegroundColor Red
    exit 1
  }
}
Write-Host "All API smoke checks passed." -ForegroundColor Green
