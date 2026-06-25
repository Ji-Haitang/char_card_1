# 小白X（LittleWhiteBox）聊天记录向量化 / 检索召回机制详解

> 本文基于 `LittleWhiteBox-main/modules/story-summary/` 源码梳理，聚焦“记忆/剧情总结”模块的向量化入库与检索召回实现。
> 关键代码位置：
> - 切块与向量化：`vector/pipeline/`、`vector/utils/embedder.js`、`vector/llm/siliconflow.js`
> - 存储：`vector/storage/`、`data/db.js`
> - 检索召回：`vector/retrieval/`、`vector/runtime/`
> - LLM 提取/总结提示词：`vector/llm/atom-extraction.js`、`generate/`、`data/config.js`

---

## 一、整体架构：四层记忆 + 双通道检索

小白X 不是“把聊天记录整段塞向量库”那么简单，而是把记忆拆成 **4 个层级**，每层有不同的来源、不同的向量化文本、不同的检索角色：

| 层 | 存储名 | 语义名（召回层） | 内容 | 来源 | 是否向量化 |
|----|--------|-----------------|------|------|-----------|
| **L0** | StateAtom（场景锚点） | anchor（锚点） | 每个 AI 楼层提炼的 1–2 个“场景卡片”（60–100 字自然语言）+ 关系三元组 edges | LLM 逐轮提取 | ✅ 双向量（场景向量 + 关系向量） |
| **L1** | Chunk（原文块） | evidence（证据） | 聊天原文按 ~200 token 切块 | 直接切聊天 `mes` | ✅ 单向量 |
| **L2** | Event（事件） | event（事件） | 剧情总结里的“事件”（带楼层范围 `(#X-Y)`） | LLM 增量总结 | ✅ 单向量 |
| **L3** | Fact（事实） | constraint（约束） | SPO 三元组世界事实（位置/生死/归属/关系趋势） | LLM 增量总结 | ❌ 结构化注入，不向量化 |

检索时采用 **Dense（稠密向量）+ Lexical（词法/BM25 类）双通道**，再做 RRF 融合、Rerank 精排、MMR 去冗余、PPR 图扩散、因果链追溯，最终拼成注入提示词。

```mermaid
flowchart TD
    Chat[聊天记录 chat[]] -->|逐轮 LLM 提取| L0[L0 场景锚点<br/>scene+edges]
    Chat -->|~200token 切块| L1[L1 原文块 chunk]
    Chat -->|增量总结 LLM| SUM[剧情总结 JSON]
    SUM --> L2[L2 事件 event]
    SUM --> L3[L3 事实 fact SPO]

    L0 -->|bge-m3| V0[(stateVectors)]
    L1 -->|bge-m3| V1[(chunkVectors)]
    L2 -->|bge-m3| V2[(eventVectors)]

    Q[最近3条消息<br/>构建查询] --> R[9阶段召回引擎]
    V0 --> R
    V1 --> R
    V2 --> R
    L3 --> R
    R --> P[拼装注入提示词<br/>extension_prompts]
```

---

## 二、用来检索的“向量化文本”是怎么来的

这是本问题的核心。**不同层向量化的文本完全不同**：

### L0 场景锚点（最关键的检索层）

L0 不是聊天原文，而是 LLM 把“用户 + AI 一轮对话”压缩成的**场景摘要句**。
- 提取代码：`vector/llm/atom-extraction.js`
- 每个 AI 楼层产出 1–2 个 `anchor`，结构：
  ```json
  {
    "scene": "60-100字完整场景描述（纯自然语言，高召回钩子）",
    "edges": [{"s": "施事方", "t": "受事方", "r": "互动行为"}],
    "where": "地点"
  }
  ```
- 转换为存储原子 `atom`（`anchorToAtom`）：
  - `semantic = scene` → **这是 embedding 的唯一文本入口**
  - `edges` → 关系三元组，用于图扩散
- 向量化时（`state-integration.js` 的 `vectorizeAtoms`）每个原子做 **两个向量**：
  - `vector`：对 `semantic`（场景句）做 embedding —— 用于语义召回
  - `rVector`：对 `edges[].r`（去重后的“互动行为”短语聚合）做 embedding —— 用于关系/动作召回

