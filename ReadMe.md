# 姬侠传 / 瀚海 - 游戏模块说明文档

## 项目概述

《姬侠传》（独立前端版又名《瀚海》）是一款基于网页的武侠题材 LLM 互动养成游戏，支持以下三种运行方式：

- **SillyTavern 版本**：搭配角色卡在 ST 中运行，需配合小白X插件
- **独立前端**：直接在浏览器中打开 `index.html` 运行，内置 API 接入（`start-screen-noST.html` 为开局页）
- **Android APK**：打包为安卓应用，手机安装即可游玩

游戏采用模块化架构，将 API 服务、状态管理、UI、游戏逻辑、技能、存储等功能分离到不同文件中。

---

## 文件结构

```
├── index.html                   # 主游戏页面（独立前端入口）
├── index - SR.html              # SillyTavern 流式版本
├── start-screen-noST.html       # 独立前端开局/选档界面
├── start-screen.html            # ST 版开局界面（旧版保留）
├── turn-based-battle-new.html   # 回合制战斗系统（当前版本）
├── turn-based-battle.html       # 回合制战斗（旧版保留）
├── blackjack.html               # 21点赌场小游戏
├── farm.html                    # 农场种植系统
├── alchemy.html                 # 炼丹系统
├── world_map.html               # 世界地图探索
│
├── module/
│   ├── api-service.js           # LLM API 调用服务（OpenAI兼容 + Gemini + 流式）
│   ├── embedding-service.js     # 向量化召回服务（IndexedDB 存储）
│   ├── storage-service.js       # 存档读档服务（独立前端专用）
│   ├── st-converter.js          # ST 存档格式转换（.jsonl → 游戏存档）
│   ├── bgm-manager.js           # BGM 背景音乐管理
│   ├── button-sfx.js            # 按键音效
│   ├── game-config.js           # 游戏静态配置数据
│   ├── game-utils.js            # 工具函数库（含模糊匹配）
│   ├── game-state.js            # 游戏状态管理
│   ├── game-ui.js               # UI 更新和显示函数
│   ├── game-helpers.js          # 辅助函数库
│   ├── game-events.js           # 事件处理函数
│   ├── game-skills.js           # 技能系统逻辑
│   ├── skill-list.js            # 技能定义列表
│   ├── item-list.js             # 道具定义列表
│   ├── special-event.js         # 特殊剧情事件系统
│   ├── game-styles.css          # 主游戏样式
│   ├── game-styles-theme.css    # 主题样式（古风/现代切换）
│   ├── pipeline.js              # 单轮消息处理流水线（请求→解析→提交→存档）
│   ├── prompt-builder.js        # Prompt 编排（6条消息结构 + token预算分配）
│   ├── response-parser.js       # LLM 响应纯解析器（提取MAIN_TEXT/SUMMARY/SIDE_NOTE）
│   ├── variable-system.js       # 三级变量系统（turn/session/global，支持回滚）
│   ├── sync-utils.js            # variableSystem ↔ gameData 双向同步
│   ├── template-engine.js       # 模板引擎（{{变量}} + EJS子集）
│   ├── worldbook-engine.js      # 世界书触发引擎（NPC人设 + 行动指导动态注入）
│   ├── token-utils.js           # Token 估算工具（无外部依赖）
│   ├── summary-history-service.js # 普通回合摘要历史管理
│   ├── week-history-service.js  # 跨周周摘要历史管理（独立前端专用）
│   ├── summary-runner.js        # 周总结异步优化（后台LLM请求，独立前端专用）
│   ├── memory-recall.js         # 向量记忆召回引擎（Top-K余弦相似度）
│   ├── idb-storage.js           # IndexedDB 底层封装（jxz_db）
│   ├── idb-snapshot.js          # 快照专用 IndexedDB（jxz_snapshot_db）
│   ├── prompt-data-core.js      # 核心提示词数据（自动生成，含背景/地点/格式规范）
│   ├── prompt-data-npc.js       # 15个NPC人设提示词（自动生成）
│   ├── prompt-data-actions.js   # 12种行动指导提示词（自动生成）
│   ├── prompt-data-extra.js     # 额外提示词片段（开场语/基调/反重复/思维链等）
│   └── markdown-it.min.js       # Markdown 渲染库（第三方，本地静态）
│
├── ui/
│   └── config-modal.js          # API 配置弹窗（LLM + Embedding 设置）
│
├── tools/
│   ├── st-save-converter.js     # Node.js 命令行 ST 存档转换工具
│   └── generate-prompt-data.js  # 提示词数据生成脚本
│
├── img/
│   ├── location/                # 地点场景图（含 scene/ 子目录）
│   ├── NPC/                     # NPC 头像和立绘
│   └── 战斗差分/                 # 战斗立绘差分（待机/攻击/防御/受击）
│
├── assets/
│   └── image/                   # 小游戏图片素材（农场等）
│
├── music/                       # BGM 音频文件
├── char_card_information/       # 角色卡设定文本（ST 版用）
└── 技能系统相关文档和脚本/        # 技能系统设计文档和模拟脚本
```

