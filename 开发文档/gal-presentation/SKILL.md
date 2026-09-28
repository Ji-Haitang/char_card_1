---
name: gal-presentation
description: 姬侠传「GAL 演出」迭代的完整开发方案——LLM 正文段尾格式升级（每段自带时间 + 最多 2 个 NPC 各带表情）、时间源从 SIDE_NOTE 迁到末段、以及 GameMode 0 门派养成界面（2D/3D）上叠加可进出的 GAL 演出层。分 6 个阶段，每阶段含目标/改动点/验收标准/测试。当用户要求推进、修改、验收这项迭代的任一阶段，或需要回忆本迭代已拍板的决策时使用。
---

# GAL 演出迭代开发方案（格式升级 + GameMode 0 演出层）

> 状态：**代码与自动化测试已完成**（Phase 0-6 的代码改动、单测、规范/提示词更新均已落地；完成情况见第四节各 Phase 验收勾选）。**待手工验收**：浏览器脚本、真机/APK、真实模型 5 轮统计、旧格式特殊事件链端到端——清单见第四节末「状态与待办」。所有决策均已与用户逐条确认（见第二节决策表），落地时不要再重新讨论已拍板项。
> 用户补充决定：解析器与控制器**不拆独立文件**，直接写在 `module/game-ui.js` 内（见第三节）。
> 执行顺序固定：Phase 0 → 1 → 2 → 3 → 4 → 5。每个 Phase 独立可验收、可回滚；前一阶段验收未过不进下一阶段。

## 一、动手前必读（按顺序）

| # | 文件 / 位置 | 看什么 |
|---|---|---|
| 1 | `module/game-ui.js` `parseSlgMainText`（约 L49-188） | 现有五元组解析：`parts.length !== 5` 当纯文本累积；`isNpcAllowed` 只认 `companionNPC`；`lastValidDisplay` 兜底流式残留 |
| 2 | `module/game-ui.js` `updateStoryText`（约 L517）、`_appendSlgLayers`（约 L573-679）、`updateStoryDisplay`（约 L682）、`doGoToPage/doToggleStoryExpand`（约 L915/931） | GameMode 1 才走解析并加 `slg-global` class；GameMode 0 剥离 `\|` 后内容；图层重建、分页点击左右 1/3；两处隐藏副作用：`emotion === '发情' → enamor = 1`、写 `window.__lastValidSceneUrl/__lastValidNpcEmotionUrl/__lastValidCgUrl` |
| 3 | `module/pipeline.js` `_commitResponse`（约 L793）、`_applyParsedSideNote`（约 L1194）、`withSceneGuard`（约 L1344）、四处 `renderMainText(` 调用（流式 L732/L774、提交 L856、回滚 L1068） | 提交顺序：SIDE_NOTE 先于 renderMainText；流式与提交都调 renderMainText，**演出进入只能挂在提交那一次** |
| 4 | `module/game-events.js` `parseLLMResponse`（约 L349-381） | 现有时间消费：`currentGameTime` / `GameSceneBridge.captureTime` / `dayNightStatus` / `updateSceneBackgrounds()` |
| 5 | `module/scene3d-bridge.js` `playPageTurn`（约 L206-250）、`afterRestore`（约 L608-633）、`setBusy`（约 L639）、`snapshot` eligible（约 L73） | 翻页纸被 `preferences.enabled` 门控；`turn` 所有权；busy 集合暂停渲染 |
| 6 | `module/game-helpers.js` `displayNpcs`（约 L494-576）、`switchScene`（约 L1023-1062）、`updateSceneBackgrounds`（约 L1450-1482） | 站位类 `.single/.double-left/.double-right`；`switchScene('player-stats'/'relationships')` 会强删 `.slg-layer-container` 与 mask；主场景图 `img/location/天山派_{季}_{昼夜}.webp` |
| 7 | `module/game-utils.js` `matchNPC`（约 L609-651）、`matchScene`（约 L543）、`matchEmotion`（约 L576）、`stringSimilarity`（约 L432） | matchNPC 四层：精确名→精确 ID→包含→相似度≥0.6；演出需收紧 |
| 8 | `module/game-styles.css` 约 L1735-1850 | `.slg-layer-container` z:10、`.slg-interaction-mask` z:5、`.slg-global .scene{display:none}`、`.slg-loading-layer` 白底 |
| 9 | `module/game-config.js` `npcs`（约 L197-278）、`locationNames`（约 L173，id→中文名）、`npcNameToId`（约 L281）、`legacySceneOptions`（约 L670） | 全花名册（A-O）= GameMode 0 演出 NPC 白名单；门派地点中文名反查用 `locationNames` 反转（无现成 `sceneNameToId`，需在 parser 内建 `Object.entries(locationNames)` 反查表） |
| 10 | `char_card_information/110格式规范_精简版.txt` 与 `_独立前端.txt`、`105列表.txt`、`200COT思考引导.txt` | 输出契约；105 的 GameMode 0 分支已含 ExpressionList/SceneList/NpcList |
| 11 | `module/special-event.js` | 存量事件文本仍是旧五元组（含 GameMode 0 下播放的龟兹场景，如 SYN_Qiuzi_7） |
| 12 | `tests/scene3d/bridge-unit.mjs`、`tests/scene3d/README.md` | 单测沙箱写法（node:test + vm）、浏览器验收 runner 与夹具（含 Gal 夹具） |

