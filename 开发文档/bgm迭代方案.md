# BGM 功能迭代方案

## 一、需求摘要

为 `index.html` 独立前端游戏增加背景音乐（BGM）系统。  
不影响 `index - SR.html` 链路（SR 模式下不启用 BGM）。

---

## 〇、SR 链路隔离分析（重要前提）

### 0.1 两条链路的模块加载方式

| 链路 | 模块加载方式 | 来源 |
|------|------------|------|
| `index.html`（独立前端） | `<script src="module/xxx.js">` | 本地相对路径 |
| `index - SR.html`（SillyTavern） | `<script src="https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@{commitHash}/module/xxx.js">` | **固定 CDN 版本** |

`index - SR.html` 第 857–866 行引入模块的实际路径如下（截取）：

```
@5b01b14/module/game-config.js
@5b01b14/module/game-events.js
@b261f34/module/game-helpers.js
```

每个模块对应的都是特定 commit hash 的快照，**与本地工作目录的文件完全无关**。

### 0.2 第一道隔离：CDN 版本锁定

> **结论**：对本地 `module/game-config.js`、`module/game-events.js`、`module/game-helpers.js` 的任何改动，**在物理上不会传播到 `index - SR.html`**，因为后者从 CDN 固定快照加载，不读取本地文件。

### 0.3 第二道隔离：运行时 typeof 守卫

尽管有第一道隔离，为保证代码健壮性（防止未来 SR 链路升级到新 CDN 版本时出现副作用），所有在共享模块中插入的 BGM 调用都必须加 `typeof bgmManager !== 'undefined'` 守卫：

- `bgm-manager.js` **只在 `index.html` 中通过 `<script src>` 引入**，SR 链路永远不会加载它。
- 因此，在 SR 环境中 `window.bgmManager` 必然是 `undefined`，守卫判断直接跳过，零副作用。

### 0.4 第三道隔离：isInRenderEnvironment() 守卫

`index.html` 已有函数 `isInRenderEnvironment()` 用于区分 ST 模式与独立模式。在 `index.html` 内部的所有 BGM 初始化/恢复调用，额外加上 `!isInRenderEnvironment()` 判断，从语义上明确声明"BGM 仅在独立前端模式下工作"。

---

## 二、整体架构设计

### 2.1 核心思路

- 新增独立模块 `module/bgm-manager.js`，封装所有 BGM 控制逻辑。
- 在 `index.html` 中挂载一个全局 `<audio>` 标签，由 bgm-manager 持有引用。
- BGM 状态由 `gameData.bgmName`（文件路径）持久化，参与存读档、导入导出流程。
- BGM 切换逻辑由两处触发：
  1. 每轮 LLM 回复结束后（`parseLLMResponse` 解析到 `剧情基调`）。
  2. 战斗 iframe 开启/关闭时（`showBattleGame` / `battle-exit` 事件）。

### 2.2 BGM 模式分类

| 模式 | 触发条件 | 音频目录 | 切换判断依据 |
|------|---------|----------|------------|
| **情绪BGM** | 基调归类 ∈ {紧张/激昂/欢快/悲伤/暧昧}，且置信度 > 0.75 | `bgm/{基调归类}/` | 基调归类变化时才换曲 |
| **平淡BGM** | 基调归类 = 平淡，或置信度 ≤ 0.75，或字段缺失，或归类越界 | `bgm/平淡/{mapLocation}/` | mapLocation 变化时才换曲，兜底为天山派 |
| **战斗BGM** | 任意入口打开 `turn-based-battle-new.html` iframe 时 | `bgm/战斗/` | 每次战斗开始随机换一首（不更新 bgmName） |

---

## 三、BGM 文件清单（硬编码到 game-config.js）

> 因浏览器 `file://` 协议无法枚举目录，需将文件路径显式列举在配置中。

### 3.1 情绪BGM文件