---

## 各模块详细说明

### 1. api-service.js — LLM API 调用服务

支持 OpenAI 兼容格式与 Gemini API，流式/非流式均可。独立前端核心服务。

**配置项**（存储于 `localStorage['jxz_apiConfig']`）：
- `endpoint` — API 地址
- `apiKey` — 密钥
- `model` — 模型名
- `type` — `'openai'` 或 `'gemini'`
- `temperature` — 默认 0.9
- `maxOutputTokens` — 默认 18000
- `maxContextTokens` — 默认 500000
- `corsProxyUrl` — CORS 代理地址（线上部署时使用，本地/APK 无需）

**主要函数**：
- `apiService.getConfig()` / `apiService.updateConfig(cfg)` — 读取/更新配置
- `apiService.sendMessage(messages, options)` — 发送请求（非流式）
- `apiService.sendMessageStream(messages, onChunk, onDone, options)` — 流式请求
- `apiService.fetchModels(endpoint, apiKey, type)` — 获取模型列表
- `apiService.getRunEnv()` — 检测运行环境（`'file'`/`'webview'`/`'web'`/`'electron'`）

---

### 2. embedding-service.js — 向量化召回服务

独立前端专属功能，将历史摘要向量化存入 IndexedDB，生成新消息时语义匹配注入上下文。

**配置项**（存储于 `localStorage['jxz_embeddingConfig']`）：
- `enabled` — 是否启用
- `endpoint` — 默认 `https://api.siliconflow.cn/v1`
- `apiKey` — Embedding 专用密钥
- `model` — 默认 `BAAI/bge-m3`

**主要函数**：
- `embeddingService.isEnabled()` — 是否已启用
- `embeddingService.getConfig()` / `embeddingService.updateConfig(cfg)` — 配置管理
- `embeddingService.embed(texts)` — 对文本列表计算向量，返回 `Float32Array[]`
- `embeddingService.getEngineFingerprint()` — 获取模型标识（用于检测旧向量兼容性）

---

### 3. storage-service.js — 存档服务

独立前端的存档/读档服务，使用 `localStorage` 存储。

**主要函数**：
- `storageService.saveGame(payload, name)` — 保存存档
- `storageService.loadGame(slotKey)` — 加载存档
- `storageService.listSaves()` — 列出所有存档
- `storageService.deleteGame(slotKey)` — 删除存档
- `storageService.exportGame(slotKey)` — 导出为 JSON
- `storageService.importGame(json)` — 从 JSON 导入
- `storageService.importSavePayload(payload)` — 直接从 payload 对象导入（ST 转换器使用）
- `storageService.autoSave(payload)` — 自动存档（FIFO 最多保留 3 个，前缀 `[自动]`）
- `storageService.saveEmbedding()` / `storageService.clearEmbeddings()` — 向量数据管理

---

### 4. st-converter.js — ST 存档转换模块（浏览器端）

将 SillyTavern 的 `.jsonl` 聊天记录转换为游戏存档格式。

**入口函数**：
- `window.convertSTJsonl(text)` — 接收 `.jsonl` 文本，返回：
  - 成功：`{ success: true, payload, saveName, warnings }`
  - 失败：`{ success: false, error }`

**内部逻辑**：
- 从第一行 meta 提取 `gameData`
- 解析 assistant 消息：剔除 `<ANAL_for_JXZ>` 分析块，提取 `<MAIN_TEXT>` / `<SUMMARY>` / `<SIDE_NOTE>`
- 三级周号推断：`summary_Backup` 查找 → SUMMARY 内联周标 → carry-forward
- 重建 `summaryHistory`、`weekHistory`、`uiConversation`

---

### 5. bgm-manager.js — BGM 管理

内置多首江湖风格背景音乐，特殊剧情可指定曲目。

**主要函数**：
- `bgmManager.play(trackName)` — 播放指定曲目
- `bgmManager.stop()` — 停止播放
- `bgmManager.setVolume(vol)` — 设置音量（0~1）
- `bgmManager.setEnabled(bool)` — 开关 BGM

设置存储于 `localStorage`，重启后保留。

---

### 6. game-config.js — 游戏配置文件

无任何依赖的静态配置文件。

