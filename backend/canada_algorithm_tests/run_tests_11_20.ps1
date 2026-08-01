$ErrorActionPreference = "Continue"
$cases = Get-ChildItem -Path $PSScriptRoot -Directory |
    Where-Object { $_.Name -match '^case_(1[1-9]|20)_' } |
    Sort-Object Name

$failed = @()
foreach ($case in $cases) {
    Write-Host "`n============================================================" -ForegroundColor Cyan
    Write-Host "RUNNING $($case.Name)" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan

    py "$PSScriptRoot\..\manage.py" run_allocation_case $case.Name --max-seconds 60

    if ($LASTEXITCODE -ne 0) {
        $failed += $case.Name
    }
}

Write-Host "`n================ SUITE SUMMARY ================"
Write-Host "Total: $($cases.Count)"
Write-Host "Passed: $($cases.Count - $failed.Count)"
Write-Host "Failed: $($failed.Count)"

if ($failed.Count -gt 0) {
    Write-Host ($failed -join "`n") -ForegroundColor Red
    exit 1
}

Write-Host "ALL TESTS PASSED" -ForegroundColor Green
