$dest = 'C:\Users\mikes\.gemini\antigravity\scratch\openclaw\exports\drive_inventory'

# Remove the two raw un-renamed Corporate copies left over from the copy step
$toRemove = @(
    'TSI_Drive_Inventory_1. Corporate.csv',
    'TSI_Drive_Inventory_1_Corporate.csv'
)

foreach ($name in $toRemove) {
    $p = Join-Path $dest $name
    if (Test-Path $p) {
        Remove-Item $p -Force
        Write-Host "Removed: $name"
    }
}

Write-Host "Cleanup done."
Write-Host ""
Write-Host "Final exports\drive_inventory contents:"
Get-ChildItem -Path $dest | Sort-Object Name | Format-Table Name, Length -AutoSize