**主要内容**：
- `valueRanges` — 各数值的 min/max 范围
- `npcs` — NPC 基本信息（名字、描述、头像 ID、是否默认显示）
- `npcNameToId` / `npcPortraits` / `locationBackgrounds` — 映射表
- `actionConfigs` — 行动配置（天赋加成、获得属性）
- `npcLocationProbability` / `npcSparRewards` — NPC 位置概率和切磋奖励
- `defaultGameData` — 游戏初始数据（含技能、装备等所有字段）
- `emotionSynonyms` / `sceneSynonyms` / `npcSynonyms` / `cgSynonyms` — 模糊匹配同义词

---

### 7. game-utils.js — 工具函数库

**主要函数**：
- `isInRenderEnvironment()` — 检测是否在 ST 渲染环境中
- `getRenderFunction()` / `getCurrentRenderer()` — 获取渲染函数/类型
- `clampValue(value, min, max)` — 数值范围限制
- `checkAllValueRanges()` — 检查并修正所有游戏数值
- `calculateLevelFromWuxue(wuxue)` — 武学值 → 可获得等级点数
- `calculateRemainingPoints()` — 计算剩余可分配属性点（考虑装备影响）
- `fuzzyMatch(input, options, synonyms, threshold)` — 通用模糊匹配
- `matchScene()` / `matchEmotion()` / `matchNPC()` / `matchCG()` — 专用匹配函数
- `levenshteinDistance(a, b)` / `stringSimilarity(a, b)` — 字符串相似度计算

---

### 8. game-state.js — 游戏状态管理

管理游戏所有运行时状态，提供状态的读取、保存和同步功能。

**主要状态变量**：
- `gameData` — 完整游戏数据对象
- `playerTalents` — 天赋（根骨、悟性、心性、魅力）
- `playerStats` — 数值（武学、学识、声望、金钱）
- `combatStats` — 战斗数值（攻击力、生命值、暴击率、暴击伤害、格挡、穿甲、回转、吸血、反伤）
- `playerMood` — 体力值
- `inventory` / `equipment` — 背包和装备
- `npcFavorability` / `npcVisibility` / `npcGiftGiven` / `npcSparred` — NPC 状态
- `learnedSkills` / `equippedSkills` — 已学/已装备技能
- `GameMode` — 游戏模式（0=普通，1=SLG）
- `difficulty` / `playerName` — 难度和角色名
- `dayNightStatus` / `seasonStatus` — 昼夜季节
- `summary_Small` / `summary_Week` / `summary_Backup` — 历史总结
- `triggeredEvents` / `currentSpecialEvent` — 特殊事件状态
- `inputEnable` — 自由行动输入框可用状态
- `alchemyDone` — 本周是否已炼丹
- `companionNPC` / `mapLocation` — 随行 NPC 与目的地
- `cgContentEnabled` / `compressSummary` — 功能开关

**主要函数**：
- `loadOrInitGameData()` — 加载或初始化游戏数据
- `saveGameData()` — 保存到 ST 变量（ST 版）
- `syncVariablesFromGameData()` / `syncGameDataFromVariables()` — 双向同步
- `mergeWithDefaults()` — 深度合并，支持版本升级兼容
- `autoSave()` — 独立前端自动存档（每次 LLM 回复后调用）

---

### 9. game-ui.js — UI 更新和显示

**SLG 模式解析**：
- `parseSlgMainText(mainText)` — 解析 SLG 主文本为分页数据（支持流式）

**基础更新**：
- `updateDateDisplay()` / `updateMoodDisplay()` / `updateActionPointsDisplay()` / `updateAllDisplays()`
- `updateStatsDisplay()` — 更新属性面板（含战斗数值、技能、装备词条）
- `updateRelationshipsDisplay()` — 更新好感度面板

**文本与分页**：
- `updateStoryText(text)` — Markdown 渲染并更新故事文本
- `updateStoryDisplay()` — 分页/展开，SLG 三层图渲染
- `doPrevPage()` / `doNextPage()` / `doToggleStoryExpand()`

**弹窗管理**：
- `showModal(text)` / `showConfirmModal(title, msg, onConfirm)`
- `fitModalToViewport(modal)` / `closeAllSpecialModals()`

**道具与装备界面**：
- `updateEquipmentSlot()` / `showItemDetail()` / `getItemEffectText()`

---

### 10. game-helpers.js — 辅助函数库

**消息和子游戏**：
- `handleMessageOutput(message)` — 智能输出（自动判断 ST/独立前端环境）
- `showBlackjackGame()` / `showBattleGame(battleData)` / `showFarmGame()` / `showAlchemyGame()`

