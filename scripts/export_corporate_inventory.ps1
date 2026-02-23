<#
.SYNOPSIS
    Export Google Drive for Desktop (DriveFS) Corporate shared drive to CSV.
    Hardened BFS traversal: per-directory retry, streaming output, PS5 compatible.

.PARAMETER OutCsv      Path for row-level CSV output.
.PARAMETER OutErrors   Path for error CSV.
.PARAMETER OutSummary  Path for JSON summary.
.PARAMETER MaxDepth    Max BFS depth (default 50).
.PARAMETER FoldersOnly Enumerate directories only (no file rows).
.PARAMETER RetryDelayMs Milliseconds before retry on failed directory (default 800).

.EXAMPLE
    # Standard full export
    powershell -ExecutionPolicy Bypass -File scripts\export_corporate_inventory.ps1

.EXAMPLE
    # Structure-only fast pass
    powershell -ExecutionPolicy Bypass -File scripts\export_corporate_inventory.ps1 -FoldersOnly

.EXAMPLE
    # Shallow test (5 levels)
    powershell -ExecutionPolicy Bypass -File scripts\export_corporate_inventory.ps1 -MaxDepth 5
#>

[CmdletBinding()]
param(
    [string]$OutCsv = ".\exports\drive_inventory\corporate_inventory.csv",
    [string]$OutErrors = ".\exports\drive_inventory\corporate_inventory.errors.csv",
    [string]$OutSummary = ".\exports\drive_inventory\corporate_inventory.summary.json",
    [int]   $MaxDepth = 50,
    [switch]$FoldersOnly,
    [int]   $RetryDelayMs = 800,
    # -RootOverride: skip auto-resolve; use this literal path as root instead.
    [string]$RootOverride = "",
    # -Probe: diagnostic mode only. No CSV written. Reports dirs/errors/first 10 fail paths.
    [switch]$Probe
)

$ErrorActionPreference = 'Continue'

# ---------------------------------------------------------------------------
# HELPER FUNCTIONS (defined early so Probe mode can use them)
# ---------------------------------------------------------------------------
function EscapeCsv {
    param([string]$v)
    $v = $v -replace '"', '""'
    return ('"' + $v + '"')
}

function ClassifyError {
    param([string]$msg)
    if ($msg -match 'not available offline|placeholder|stub|cloud.only' ) { return 'DriveFS_Offline_Placeholder' }
    if ($msg -match 'Access.*denied|UnauthorizedAccess|PermissionDenied'  ) { return 'Access_Denied' }
    if ($msg -match 'path.*too long|exceed.*260|MAX_PATH'                 ) { return 'Path_Too_Long' }
    if ($msg -match 'does not exist|cannot find path|not found'           ) { return 'Path_Not_Found' }
    if ($msg -match 'timeout|timed out'                                   ) { return 'Timeout' }
    return 'Other'
}

function IncrError {
    param([string]$t)
    if ($script:errorTypes.ContainsKey($t)) { $script:errorTypes[$t]++ }
    else { $script:errorTypes[$t] = 1 }
}