```javascript
const bgmFileManifest = {
    紧张: [
        'bgm/紧张/晚鐘聲 千燈行 (活俠傳遊戲配樂).mp3'
    ],
    激昂: [
        'bgm/激昂/OPUS龍脈常歌原聲帶15. Our Name Was Known Across the ....mp3',
        'bgm/激昂/唐門薪火 自古如今 (活俠傳遊戲配樂).mp3',
        'bgm/激昂/歷劫知俠氣 (活俠傳遊戲配樂).mp3'
    ],
    欢快: [
        'bgm/欢快/得意須盡歡 (活俠傳遊戲配樂).mp3',
        'bgm/欢快/每天都歡似過年 (活俠傳遊戲配樂).mp3'
    ],
    悲伤: [
        'bgm/悲伤/OPUS龍脈常歌原聲帶14. If Its With You, Then I Would ....mp3',
        'bgm/悲伤/子夜寄君書 (Zi Ye Ji Jun Shu).mp3',
        'bgm/悲伤/謝幕時分 雨花零落 (活俠傳遊戲配樂).mp3'
    ],
    暧昧: [
        'bgm/暧昧/帳中夢守人 (活俠傳遊戲配樂).mp3',
        'bgm/暧昧/爱意 (金风玉露变奏).mp3',
        'bgm/暧昧/餘生可慶 (活俠傳遊戲配樂).mp3'
    ],
    战斗: [
        'bgm/战斗/千里不留行 (活俠傳遊戲配樂).mp3',
        'bgm/战斗/君所願兮江湖行 最是輕狂不願醒 (活俠傳遊戲配樂).mp3',
        'bgm/战斗/吾往矣 (活俠傳遊戲配樂).mp3',
        'bgm/战斗/最崎嶇的路 (活俠傳遊戲配樂).mp3'
    ]
};
```

### 3.2 平淡BGM文件（按地图位置）

```javascript
const bgmPingdanManifest = {
    '天山派':    ['bgm/平淡/天山派/青山新歌謠 (活俠傳遊戲配樂).mp3'],
    '伊州':      ['bgm/平淡/伊州/鼎沸煙火氣 (活俠傳遊戲配樂).mp3'],
    '千佛洞':    ['bgm/平淡/千佛洞/彿門清淨.mp3'],
    '博斯坦村':  ['bgm/平淡/博斯坦村/山中好歲月 (活俠傳遊戲配樂).mp3'],
    '博格达峰':  ['bgm/平淡/博格达峰/山野煮雨 - 小野.mp3'],
    '哈密绿洲':  ['bgm/平淡/哈密绿洲/西域橙光音乐 ...mp3'],  // 注：文件名含特殊字符，下方实现时取精确路径
    '大沙海':    ['bgm/平淡/大沙海/Dannagh Desert - Xenoblade Chronicles 3 OST.mp3'],
    '天山派外堡':['bgm/平淡/天山派外堡/猜猜無猜心 (活俠傳遊戲配樂).mp3'],
    '崆峒派':    ['bgm/平淡/崆峒派/錦繡織歲玄燭照心 (活俠傳遊戲配樂).mp3'],
    '拜火教总坛':['bgm/平淡/拜火教总坛/鬼門開 (活俠傳遊戲配樂).mp3'],
    '昆仑派':    ['bgm/平淡/昆仑派/雨後松林香 (活俠傳遊戲配樂).mp3'],
    '月牙泉':    ['bgm/平淡/月牙泉/Lcz-Sv《镜湖》【Hi-Res】.mp3'],
    '沙州':      ['bgm/平淡/沙州/仙境傳說RO音樂BGM 79 龍之城 洛陽 雄偉 The Great...mp3'],
    '瓜州':      ['bgm/平淡/瓜州/仙劍奇俠傳三樂曲玄色風重樓主題.mp3'],
    '白驼山':    ['bgm/平淡/白驼山/燕雲十六聲 4K MV26 玉門關 (河西) [WhereWinds...].mp3'],
    '迪坎儿村':  ['bgm/平淡/迪坎儿村/OPUS龍脈常歌原聲帶5. Veteran\'s Abode Guifan...mp3'],
    '高昌':      ['bgm/平淡/高昌/柔兹兰站在河岸上 (feat. 鲍捷).mp3'],
    '龟兹':      ['bgm/平淡/龟兹/玉珠盘.mp3']
};
```