> 设计意图（源码注释）：BGE-M3 对“自然语言段落”召回精度最高 → `scene` 写成纯白描叙述句；提示词反复强调**保留原词**（人名/昵称/地点/道具/动作/暧昧冲突钩子），禁止写“两人发生冲突”这类抽象空话，目的是让“玩家以后哪怕只隐约提一句也能命中”。

### L1 原文块

- 切块代码：`vector/pipeline/chunk-builder.js`
- 直接取聊天消息 `message.mes`，做清洗后按句子聚合到 ~200 token：
  - `filterText()` 应用用户自定义过滤规则
  - 去掉 `[tts:...]` 标记
  - 去掉 `<state>...</state>` 标签（状态块由 L0 单独处理）
- 每块 `text` 直接拿去 embedding。L1 是“原文证据”，用于在 L0 命中后补回精确原文。

### L2 事件

- 来源：增量剧情总结（`generate/`）产出的 `events[].summary`（带楼层标记 `(#X-Y)`）。
- 这些 summary 文本被 embedding 入 `eventVectors`，检索时作为“事件级”召回单元。

### L3 事实（不向量化）

- SPO 三元组（`{s, p, o, isState, trend}`），如“某人 | 位置 | 客栈”“A | 对B的看法 | 亲密”。
- 不做向量检索，而是作为**硬约束**直接结构化注入（保证世界一致性、纠错）。

### 查询向量（Query）怎么来

- 构建代码：`vector/retrieval/query-builder.js`
- 取**最近 3 条消息**（有“待发送用户消息 pending”时取 2 条上下文 + pending 作焦点），每条**独立 embedding**，再加权平均：
  - R1 基础权重：焦点 `0.55`、近上下文 `0.30`、远上下文 `0.15`
  - 短消息（<50 字）按 `lengthFactor` 线性降权（下限 0.35），但焦点归一化后保底 ≥0.35
- 第二轮（R2）用首轮命中的 L0/L2 结果生成 `hints` 段（权重 0.25），再次加权平均增强查询。
- 同时产出 `lexicalTerms`（实体优先 + 高频实词，用于词法检索）和 `rerankQuery`（焦点在前的纯自然语言，用于 cross-encoder 精排）。

---

## 三、聊天记录如何向量化并入库存储

### Embedding 引擎

- 统一入口：`vector/utils/embedder.js` → 实际走 `vector/llm/siliconflow.js`
- **默认模型：`BAAI/bge-m3`（1024 维），OpenAI 兼容 `/embeddings` 接口，默认硅基流动（SiliconFlow）**
- 引擎指纹：`provider:model:1024`（如 `siliconflow:BAAI/bge-m3:1024`），用于校验“换了模型就别拿旧向量混用”。
- **多 Key 轮询**：API Key 支持用 `,;|` 或换行分隔多个，自动轮询分散并发压力（`getApiKey`）。
- 批量大小：L0/L1 普遍 `batchSize = 20`，逐批请求。

### 存储（Dexie / IndexedDB）

数据库 `LittleWhiteBox_Memory`（`data/db.js`，DB_VERSION=3），表结构：

| 表 | 主键 | 内容 |
|----|------|------|
| `meta` | `chatId` | 构建进度（`lastChunkFloor`）、引擎指纹 |
| `chunks` | `[chatId+chunkId]` | L1 原文块文本/楼层/speaker |
| `chunkVectors` | `[chatId+chunkId]` | L1 向量（Float32） |
| `eventVectors` | `[chatId+eventId]` | L2 事件向量 |
| `stateVectors` | `[chatId+atomId]` | L0 向量（含 `vector` 与 `rVector`） |

- 向量以 `Float32Array` → ArrayBuffer 形式存（`float32ToBuffer` / `bufferToFloat32`），省空间。
- L0 的原子文本/状态（`semantic`/`edges`/楼层处理状态）另存于 state-store 元数据。

### 入库流程（全量 / 增量 / 同步）

- **L0**（`pipeline/state-integration.js`）：
  - Phase 1：并发（默认 10）逐轮 LLM 提取场景锚点，只存文本，记录每楼状态 `ok/empty/fail`（`fail` 可重试）。
  - Phase 2：把新原子的 `semantic` + 关系聚合 `r` 一起批量 embedding，写 `stateVectors`。
