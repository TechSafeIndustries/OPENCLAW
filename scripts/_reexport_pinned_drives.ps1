# _reexport_pinned_drives.ps1
# Re-exports 5 newly-pinned drives after offline hydration.
# Uses LiteralPath everywhere, retry-once per dir (500ms), BFS streaming.
# Schema: FullName,Name,Extension,Length,LastWriteTime,IsDirectory
# Run from repo root.

$ErrorActionPreference = 'Continue'

$exportDir = 'C:\Users\mikes\.gemini\antigravity\scratch\openclaw\exports\drive_inventory'

$driveMap = [ordered]@{
    'finance_admin'         = 'G:\Shared drives\2. Finance & Admin'
    'ims'                   = 'G:\Shared drives\3. INTERGRATED MANAGMENT SYSTEMS (IMS)'
    'licensing_partners'    = 'G:\Shared drives\4. Licensing & Partners'
    'marketing_brand_vault' = 'G:\Shared drives\5. Marketing & Brand Vault'
    'website_10web'         = 'G:\Shared drives\10. Website 10Web'
}

function Get-TsiSubtree {
    param([string]$Base)
    $hit = Get-ChildItem -LiteralPath $Base -Directory -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'TSi*' } |
    Select-Object -First 1 -ExpandProperty FullName
    return $hit
}

function Export-Subtree {
    param(
        [string]$Subtree,
        [string]$OutCsv,
        [string]$ErrCsv
    )

    $rowCount = 0
    $errCount = 0

    'FullName,Name,Extension,Length,LastWriteTime,IsDirectory' |
    Out-File -LiteralPath $OutCsv -Encoding UTF8 -Force
    'Path,Error' |
    Out-File -LiteralPath $ErrCsv -Encoding UTF8 -Force

    $queue = [System.Collections.Generic.Queue[string]]::new()
    $queue.Enqueue($Subtree)

    while ($queue.Count -gt 0) {
        $current = $queue.Dequeue()

        # Try once, retry once after 500ms if error
        $items = $null
        $attempt = 0
        do {
            try {
                $items = @(Get-ChildItem -LiteralPath $current -Force -ErrorAction Stop)
                break
            }
            catch {
                $attempt++
                if ($attempt -ge 2) {
                    $sp = $current -replace '"', '""'
                    $se = $_.Exception.Message -replace '"', '""'
                    "`"$sp`",`"$se`"" | Out-File -LiteralPath $ErrCsv -Encoding UTF8 -Append
                    $errCount++
                    $items = $null
                    break
                }
                Start-Sleep -Milliseconds 500
            }
        } while ($true)

        if ($null -eq $items) { continue }

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
                Out-File -LiteralPath $OutCsv -Encoding UTF8 -Append
                $rowCount++
                if ($isDir) { $queue.Enqueue($item.FullName) }
            }
            catch {
                $sp = $item.FullName -replace '"', '""'
                $se = $_.Exception.Message -replace '"', '""'
                "`"$sp`",`"$se`"" | Out-File -LiteralPath $ErrCsv -Encoding UTF8 -Append
                $errCount++
            }
        }
    }
    return @{ Rows = $rowCount; Errors = $errCount }
}

# ── Main ─────────────────────────────────────────────────────────────────────

Write-Host ''
Write-Host '=== RE-EXPORT: Pinned drives ===' -ForegroundColor Cyan
Write-Host "Export dir: $exportDir"
Write-Host ''

$summary = @()