> **⚠️ 重要**：文件名含中文、空格、括号等特殊字符，`bgmFileManifest` 和 `bgmPingdanManifest` 中的路径必须与磁盘上的 **实际文件名完全一致**（可在实现时用 PowerShell 命令 `Get-ChildItem` 取精确名称后手动填入）。

### 3.3 新增到 game-config.js 的配置常量

```javascript
// 支持情绪BGM的基调名称（不含"平淡"，平淡走地点逻辑）
const bgmMoodOptions = ['紧张', '激昂', '欢快', '悲伤', '暧昧'];
```

### 3.4 defaultGameData 新增字段

```javascript
bgmName: '',      // 当前正在播放的BGM路径（战斗BGM期间不更新此字段）
bgmEnabled: true, // BGM是否开启（通过音乐设置弹窗控制）
bgmVolume: 0.5,   // BGM音量，范围 0.0~1.0（通过音乐设置弹窗控制）
```

---

## 四、新模块：module/bgm-manager.js

独立封装，挂载到全局 `window.bgmManager`。

### 4.1 内部状态

```javascript
var _audio          = null;   // Audio 对象引用（index.html 初始化时注入）
var _currentPath    = '';     // 当前正在播放的文件路径
var _preBattlePath  = '';     // 战斗前暂存的 bgmName，用于退出战斗后恢复
var _enabled        = true;   // 是否启用（由 gameData.bgmEnabled 初始化及同步）
var _volume         = 0.5;    // 音量（由 gameData.bgmVolume 初始化及同步）
var _activeMood     = null;   // 上次情绪BGM的基调，用于防重复触发
var _activeLocation = null;   // 上次平淡BGM的地点，用于防重复触发
```

### 4.2 对外接口

| 方法 | 说明 |
|------|------|
| `init(audioEl)` | 绑定 `<audio>` 元素，设置 loop=true；从 `gameData.bgmEnabled/bgmVolume` 读取初始值 |
| `play(path)` | 若未启用则跳过；若 path === _currentPath 则不操作（防重复）；否则更换 src、设置 volume 并从头播放 |
| `stop()` | 暂停并清空 src，重置 _currentPath |
| `resume(path)` | 强制从头播放指定 path（跳过防重复检查），用于读档/导入存档后恢复 bgmName 的播放 |
| `updateByTone(toneResult, mapLoc)` | 根据基调解析结果决策并调用 play（见下方逻辑） |
| `onBattleStart()` | 暂存 _currentPath 到 _preBattlePath；从 bgm/战斗/ 随机挑一首调用 play（绕过 _enabled 检查，战斗BGM始终播放；不更新 gameData.bgmName） |
| `onBattleEnd()` | 若 _enabled 则恢复 _preBattlePath 的播放；否则 stop()；清空 _preBattlePath |
| `setEnabled(bool)` | 设置启用状态，同步到 `gameData.bgmEnabled`；若禁用则 stop()，若启用且有 bgmName 则 resume(gameData.bgmName) |
| `setVolume(val)` | 设置音量（0.0~1.0），同步到 `_audio.volume` 和 `gameData.bgmVolume` |
| `getEnabled()` | 返回 _enabled |
| `getVolume()` | 返回 _volume |
| `getPlayingPath()` | 返回 _currentPath |

### 4.3 updateByTone 决策逻辑（伪代码）

