# 小白X（LittleWhiteBox）向量化召回方案

## 一、整体架构概览

小白X 的向量化召回系统位于 `modules/story-summary/vector/` 目录下，是一个多层次、混合检索的 RAG（Retrieval-Augmented Generation）系统，专为 LLM 角色扮演场景设计。

### 核心设计理念

- **多层数据结构**：L0（StateAtom 场景锚点）→ L1（Chunk 文本块）→ L2（Event 事件）→ L3（Fact 知识图谱）
- **混合检索**：Dense（向量语义） + Lexical（词法 BM25） + PPR（图扩散）三路并行
- **两轮检索**：Round 1 粗筛 → Query Refinement → Round 2 精排
- **Floor 粒度融合**：以对话楼层为基本单位进行 W-RRF 融合与 Rerank

---

## 二、数据层（存储与索引结构）

### 2.1 存储后端

使用 **Dexie.js**（IndexedDB 封装），数据库名 `LittleWhiteBox_Memory`，包含以下表：

| 表名 | 索引键 | 用途 |
|------|--------|------|
| `meta` | chatId | 元数据（指纹、最后处理楼层等） |
| `chunks` | [chatId+chunkId], [chatId+floor] | L1 文本块 |
| `chunkVectors` | [chatId+chunkId] | L1 向量 |
| `eventVectors` | [chatId+eventId] | L2 事件向量 |
| `stateVectors` | [chatId+atomId], [chatId+floor] | L0 场景锚点向量 |

### 2.2 四层数据结构

#### L0 - StateAtom（场景锚点）

- 存储位置：`chat_metadata`（持久化），向量存 IndexedDB（可重建）
- 每个 AI 楼层提取 1-2 个场景锚点
- 结构：`{ semantic: "60-100字场景描述", edges: [{s, t, r}], where: "地点" }`
- `semantic` 字段为纯自然语言，针对 BGE-M3 嵌入模型优化
- `edges` 为三元组结构（TransE 思想），用于图扩散和实体匹配

#### L1 - Chunk（文本块）

- 标准 RAG chunking，每块约 200 tokens
- 按句子边界切分
- 清洗规则：过滤 TTS 标记、`<state>` 标签、用户自定义过滤
- 每块记录 `{ floor, chunkIdx, speaker, isUser, text, textHash }`

#### L2 - Event（事件）

- LLM 生成的结构化事件摘要
- 包含：summary、participants（参与人物）、type、weight、causedBy（因果链）
- summary 末尾附楼层标记如 `(#5)` 或 `(#5-8)`

#### L3 - Fact（知识图谱）

- SPO 三元组（Subject-Predicate-Object）
- 跟踪硬性事实：生死、物品归属、位置、关系等

### 2.3 词法索引

使用 **MiniSearch** 构建倒排索引，覆盖 L1 chunks 和 L2 events，支持 IDF 加权检索。

---

## 三、数据生成流水线（Pipeline）

### 3.1 L0 提取 (`state-integration.js` + `atom-extraction.js`)

**流程：**
1. 增量扫描：遍历所有 AI 楼层，跳过已处理（ok/empty）的
2. 构建输入：将 user + AI 消息拼合成对话文本
3. LLM 提取：调用 LLM 生成结构化场景锚点 JSON
4. 统一向量化：提取完成后 batch embed 所有 semantic 文本

**LLM Prompt 设计要点：**
- 提取 1-2 个场景锚点，每个包含 scene（场景描述）、edges（关系三元组）、where（地点）
- scene 要求 60-100 字、纯自然语言白描、保留原始词面（人名、物件、动作）
- 禁止空泛写法，要求"信息密集但流畅"
- 并发处理（默认 10 并发），支持错开延迟（15ms stagger）

### 3.2 L1 切分 (`chunk-builder.js`)

- 按楼层增量构建
- 估算 token 数（中文 1 字 = 1 token，其他 4 字符 = 1 token）
- 超过 200 tokens 则按句子边界切分
- 每个 chunk 生成向量并存入 IndexedDB

