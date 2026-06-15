# 安卓 APK 打包方案（Capacitor）

## 一、方案概览

本项目是纯 HTML5 + Vanilla JS 架构，无构建工具，无 Node.js 依赖。打包 APK 的方案是使用 **Capacitor** 将游戏封装为安卓 APP。

**Capacitor 的核心优势：**
- 内置本地 HTTP 服务器，游戏从 `http://localhost` 加载，与本地调试环境完全一致
- 跨域调用外部 LLM API 天然支持，无需修改任何安全配置
- 后续每次更新游戏内容只需 `npx cap sync`，无需手动复制文件
- 不需要编写任何 Java/Kotlin 代码

**主要技术挑战：**
- 游戏需要向外部 LLM API（如硅基流动、Gemini）发起 HTTPS 请求
- BGM 音频文件、图片资源需要一起打包进 APK

---

## 二、环境准备

### 2.1 所需软件

### 2.1 所需软件

| 软件 | 版本要求 | 下载地址 |
|------|---------|---------|
| Node.js | 18 LTS 或以上 | https://nodejs.org |
| Android Studio | Ladybug (2024.2) 或以上 | https://developer.android.com/studio |
| JDK | 17（Android Studio 自带）| 随 Android Studio 安装 |
| Android SDK | API 24（Android 7.0）以上 | 通过 Android Studio SDK Manager 安装 |

安装完成后，在 Android Studio 的 SDK Manager 中确保以下组件已安装：
- Android SDK Platform API 34（或最新）
- Android SDK Build-Tools
- Android Emulator（可选，用于测试）

### 2.2 初始化 Capacitor

```bash
# 步骤 1：初始化 npm（如果还没有 package.json）
npm init -y

# 步骤 2：安装 Capacitor 核心包
npm install @capacitor/core @capacitor/cli @capacitor/android

# 步骤 3：初始化 Capacitor 项目
#   appName：应用显示名称
#   appId：包名（建议使用反向域名格式）
#   webDir：游戏文件所在目录（. 代表项目根目录）
npx cap init "姬侠传" "com.jihaitang.jxz" --web-dir .

# 步骤 4：添加 Android 平台
npx cap add android
```

初始化后项目根目录会生成 `capacitor.config.json`，其内容应如下（如不符请手动修改）：

```json
{
  "appId": "com.jihaitang.jxz",
  "appName": "姬侠传",
  "webDir": ".",
  "server": {
    "androidScheme": "https"
  }
}
```

### 2.3 配置 AndroidManifest.xml

打开 `android/app/src/main/AndroidManifest.xml`，在 `<manifest>` 标签内（`<application>` 之前）添加网络权限：

```xml
<uses-permission android:name="android.permission.INTERNET" />
```

在 `<application>` 标签内添加，允许访问明文 HTTP（如果 API 端点有用 HTTP 的情况）：

```xml
android:usesCleartextTraffic="true"
```

### 2.4 配置 WebView 支持媒体自动播放（BGM）

打开 `android/app/src/main/java/com/jihaitang/jxz/MainActivity.java`，修改内容如下：

```java
package com.jihaitang.jxz;

import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }
}
```

在 `android/app/src/main/res/xml/config.xml` 中（Capacitor 自动生成），确保包含：

```xml
<preference name="MediaPlaybackRequiresUserAction" value="false" />
```

如果该文件不存在，在 `android/app/src/main/assets/capacitor.config.json` 中添加：

```json
{
  "appId": "com.jihaitang.jxz",
  "appName": "姬侠传",
  "webDir": ".",
  "plugins": {
    "CapacitorHttp": {
      "enabled": true
    }
  },
  "android": {
    "allowMixedContent": true,
    "webContentsDebuggingEnabled": true
  }
}
```

### 2.5 注入 window.Android 标识（让游戏识别 WebView 环境）

`api-service.js` 中通过 `window.Android` 检测是否在安卓 WebView 中运行（环境为 `'webview'`）。  
Capacitor 启动后添加一段初始化脚本来注入：

在 `index.html` 的 `<head>` 最前面添加：

```html
<script>
    // 安卓 WebView 环境标识（Capacitor 打包时自动运行）
    if (typeof window.Android === 'undefined' &&
        /Android/i.test(navigator.userAgent)) {
        window.Android = {};
    }
</script>
```

