---
kind: external_dependency
name: Google Gemini 大模型 API
slug: google-gemini
category: external_dependency
category_hints:
    - auth_protocol
    - sdk_real_api
scope:
    - '**'
---

### Google Gemini API
- **角色**：第二套 LLM 后端支持，与 OpenAI 兼容格式并列
- **认证方式**：API Key 通过 URL 参数 `?key=` 传递，无需 Authorization 头
- **接口规范**：使用 `/models/{model}:generateContent` 端点，contents 数组 + systemInstruction 结构
- **流式支持**：通过 `/streamGenerateContent?alt=sse` 端点实现 SSE 流式响应
- **参数差异**：使用 camelCase 字段名（如 maxOutputTokens、topP），与 OpenAI snake_case 不同
- **验证要求**：具体 API/参数以 Google AI Studio 官方文档为准