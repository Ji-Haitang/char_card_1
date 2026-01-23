# 姬侠传 / 类脑群侠传 - 游戏模块说明文档

## 项目概述
姬侠传（又名类脑群侠传）是一个基于网页的武侠角色扮演游戏，支持在SillyTavern等AI对话环境中运行。游戏采用模块化架构，将配置、状态管理、UI更新、游戏逻辑等功能分离到不同的文件中，便于维护和扩展。

## 文件结构

```
├── img/                      # 图片资源（场景、NPC立绘、战斗差分等）
│   ├── location/             # 地点场景图
│   ├── NPC/                  # NPC头像和立绘
│   └── 战斗差分/              # 战斗相关图片
│ 
├── assets/                   # 小游戏资源（农场等）
│   └── image/                # 图片素材
│
├── char_card_information/    # 角色卡设定文本信息
│   
├── module/
│   ├── game-config.js        # 游戏配置文件
│   ├── game-utils.js         # 工具函数库（含模糊匹配系统）
│   ├── game-state.js         # 游戏状态管理
│   ├── game-ui.js            # UI更新和显示函数（含SLG三层图渲染）
│   ├── game-helpers.js       # 辅助函数库
│   ├── game-events.js        # 事件处理函数
│   ├── special-event.js      # 特殊剧情事件系统
│   ├── special-event-draft.js # 剧情事件草稿
│   ├── game-styles.css       # 游戏样式文件
│   └── game-styles-theme.css # 主题样式文件
│
├── index.html                # 主HTML文件（本地开发版本）
├── index - SR.html           # 主HTML文件-流式版本（SillyTavern使用）
├── start-screen.html         # 开局界面（角色创建）
├── blackjack.html            # 21点赌场游戏
├── turn-based-battle.html    # 回合制战斗系统
├── farm.html                 # 农场种植系统
├── alchemy.html              # 炼丹系统
└── world_map.html            # 世界地图探索
```

## 各模块详细说明

### 1. game-config.js - 游戏配置文件
**功能概述**：包含游戏的所有静态配置数据，是最底层的配置文件，无任何依赖。

**主要内容**：
- `valueRanges` - 各项数值的最小值和最大值范围定义
- `locationNames` / `seasonNameMap` - 地点和季节的中文名称映射
- `npcs` - NPC基本信息（名字、描述、头像ID）
- `npcNameToId` - NPC名字到ID的映射表
- `npcPortraits` - NPC立绘图片URL映射
- `locationBackgrounds` - 地点背景图URL映射
- `actionConfigs` - 各种行动的配置（天赋加成、影响属性）
- `npcLocationProbability` - NPC在各地点出现的概率配置
- `npcSparRewards` - NPC切磋奖励配置
- `item_list` - 道具列表配置（武器、防具、饰品、食物、材料等）
- `defaultGameData` - 游戏初始数据
- `slgEmotionOptions` / `slgCGOptions` - SLG模式表情和CG选项
- `emotionSynonyms` / `sceneSynonyms` / `npcSynonyms` / `cgSynonyms` - 模糊匹配同义词

### 2. game-utils.js - 工具函数库
**功能概述**：提供游戏中常用的工具函数，包括渲染环境检测、数值计算、范围限制、模糊匹配等。

**主要函数**：
- `isInRenderEnvironment()` - 检测是否在渲染环境中（如SillyTavern）
- `getRenderFunction()` - 获取可用的渲染函数（STscript或triggerSlash）
- `getCurrentRenderer()` - 获取当前渲染器类型（xiaobaiX或otherRenderer）
- `clampValue(value, min, max)` - 将数值限制在指定范围内
- `checkAllValueRanges()` - 检查并修正所有游戏数值
- `calculateLevelFromWuxue(wuxue)` - 根据武学值计算可获得的等级点数
- `calculateWuxueForLevel(level)` - 计算达到某等级需要的武学值
- `calculateRemainingPoints()` - 计算剩余可分配的属性点（考虑装备影响）
- `levenshteinDistance(a, b)` - 计算编辑距离
- `stringSimilarity(a, b)` - 计算字符串相似度
- `fuzzyMatch(input, options, synonyms, threshold)` - 通用模糊匹配
- `matchScene()` / `matchEmotion()` / `matchNPC()` / `matchCG()` - 专用模糊匹配函数

