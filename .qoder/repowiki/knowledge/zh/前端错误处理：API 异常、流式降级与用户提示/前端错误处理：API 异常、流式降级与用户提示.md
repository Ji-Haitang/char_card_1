---
kind: error_handling
name: 前端错误处理：API 异常、流式降级与用户提示
category: error_handling
scope:
    - '**'
source_files:
    - module/api-service.js
    - module/pipeline.js
    - module/log-capture.js
    - worker/cors-proxy.js
---

## 1. 采用的系统/方法
- 使用原生 JavaScript try/catch + throw new Error(...) 进行错误传播，未引入统一错误类或中间件。
- 网络层通过 fetch 的 response.ok 判断 HTTP 错误，并读取响应体前 200 字符拼接为错误消息。
- 流式 SSE 调用采用回调契约 { onToken, onThinking, onComplete, onError }，由上层 pipeline 在 onError 中触发非流式降级。
- 用户可见的错误通过全局 showModal('...') 弹窗提示；不可见错误通过 console.error / console.warn 输出到控制台。
- 无 panic/recover 概念（浏览器环境），也未定义统一的错误码枚举。

## 2. 关键文件与位置
- module/api-service.js：所有 OpenAI/Gemini 请求入口，集中抛错与流式回调。
- module/pipeline.js：单轮处理流水线，负责捕获 API 错误、显示失败弹窗、并在流式失败时降级为非流式。
- module/log-capture.js：轻量 console.log 拦截器，按模块前缀分流日志，用于历史管理弹窗展示。
- worker/cors-proxy.js：CORS 代理 Worker，对跨域请求失败提供兜底通道。
- ui/config-modal.js、ui/prompt-manager-modal.js：配置/提示词弹窗，内部也使用 try/catch 包裹用户输入校验。
- apk/android/app/src/main/assets/public/module/ 下的同名文件是构建产物，行为与根目录一致。

## 3. 架构与约定
- 分层职责
  - api-service：仅关注 I/O 与协议适配，遇到参数缺失、HTTP 非 2xx、JSON 解析失败等情况直接 throw new Error(人类可读消息)。
  - pipeline：编排请求到解析到提交三阶段，在 _requestWithStream 中统一处理 AbortError、流式 onError 降级、以及最终 catch(err) 后弹出 showModal('AI 请求失败：' + err.message)。
  - log-capture：不改变 console.log 原有行为，仅额外按 [SummaryRunner] / [EventRunner] / [LocationRunner] 前缀缓存最近 20 条，供 UI 标签页展示。
- 降级策略
  - 流式失败自动回退到 _fallbackNonStream（仍支持 AbortController 中断）。
  - 向量召回/同步失败打印 console.warn 并降级为空结果，不影响后续 LLM 调用。
- 可观测性
  - 所有关键路径均附带 [Pipeline] / [API] / [EmbSync] / [L2Sync] 等前缀日志，便于定位问题。
  - 流式期间通过 _setStreamLog('施延年...') 更新状态文案，失败时切换为 '施延年墨尽笔折'。

## 4. 开发者应遵循的规则
- 抛出错误：在 api-service 中遇到参数缺失、HTTP 错误、SSE 解析异常时，统一 throw new Error('人类可读消息')，不要吞掉错误。
- 捕获与展示：在 pipeline 顶层 runTurn 的 catch(err) 中必须调用 showModal('AI 请求失败：' + err.message) 并向上抛出，让 UI 层能感知失败。
- 流式回调：新增流式接口时遵循 { onToken, onThinking, onComplete, onError } 契约，确保 onError 能触发降级逻辑。
- 降级优先：任何可能失败的异步步骤（向量同步、召回、embedding 补生成）都应 try/catch 并降级为空结果加 warn 日志，不得阻断主流程。
- 日志规范：关键路径使用带模块前缀的 console.log / console.warn / console.error，避免污染全局日志，方便 log-capture 分流展示。
- 禁止静默失败：除 JSON 解析片段级跳过外，不应出现空的 catch(e){} 吞掉错误而不记录日志的情况。