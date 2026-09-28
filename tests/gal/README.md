# tests/gal — GAL 演出迭代测试

配套方案：`开发文档/gal-presentation/SKILL.md`。

## 运行

```powershell
# 本目录单测（注意：必须用 glob；传目录会 MODULE_NOT_FOUND）
node --test "tests/gal/*.unit.mjs"

# 涉及文件的语法检查
node --check module/game-ui.js; node --check module/game-events.js; node --check module/pipeline.js; node --check module/scene3d-bridge.js; node --check module/game-helpers.js; node --check module/storage-service.js

# 全量单测（含 scene3d bridge）
npm.cmd --prefix scene3d run test:unit
```

全量 `test:unit` 有 4 个与本迭代无关的预存失败：`apk-unit` ×2（APK application/version mismatch，需重新打包 APK）与 `npc-selection.unit` ×2（`raf is not defined`）。其余应全绿。

## 文件

| 文件 | 内容 |
|---|---|
| `_sandbox.mjs` | vm 沙箱：`makeSandbox()` 提供 fakeDom（Element 含 classList/dataset/querySelector(All)/dispatch，`getBoundingClientRect` 宽 900）与 `GameMode/companionNPC/npcs/seasonStatus/dayNightStatus/enamor` 等全局；`loadParser()`/`loadPresentation()` 按 `game-ui.js` 的 `GAL_PARSER_BEGIN/END`、`GAL_PRESENTATION_BEGIN/END` 切片载入；`loadTime()` 切 `game-events.js` 的 `GAL_TIME_BEGIN/END`；`plain()` 做 JSON 往返去掉沙箱原型 |
| `legacy-baseline.unit.mjs` | Phase 0：旧五元组 GameMode 1 快照（`fixtures/legacy-gm1.expected.json`），后续 Phase 逐字节回归 |
| `parser.unit.mjs` | Phase 1：新旧格式统一解析、GM0 白名单（G5）、全角分隔符、时间归一、流式残文 tail 帧 |
| `time.unit.mjs` | Phase 2：末帧时间 → 前序帧 → SIDE_NOTE → 不变 的兜底链；旧格式行为不变 |
| `presentation.unit.mjs` | Phase 3：`renderLayers` 单/双 NPC 站位、G6 场景 URL、G7 开关、`clearLayers`、`goto` 幂等、`cnNumber` |
| `gm0-controller.unit.mjs` | Phase 4：`onCommit` 门控、`enter/goto/exit/reset` 状态机、mask 退出、翻页纸文案、`hasPendingApply` 抑制、busy/body class 收放 |
| `fixtures/legacy-gm1.txt` | 旧格式 GM1 正文（非随行 NPC、none 场景、无标记纯文本、末尾残文） |
| `fixtures/legacy-gm1.expected.json` | Phase 0 快照 |
| `fixtures/legacy-special-event.txt` | `special-event.js` 抽出的 GM0 下旧格式片段（龟兹场景） |
| `fixtures/new-gm0.txt` / `new-gm1.txt` | 新段尾格式样本（双 NPC、none、全角、缺表情、路人、非法场景、时间倒退） |

## 沙箱约定

- 切片块内只用 `function`/`const`/`let` 顶层声明，不依赖外部模块；全局引用一律 `typeof` 守卫。
- 沙箱里 `let` 绑定只能在沙箱内赋值：`box.sandbox.__v = v; box.run('GameMode = __v;')`，直接改 `box.sandbox.GameMode` 无效。
- 翻页纸/busy 通过 fake `GameSceneBridge`（`playCurtain/setBusy/hasPendingApply`）记录调用，断言调用序列而非 DOM 动画。
- 浏览器验收脚本（`*.browser.mjs`）本轮未编写；如补写，沿用 `scene3d/scripts/run-browser.mjs` 启动方式，证据目录 `.scene3d-work/gal-<phase>-<序号>/`（须是尚不存在的路径）。

## 编辑 `module/game-ui.js` 的纪律

该文件含链式 `\n` 正则与大段中文，用编辑器工具整段替换容易写坏。已验证可行的做法：

1. 写临时 node 脚本（如 `tests/gal/_splice.cjs`）：读文件 → `\r\n` 归一为 `\n` → 每处改动用 `replaceOnce(anchor, replacement)`，锚点在文件中必须**恰好出现一次**，否则抛错 → 写回。
2. `node --check module/game-ui.js`。
3. 跑本目录单测。
4. 删除临时脚本。

文件当前为纯 LF、1504 行。

对 `char_card_information/*.txt`（CRLF）改动后，用脚本核对 CRLF 行数未变、关键词计数正确；在工具参数里写 `\uXXXX` 转义中文极易码点写错（曾把「暧昧」写成「暖昧」），直接写字面中文。
