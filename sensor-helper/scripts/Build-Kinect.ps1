param([string]$SdkDirectory = $env:KINECTSDK20_DIR)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem) { throw 'Kinect capture requires 64-bit Windows.' }
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64') { throw 'Kinect SDK capture requires Intel/AMD x64 Windows; Windows ARM is not supported.' }
if (-not $SdkDirectory) { $SdkDirectory = Join-Path $env:ProgramFiles 'Microsoft SDKs\Kinect\v2.0_1409' }
$reference = Join-Path $SdkDirectory 'Assemblies\Microsoft.Kinect.dll'
if (-not (Test-Path $reference)) { throw 'Install Kinect for Windows SDK 2.0 first: https://www.microsoft.com/en-us/download/details.aspx?id=44561' }
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $compiler)) { throw 'The Windows .NET Framework C# compiler is missing. Install/repair .NET Framework 4.8.' }
$native = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\native'))
$output = Join-Path $native 'bin'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$executable = Join-Path $output 'KinectCapture.exe'
& $compiler '/nologo' '/target:exe' '/platform:x64' '/optimize+' "/out:$executable" "/reference:$reference" '/reference:System.Web.Extensions.dll' (Join-Path $native 'CaptureCore.cs') (Join-Path $native 'KinectCapture.cs')
if ($LASTEXITCODE -ne 0) { throw 'Native Kinect compilation failed. The existing executable must not be used until this is resolved.' }
# Local copy beside the executable is needed for CLR assembly resolution; never committed or included in a source handoff.
Copy-Item $reference (Join-Path $output 'Microsoft.Kinect.dll') -Force
Write-Host "Kinect helper built: $executable"
Write-Host 'Compilation does not verify Windows 11 driver compatibility or USB reliability. Run the SDK Configuration Verifier once the Kinect arrives.'
