#Requires -Version 5.1
$repoRoot = $PSScriptRoot | Split-Path
$mapPath = Join-Path $repoRoot 'stack\DocControl_Audit_MoveMap.csv'
$outPath = Join-Path $repoRoot 'stack\DocControl_MoveBatch_High.csv'

$rows = Import-Csv -LiteralPath $mapPath -Encoding UTF8
$high = $rows | Where-Object { $_.Confidence -eq 'High' }

$high | Select-Object SourceDrive, CurrentPath, CurrentName, ProposedTSI01Path, ProposedName, RenameReason, Confidence |
Export-Csv -LiteralPath $outPath -NoTypeInformation -Encoding UTF8

Write-Host '=== DocControl_MoveBatch_High.csv ===' -ForegroundColor Cyan
Write-Host ''
Get-Content -LiteralPath $outPath | Select-Object -First 20 | ForEach-Object { Write-Host $_ }
Write-Host ''
Write-Host '=== Summary ===' -ForegroundColor Cyan
Write-Host ("  HighCount    : " + $high.Count)
$drives = ($high | Select-Object -ExpandProperty SourceDrive -Unique) -join ', '
Write-Host ("  SourceDrives : " + $drives)