### 3. game-state.js - 游戏状态管理
**功能概述**：管理游戏的所有运行时状态，提供状态的读取、保存和同步功能。

**主要变量**：
- `gameData` - 完整的游戏数据对象
- `userLocation` / `userLocation_old` - 用户当前/上一位置
- `playerTalents` - 玩家天赋属性（根骨、悟性、心性、魅力）
- `playerStats` - 玩家数值（武学、学识、声望、金钱）
- `combatStats` - 战斗数值（攻击力、生命值）
- `playerMood` - 玩家体力值
- `inventory` / `equipment` - 背包物品和装备栏
- `npcFavorability` / `npcVisibility` / `npcGiftGiven` / `npcSparred` - NPC状态
- `GameMode` - 游戏模式（0=普通，1=SLG）
- `difficulty` - 难度设置
- `dayNightStatus` / `seasonStatus` - 昼夜和季节状态
- `summary_Small` / `summary_Week` / `summary_Backup` - 剧情总结
- `newWeek` / `randomEvent` / `battleEvent` - 事件标记
- `companionNPC` / `mapLocation` - 下山随行与目的地
- `cgContentEnabled` / `compressSummary` - 功能开关
- `alchemyDone` - 本周是否已炼丹
- `triggeredEvents` / `currentSpecialEvent` - 特殊事件触发状态
- `inputEnable` - 自由行动输入框可用状态
- `localState` - 流式版本本地状态

**主要函数**：
- `loadOrInitGameData()` - 加载或初始化游戏数据
- `saveGameData()` - 保存游戏数据到SillyTavern变量
- `syncVariablesFromGameData()` - 从gameData同步到独立变量
- `syncGameDataFromVariables()` - 从独立变量同步到gameData
- `mergeWithDefaults()` - 深度合并数据，支持版本更新
- `saveLastUserMessage()` / `saveNewWeek()` - 局部字段快速保存
- `resetLocalState()` / `getLocalState()` - 流式状态管理

### 4. game-ui.js - UI更新和显示函数
**功能概述**：负责所有用户界面的更新和显示逻辑，管理各种弹窗和界面元素，包含SLG模式的三层图渲染。

**主要函数**：

**SLG模式解析**：
- `parseSlgMainText(mainText)` - 解析SLG模式主文本为分页数据（支持流式）

**基础UI更新**：
- `updateDateDisplay()` - 更新日期显示
- `updateMoodDisplay()` - 更新体力值显示
- `updateActionPointsDisplay()` - 更新行动点显示
- `updateAllDisplays()` - 一次性更新所有显示
- `updateStatsDisplay()` - 更新角色属性面板
- `updateRelationshipsDisplay()` - 更新人际关系界面

**文本和分页**：
- `updateStoryText(text)` - 使用Markdown渲染并更新故事文本
- `updateStoryDisplay()` - 更新故事显示（分页/展开、页码指示、SLG三层图）
- `doGoToPage()` / `doPrevPage()` / `doNextPage()` - 翻页功能
- `doToggleStoryExpand()` - 展开/收起全文

**弹窗管理**：
- `showModal(text)` - 显示普通弹窗
- `showConfirmModal(title, message, onConfirm)` - 显示确认弹窗
- `fitModalToViewport(modal)` - 调整弹窗位置以适应视窗
- `bindModalAutoFit(modal)` - 绑定弹窗自动调整
- `closeAllSpecialModals()` - 关闭所有特殊弹窗

**道具和装备界面**：
- `updateEquipmentSlot()` - 更新装备槽显示
- `showItemDetail()` - 显示道具详情
- `getItemEffectText()` - 获取道具效果文本
- `closeItemDetailModal()` - 关闭道具详情弹窗

### 5. game-helpers.js - 辅助函数库
**功能概述**：提供游戏逻辑的辅助功能，连接各个系统。

**主要函数**：

