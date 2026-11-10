#Requires -Version 5.1
# Isolated, traceable debug APK build. Never deletes or replaces an existing APK.
# Run with -RunRecord <absolute .scene3d-work/runId/run.json> after build/publish.
# ASCII source deliberately supports Windows PowerShell 5.1 and PowerShell 7.
param(
    [Parameter(Mandatory=$true)][string]$RunRecord,
    [string]$JavaHome = 'D:\AS\jbr',
    [string]$AndroidSdk = '',
    [string]$NodePath = 'node',
    [string]$NpmCli = '',
    [switch]$Reveal
)
$ErrorActionPreference = 'Stop'
$ROOT = $PSScriptRoot
$OriginalJava = $env:JAVA_HOME
$OriginalPath = $env:PATH
$OriginalAndroidHome = $env:ANDROID_HOME
$OriginalAndroidSdkRoot = $env:ANDROID_SDK_ROOT

function Invoke-Node([string[]]$Arguments) {
    & $NodePath @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Node command failed (exit $LASTEXITCODE): $($Arguments -join ' ')" }
}
function Read-Run {
    return ([System.IO.File]::ReadAllText($RunRecord, [System.Text.Encoding]::UTF8) | ConvertFrom-Json)
}
function In-Directory([string]$Directory, [scriptblock]$Action) {
    Push-Location $Directory
    try { & $Action } finally { Pop-Location }
}
try {
    if (-not [System.IO.Path]::IsPathRooted($RunRecord)) { throw 'RunRecord must be absolute; never guess latest.' }
    $RunRecord = (Resolve-Path -LiteralPath $RunRecord).Path
    $record = Read-Run
    if ($record.projectRoot -ne $ROOT) { throw 'runRecord.projectRoot differs from this script root.' }
    if (-not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin\java.exe'))) { throw 'Supply a Java 21 JDK through -JavaHome.' }
    $env:JAVA_HOME = $JavaHome
    $env:PATH = "$JavaHome\bin;$OriginalPath"
    & (Join-Path $JavaHome 'bin\java.exe') -version
    if ($LASTEXITCODE -ne 0) { throw 'Java did not start.' }
    if (-not $AndroidSdk) { $AndroidSdk = $env:ANDROID_HOME }
    if (-not $AndroidSdk) { $AndroidSdk = $env:ANDROID_SDK_ROOT }
    if (-not $AndroidSdk) { $AndroidSdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
    if (-not (Test-Path -LiteralPath (Join-Path $AndroidSdk 'platforms\android-36\android.jar'))) { throw 'Android SDK 36 required; supply -AndroidSdk.' }
    $env:ANDROID_HOME = $AndroidSdk
    $env:ANDROID_SDK_ROOT = $AndroidSdk
    if (-not $NpmCli) {
        $npmCommand = Get-Command npm.cmd -ErrorAction Stop
        $NpmCli = Join-Path (Split-Path $npmCommand.Source) 'node_modules\npm\bin\npm-cli.js'
    }
    if (-not (Test-Path -LiteralPath $NpmCli)) { throw 'Supply -NpmCli with npm-cli.js; npm must use this same Node.' }
    Write-Host "Run: $($record.runId); scene release: $($record.buildId)" -ForegroundColor Cyan
    Write-Host 'Original APK, apk/www and native project remain untouched.' -ForegroundColor Cyan
    In-Directory $ROOT {
        Invoke-Node -Arguments @('scene3d/scripts/prepare-apk.mjs', "--runRecord=$RunRecord")
    }
    $record = Read-Run
    $prepared = $record.steps.'prepare:apk'.result
    if (-not $prepared.apkRoot -or -not $prepared.apkPath) { throw 'Isolated APK outputs were not registered.' }
    In-Directory $prepared.apkRoot {
        # Actual working directory, explicit npm CLI and the same Node; no --prefix ambiguity.
        Invoke-Node -Arguments @($NpmCli, 'ci', '--no-audit', '--no-fund')
        Invoke-Node -Arguments @('build.js', "--runRecord=$RunRecord")
        # Native icons are already frozen inputs. Do not run gen-icons over them.
        Invoke-Node -Arguments @('node_modules/@capacitor/cli/bin/capacitor', 'sync', 'android')
    }
    In-Directory $ROOT {
        Invoke-Node -Arguments @('scene3d/scripts/verify-staging.mjs', "--runRecord=$RunRecord")
    }
    In-Directory $prepared.androidRoot {
        & (Join-Path $prepared.androidRoot 'gradlew.bat') --no-daemon assembleDebug
        if ($LASTEXITCODE -ne 0) { throw "Gradle failed (exit $LASTEXITCODE); no verified APK output." }
    }
    In-Directory $ROOT {
        Invoke-Node -Arguments @('scene3d/scripts/verify-apk.mjs', "--runRecord=$RunRecord")
    }
    # Verify the candidate's actual APK signature; this does not approve production upgrade compatibility.
    $buildTools = Get-ChildItem -LiteralPath (Join-Path $AndroidSdk 'build-tools') -Directory |
        Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } |
        Sort-Object { [version]$_.Name } -Descending |
        Select-Object -First 1
    if (-not $buildTools) { throw 'No stable Android build-tools version for apksigner.' }
    $signer = Join-Path $buildTools.FullName 'apksigner.bat'
    if (-not (Test-Path -LiteralPath $signer)) { throw 'apksigner.bat missing.' }
    # --min-sdk-version 18 forces apksigner to actually verify the v1 (JAR) signature;
    # with the APK's own minSdk (24) it skips v1 and always reports it as false.
    $signatureOutput = & $signer verify --verbose --print-certs --min-sdk-version 18 $prepared.apkPath 2>&1
    $signatureExit = $LASTEXITCODE
    $signatureText = $signatureOutput -join [Environment]::NewLine
    [System.IO.File]::WriteAllText((Join-Path (Split-Path $RunRecord) 'apk-signature.txt'), $signatureText, [System.Text.Encoding]::UTF8)
    Write-Host $signatureText
    if ($signatureExit -ne 0) { throw "APK signature verification failed (exit $signatureExit)." }
    # Some installers only recognise v1 (JAR) signatures and report v2-only APKs as unsigned.
    if ($signatureText -notmatch 'Verified using v1 scheme \(JAR signing\): true') { throw 'APK lacks v1 (JAR) signature; check signingConfigs in app/build.gradle.' }
    if ($signatureText -notmatch 'Verified using v2 scheme \(APK Signature Scheme v2\): true') { throw 'APK lacks v2 signature.' }
    # Same key as every published release; a different key breaks in-place upgrades.
    $expectedCert = 'a78a94a0201ee7743e523fa05d15edca6a623209c627eb16c42329bed7460d6c'
    # build-tools <=36 prints "Signer #1 certificate ...", 37+ prints "V2 Signer: certificate ...".
    if ($signatureText -notmatch "(Signer #1|V2 Signer:) certificate SHA-256 digest: $expectedCert") { throw 'APK signing certificate differs from published releases; upgrade would fail.' }
    # Copy only after verification; File.Copy(false) refuses every existing destination.
    $appName = [string]([char]0x701A) + [char]0x6D77
    $destination = Join-Path (Split-Path $RunRecord) ($appName + '-debug-' + $record.buildId + '.apk')
    [System.IO.File]::Copy($prepared.apkPath, $destination, $false)
    $sourceHash = (Get-FileHash -LiteralPath $prepared.apkPath -Algorithm SHA256).Hash
    $outputHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
    if ($sourceHash -ne $outputHash) { throw 'Final candidate copy hash differs.' }
    Write-Host "Verified development candidate: $destination" -ForegroundColor Green
    Write-Host "SHA256: $outputHash" -ForegroundColor Green
    Write-Host 'Content verification is NOT release-signing, device, save-upgrade or rollout approval.' -ForegroundColor Yellow
    if ($Reveal) { explorer.exe /select, $destination }
} catch {
    Write-Host "Build incomplete: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Old APK preserved. Keep failed run for diagnosis; retry under a new run.' -ForegroundColor Yellow
    exit 1
} finally {
    $env:JAVA_HOME = $OriginalJava
    $env:PATH = $OriginalPath
    $env:ANDROID_HOME = $OriginalAndroidHome
    $env:ANDROID_SDK_ROOT = $OriginalAndroidSdkRoot
}
