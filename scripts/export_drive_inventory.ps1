<#
.SYNOPSIS
    Generic Google Drive for Desktop (DriveFS) inventory exporter.
    Exports a shared drive or subfolder to CSV with BFS traversal.

.PARAMETER RootPath     The filesystem path to export.
.PARAMETER DriveName    Friendly name for the drive (used for default output paths).
.PARAMETER OutCsv       Explicit path for row-level CSV output.
.PARAMETER MaxDepth     Max BFS depth (default 50).

.EXAMPLE
    powershell -File scripts/export_drive_inventory.ps1 -RootPath "G:\Shared drives\1. Corporate" -DriveName "Corporate"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RootPath,
    
    [Parameter(Mandatory = $true)]
    [string]$DriveName,

    [string]$OutCsv = "",
    [int]   $MaxDepth = 50,
    [switch]$FoldersOnly,
    [int]   $RetryDelayMs = 800
)

$ErrorActionPreference = 'Stop'

# 1. Validate DriveFS mount
if (-not (Test-Path "G:\Shared drives")) {
    Write-Error "FATAL: 'G:\Shared drives' not found. Is Google Drive for Desktop running and mounted as G:?"
    exit 1
}

if (-not (Test-Path $RootPath)) {
    Write-Error "FATAL: Root path not found: $RootPath"
    exit 1
}

# 2. Setup output paths
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
if ($OutCsv -eq "") {
    $OutCsv = "stack\drive_exports\$($DriveName)_inventory_$($timestamp).csv"
}
$OutErrors = $OutCsv -replace "\.csv$", ".errors.csv"
$OutSummary = $OutCsv -replace "\.csv$", ".summary.json"

# Ensure output directory exists
$outDir = Split-Path $OutCsv -Parent
if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

# 3. Helper Functions
function EscapeCsv {
    param([string]$v)
    if ($null -eq $v) { return '""' }
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

# 4. Initialize Writers
$csvWriter = New-Object System.IO.StreamWriter([System.IO.Path]::GetFullPath($OutCsv), $false, [System.Text.Encoding]::UTF8)
$errWriter = New-Object System.IO.StreamWriter([System.IO.Path]::GetFullPath($OutErrors), $false, [System.Text.Encoding]::UTF8)

$csvHeader = '"File Name","Current Folder Path","Type","Last Modified","Size","Depth","Parent Path"'
$errHeader = '"Path","ErrorType","Error"'

$csvWriter.WriteLine($csvHeader)
$errWriter.WriteLine($errHeader)

# 5. BFS Traversal
$queue = New-Object System.Collections.Generic.Queue[object]
$queue.Enqueue([PSCustomObject]@{ Path = $RootPath; Depth = 0 })

$rowCount = 0
$errCount = 0
$dirCount = 0
$errorTypes = @{}
$sw = [System.Diagnostics.Stopwatch]::StartNew()

Write-Host "INFO  Exporting Drive : $DriveName" -ForegroundColor Cyan
Write-Host "INFO  Root Path      : $RootPath" -ForegroundColor Cyan
Write-Host "INFO  Output CSV     : $OutCsv" -ForegroundColor Cyan

while ($queue.Count -gt 0) {
    $item = $queue.Dequeue()
    $dirPath = $item.Path
    $depth = $item.Depth
    $dirCount++

    if ($depth -gt $MaxDepth) { continue }

    if ($dirCount % 50 -eq 0) {
        Write-Host "  Dirs: $dirCount, Rows: $rowCount, Errs: $errCount, Queue: $($queue.Count)" -ForegroundColor DarkCyan
    }

    $children = $null
    $lastErr = $null

    # Retry logic
    for ($attempt = 1; $attempt -le 2; $attempt++) {
        try {
            $children = @(Get-ChildItem -LiteralPath $dirPath -Force -ErrorAction Stop)
            $lastErr = $null
            break
        }
        catch {
            $lastErr = $_
            if ($attempt -eq 1) { Start-Sleep -Milliseconds $RetryDelayMs }
        }
    }

    if ($null -ne $lastErr) {
        $msg = $lastErr.Exception.Message -replace "`r|`n", ' '
        $type = ClassifyError $msg
        $errWriter.WriteLine((EscapeCsv $dirPath) + "," + (EscapeCsv $type) + "," + (EscapeCsv $msg))
        $errCount++
        if ($errorTypes.ContainsKey($type)) { $errorTypes[$type]++ } else { $errorTypes[$type] = 1 }
        continue
    }

    foreach ($child in $children) {
        try {
            if ($child.PSIsContainer) {
                if ($FoldersOnly) {
                    $mod = $child.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
                    $row = (EscapeCsv $child.Name) + "," + (EscapeCsv $child.Parent.FullName) + ',"<DIR>",' + (EscapeCsv $mod) + ",," + $depth + "," + (EscapeCsv $dirPath)
                    $csvWriter.WriteLine($row)
                    $rowCount++
                }
                
                if ($depth -lt $MaxDepth) {
                    $queue.Enqueue([PSCustomObject]@{ Path = $child.FullName; Depth = ($depth + 1) })
                }
            }
            else {
                if (-not $FoldersOnly) {
                    $mod = $child.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
                    $row = (EscapeCsv $child.Name) + "," + (EscapeCsv $child.DirectoryName) + "," + (EscapeCsv $child.Extension) + "," + (EscapeCsv $mod) + "," + $child.Length + "," + $depth + "," + (EscapeCsv $dirPath)
                    $csvWriter.WriteLine($row)
                    $rowCount++
                }
            }
        }
        catch {
            $msg = $_.Exception.Message -replace "`r|`n", ' '
            $type = ClassifyError $msg
            $errWriter.WriteLine((EscapeCsv $child.FullName) + "," + (EscapeCsv $type) + "," + (EscapeCsv $msg))
            $errCount++
        }
    }
    
    if ($dirCount % 100 -eq 0) {
        $csvWriter.Flush()
        $errWriter.Flush()
    }
}

$csvWriter.Close()
$errWriter.Close()
$sw.Stop()

# 6. Save Summary
$summary = @{
    DriveName      = $DriveName
    RootPath       = $RootPath
    Timestamp      = $timestamp
    RowCount       = $rowCount
    ErrorCount     = $errCount
    DirsVisited    = $dirCount
    ElapsedSeconds = $sw.Elapsed.TotalSeconds
}
$summary | ConvertTo-Json | Out-File -FilePath $OutSummary -Encoding UTF8 -Force

Write-Host "SUCCESS Export complete. Rows: $rowCount, Errors: $errCount, Time: $($sw.Elapsed.ToString('mm\:ss'))" -ForegroundColor Green
exit 0
