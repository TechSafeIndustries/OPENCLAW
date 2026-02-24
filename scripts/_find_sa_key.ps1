# _find_sa_key.ps1
# Find service account JSON files containing 'inspiring-bonus-487303' on this machine
$searchRoots = @(
    'C:\Users\mikes\Desktop',
    'C:\Users\mikes\Documents',
    'C:\Users\mikes\Downloads',
    'C:\Users\mikes\OneDrive',
    'C:\Users\mikes\.config',
    'C:\Users\mikes\.gemini',
    'C:\Users\mikes\AppData\Roaming\gcloud'
)

foreach ($root in $searchRoots) {
    if (-not (Test-Path $root)) { continue }
    Get-ChildItem -Path $root -Recurse -Filter '*.json' -ErrorAction SilentlyContinue |
    ForEach-Object {
        try {
            $content = Get-Content -LiteralPath $_.FullName -Raw -ErrorAction Stop
            if ($content -match 'inspiring-bonus-487303') {
                Write-Host "FOUND: $($_.FullName)" -ForegroundColor Green
            }
            elseif ($content -match 'openclaw-manager') {
                Write-Host "FOUND (by email): $($_.FullName)" -ForegroundColor Cyan
            }
        }
        catch {}
    }
}

Write-Host ""
Write-Host "Also checking GOOGLE_APPLICATION_CREDENTIALS env:"
Write-Host "  $($env:GOOGLE_APPLICATION_CREDENTIALS)"
