<#
.SYNOPSIS
    CDMS Inventory Exporter (DriveFS -> CSV)
    Scans a DriveFS root and exports a detailed inventory.

.PARAMETER DriveName    Friendly name of the Drive (e.g. "1. Corporate")
.PARAMETER RootPath     Optional sub-root under G:\Shared drives\<DriveName>
.PARAMETER RunId        Shared ID to link multiple exports.
.PARAMETER OutCsv       Override output CSV path.

.EXAMPLE
    powershell -File scripts/cdms_export_inventory.ps1 -DriveName "1. Corporate" -RunId "run_123"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$DriveName,

    [string]$RootPath = "",
    
    [Parameter(Mandatory = $true)]
    [string]$RunId,

    [string]$OutCsv = ""
)

$ErrorActionPreference = 'Stop'

# 1. Resolve full path
$baseDrivePath = "G:\Shared drives\$DriveName"
if (-not (Test-Path $baseDrivePath)) {
    Write-Error "FATAL: Shared drive not found: $baseDrivePath"
    exit 1
}

$fullRootPath = $baseDrivePath
if ($RootPath -ne "") {
    $fullRootPath = Join-Path $baseDrivePath $RootPath
}

if (-not (Test-Path $fullRootPath)) {
    Write-Error "FATAL: Root path not found: $fullRootPath"
    exit 1
}

# 2. Setup output paths
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$safeDriveName = $DriveName -replace '[^a-zA-Z0-9]', '_'
if ($OutCsv -eq "") {
    $OutCsv = "stack\drive_exports\$($safeDriveName)_inventory_$($timestamp).csv"
}
$OutSummary = $OutCsv -replace "\.csv$", ".summary.json"

# Ensure output directory exists
$outDir = Split-Path $OutCsv -Parent
if ($outDir -and -not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

# 3. Helper Functions
function EscapeCsv {
    param([string]$v)
    if ($null -eq $v) { return '""' }
    $v = $v -replace '"', '""'
    return ('"' + $v + '"')
}

# BFS Traversal
$queue = New-Object System.Collections.Generic.Queue[object]
$queue.Enqueue([PSCustomObject]@{ Path = $fullRootPath; RelPath = "" ; Depth = 0 })

$rowCount = 0
$dirCount = 0
$sw = [System.Diagnostics.Stopwatch]::StartNew()

Write-Host "INFO  Exporting Drive : $DriveName" -ForegroundColor Cyan
Write-Host "INFO  Scan Root      : $fullRootPath" -ForegroundColor Cyan
Write-Host "INFO  RunId          : $RunId" -ForegroundColor Cyan

# Column Headers
# RunId, DriveName, RootAbsPath, RelPath, FileName, Extension, SizeBytes, LastWriteTimeIso, IsDirectory, DocId, Url
$csvHeader = 'RunId,DriveName,RootAbsPath,RelPath,FileName,Extension,SizeBytes,LastWriteTimeIso,IsDirectory,DocId,Url'

$stream = [System.IO.StreamWriter]::new([System.IO.Path]::GetFullPath($OutCsv), $false, [System.Text.Encoding]::UTF8)
$stream.WriteLine($csvHeader)

while ($queue.Count -gt 0) {
    $item = $queue.Dequeue()
    $currentAbsPath = $item.Path
    $currentRelPath = $item.RelPath
    $depth = $item.Depth
    $dirCount++

    if ($dirCount % 50 -eq 0) {
        Write-Host "  Dirs: $dirCount, Rows: $rowCount, Queue: $($queue.Count)" -ForegroundColor DarkCyan
    }

    try {
        $children = Get-ChildItem -LiteralPath $currentAbsPath -Force -ErrorAction Stop
        foreach ($child in $children) {
            # Skip temp/system noise
            if ($child.Name -match '(?i)^thumbs\.db$|^\$RECYCLE\.BIN$|^System Volume Information$') { continue }

            $ext = $child.Extension
            $isDir = $child.PSIsContainer
            $docId = ""
            $url = ""
            $size = if ($isDir) { 0 } else { $child.Length }
            $modIso = $child.LastWriteTime.ToString("yyyy-MM-ddTHH:mm:ssZ")

            # Parse Google Doc files
            if ($ext -match '\.(gdoc|gsheet|gslides)$') {
                try {
                    $jsonContent = Get-Content -LiteralPath $child.FullName -Raw -ErrorAction SilentlyContinue
                    if ($jsonContent -match '\{.*\}') {
                        $meta = $jsonContent | ConvertFrom-Json
                        $docId = $meta.doc_id
                        $url = $meta.url
                    }
                }
                catch { }
            }

            $row = (EscapeCsv $RunId) + "," + 
            (EscapeCsv $DriveName) + "," + 
            (EscapeCsv $fullRootPath) + "," + 
            (EscapeCsv $currentRelPath) + "," + 
            (EscapeCsv $child.Name) + "," + 
            (EscapeCsv $ext) + "," + 
            $size + "," + 
            (EscapeCsv $modIso) + "," + 
            ($isDir.ToString().ToLower()) + "," + 
            (EscapeCsv $docId) + "," + 
            (EscapeCsv $url)
            
            $stream.WriteLine($row)
            $rowCount++

            if ($isDir) {
                $newRelPath = if ($currentRelPath -eq "") { $child.Name } else { Join-Path $currentRelPath $child.Name }
                $queue.Enqueue([PSCustomObject]@{ Path = $child.FullName; RelPath = $newRelPath; Depth = $depth + 1 })
            }
        }
    }
    catch {
        Write-Warning "Failed to scan folder: $currentAbsPath ($($_.Exception.Message))"
    }
}

$stream.Close()
$sw.Stop()

# Save Summary
$summary = @{
    RunId          = $RunId
    DriveName      = $DriveName
    RootPath       = $fullRootPath
    Timestamp      = $timestamp
    RowCount       = $rowCount
    DirsVisited    = $dirCount
    ElapsedSeconds = $sw.Elapsed.TotalSeconds
    CsvPath        = $OutCsv
}
$summary | ConvertTo-Json | Out-File -FilePath $OutSummary -Encoding UTF8 -Force

Write-Host "SUCCESS Export complete. Rows: $rowCount, Time: $($sw.Elapsed.ToString('mm\:ss'))" -ForegroundColor Green
exit 0
