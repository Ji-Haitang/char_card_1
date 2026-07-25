---
kind: build_system
name: Capacitor + Gradle Android APK 构建流水线
category: build_system
scope:
    - '**'
source_files:
    - apk/build.js
    - apk/gen-icons.js
    - apk/package.json
    - apk/capacitor.config.json
    - apk/android/app/build.gradle
    - apk/android/build.gradle
    - apk/android/gradle.properties
    - 打包APK.ps1
---

本项目采用 Capacitor 将纯前端网页游戏打包为 Android APK，构建流程围绕 `apk/` 子工程组织，由 Node.js 脚本驱动资源镜像、图标生成与 Gradle 编译。

## 1. 构建系统与工具链
- **跨平台包装层**：Capacitor v8（`@capacitor/android`、`@capacitor/cli`、`@capacitor/core`），以 `www/` 作为 Web 资源目录，Android 端通过 WebView 加载本地 HTML。
- **原生构建**：Gradle 8.13 + Android Gradle Plugin 8.13，`android/app/build.gradle` 中声明应用 ID `com.jihaitang.jxz`、版本 `versionCode 3 / versionName "1.2"`，依赖 `capacitor-android` 与 Cordova 插件模块。
- **Node.js 构建脚本**：`apk/package.json` 暴露 `npm run build`（仅复制资源）和 `npm run sync`（复制 + `npx cap sync android`）。

## 2. 核心构建文件与职责
| 文件 | 作用 |
|---|---|
| `apk/build.js` | 从仓库根目录递归拷贝 `module/assets/img/bgm/music/worker/ui/tools` 等目录到 `apk/www/`，并将多个入口 HTML 映射到目标名（`start-screen-noST.html → index.html` 作为 APK 启动页，`index.html → game.html` 主游戏），同时修正跳转链接指向 `game.html?intent=` |
| `apk/gen-icons.js` | 基于 `sharp` 从 `assets/image/static/游戏logo.png` 生成各密度 `mipmap-*` 下的方形、圆形及 adaptive icon 前景图 |
| `apk/capacitor.config.json` | 定义 appId、appName="瀚海"、webDir="www"、Android scheme 为 https 并允许混合内容 |
| `apk/android/app/build.gradle` | Android 应用模块配置，含 minSdk/targetSdk、release 类型、ProGuard 规则引用、Google Services 可选注入 |
| `apk/android/build.gradle` | 顶层 Gradle 配置，声明 Google/MavenCentral 仓库、AGP 8.13.0 与 google-services 4.4.4 插件 |
| `apk/android/gradle.properties` | 全局 Gradle 参数（JVM 内存 1536m、启用 AndroidX） |
| `打包APK.ps1` | Windows 一键打包脚本：设置 JAVA_HOME→Android Studio JBR，依次执行 `node build.js` → `node gen-icons.js` → `npx cap sync android` → 清理 `www/` → `gradlew assembleDebug`，最终输出 `瀚海-debug.apk` 到项目根目录 |

## 3. 构建流水线与约定
```
仓库根 (HTML/CSS/JS/资源)
  ↓ node apk/build.js
apk/www/ （静态资源暂存区，Capacitor webDir）
  ↓ npx cap sync android
apk/android/app/src/main/assets/public/ （Capacitor 同步产物）
  ↓ gradlew assembleDebug
apk/android/app/build/outputs/apk/debug/app-debug.apk
  ↓ 复制到根目录
瀚海-debug.apk
```
- **入口约定**：APK 启动页固定为 `index.html`（实际源为 `start-screen-noST.html`），主游戏页面为 `game.html`；新增页面需在 `INCLUDE_FILES` 中登记映射。
- **资源白名单**：仅 `INCLUDE_DIRS` 所列目录被复制，`EXCLUDE_DIRS` 显式排除 `android/node_modules/.git/history_version/char_card_information/开发文档` 等开发期目录，避免产物膨胀。
- **图标生成**：单源 PNG 经 `sharp` 缩放到 mdpi~xxxhdpi 五档，并自动生成圆形裁剪与 adaptive icon 前景（带 10% 留白）。

## 4. 开发者规范
- 新增游戏页面时，在 `apk/build.js` 的 `INCLUDE_FILES` 中添加 `{src, dest}` 映射，确保 `cap sync` 后能被 WebView 访问。
- 修改应用图标只需更新 `assets/image/static/游戏logo.png`，然后运行 `node apk/gen-icons.js` 重新生成所有密度资源。
- 版本号在 `apk/android/app/build.gradle` 的 `defaultConfig` 中维护（`versionCode` 递增、`versionName` 语义化），发布前同步更新。
- Windows 环境使用 `打包APK.ps1` 一键完成全流程；Linux/macOS 可组合执行 `cd apk && npm run sync && cd android && ./gradlew assembleDebug`。
- 若需引入新的 Capacitor 插件，在 `apk/package.json` 的 `dependencies` 中声明并重新 `npm install`，再执行 `npx cap sync android`。

## 5. 关键约束
- 无 CI/CD 配置文件（无 `.github/workflows`、`Dockerfile`、`Makefile`），构建完全依赖本地 Node.js + Android SDK/Gradle 环境。
- `history_version/` 下归档了历史 APK 产物（如 `瀚海-v1.0.0.apk`），但当前构建脚本仅输出 `瀚海-debug.apk`，未自动按版本命名归档。
- `google-services.json` 不存在时 Gradle 会跳过 Firebase 插件并打印提示，不影响基础构建。