### 2.6 同步文件并构建

```bash
# 每次修改游戏文件后，执行同步
npx cap sync android

# 在 Android Studio 中打开项目
npx cap open android
```

在 Android Studio 中：
1. 等待 Gradle 同步完成
2. `Build → Generate Signed Bundle / APK`
3. 选择 `APK`
4. 创建或选择已有的 KeyStore 签名文件
5. 选择 `release` 构建变体
6. 点击 Finish，APK 生成在 `android/app/build/outputs/apk/release/` 目录

### 2.7 调试技巧

在 PC Chrome 上打开 `chrome://inspect/#devices`，用 USB 连接安卓手机，可以实时查看 WebView 控制台日志，与浏览器开发者工具体验一致。

---

## 三、注意事项

### 3.1 屏幕方向

锁定竖屏，在 `AndroidManifest.xml` 的 `<activity>` 标签上配置：

```xml
<activity
    android:name=".MainActivity"
    android:exported="true"
    android:screenOrientation="sensorPortrait"
    android:configChanges="orientation|screenSize|keyboardHidden"
    android:windowSoftInputMode="adjustResize">
    <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
    </intent-filter>
</activity>
```

`sensorPortrait` 允许正反竖屏旋转，比固定 `portrait` 体验更好。

### 3.2 外部链接（Discord、Rentry 等）

Capacitor 中，游戏页面内所有指向外部网址的链接，`target` 需要使用 `_system`，Capacitor 会拦截后拉起系统默认浏览器打开：

```html
<!-- HTML 链接 -->
<a href="https://discord.gg/xxx" target="_system">Discord</a>
```

```javascript
// JS 跳转
window.open('https://discord.gg/xxx', '_system')
```

### 3.3 游戏内 API Key 安全

APK 中的游戏文件（HTML/JS）是可以被解包查看的。**不要在代码中硬编码 API Key**。  
现有架构中 API Key 由用户在游戏设置界面输入，存储于 localStorage，这是正确的做法，无需改动。

### 3.4 IndexedDB 与 localStorage 持久化

安卓 WebView 的 IndexedDB / localStorage 数据存储在应用私有目录（`/data/data/<包名>/`），与浏览器中的数据**互不共享**，用户首次安装后需要重新输入 API Key。卸载 APP 会清除所有数据，游戏已有的"导出存档 JSON"功能可作为备份手段。

### 3.5 BGM 打包

`bgm/` 目录随游戏文件一起打包进 APK，`npx cap sync` 时会自动同步，无需额外处理。音频文件通过本地 HTTP 服务器加载，路径与浏览器调试时完全一致。

### 3.6 最低 Android 版本兼容

| API Level | 版本 | IndexedDB | ES6+ | WebView |
|-----------|------|-----------|------|---------|
| 24 | Android 7.0 | ✅ | ✅ | Chromium 51 |
| 26 | Android 8.0 | ✅ | ✅ | Chromium 58 |

建议最低支持 API 24（Android 7.0），能覆盖目前大多数安卓用户。

---

## 四、快速验证（不打 APK 先测试）

在正式打包之前，可以先在 Chrome DevTools 的移动模拟器或真机浏览器中验证：

1. 将游戏部署到本地 HTTP 服务器：`npx serve .` 或 `python -m http.server 8080`
2. 手机和电脑同一 WiFi，手机浏览器访问 `http://电脑IP:8080/index.html`
3. 验证触屏操作、API 调用、BGM 播放是否正常

---

## 五、完整执行顺序

```
1. 安装 Node.js + Android Studio（SDK Manager 安装 API 34 + Build-Tools）
2. 用手机浏览器访问本地服务器，验证游戏基本功能
3. 项目根目录执行：
     npm init -y
     npm install @capacitor/core @capacitor/cli @capacitor/android
     npx cap init "姬侠传" "com.jihaitang.jxz" --web-dir .
     npx cap add android
4. 修改 AndroidManifest.xml（添加 INTERNET 权限、横屏配置）
5. 修改 index.html（注入 window.Android 标识）
6. 检查游戏中外部链接是否使用 target="_system"
7. npx cap sync android
8. npx cap open android（在 Android Studio 中打开）
9. 连接手机，运行 Debug APK 测试（chrome://inspect 查看控制台）
10. 确认功能正常后，Build → Generate Signed APK → release
```
