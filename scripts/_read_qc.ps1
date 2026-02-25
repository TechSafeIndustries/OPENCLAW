# _read_qc.ps1
$exportDir = 'C:\Users\mikes\.gemini\antigravity\scratch\openclaw\exports\drive_inventory'

$good = @()
$bad = @()

Get-ChildItem -Path $exportDir -Filter '*.csv' |
Where-Object { $_.Name -ne 'inventory_qc_report.csv' -and $_.Name -notlike '*.errors.csv' } |
Sort-Object Name |
ForEach-Object {
    $bytes = $_.Length
    $lines = (Get-Content $_.FullName | Measure-Object -Line).Lines
    $status = if ($bytes -lt 200 -or $lines -lt 3) { 'BAD' } else { 'GOOD' }
    if ($status -eq 'GOOD') { $good += $_.Name }
    else {
        $bad += [PSCustomObject]@{ File = $_.Name; Bytes = $bytes; Lines = $lines }
    }
    [PSCustomObject]@{ File = $_.Name; Bytes = $bytes; Lines = $lines; Status = $status }
} | Format-Table -AutoSize

Write-Host ''
Write-Host "GOOD ($($good.Count)):"
$good | ForEach-Object { Write-Host "  [OK]  $_" }
Write-Host ''
Write-Host "BAD ($($bad.Count)):"
$bad  | ForEach-Object { Write-Host "  [BAD] $($_.File)  |  $($_.Bytes) bytes  |  $($_.Lines) lines" }
Write-Host ''
Write-Host "TOTALS =>  GOOD: $($good.Count)   BAD: $($bad.Count)"
