#Requires -Version 5.1
$repoRoot = $PSScriptRoot | Split-Path
$indexPath = Join-Path $repoRoot 'stack\DocControl_Audit_Index.csv'
$outPath = Join-Path $repoRoot 'stack\DocControl_Audit_MoveMap.csv'

function EscCsv($s) {
    if ($null -eq $s) { return '' }
    $s = "$s".Replace('"', '""')
    if ($s -match '[,"\r\n]') { return "`"$s`"" }
    return $s
}

# Drive slug map for staging paths
$driveSlug = @{
    '1. Corporate'                           = 'Corporate'
    '6. SAI Development'                     = 'SAI_Development'
    '7. Smart Tools & Hardware'              = 'Smart_Tools_Hardware'
    'TechSafe Operating System'              = 'TechSafe_OS'
    'TSI Product Services'                   = 'TSI_Product_Services'
    'TechSafe_Industries_Phase2_Build'       = 'Phase2_Build'
    '3. INTERGRATED MANAGMENT SYSTEMS (IMS)' = 'IMS'
    'Strategy / Empire Build'                = 'Strategy_Empire_Build'
}

$rows = Import-Csv -LiteralPath $indexPath -Encoding UTF8

$header = 'SourceDrive,CurrentPath,CurrentName,CurrentType,ProposedTSI01Path,ProposedName,RenameReason,Confidence'
Set-Content -LiteralPath $outPath -Value $header -Encoding UTF8

$counts = @{ High = 0; Med = 0; Low = 0 }

foreach ($row in $rows) {
    $name = $row.Name
    $path = $row.FullName
    $drive = $row.SourceDrive
    $isDir = $row.IsDirectory
    $type = if ($isDir -eq 'True') { 'Folder' } else { 'File' }

    # Skip noise
    if ($name -match 'desktop\.ini') { continue }

    # Current path = parent portion of FullName
    $currentPath = ($path -replace '\\[^\\]+$', '')

    # ── Mapping rules ─────────────────────────────────────────────────────────
    $proposed = ''
    $reason = ''
    $confidence = 'Low'

    $nameUpper = $name.ToUpper()
    $pathUpper = $path.ToUpper()

    # Rule 1 — Security or Access
    if ($pathUpper -match 'SECURITY' -or $nameUpper -match 'SECURITY' -or $nameUpper -match 'ACCESS CONTROL') {
        $proposed = 'TSI-01 DocControl.GOOGLE\01_Governance\Policies\Security_And_Access_Control\INCOMING\'
        $reason = 'Decision A canonical security location'
        $confidence = 'High'
    }
    # Rule 2 — Policy
    elseif ($pathUpper -match 'POLICY' -or $nameUpper -match 'POLICY' -or $nameUpper -match 'POLICIES') {
        $proposed = 'TSI-01 DocControl.GOOGLE\01_Governance\Policies\INCOMING\'
        $reason = 'Policy document — governance folder'
        $confidence = 'Med'
    }
    # Rule 3 — Register
    elseif ($nameUpper -match 'REGISTER' -or $nameUpper -match 'CHANGE LOG' -or $nameUpper -match 'CHANGE REGISTER') {
        $proposed = 'TSI-01 DocControl.GOOGLE\01_Governance\Registers\INCOMING\'
        $reason = 'Register document — governance folder'
        $confidence = 'Med'
    }
    # Rule 4 — Everything else → staging
    else {
        $slug = if ($driveSlug.ContainsKey($drive)) { $driveSlug[$drive] } else { ($drive -replace '[^A-Za-z0-9_]', '_') }
        $proposed = "TSI-01 DocControl.GOOGLE\99_Staging\$slug\"
        $reason = 'Staging pending classification'
        $confidence = 'Low'
    }

    $counts[$confidence]++

    $cols = @(
        (EscCsv $drive),
        (EscCsv $currentPath),
        (EscCsv $name),
        (EscCsv $type),
        (EscCsv $proposed),
        (EscCsv $name),   # ProposedName = CurrentName (preserve)
        (EscCsv $reason),
        (EscCsv $confidence)
    )
    Add-Content -LiteralPath $outPath -Value ($cols -join ',') -Encoding UTF8
}

$total = $counts.High + $counts.Med + $counts.Low
Write-Host "MoveMap written: $outPath"
Write-Host "  High confidence : $($counts.High)"
Write-Host "  Med  confidence : $($counts.Med)"
Write-Host "  Low  confidence : $($counts.Low)"
Write-Host "  TOTAL           : $total rows"
