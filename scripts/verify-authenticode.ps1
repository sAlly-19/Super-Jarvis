# scripts/verify-authenticode.ps1
# Enforces Authenticode digital signature and timestamp validity on Windows binaries and installers.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string[]]$Paths,

    [Parameter(Mandatory = $false)]
    [string]$ExpectedPublisher = "CN=Jasper Team, O=Jasper Team, L=Sao Paulo, C=BR"
)

$ErrorActionPreference = "Stop"

Write-Host "==> Verifying Authenticode signatures for $($Paths.Count) target(s)..." -ForegroundColor Cyan
Write-Host "    Expected Publisher: $ExpectedPublisher" -ForegroundColor DarkGray

$failed = $false

foreach ($target in $Paths) {
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
        Write-Error "Target file not found: $($target)"
        $failed = $true
        continue
    }

    $sig = Get-AuthenticodeSignature -FilePath $target
    Write-Host "  -> Checking: $($target)" -ForegroundColor Yellow
    Write-Host "     Status: $($sig.Status)" -ForegroundColor DarkGray

    if ($sig.Status -ne "Valid") {
        Write-Error "Invalid Authenticode status for $($target): $($sig.Status) - $($sig.StatusMessage)"
        $failed = $true
        continue
    }

    $subject = $sig.SignerCertificate.Subject
    Write-Host "     Subject: $subject" -ForegroundColor DarkGray
    if ($subject -notmatch [regex]::Escape($ExpectedPublisher) -and $subject -ne $ExpectedPublisher) {
        Write-Error "Publisher mismatch for $($target). Expected: $ExpectedPublisher, Got: $subject"
        $failed = $true
        continue
    }

    if (-not $sig.TimeStamperCertificate) {
        Write-Error "Missing cryptographic timestamp for $($target). Release artifacts must be signed with a trusted timestamp."
        $failed = $true
        continue
    }

    Write-Host "     [PASS] Valid signature and timestamp verified." -ForegroundColor Green
}

if ($failed) {
    Write-Error "Authenticode verification failed for one or more files."
    exit 1
}

Write-Host "==> All target binaries successfully verified with valid Authenticode signatures." -ForegroundColor Green
exit 0
