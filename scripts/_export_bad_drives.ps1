# _export_bad_drives.ps1
# Re-exports the 6 BAD drives using BFS streaming, TSi-subtree resolution.
# Mirrors corporate_inventory schema: FullName,Name,Extension,Length,LastWriteTime,IsDirectory
# Run from repo root.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$sharedRoot = 'G:\Shared drives'
$exportDir = Join-Path $PSScriptRoot '..\exports\drive_inventory'
$exportDir = (Resolve-Path $exportDir).Path

$driveMap = [ordered]@{
    'finance_admin'         = '2. Finance & Admin'
    'ims'                   = '3. INTERGRATED MANAGMENT SYSTEMS (IMS)'
    'licensing_partners'    = '4. Licensing & Partners'
    'marketing_brand_vault' = '5. Marketing & Brand Vault'
    'strategy_empire_build' = '8. Strategy & Empire Build'
    'website_10web'         = '10. Website 10Web'
}

# ── Helpers ──────────────────────────────────────────────────────────────────

function Export-Subtree {
    param(
        [string]$Subtree,
        [string]$OutCsv,
        [string]$ErrCsv
    )

    $rowCount = 0
    $errCount = 0

    # Write CSV headers
    'FullName,Name,Extension,Length,LastWriteTime,IsDirectory' | Out-File -FilePath $OutCsv -Encoding UTF8 -Force
    'Path,Error' | Out-File -FilePath $ErrCsv -Encoding UTF8 -Force

    # BFS queue
    $queue = [System.Collections.Generic.Queue[string]]::new()
    $queue.Enqueue($Subtree)

    while ($queue.Count -gt 0) {
        $current = $queue.Dequeue()

        try {
            $items = Get-ChildItem -Path $current -Force -ErrorAction Stop
        }
        catch {
            $safePath = $current -replace '"', '""'
            $safeErr = $_.Exception.Message -replace '"', '""'
            "`"$safePath`",`"$safeErr`"" | Out-File -FilePath $ErrCsv -Encoding UTF8 -Append
            $errCount++
            continue
        }

        foreach ($item in $items) {
            try {
                $isDir = $item.PSIsContainer
                $ext = if ($isDir) { '' } else { $item.Extension }
                $len = if ($isDir) { 0 } else { $item.Length }
                $lwt = $item.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')

                $fn = $item.FullName -replace '"', '""'
                $nm = $item.Name -replace '"', '""'
                $ex2 = $ext -replace '"', '""'

                "`"$fn`",`"$nm`",`"$ex2`",$len,`"$lwt`",$isDir" |
                Out-File -FilePath $OutCsv -Encoding UTF8 -Append
                $rowCount++

                if ($isDir) { $queue.Enqueue($item.FullName) }
            }
            catch {
                $safePath = $item.FullName -replace '"', '""'
                $safeErr = $_.Exception.Message -replace '"', '""'
                "`"$safePath`",`"$safeErr`"" | Out-File -FilePath $ErrCsv -Encoding UTF8 -Append
                $errCount++
            }
        }
    }

    return @{ Rows = $rowCount; Errors = $errCount }
}

# ── Main export loop ─────────────────────────────────────────────────────────

Write-Host ''
Write-Host '=== EXPORT: BAD drives re-export ===' -ForegroundColor Cyan
Write-Host "Export dir: $exportDir"
Write-Host ''

$summary = @()

