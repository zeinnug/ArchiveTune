$ErrorActionPreference = "Stop"

$desktopDir = Split-Path -Parent $PSScriptRoot
$repositoryRoot = Split-Path -Parent $desktopDir
$serverDir = Join-Path $desktopDir "server"
$installDir = Join-Path $serverDir "build\install\ArchiveTuneDesktopServer"
$runtimeDir = Join-Path $serverDir "build\jlink-runtime"
$moduleOutput = Join-Path $serverDir "build\jlink-modules.txt"
$extraModulesFile = Join-Path $PSScriptRoot "jlink-extra-modules.txt"

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & $FilePath @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    [PSCustomObject]@{
        ExitCode = $exitCode
        Output = ($output | Out-String)
    }
}

if (-not $env:JAVA_HOME) {
    throw "Set JAVA_HOME to a JDK 21 installation before running this script."
}

$java = Join-Path $env:JAVA_HOME "bin\java.exe"
$jdeps = Join-Path $env:JAVA_HOME "bin\jdeps.exe"
$jlink = Join-Path $env:JAVA_HOME "bin\jlink.exe"
foreach ($tool in @($java, $jdeps, $jlink)) {
    if (-not (Test-Path $tool -PathType Leaf)) {
        throw "Required JDK tool not found: $tool"
    }
}

$releaseFile = Join-Path $env:JAVA_HOME "release"
$releaseContents = Get-Content $releaseFile -Raw
if ($releaseContents -notmatch '(?m)^JAVA_VERSION="21\.') {
   throw "JDK 21 is required. $releaseFile reported:`n$releaseContents"
}

Push-Location $repositoryRoot
try {
   $gradle = Invoke-NativeCommand -FilePath (Join-Path $repositoryRoot "gradlew.bat") -Arguments @("-p", "desktop\server", "installDist")
   Write-Output $gradle.Output
   if ($gradle.ExitCode -ne 0) {
       throw "Gradle installDist failed with exit code $($gradle.ExitCode)."
   }
}
finally {
    Pop-Location
}

$libDir = Join-Path $installDir "lib"
$jars = @(Get-ChildItem $libDir -Filter "*.jar" -File | Sort-Object FullName)
if ($jars.Count -eq 0) {
    throw "No application jars were found in $libDir."
}

$jdepsArguments = @(
    "--multi-release", "21",
    "--ignore-missing-deps",
    "--print-module-deps",
    "--module-path", $libDir,
    "--add-modules", "ALL-MODULE-PATH",
    "--recursive",
    (Join-Path $libDir "ArchiveTuneDesktopServer.jar")
)
$jdepsResult = Invoke-NativeCommand -FilePath $jdeps -Arguments $jdepsArguments
if ($jdepsResult.ExitCode -ne 0) {
    throw "jdeps failed:`n$($jdepsResult.Output)"
}

$moduleLine = @(
    $jdepsResult.Output -split "\r?\n" |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -match '^[A-Za-z0-9_.]+(?:,[A-Za-z0-9_.]+)*$' } |
        Select-Object -Last 1
)
if ($moduleLine.Count -eq 0) {
    throw "Could not parse the module list from jdeps output:`n$($jdepsResult.Output)"
}
$detectedModules = @($moduleLine[0] -split ",")
$extraModules = @(
    Get-Content $extraModulesFile |
        ForEach-Object { ($_ -split "#", 2)[0].Trim() } |
        Where-Object { $_ }
)
$modules = @($detectedModules + $extraModules | Sort-Object -Unique)
if ($modules.Count -eq 0) {
    throw "jdeps did not find any Java modules."
}

$moduleList = $modules -join ","
Set-Content -Path $moduleOutput -Value $moduleList -Encoding ASCII
Write-Output "jdeps modules: $($detectedModules -join ', ')"
Write-Output "Additional modules: $($extraModules -join ', ')"
Write-Output "jlink modules: $moduleList"

if (Test-Path $runtimeDir) {
    Remove-Item $runtimeDir -Recurse -Force
}
$jlinkArguments = @(
    "--module-path", (Join-Path $env:JAVA_HOME "jmods"),
    "--add-modules", $moduleList,
    "--strip-debug",
    "--no-man-pages",
    "--no-header-files",
    "--compress=2",
    "--output", $runtimeDir
)
$jlinkResult = Invoke-NativeCommand -FilePath $jlink -Arguments $jlinkArguments
if ($jlinkResult.ExitCode -ne 0) {
    throw "jlink failed with exit code $($jlinkResult.ExitCode):`n$($jlinkResult.Output)"
}

$runtimeSize = (Get-ChildItem $runtimeDir -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Output "Runtime: $runtimeDir"
Write-Output ("Runtime size: {0:N1} MiB" -f ($runtimeSize / 1MB))
$runtimeJava = Join-Path $runtimeDir "bin\java.exe"
$runtimeVersion = Invoke-NativeCommand -FilePath $runtimeJava -Arguments @("-version")
Write-Output $runtimeVersion.Output
if ($runtimeVersion.ExitCode -ne 0) {
    throw "The generated runtime could not execute java -version."
}