**NPC 管理**：
- `getNpcsAtLocation(location)` / `displayNpcs(location)`
- `showNpcSelectionOverlay(npcId, location, event)` / `showNpcInfoPopup()`
- `isClickOnOpaquePixel(event, img)` — 像素级点击检测

**场景与地点**：
- `switchScene(sceneName)` / `showLocationInfo(locationId, event)`
- `setupLocationEvents()` / `updateSceneBackgrounds()`
- `calculateSeason(week)` — 周数→季节计算

**道具操作**：
- `useItem(itemName)` / `equipItem(itemName)` / `unequipItem(itemName)`

---

### 11. game-events.js — 事件处理

**主要函数**：
- `displayRandomEvent(event)` / `displayBattleEvent(event)`
- `parseLLMResponse(response, mainTextContent)` — 解析 LLM 返回的 JSON（含 SLG 特殊解析）
- `setupMessageListeners()` — 子游戏 iframe 消息监听（战斗/赌场/农场/炼丹/世界地图）
- `applyBattleReward(reward)` — 应用战斗奖励
- `handleEventOption()` — 事件选项处理（支持 `"特殊剧情:"` 前缀触发特殊事件链）
- `applyEventReward()` — 应用事件奖励

**特殊逻辑**：
- NPC 好感度变化（含魅力判定和难度调整）
- 战利品掉落处理
- 与 `special-event.js` 联动

---

### 12. game-skills.js — 技能系统逻辑

管理技能的学习、升级、装备和战斗中的触发。

**核心概念**：
- 技能分为攻击/防御/辅助/控制四类，每个技能 1~5 级
- 装备技能消耗「记忆点」：上限 = 学识 / 20（向下取整）
- 升级需消耗金钱，并满足 NPC 好感度前置条件

**主要函数**：
- `getLearnedSkills()` / `getEquippedSkills()` — 读取技能状态
- `canLearnSkill(skillId, level)` — 检查能否学习/升级
- `learnSkill(skillId, level)` — 学习/升级技能
- `equipSkill(skillId)` / `unequipSkill(skillId)` — 装备/卸下技能
- `getMemoryPointsUsed()` / `getMemoryPointsMax()` — 记忆点管理
- `triggerSkill(skillId, context)` — 战斗中触发技能效果

---

### 13. skill-list.js / item-list.js — 数据定义文件

**skill-list.js**：16 个技能的完整定义，每个技能包含：
- `id` / `name` / `type` / `description`
- `triggerCondition` — 触发时机
- `effects` — 各级效果数组
- `prerequisites` — 前置条件（NPC 好感度）
- `memoryCost` — 记忆点消耗

**item-list.js**：所有道具（武器/防具/饰品/消耗品/材料/种子）的定义，含：
- 基础属性（攻击力、生命值加成）
- 战斗属性词条（暴击率、暴击伤害、格挡、穿甲、回转、吸血、反伤）
- 天赋加成（根骨/悟性/心性/魅力）
- 购买/售出价格

---

### 14. special-event.js — 特殊剧情事件系统

管理特殊剧情事件链的触发、条件检查和效果应用。

**主要函数**：
- `checkSpecialEvents()` — 检查符合条件的事件（按优先级排序）
- `triggerSpecialEvent(event, options)` — 触发事件
- `getTriggeredEvents()` — 获取已触发事件列表
- `resetEventTrigger(eventId)` — 重置触发状态

**内部函数**：
- `getValueByPath(path)` / `setValueByPath(path, val)` — 支持嵌套路径读写（如 `"npcFavorability.C"`）
- `checkCondition(value, condition)` — 支持 min/max/equals/in 四种检查方式
- `applyEventEffects(event)` — 支持 set/add/push 三种操作

**事件数据结构**：
```js
{
  id: 'unique_id',
  name: '事件名称',          // 调试用
  priority: 10,             // 数字越大越优先
  conditions: { ... },      // 触发条件
  effects: { ... },         // 触发效果
  text: '<SLG_MODE>...'     // 预设文本（SLG_MODE 格式）
}
```

---

### 15. 小游戏 HTML 文件

**turn-based-battle-new.html — 回合制战斗（当前版本）**
- 7 种战斗指令：集气/防御/轻攻/重攻/绝招/嘴炮/道具
- 完整克制链：防御克普攻、重攻克轻攻、绝招克防御、嘴炮克绝招
- 二级属性：暴击率/暴击伤害/格挡/穿甲/回转/吸血/反伤
- 6 种随机场地效果：杀意/瘴疠/固守/气海/缠斗/回春
- 战利品掉落系统
- 角色立绘差分动画（待机/攻击/防御/受击）
- 战斗道具（大力丸/筋骨贴/金疮药/霹雳丸）
- 与技能系统联动（触发战斗技能效果）

