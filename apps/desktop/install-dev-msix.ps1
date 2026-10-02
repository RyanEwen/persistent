# Compatibility entry point for the authoritative WSL workflow.
[CmdletBinding()]
param([ValidateSet('ARM64', 'x64')][string]$Platform = 'ARM64', [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$linuxPath = (& wsl.exe -d Ubuntu -- wslpath -u $PSScriptRoot).Trim()
if ($LASTEXITCODE -ne 0 -or -not $linuxPath.StartsWith('/home/')) {
    throw 'Run npm run install:desktop from the authoritative WSL repository.'
}
$arguments = @('-d', 'Ubuntu', '--cd', "$linuxPath/../..", '--exec', 'bash',
    'scripts/windows-build', '--install', '--platform', $Platform)
if ($SkipBuild) { $arguments += '--skip-build' }
& wsl.exe @arguments
exit $LASTEXITCODE