# ---------------------------------------------------------------------------
# STEP 1: Resolve root path
# If -RootOverride is supplied, trim and use it directly.
# Otherwise auto-enumerate the parent and match the first directory whose
# name starts with "TSi" and contains "Corporate".
# Using -LiteralPath + wildcard Name match makes this immune to em-dash /
# encoding issues and trailing whitespace in the default parameter value.
# ---------------------------------------------------------------------------
$driveParent = "G:\Shared drives\1. Corporate"
if ($RootOverride -ne '') {
    $RootPath = $RootOverride.Trim()
    Write-Host "INFO  Root override : $RootPath" -ForegroundColor Yellow
}
else {
    $rootDir = Get-ChildItem -LiteralPath $driveParent -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^TSi' -and $_.Name -match 'Corporate' } |
    Select-Object -First 1
    if ($null -eq $rootDir) {
        Write-Error "FATAL: Cannot find 'TSi*Corporate' under '$driveParent'. Check DriveFS mount."
        exit 1
    }
    $RootPath = $rootDir.FullName.Trim()
}
Write-Host "INFO  Root resolved : $RootPath" -ForegroundColor Cyan
Write-Host "INFO  FoldersOnly   : $FoldersOnly" -ForegroundColor Cyan
Write-Host "INFO  Probe mode    : $Probe" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# PROBE MODE: diagnostic-only, no CSV written
# Reports: dirs visited, dirs failing, first 10 failing paths + errors,
# error type counts. Exits after report.
# ---------------------------------------------------------------------------
if ($Probe) {
    Write-Host ""
    Write-Host "=== PROBE MODE ==" -ForegroundColor Yellow
    $pQueue = New-Object System.Collections.Generic.Queue[object]
    $pQueue.Enqueue([PSCustomObject]@{ Path = $RootPath; Depth = 0 })
    $pOk = 0
    $pFail = 0
    $pRows = 0
    $pErrTypes = @{}
    $pFailList = @()
    $psw = [System.Diagnostics.Stopwatch]::StartNew()

    while ($pQueue.Count -gt 0) {
        $pi = $pQueue.Dequeue()
        $pPath = $pi.Path
        $pDepth = $pi.Depth
        if ($pDepth -gt $MaxDepth) { continue }
        try {
            $pChildren = @(Get-ChildItem -LiteralPath $pPath -Force -ErrorAction Stop)
            $pOk++
            $pRows += ($pChildren | Where-Object { -not $_.PSIsContainer }).Count
            if ($pDepth -lt $MaxDepth) {
                $pChildren | Where-Object { $_.PSIsContainer } | ForEach-Object {
                    $pQueue.Enqueue([PSCustomObject]@{ Path = $_.FullName; Depth = $pDepth + 1 })
                }
            }
        }
        catch {
            $pFail++
            $pMsg = $_.Exception.Message -replace "`r|`n", ' '
            $pType = ClassifyError $pMsg
            if ($pErrTypes.ContainsKey($pType)) { $pErrTypes[$pType]++ } else { $pErrTypes[$pType] = 1 }
            if ($pFailList.Count -lt 10) {
                $pFailList += [PSCustomObject]@{ Path = $pPath; ErrType = $pType; Msg = $pMsg }
            }
        }
    }
    $psw.Stop()

    Write-Host ("  Dirs visited   : {0}" -f ($pOk + $pFail))
    Write-Host ("  Dirs OK        : {0}" -f $pOk)
    Write-Host ("  Dirs FAIL      : {0}" -f $pFail)
    Write-Host ("  Files found    : {0}" -f $pRows)
    Write-Host ("  Elapsed        : {0:mm\:ss}" -f $psw.Elapsed)
    Write-Host ""
    Write-Host "  Error type counts:" -ForegroundColor Yellow
    $pErrTypes.GetEnumerator() | Sort-Object Value -Descending | ForEach-Object {
        Write-Host ("    [{0,4}]  {1}" -f $_.Value, $_.Key) -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "  First failing directories:" -ForegroundColor Red
    $pFailList | ForEach-Object {
        Write-Host ("    [{0}] {1}" -f $_.ErrType, $_.Path) -ForegroundColor Red
        $shortMsg = $_.Msg; if ($shortMsg.Length -gt 120) { $shortMsg = $shortMsg.Substring(0, 117) + "..." }
        Write-Host ("      -> {0}" -f $shortMsg) -ForegroundColor DarkRed
    }
    Write-Host ""
    Write-Host "=== PROBE COMPLETE ==" -ForegroundColor Yellow
    exit 0
}
Write-Host "INFO  MaxDepth      : $MaxDepth" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# STEP 2: Ensure output directories
# ---------------------------------------------------------------------------
foreach ($outFile in @($OutCsv, $OutErrors, $OutSummary)) {
    $parent = Split-Path $outFile -Parent
    if ($parent -and -not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
}

# ---------------------------------------------------------------------------
# STEP 3: Open streaming writers (overwrite prior runs)
# ---------------------------------------------------------------------------
$csvHeader = '"File Name","Current Folder Path","Type","Last Modified","Size","Depth","Parent Path"'
$errHeader = '"Path","ErrorType","Error"'

$absOutCsv = [System.IO.Path]::GetFullPath($OutCsv)
$absOutErrors = [System.IO.Path]::GetFullPath($OutErrors)

$csvWriter = New-Object System.IO.StreamWriter($absOutCsv, $false, [System.Text.Encoding]::UTF8)
$errWriter = New-Object System.IO.StreamWriter($absOutErrors, $false, [System.Text.Encoding]::UTF8)
$csvWriter.WriteLine($csvHeader)
$errWriter.WriteLine($errHeader)
$csvWriter.Flush()
$errWriter.Flush()

# ---------------------------------------------------------------------------
# STEP 4: Counters
# (helper functions are defined at top of script)
# ---------------------------------------------------------------------------
$rowCount = 0
$errCount = 0
$dirCount = 0
$errorTypes = @{}

# ---------------------------------------------------------------------------
# STEP 5: BFS traversal
# ---------------------------------------------------------------------------
$queue = New-Object System.Collections.Generic.Queue[object]
$queue.Enqueue([PSCustomObject]@{ Path = $RootPath; Depth = 0 })

$sw = [System.Diagnostics.Stopwatch]::StartNew()

while ($queue.Count -gt 0) {
    $item = $queue.Dequeue()
    $dirPath = $item.Path
    $depth = $item.Depth
    $dirCount++

    if ($depth -gt $MaxDepth) { continue }

    # Progress heartbeat every 25 directories
    if ($dirCount % 25 -eq 0) {
        $elapsed = $sw.Elapsed.ToString("mm\:ss")
        Write-Host ("  dirs={0,5}  rows={1,6}  errs={2,3}  t={3}  q={4}" -f `
                $dirCount, $rowCount, $errCount, $elapsed, $queue.Count) -ForegroundColor DarkCyan
    }

    # Attempt up to 2 times per directory
    $children = $null
    $lastErr = $null

    for ($attempt = 1; $attempt -le 2; $attempt++) {
        try {
            $children = @(Get-ChildItem -LiteralPath $dirPath -Force -ErrorAction Stop)
            $lastErr = $null
            break
        }
        catch {
            $lastErr = $_
            if ($attempt -eq 1) {
                Start-Sleep -Milliseconds $RetryDelayMs
            }
        }
    }

    if ($null -ne $lastErr) {
        $errMsg = ($lastErr.Exception.Message) -replace "`r|`n", ' '
        $errType = ClassifyError $errMsg
        $errWriter.WriteLine((EscapeCsv $dirPath) + ',' + (EscapeCsv $errType) + ',' + (EscapeCsv $errMsg))
        $errWriter.Flush()
        $errCount++
        IncrError $errType
        continue
    }

    # Emit file rows
    if (-not $FoldersOnly) {
        foreach ($f in ($children | Where-Object { -not $_.PSIsContainer })) {
            try {
                $modified = $f.LastWriteTime.ToString("dd/MM/yyyy HH:mm:ss")
                $row = (EscapeCsv $f.Name) + ',' + (EscapeCsv $f.DirectoryName) + ',' +
                (EscapeCsv $f.Extension) + ',' + (EscapeCsv $modified) + ',' +
                $f.Length + ',' + $depth + ',' + (EscapeCsv $dirPath)
                $csvWriter.WriteLine($row)
                $rowCount++
            }
            catch {
                $em = $_.Exception.Message -replace "`r|`n", ' '
                $et = ClassifyError $em
                $errWriter.WriteLine((EscapeCsv ($f.DirectoryName + '\' + $f.Name)) + ',' + (EscapeCsv $et) + ',' + (EscapeCsv $em))
                $errCount++
                IncrError $et
            }
        }
        $csvWriter.Flush()
    }
    else {
        # FoldersOnly: emit one row per subdirectory
        foreach ($d in ($children | Where-Object { $_.PSIsContainer })) {
            try {
                $modified = $d.LastWriteTime.ToString("dd/MM/yyyy HH:mm:ss")
                $row = (EscapeCsv $d.Name) + ',' + (EscapeCsv $d.Parent.FullName) + ',' +
                '"<DIR>",' + (EscapeCsv $modified) + ',,' + $depth + ',' + (EscapeCsv $dirPath)
                $csvWriter.WriteLine($row)
                $rowCount++
            }
            catch { }
        }
        $csvWriter.Flush()
    }

    # Enqueue subdirectories
    if ($depth -lt $MaxDepth) {
        foreach ($d in ($children | Where-Object { $_.PSIsContainer })) {
            $queue.Enqueue([PSCustomObject]@{ Path = $d.FullName; Depth = ($depth + 1) })
        }
    }
}

$csvWriter.Close()
$errWriter.Close()
$sw.Stop()

# ---------------------------------------------------------------------------
# STEP 6: Build summary JSON
# ---------------------------------------------------------------------------
$topErrList = $errorTypes.GetEnumerator() |
Sort-Object Value -Descending |
Select-Object -First 5 |
ForEach-Object { '{"type":"' + $_.Key + '","count":' + $_.Value + '}' }

$topErrJson = '[' + ($topErrList -join ',') + ']'
$summaryJson = '{' +
'"generated_at":"' + (Get-Date -Format "yyyy-MM-ddTHH:mm:ss") + '",' +
'"root_path":"' + ($RootPath -replace '\\', '\\') + '",' +
'"folders_only":' + ($FoldersOnly.IsPresent | ConvertTo-Json) + ',' +
'"max_depth":' + $MaxDepth + ',' +
'"elapsed_seconds":' + ([math]::Round($sw.Elapsed.TotalSeconds, 1)) + ',' +
'"dirs_visited":' + $dirCount + ',' +
'"rows_written":' + $rowCount + ',' +
'"dir_errors":' + $errCount + ',' +
'"top_errors":' + $topErrJson +
'}'

$summaryJson | Out-File -FilePath $OutSummary -Encoding UTF8 -Force

# ---------------------------------------------------------------------------
# STEP 7: Print report
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  Corporate Drive Export -- COMPLETE"            -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ("  Root         : {0}" -f $RootPath)
Write-Host ("  Rows written : {0}" -f $rowCount)
Write-Host ("  Dir errors   : {0}" -f $errCount)
Write-Host ("  Dirs visited : {0}" -f $dirCount)
Write-Host ("  Elapsed      : {0:mm\:ss}" -f $sw.Elapsed)
Write-Host ""

if ($errCount -gt 0) {
    Write-Host "  Top error types:" -ForegroundColor Yellow
    $errorTypes.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 5 | ForEach-Object {
        Write-Host ("    [{0,4}]  {1}" -f $_.Value, $_.Key) -ForegroundColor Yellow
    }
    Write-Host ""
}

# ---------------------------------------------------------------------------
# STEP 8: Remediation if zero rows
# ---------------------------------------------------------------------------
if ($rowCount -eq 0 -and $errCount -gt 0) {
    Write-Host "  WARNING: ZERO ROWS with errors -- remediation required." -ForegroundColor Red
    Write-Host ""
    $topType = ($errorTypes.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1).Key
    if ($null -eq $topType) { $topType = 'Other' }

    if ($topType -eq 'DriveFS_Offline_Placeholder') {
        Write-Host "REMEDIATION: Files are cloud-only (not synced offline)." -ForegroundColor Cyan
        Write-Host "  1. Open Windows Explorer." -ForegroundColor Cyan
        Write-Host "  2. Navigate to: G:\Shared drives\1. Corporate" -ForegroundColor Cyan
        Write-Host "  3. Right-click 'TSi -- Corporate' -> Google Drive -> 'Make available offline'" -ForegroundColor Cyan
        Write-Host "  4. Wait for sync to complete (green tick on folder), then rerun:" -ForegroundColor Cyan
        Write-Host "       npm run drive:export-corporate" -ForegroundColor Cyan
    }
    elseif ($topType -eq 'Access_Denied') {
        Write-Host "REMEDIATION: Access denied on some directories." -ForegroundColor Yellow
        Write-Host "  1. Open: https://drive.google.com/drive/shared-drives" -ForegroundColor Yellow
        Write-Host "  2. Check 1. Corporate -- require at least Content Manager access." -ForegroundColor Yellow
        Write-Host "  3. Ask your Google Workspace admin to grant access." -ForegroundColor Yellow
        Write-Host "  4. Re-mount DriveFS then rerun: npm run drive:export-corporate" -ForegroundColor Yellow
    }
    elseif ($topType -eq 'Path_Too_Long') {
        Write-Host "REMEDIATION: Windows MAX_PATH (260 chars) exceeded." -ForegroundColor Yellow
        Write-Host "  OPTION A (Admin): Enable long paths in registry:" -ForegroundColor Yellow
        Write-Host "    reg add HKLM\SYSTEM\CurrentControlSet\Control\FileSystem /v LongPathsEnabled /t REG_DWORD /d 1 /f" -ForegroundColor Yellow
        Write-Host "  OPTION B: Run with shallow depth:" -ForegroundColor Yellow
        Write-Host "    powershell -ExecutionPolicy Bypass -File scripts\export_corporate_inventory.ps1 -FoldersOnly -MaxDepth 6" -ForegroundColor Yellow
    }
    else {
        Write-Host "REMEDIATION: Check the errors CSV for details:" -ForegroundColor Yellow
        Write-Host ("  {0}" -f $OutErrors) -ForegroundColor Yellow
    }
    exit 1
}

Write-Host "  Export successful." -ForegroundColor Green
exit 0