**blackjack.html — 21点赌场**
- 经典 21 点规则，A 自动最优计算
- 通过 postMessage 与主游戏同步金钱

**farm.html — 农场种植**
- 4×3 格地，4 种作物（小麦/茄子/甜瓜/甘蔗），不同成熟周期
- 操作：种植/浇水/除虫（恢复健康）/施肥（提升品质）/收割
- 作物品质影响售价（最高翻倍）
- 每周自然成长 + 随机事件（蝗虫/雨水/日丽/野兽）
- 批量操作支持

**alchemy.html — 炼丹系统**
- 15 步操作，5 种指令：猛火/文火/投药/冷凝/淬炼
- 炉温倍率机制影响品质和完成度增长速度
- 随机事件（正/负/中性共 12 种）
- 产出按品质分级：普通丹药 / 培元丹 / 易筋丹 / 九转金丹
- 每周限一次

**world_map.html — 世界地图探索**
- 西域地点可视化地图（十数个地点，含危险度/友善度评级）
- 随行 NPC 选择（需满足好感度条件）
- 探索结果通过 postMessage 返回

**start-screen-noST.html — 独立前端开局界面**
- 角色命名（最多 8 字）
- 难度选择（简单/普通/困难）
- 出身背景选择（含自定义出身，额外 +40 属性点）
- 天赋属性分配（根骨/悟性/心性/魅力）
- NPC 登场勾选
- 「模型设置」按钮入口（调用 `ui/config-modal.js`）
- 导入 SillyTavern 存档（`.jsonl`）按钮

---

### 17. pipeline.js — 单轮消息处理流水线

独立前端的核心调度模块，负责一次完整"用户输入 → LLM 回复 → 状态提交"的全流程。

**设计原则**：请求阶段无副作用（失败可直接丢弃），提交阶段可回滚（流式中断时状态还原）。

**主要函数**：
- `pipeline.runTurn(userMessage, options)` — 执行一个完整回合（构建 prompt → 调用 API → 解析 → 写状态 → 存档 → 触发总结）
- `pipeline.abort()` — 中断当前正在进行的流式生成
- `pipeline.isStreaming()` — 查询是否正在流式生成
- `pipeline.submitSummaryManually(text, source)` — 手动提交摘要（调试/重新生成用）

---

### 18. prompt-builder.js — Prompt 编排

将游戏状态和历史数据组合成 6 条消息结构，发送给 LLM。

**消息结构**：
1. `system` — 开场语 + 设定 + 背景
2. `user` — `[Start a new chat]`
3. `assistant` — 最近一条 AI 回复（LatestReply 包裹块）
4. `user` — 用户输入 + 行动指导 + 格式规范 + 思维链引导
5. `assistant` — jailbreak prefill
6. `user` — final instruction

**Token 预算管理**：根据 `apiService.getConfig().maxContextTokens` 动态分配各部分 token 配额，依次纳入最近摘要、向量召回结果、历史周摘要。

**主要函数**：
- `promptBuilder.build(userMessage, options)` — 返回消息数组，供 `apiService.sendMessageStream` 使用
- `promptBuilder.estimateTokens(messages)` — 估算消息 token 总量

---

### 19. response-parser.js — LLM 响应解析器

纯解析层，不写全局变量，解析后将结果返回给 `pipeline.js` 统一提交。

**主要函数**：
- `responseParser.removeThinkingContent(text)` — 移除 `<thinking>` / `<ANAL_for_JXZ>` 等分析块
- `responseParser.extractSLGBlocks(text)` — 提取 `<MAIN_TEXT>` / `<SUMMARY>` / `<SIDE_NOTE>` 内容
- `responseParser.parseSideNote(json)` — 解析 `<SIDE_NOTE>` JSON，得到位置变动、好感变化、剧情基调等字段
- `responseParser.parse(rawText)` — 一次性完整解析，返回结构化结果对象

---

### 20. variable-system.js — 三级变量系统

封装 `turn`/`session`/`global` 三级变量，独立于 `gameData`，支持回滚和导出。

| 层级 | 作用域 | 说明 |
|------|--------|------|
| `turn` | 当前回合 | 重新生成时可回滚；pipeline 请求失败时不提交 |
| `session` | 当前存档 | 等价于 `gameData`，跨回合持久 |
| `global` | 全局 | 跨存档持久，用于 API 设置等 |

读取优先级：`turn → session → global`

**主要函数**：
- `variableSystem.get(key)` / `variableSystem.set(key, val, level)` — 读写变量
- `variableSystem.beginTurn()` — 开始新回合（克隆 session → turn）
- `variableSystem.commitTurn()` — 提交回合数据到 session
- `variableSystem.rollbackTurn()` — 回滚（放弃 turn 层变更）
- `variableSystem.exportSession()` — 导出 session 层快照（用于存档）