## 二、已拍板决策（不再讨论）

### 2.1 核心原则

**演出层 = 纯表现层覆盖。** viewport 里原本是业务层（2D `.scene` / 3D `#sect-3d-root`），演出就是在其上叠 `gal-layer-container + mask`；进入 = 挂上、退出 = 摘掉；底下一切业务逻辑照常运转、不感知演出。演出层挂上后只认自己那份 frames，不响应业务层变化；摘掉后用户看到业务层此刻的真实状态。

有意例外仅 4 处：① mask 拦 viewport 内点击（viewport 外控件仍可用）；② `setBusy('gal')` 暂停 3D 渲染（性能，不改状态机）；③ 末帧时间写 `currentGameTime/dayNightStatus`（属 commit 流水线，与是否进演出无关）；④ `switchScene('player-stats'/'relationships')` 触发 exit（那两页现有代码会删图层）。

### 2.2 决策表

| ID | 决策 |
|---|---|
| F1 | 新段尾格式 `正文\|场景\|HH:MM\|NPC:表情;NPC:表情\|NSFW`，恒 5 段；第 3 段匹配 `^\d{1,2}[:：]\d{2}$` 判定为新格式，否则走旧五元组 `正文\|NPC\|场景\|表情\|CG` 分支（保留，服务 special-event.js 存量） |
| F2 | 每段 **最多 2 个 NPC**（用户由 3 改为 2）；首个为焦点；`:`/`;` 兼容全角 `：`/`；`；无 NPC 写 `none` |
| F3 | 时间字段为该幕演出时间；LLM 规则：单调不倒退、单回合跨度 ≤ 2h、末段 ≤ 23:00、回忆/闪回段一律填主线当前时间 |
| T1 | 引擎只在 **commit 阶段** 取时间，流式不更新；兜底链：末帧有效时间 → 逆序前序帧 → SIDE_NOTE `时间`（字段保留读取，规范里删除输出要求）→ 原值不变 |
| T2 | 跨回合时间回退合法（LLM 可能重述），不做单调约束校验，仅 console.warn |
| G0 | 进出演出播翻页纸（复用 3D 翻页动画）；演出内部段落切换不播 |
| G1 | 进入条件（自动）：`GameMode===0 && 新回复 commit 完成 && frames.length ≥ 1 && !isStoryExpanded && newWeek !== 1`；同一回复只自动进入一次 |
| G2 | 进入条件（手动）：GameMode 0 下点 story-area **中间 1/3**，或**任何翻页动作**（左右 1/3 / 箭头 / 页码点 → `doGoToPage`）→ 进入并显示 `min(currentPage, frames.length-1)` 对应帧；已在演出中则退化为 `goto`；展开态不响应 |
| G3 | 退出：点舞台任意处（mask click）；点"展开全文"；收起全文不自动重进 |
| G4 | 不进入：展开态收到回复、`newWeek===1`、存档加载/回滚重渲染（`renderMainText` 非 commit 路径） |
| G5 | GameMode 0 NPC 白名单 = `npcs` 全花名册；匹配收紧为 精确名 / 精确 ID / 全名被 token 包含且 `token.length ≤ name.length+2`（+2 而非 +1：容“雨烛姑娘”“破阵子长老”“萧白瑚师姐”这类 2 字敬称，拒“唐沐梨的侍女”），**不走相似度层**；非法 NPC 逐个丢弃（console.log），其余继续 |
| G6 | GameMode 0 场景不在 10 个门派地点（`locationNames` 的中文名，精确匹配）内 → 背景回退 `img/location/天山派_{seasonStatus}_{昼|夜}.webp` |
| G7 | GameMode 0 演出 **不触发 `enamor`**、**不写 `__lastValid*`** 三个全局；场景/NPC/表情只做展示，唯一写变量的是末帧时间（T1） |
| G8 | 翻页纸文案：进入 = **"话本 · 第n回"**（n = 进入时帧索引+1，按演出帧计，不按 storyPages 计）；退出 = **"话本 · 收卷"** |
| G9 | 3D 换房进行中（bridge `turn` 非空）用户进演出：**不播翻页直接进** |
| G10 | 位置切换（`backToMap`/`goToLocation`/`switchScene` 到地图或房间）**不退出**演出，在图层下静默完成 |
| G11 | `switchScene('player-stats'/'relationships')` → `exit({curtain:false})`，保持状态一致 |
| G12 | 退出时若 3D 有待切换房间（busy 解除后会 apply 并自播翻页），跳过演出自身翻页，由 3D 换房翻页兼作退场 |
| G13 | GameMode 0 演出用 body class `gal-presenting`，**不用** `slg-global`（后者会 `display:none` 掉 `.scene`）；**不用**白底 `.slg-loading-layer`；恒加 mask |
| G14 | GameMode 1 现有演出行为保持不变（回归基准），只是改为经过统一的解析层与控制器 |

## 三、目标架构

```
LLM MAIN_TEXT
   │ GalParser.parseFrames()           ← game-ui.js 内 `// ==== GAL_PARSER_BEGIN/END ====` 块（纯函数 IIFE）
   ▼