```
function updateByTone(toneResult, mapLoc):
    // toneResult = { 基调归类, 置信度 }（可能为 null）
    
    VALID_MOODS = ['紧张', '激昂', '欢快', '悲伤', '暧昧']
    
    let mood = toneResult?.基调归类 ?? null
    let conf = parseFloat(toneResult?.置信度 ?? 0)
    
    if (VALID_MOODS.includes(mood) && conf > 0.75):
        // 情绪BGM模式
        if (mood === _activeMood):
            return   // 基调未变，不重新播放
        pick one random file from bgmFileManifest[mood]
        _activeMood = mood
        _activeLocation = null
        play(pickedFile)
        gameData.bgmName = pickedFile
    else:
        // 平淡BGM模式
        let loc = mapLoc || gameData.mapLocation || '天山派'
        let normalizedLoc = bgmPingdanManifest[loc] ? loc : '天山派'   // 兜底
        if (normalizedLoc === _activeLocation && _activeMood === null):
            return   // 位置未变，不重新播放
        pick one random file from bgmPingdanManifest[normalizedLoc]
        _activeMood = null
        _activeLocation = normalizedLoc
        play(pickedFile)
        gameData.bgmName = pickedFile
```

> **注意**：`_activeMood` 和 `_activeLocation` 是 bgm-manager 的内部状态，记录"上次以什么状态选曲"，用于防止同条件重复触发。

---

## 四·五、音乐设置弹窗设计

### UI 位置

在 `index.html` 系统设置下拉菜单（`#system-dropdown`）中，在"难度设置"按钮之后新增一项：

```html
<button class="dropdown-item" onclick="showMusicSettings()">音乐设置</button>
```

### 弹窗内容

参考 `showFontSettings()` 的动态创建模式（按需创建、`document.body.appendChild`、`fitModalToViewport`），弹窗 id 为 `music-modal`，包含以下控件：

| 控件 | 类型 | 说明 |
|------|------|------|
| BGM 开关 | `<input type="checkbox" id="bgm-enable-toggle">` | 勾选=开启，取消=关闭；初始值从 `bgmManager.getEnabled()` 读取 |
| 音量滑块 | `<input type="range" id="bgm-volume-range" min="0" max="100" step="1">` | 0~100 整数显示，内部转换为 0.0~1.0；初始值从 `bgmManager.getVolume() * 100` 读取 |
| 音量数字显示 | `<span id="bgm-volume-display">` | 实时显示当前音量百分比，如"50%" |
| 关闭按钮 | `<button class="modal-btn cancel">` | 调用 `closeMusicModal()` |

弹窗 HTML 结构（动态生成）：

```html
<div id="music-modal" class="modal viewport-overlay">
  <div class="modal-content" style="max-width:400px;">
    <h3>音乐设置</h3>
    <div style="display:flex;align-items:center;gap:12px;margin:16px 0 8px;">
      <label for="bgm-enable-toggle" style="min-width:60px;">背景音乐</label>
      <input type="checkbox" id="bgm-enable-toggle" style="width:18px;height:18px;cursor:pointer;">
      <span id="bgm-enable-label">开启</span>
    </div>
    <div style="margin:16px 0 8px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
        <label>音量</label>
        <span id="bgm-volume-display">50%</span>
      </div>
      <input type="range" id="bgm-volume-range" min="0" max="100" step="1" value="50" style="width:100%;">
    </div>
    <div class="modal-buttons">
      <button class="modal-btn cancel" onclick="closeMusicModal()">关闭</button>
    </div>
  </div>
</div>
```

### 相关 JS 函数