---

### 21. sync-utils.js — 双向同步工具

提供 `variableSystem`（新架构）与 `gameData`（旧架构）之间的双向同步，确保两套数据保持一致。

**主要函数**：
- `syncGameDataFromVariableSystem()` — variableSystem session → gameData（提交回合后调用）
- `syncVariableSystemFromGameData()` — gameData → variableSystem（加载存档后调用）

---

### 22. template-engine.js — 模板引擎

支持 ST 兼容的 `{{变量}}` 语法和 EJS 子集，用于渲染提示词模板中的动态内容。

**支持语法**：
- `{{变量名}}` / `{{变量名:默认值}}` — 变量替换
- `<%_ const x = expr; _%>` — 变量声明
- `<%_ if (cond) { _%> ... <%_ } else { _%> ... <%_ } _%>` — 条件分支
- `<%= expr %>` / `<%- expr %>` — 输出表达式（转义/不转义）

**主要函数**：
- `templateEngine.render(template, context)` — 渲染模板，返回字符串
- `templateEngine.compile(template)` — 预编译模板为函数（重复渲染时使用）

---

### 23. worldbook-engine.js — 世界书触发引擎

根据用户输入和上一条 AI 回复的内容，动态注入匹配到的 NPC 人设和行动指导提示词。

**依赖数据**：`PROMPT_NPC_*`（来自 `prompt-data-npc.js`）、`PROMPT_ACTION_*`（来自 `prompt-data-actions.js`）

**主要函数**：
- `worldbookEngine.matchNPCs(userInput, lastAIReply)` — 返回当前场景中出现的 NPC 人设数组
- `worldbookEngine.matchActions(actionType)` — 返回当前行动对应的行动指导文本
- `worldbookEngine.buildWorldbook(context)` — 汇总注入内容，返回字符串

---

### 24. token-utils.js — Token 估算工具

无外部依赖的轻量 token 计数器，用于 prompt 组装时的预算分配。

**算法**：中日韩字符按 1.5 token/字，其余按 4 字符/token，结果乘 1.1 安全系数。

**主要函数**：
- `tokenUtils.estimate(text)` — 快速估算文本 token 数，返回整数

---

### 25. summary-history-service.js — 摘要历史服务

管理普通回合的 `<SUMMARY>` 历史列表，为 `prompt-builder.js` 提供 `<RecentHistory>` 数据块。

**存储**：Write-Through Cache，优先使用 `storageService`，降级到 `localStorage['jxz_summaryHistory']`。

**主要函数**：
- `summaryHistoryService.load()` / `summaryHistoryService.save(list)` — 读写历史
- `summaryHistoryService.append(entry)` — 追加一条摘要（自动丢弃超出上限的旧条目）
- `summaryHistoryService.getForPrompt(budget)` — 在 token 预算内返回最近若干条摘要
- `summaryHistoryService.clear()` — 清空历史

---

### 26. week-history-service.js — 周摘要历史服务（独立前端专用）

管理跨周的周摘要列表（`newWeek=1` 时入库），与 `summaryHistoryService` 分开存储。周摘要**不参与向量化**，仅作为结构化历史注入 prompt。

**主要函数**：
- `weekHistoryService.load()` / `weekHistoryService.save(list)` — 读写
- `weekHistoryService.append(entry)` — 追加（entry 包含 `week`、`summaryText`、`markWeek` 等字段）
- `weekHistoryService.getForPrompt(budget)` — 在 token 预算内返回若干条周摘要

---

### 27. summary-runner.js — 周总结异步优化（独立前端专用）

每当新周（`newWeek=1`）提交后，在后台异步发起一次独立 LLM 请求，用本周完整的 `uiConversation` 原始正文生成高质量周总结，替换 `weekHistoryService` 中当轮产生的初版总结。

**特点**：
- 不阻塞主流程，失败时 5 秒后重试
- 有独立的 System Prompt（要求生成结构化、可检索的白描摘要）
- 提供中断句柄，切换存档时可取消飞行中的请求

**主要函数**：
- `summaryRunner.run(weekEntry)` — 异步触发周总结生成
- `summaryRunner.cancel()` — 取消当前正在进行的总结任务

---

### 28. memory-recall.js — 向量记忆召回引擎

与 `embeddingService` 配合，提供语义相似度 Top-K 召回，并将召回结果注入 `promptBuilder`。