### 3.3 Embedding 服务 (`siliconflow.js`)

- 默认使用 **硅基流动 API**（SiliconFlow）
- 默认模型：**BAAI/bge-m3**
- 向量维度：1024
- 支持多 Key 轮询负载均衡
- OpenAI 兼容接口（`/v1/embeddings`）

---

## 四、召回引擎（Recall Engine v9）

核心入口函数：`recallMemory(allEvents, vectorConfig, options)` 

### 4.1 九阶段流水线

```
阶段 1: Query Build（确定性，无 LLM）
阶段 2: Round 1 Dense Retrieval（batch embed → 加权平均）
阶段 3: Query Refinement（用 R1 命中结果生成 hints）
阶段 4: Round 2 Dense Retrieval（R1 向量 + hints → 加权平均）
阶段 5: Lexical Retrieval + Dense-Gated Event Merge
阶段 6: Floor W-RRF Fusion + Rerank + L1 配对
阶段 7: L1 配对组装（L0 → top-1 AI L1 + top-1 USER L1）
阶段 7.5: PPR Diffusion（图扩散）
阶段 8: L0 → L2 反向查找
阶段 9: Causation Trace（因果链追溯）
```

### 4.2 阶段详解

#### 阶段 1：Query Build

**文件**：`query-builder.js`

从最近 3 条消息（有 pending 时取 2 条上下文 + pending）构建 `QueryBundle`：

- **焦点确定**：pendingUserMessage 存在时为焦点，否则取最后一条消息
- **加权设计**：
  - R1 权重：焦点 55%、近上下文 30%、远上下文 15%
  - R2 权重（有 hints 时）：焦点 45%、远上下文 10%、近上下文 20%、hints 25%
- **长度惩罚**：< 50 字的消息线性衰减权重，下限 35%
- **焦点最小占比保底**：归一化后焦点不低于 35%
- **额外输出**：
  - `rerankQuery`：rerank 用的纯文本查询
  - `lexicalTerms`：基于 TF-IDF 提取的高频实词（最多 10 个）
  - `focusCharacters`：焦点人物（用于实体过滤）

#### 阶段 2：Round 1 Dense Retrieval

1. 将 querySegments 的文本 batch embed（调用 embedding API）
2. 按权重加权平均得到 `queryVector_v0`
3. 用 v0 向量检索 L0 Anchors 和 L2 Events

**L0 检索（Anchors）**：
- 阈值：cosine similarity ≥ 0.58
- 通过 runtime worker 批量打分

**L2 检索（Events）**：
- 阈值：cosine similarity ≥ 0.60
- 候选上限 100，最终选择上限 50
- 实体过滤：similarity < 0.70 时必须包含焦点人物
- **MMR 去冗余**：λ=0.72，平衡相关性与多样性

#### 阶段 3：Query Refinement

用 R1 命中的 L0/L2 结果生成 `hintsSegment`：
- 从命中的 L0 atoms 和 events 中提取关键文本
- 作为第二轮检索的上下文增强

#### 阶段 4：Round 2 Dense Retrieval

- 如果有 hintsSegment：embed hints → 与 R1 向量拼接 → 按 R2 权重加权平均得到 `queryVector_v1`
- 否则退化为 v0
- 用 v1 重新检索 Anchors 和 Events

#### 阶段 5：Lexical Retrieval + Dense-Gated Merge

**词法检索**：
- 使用 MiniSearch 在 L1 chunks + L2 events 上检索
- 查询词为阶段 1 提取的 `lexicalTerms`
- 支持 IDF 加权

**Dense 门控合并**：
- Lexical 命中的 event 必须通过 Dense 验证（cosine ≥ 0.60）才合并
- 防止纯关键词匹配引入语义不相关的事件

#### 阶段 6：Floor 粒度融合 + Rerank

**6a. Dense Floor Rank**：按楼层聚合 L0 命中的 maxSim

