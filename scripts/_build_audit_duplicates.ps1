#Requires -Version 5.1
$repoRoot = $PSScriptRoot | Split-Path
$indexPath = Join-Path $repoRoot 'stack\DocControl_Audit_Index.csv'
$outPath = Join-Path $repoRoot 'stack\DocControl_Audit_Duplicates.csv'

function EscCsv($s) {
    if ($null -eq $s) { return '' }
    $s = "$s".Replace('"', '""')
    if ($s -match '[,"\r\n]') { return "`"$s`"" }
    return $s
}

$rows = Import-Csv -LiteralPath $indexPath -Encoding UTF8

# ── Pass 1: exact key = lower(Name)|Extension|Length ─────────────────────────
$exactGroups = $rows | Group-Object {
    ("$($_.Name)".ToLower().Trim()) + '|' + ("$($_.Extension)".ToLower().Trim()) + '|' + ("$($_.Length)".Trim())
} | Where-Object { $_.Count -gt 1 } | Sort-Object Count -Descending

# ── Pass 2: same parent folder + same extension → version variant pairs ───────
# Key = lower(parent path)|extension
$variantGroups = $rows | Where-Object { $_.IsDirectory -ne 'True' } | Group-Object {
    $parent = ($_.FullName -replace '\\[^\\]+$', '').ToLower().Trim()
    $ext = "$($_.Extension)".ToLower().Trim()
    "$parent|$ext"
} | Where-Object { $_.Count -gt 1 -and $_.Count -le 6 } | Sort-Object Count -Descending

# ── Write output ──────────────────────────────────────────────────────────────
$header = 'DuplicateType,DuplicateKey,Count,Instances,RecommendedAction'
Set-Content -LiteralPath $outPath -Value $header -Encoding UTF8

foreach ($g in $exactGroups) {
    $instances = ($g.Group | ForEach-Object { $_.FullName }) -join ' | '
    $cols = @('ExactMatch', (EscCsv $g.Name), (EscCsv $g.Count), (EscCsv $instances), 'Review')
    Add-Content -LiteralPath $outPath -Value ($cols -join ',') -Encoding UTF8
}

foreach ($g in $variantGroups) {
    # Skip if all files are already captured by an exact match group
    $instances = ($g.Group | ForEach-Object { $_.FullName }) -join ' | '
    $cols = @('SameFolder-SameExt', (EscCsv $g.Name), (EscCsv $g.Count), (EscCsv $instances), 'Review')
    Add-Content -LiteralPath $outPath -Value ($cols -join ',') -Encoding UTF8
}

$total = $exactGroups.Count + $variantGroups.Count
Write-Host "Duplicates: $($exactGroups.Count) exact, $($variantGroups.Count) same-folder variant groups => $total rows written to $outPath"
Write-Host ""
Write-Host "Exact matches:"
$exactGroups | ForEach-Object { Write-Host ("  [{0:D2}x] {1}" -f $_.Count, $_.Name) }
Write-Host "Same-folder variants (top 10):"
$variantGroups | Select-Object -First 10 | ForEach-Object { Write-Host ("  [{0:D2}x] {1}" -f $_.Count, $_.Name) }