**消息和游戏管理**：
- `handleMessageOutput(message)` - 智能处理消息输出（自动判断环境）
- `showBlackjackGame()` - 显示21点赌场游戏
- `showBattleGame(battleData)` - 显示回合制战斗游戏
- `showFarmGame()` - 显示农场游戏
- `showAlchemyGame()` - 显示炼丹游戏

**NPC管理**：
- `showInteractionInput(npcId, location)` - 显示NPC互动输入框
- `getNpcsAtLocation(location)` - 获取指定地点的NPC列表
- `getRandomLocation(npcId)` - 根据概率获取NPC的随机位置
- `displayNpcs(location)` - 在指定地点显示NPC立绘
- `isClickOnOpaquePixel(event, img)` - 检测点击是否在图片不透明区域
- `showNpcInfo(npcId, location, event)` - 显示NPC信息弹窗（简版）
- `showNpcSelectionOverlay(npcId, location, event)` - 显示NPC选择遮罩（全屏交互）
- `closeNpcSelectionOverlay()` - 关闭NPC选择遮罩
- `showNpcInfoPopup(npcId, location, event)` - 显示NPC信息弹窗（详细版）

**场景和地点**：
- `switchScene(sceneName)` - 切换到指定场景
- `showLocationInfo(locationId, event)` - 显示地点信息弹窗
- `setupLocationEvents()` - 初始化地点的鼠标/触摸事件
- `updateLocationHeadcountLabels()` - 更新地点NPC人数标签
- `calculateSeason(week)` - 根据周数计算当前季节
- `updateSceneBackgrounds()` - 根据季节和昼夜更新场景背景

**道具操作**：
- `useItem(itemName)` - 使用道具
- `equipItem(itemName)` - 装备道具
- `unequipItem(itemName)` - 卸下装备

### 6. game-events.js - 事件处理函数
**功能概述**：处理游戏中的各种事件，包括随机事件、战斗事件、LLM响应解析等。

**主要函数**：
- `displayRandomEvent(event)` - 显示随机事件界面
- `displayBattleEvent(event)` - 显示战斗事件界面
- `parseLLMResponse(response, mainTextContent)` - 解析LLM返回的JSON响应
- `setupMessageListeners()` - 设置iframe消息监听器（21点/战斗/农场/炼丹/世界地图）
- `applyBattleReward(reward)` - 应用战斗胜利奖励
- `handleEventOption()` - 处理事件选项选择（支持"特殊剧情:"前缀触发特殊事件）
- `applyEventReward()` - 应用事件奖励

**特殊功能**：
- 支持SLG模式的特殊文本解析
- 支持NPC好感度变化（含魅力判定和难度调整）
- 支持NPC位置变动
- 处理iframe游戏（21点、战斗、农场、炼丹）的结果
- 与special-event.js联动，支持特殊剧情事件链

### 7. special-event.js - 特殊事件系统
**功能概述**：管理特殊剧情事件，支持事件链触发、条件检查和效果应用。

**主要函数**：
- `checkSpecialEvents()` - 检查是否有符合条件的特殊事件（按优先级排序）
- `triggerSpecialEvent(event, options)` - 触发指定的特殊事件
- `getTriggeredEvents()` - 获取已触发的事件ID列表
- `resetEventTrigger(eventId)` - 重置指定事件的触发状态

**内部函数**：
- `getValueByPath(path)` - 根据路径获取变量值（支持嵌套如"npcFavorability.C"）
- `setValueByPath(path, newValue)` - 根据路径设置变量值
- `checkCondition(value, condition, path)` - 检查单个条件是否满足
- `checkEventConditions(event)` - 检查事件的所有条件
- `applyEventEffects(event)` - 应用事件效果（支持set/add/push操作）
- `markEventTriggered(eventId)` - 标记事件已触发

**事件数据结构**：
- `id` - 唯一标识符（用于防重复和事件链）
- `name` - 事件名称（调试用）
- `priority` - 优先级（数字越大越优先）
- `conditions` - 触发条件对象（支持min/max/equals/in检查）
- `effects` - 效果对象（支持set/add/push操作）
- `text` - 预设文本（SLG_MODE格式）

