# 类脑群侠传 - 游戏模块说明文档

## 项目概述
类脑群侠传是一个基于网页的武侠角色扮演游戏，支持在SillyTavern等AI对话环境中运行。游戏采用模块化架构，将配置、状态管理、UI更新、游戏逻辑等功能分离到不同的文件中，便于维护和扩展。

## 文件结构

```
├── img/                      # 图片资源
│ 
├── char_card_information/    # 设定相关的文本信息
│   
├── module/
│   ├── game-config.js        # 游戏配置文件
│   ├── game-utils.js         # 工具函数库
│   ├── game-state.js         # 游戏状态管理
│   ├── game-ui.js            # UI更新和显示函数
│   ├── game-helpers.js       # 辅助函数库
│   └── game-events.js        # 事件处理函数
│   └── game-styles.css       # 游戏样式文件 
└── index.html                # 主HTML文件（包含内联函数）
└── index - SR.html           # 主HTML文件-流式版本（包含内联函数）
└── blackjack.html            # 21点网页游戏的HTML文件
└── turn-based-battle.html    # 回合制战斗系统的HTML文件
```

## 各模块详细说明
### 1. game-config.js - 游戏配置文件
功能概述：包含游戏的所有静态配置数据，是最底层的配置文件，无任何依赖。
主要内容：
valueRanges - 各项数值的最小值和最大值范围定义
locationNames - 地点ID到中文名称的映射
npcs - NPC基本信息（名字、描述、头像ID）
npcNameToId - NPC名字到ID的映射表
npcPortraits - NPC立绘图片URL映射
locationBackgrounds - 地点背景图URL映射
actionConfigs - 各种行动的配置（天赋加成、影响属性）
npcLocationProbability - NPC在各地点出现的概率配置
defaultGameData - 游戏初始数据

### 2. game-utils.js - 工具函数库
功能概述：提供游戏中常用的工具函数，包括渲染环境检测、数值计算、范围限制等。
主要函数：
isInRenderEnvironment() - 检测是否在渲染环境中（如SillyTavern）
getRenderFunction() - 获取可用的渲染函数（STscript或triggerSlash）
getCurrentRenderer() - 获取当前渲染器类型
clampValue(value, min, max) - 将数值限制在指定范围内
checkAllValueRanges() - 检查并修正所有游戏数值
calculateLevelFromWuxue(wuxue) - 根据武学值计算可获得的等级点数
calculateWuxueForLevel(level) - 计算达到某等级需要的武学值
calculateRemainingPoints() - 计算剩余可分配的属性点
依赖关系：
依赖 game-config.js 中的 valueRanges
依赖全局状态变量

### 3. game-state.js - 游戏状态管理
功能概述：管理游戏的所有运行时状态，提供状态的读取、保存和同步功能。
主要变量：
gameData - 完整的游戏数据对象
userLocation - 用户当前位置
playerTalents - 玩家天赋属性
playerStats - 玩家数值
combatStats - 战斗数值
playerMood - 玩家心情值
martialArts - 已学武功列表
npcFavorability - NPC好感度
actionPoints - 当前行动点
currentWeek - 当前周数
currentNpcLocations - NPC当前位置
各种临时状态变量
主要函数：
loadOrInitGameData() - 加载或初始化游戏数据
saveGameData() - 保存游戏数据到SillyTavern变量
syncVariablesFromGameData() - 从gameData同步到独立变量
syncGameDataFromVariables() - 从独立变量同步到gameData
依赖关系：
依赖 game-config.js 中的 defaultGameData
依赖 game-utils.js 中的渲染环境检测函数

### 4. game-ui.js - UI更新和显示函数
功能概述：负责所有用户界面的更新和显示逻辑，处理弹窗显示、文本渲染和动态内容更新。
主要函数：
updateDateDisplay() - 更新日期显示（年/月/周）
updateMoodDisplay() - 更新心情值显示
updateActionPointsDisplay() - 更新行动点显示并控制按钮状态
updateAllDisplays() - 一次性更新所有显示内容
updateStatsDisplay() - 更新角色属性面板
updateRelationshipsDisplay() - 更新人际关系界面
updateStoryText(text) - 使用Markdown渲染并更新故事文本
showModal(text) - 显示普通弹窗
showConfirmModal(title, message, onConfirm) - 显示确认弹窗
showTooltip(event, text) - 显示悬浮提示框
hideTooltip() - 隐藏悬浮提示框
依赖关系：
依赖 game-state.js 中的状态变量
依赖 game-config.js 中的配置数据
依赖 game-utils.js 中的计算函数
依赖外部库 markdown-it 进行文本渲染

