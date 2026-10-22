$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $projectRoot 'release\win-unpacked\Jasper AI.exe'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw 'Executavel empacotado nao encontrado. Execute npm run package:dir primeiro.'
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