```javascript
function showMusicSettings() {
    toggleDropdown('system-dropdown');
    let modal = document.getElementById('music-modal');
    if (!modal) {
        // 按需创建弹窗 DOM（同 showFontSettings 模式）
        modal = document.createElement('div');
        modal.id = 'music-modal';
        modal.className = 'modal viewport-overlay';
        modal.style.display = 'none';
        modal.innerHTML = /* 上方 HTML 字符串 */;
        document.body.appendChild(modal);
        // 注入 range 滑轨样式（复用 font-range-style，或单独注入 bgm-range-style）
        if (!document.getElementById('bgm-range-style')) {
            const style = document.createElement('style');
            style.id = 'bgm-range-style';
            // 同 font-range-style 内容，将选择器前缀改为 #music-modal
            document.head.appendChild(style);
        }
    }
    // 填充当前值
    var enabled = (typeof bgmManager !== 'undefined') ? bgmManager.getEnabled() : true;
    var vol     = (typeof bgmManager !== 'undefined') ? bgmManager.getVolume()  : 0.5;
    document.getElementById('bgm-enable-toggle').checked = enabled;
    document.getElementById('bgm-volume-range').value    = Math.round(vol * 100);
    _syncMusicModalLabels();
    modal.style.display = 'block';
    requestAnimationFrame(function() {
        if (typeof fitModalToViewport  === 'function') fitModalToViewport(modal);
        if (typeof bindModalAutoFit    === 'function') bindModalAutoFit(modal);
    });
    // 绑定事件（只绑定一次）
    var toggle = document.getElementById('bgm-enable-toggle');
    var slider = document.getElementById('bgm-volume-range');
    if (!toggle._bound) {
        toggle.addEventListener('change', _onBgmEnableChange);
        slider.addEventListener('input',  _onBgmVolumeChange);
        toggle._bound = true;
    }
}

function closeMusicModal() {
    var modal = document.getElementById('music-modal');
    if (modal) { modal.style.display = 'none'; modal._unbindFit && modal._unbindFit(); }
}

function _syncMusicModalLabels() {
    var enabled = document.getElementById('bgm-enable-toggle').checked;
    document.getElementById('bgm-enable-label').textContent  = enabled ? '开启' : '关闭';
    var vol = document.getElementById('bgm-volume-range').value;
    document.getElementById('bgm-volume-display').textContent = vol + '%';
    // 音量滑块在 BGM 关闭时置灰
    document.getElementById('bgm-volume-range').disabled = !enabled;
}

function _onBgmEnableChange(e) {
    if (typeof bgmManager !== 'undefined') bgmManager.setEnabled(e.target.checked);
    _syncMusicModalLabels();
}

function _onBgmVolumeChange(e) {
    var val = parseInt(e.target.value, 10) / 100;
    if (typeof bgmManager !== 'undefined') bgmManager.setVolume(val);
    _syncMusicModalLabels();
}
```

### bgmEnabled / bgmVolume 的存档行为

两个字段加入 `defaultGameData` 后，与 `bgmName` 一样自动参与所有存读档和导入导出流程。读档/导入存档时，改动点 5/6 会重新调用 `bgmManager.init()`，此时 `init()` 从已恢复的 `gameData.bgmEnabled/bgmVolume` 读取最新值，无需额外处理。

---

## 五、各文件改动清单

### 5.1 module/game-config.js

**SR 链路隔离说明**：SR 链路从 CDN `@5b01b14` 快照加载此文件，本地修改对其无影响（第一道隔离）。新增的常量是纯数据，无执行副作用；新增字段加入 `defaultGameData` 对 SR 也无害（SR 不使用独立前端的存档系统）。

**改动内容**：
1. 在文件末尾（其他 const 之后）新增：
   ```javascript
   const bgmMoodOptions = ['紧张', '激昂', '欢快', '悲伤', '暧昧'];
   const bgmFileManifest = { ... };   // 见第三章 3.1
   const bgmPingdanManifest = { ... }; // 见第三章 3.2
   ```
2. 在 `defaultGameData` 对象末尾追加：
   ```javascript
   bgmName: '',
   bgmEnabled: true,
   bgmVolume: 0.5,
   ```

**影响范围**：仅配置数据，无副作用。

---

### 5.2 module/bgm-manager.js（新建）

**SR 链路隔离说明**：此文件**不被 `index - SR.html` 引入**，SR 链路中 `window.bgmManager` 永远是 `undefined`（第一道 + 第二道隔离双重保障）。

完整实现 `bgmManager` 对象（见第四章），以 IIFE 形式暴露到 `window.bgmManager`。