**主要函数**：
- `memoryRecall.init()` — 从 `storageService` 预热内存缓存
- `memoryRecall.recall(queryText, topK, maxTokens)` — 返回与 queryText 最相关的摘要条目列表
- `memoryRecall.store(id, vector, text, meta)` — 存储新向量到缓存和 IndexedDB
- `memoryRecall.rebuild()` — 对所有未向量化的历史摘要批量重建索引
- `memoryRecall.float32ToBuffer(f32)` / `memoryRecall.bufferToFloat32(buf)` — 序列化工具（存档导出用）

**降级策略**：fingerprint 不匹配（切换 Embedding 模型后）的旧向量自动跳过；召回失败时显示节流弹窗提示，10 秒内只弹一次。

---

### 29. idb-storage.js — IndexedDB 底层封装

提供简单的 Key-Value 异步存储接口，数据库名 `jxz_db`，存储游戏存档和 Embedding 向量。

**主要函数**：
- `idbStorage.get(key)` / `idbStorage.set(key, val)` / `idbStorage.del(key)` — 基本操作
- `idbStorage.keys()` — 列出所有 key
- `idbStorage.clear()` — 清空数据库

---

### 30. idb-snapshot.js — 快照专用 IndexedDB 封装

独立数据库 `jxz_snapshot_db`，接口与 `idb-storage.js` 完全一致（对外暴露 `idbSnapshot` 对象）。用于存储增量快照，与主数据库平级隔离，避免互相干扰。

---

### 31. prompt-data-core.js — 核心提示词数据（自动生成）

由 `tools/generate-prompt-data.js` 生成，**请勿手动编辑**。

包含 5 个核心提示词文件的渲染后模板字符串，挂载到 `window` 全局变量：

| 变量名 | 内容 |
|--------|------|
| `PROMPT_CORE_010` | 故事背景（天山派历史、地理、门派设定） |
| `PROMPT_CORE_020` | 地点介绍（门派各建筑 + 下山地点，EJS 条件分支） |
| `PROMPT_CORE_040` | 主角信息（天赋等级文字描述，EJS 条件分支） |
| `PROMPT_CORE_105` | SLG 模式专用列表（NSFWList / ExpressionList / SceneList / NpcList） |
| `PROMPT_CORE_110` | 格式规范（SLG_MODE / MAIN_TEXT / SUMMARY / SIDE_NOTE 输出格式要求） |

---

### 32. prompt-data-npc.js — NPC 提示词数据（自动生成）

由 `tools/generate-prompt-data.js` 生成，**请勿手动编辑**。

包含 15 个 NPC 的完整人设模板，挂载到 `window.PROMPT_NPC_*`（如 `PROMPT_NPC_ANMU`、`PROMPT_NPC_DONGTING`、`PROMPT_NPC_JISI` 等）。

每个 NPC 模板包含：基本信息、外貌气质、性格内心、行为沟通、能力偏好、情感关系，以及基于好感度的 EJS 条件分支（不同好感段展示不同内容）。

---

### 33. prompt-data-actions.js — 行动指导提示词数据（自动生成）

由 `tools/generate-prompt-data.js` 生成，**请勿手动编辑**。

包含 12 种行动的正文输出指导，挂载到 `window.PROMPT_ACTION_*`：

| 变量名 | 对应行动 |
|--------|---------|
| `PROMPT_ACTION_TRAIN` | 演武场练武 |
| `PROMPT_ACTION_STUDY` | 藏经阁学习 |
| `PROMPT_ACTION_CHORES` | 伙房打杂 |
| `PROMPT_ACTION_SMITH` | 铁匠铺打铁 |
| `PROMPT_ACTION_REST` | 男弟子房休息 |
| `PROMPT_ACTION_VISIT` | 女弟子房拜访 |
| `PROMPT_ACTION_EXPLORE` | 后山探索 |
| `PROMPT_ACTION_REPORT` | 议事厅汇报 |
| `PROMPT_ACTION_SPAR` | NPC 切磋 |
| `PROMPT_ACTION_INTERACT` | NPC 互动 |
| `PROMPT_ACTION_SKIP` | 跳过一周 |
| `PROMPT_ACTION_MAP` | 下山探索 |

每个模板包含：剧情连贯要求、五种结果（大成功/成功/一般/失败/大失败）的倾向说明、起承转合剧情结构要求、注意事项。

---

### 34. prompt-data-extra.js — 额外结构性提示词数据（自动生成）

由 `tools/generate-prompt-data.js` 生成，**请勿手动编辑**。

包含零散但重要的提示词片段：

| 变量名 | 内容 |
|--------|------|
| `PROMPT_OPENING` | 系统消息开场语（告知 LLM 背景调用方式） |
| `PROMPT_INFO_TONE` | 基调规则（温暖、同理心、反负面情绪） |
| `PROMPT_FRESH` | 反重复指令（严禁剧情/句式与历史相似） |
| `PROMPT_THINK_GUIDE` | 思维链引导（COT 格式要求） |
| `PROMPT_JAILBREAK` | jailbreak prefill（assistant 角色扮演起手） |

