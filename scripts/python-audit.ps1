# scripts/python-audit.ps1
# Audits Python locked dependencies for known security vulnerabilities using an isolated pip-audit environment.

[CmdletBinding()]
param(
    [string]$LockFile = ""
)

$ErrorActionPreference = "Stop"

if (-not $LockFile) {
    $LockFile = Join-Path $PSScriptRoot "../jasper-backend/requirements.lock"
}
$LockFile = [System.IO.Path]::GetFullPath($LockFile)
$AuditLockFile = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../jasper-backend/requirements-audit.lock"))

Write-Host "==> Auditing Python locked dependencies from $LockFile..." -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $LockFile -PathType Leaf)) {
    Write-Error "Requirements lockfile not found at $LockFile"
    exit 1
}

if (-not (Test-Path -LiteralPath $AuditLockFile -PathType Leaf)) {
    Write-Error "Requirements audit lockfile not found at $AuditLockFile"
    exit 1
}

# Resolve python
$pyExe = "$env:APPDATA\uv\python\cpython-3.11.15-windows-x86_64-none\python.exe"
if (-not (Test-Path $pyExe)) {
    $py = Get-Command "python" -ErrorAction SilentlyContinue
    if ($py) {
        $pyExe = $py.Source
    } else {
        $pyExe = "python"
    }
}

$auditVenv = Join-Path $PSScriptRoot "../build/python-audit/.venv"
$auditPython = Join-Path $auditVenv "Scripts/python.exe"
$pipAuditExe = Join-Path $auditVenv "Scripts/pip-audit.exe"

if (-not (Test-Path $pipAuditExe)) {
    Write-Host "==> Creating isolated audit environment in $auditVenv..." -ForegroundColor Cyan
    if (-not (Test-Path (Split-Path $auditVenv -Parent))) {
        New-Item -ItemType Directory -Path (Split-Path $auditVenv -Parent) -Force | Out-Null
    }
    & $pyExe -m venv $auditVenv
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create isolated audit virtual environment."
        exit 1
    }

    Write-Host "==> Installing pip-audit with strict hash verification from requirements-audit.lock..." -ForegroundColor Cyan
    & $auditPython -m pip install --require-hashes -r $AuditLockFile --quiet
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to install pip-audit dependencies under strict hash verification."
        exit 1
    }
}

if (-not (Test-Path $pipAuditExe)) {
    Write-Error "pip-audit executable not found at $pipAuditExe"
    exit 1
}

Write-Host "==> Running pip-audit against $LockFile..." -ForegroundColor Cyan
# --disable-pip uses the fully locked SHA-256 hashes without dynamic resolver re-execution.
# filelock 3.32.7 CVEs are ignored because litellm 1.106.2 constrains filelock < 4.0; Pillow is pinned at 13.0.0.
& $pipAuditExe -r $LockFile --disable-pip --desc auto --ignore-vuln CVE-2026-112940 --ignore-vuln CVE-2026-112913 --ignore-vuln CVE-2026-112907
if ($LASTEXITCODE -ne 0) {
    Write-Error "pip-audit detected security vulnerabilities or failed execution."
    exit $LASTEXITCODE
}

Write-Host "==> Python dependencies audit PASSED." -ForegroundColor Green
exit 0
