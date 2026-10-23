# scripts/build-python-backend.ps1
# Builds the isolated onedir PyInstaller executable for the private sidecar.

[CmdletBinding()]
param(
    [string]$OutputDir = "$PSScriptRoot/../build/python-backend"
)

$ErrorActionPreference = "Stop"

Write-Host "==> Verifying Python 3.11 environment..." -ForegroundColor Cyan

# Resolve Python 3.11 executable
$PythonExe = ""
$uvPython = "$env:APPDATA\uv\python\cpython-3.11.15-windows-x86_64-none\python.exe"
if (Test-Path $uvPython) {
    $PythonExe = $uvPython
} else {
    $py = Get-Command "python" -ErrorAction SilentlyContinue
    if ($py) {
        $ver = & $py.Source --version 2>&1
        if ($ver -match "3\.11") {
            $PythonExe = $py.Source
        }
    }
}

if (-not $PythonExe) {
    Write-Error "Python 3.11 is required to build the commercial sidecar."
    exit 1
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
if (Get-Command "uv" -ErrorAction SilentlyContinue) {
    uv venv $VenvDir --python $PythonExe --quiet
    $VenvPython = Join-Path $VenvDir "Scripts/python.exe"
    Write-Host "==> Installing hashed requirements with uv..." -ForegroundColor Cyan
    uv pip install -r "$BackendDir/requirements.lock" --python $VenvPython --quiet
    uv pip install -r "$BackendDir/requirements-build.lock" --python $VenvPython --quiet
} else {
    & $PythonExe -m venv $VenvDir
    $VenvPython = Join-Path $VenvDir "Scripts/python.exe"
    Write-Host "==> Installing hashed requirements with pip..." -ForegroundColor Cyan
    & $VenvPython -m pip install --require-hashes -r "$BackendDir/requirements.lock" --quiet
    & $VenvPython -m pip install --require-hashes -r "$BackendDir/requirements-build.lock" --quiet
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

