$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $projectRoot 'release\win-unpacked\Jasper AI.exe'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'Pacote nao encontrado.' }
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('jasper-restart-' + [Guid]::NewGuid().ToString('N'))
$profile = Join-Path $testRoot 'profile'
$appData = Join-Path $testRoot 'appdata'
New-Item -ItemType Directory -Path $profile, $appData -Force | Out-Null
$originalPath = $env:PATH
$originalAppData = $env:APPDATA
$process = $null
$runs = @()
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class JasperRestartWindow {
    private delegate bool Visitor(IntPtr window, IntPtr argument);
    [DllImport("user32.dll")] private static extern bool EnumWindows(Visitor callback, IntPtr argument);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder value, int count);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    public static IntPtr Find(int processId) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((window, argument) => {
            uint owner; GetWindowThreadProcessId(window, out owner);
            if (owner == processId) {
                var name = new StringBuilder(256); GetClassName(window, name, name.Capacity);
                if (name.ToString() == "Chrome_WidgetWin_1") { found = window; return false; }
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
'@
try {
    $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\Wbem"
    $env:APPDATA = $appData
    for ($iteration = 1; $iteration -le 2; $iteration++) {
        # No screenshot/showcase flag: only WM_CLOSE may end this normal startup.
        $process = Start-Process -FilePath $executable -ArgumentList @("--user-data-dir=$profile") -WindowStyle Hidden -PassThru
        $deadline = [DateTime]::UtcNow.AddSeconds(40)
        $runtimeReady = $false
        do {
            $process.Refresh()
            if ($process.HasExited) { throw 'Aplicativo encerrou antes do pedido de fechamento.' }
            $logFiles = @(Get-ChildItem -LiteralPath $testRoot -Filter 'jasper-runtime-*.log' -Recurse -ErrorAction SilentlyContinue)
            if ($logFiles.Count) {
                $logText = Get-Content -LiteralPath $logFiles[0].FullName -Raw
                $starts = ([regex]::Matches($logText, '\[Main\] Runtime iniciado\.')).Count
                $loaded = ([regex]::Matches($logText, 'Avatar model loaded successfully')).Count
                $window = [JasperRestartWindow]::Find($process.Id)
                $runtimeReady = $starts -ge $iteration -and $loaded -ge $iteration -and $window -ne [IntPtr]::Zero
            }
            if (-not $runtimeReady) { Start-Sleep -Milliseconds 150 }
        } while (-not $runtimeReady -and [DateTime]::UtcNow -lt $deadline)
        if (-not $runtimeReady) { throw 'Janela/avatar nao ficaram prontos no prazo.' }
        if (-not [JasperRestartWindow]::PostMessage($window, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'WM_CLOSE nao foi entregue a janela de teste.' }
        if (-not $process.WaitForExit(15000)) { throw 'Aplicativo nao encerrou normalmente apos WM_CLOSE.' }
        if ($process.ExitCode -ne 0) { throw "Fechamento retornou codigo $($process.ExitCode)." }
        $databases = @(Get-ChildItem -LiteralPath $testRoot -Filter 'jasper-state.sqlite' -Recurse)
        if ($databases.Count -ne 1) { throw 'Banco isolado nao encontrado ou ambiguo.' }
        $runs += [ordered]@{ iteration = $iteration; pid = $process.Id; closeMethod = 'WM_CLOSE'; exitCode = $process.ExitCode; databaseBytes = $databases[0].Length; databaseHash = (Get-FileHash -LiteralPath $databases[0].FullName -Algorithm SHA256).Hash }
        $process = $null
    }
    if ((Get-Content -LiteralPath $logFiles[0].FullName -Raw) -match 'EvalError|IPC rejeitado|Uncaught') { throw 'Excecao de runtime no perfil de teste.' }
    $output = Join-Path $projectRoot '.superpowers\sdd\2026-10-27-reminders-05-acceptance\packaged-restart.json'
    $report = [ordered]@{ mode = 'commercial-executable-locked'; profile = 'isolated-temporary'; licenseActivated = $false; pathSanitized = $true; runs = $runs; reminderCrudVerified = $false }
    [IO.File]::WriteAllText($output, ($report | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
    Write-Output 'PACKAGED_RESTART_PASS: dois startups e fechamentos WM_CLOSE no mesmo perfil isolado, sem ativacao.'
} finally {
    # Cleanup only the exact child started by this test if a failure prevented graceful close.
    if ($process) { $process.Refresh(); if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } }
    $env:PATH = $originalPath
    $env:APPDATA = $originalAppData
}
