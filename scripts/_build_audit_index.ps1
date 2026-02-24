#Requires -Version 5.1
<#
.SYNOPSIS
  Builds DocControl_Audit_Index.csv from included inventory CSVs.
  Writes DocControl_Audit_Sources.md as a companion manifest.
#>

$repoRoot = $PSScriptRoot | Split-Path
$srcDir = Join-Path $repoRoot 'exports\drive_inventory'
$stackDir = Join-Path $repoRoot 'stack'
$indexPath = Join-Path $stackDir  'DocControl_Audit_Index.csv'
$srcMdPath = Join-Path $stackDir  'DocControl_Audit_Sources.md'

New-Item -ItemType Directory -Force -Path $stackDir | Out-Null

# ── Included inventories ─────────────────────────────────────────────────────
# Each entry: Slug, CsvFile, SourceDrive, Schema
$included = @(
    [pscustomobject]@{ Slug = 'corporate'; File = 'corporate_inventory.csv'; Drive = '1. Corporate' }
    [pscustomobject]@{ Slug = 'sai_dev'; File = 'sai_development_inventory.csv'; Drive = '6. SAI Development' }
    [pscustomobject]@{ Slug = 'smart_tools'; File = 'smart_tools_hardware_inventory.csv'; Drive = '7. Smart Tools & Hardware' }
    [pscustomobject]@{ Slug = 'strategy'; File = 'strategy_empire_build_inventory.csv'; Drive = 'Strategy / Empire Build' }
    [pscustomobject]@{ Slug = 'techsafe_os'; File = 'techsafe_operating_system_inventory.csv'; Drive = 'TechSafe Operating System' }
    [pscustomobject]@{ Slug = 'product_services'; File = 'tsi_product_services_inventory.csv'; Drive = 'TSI Product Services' }
    [pscustomobject]@{ Slug = 'ims_api'; File = 'ims_inventory_api.csv'; Drive = '3. INTERGRATED MANAGMENT SYSTEMS (IMS)' }
)

# ── Excluded inventories (for manifest) ──────────────────────────────────────
$excluded = @(
    [pscustomobject]@{ File = 'finance_admin_inventory.csv'; Reason = 'EMPTY — DriveFS returned header only' }
    [pscustomobject]@{ File = 'finance_admin_inventory_api.csv'; Reason = 'STRUCTURE ONLY — 1 folder stub via API' }
    [pscustomobject]@{ File = 'ims_inventory.csv'; Reason = 'BAD — DriveFS partial row only' }
    [pscustomobject]@{ File = 'licensing_partners_inventory.csv'; Reason = 'EMPTY — DriveFS returned header only' }
    [pscustomobject]@{ File = 'licensing_partners_inventory_api.csv'; Reason = 'STRUCTURE ONLY — 1 folder stub via API' }
    [pscustomobject]@{ File = 'marketing_brand_vault_inventory.csv'; Reason = 'EMPTY — DriveFS returned header only' }
    [pscustomobject]@{ File = 'marketing_brand_vault_inventory_api.csv'; Reason = 'STRUCTURE ONLY — 1 folder stub via API' }
    [pscustomobject]@{ File = 'website_10web_inventory.csv'; Reason = 'DEPRECATED — drive retired 2026-02-24' }
    [pscustomobject]@{ File = 'website_10web_inventory_api.csv'; Reason = 'DEPRECATED — drive retired 2026-02-24' }
)

# ── Write index header ────────────────────────────────────────────────────────
$header = 'SourceInventory,SourceDrive,FullName,Name,Extension,Length,LastWriteTime,IsDirectory'
Set-Content -LiteralPath $indexPath -Value $header -Encoding UTF8

