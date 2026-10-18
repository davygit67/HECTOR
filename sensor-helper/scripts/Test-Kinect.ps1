param([string]$SdkDirectory = $env:KINECTSDK20_DIR)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Build-Kinect.ps1') -SdkDirectory $SdkDirectory
$helper = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$native = Join-Path $helper 'native'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$tests = Join-Path $native 'bin\CoreTests.exe'
$fixture = Join-Path $native 'bin\core-fixture.bin'
$registeredFixture = Join-Path $native 'bin\registered-fixture.bin'
& $compiler '/nologo' '/target:exe' '/platform:x64' "/out:$tests" (Join-Path $native 'CaptureCore.cs') (Join-Path $native 'tests\CoreTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Native shared-code tests did not compile.' }
& $tests $fixture $registeredFixture
if ($LASTEXITCODE -ne 0) { throw 'Native shared-code tests failed.' }
$priorFixture = $env:PM_NATIVE_FIXTURE
$priorRegisteredFixture = $env:PM_NATIVE_REGISTERED_FIXTURE
try {
    $env:PM_NATIVE_FIXTURE = $fixture
    $env:PM_NATIVE_REGISTERED_FIXTURE = $registeredFixture
    Push-Location $helper
    try { & npm.cmd run check; if ($LASTEXITCODE -ne 0) { throw 'Relay integration tests failed.' } }
    finally { Pop-Location }
} finally { $env:PM_NATIVE_FIXTURE = $priorFixture; $env:PM_NATIVE_REGISTERED_FIXTURE = $priorRegisteredFixture }
Write-Host 'SDK adapter compiled and shared-code/relay tests passed. Live acquisition still needs Start-Kinect.ps1 and the physical Kinect.'