frames[] = [{ text, scene, time, cast:[{npc,emotion}], cg, legacy, npc, emotion }]
   │                                    (npc/emotion = cast[0] 的镜像，兼容旧消费者)
   ├── 数据层：slgModeData / storyPages / currentPage（game-ui.js 现有）
   ├── 时间源：parseLLMResponse 读 frames 末帧时间（game-events.js）
   └── 演出层：galPresentation 控制器  ← game-ui.js 内 `// ==== GAL_PRESENTATION_BEGIN/END ====` 块（IIFE）
          enter({source, pageIndex}) / goto(i) / exit({reason}) / isPlaying()
          渲染 .slg-layer-container（背景/立绘/CG）+ .slg-interaction-mask
          GameMode 1：不走状态机，updateStoryDisplay 直接调 renderLayers/clearLayers（行为同现状）
          GameMode 0：按 G1-G13 进出，加 gal-presenting，setBusy('gal')
业务层：.scene / #sect-3d-root / displayNpcs / switchScene —— 不改
```

**不新增模块文件**（用户决定）。两个 IIFE 直接写在 `game-ui.js` 顶部（`parseSlgMainText` 原位置），各用一对切片标记注释包裹；单测用 `source.slice(indexOf('// ==== GAL_PARSER_BEGIN ===='), indexOf('// ==== GAL_PARSER_END ===='))` 把块切出来在 `vm` 沙箱运行（同 `bridge-unit.mjs` 切函数体的做法）。两个块内部**只能引用**：自身参数 / `ctx` 传入项 / 明确以 `typeof x !== 'undefined'` 守卫的全局，保证在最小沙箱可加载。

**编辑纪律**：`game-ui.js` 含 `\n` 正则字面量，`SearchReplace` 曾两次把文件写坏——本文件的所有修改一律用 node 手术脚本（Write 临时 `.js` → `node` 执行 → `node --check` → 删脚本）。

### 3.1 GalParser 契约

```
GalParser.parseFrames(mainText, ctx) → Frame[]        // 实际实现：直接返回数组；末尾无标记残文作为最后一帧 tail=true，沿用上一有效展示配置
ctx = buildGalParseContext(gameMode)                 // game-ui.js 内的共用构造，game-events.js 也用它
    = { gameMode, roster:[{id,name}], matchNpc, isNpcAllowed, matchScene, matchEmotion, matchCG, log }
