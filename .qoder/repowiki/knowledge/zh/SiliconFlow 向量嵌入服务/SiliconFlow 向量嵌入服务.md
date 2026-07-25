---
kind: external_dependency
name: SiliconFlow 向量嵌入服务
slug: siliconflow
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
---

### SiliconFlow 向量嵌入服务
- **角色**：独立的 Embedding API 提供商，用于向量化记忆召回功能
- **默认配置**：endpoint 默认为 `https://api.siliconflow.cn/v1`，推荐模型 `BAAI/bge-m3`
- **多 Key 轮询**：支持逗号/分号/竖线/换行分隔多个 API Key，自动轮询分摊 QPS 限制
- **OpenAI 兼容**：使用标准 `/embeddings` 端点和 OpenAI 兼容的请求格式
- **免费额度**：提供免费 API Key，适合个人项目使用
- **验证要求**：具体 API/参数以 SiliconFlow 官方文档为准