foreach ($slug in $driveMap.Keys) {
    $driveName = $driveMap[$slug]
    $drivePath = Join-Path $sharedRoot $driveName
    $outCsv = Join-Path $exportDir "${slug}_inventory.csv"
    $errCsv = Join-Path $exportDir "${slug}_inventory.errors.csv"

    Write-Host "--- [$slug] '$driveName' ---" -ForegroundColor Yellow

    if (-not (Test-Path $drivePath)) {
        Write-Host "  STATUS: PATH_NOT_FOUND - skipping" -ForegroundColor Red
        $summary += [PSCustomObject]@{
            Slug    = $slug
            Status  = 'PATH_NOT_FOUND'
            Subtree = 'N/A'
            Rows    = 0
            Errors  = 0
        }
        continue
    }

    # Resolve TSi* subtree programmatically (no typed en-dash/hyphen)
    $tsiDir = Get-ChildItem -Path $drivePath -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'TSi*' } |
    Select-Object -First 1

    if (-not $tsiDir) {
        Write-Host "  WARNING: No TSi* subdir found - using drive root" -ForegroundColor DarkYellow
        $subtree = $drivePath
    }
    else {
        $subtree = $tsiDir.FullName
        Write-Host "  Subtree: $subtree" -ForegroundColor Green
    }

    # Check materialisation - @() forces array so .Count is safe under StrictMode
    $peekItems = @(Get-ChildItem -Path $subtree -Force -ErrorAction SilentlyContinue |
        Select-Object -First 5)
    if ($peekItems.Count -eq 0) {
        Write-Host "  WARNING: NOT_MATERIALISED (0 items visible at subtree root)" -ForegroundColor DarkYellow
        Write-Host "  Exporting anyway (will capture 0 rows + record evidence)..." -ForegroundColor DarkYellow
    }
    else {
        Write-Host "  Materialised: $($peekItems.Count) item(s) visible at root"
        $peekItems | ForEach-Object { Write-Host "    $($_.Name)" }
    }

    # Run export
    Write-Host "  Exporting..." -NoNewline
    $result = Export-Subtree -Subtree $subtree -OutCsv $outCsv -ErrCsv $errCsv
    Write-Host " done." -ForegroundColor Green

    $mat = if ($peekItems.Count -eq 0) { 'NOT_MATERIALISED' } else { 'OK' }

    Write-Host "  OK drive=$slug rows=$($result.Rows) dir_errors=$($result.Errors) subtree=$subtree"

    $summary += [PSCustomObject]@{
        Slug    = $slug
        Status  = $mat
        Subtree = $subtree
        Rows    = $result.Rows
        Errors  = $result.Errors
    }
    Write-Host ''
}

# ── QC report update ─────────────────────────────────────────────────────────

Write-Host '=== QC REPORT UPDATE ===' -ForegroundColor Cyan

$qcPath = Join-Path $exportDir 'inventory_qc_report.csv'
$rows = @()
$good = @()
$bad = @()

$csvFiles = Get-ChildItem -Path $exportDir -Filter '*.csv' |
Where-Object { $_.Name -ne 'inventory_qc_report.csv' -and $_.Name -notlike '*.errors.csv' } |
Sort-Object Name

foreach ($f in $csvFiles) {
    $bytes = $f.Length
    try {
        $lines = (Get-Content -Path $f.FullName -ErrorAction Stop | Measure-Object -Line).Lines
    }
    catch {
        $lines = 0
    }

    $status = if ($bytes -lt 200 -or $lines -lt 3) { 'BAD' } else { 'GOOD' }

    if ($status -eq 'BAD') {
        $bad += [PSCustomObject]@{ File = $f.Name; Bytes = $bytes; Lines = $lines }
    }
    else {
        $good += $f.Name
    }

    $rows += [PSCustomObject]@{
        File   = $f.Name
        Bytes  = $bytes
        Lines  = $lines
        Status = $status
    }
}

$rows | Export-Csv -Path $qcPath -NoTypeInformation -Encoding UTF8
Write-Host "QC report written: $qcPath"
Write-Host ''

# ── Final console summary ─────────────────────────────────────────────────────

Write-Host '========================================' -ForegroundColor White
Write-Host '  FINAL QA SUMMARY' -ForegroundColor White
Write-Host '========================================' -ForegroundColor White
Write-Host ''
Write-Host "GOOD inventories ($($good.Count)):" -ForegroundColor Green
if ($good.Count -eq 0) {
    Write-Host '  (none)' -ForegroundColor DarkGray
}
else {
    $good | ForEach-Object { Write-Host "  [OK]  $_" -ForegroundColor Green }
}

Write-Host ''
Write-Host "BAD inventories ($($bad.Count)):" -ForegroundColor Red
if ($bad.Count -eq 0) {
    Write-Host '  (none)' -ForegroundColor DarkGray
}
else {
    $bad | ForEach-Object {
        Write-Host "  [BAD] $($_.File)  |  $($_.Bytes) bytes  |  $($_.Lines) lines" -ForegroundColor Red
    }
}

Write-Host ''
Write-Host "TOTALS =>  GOOD: $($good.Count)   BAD: $($bad.Count)   TOTAL: $($rows.Count)" -ForegroundColor Cyan
Write-Host ''
Write-Host '=== MATERIALISATION SUMMARY ===' -ForegroundColor Cyan
$summary | Format-Table -AutoSize
Write-Host ''
Write-Host 'Export complete.' -ForegroundColor Green