foreach ($slug in $driveMap.Keys) {
    $base = $driveMap[$slug]
    $outCsv = Join-Path $exportDir "${slug}_inventory.csv"
    $errCsv = Join-Path $exportDir "${slug}_inventory.errors.csv"

    Write-Host "--- [$slug] ---" -ForegroundColor Yellow
    Write-Host "  Base: $base"

    if (-not (Test-Path -LiteralPath $base)) {
        Write-Host "  STATUS: PATH_NOT_FOUND - skipping" -ForegroundColor Red
        $summary += [PSCustomObject]@{ Slug = $slug; Status = 'PATH_NOT_FOUND'; Subtree = 'N/A'; Rows = 0; Errors = 0 }
        continue
    }

    $subtree = Get-TsiSubtree -Base $base
    if (-not $subtree) {
        Write-Host "  WARNING: No TSi* subdir - falling back to drive root" -ForegroundColor DarkYellow
        $subtree = $base
    }
    else {
        Write-Host "  Subtree : $subtree" -ForegroundColor Green
    }

    # Materialisation check
    $peek = @(Get-ChildItem -LiteralPath $subtree -Force -ErrorAction SilentlyContinue | Select-Object -First 10)
    if ($peek.Count -eq 0) {
        Write-Host "  STATUS: NOT_MATERIALISED (0 items at subtree root)" -ForegroundColor Red
        Write-Host "  Evidence: listing returned nothing after offline pin."
        $summary += [PSCustomObject]@{ Slug = $slug; Status = 'NOT_MATERIALISED'; Subtree = $subtree; Rows = 0; Errors = 0 }
        # Write header-only CSV so QC can still flag it
        'FullName,Name,Extension,Length,LastWriteTime,IsDirectory' |
        Out-File -LiteralPath $outCsv -Encoding UTF8 -Force
        'Path,Error' | Out-File -LiteralPath $errCsv -Encoding UTF8 -Force
        Write-Host ''
        continue
    }

    Write-Host "  Materialised: $($peek.Count) item(s) visible"
    $peek | ForEach-Object { Write-Host "    $($_.Name)" }

    Write-Host "  Exporting..." -NoNewline
    $result = Export-Subtree -Subtree $subtree -OutCsv $outCsv -ErrCsv $errCsv
    Write-Host " done." -ForegroundColor Green
    Write-Host "  OK drive=$slug rows=$($result.Rows) dir_errors=$($result.Errors) subtree=$subtree"

    $summary += [PSCustomObject]@{
        Slug    = $slug
        Status  = 'OK'
        Subtree = $subtree
        Rows    = $result.Rows
        Errors  = $result.Errors
    }
    Write-Host ''
}

# ── QC report ─────────────────────────────────────────────────────────────────

Write-Host '=== QC REPORT ===' -ForegroundColor Cyan
$qcPath = Join-Path $exportDir 'inventory_qc_report.csv'
$qcRows = @()
$good = @()
$bad = @()

Get-ChildItem -Path $exportDir -Filter '*.csv' |
Where-Object { $_.Name -ne 'inventory_qc_report.csv' -and $_.Name -notlike '*.errors.csv' } |
Sort-Object Name |
ForEach-Object {
    $bytes = $_.Length
    $lines = (Get-Content -LiteralPath $_.FullName | Measure-Object -Line).Lines
    $status = if ($bytes -lt 200 -or $lines -lt 3) { 'BAD' } else { 'GOOD' }
    if ($status -eq 'GOOD') { $good += $_.Name }
    else { $bad += [PSCustomObject]@{ File = $_.Name; Bytes = $bytes; Lines = $lines } }
    $qcRows += [PSCustomObject]@{ File = $_.Name; Bytes = $bytes; Lines = $lines; Status = $status }
}

$qcRows | Export-Csv -LiteralPath $qcPath -NoTypeInformation -Encoding UTF8
Write-Host "QC written: $qcPath"
Write-Host ''

# ── Summary ───────────────────────────────────────────────────────────────────

Write-Host '========================================'
Write-Host '  FINAL QA SUMMARY'
Write-Host '========================================'
Write-Host ''
Write-Host "GOOD inventories ($($good.Count)):" -ForegroundColor Green
$good | ForEach-Object { Write-Host "  [OK]  $_" -ForegroundColor Green }
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
Write-Host "TOTALS =>  GOOD: $($good.Count)   BAD: $($bad.Count)   TOTAL: $($qcRows.Count)" -ForegroundColor Cyan
Write-Host ''
Write-Host '=== MATERIALISATION SUMMARY ===' -ForegroundColor Cyan
$summary | Format-Table Slug, Status, Rows, Errors, Subtree -AutoSize
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green