文件末尾需检查所依赖的全局变量（`bgmFileManifest`、`bgmPingdanManifest`、`gameData`）是否存在，若不存在则降级为静默不报错。

---

### 5.3 module/game-events.js — parseLLMResponse

**SR 链路隔离说明**：SR 链路从 CDN `@5b01b14` 快照加载，本地改动无影响（第一道隔离）。即便未来 SR 升级到包含此改动的版本，`typeof bgmManager !== 'undefined'` 守卫（第二道隔离）也会令其静默跳过。

在 `parseLLMResponse` 函数内，**现有逻辑结束后**（所有 NPC/位置变更处理完毕，约 `updateStatsDisplay()` 调用之后），追加对 `剧情基调` 的处理：

```javascript
// === BGM 更新（仅独立前端有效，SR 链路因 bgmManager 未定义而自动跳过）===
if (typeof bgmManager !== 'undefined' && typeof bgmManager.updateByTone === 'function') {
    var _toneData = (response && response.剧情基调) ? response.剧情基调 : null;
    var _mapLoc = (typeof mapLocation !== 'undefined') ? mapLocation : (gameData ? gameData.mapLocation : '天山派');
    bgmManager.updateByTone(_toneData, _mapLoc);
}
```

**定位方法**：在 `parseLLMResponse` 尾部，找到 `updateStatsDisplay()` 或函数闭括号 `}` 前追加。

---

### 5.4 module/game-helpers.js — showBattleGame

**SR 链路隔离说明**：SR 链路从 CDN `@b261f34` 快照加载，本地改动无影响（第一道隔离）。`typeof bgmManager !== 'undefined'` 守卫兜底（第二道隔离）。

在 `showBattleGame` 函数体内，**`modal.style.display = 'block'` 之后**追加：

```javascript
// 战斗开始：停止当前BGM，播放战斗BGM（SR 链路因 bgmManager 未定义而自动跳过）
if (typeof bgmManager !== 'undefined' && typeof bgmManager.onBattleStart === 'function') {
    bgmManager.onBattleStart();
}
```

---

### 5.5 module/game-events.js — setupMessageListeners 中 battle-exit 处理

**SR 链路隔离说明**：同 5.3，CDN 快照锁定（第一道）+ `typeof` 守卫（第二道）。

在 `battle-exit` 分支的**最前面**（在任何 DOM 操作之前）追加：

```javascript
// 战斗结束：恢复战斗前的BGM（SR 链路因 bgmManager 未定义而自动跳过）
if (typeof bgmManager !== 'undefined' && typeof bgmManager.onBattleEnd === 'function') {
    bgmManager.onBattleEnd();
}
```

同时，`battle-modal` 背景点击强退的逻辑在 `index.html` 中，也需要在 `battle-iframe.src = ''` 前加同样的 `bgmManager.onBattleEnd()` 调用（见 5.6）。

---

### 5.6 index.html

**SR 链路隔离说明**：`index.html` 与 `index - SR.html` 是完全独立的 HTML 文件，所有改动只在 `index.html` 中进行，**零交叉**（第一道隔离）。所有 BGM 初始化/恢复调用额外加 `!isInRenderEnvironment()` 守卫（第三道隔离），语义上明确声明"BGM 仅在独立前端模式下工作"。

**改动点 1：引入 audio 标签**

在 `<body>` 内（建议放 `#main-viewport` 之外，页面顶部附近）：

```html
<!-- BGM 播放器 -->
<audio id="bgm-player" loop preload="auto" style="display:none;"></audio>
```

**改动点 2：引入 bgm-manager.js**

