# 姬侠传 APK 一键打包脚本
# 用法：在项目根目录右键 → "用 PowerShell 运行"

Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
$ErrorActionPreference = "Stop"

function Pause-AndExit($code) {
    Write-Host ""
    Write-Host "按任意键退出..." -ForegroundColor Gray
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit $code
}

$ROOT     = $PSScriptRoot
$APK_DIR  = Join-Path $ROOT "apk"
$WWW_DIR  = Join-Path $APK_DIR "www"
$GRADLE   = Join-Path $APK_DIR "android\gradlew.bat"
$APK_SRC  = Join-Path $APK_DIR "android\app\build\outputs\apk\debug\app-debug.apk"
$APK_DEST = Join-Path $ROOT "瀚海-debug.apk"

# 使用 Android Studio 内置 JDK（无需配置系统环境变量）
$env:JAVA_HOME = "D:\AS\jbr"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  瀚海 APK 打包" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 先删除旧 APK，确保构建失败时不会误装旧包
if (Test-Path $APK_DEST) {
    Remove-Item $APK_DEST -Force
    Write-Host "[准备] 已删除旧 APK" -ForegroundColor DarkGray
}

# 步骤 1：复制游戏文件到 www/
Write-Host ""
Write-Host "[1/5] 构建 www 暂存目录..." -ForegroundColor Yellow
Set-Location $APK_DIR
node build.js
if ($LASTEXITCODE -ne 0) { Write-Host "build.js 失败" -ForegroundColor Red; Pause-AndExit 1 }

# 步骤 2：生成应用图标
Write-Host ""
Write-Host "[2/5] 生成应用图标..." -ForegroundColor Yellow
node gen-icons.js
if ($LASTEXITCODE -ne 0) { Write-Host "gen-icons.js 失败" -ForegroundColor Red; Pause-AndExit 1 }

# 步骤 3：同步到 Android 项目
Write-Host ""
Write-Host "[3/5] 同步到 Android 项目..." -ForegroundColor Yellow
npx cap sync android
if ($LASTEXITCODE -ne 0) { Write-Host "cap sync 失败" -ForegroundColor Red; Pause-AndExit 1 }

# 步骤 4：清理 www 暂存目录（文件已进入 android/app/src/main/assets/public）
Write-Host ""
Write-Host "[4/5] 清理 www 暂存目录..." -ForegroundColor Yellow
Get-ChildItem $WWW_DIR -Exclude ".gitkeep" | Remove-Item -Recurse -Force
Write-Host "      www/ 已清理"

# 步骤 5：Gradle 构建 APK
Write-Host ""
Write-Host "[5/5] Gradle 构建 APK (首次运行需下载依赖，请耐心等待)..." -ForegroundColor Yellow
Set-Location (Join-Path $APK_DIR "android")
& $GRADLE assembleDebug
if ($LASTEXITCODE -ne 0) { Write-Host "Gradle 构建失败" -ForegroundColor Red; Pause-AndExit 1 }

# 复制 APK 到项目根目录
Copy-Item $APK_SRC $APK_DEST -Force

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  打包成功！" -ForegroundColor Green
Write-Host "  APK 路径: $APK_DEST" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

# 打开 APK 所在目录
explorer.exe /select, $APK_DEST

Pause-AndExit 0
