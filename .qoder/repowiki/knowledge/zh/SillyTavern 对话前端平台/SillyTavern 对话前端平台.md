---
kind: external_dependency
name: SillyTavern 对话前端平台
slug: sillytavern
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
---

### SillyTavern 平台
- **角色**：作为《姬侠传》的 ST 版运行环境，需配合小白X插件使用
- **集成方式**：通过 `index - SR.html` 入口文件在 ST 中加载，支持流式渲染和变量系统
- **数据兼容**：提供 `.jsonl` 聊天记录格式转换工具（`st-converter.js`），可将 ST 存档导入独立前端
- **差异对比**：ST 版不支持向量化召回、自动存档等独立前端功能
- **验证要求**：具体 API/参数以官方文档为准