- **L1**（`pipeline/chunk-builder.js`）：
  - `buildAllChunks`：清库 → 全量切块 → 分批 embedding → 写 `chunkVectors`，更新 `meta.lastChunkFloor`。
  - `buildIncrementalChunks`：从 `lastChunkFloor+1` 起增量构建（指纹不匹配则跳过）。
  - 消息变动同步：`syncOnMessageDeleted`（删 ≥newLength 的块）、`syncOnMessageSwiped`（删最后楼层块等重建）。
- **L2/L3**（`generate/generator.js` + `llm.js`）：LLM 增量总结产出 events/facts，事件 summary 再 embedding 入 `eventVectors`。

---

## 四、检索召回的完整流程（recall 引擎 9 阶段）

核心代码：`vector/retrieval/recall.js`（标注为 v9：Dense-Gated Lexical + Entity Bypass）。
稠密打分在 Web Worker 里跑（`vector/runtime/runtime.worker.js`、`scoring.js`），避免阻塞主线程。

| 阶段 | 名称 | 做什么 |
|------|------|--------|
| 1 | **Query Build** | 确定性构建查询包（无 LLM）：最近 3 条消息分段、加权、实体抽取、lexicalTerms |
| 2 | **R1 Dense 检索** | 3 段查询 batch embedding → 加权平均 → 对 L0 anchor / L2 event 算余弦相似度 |
| 3 | **Query Refinement** | 用 R1 命中的 L0/L2 生成 `hints` 段 |
| 4 | **R2 Dense 检索** | 复用 R1 向量 + embedding hints → 再加权平均，二次召回 |
| 5 | **Lexical 检索 + Dense 门控合并** | MiniSearch 词法检索；词法命中的 event/floor 要过 dense 相似度门槛（事件 ≥0.60、楼层 ≥0.50）才允许并入 |
| 6 | **Floor W-RRF 融合 + Rerank** | Dense/Lexical 两路用加权 RRF（`RRF_K=60`，dense 权 1.0 / lex 权 0.9）融合到楼层级，再用 `bge-reranker-v2-m3` 精排 top-N |
| 7 | **L1 配对组装** | 每个命中的 L0 配回同楼层 top-1 AI 块 + top-1 USER 块（原文证据） |
| 7.5 | **PPR 图扩散** | 基于 L0 的 `edges` 关系图做 Personalized PageRank 扩散，补召回“关系相邻”的记忆（`retrieval/diffusion.js`） |
| 8 | **L0 → L2 反向查找** | 基于最终选中的 L0，反查关联事件 |
| 9 | **Causation Trace** | 沿事件 `causedBy` 因果边回溯（最多深度 10），补齐前因事件 |

关键阈值（`recall.js` 的 `CONFIG`）：Anchor 最低相似度 0.58；Event 最低 0.60、MMR λ=0.72、实体旁通 0.70；词法 dense 门槛 0.60/0.50；Rerank top 20、最低分 0.10。

召回结束后由 `generate/prompt.js` 按 token 预算（共享池 ~10000）分类拼装：约束(constraint/L3) → 弧光(arcs) → 事件(event/L2) → 证据(evidence/L1)，最终在 `GENERATION_STARTED` 时写入 SillyTavern 的 `extension_prompts`。

---

## 五、不同阶段的提示词

### 1) L0 场景锚点提取（`vector/llm/atom-extraction.js`）

System 提示要点（“你是场景摘要器”）：
- 输入 `<round><user>...</user><assistant>...</assistant></round>`，输出严格 JSON `{"anchors":[...]}`。
- `scene`：60–100 字纯自然语言白描，**优先保留原词**（人名/称呼/地点/道具/动作/情绪/关系变化/暧昧冲突钩子），**禁止抽象空话**（“两人交谈/关系升温/气氛暧昧”）。
- `edges`：`{s 施事方, t 受事方, r 互动行为}`，`r` 用 6–12 字动作模板短语（“提出交易条件”“当众揭露秘密”），不写人名/心理描写。
- 数量规则：最多 2 个，场景明显切换才给 2 个，无互动返回 `{"anchors":[]}`。
- 调用参数：`temperature=0.3, max_tokens=600`，带 1 次重试。

