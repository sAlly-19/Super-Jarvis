# scripts/generate-python-sbom.ps1
# Generates a CycloneDX JSON SBOM for Python backend runtime dependencies.

[CmdletBinding()]
param(
    [string]$LockFile = "",
    [string]$OutputFile = ""
)

$ErrorActionPreference = "Stop"

if (-not $LockFile) {
    $LockFile = Join-Path $PSScriptRoot "../jasper-backend/requirements.lock"
}
$LockFile = [System.IO.Path]::GetFullPath($LockFile)

if (-not $OutputFile) {
    $OutputFile = Join-Path $PSScriptRoot "../build/python-sbom.json"
}
$OutputFile = [System.IO.Path]::GetFullPath($OutputFile)

Write-Host "==> Generating Python CycloneDX SBOM from $LockFile..." -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $LockFile -PathType Leaf)) {
    Write-Error "Lock file not found: $LockFile"
    exit 1
}

$outDir = Split-Path -Parent $OutputFile
if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

# Parse packages from requirements.lock
$lines = Get-Content -LiteralPath $LockFile
$components = @()

foreach ($line in $lines) {
    $trimmed = $line.Trim()
    if ($trimmed -match '^([a-zA-Z0-9_\-\.]+)\s*==\s*([a-zA-Z0-9_\-\.]+)') {
        $name = $Matches[1]
        $version = $Matches[2]
        $components += @{
            type = "library"
            name = $name
            version = $version
            purl = "pkg:pypi/$name@$version"
        }
    }
}

$sbom = @{
    bomFormat = "CycloneDX"
    specVersion = "1.5"
    serialNumber = "urn:uuid:$([guid]::NewGuid())"
    version = 1
    metadata = @{
        timestamp = ([DateTime]::UtcNow.ToString("o"))
        component = @{
            type = "application"
            name = "jasper-backend"
            version = "2.0.0"
        }
    }
    components = $components
}

$sbomJson = $sbom | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($OutputFile, $sbomJson, [System.Text.Encoding]::UTF8)

Write-Host "==> Generated CycloneDX Python SBOM with $($components.Count) components at $OutputFile" -ForegroundColor Green
exit 0