Frame = { text, scene, time|null, cast:[{npc,emotion}](≤2), cg, legacy:boolean, npc, emotion, tail?:true }
```
- 分隔符：按行切；一行 `split('|')` 恰得 5 段才是标记行；否则累积到当前段正文（与现状一致）。
- 新格式判定：`parts[2]` trim 后匹配 `^\d{1,2}[:：]\d{2}$`。时间归一为 `HH:MM`（补零，全角冒号转半角）。
- cast 解析：`parts[3]` 按 `[;；]` 切，每项按 `[:：]` 切成 `NPC:表情`；缺表情视为 `none`；`none/无/空` → 空 cast；白名单过滤后取前 2 个。
- 旧格式：`parts[1]`=NPC、`parts[2]`=场景、`parts[3]`=表情、`parts[4]`=CG，cast 最多 1 个，`legacy=true`，`time=null`。
- 纯函数、无 DOM、无全局读写。

### 3.2 galPresentation 契约

```
galPresentation = {
  state: 'idle'|'playing',
  enter({ source:'commit'|'page', pageIndex, curtain }) → Promise<void>,
  goto(pageIndex),                    // 演出中翻页，只换图层，不播翻页纸
  exit({ reason, curtain }) → Promise<void>,
  isPlaying(), onCommit(commitId),    // 同一 commitId 只自动进入一次
  renderLayers(viewport, frame, opts) // 从 _appendSlgLayers 迁出的纯渲染
  clearLayers(viewport)
}
```
- 依赖只允许：`frames[]`（读 `slgModeData`）、`currentPage`、`GameMode`、`isStoryExpanded`、`newWeek`、viewport DOM、`GameSceneBridge`（可选，`typeof` 守卫）。**不读业务状态**。
- `renderLayers(viewport, frame, opts)`，`opts = { mask, allowEnamor, recordLastValid, mode, portraitFallback }`：`allowEnamor`/`recordLastValid` 仅 GameMode 1 为 true（G7）；`mode===0` 时场景走 G6 路径、表情图 404 `onerror` 回退 `npcPortraits[id]`。
- 双 NPC 站位：表情差分图是 3:2 全幅、角色居中，**不复用** `.npc-portrait.double-*`；改为给 `.slg-emotion-layer` 加 `.slg-cast-left/.slg-cast-right`，用 `transform: translateX(∓22%)` 把两张全幅图分别推到人物中心 28%/72% 位置。操作模式 `.npc-portrait.double-left/right` 用 `left: calc(50% ∓ 22%)` 对齐同一几何（translateX 按元素自身 70% 宽计，不可用）。
- 立绘尺寸：`.slg-emotion-layer img { height: 70% }`，GameMode 0 演出与 GameMode 1 共用、无模式分支，与操作模式 `.npc-portrait` 的 70% 一致，避免退出演出时人物“变小”。特殊CG（`.slg-emotion-special-cg`）不受此限，仍满屏 cover。
- 进出串行化：`gen` 计数 + promise 链；`enter/exit` 同步改 `state`，翻页纸只是异步装饰，不影响状态判定。
- 翻页纸：调用 `GameSceneBridge.playCurtain(cover, label, detail, seal)`（新暴露，**不受** `preferences.enabled` 门控；bridge 未 `start()`（无 viewport）或 `turn` 非空时直接 resolve，即不播）。seal 传 `'话本'`，label 传 `'第n回'`（中文数字）/`'收卷'`，detail 传 `time · scene`。

## 四、阶段划分

每个阶段收尾都执行：
```powershell
node --check module/game-ui.js; node --check module/game-events.js; node --check module/pipeline.js; node --check module/scene3d-bridge.js; node --check module/game-helpers.js; node --check module/storage-service.js
node --test "tests/gal/*.unit.mjs"     # 必须 glob；传目录会 MODULE_NOT_FOUND
npm.cmd --prefix scene3d run test:unit
```
浏览器证据目录统一用 `.scene3d-work/gal-<phase>-<序号>/`（必须是尚不存在的绝对路径）。

**编辑纪律**（实施中总结，详见 `tests/gal/README.md`）：
- `game-ui.js` 只用 node 手术脚本改：读 → `\r\n` 归一 `\n` → `replaceOnce` 唯一锚点校验 → 写 → `node --check` → 删脚本。文件现为纯 LF。编辑器工具整段替换会写坏链式 `\n` 正则。
- `char_card_information/*.txt` 为 CRLF，改后脚本核对 CRLF 行数与关键词计数；工具参数里不要用 `\uXXXX` 转义中文（曾误写「暧昧」为「暖昧」）。
- PowerShell 下 `node -e` 内联含中文/正则会编码错乱，改写临时 `.cjs`。

---

### Phase 0 — 基线固化与测试底座

**目标**：在改任何逻辑之前，把现有 GameMode 1 解析/渲染行为用测试钉死，作为后续回归基准。

**改动点**
- 新建 `tests/gal/` 目录与 `tests/gal/_sandbox.mjs`（参考 `tests/scene3d/bridge-unit.mjs` 的 vm host 写法，提供最小 document/viewport 假对象与 `GameMode/companionNPC/npcs/seasonStatus/dayNightStatus` 全局）。
- 新建 `tests/gal/fixtures/`：
  - `legacy-gm1.txt`：旧五元组 GameMode 1 正文（含 1 个非随行 NPC、1 个 `none` 场景、1 段无标记纯文本、末尾流式残文）。
  - `legacy-special-event.txt`：从 `special-event.js` 抽一段 GameMode 0 下播放的旧格式文本（龟兹场景）。
  - `new-gm0.txt` / `new-gm1.txt`：按 F1-F3 手写的新格式样本（双 NPC、单 NPC、none、全角分隔符、无表情、路人 NPC、非法场景、时间倒退一例）。
- 新建 `tests/gal/legacy-baseline.unit.mjs`：把 `game-ui.js` 中 `parseSlgMainText` 函数体切片（`source.slice(indexOf('function parseSlgMainText'), indexOf('// 下一个函数注释'))`，方式同 bridge-unit 切 `showLocationInfo`）在沙箱运行，对 `legacy-gm1.txt` 生成快照 JSON 存入 `tests/gal/fixtures/legacy-gm1.expected.json`。

**验收标准**
- [x] `node --test "tests/gal/*.unit.mjs"` 通过，快照 `fixtures/legacy-gm1.expected.json` 生成并核对。
- [x] 未修改任何 `module/*.js`。

---

### Phase 1 — 解析层统一（GalParser 块）

**目标**：新旧格式同一入口解析出 `frames[]`；去掉 GameMode 门控；GameMode 1 对旧格式的输出与 Phase 0 快照逐字节一致。

**改动点**
- 在 `game-ui.js` 原 `parseSlgMainText` 位置写入 `GAL_PARSER_BEGIN/END` 块，实现 3.1 契约（不新增文件、不改 `index.html`）。
- `game-ui.js` `parseSlgMainText` 改为薄包装：构造 ctx（GameMode 1 → `companionNPC`；GameMode 0 → `Object.values(npcs).map(n=>n.name)`），调用 `GalParser.parseFrames`，返回 frames（保留 `npc/emotion` 字段镜像 cast[0]，`slgModeData` 现有消费者零改动）。
- `updateStoryText`：**两种 GameMode 都**调用解析；GameMode 0 的 `storyPages` 仍按帧正文分页（等价于现在"剥离 `|` 后内容"的效果，但页与帧一一对应）。GameMode 0 解析不到任何帧时保持现有自然段分页回退。
- GameMode 0 白名单匹配按 G5 实现在 parser 内（不调 `matchNPC`），GameMode 1 保持调 `matchNPC`（行为不变）。

**验收标准**
- [ ] `tests/gal/parser.unit.mjs`：
  - 旧格式 GameMode 1 样本 → 输出与 `legacy-gm1.expected.json` 深等；
  - 新格式：双 NPC 顺序与焦点正确；3 个 NPC 只取前 2 个有效；全角 `：；` 等价半角；缺表情 → `none`；`none` cast 为空数组；时间 `8:05`→`08:05`；
  - GameMode 0："路过的百姓" 被丢弃、同段另一合法 NPC 保留；"雨烛姑娘" 命中雨烛（长度≤名字+2），"雨烛姑娘和众人" 不命中；无相似度误判（构造 `stringSimilarity≥0.6` 但非包含的名字，断言丢弃）；
  - GameMode 0 旧格式（special-event 样本）能解析，`legacy=true`，`time=null`；
  - 流式：末行无 `|` 的残文作为 `tail=true` 末帧（沿用上一有效展示配置）兜底显示；
  - 不含标记的纯文本 → `frames=[]`。
  - **状态：已完成**（`parser.unit.mjs`）。
- [ ] 手工回归：GameMode 1 游戏内跑一轮旧格式特殊事件与一轮新格式正常回复，图层显示与改前一致。（待手工）
- [ ] `updateStoryText` 在 GameMode 0 下渲染的分页文本不再含任何 `|` 残留（浏览器脚本断言 `#story-text` innerText 无 `|`）。（待浏览器脚本）

---

### Phase 2 — 时间源迁移

**目标**：`currentGameTime`/`dayNightStatus`/`captureTime` 改由末帧时间驱动，SIDE_NOTE 时间降级为兜底。

**改动点**
- `game-events.js` `parseLLMResponse(response, mainTextContent)`：新增 `resolveTurnTime(frames, sideNote)` 按 T1 兜底链取时间；解析走 `GalParser.parseFrames`（ctx 与 game-ui 一致；可把 ctx 构造抽为 `buildGalParseContext()` 放 game-ui.js 供两处共用）。其余时间消费代码（`captureTime`、`dayNightStatus`、`updateSceneBackgrounds`）不动，只换输入。
- 时间倒退（相对上一轮 `currentGameTime`）仅 `console.warn('[GalTime] 回退')`，不拦截（T2）。
- 确认流式路径（pipeline L732/L774 的 `renderMainText`）不触碰时间——它们本来就不调 `parseLLMResponse`，加一条单测断言防回归。

**验收标准**
- [x] `tests/gal/time.unit.mjs`：末帧有时间取末帧；末帧无时间取前序最近一帧；全部无时间取 SIDE_NOTE；两者皆无则不变；`23:30` 与 `05:59` 的 `dayNightStatus` 分别为 night；旧格式全文（time 全 null）+ SIDE_NOTE 有时间 → 行为与改前完全一致。实现放在 `game-events.js` `GAL_TIME_BEGIN/END` 块；`pipeline._applyParsedSideNote` 在无 SIDE_NOTE 时也会单独应用末帧时间（与原方案的差异点）。
- [ ] `summaryHistoryService` 写入的 `gameTime`、`prompt-builder` `[当天时间 HH:MM]` 注入、`st-exporter` gameTime 对齐——三处只读 `currentGameTime`，不需改动；用一轮真实回复核对 `summaryHistory` 最新条 `gameTime` 等于末帧时间。
- [ ] 3D：一轮新格式回复后 `GameSceneBridge.getDiagnostics()` 中 `preciseTime.hour` 等于末帧小时且 epoch 匹配。

---

### Phase 3 — 演出控制器抽取（GameMode 1 回归）

**目标**：把 `_appendSlgLayers`/`updateStoryDisplay` 中的图层渲染迁入 `GAL_PRESENTATION` 块，GameMode 1 行为不变，同时支持双 NPC 站位。此阶段 GameMode 0 **仍不进演出**。

**改动点**
- 在 `game-ui.js` `GAL_PARSER_END` 之后写入 `GAL_PRESENTATION_BEGIN/END` 块，实现 3.2 契约；`renderLayers(viewport, frame, opts)` 为 `_appendSlgLayers` 逻辑平移，差异点：
  - 立绘按 `cast.length` 选站位类：1 → 无附加类（居中，同现状）；2 → `.slg-cast-left`/`.slg-cast-right`（新 CSS，见 3.2）；每个 NPC 各自取表情图。
  - `opts.allowEnamor` 为 true 时才执行 `emotion==='发情' && enamor===0 → enamor=1`（对 cast 任一成员命中即触发，与现状单 NPC 语义对齐）；`opts.recordLastValid` 为 true 时才写 `__lastValid*`。
  - 场景图选择逻辑不变（SLG 路径 / `legacySceneOptions` 分支）。
- `game-ui.js`：删除 `_appendSlgLayers`，`updateStoryDisplay` 中 GameMode 1 分支改为直接调 `galPresentation.renderLayers(viewport, pageData, {mask:needsMask, allowEnamor:true, recordLastValid:true, mode:1})`，清图层改为 `galPresentation.clearLayers(viewport)`。GameMode 1 **不走** enter/exit 状态机（状态机只服务 GameMode 0）。
- `scene3d-bridge.js`：暴露 `playCurtain(cover, label, detail, seal)`——与 `playPageTurn` 共用内部 `runPageTurn`，但不检查 `preferences.enabled`；`!viewport || turn` 时直接 resolve；`playPageTurn` 保持原签名与行为（seal 恒 `山门图志`）。返回对象需仍 `Object.freeze`。
- `tests/scene3d/bridge-unit.mjs` 追加：`playCurtain` 在 `preferences.enabled=false` 时仍创建翻页纸；`turn` 非空时不创建、立即 resolve。

**验收标准**
- [x] `tests/gal/presentation.unit.mjs`（沙箱 viewport）：单 NPC 帧生成 1 个无站位类的 `.slg-emotion-layer`；双 NPC 生成 `.slg-cast-left` + `.slg-cast-right` 且顺序 = cast 顺序；`allowEnamor=false` 时"发情"不改 `enamor`；`recordLastValid=false` 时 `__lastValid*` 保持 undefined；`goto` 幂等（连续两次同页不重复创建节点）；`exit` 后 viewport 内无 `.slg-layer-container/.slg-interaction-mask`。`bridge-unit.mjs` 已追加 `playCurtain` 两例。
- [ ] GameMode 1 手工回归清单：旧格式特殊事件全程；新格式双 NPC 回复；`none` 场景；CG 段；展开全文/收起；分页左右点击；战斗进入时背景取 `__lastValidSceneUrl` 正常；表情"发情"仍置 enamor。
- [ ] 浏览器脚本 `tests/gal/gm1-regression.browser.mjs`（用 `fixtures/manifest.json` 中 Gal 夹具启动）：注入 `new-gm1.txt` 走 `renderMainText`，断言图层 DOM 结构；截图存证据目录。（未编写）
- [x] `npm.cmd --prefix scene3d run test:unit`：除 4 个预存失败（`apk-unit` ×2 版本不匹配、`npc-selection.unit` ×2 `raf is not defined`，与本迭代无关）外全绿。

---

### Phase 4 — GameMode 0 演出层

**目标**：按 G0-G13 在门派养成界面（2D/3D）实现可进出的演出。

**改动点**

*进入*
- `pipeline.js` `_commitResponse` 第 5 步 `renderMainText(parsed.mainText)` 之后追加：`if (typeof galPresentation !== 'undefined') galPresentation.onCommit({ commitId })`。控制器内部判定 G1（`GameMode===0 && frames.length≥1 && !isStoryExpanded && newWeek!==1 && commitId 未进入过`）后 `enter({source:'commit', pageIndex:0, curtain:true})`。`handleSpecialEvent` 也经 `_commitResponse`，自动覆盖特殊事件。
- 流式 `renderMainText`（L732/L774）与回滚 `renderMainText`（L1068）不调用 `onCommit`（G4）。
- `game-ui.js` `updateStoryDisplay`：story-area 点击处理增加中间 1/3 区域；`doGoToPage` 在 `GameMode===0 && !isStoryExpanded && frames.length>0` 时同样 `enter({source:'page', pageIndex:min(currentPage, frames.length-1), curtain:true})`（G2，翻页即进入；演出中 enter 退化为 goto，不播翻页纸）。控制台可按 `[GAL]` 前缀过滤 enter/exit/onCommit/story click 日志。

*渲染*
- `enter` 时 `document.body.classList.add('gal-presenting')`；`GameSceneBridge.setBusy('gal', true)`；恒加 `.slg-interaction-mask`（不走 `needsMask` 排除）；mask `click` → `exit({reason:'stage-click', curtain:true})`（G3）。
- GameMode 0 场景图：`frame.scene` 精确命中 `Object.values(locationNames)` 中的门派地点中文名 → `img/location/{地点名}_{昼|夜}.webp`（同 `updateSceneBackgrounds` 路径）；否则 → `img/location/天山派_{seasonStatus}_{昼|夜}.webp`（G6）。昼夜取 `dayNightStatus`（Phase 2 已在渲染前更新）。
- `renderLayers` 调用固定 `{allowEnamor:false, recordLastValid:false}`（G7）。
- `game-styles.css`：新增 `body.gal-presenting` 规则——不隐藏 `.scene`；`.slg-layer-container` 置于 3D root 之上（现有 z:10 已满足，确认 `#sect-3d-root` z 不高于 5）；不出现 `.slg-loading-layer`。

*翻页纸*
- `enter`/`exit` 传 `curtain:true` 时调用 `GameSceneBridge.playCurtain(cover, '话本', '第n回' | '收卷')`（G8）；n = `pageIndex+1`。bridge `turn` 非空 → `playCurtain` 立即 resolve → 直接进出（G9）。
- 退出 G12：`exit` 前查询 `GameSceneBridge.getDiagnostics()`（或新增 `hasPendingApply()`），若 3D 有待应用房间切换则 `curtain:false`。

*退出钩子*
- `doToggleStoryExpand`：展开 → `exit({reason:'expand', curtain:true})`；收起不进入（G3）。
- `switchScene('player-stats'|'relationships')`：在现有删图层代码处改为 `galPresentation.exit({curtain:false})`（G11）。
- `pipeline.runTurn` 开始（`withSceneGuard` 进入处）：`exit({reason:'new-turn', curtain:false})`。
- `GameSceneBridge.afterRestore`（存档回滚/加载）：`exit({curtain:false})`。
- GameMode 0→1（special-event `GameMode set 1` 或 SIDE_NOTE）：`updateStoryText` 中发现 `GameMode===1` 时控制器切为常驻模式，先 `exit({curtain:false})` 再 enter。
- **不**在 `backToMap`/`goToLocation`/`switchScene(map|房间)` 退出（G10）。

*控制器内部状态*
- `enteredCommitId`：同一 commit 只自动进一次；用户手动退出后不再自动进（点中间 1/3 可再进）。
- `exit` 需幂等；`enter` 在 `playing` 时只 `goto`。

**验收标准**
- [ ] `tests/gal/gm0-controller.unit.mjs`：
  - `onCommit` 在 `GameMode=0/展开=false/newWeek=0/frames≥1` 进入；`isStoryExpanded=true`、`newWeek=1`、`frames=[]`、`GameMode=1` 四种各不进入；同 commitId 第二次 `onCommit` 不进入；
  - 手动 `enter({source:'page', pageIndex:7})` 在 frames.length=3 时渲染第 3 帧；
  - mask click → `idle`、body 无 `gal-presenting`、`setBusy('gal',false)` 被调用；
  - `exit` 幂等；`enter` 期间 3D `turn` 非空 → `playCurtain` 未创建 DOM；
  - 非法场景 → 背景 URL 为 `天山派_{季}_{昼夜}.webp`；合法场景 → `{地点}_{昼夜}.webp`；
  - `emotion='发情'` 全程 `enamor===0`；`__lastValid*` 保持 undefined。
  - **状态：已完成**（10 例）。实现细节：`switchScene` 特殊场景用 `exit({reason:'special-scene', curtain:false})`；GM0→1 在 `updateStoryText` GM1 分支调 `galPresentation.reset()`；存档还原钩子放在 `storage-service` 快照还原处（`reset()`）。已知小瑕疵：`doToggleStoryExpand` 展开时 `exit` 的翻页纸尚在异步播放，`updateStoryDisplay` 已同步清层，图层先消失再盖纸，可接受。
- [ ] `tests/gal/gm0.browser.mjs`（未编写）（用地图/藏经阁夹具，分别在 3D 开/关两种偏好下）：
  1. 注入 `new-gm0.txt` 走完整 `_commitResponse` 模拟（或直接 `renderMainText`+`onCommit`）→ 断言 `.slg-layer-container` 出现、翻页纸 DOM 出现过、`body.gal-presenting`、`.scene.active` 仍 `display` 非 none、3D diagnostics `busy` 含 `gal`；截图。
  2. 点 mask → 全部清除、busy 解除；截图。
  3. 点 story-area 中央 → 再次进入且帧 = currentPage；点右 1/3 → 帧切换、无翻页纸 DOM 新增。
  4. 点"展开全文" → 退出；收起 → 仍 idle。
  5. 演出中程序性调用 `switchScene('houshan')` → 仍 playing，退出后 `#houshan-scene.active`。
  6. 演出中调用 `switchScene('player-stats')` → idle。
  7. `newWeek=1` 提交 → 不进入。
  8. 双 NPC 帧 → `.slg-cast-left/.slg-cast-right` 各 1；含路人 NPC 帧 → 仅 1 个 `.slg-emotion-layer`。
- [ ] 手工：真机/桌面各跑 3 轮真实 LLM 回复（2D 与 3D 各一组），观察翻页纸文案、遮罩、退出后底层状态；APK 横竖屏各一次。
- [ ] GameMode 1 回归（Phase 3 清单）复跑通过。

---

### Phase 5 — 格式规范与提示词更新 + 端到端

**目标**：让 LLM 实际按新格式输出；SIDE_NOTE 不再要求时间；存量特殊事件不受影响。

**改动点**
- `110格式规范_精简版.txt` 与 `110格式规范_精简版_独立前端.txt`：
  - GameMode 0 主分支与 GameMode 1 分支的 MAIN_TEXT 段尾统一改为 `|{{enum:场景}}|{{HH:MM}}|{{NPC}}:{{enum:表情}};{{NPC}}:{{enum:表情}}|{{enum:NSFW或none}}`；说明：最多 2 个 NPC，首个为主要描写对象，无人则 `none`；场景/表情/NPC 取自 `<SceneList>/<ExpressionList>/<NpcList>`。
  - 新增时间规则段（F3 四条）。
  - SIDE_NOTE 删除 `"时间"` 字段（`_独立前端` 与精简版同步）；newWeek/战斗分支 MAIN_TEXT 仍无段尾标记。
- `105列表.txt`：确认 GameMode 0 分支 NpcList 为全花名册（已是），无需改；如有"none"缺失补上。
- `200COT思考引导.txt`：在思考步骤里加一句"逐段确定该幕时间与在场 NPC（≤2）"。
- 如 `tools/generate-prompt-data.js` 会把 char_card 编译进 `prompt-data-*.js`，改完需重新生成并核对产物。
- `special-event.js` **不改**文本（旧格式由 legacy 分支解析；GameMode 0 下龟兹场景由 G6 回退主场景）。
- `开发文档/special-event-writing/SKILL.md` 第三节段尾格式说明追加一行：新写事件可用新格式，旧格式仍兼容。

**验收标准**
- [ ] 用真实模型各跑 5 轮 GameMode 0 / GameMode 1 回复，统计：段尾解析成功率 ≥ 90%（每段 5 字段且时间合法）；非法 NPC 出现次数；时间倒退次数（console.warn 计数）。不达标则回调规范措辞后重测。（待真实 API）
- [x] SIDE_NOTE 不含时间时，`currentGameTime` 仍随每轮更新（Phase 2 链路，`time.unit.mjs` 覆盖）。
- [ ] 跑一条完整旧格式特殊事件链（如洞庭君链）到收尾，GameMode 0 段落背景回退主场景、无报错。（待手工）
- [x] `prompt-data-*.js` 重新生成后语法通过；用 vm 渲染 `PROMPT_CORE_110` 四分支核对：GM0 主线 / GM1 普通 / GM1 战斗 含新段尾且 SIDE_NOTE 无「时间」；GM0 newWeek 分支保留 SIDE_NOTE「时间」、无新段尾（MAIN_TEXT 无标记，时间靠 SIDE_NOTE 兜底，属有意保留）；105 GM0 NpcList 含 `none`；两版 COT 含「演出时间轴」。

实际改动文件：`110格式规范_精简版.txt`、`110格式规范_精简版_独立前端.txt`、`105列表.txt`、`200COT思考引导.txt`、`200COT思考引导 - 鲸鱼版.txt`、`开发文档/special-event-writing/SKILL.md`、重生成 `module/prompt-data-core.js` / `prompt-data-extra.js`。

---

### Phase 6 — 收尾

- [x] 新建 `tests/gal/README.md` 记录命令、夹具、沙箱与编辑纪律。
- [x] 本 SKILL 状态行与各 Phase 勾选回填。
- [ ] `打包APK.ps1` 打一次 APK 走 Phase 4 真机手工项。
- [ ] 清理 `.scene3d-work/gal-*`（本轮未产生浏览器证据目录，暂无需清理）。

### 状态与待办

**已完成（自动化）**：`tests/gal` 5 个单测文件 44 例全通过；`bridge-unit` 含 `playCurtain` 新增例通过；全量 `test:unit` 仅 4 个预存无关失败。

**待手工/真实环境验收**（按优先级）：
1. 真实模型 GM0 / GM1 各 5 轮，统计段尾解析成功率、非法 NPC、时间倒退（Phase 5）。
2. GM1 手工回归清单（Phase 3）+ 旧格式特殊事件链端到端（Phase 5）。
3. GM0 演出 2D/3D 手工 3 轮 + 浏览器脚本 `gm0.browser.mjs` / `gm1-regression.browser.mjs`（Phase 4/3，脚本未编写）。
4. APK 打包 + 真机横竖屏。

## 五、测试方法约定

- **单测**：`node:test` + `node:assert/strict` + `vm.createContext` 沙箱，文件放 `tests/gal/*.unit.mjs`；从 `game-ui.js` 按 `GAL_*_BEGIN/END` 标记切片后 `runInContext`，全局用 `let` 预声明（见 `bridge-unit.mjs` L46）。两个块必须能在无 DOM 的最小沙箱中加载（DOM 只在调用 `renderLayers/enter` 时才需要）。
- **浏览器**：复用 `scene3d/scripts/run-browser.mjs` 的启动方式（只读静态 server、夹具注入、等待原 `window.onload` resolve），脚本放 `tests/gal/*.browser.mjs`，输出目录必须是新建绝对路径；断言优先 DOM/计算样式，截图作证据不作断言。
- **手工**：每阶段的手工清单写在验收标准里，执行时逐项打勾并在证据目录留 `manual.md`。
- 不连真实 API 的自动化一律用夹具正文；Phase 5 的真实模型统计单独记录。

## 六、已知风险与坑

| 风险 | 应对 |
|---|---|
| 时间通胀漂移（LLM 每段递增导致一回合跨半天） | F3 限 ≤2h、末段 ≤23:00 写进规范；Phase 5 统计倒退/跨度，超标改措辞 |
| 旧格式误判为新格式 | 判定只看 `parts[2]` 是否 HH:MM；旧格式第 3 段是场景名，不可能匹配 |
| 新格式漏写时间被当旧格式 | 此时 `parts[1]`=场景会被当 NPC → 白名单不通过 → 该段退化为 `none` NPC；可接受，规范里强调时间必填 |
| `matchScene` 对两字地点（"伙房"/"丹房"、"山门"/"后山"）模糊误命 | GameMode 0 演出场景匹配用 `locationNames` 中文名精确匹配，不走 `matchScene` 相似度；Phase 4 单测覆盖 |
| `renderMainText` 多路径调用导致重复进入 | 只在 `_commitResponse` 显式 `onCommit`，其余路径不触发；`enteredCommitId` 双保险 |
| 翻页纸所有权冲突 | `playCurtain` 在 `turn`/`pageAnimation` 忙时直接 resolve；G9/G12 |
| `switchScene('player-stats')` 删图层导致状态脱节 | G11 在该处调用 `exit` |
| 演出中 `setBusy('gal')` 忘记解除导致 3D 永久停画 | `exit` 幂等且在 `finally` 解除；`afterRestore`/`runTurn` 钩子兜底；单测断言 busy 集合 |
| `slg-global` 误用于 GameMode 0 | G13：用 `gal-presenting`；CSS 单测检查 `.scene.active` 计算样式 display≠none |
| special-event.js 存量文本 | legacy 分支 + G6 回退，Phase 5 跑完整链验证 |
| GameMode 0 `storyPages` 与 `frames` 索引不一致（事件描述页、纯文本块） | 页与帧一一对应由 Phase 1 保证；手动进入用 `min(currentPage, frames.length-1)` 钳制 |

## 七、未决 / 后续可选

- v2：3D 透出（演出背景改为半透明让 3D 场景显露）——本迭代不做，架构上 `renderLayers` 已隔离，后续只换背景策略。
- 演出中是否显示"第 n/N 回"页码角标——暂不做，待 v1 体验后定。
- `matchScene` 两字地点阈值实测结果回填到第六节。
