# _probe_bad_drives.ps1
# Probe G:\Shared drives\ to find correct subtree for each BAD drive before exporting.

$sharedRoot = 'G:\Shared drives'

$driveMap = [ordered]@{
    'finance_admin'         = '2. Finance & Admin'
    'ims'                   = '3. INTERGRATED MANAGMENT SYSTEMS (IMS)'
    'licensing_partners'    = '4. Licensing & Partners'
    'marketing_brand_vault' = '5. Marketing & Brand Vault'
    'strategy_empire_build' = '8. Strategy & Empire Build'
    'website_10web'         = '10. Website 10Web'
}

Write-Host ""
Write-Host "=== PROBE: G:\Shared drives top-level ===" -ForegroundColor Cyan
if (-not (Test-Path $sharedRoot)) {
    Write-Host "ERROR: $sharedRoot does not exist or is not mounted." -ForegroundColor Red
    exit 1
}

Get-ChildItem -Path $sharedRoot -Directory -ErrorAction SilentlyContinue |
Select-Object Name | Format-Table -AutoSize

Write-Host ""
Write-Host "=== PROBE: Per-drive subtree detection ===" -ForegroundColor Cyan

foreach ($slug in $driveMap.Keys) {
    $driveName = $driveMap[$slug]
    $drivePath = Join-Path $sharedRoot $driveName

    Write-Host ""
    Write-Host "--- [$slug] ---" -ForegroundColor Yellow
    Write-Host "  Drive path : $drivePath"

    if (-not (Test-Path $drivePath)) {
        Write-Host "  STATUS: PATH_NOT_FOUND" -ForegroundColor Red
        continue
    }

    # List immediate children
    $children = Get-ChildItem -Path $drivePath -Directory -ErrorAction SilentlyContinue
    Write-Host "  Top-level dirs ($($children.Count)):"
    $children | ForEach-Object { Write-Host "    [$($_.Name)]" }

    # Find TSi* subtree
    $tsi = $children | Where-Object { $_.Name -like 'TSi*' } | Select-Object -First 1
    if ($tsi) {
        Write-Host "  TSi subtree  : $($tsi.FullName)" -ForegroundColor Green
        # Peek inside
        $peek = Get-ChildItem -Path $tsi.FullName -ErrorAction SilentlyContinue | Select-Object -First 10
        Write-Host "  Peek (up to 10 items): $($peek.Count) found"
        $peek | ForEach-Object { Write-Host "    $($_.Name)" }
    }
    else {
        Write-Host "  TSi subtree  : NONE FOUND - will fallback to drive root" -ForegroundColor DarkYellow
    }
}

Write-Host ""
Write-Host "Probe complete." -ForegroundColor Green