function EscCsv($s) {
    if ($null -eq $s) { return '' }
    $s = "$s".Replace('"', '""')
    if ($s -match '[,"\r\n]') { return "`"$s`"" }
    return $s
}

function WriteRow($inv, $drive, $fullName, $name, $ext, $length, $lastWrite, $isDir) {
    $cols = @(
        (EscCsv $inv),
        (EscCsv $drive),
        (EscCsv ($fullName -replace '/', '\')),
        (EscCsv $name),
        (EscCsv $ext),
        (EscCsv $length),
        (EscCsv $lastWrite),
        (EscCsv $isDir)
    )
    Add-Content -LiteralPath $indexPath -Value ($cols -join ',') -Encoding UTF8
}

# ── Process each included inventory ──────────────────────────────────────────
$stats = @{}

foreach ($inv in $included) {
    $csvPath = Join-Path $srcDir $inv.File
    $rowCount = 0

    if (-not (Test-Path -LiteralPath $csvPath)) {
        Write-Warning "NOT FOUND: $($inv.File)"
        $stats[$inv.File] = 0
        continue
    }

    $rows = Import-Csv -LiteralPath $csvPath -ErrorAction SilentlyContinue
    if (-not $rows) {
        $stats[$inv.File] = 0
        continue
    }

    # Detect schema by header names
    $firstRow = $rows[0]
    $propNames = $firstRow.PSObject.Properties.Name

    foreach ($row in $rows) {
        # Skip desktop.ini / DriveFS noise
        $rawName = ''
        if ($propNames -contains 'Name') { $rawName = $row.Name }
        elseif ($propNames -contains 'File Name') { $rawName = $row.'File Name' }
        if ($rawName -match 'desktop\.ini$') { continue }

        # ── Schema A: corporate/sai_dev/smart_tools (File Name, Current Folder Path, Type, Last Modified, Size)
        if ($propNames -contains 'File Name') {
            $fn = $row.'File Name'
            $path = $row.'Current Folder Path' -replace '/', '\' 
            $ext = $row.Type
            $sz = $row.Size
            $mod = $row.'Last Modified'
            $full = "$path\$fn"
            WriteRow $inv.File $inv.Drive $full $fn $ext $sz $mod 'False'
            $rowCount++
        }
        # ── Schema B: strategy/techsafe_os/phase2 (FullName, Name, Extension, Length, LastWriteTime, IsDirectory)
        elseif ($propNames -contains 'FullName') {
            $full = $row.FullName -replace '/', '\' 
            $fn = $row.Name
            $ext = $row.Extension
            $sz = $row.Length
            $mod = $row.LastWriteTime
            $isDir = $row.IsDirectory
            WriteRow $inv.File $inv.Drive $full $fn $ext $sz $mod $isDir
            $rowCount++
        }
        # ── Schema C: ims_inventory_api.csv (DriveName,DriveId,FileId,Name,MimeType,ModifiedTime,Size,Parents,Trashed)
        elseif ($propNames -contains 'DriveName') {
            $fn = $row.Name
            $ext = if ($fn -match '\.') { '.' + $fn.Split('.')[-1] } else { '' }
            $sz = $row.Size
            $mod = $row.ModifiedTime
            $mime = $row.MimeType
            $full = "$($inv.Drive)\$fn"
            $isDir = if ($mime -like '*folder*') { 'True' } else { 'False' }
            WriteRow $inv.File $inv.Drive $full $fn $ext $sz $mod $isDir
            $rowCount++
        }
    }

    $stats[$inv.File] = $rowCount
    Write-Host "  [OK] $($inv.File)  =>  $rowCount rows"
}

$totalRows = ($stats.Values | Measure-Object -Sum).Sum

# ── Write DocControl_Audit_Sources.md ─────────────────────────────────────────
$md = @"
# DocControl Audit — Source Manifest
**Generated:** $(Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz')

---

## Included Inventories

| # | CSV File | Source Drive | Rows in Index |
|---|----------|--------------|---------------|
"@

$i = 1
foreach ($inv in $included) {
    $rc = if ($stats.ContainsKey($inv.File)) { $stats[$inv.File] } else { 0 }
    $note = if ($rc -eq 0) { ' _(empty — included per request, 0 rows)_' } else { '' }
    $md += "`n| $i | ``$($inv.File)`` | $($inv.Drive) | **$rc**$note |"
    $i++
}

$md += @"

| | **TOTAL** | | **$totalRows** |

---

## Excluded Inventories

| CSV File | Reason |
|----------|--------|
"@

foreach ($ex in $excluded) {
    $md += "`n| ``$($ex.File)`` | $($ex.Reason) |"
}

$md += @"


---

## Notes

- **`.lnk` files** (Windows shortcuts / DriveFS stubs) are included in index but flagged by extension for cleanup.
- **`strategy_empire_build_inventory.csv`** contains 0 data rows (header-only); included per request, contributes 0 rows.
- **IMS API** shows 2 rows: 1 folder + 1 shortcut — drive content inaccessible; treat as UNKNOWN.
- Drives 2, 4, 5 (Finance, Licensing, Marketing) excluded — UNKNOWN/EMPTY; no gaps can be inferred from them.
"@

Set-Content -LiteralPath $srcMdPath -Value $md -Encoding UTF8

# ── Console summary ───────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== Build Complete ===" -ForegroundColor Cyan
Write-Host "  Index: $indexPath"
Write-Host "  Sources manifest: $srcMdPath"
Write-Host ""
Write-Host "Included inventories:"
foreach ($inv in $included) {
    $rc = if ($stats.ContainsKey($inv.File)) { $stats[$inv.File] } else { 0 }
    Write-Host ("  {0,-55} {1,4} rows" -f $inv.File, $rc)
}
Write-Host ("  {0,-55} {1,4} rows TOTAL" -f '---', $totalRows)
Write-Host ""
Write-Host "Excluded inventories ($($excluded.Count)):"
foreach ($ex in $excluded) {
    Write-Host "  $($ex.File)  =>  $($ex.Reason)"
}
