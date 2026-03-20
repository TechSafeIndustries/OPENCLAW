$InBatch = "stack\cdms_batches\MoveBatch_high_2026-02-24_18-48-47_repair1.csv"
$OutBatch = "stack\cdms_batches\MoveBatch_high_2026-02-24_18-48-47_repair1_CLEAN.csv"

$TargetHeaders = @(
    "BatchId", "SourceDrive", "CurrentPath", "CurrentName", "ProposedTSIPath", 
    "ProposedName", "CurrentType", "ProposedType", "RenameReason", "Confidence"
)

if (-not (Test-Path $InBatch)) {
    Write-Error "Input file not found: $InBatch"
    exit 1
}

# Read content and handle BOM by reading as a string first
$rawText = [System.IO.File]::ReadAllText((Resolve-Path $InBatch))
# Simple CSV parse
$csv = ConvertFrom-Csv $rawText

$CleanRows = New-Object System.Collections.Generic.List[PSObject]
$RowIndex = 1

foreach ($row in $csv) {
    $RowIndex++
    $cleanObj = [ordered]@{}
    $missingFields = @()

    foreach ($header in $TargetHeaders) {
        # Find matching key in row (case-insensitive, trimmed)
        $actualKey = $row.psobject.Properties.Name | Where-Object { $_.Trim().ToLower() -eq $header.ToLower() }
        $val = ""
        if ($actualKey) {
            $val = "$($row.$actualKey)".Trim()
        }

        # Validation: all target fields are required
        if ([string]::IsNullOrWhiteSpace($val)) {
            $missingFields += $header
        }
        $cleanObj[$header] = $val
    }

    if ($missingFields.Count -gt 0) {
        Write-Host "Row $RowIndex missing fields: $($missingFields -join ', ')" -ForegroundColor Red
        exit 1
    }

    $CleanRows.Add((New-Object PSObject -Property $cleanObj))
}

# Convert to CSV string line by line to ensure precise control over BOM
$csvLines = New-Object System.Collections.Generic.List[string]
$csvLines.Add(($TargetHeaders -join ","))

foreach ($row in $CleanRows) {
    $lineVals = @()
    foreach ($h in $TargetHeaders) {
        $v = $row.$h
        # Quote if needed
        if ($v -match '[,"]') {
            $v = '"' + $v.Replace('"', '""') + '"'
        }
        $lineVals += $v
    }
    $csvLines.Add(($lineVals -join ","))
}

# Write UTF-8 WITHOUT BOM
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllLines((Resolve-Path .).Path + "\" + $OutBatch, $csvLines, $Utf8NoBom)

Write-Host "CLEAN batch written to: $OutBatch" -ForegroundColor Green