### 2) 增量剧情总结（`data/config.js` 的一组 DEFAULT_SUMMARY_* 提示词）

这是一条**多轮“伪对话”协议**，用于产出 L2 事件 + L3 事实：
- `DEFAULT_SUMMARY_SYSTEM_PROMPT`：定义“Story Analyst / Summary Specialist”角色，规定增量化、只提新增、事件分类（相遇/冲突/揭示/抉择/羁绊/转变/收束/日常）与权重（核心/主线/转折/点睛/氛围）、因果链 `causedBy`、关系趋势、SPO 事实图谱。
- `DEFAULT_SUMMARY_ASSISTANT_DOC_PROMPT`：规范 `event.summary` 写法（**高召回回忆卡片**，保留原词、写清谁在哪拿什么对谁做了什么，禁止概括空话，给了合格/不合格对照例子）；SPO 事实规则（s+p 为键覆盖、`isState` 区分核心约束 vs 可清理软记忆、关系类用 `对X的看法`+`trend`、删除用 `retracted:true`）。
- `DEFAULT_SUMMARY_ASSISTANT_ASK_SUMMARY_PROMPT` / `ASK_CONTENT_PROMPT`：模拟“先要已有总结，再要新对话”的两步握手，强化去重。
- `DEFAULT_SUMMARY_META_PROTOCOL_START_PROMPT` + `DEFAULT_SUMMARY_USER_JSON_FORMAT_PROMPT`：给出最终输出 JSON 结构（`mindful_prelude`/`keywords`/`events`/`newCharacters`/`arcUpdates`/`factUpdates`），含 `{$nextEventId}`、`{$historyRange}` 等运行时占位符。
- `DEFAULT_SUMMARY_ASSISTANT_CHECK_PROMPT` / `USER_CONFIRM_PROMPT` / `ASSISTANT_PREFILL_PROMPT`：合规自检 + 确认 + JSON 前缀预填（强制模型直接吐 JSON）。
- 组装在 `generate/llm.js` 的 `buildSummaryMessages`：把上述拆成 top/bottom 两段消息，base64 编码后交给流式生成模块；已有事实会以 `s | p | o [trend]` 文本喂回，并附“已有谓词，请复用”提示，避免同义词膨胀。

### 3) Rerank 精排（`vector/llm/reranker.js`）

- 模型 `BAAI/bge-reranker-v2-m3`（硅基 `/rerank`），输入 `rerankQuery` + 候选文档，返回 `relevance_score` 排序；非生成式，无自然语言提示词；同样支持多 Key 轮询、批大小 20、并发 5、最多 100 文档。

### 4) 记忆注入模板（`DEFAULT_MEMORY_PROMPT_TEMPLATE`）

最终把召回到的记忆包裹进给主模型的提示里：
```
以上是还留在眼前的对话
以下是脑海里的记忆：
• [定了的事] 这些是不会变的        ← L3 事实/约束
• [其他人的事] 别人的经历…         ← 旁系记忆
• 其余部分是过往经历的回忆碎片      ← L0/L2/L1 召回
请内化这些记忆：
{$剧情记忆}
这些记忆是真实的，请自然地记住它们。
```

---

## 六、要点速记

- **向量化文本不是聊天原文**：检索主力是 L0“场景锚点句”（LLM 提炼、保留原词的 60–100 字白描），L1 原文块只是命中后补回证据。
- **每个 L0 有双向量**：场景语义向量 + 关系动作向量，兼顾“讲了什么”和“谁对谁做了什么”。
- **模型栈**：embedding=`bge-m3`(1024d)，rerank=`bge-reranker-v2-m3`，均走硅基流动 OpenAI 兼容接口，多 Key 轮询。
- **存储**：Dexie/IndexedDB，向量以 Float32 buffer 落库，按 `chatId` 隔离，引擎指纹防混用。
- **召回是混合式**：Dense + Lexical 双通道 → RRF 融合 → Rerank → MMR → PPR 图扩散 → 因果链追溯，最后按预算分类注入。
- **L3 事实不进向量库**，作为硬约束结构化注入，负责世界一致性与纠错。
