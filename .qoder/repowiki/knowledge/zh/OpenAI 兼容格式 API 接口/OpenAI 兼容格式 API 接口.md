---
kind: external_dependency
name: OpenAI 兼容格式 API 接口
slug: openai-compatible-api
category: external_dependency
category_hints:
    - auth_protocol
    - sdk_real_api
scope:
    - '**'
---

### OpenAI 兼容 API
- **角色**：主要 LLM 调用后端，支持 OpenAI 官方及各类兼容服务（DeepSeek、中转站等）
- **认证方式**：Bearer Token 认证，通过 Authorization 头传递 API Key
- **接口规范**：使用 `/chat/completions` 端点，messages 数组格式，支持 stream: true 流式响应
- **采样参数**：temperature、top_p、top_k、frequency_penalty、presence_penalty 等参数可选配置
- **代理机制**：web 环境下通过 CORS 代理（默认 jxz-cors-proxy.nicholaswuai.workers.dev）解决跨域问题
- **验证要求**：具体 API/参数以各提供商官方文档为准