---

### 16. ui/config-modal.js — API 配置弹窗

提供「模型设置」弹窗，兼容 `index.html` 和 `start-screen-noST.html` 两种环境。

**LLM 配置**（调用 `apiService`）：
- API 类型、Endpoint、Key、模型选择、Temperature、最大输出 Token、上下文窗口
- 「连接测试」按钮（自动拉取模型列表）
- 「发送测试消息」验证功能
- CORS 代理地址（仅线上部署时显示）

**向量化配置**（调用 `embeddingService`）：
- 启用开关、Embedding 地址、Key、模型名
- 「测试连接」+ 「重建索引」按钮

**入口函数**：`showConfigModal()` / `closeConfigModal()` / `saveConfigAndClose()`

---

## 模块依赖关系

```
【底层，无依赖】
idb-storage.js / idb-snapshot.js
token-utils.js
template-engine.js
variable-system.js
markdown-it.min.js

【数据层】
api-service.js
embedding-service.js
storage-service.js  ←─── idb-storage.js
game-config.js
item-list.js / skill-list.js
prompt-data-core.js / prompt-data-npc.js / prompt-data-actions.js / prompt-data-extra.js  （自动生成）

【工具层】
game-utils.js       ←─── game-config.js
sync-utils.js       ←─── variable-system.js, game-state.js

【状态层】
game-state.js       ←─── game-config.js, item-list.js, skill-list.js

【服务层】
summary-history-service.js  ←─── storage-service.js
week-history-service.js     ←─── storage-service.js
memory-recall.js            ←─── embedding-service.js, storage-service.js
summary-runner.js           ←─── storage-service.js, week-history-service.js, api-service.js
bgm-manager.js
button-sfx.js

【渲染/交互层】
game-ui.js          ←─── game-state.js, game-utils.js
game-helpers.js     ←─── game-ui.js, game-state.js, game-config.js
game-events.js      ←─── game-helpers.js, game-state.js
game-skills.js      ←─── game-state.js, skill-list.js
special-event.js    ←─── game-state.js

【Prompt 组装层】
worldbook-engine.js     ←─── prompt-data-npc.js, prompt-data-actions.js
prompt-builder.js       ←─── template-engine.js, worldbook-engine.js, token-utils.js,
                               summary-history-service.js, week-history-service.js,
                               memory-recall.js, api-service.js, prompt-data-*.js
response-parser.js      （纯函数，无依赖）

【流水线层（独立前端核心）】
pipeline.js         ←─── api-service.js, prompt-builder.js, response-parser.js,
                           variable-system.js, sync-utils.js, summary-history-service.js,
                           week-history-service.js, summary-runner.js, storage-service.js,
                           game-state.js, game-events.js, game-ui.js

【UI 弹窗（独立加载）】
ui/config-modal.js  ←─── api-service.js, embedding-service.js

【独立模块（IIFE，无外部依赖）】
st-converter.js
```

---

## 开发说明

### 新功能开发
- 静态配置数据 → `game-config.js`
- 工具/计算函数 → `game-utils.js`
- 新的状态字段 → `game-state.js`，同时更新 `defaultGameData`
- UI 展示 → `game-ui.js`
- 游戏逻辑 → `game-helpers.js` 或 `game-events.js`
- 技能定义 → `skill-list.js`；技能逻辑 → `game-skills.js`
- 新道具 → `item-list.js`
- 特殊剧情事件 → 先在同目录 `special-event-draft.js` 中草稿，完成后迁移到 `special-event.js`
- onclick 调用的函数必须在 `index.html` 中定义或暴露到 `window` 对象

### 数值安全
- 修改数值后调用 `checkAllValueRanges()` 确保合法
- 保存游戏状态用 `saveGameData()`（ST 版）或 `storageService.autoSave()`（独立前端）
- 技能装备前检查 `getMemoryPointsUsed() + cost <= getMemoryPointsMax()`

### ST 版 vs 独立前端差异
| 功能 | ST 版 | 独立前端 |
|------|-------|---------|
| 存档 | ST 变量 | `localStorage` + `storageService` |
| LLM 调用 | ST 内置 | `api-service.js` |
| 向量化召回 | ❌ | ✅ `embedding-service.js` |
| 流式渲染 | ✅ 小白X | ✅ 内置流式 |
| 自动存档 | ❌ | ✅ 每次回复后触发 |
| 开局界面 | `start-screen.html` | `start-screen-noST.html` |