### 5. game-helpers.js - 辅助函数库
功能概述：提供游戏逻辑的辅助功能，连接各个系统，提供中间层的功能支持。
主要函数：
handleMessageOutput(message) - 智能处理消息输出
showBlackjackGame() - 显示21点赌场游戏
showBattleGame(battleData) - 显示回合制战斗游戏
showInteractionInput(npcId, location) - 显示NPC互动输入框
getNpcsAtLocation(location) - 获取指定地点的NPC列表
getRandomLocation(npcId) - 根据概率获取NPC的随机位置
displayNpcs(location) - 在指定地点显示NPC立绘
showNpcInfo(npcId, location, event) - 显示NPC信息弹窗
switchScene(sceneName) - 切换到指定场景
showLocationInfo(locationId, event) - 显示地点信息弹窗
setupLocationEvents() - 初始化地点的鼠标/触摸事件
依赖关系：
依赖所有其他模块

### 6. game-events.js - 事件处理函数
功能概述：处理游戏中的各种事件，包括随机事件、战斗事件、LLM响应解析等。
主要函数：
displayRandomEvent(event) - 显示随机事件界面
hideRandomEvent() - 隐藏随机事件界面
displayBattleEvent(event) - 显示战斗事件界面
hideBattleEvent() - 隐藏战斗事件界面
parseLLMResponse(response, mainTextContent) - 解析LLM返回的JSON响应
setupMessageListeners() - 设置iframe消息监听器
applyBattleReward(reward) - 应用战斗胜利奖励
内部函数：
handleEventOption(optionIndex, option) - 处理事件选项选择
applyEventReward(reward) - 应用事件奖励
特殊说明：
parseLLMResponse 是与AI系统对接的核心函数
支持处理NPC好感度变化（含魅力判定）
支持处理NPC位置变动
支持两种类型的随机事件：选项事件和战斗事件
依赖关系：
依赖所有其他模块

### 7. game-styles.css - 游戏样式文件
功能概述：包含游戏的所有CSS样式定义，负责界面的视觉呈现。
主要内容：
响应式布局设计
场景样式定义
NPC立绘和地点按钮样式
弹窗和提示框样式
动画效果定义
移动端适配样式

### 8. index.html - 主HTML文件
功能概述：游戏的主入口文件，包含HTML结构和必要的内联函数。
保留的内联函数（用于onclick调用）：
showPlayerStats() - 显示角色属性界面
showRelationships() - 显示人际关系界面
skipWeek() - 跳过当前周
performAction(action, location) - 执行地点行动
refreshNpcLocations() - 刷新NPC位置
backToMap() - 返回地图界面
closeModal() - 关闭模态弹窗
sendInteraction() - 发送NPC互动内容
addAttack() - 增加攻击力
addHP() - 增加生命值
npcAction(npcId, action) - 处理NPC动作
goToLocation(locationId) - 前往指定地点
sendFreeAction() - 发送自由行动
startBattle() - 开始战斗事件
fleeBattle() - 放弃战斗

### 加载顺序
由于采用传统全局变量方案，文件加载顺序很重要：
game-config.js（基础配置）
game-utils.js（工具函数）
game-state.js（状态管理）
game-ui.js（UI函数）
game-helpers.js（辅助函数）
game-events.js（事件处理）

### 兼容性说明
支持小白X的STscript函数
支持酒馆助手的triggerSlash函数
支持普通浏览器环境（功能受限）

### 注意事项
所有需要在onclick中调用的函数都保留在HTML中
其他辅助函数和配置分离到独立模块
使用传统的script标签加载，确保全局作用域可访问
模板变量\$1和\$2保留在HTML中供AI系统替换

### 开发指南
添加新功能
确定功能所属模块
在对应模块中添加函数
如果需要onclick调用，在HTML中添加包装函数
更新相关依赖

### 调试建议
使用浏览器控制台查看错误信息
检查函数是否在正确的作用域
确认文件加载顺序是否正确
使用console.log追踪数据流

### 性能优化
避免频繁的DOM操作
使用事件委托处理动态元素
合理使用缓存机制
注意内存泄漏（特别是事件监听器）