---
kind: dependency_management
name: Capacitor + Gradle 混合依赖管理（仅 APK 子工程）
category: dependency_management
scope:
    - '**'
source_files:
    - apk/package.json
    - apk/package-lock.json
    - apk/capacitor.config.json
    - apk/android/build.gradle
    - apk/android/app/build.gradle
    - apk/android/gradle.properties
---

本仓库的依赖管理集中在 apk/ 子目录，采用 npm + Capacitor + Android Gradle 三层组合方式；根目录其余前端代码为纯静态 HTML/JS/CSS，不声明任何包管理器文件。

1. 系统与方法
- npm：通过 apk/package.json 声明 Node 层依赖，使用 package-lock.json（lockfileVersion=3）锁定精确版本与完整性校验，确保跨环境可复现安装。
- Capacitor：以 @capacitor/cli 作为桥接工具，将 Web 资源（www/）打包进 Android 原生壳，并通过 npx cap sync android 同步到 android/ 工程。
- Android Gradle：apk/android/ 为标准 Gradle 多模块工程，顶层 build.gradle 集中声明 Google/Maven Central 仓库与 AGP、google-services classpath，应用模块 app/build.gradle 通过 implementation project(':capacitor-android') 引用 Capacitor 原生库。

2. 关键文件与位置
- apk/package.json：定义 @capacitor/* 系列运行时依赖与 sharp 开发依赖，提供 build、sync 脚本串联构建流程。
- apk/package-lock.json：完整锁定的 npm 依赖树，包含所有传递依赖的版本与 sha512 integrity。
- apk/capacitor.config.json：指定 appId、appName、webDir 及 Android scheme/debug 选项，是 Capacitor 与 Android 工程的配置桥梁。
- apk/android/build.gradle：统一仓库源（google()、mavenCentral()）、AGP 8.13.0 与 google-services 4.4.4 classpath。
- apk/android/app/build.gradle：声明 applicationId、min/targetSdk、versionCode/versionName，以及 androidx 各组件依赖与本地 flatDir 插件仓库。
- apk/android/gradle.properties：启用 AndroidX、设置 JVM 堆大小等全局 Gradle 参数。

3. 架构与约定
- 依赖分层清晰：Node 层只负责构建期与桥接能力（Capacitor CLI、sharp），Android 层通过 Gradle 拉取 AGP、androidx 与 Capacitor 原生 SDK，两者互不耦合。
- 版本策略：Capacitor 生态使用 ^major.minor.patch 主版本对齐（如 @capacitor/core: ^8.4.0、@capacitor/android: ^8.4.0），由 lockfile 锁定具体小版本；Gradle 侧固定 AGP 与 google-services 类路径版本，避免升级漂移。
- 仓库来源单一：仅使用官方 google() 与 mavenCentral()，未引入私有镜像或代理，便于在任意网络环境下复现。
- 构建脚本约定：npm run build 执行 node build.js 生成 www/，npm run sync 追加 npx cap sync android 一键完成 Web→Android 同步。

4. 开发者应遵循的规则
- 新增 Node 依赖时优先放入 dependencies，仅在构建/图像处理场景使用 devDependencies（如 sharp）。
- 升级 Capacitor 相关包时保持 @capacitor/core、@capacitor/android、@capacitor/cli 主版本一致，并重新运行 npm install && npx cap sync android 以更新原生工程。
- 修改 capacitor.config.json 后必须执行 npx cap sync android，否则 Android 端不会生效。
- 若需添加第三方 Android AAR/JAR，请放入 apk/android/app/libs/ 或通过 flatDir 指向 capacitor-cordova-android-plugins/src/main/libs，并在 app/build.gradle 中声明对应 implementation。
- 不要手动编辑 package-lock.json，始终通过 npm install / npm update 维护，以保证完整性校验一致。