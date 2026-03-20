# scripts/export_all_drives.ps1
# Generates a shared RunId and exports both Corporate and DocControl drives.

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$runId = "run_$timestamp"

Write-Host ">>> Starting Bulk Drive Export (RunId: $runId)" -ForegroundColor Yellow

$drives = @(
    "1. Corporate",
    "TSI-01 DocControl.GOOGLE"
)

foreach ($driveName in $drives) {
    Write-Host ">>> Exporting $driveName..." -ForegroundColor Cyan
    powershell -File scripts\cdms_export_inventory.ps1 -DriveName $driveName -RunId $runId
}

Write-Host "Bulk export for RunId $runId complete." -ForegroundColor Green