**6b. Lexical Floor Rank**：
- 按楼层聚合词法命中分数
- Dense 门槛过滤（楼层最大 dense similarity ≥ 0.50）
- 密度加成：`score × (1 + 0.3 × log2(hitCount))`

**6c. W-RRF 融合**（Weighted Reciprocal Rank Fusion）：
- `RRF_K = 60`
- Dense 权重 1.0，Lexical 权重 0.9
- 融合后取 top 60

**6d. Must-Keep Guard**：
- 高 IDF 词（≥ 2.2）命中的楼层强制保留（最多 3 个）
- 按聚类窗口去重（距离 ≤ 2 的不重复保留）

**6e-6f. Rerank**：
- 使用 **BAAI/bge-reranker-v2-m3** 精排模型
- 对融合后的候选楼层进行精排
- top 20，最低分 0.10

**6g. L0 收集**：
- 从通过 rerank 的楼层拉取所有 L0 atoms
- 按 dense similarity 排序

#### 阶段 7：L1 配对组装

对每个选中的楼层：
- 拉取 AI 楼层 + 对应 USER 楼层的 L1 chunks
- 用 queryVector 对每个 chunk 打 cosine 分
- 取 AI top-1 chunk + USER top-1 chunk 作为证据对

#### 阶段 7.5：PPR Diffusion（Personalized PageRank 图扩散）

**文件**：`diffusion.js`

**算法**：
1. 在所有 L0 atoms 上构建无向加权图
   - 边权通道：WHAT（互动重叠 40%）+ R_SEM（语义相似度 40%）+ WHO（实体重叠 10%）+ WHERE（地点 5%）+ TIME（时间衰减 5%）
2. 以 reranked L0 为种子节点，运行 Personalized PageRank
   - 种子按 rerankScore 加权
   - α = 0.15（重启概率）
   - 收敛阈值 ε = 1e-5，最大 50 轮迭代
3. 后验门控：
   - 排除种子本身
   - cosine(query, stateVector) ≥ 0.46
   - finalScore = PPR_normalized × cosine ≥ 0.10

**作用**：发现与种子叙事关联但语义不直接相似的记忆（如同一角色不同场景的呼应）

#### 阶段 8：L0 → L2 反向查找

对最终选中的 L0 楼层，检查是否有 L2 events 的楼层范围与之重叠，如果有且 dense similarity 达标则补充加入。

#### 阶段 9：Causation Trace

沿 L2 events 的 `causedBy` 字段追溯因果链：
- 最大深度 10
- 最多注入 30 条因果事件
- 按引用次数和深度排序

---

## 五、Runtime 加速层

**文件**：`runtime/runtime.js`, `runtime.worker.js`, `scoring.js`

- 使用 Web Worker 在后台维护热数据（L0/L1/L2 向量）
- Session 模式：`beginRecallRuntimeSession` → 检索 → `endRecallRuntimeSession`
- 向量打分在 Worker 中用 Float32Array 高效计算 cosine similarity
- 紧急路径：Worker 不可用时退化到主线程计算

---

## 六、Prompt 注入

**文件**：`generate/prompt.js`

召回完成后，将结果组装为注入 prompt 的文本，包含：

1. **Constraints（L3 Facts）**：硬性事实约束（预算 2000 tokens）
2. **Events（L2）**：召回的事件摘要 + 因果链事件（预算 5000 tokens）
3. **Evidence（L0+L1）**：
   - 已总结楼层：L0 场景描述 + top-1 L1 证据
   - 未总结楼层：直接展示 L1 原文（预算 2000 tokens）
4. **Arcs**：角色弧光追踪（预算 1500 tokens）

总预算上限 10000 tokens（SHARED_POOL_MAX）。

支持用户自定义包裹文本（wrapperHead / wrapperTail）。

---

## 七、关键配置参数一览

