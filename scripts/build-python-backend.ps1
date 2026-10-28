# scripts/build-python-backend.ps1
# Builds the isolated onedir PyInstaller executable for the private sidecar.

[CmdletBinding()]
param(
    [string]$OutputDir = "$PSScriptRoot/../build/python-backend"
)

$ErrorActionPreference = "Stop"

Write-Host "==> Verifying Python 3.11 environment..." -ForegroundColor Cyan

# Use the same validated interpreter as development and integration tests.
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $ProjectRoot
try {
    $PythonExe = & node --input-type=module -e "import { resolveDevelopmentPython } from './scripts/development-python.mjs'; console.log(resolveDevelopmentPython())"
    if ($LASTEXITCODE -ne 0) { throw 'Unable to resolve Python 3.11 for the sidecar build.' }
} finally {
    Pop-Location
}

$pyVersion = & $PythonExe --version 2>&1
Write-Host "Found Python: $pyVersion at $PythonExe" -ForegroundColor Green

if ($pyVersion -notmatch "3\.11") {
    Write-Error "Invalid Python version: $pyVersion. Required: Python 3.11"
    exit 1
}

$BackendDir = Resolve-Path "$PSScriptRoot/../jasper-backend"
$BuildDir = Resolve-Path "$PSScriptRoot/.." | Join-Path -ChildPath "build/python-backend"
$VenvDir = Join-Path $BuildDir ".venv"

if (-not (Test-Path $BuildDir)) {
    New-Item -ItemType Directory -Path $BuildDir -Force | Out-Null
}

Write-Host "==> Setting up isolated build environment in $VenvDir..." -ForegroundColor Cyan
$VenvPython = Join-Path $VenvDir "Scripts/python.exe"
if (Get-Command "uv" -ErrorAction SilentlyContinue) {
    if (-not (Test-Path -LiteralPath $VenvPython)) {
        uv venv $VenvDir --python $PythonExe --quiet
        if ($LASTEXITCODE -ne 0) { throw 'Failed to create the build environment.' }
    }
    $venvVersion = & $VenvPython --version 2>&1
    if ($LASTEXITCODE -ne 0 -or $venvVersion -notmatch '^Python 3\.11\.') { throw 'Build environment must use Python 3.11.' }
    Write-Host "==> Installing hashed requirements with uv..." -ForegroundColor Cyan
    uv pip install --require-hashes -r "$BackendDir/requirements.lock" --python $VenvPython --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Failed to install backend requirements.' }
    uv pip install --require-hashes -r "$BackendDir/requirements-build.lock" --python $VenvPython --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Failed to install build requirements.' }
} else {
    if (-not (Test-Path -LiteralPath $VenvPython)) {
        & $PythonExe -m venv $VenvDir
        if ($LASTEXITCODE -ne 0) { throw 'Failed to create the build environment.' }
    }
    $venvVersion = & $VenvPython --version 2>&1
    if ($LASTEXITCODE -ne 0 -or $venvVersion -notmatch '^Python 3\.11\.') { throw 'Build environment must use Python 3.11.' }
    Write-Host "==> Installing hashed requirements with pip..." -ForegroundColor Cyan
    & $VenvPython -m pip install --require-hashes -r "$BackendDir/requirements.lock" --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Failed to install backend requirements.' }
    & $VenvPython -m pip install --require-hashes -r "$BackendDir/requirements-build.lock" --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Failed to install build requirements.' }
}

$PyInstallerExe = Join-Path $VenvDir "Scripts/pyinstaller.exe"
if (-not (Test-Path $PyInstallerExe)) {
    Write-Error "PyInstaller not found in build venv."
    exit 1
}

Write-Host "==> Compiling PyInstaller onedir distribution..." -ForegroundColor Cyan
$DistPath = Join-Path $BuildDir "dist"
$WorkPath = Join-Path $BuildDir "work"

Push-Location $BackendDir
try {
    & $PyInstallerExe `
        --clean `
        --noconfirm `
        --distpath $BuildDir `
        --workpath $WorkPath `
        "$BackendDir/jasper-backend.spec"
    if ($LASTEXITCODE -ne 0) { throw 'PyInstaller failed to build the sidecar.' }
} finally {
    Pop-Location
}

$OutputExe = Join-Path $BuildDir "jasper-backend/jasper-backend.exe"
if (-not (Test-Path $OutputExe)) {
    Write-Error "PyInstaller build failed: $OutputExe does not exist."
    exit 1
}

Write-Host "==> Successfully built onedir sidecar at $OutputExe" -ForegroundColor Green
exit 0

