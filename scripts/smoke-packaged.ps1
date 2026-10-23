$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $projectRoot 'release\win-unpacked\Jasper AI.exe'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw 'Executavel empacotado nao encontrado. Execute npm run package:dir primeiro.'
}

# 1. Sanitize PATH to ensure no global Python or Node exists
$originalPath = $env:PATH
$env:PATH = "C:\Windows\system32;C:\Windows;C:\Windows\System32\Wbem;C:\Windows\System32\WindowsPowerShell\v1.0"

# Verify no python on sanitized path
$pyCheck = Get-Command "python" -ErrorAction SilentlyContinue
if ($pyCheck) {
    Write-Warning "Global python still resolved on sanitized path: $($pyCheck.Source)"
}

# 2. Verify no lingering process on port 8765
$port8765 = Get-NetTCPConnection -LocalPort 8765 -ErrorAction SilentlyContinue
if ($port8765) {
    throw "Security violation: Port 8765 is already listening before application launch."
}

$tempRoot = if ($env:JASPER_SMOKE_ROOT) { $env:JASPER_SMOKE_ROOT } else { $env:TEMP }
$smokeRoot = Join-Path $tempRoot 'jasper-packaged-smoke-ci'
$appDataRoot = Join-Path $smokeRoot 'appdata'
$screenshotRoot = Join-Path $smokeRoot 'screenshots'
$resolvedTemp = [IO.Path]::GetFullPath($tempRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
$resolvedSmokeRoot = [IO.Path]::GetFullPath($smokeRoot)
if (-not $resolvedSmokeRoot.StartsWith("$resolvedTemp$([IO.Path]::DirectorySeparatorChar)", [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Diretorio temporario do smoke test invalido.'
}
if (Test-Path -LiteralPath $resolvedSmokeRoot) {
    Remove-Item -LiteralPath $resolvedSmokeRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $appDataRoot, $screenshotRoot -Force | Out-Null

$env:APPDATA = $appDataRoot
$env:SCREENSHOT_OUT_DIR = $screenshotRoot

# 3. Launch packaged application
$process = Start-Process -FilePath $executable -ArgumentList @('--capture-screenshot', "--user-data-dir=$appDataRoot") -WindowStyle Hidden -PassThru
$screenshot = Join-Path $screenshotRoot 'app_screenshot.png'
$deadline = [DateTime]::UtcNow.AddSeconds(90)
$runtimeLog = $null

try {
    while ([DateTime]::UtcNow -lt $deadline) {
        $process.Refresh()
        if ($process.HasExited -and $process.ExitCode -ne 0) {
            throw "Aplicacao empacotada encerrou com codigo $($process.ExitCode)."
        }

        # Check port 8765 must NEVER be open
        $portOpen = Get-NetTCPConnection -LocalPort 8765 -ErrorAction SilentlyContinue
        if ($portOpen) {
            throw "Security violation: Port 8765 opened by packaged application!"
        }

        # Verify no backend process runs before lease
        $backendProcs = Get-Process "jasper-backend" -ErrorAction SilentlyContinue
        if ($backendProcs) {
            $hasLicense = Test-Path (Join-Path $appDataRoot "Jasper AI\license.json")
            if (-not $hasLicense) {
                throw "Security violation: Sidecar backend started before valid license lease!"
            }
        }

        $runtimeLog = Get-ChildItem -LiteralPath $appDataRoot -Filter 'jasper-runtime-*.log' -Recurse -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
        $hasScreenshot = (Test-Path -LiteralPath $screenshot -PathType Leaf) -and
            (Get-Item -LiteralPath $screenshot).Length -ge 10000
        $hasLoadedAvatar = $runtimeLog -and
            ((Get-Content -LiteralPath $runtimeLog.FullName -Raw) -match 'Avatar model loaded successfully')

        if ($hasScreenshot -and $hasLoadedAvatar) {
            break
        }
        Start-Sleep -Milliseconds 500
    }
} finally {
    $process.Refresh()
    if (-not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        $process.WaitForExit(5000) | Out-Null
    }
    $env:PATH = $originalPath
}

if (-not (Test-Path -LiteralPath $screenshot -PathType Leaf) -or (Get-Item -LiteralPath $screenshot).Length -lt 10000) {
    throw 'Smoke test nao gerou uma captura valida em 90 segundos.'
}
if (-not $runtimeLog) {
    throw 'Smoke test nao gerou log de runtime.'
}

$logText = Get-Content -LiteralPath $runtimeLog.FullName -Raw
if ($logText -match 'EvalError|IPC rejeitado|Uncaught') {
    throw 'Smoke test encontrou erro de CSP, IPC ou excecao nao tratada.'
}
if ($logText -notmatch 'Avatar model loaded successfully') {
    throw 'Avatar nao concluiu o carregamento no smoke test.'
}

Write-Output "Smoke test aprovado: $screenshot"
