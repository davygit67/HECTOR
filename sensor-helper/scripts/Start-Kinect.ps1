param([ValidateSet('live','demo','replay')][string]$Mode = 'live', [string]$Recording, [ValidateRange(1024,65535)][int]$Port = 5174)
$ErrorActionPreference = 'Stop'
$helper = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$entry = Join-Path $helper 'dist\cli.js'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22.12 or newer, then run Setup Windows.cmd.' }
if (-not (Test-Path $entry)) { throw 'Run Setup Windows.cmd from the project folder first.' }
if ($Mode -eq 'live') { & (Join-Path $PSScriptRoot 'Build-Kinect.ps1') }
$arguments = @($entry, '--mode', $Mode, '--port', "$Port")
if ($Mode -eq 'replay') {
    if (-not $Recording -or -not (Test-Path -LiteralPath $Recording)) { throw 'Replay requires -Recording with a saved .pmsession file.' }
    $arguments += @('--file', [IO.Path]::GetFullPath($Recording))
}
& node @arguments
if ($LASTEXITCODE -ne 0) { throw "Sensor helper exited with code $LASTEXITCODE." }
