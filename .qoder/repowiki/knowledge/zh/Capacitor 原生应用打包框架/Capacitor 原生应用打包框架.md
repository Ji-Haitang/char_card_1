---
kind: external_dependency
name: Capacitor 原生应用打包框架
slug: capacitor
category: external_dependency
category_hints:
    - framework_behavior
scope:
    - '**'
---

### Capacitor 打包框架
- **角色**：将 Web 应用打包为 Android APK 的原生容器框架
- **核心依赖**：@capacitor/core、@capacitor/android、@capacitor/cli、@capacitor/filesystem、@capacitor/share
- **配置方式**：通过 `capacitor.config.json` 配置 appId (`com.jihaitang.jxz`)、appName (`瀚海`)、webDir (`www`) 等
- **Android 特性**：启用混合内容支持、WebContents 调试、HTTPS scheme
- **构建流程**：通过 `npm run build` 生成静态资源，`npx cap sync android` 同步到 Android 项目
- **验证要求**：具体 API/参数以 Capacitor 官方文档为准