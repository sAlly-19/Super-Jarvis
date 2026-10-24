$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$verifierPath = Join-Path $repoRoot 'scripts\verify-authenticode.ps1'
$approvedPublisher = 'CN=Jasper Team, O=Jasper Team, L=Sao Paulo, C=BR'
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) "jasper-authenticode-test-$PID-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
$target = Join-Path $testRoot 'Jasper AI.exe'
$sidecarTarget = Join-Path $testRoot 'jasper-backend.exe'
$powerShellHost = (Get-Process -Id $PID).Path

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
Set-Content -LiteralPath $target -Value 'signature test fixture' -Encoding UTF8
Set-Content -LiteralPath $sidecarTarget -Value 'sidecar test fixture' -Encoding UTF8

function Invoke-VerifierCase {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ActualSubject,

        [Parameter(Mandatory = $false)]
        [string]$ExpectedSubject = $approvedPublisher,

        [Parameter(Mandatory = $false)]
        [string]$SecondSubject = ''
    )

    $escapedVerifier = $verifierPath.Replace("'", "''")
    $escapedTarget = $target.Replace("'", "''")
    $escapedSidecar = $sidecarTarget.Replace("'", "''")
    $escapedActual = $ActualSubject.Replace("'", "''")
    $secondRaw = if ($SecondSubject) { $SecondSubject } else { $ActualSubject }
    $escapedSecond = $secondRaw.Replace("'", "''")
    $escapedExpected = $ExpectedSubject.Replace("'", "''")
    $pathsLiteral = if ($SecondSubject) { "@('$escapedTarget', '$escapedSidecar')" } else { "@('$escapedTarget')" }

    $command = @"
function global:Get-AuthenticodeSignature {
    param([string]`$FilePath)
    `$subject = if (`$FilePath -eq '$escapedSidecar') { '$escapedSecond' } else { '$escapedActual' }
    [pscustomobject]@{
        Status = 'Valid'
        StatusMessage = ''
        SignerCertificate = [pscustomobject]@{ Subject = `$subject }
        TimeStamperCertificate = [pscustomobject]@{ Subject = 'CN=Timestamp Authority' }
    }
}
& '$escapedVerifier' -Paths $pathsLiteral -ExpectedPublisher '$escapedExpected'
"@

    $previousEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $powerShellHost -NoProfile -ExecutionPolicy Bypass -Command $command *> $null
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousEap
    }
}

try {
    $partialMatchExitCode = Invoke-VerifierCase -ActualSubject "$approvedPublisher, OU=Unapproved"
    if ($partialMatchExitCode -eq 0) {
        throw 'Verifier accepted a certificate whose subject only contained the approved publisher as a substring.'
    }

    $prefixMatchExitCode = Invoke-VerifierCase -ActualSubject "CN=Malicious Wrapper, $approvedPublisher"
    if ($prefixMatchExitCode -eq 0) {
        throw 'Verifier accepted a certificate with an unapproved prefix before the approved publisher.'
    }

    $multiArrayMismatchExitCode = Invoke-VerifierCase `
        -ActualSubject $approvedPublisher `
        -SecondSubject "$approvedPublisher, OU=TamperedSidecar"
    if ($multiArrayMismatchExitCode -eq 0) {
        throw 'Verifier did not inspect every executable in a multi-element -Paths array.'
    }

    $normalizedWhitespaceExitCode = Invoke-VerifierCase `
        -ActualSubject 'CN=Jasper Team,O=Jasper Team,  L=Sao Paulo,C=BR' `
        -ExpectedSubject ' CN=Jasper Team, O=Jasper Team,L=Sao Paulo, C=BR ' `
        -SecondSubject 'CN=Jasper Team, O=Jasper Team, L=Sao Paulo, C=BR'
    if ($normalizedWhitespaceExitCode -ne 0) {
        throw 'Verifier rejected an exact publisher after canonical whitespace normalization.'
    }

    Write-Host 'Authenticode exact publisher tests passed.' -ForegroundColor Green
} finally {
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