| 参数 | 值 | 说明 |
|------|-----|------|
| Embedding 模型 | BAAI/bge-m3 | 向量维度 1024 |
| Rerank 模型 | BAAI/bge-reranker-v2-m3 | 精排 |
| L0 最低相似度 | 0.58 | Anchor 门槛 |
| L2 最低相似度 | 0.60 | Event 门槛 |
| 实体旁通阈值 | 0.70 | 高分直通无需实体匹配 |
| Lexical Dense 门槛 | 0.60 (event) / 0.50 (floor) | 词法结果需 dense 验证 |
| MMR λ | 0.72 | 相关性 vs 多样性 |
| W-RRF K | 60 | RRF 平滑参数 |
| Rerank top_N | 20 | 精排保留数 |
| PPR α | 0.15 | 图扩散重启概率 |
| PPR cosine gate | 0.46 | 图扩散后验门槛 |
| Chunk 大小 | 200 tokens | L1 切分粒度 |
| L0 提取并发 | 10 | LLM 调用并发数 |

---

## 八、分词器

**文件**：`utils/tokenizer.js`

- 使用 **结巴分词 WASM 版本** 处理中文
- 拉丁文字走空格分割
- 支持实体词典注入（最长匹配保护实体词不被切碎）
- 降级策略：WASM 未就绪时用实体保护 + 标点分割
- 自定义停用词表

---

## 九、流程总结图

```
用户发送消息
    │
    ▼
┌─────────────────────────────────┐
│ Query Build                     │
│ (最近3条消息 → 加权向量段)       │
└──────────────┬──────────────────┘
               │
    ▼                              
┌─────────────────────────────────┐
│ Round 1: Dense Retrieval         │
│ • embed segments → weighted avg  │
│ • L0 Anchor search (≥0.58)       │
│ • L2 Event search (≥0.60 + MMR)  │
└──────────────┬──────────────────┘
               │
    ▼
┌─────────────────────────────────┐
│ Query Refinement                 │
│ (R1 hits → hints segment)        │
└──────────────┬──────────────────┘
               │
    ▼
┌─────────────────────────────────┐
│ Round 2: Dense + Lexical         │
│ • embed hints → R2 weighted avg  │
│ • L0/L2 re-search                │
│ • MiniSearch lexical retrieval   │
│ • Dense-gated event merge        │
└──────────────┬──────────────────┘
               │
    ▼
┌─────────────────────────────────┐
│ Floor Fusion + Rerank            │
│ • W-RRF (dense × lex)           │
│ • Must-keep guard (high-IDF)     │
│ • bge-reranker-v2-m3 精排        │
│ • L0 collection per floor        │
└──────────────┬──────────────────┘
               │
    ▼
┌─────────────────────────────────┐
│ Post-processing                  │
│ • PPR Graph Diffusion            │
│ • L0 → L2 reverse lookup        │
│ • Causation Trace                │
│ • L1 pair assembly               │
└──────────────┬──────────────────┘
               │
    ▼
┌─────────────────────────────────┐
│ Prompt Assembly                  │
│ (constraints + events +          │
│  evidence + arcs → inject)       │
└─────────────────────────────────┘
```

---

## 十、与我方 memory-recall.js 的对比参考

| 维度 | 小白X | 我方（姬侠传） |
|------|-------|----------------|
| 数据层次 | 4 层（L0~L3） | 2 层（summaryHistory + weekHistory） |
| 向量模型 | BGE-M3 (1024d) | 由 embedding-service.js 配置 |
| 检索策略 | Dense + Lexical + PPR 三路融合 | Dense 单路 |
| 查询构建 | 加权多段（焦点/上下文/hints） | 单一 query |
| 精排 | bge-reranker-v2-m3 | 无 |
| 图扩散 | PPR (Personalized PageRank) | 无 |
| 去冗余 | MMR (λ=0.72) | 与 RecentMemories 去重 |
| 因果追踪 | causedBy 链式追溯 | 无 |
| Prompt 预算 | 10000 tokens 精细分配 | 由 prompt-builder 统一管理 |
