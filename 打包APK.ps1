#Requires -Version 5.1
# Isolated, traceable release APK build. Never deletes or replaces an existing APK.
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
        # Unsigned, non-debuggable release build; signed below with apksigner (Godot-style).
        & (Join-Path $prepared.androidRoot 'gradlew.bat') --no-daemon assembleRelease
        if ($LASTEXITCODE -ne 0) { throw "Gradle failed (exit $LASTEXITCODE); no verified APK output." }
    }
    In-Directory $ROOT {
        Invoke-Node -Arguments @('scene3d/scripts/verify-apk.mjs', "--runRecord=$RunRecord")
    }
    $buildTools = Get-ChildItem -LiteralPath (Join-Path $AndroidSdk 'build-tools') -Directory |
        Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } |
        Sort-Object { [version]$_.Name } -Descending |
        Select-Object -First 1
    if (-not $buildTools) { throw 'No stable Android build-tools version for apksigner.' }
    $signer = Join-Path $buildTools.FullName 'apksigner.bat'
    $zipalign = Join-Path $buildTools.FullName 'zipalign.exe'
    $aapt2 = Join-Path $buildTools.FullName 'aapt2.exe'
    foreach ($tool in @($signer, $zipalign, $aapt2)) { if (-not (Test-Path -LiteralPath $tool)) { throw "Build tool missing: $tool" } }
    # Signing material lives in .signing/ (git-ignored, excluded from APK inputs):
    #   legacy-debug.keystore  - key of every release up to 1.6.1 (SHA-256 a78a94a0...)
    #   release.jks            - official key (CN=JiHaiTang), password in release-keystore-password.txt
    #   jxz-signing.lineage    - apksigner rotate proof: legacy -> release
    $signing = Join-Path $ROOT '.signing'
    $legacyKs = Join-Path $signing 'legacy-debug.keystore'
    $releaseKs = Join-Path $signing 'release.jks'
    $releasePass = Join-Path $signing 'release-keystore-password.txt'
    $lineage = Join-Path $signing 'jxz-signing.lineage'
    foreach ($item in @($legacyKs, $releaseKs, $releasePass, $lineage)) { if (-not (Test-Path -LiteralPath $item)) { throw "Signing material missing: $item" } }
    $runDir = Split-Path $RunRecord
    $aligned = Join-Path $runDir 'app-release-aligned.apk'
    $signed = Join-Path $runDir 'app-release-signed.apk'
    foreach ($item in @($aligned, $signed)) { if (Test-Path -LiteralPath $item) { throw "Refusing to overwrite: $item" } }
    & $zipalign -P 16 4 $prepared.apkPath $aligned
    if ($LASTEXITCODE -ne 0) { throw "zipalign failed (exit $LASTEXITCODE)." }
    # V1+V2 (read by Android 7-8 and V1-only installers) use the legacy key; V3 carries the
    # release key plus lineage, applied from Android 9 (API 28). Every existing install
    # therefore upgrades in place, and Android 9+ adopts the release key from now on.
    & $signer sign --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true `
        --rotation-min-sdk-version 28 --lineage $lineage `
        --ks $legacyKs --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android `
        --next-signer --ks $releaseKs --ks-key-alias jxz-release --ks-pass "file:$releasePass" `
        --out $signed $aligned
    if ($LASTEXITCODE -ne 0) { throw "apksigner sign failed (exit $LASTEXITCODE)." }
    # --min-sdk-version 18 forces apksigner to actually verify the v1 (JAR) signature;
    # with the APK's own minSdk (24) it skips v1 and always reports it as false.
    $signatureOutput = & $signer verify --verbose --print-certs --min-sdk-version 18 $signed 2>&1
    $signatureExit = $LASTEXITCODE
    $signatureText = $signatureOutput -join [Environment]::NewLine
    [System.IO.File]::WriteAllText((Join-Path $runDir 'apk-signature.txt'), $signatureText, [System.Text.Encoding]::UTF8)
    Write-Host ($signatureOutput | Where-Object { "$_" -notmatch '^WARNING' } | Out-String)
    if ($signatureExit -ne 0) { throw "APK signature verification failed (exit $signatureExit)." }
    foreach ($scheme in @('v1 scheme \(JAR signing\)', 'v2 scheme \(APK Signature Scheme v2\)', 'v3 scheme \(APK Signature Scheme v3\)')) {
        if ($signatureText -notmatch "Verified using $scheme`: true") { throw "APK lacks required signature: $scheme" }
    }
    $legacyCert = 'a78a94a0201ee7743e523fa05d15edca6a623209c627eb16c42329bed7460d6c'
    $releaseCert = 'dbf924e176f20483b77d69d807899ba1f142c0a6bb36260c77460448bb5c0a41'
    if ($signatureText -notmatch "certificate SHA-256 digest: $releaseCert") { throw 'Release (V3) certificate missing.' }
    # The default verify output only shows the V3 signer; verify as an Android 8 device
    # (V1/V2 path) to prove pre-Android-9 installs still see the legacy certificate.
    $legacyText = (& $signer verify --verbose --print-certs --min-sdk-version 18 --max-sdk-version 27 $signed 2>&1) -join [Environment]::NewLine
    if ($LASTEXITCODE -ne 0 -or $legacyText -notmatch "certificate SHA-256 digest: $legacyCert") { throw 'Legacy (V1/V2) certificate missing; old installs could not upgrade.' }
    $lineageText = (& $signer lineage --in $signed --print-certs 2>&1) -join [Environment]::NewLine
    if ($lineageText -notmatch $legacyCert -or $lineageText -notmatch $releaseCert) { throw 'Signed APK does not embed the legacy -> release lineage.' }
    $manifestText = (& $aapt2 dump xmltree $signed --file AndroidManifest.xml 2>&1) -join [Environment]::NewLine
    if ($manifestText -match 'android:debuggable\([^)]*\)=true') { throw 'Release APK is debuggable.' }
    $badging = (& $aapt2 dump badging $signed 2>&1) -join [Environment]::NewLine
    $versionName = [regex]::Match($badging, "versionName='([^']+)'").Groups[1].Value
    if (-not $versionName) { throw 'Cannot read versionName from signed APK.' }
    # Copy only after verification; File.Copy(false) refuses every existing destination.
    $appName = [string]([char]0x701A) + [char]0x6D77
    $destination = Join-Path $runDir ($appName + '-v' + $versionName + '.apk')
    [System.IO.File]::Copy($signed, $destination, $false)
    $sourceHash = (Get-FileHash -LiteralPath $signed -Algorithm SHA256).Hash
    $outputHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
    if ($sourceHash -ne $outputHash) { throw 'Final candidate copy hash differs.' }
    Write-Host "Verified release candidate: $destination" -ForegroundColor Green
    Write-Host "SHA256: $outputHash" -ForegroundColor Green
    Write-Host 'Content/signature verification is NOT device, save-upgrade or rollout approval.' -ForegroundColor Yellow
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
