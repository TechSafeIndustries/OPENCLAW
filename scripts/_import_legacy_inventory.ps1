# _import_legacy_inventory.ps1
# One-shot: copy, rename, and QA-check legacy Drive inventory CSVs
# Run from repo root: .\scripts\_import_legacy_inventory.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = 'C:\Users\mikes\.gemini\antigravity\scratch\openclaw'
$dest = Join-Path $root 'exports\drive_inventory'
$src = 'C:\Users\mikes\OneDrive\Desktop'

# ── STEP 1: Ensure dest exists ──────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Write-Host ""
Write-Host "=== STEP 1: Copy from OneDrive Desktop ===" -ForegroundColor Cyan

$files = Get-ChildItem -Path $src -Filter 'TSI_Drive_Inventory_*.csv' -ErrorAction SilentlyContinue
if ($null -eq $files -or $files.Count -eq 0) {
    Write-Host "WARNING: No TSI_Drive_Inventory_*.csv files found at $src" -ForegroundColor Yellow
    Write-Host "Listing Desktop contents for debug:" -ForegroundColor Yellow
    Get-ChildItem -Path $src -Filter '*.csv' | Select-Object Name | Format-Table -AutoSize
}
else {
    Write-Host "Found $($files.Count) source file(s):"
    $files | ForEach-Object { Write-Host "  $($_.Name)  [$($_.Length) bytes]" }
    Copy-Item -Path $files.FullName -Destination $dest -Force
    Write-Host "Copy complete." -ForegroundColor Green
}

# ── STEP 2: Rename using canonical mapping ──────────────────────────────────
Write-Host ""
Write-Host "=== STEP 2: Rename to canonical slugs ===" -ForegroundColor Cyan

$map = [ordered]@{
    'TSI_Drive_Inventory_2. Finance & Admin.csv'                     = 'finance_admin_inventory.csv'
    'TSI_Drive_Inventory_3. INTERGRATED MANAGMENT SYSTEMS (IMS).csv' = 'ims_inventory.csv'
    'TSI_Drive_Inventory_4. Licensing & Partners.csv'                = 'licensing_partners_inventory.csv'
    'TSI_Drive_Inventory_5. Marketing & Brand Vault.csv'             = 'marketing_brand_vault_inventory.csv'
    'TSI_Drive_Inventory_6. SAI Development.csv'                     = 'sai_development_inventory.csv'
    'TSI_Drive_Inventory_7. Smart Tools & Hardware.csv'              = 'smart_tools_hardware_inventory.csv'
    'TSI_Drive_Inventory_8. Strategy & Empire Build.csv'             = 'strategy_empire_build_inventory.csv'
    'TSI_Drive_Inventory_10. Website 10Web.csv'                      = 'website_10web_inventory.csv'
    'TSI_Drive_Inventory_TechSafe_Industries_Phase2_Build.csv'       = 'techsafe_industries_phase2_build_inventory.csv'
    'TSI_Drive_Inventory_TechSafe_Operating_System.csv'              = 'techsafe_operating_system_inventory.csv'
    'TSI_Drive_Inventory_TSI Product Services.csv'                   = 'tsi_product_services_inventory.csv'
}

foreach ($oldName in $map.Keys) {
    $oldPath = Join-Path $dest $oldName
    $newPath = Join-Path $dest $map[$oldName]
    if (Test-Path $oldPath) {
        Rename-Item -Path $oldPath -NewName $map[$oldName] -Force
        Write-Host "  RENAMED: $oldName  ->  $($map[$oldName])" -ForegroundColor Green
    }
    else {
        Write-Host "  SKIP (not found): $oldName" -ForegroundColor DarkGray
    }
}

# ── STEP 3: QA report ───────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== STEP 3: QA Report ===" -ForegroundColor Cyan

$qcPath = Join-Path $dest 'inventory_qc_report.csv'
$rows = @()
$good = @()
$bad = @()

# Scan all CSVs in dest (exclude the QC report itself and error files)
$csvFiles = Get-ChildItem -Path $dest -Filter '*.csv' | Where-Object {
    $_.Name -ne 'inventory_qc_report.csv' -and $_.Name -notlike '*.errors.csv'
} | Sort-Object Name

foreach ($f in $csvFiles) {
    $bytes = $f.Length
    try {
        $lines = (Get-Content -Path $f.FullName -ErrorAction Stop | Measure-Object -Line).Lines
    }
    catch {
        $lines = 0
    }

    if ($bytes -lt 200 -or $lines -lt 3) {
        $status = 'BAD'
        $bad += [PSCustomObject]@{ File = $f.Name; Bytes = $bytes; Lines = $lines }
    }
    else {
        $status = 'GOOD'
        $good += $f.Name
    }

    $rows += [PSCustomObject]@{
        File   = $f.Name
        Bytes  = $bytes
        Lines  = $lines
        Status = $status
    }
}

# Write CSV report
$rows | Export-Csv -Path $qcPath -NoTypeInformation -Encoding UTF8
Write-Host "QC report written: $qcPath" -ForegroundColor Green

# ── STEP 4: Console summary ─────────────────────────────────────────────────
Write-Host ""
Write-Host "========================================" -ForegroundColor White
Write-Host "  INVENTORY QA SUMMARY" -ForegroundColor White
Write-Host "========================================" -ForegroundColor White

Write-Host ""
Write-Host "GOOD inventories ($($good.Count)):" -ForegroundColor Green
if ($good.Count -eq 0) {
    Write-Host "  (none)" -ForegroundColor DarkGray
}
else {
    $good | ForEach-Object { Write-Host "  [OK]  $_" -ForegroundColor Green }
}

Write-Host ""
Write-Host "BAD inventories ($($bad.Count)):" -ForegroundColor Red
if ($bad.Count -eq 0) {
    Write-Host "  (none)" -ForegroundColor DarkGray
}
else {
    $bad | ForEach-Object {
        Write-Host "  [BAD] $($_.File)  |  $($_.Bytes) bytes  |  $($_.Lines) lines" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "TOTALS =>  GOOD: $($good.Count)   BAD: $($bad.Count)   TOTAL: $($rows.Count)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor White
Write-Host ""
Write-Host "Done. exports\drive_inventory is ready." -ForegroundColor Green
