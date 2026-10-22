$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "backend"
Set-Location $backend
if (-not (Test-Path ".venv\Scripts\python.exe")) {
  Write-Host "Creating Python virtual environment..." -ForegroundColor Cyan
  py -3 -m venv .venv
}
$python = Join-Path $backend ".venv\Scripts\python.exe"
Write-Host "Installing/updating backend requirements..." -ForegroundColor Cyan
& $python -m pip install --upgrade pip
& $python -m pip install -r requirements.txt
Write-Host "Starting FireSightTV API on http://localhost:8000" -ForegroundColor Green
& $python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