### 8. index.html - 主HTML文件
**功能概述**：游戏的主入口文件（本地开发版本），包含HTML结构和用户交互函数。

**保留的主要函数**（用于onclick调用）：

**界面切换**：
- `showPlayerStats()` - 显示角色属性界面
- `showRelationships()` - 显示人际关系界面
- `backToMap()` - 返回地图界面
- `goToLocation(locationId)` - 前往指定地点

**游戏操作**：
- `skipWeek()` - 跳过当前周
- `performAction(action, location)` - 执行地点行动
- `refreshNpcLocations()` - 刷新NPC位置
- `sendFreeAction()` - 发送自由行动

**NPC交互**：
- `sendInteraction()` - 发送NPC互动内容
- `npcAction(npcId, action)` - NPC动作处理
- `toggleNpcVisibility(npcId)` - 切换NPC可见性
- `giveGift(npcId)` - 送礼功能

**系统功能**：
- `toggleDropdown(dropdownId)` - 下拉菜单控制
- `saveGame()` / `loadGame()` - 存档/读档
- `showDifficultySettings()` - 难度设置
- `showCheatMode()` - 金手指功能

**背包和交易**：
- `showInventory()` / `showEquipment()` - 显示背包/装备
- `showTrading(type)` - 显示交易界面
- `buyItem()` / `sellItem()` - 买卖物品
- `showShopItemDetail()` - 显示商品详情

**战斗相关**：
- `startBattle()` / `fleeBattle()` - 开始/逃离战斗
- `addAttack()` / `addHP()` - 增加属性点

### 9. game-styles.css / game-styles-theme.css - 游戏样式文件
**功能概述**：包含游戏的所有CSS样式定义。

**game-styles.css 主要内容**：
- 响应式布局设计（支持PC、平板、手机）
- 场景和地图样式
- NPC立绘和地点按钮样式
- 弹窗和提示框样式（背包、装备、交易、难度等）
- 动画效果定义
- SLG模式特殊样式（三层图渲染）
- 移动端触摸优化

**game-styles-theme.css 主要内容**：
- 主题相关的颜色变量
- 可切换的UI风格（古风/扁平化）

### 10. 小游戏HTML文件

**blackjack.html - 21点赌场游戏**
- 独立的21点扑克牌游戏
- 通过postMessage与主游戏通信
- 支持金钱的赢取和损失

**turn-based-battle.html - 回合制战斗系统**
- 7种战斗指令：攻击、重击、防御、闪避、蓄力、反击、道具
- 4种敌人AI风格：风、火、林、山
- 支持战斗道具和装备效果
- 背景图动态加载

**farm.html - 农场种植系统**
- 4x3格子的种植田地
- 播种、浇水、收获流程
- 作物生长周期管理
- 通过postMessage返回收益

**alchemy.html - 炼丹系统**
- 控温炼丹小游戏
- 温度控制和时间管理
- 成功/失败结果判定
- 每周限制使用一次

**world_map.html - 世界地图探索**
- 西域各地点的可视化地图
- 地点选择和危险度显示
- 支持随行NPC选择
- 探索结果通过postMessage返回

**start-screen.html - 开局界面**
- 角色创建和天赋分配
- 出身背景选择
- NPC登场勾选
- 游戏初始化设置

## 特殊说明

### 流式版本（index - SR.html）
- 支持流式更新，适用于SillyTavern环境的实时渲染
- CSS从CDN加载而非本地文件
- 包含流式状态管理(localState)
- 所有函数包裹在 `DOMContentLoaded` 事件中
- 需要手动将函数暴露到 window 对象

### 依赖关系
1. 外部依赖：markdown-it（用于文本渲染）
2. 加载顺序：config → utils → state → ui → helpers → events → special-event

### 开发建议
- 新功能应该根据类型添加到对应的模块中
- onclick调用的函数必须在index.html中定义或暴露到全局
- 使用 `checkAllValueRanges()` 确保数值合法
- 使用 `saveGameData()` 保存游戏进度
- 新增特殊剧情事件可先在 special-event-draft.js 中编写，完成后迁移到 special-event.js