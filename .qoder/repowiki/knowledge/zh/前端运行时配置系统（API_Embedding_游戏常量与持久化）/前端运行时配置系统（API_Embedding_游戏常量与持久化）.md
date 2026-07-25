---
kind: configuration_system
name: 前端运行时配置系统（API/Embedding/游戏常量与持久化）
category: configuration_system
scope:
    - '**'
source_files:
    - module/api-service.js
    - ui/config-modal.js
    - module/embedding-service.js
    - module/storage-service.js
    - module/idb-storage.js
    - module/idb-snapshot.js
    - module/game-config.js
---

## 体系概览

本项目采用「纯前端 + 浏览器本地存储」的轻量配置方案，围绕三类配置展开：

- **运行时 API 配置**：LLM 后端地址、密钥、模型与采样参数，由 `api-service.js` 管理并持久化到 `localStorage`。
- **向量化记忆配置**：独立的 Embedding/Rerank 服务开关与端点，由 `embedding-service.js` 管理，同样落盘 `localStorage`。
- **游戏静态配置**：数值范围、NPC/地点映射、行动概率等只读数据，集中在 `module/game-config.js`，作为全局常量被各模块引用。

所有用户可变的运行时配置均通过 UI 弹窗 `ui/config-modal.js` 编辑，保存后调用对应 service 的 `updateConfig` 写入 `localStorage`；启动时各 service 自动从 `localStorage` 合并默认值。

## 关键文件与职责

- `module/api-service.js`：API 配置对象定义、加载/保存、OpenAI/Gemini 双协议请求封装、CORS 代理路由、采样参数“排除开关”。
- `ui/config-modal.js`：API 配置弹窗 UI，含连接测试、模型列表、历史配置切换、Embedding 配置区及重建索引按钮。
- `module/embedding-service.js`：向量召回服务的配置读写、连接测试、批量 embed 与缓存写入。
- `module/storage-service.js`：IndexedDB 主库 + 快照库 + localStorage 降级层，提供统一的 key 命名空间与迁移逻辑。
- `module/idb-storage.js` / `module/idb-snapshot.js`：IndexedDB 底层封装与快照专用 DB。
- `module/game-config.js`：游戏静态配置（数值范围、NPC、地点、行动概率、SLG 场景/表情选项、危险度表等），无函数逻辑，仅暴露常量。

## 架构与约定

1. **配置对象结构**  
   - API 配置包含 `type | endpoint | apiKey | model | temperature | maxOutputTokens | maxContextTokens | streamMode | corsProxyUrl` 以及一组带 `*Enabled` 后缀的采样参数开关（topP/topK/frequencyPenalty/presencePenalty）。  
   - Embedding 配置包含 `enabled | endpoint | apiKey | model | rerankModel`，独立于主 API Key。

2. **持久化策略**  
   - API 配置以 `jxz_apiConfig` 键存 `localStorage`，启动时 `loadConfig()` 用默认值合并用户覆盖值。  
   - Embedding 配置使用独立 `localStorage` key（见 embedding-service 内部实现）。  
   - 游戏存档、对话历史、摘要、事件层、位置记忆等均走 `storageService`，优先 IndexedDB（`jxz_db` / `jxz_snapshot_db`），不可用时回退到 `jxz_*` 前缀的 localStorage。

3. **环境感知与 CORS 代理**  
   - `_getRunEnv()` 区分 `file/electron/webview/web`；web 环境下若配置了 `corsProxyUrl`，则通过 `?target=` 参数将请求转发至 Worker 代理，避免跨域拦截。

4. **UI 与配置的解耦**  
   - `config-modal.js` 仅负责表单渲染、校验与调用 `apiService.updateConfig` / `embeddingService.updateConfig`，不直接操作 `localStorage`。  
   - 支持「历史配置下拉」——最近 3 条配置以 `jxz_apiConfigHistory` 记录，可按 label（模型·域名）快速回填。

5. **静态配置与动态配置分离**  
   - `game-config.js` 是纯数据常量，不参与运行期修改；任何需要热更新的玩法参数都应走 `storageService` 或 `apiService` 的配置通道。

## 开发者应遵循的规则

- **新增运行时配置字段**：在 `api-service.js` 默认 config 中声明 → 在 `config-modal.js` 表单中增加输入控件 → 在 `saveConfigAndClose` 中收集并调用 `apiService.updateConfig`。  
- **新增独立服务配置**：参照 embedding-service 模式，维护独立 `localStorage` key，并提供 `isEnabled()/getConfig()/updateConfig()` 接口。  
- **不要直接写死硬编码路径**：资源 URL 统一通过 `game-config.js` 中的 `_assetUrl` / `_iframeUrl` 生成，以适配 CDN 与 `file://` 两种部署方式。  
- **敏感信息不入代码库**：`apiKey`、`endpoint` 等仅保存在浏览器本地，禁止硬编码到仓库。  
- **IDB 不可用时的降级**：所有持久化必须通过 `storageService`，确保 IDB 失败时能平滑回落到 localStorage。

## 典型配置项一览

| 类别 | 来源 | 持久化 key | 说明 |
|---|---|---|---|
| LLM 后端 | `api-service.js` | `jxz_apiConfig` | OpenAI 兼容 / Gemini，含采样参数开关 |
| 向量召回 | `embedding-service.js` | 独立 LS key | 可选，含 Rerank 模型 |
| 游戏存档/对话/摘要/事件/位置记忆 | `storage-service.js` | `jxz_*`（LS 降级）/ `jxz_db`（IDB） | Write-Through Cache + Snapshot |
| 游戏静态常量 | `game-config.js` | 无（内存常量） | NPC、地点、行动概率、SLG 选项等 |
