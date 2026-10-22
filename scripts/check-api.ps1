
# API smoke tests — Professional Navigator
# Запуск: powershell -ExecutionPolicy Bypass -File scripts/check-api.ps1

$baseUrl = "http://localhost:3000"
$sessionId = [guid]::NewGuid().ToString()
$passed = 0
$failed = 0

function Test-Api {
    param(
        [string]$Name,
        [string]$Path,
        [string]$Body,
        [hashtable]$Headers = @{},
        [int]$ExpectedStatus
    )

    try {
        $response = Invoke-WebRequest `
            -Uri "$baseUrl$Path" `
            -Method POST `
            -Headers $Headers `
            -ContentType "application/json" `
            -Body $Body `
            -UseBasicParsing `
            -ErrorAction Stop

        $actual = [int]$response.StatusCode
        $content = $response.Content
    }
    catch {
        $actual = 0
        $content = $_.Exception.Message

        if ($_.Exception.Response) {
            $actual = [int]$_.Exception.Response.StatusCode
        }
    }

    if ($actual -eq $ExpectedStatus) {
        Write-Host "PASS | $Name | HTTP $actual" -ForegroundColor Green
        $script:passed++
    }
    else {
        Write-Host "FAIL | $Name | Expected $ExpectedStatus, got $actual" -ForegroundColor Red
        Write-Host $content
        $script:failed++
    }
}

$validHeader = @{ "X-Session-ID" = $sessionId }

Write-Host ""
Write-Host "=== SESSION TESTS ==="

Test-Api -Name "Missing session header" `
    -Path "/api/track/select" `
    -Body '{"trackType":"explore"}' `
    -ExpectedStatus 401

Test-Api -Name "Invalid UUID" `
    -Path "/api/track/select" `
    -Headers @{ "X-Session-ID" = "invalid-uuid" } `
    -Body '{"trackType":"explore"}' `
    -ExpectedStatus 400

Test-Api -Name "Create session" `
    -Path "/api/track/select" `
    -Headers $validHeader `
    -Body '{"trackType":"explore"}' `
    -ExpectedStatus 200

Test-Api -Name "Update session" `
    -Path "/api/track/select" `
    -Headers $validHeader `
    -Body '{"trackType":"interests"}' `
    -ExpectedStatus 200

Write-Host ""
Write-Host "=== USER API TESTS ==="

Test-Api -Name "Submit diagnostic" `
    -Path "/api/diagnostic/submit" `
    -Headers $validHeader `
    -Body '{"answers":[{"questionId":"test_q1","answer":"tech"}]}' `
    -ExpectedStatus 201

Test-Api -Name "Generate recommendations stub" `
    -Path "/api/recommendations/generate" `
    -Headers $validHeader `
    -Body '{}' `
    -ExpectedStatus 202

Test-Api -Name "Save reflection" `
    -Path "/api/reflection" `
    -Headers $validHeader `
    -Body '{"rating":"useful","comment":"API smoke test"}' `
    -ExpectedStatus 201

Write-Host ""
Write-Host "=== RESULT ==="
Write-Host "Passed: $passed"
Write-Host "Failed: $failed"

if ($failed -gt 0) {
    exit 1
}
