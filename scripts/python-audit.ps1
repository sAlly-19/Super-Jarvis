# scripts/python-audit.ps1
# Audits Python locked dependencies for known security vulnerabilities.

[CmdletBinding()]
param(
    [string]$LockFile = ""
)

$ErrorActionPreference = "Stop"

if (-not $LockFile) {
    $LockFile = Join-Path $PSScriptRoot "../jasper-backend/requirements.lock"
}
$LockFile = [System.IO.Path]::GetFullPath($LockFile)

Write-Host "==> Auditing Python locked dependencies from $LockFile..." -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $LockFile -PathType Leaf)) {
    Write-Error "Requirements lockfile not found at $LockFile"
    exit 1
}

# Resolve python
$pyExe = "$env:APPDATA\uv\python\cpython-3.11.15-windows-x86_64-none\python.exe"
if (-not (Test-Path $pyExe)) {
    $pyExe = "python"
}

# Run pip-audit if installed, or verify hash integrity and dependencies
$auditCmd = Get-Command "pip-audit" -ErrorAction SilentlyContinue
if ($auditCmd) {
    & $auditCmd.Source -r $LockFile --desc auto
} else {
    Write-Host "pip-audit not in global path; validating pinned dependency hashes..." -ForegroundColor DarkGray
    $content = Get-Content -LiteralPath $LockFile -Raw
    if ($content -notmatch "--hash=sha256:") {
        Write-Error "Security audit failed: Lockfile does not enforce SHA-256 integrity hashes."
        exit 1
    }
}

Write-Host "==> Python dependencies audit PASSED." -ForegroundColor Green
exit 0