在引入其他 module/*.js 的 `<script>` 标签之后追加：

```html
<script src="module/bgm-manager.js"></script>
```

**改动点 3：window.onload 初始化 bgmManager**

在 `window.onload` 函数体内，`updateAllDisplays()` 等初始化调用之后，追加：

```javascript
// 初始化 BGM 管理器（从 gameData 读取 bgmEnabled/bgmVolume）
if (!isInRenderEnvironment() && typeof bgmManager !== 'undefined') {
    bgmManager.init(document.getElementById('bgm-player'));
    // 新游戏/刷新：若 bgmEnabled 且 bgmName 有值则恢复播放
    if (gameData.bgmName) {
        bgmManager.resume(gameData.bgmName);
    }
}
```

**改动点 4：battle-modal 背景点击强退**

在 `document.getElementById('battle-modal').addEventListener('click', ...)` 中，`battle-iframe.src = ''` 前加：

```javascript
if (typeof bgmManager !== 'undefined' && typeof bgmManager.onBattleEnd === 'function') {
    bgmManager.onBattleEnd();
}
```

**改动点 5：loadSaveSlot 读档后恢复 BGM**

在 `loadSaveSlot` 函数末尾 `showModal('存档加载成功！')` 之前，追加：

```javascript
// 读档后恢复 BGM（bgmEnabled/bgmVolume 已从 gameData 恢复，重新 init 同步状态）
if (!isInRenderEnvironment() && typeof bgmManager !== 'undefined') {
    bgmManager.init(document.getElementById('bgm-player'));
    if (gameData.bgmName) bgmManager.resume(gameData.bgmName);
    else bgmManager.stop();
}
```

**改动点 6：importSave JSON导入后恢复 BGM**

同样在 `importSave` 的 `showModal('存档导入成功！')` 之前，追加：

```javascript
// 导入存档后恢复 BGM
if (!isInRenderEnvironment() && typeof bgmManager !== 'undefined') {
    bgmManager.init(document.getElementById('bgm-player'));
    if (gameData.bgmName) bgmManager.resume(gameData.bgmName);
    else bgmManager.stop();
}
```

**改动点 7：系统设置下拉菜单新增"音乐设置"按钮**

在 `#system-dropdown` 内"难度设置"按钮之后追加：

```html
<button class="dropdown-item" onclick="showMusicSettings()">音乐设置</button>
```

**改动点 8：新增音乐设置相关 JS 函数**

在 `showFontSettings` 函数附近（同一区域）新增 `showMusicSettings`、`closeMusicModal`、`_syncMusicModalLabels`、`_onBgmEnableChange`、`_onBgmVolumeChange` 五个函数，详见第四·五章的代码。

弹窗的 `input[type="range"]` 样式复用或参考已有的 `#font-range-style`，注入 id 为 `bgm-range-style` 的 `<style>` 标签，选择器前缀改为 `#music-modal`。

---

## 六、bgmName 的存档行为

`bgmName` 被加入 `defaultGameData`，因此会自动参与以下流程（无需额外改动存储逻辑）：

| 流程 | 说明 |
|------|------|
| **自动存档** (`autoSave`) | `syncGameDataFromVariables()` 已将内存变量同步回 `gameData`，三个字段在 `gameData` 中，自然被存入 |
| **手动存档** (`saveGame`) | 同上 |
| **读档** (`loadSaveSlot`) | `mergeWithDefaults` 恢复三个字段，改动点 5 重新 `init()` 同步 enabled/volume 后恢复播放 |
| **JSON导出** (`exportSave`) | `storageService.exportSaveToJson` 导出完整 `gameData`，包含三个字段 |
| **JSON导入** (`importSave`) | `mergeWithDefaults` 恢复，改动点 6 重新 `init()` 同步 enabled/volume 后恢复播放 |

> **bgmName 与战斗BGM**：`bgmManager.onBattleStart()` 仅操作 `_preBattlePath` 内存变量，不修改 `gameData.bgmName`，因此自动存档在战斗期间触发时，存入的仍是战前的 bgmName，退出战斗后播放路径正确。

> **bgmEnabled = false 时的战斗BGM**：`onBattleStart()` 设计上绕过 `_enabled` 检查（战斗BGM视为强制播放）。若希望用户关闭BGM后战斗也静默，可在 `onBattleStart()` 内也检查 `_enabled`——具体策略在实现时决定，方案不强制。

---

## 七、边界情况处理

| 情况 | 处理方式 |
|------|---------|
| 平淡模式下 `mapLocation` 不在 `bgmPingdanManifest` 中（如下山到新地点尚未配置音乐） | 兜底使用 '天山派' 的文件 |
| 情绪/平淡切换时基调与地点均不变 | `updateByTone` 内部判断，不操作 Audio 对象 |
| 音频文件路径存在特殊字符（括号/中文/空格） | 使用 `encodeURI` 对路径编码后赋给 `audio.src`；但不要用 `encodeURIComponent`（会编码斜杠） |
| 浏览器自动播放策略限制（Autoplay Policy） | 在用户首次交互（如点击按钮）时初始化播放。bgmManager.init 可标记 `_ready = false`，首次用户点击后设为 true 并触发待播队列 |
| 读档时 `bgmName` 为空字符串（老存档） | `if (gameData.bgmName)` 判断，跳过播放，保持静默 |
| SR 模式（`isInRenderEnvironment() === true`） | 所有 BGM 调用均包裹在 `!isInRenderEnvironment()` 判断中，SR 链路完全不受影响 |

---

## 八、需要改动的文件汇总

| 文件 | 改动类型 | 改动量 | SR 链路隔离方式 |
|------|---------|--------|----------------|
| `module/game-config.js` | 修改 | 新增 ~50行 | ① CDN 版本锁定（`@5b01b14`），本地改动不传播 |
| `module/bgm-manager.js` | **新建** | ~130行 | ① SR 链路从不引入此文件 |
| `module/game-events.js` | 修改 | +5行 + +4行 | ① CDN 版本锁定（`@5b01b14`）② `typeof bgmManager` 守卫 |
| `module/game-helpers.js` | 修改 | +4行 | ① CDN 版本锁定（`@b261f34`）② `typeof bgmManager` 守卫 |
| `index.html` | 修改 | +1行 audio + +1行 script + ~85行 | ① 与 `index - SR.html` 是独立 HTML 文件 ③ `!isInRenderEnvironment()` 守卫 |

### 三道隔离机制说明

| 编号 | 机制 | 作用范围 |
|------|------|---------|
| ① **CDN 版本锁定** | SR 链路从固定 commit hash 的 CDN 快照加载模块，本地文件改动物理上不可达 | `game-config.js`、`game-events.js`、`game-helpers.js` |
| ② **`typeof bgmManager` 守卫** | `bgm-manager.js` 不被 SR 链路加载，故 `bgmManager` 始终 `undefined`，所有 BGM 调用自动短路 | 共享模块中的新增代码 |
| ③ **`!isInRenderEnvironment()` 守卫** | 语义层面明确 BGM 仅在独立前端模式激活 | `index.html` 内的 BGM 初始化/恢复代码 |

---

## 九、实现顺序建议

1. 用 PowerShell 取精确文件名 → 填入 `bgmFileManifest` / `bgmPingdanManifest`
2. 修改 `game-config.js`（加常量 + 三个字段：bgmName/bgmEnabled/bgmVolume）
3. 新建 `bgm-manager.js` 并本地测试（包含 setEnabled/setVolume/getEnabled/getVolume）
4. 修改 `game-events.js`（parseLLMResponse + setupMessageListeners）
5. 修改 `game-helpers.js`（showBattleGame）
6. 修改 `index.html`（audio 标签 + script + 8处改动点，含音乐设置弹窗）
7. 端到端测试：
   - 普通模式触发回复 → 验证 BGM 切换/不切换
   - SLG 模式切换地点 → 验证平淡BGM按位置切换
   - 进入/退出战斗 → 验证战斗BGM与恢复
   - 存档/读档/导入/导出 → 验证 bgmName/bgmEnabled/bgmVolume 持久化与播放恢复
   - 音乐设置弹窗 → 验证 BGM 开关、音量滑块实时生效并持久化
   - 关闭BGM后进入战斗 → 验证战斗BGM播放策略（绕过 _enabled 或同样静默）
