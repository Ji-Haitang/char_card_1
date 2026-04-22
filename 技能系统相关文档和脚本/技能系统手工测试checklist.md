# 技能系统手工测试 Checklist

这份清单按"先短链路、再边界、再持久化、最后战斗"的顺序执行。

当前版本共 **16 个技能**，记忆点上限 **10**，需分 **3 批**完成战斗测试。

## 0. 测试辅助脚本用法

文件位置：[技能系统测试辅助脚本.js](技能系统测试辅助脚本.js)

批次预设脚本位置：[技能测试批次预设脚本.js](技能测试批次预设脚本.js)

### 使用步骤

最简单的操作顺序如下：

1. 刷新主页面。
2. 打开主页面控制台，把 [技能测试批次预设脚本.js](技能测试批次预设脚本.js) 全部内容粘贴进去执行一次。
3. 执行 `await skillBatchPresetHelper.setupBatch('A')` 或 `B / C`，一键完成属性、好感、全技能 Lv5、批次装备。
4. 点击"切磋"进入战斗。
5. 打开主页面控制台，把 [技能系统测试辅助脚本.js](技能系统测试辅助脚本.js) 全部内容粘贴进去执行一次。
6. 执行 `await skillTestHelper.injectBattleHelper()`。
7. 执行 `await skillTestHelper.battleHelper().logSkillsByTiming()`，确认返回结果不是 `{}`。

如果第 7 步返回 `{}`，先不要继续测试，说明这局战斗没有收到已装备技能，需要回主页面重新检查装备状态。

如果执行 `await skillTestHelper.oneClick().runBatchA()` / `runBatchB()` / `runBatchC()` 报错 `未找到战斗测试方法: oneClick.runBatchX`，通常不是技能逻辑 bug，而是**主页面脚本已更新、战斗页里仍残留旧版 helper**。处理方法：

1. 关闭当前切磋，回到主页面。
2. 刷新主页面。
3. 重新粘贴执行最新版 [技能系统测试辅助脚本.js](技能系统测试辅助脚本.js)。
4. 重新进入切磋，再执行 `await skillTestHelper.injectBattleHelper()`。

确认技能已经带进战斗后，直接执行你需要的一键命令即可。

如果你只想确认当前战斗页状态，也可以执行：

1. `await skillTestHelper.battleSnapshot()`
2. `await skillTestHelper.battleHelper().recentLogs(12)`

### 分批测试方案

由于记忆点上限为 10，16 个技能无法同时装备，需要分 3 批测试：

| 批次 | 技能组合 | 记忆点 | 命令 |
|------|---------|--------|------|
| A | 绷急孝典乐(1) + 小梨飞刀(2) + 开山九式(2) + 冰川点穴手(2) + 灵狐剑法(1) + 连羽缠丝(1) + 百草心经(1) | 10 | 预设：`await skillBatchPresetHelper.setupBatch('A')` 战斗：`await skillTestHelper.oneClick().runBatchA()` |
| B | 冰心诀(3) + 肉斩骨断(1) + 不动明王诀(2) + 猿臂拳(2) + 青鸟衔书(2) | 10 | 预设：`await skillBatchPresetHelper.setupBatch('B')` 战斗：`await skillTestHelper.oneClick().runBatchB()` |
| C | 霜雪葬花(3) + 无剑真意(3) + 天象示警(1) + 造化度厄针(3) | 10 | 预设：`await skillBatchPresetHelper.setupBatch('C')` 战斗：`await skillTestHelper.oneClick().runBatchC()` |

每个批次的完整流程：

1. 回到主页面，打开控制台，粘贴执行 [技能测试批次预设脚本.js](技能测试批次预设脚本.js)（如果已经执行过则无需重复）。
2. 执行 `await skillBatchPresetHelper.setupBatch('A')` 或 `B / C`。
3. 确认返回结果里的 `memory.used/max` 为 `10/10`。
4. 点击"切磋"进入战斗。
5. 在主页面控制台粘贴执行 [技能系统测试辅助脚本.js](技能系统测试辅助脚本.js)（如果已经执行过则无需重复）。
6. 执行 `await skillTestHelper.injectBattleHelper()`。
7. 执行 `await skillTestHelper.battleHelper().logSkillsByTiming()`，确认技能已带入。
8. 执行对应批次命令，如 `await skillTestHelper.oneClick().runBatchA()`。

也可以先执行 `skillBatchPresetHelper.printBatchPlan()` 查看分批方案。

### 期望输出格式

每个一键命令都会返回一个对象，并在控制台打印一组 `[SkillTestHelper] oneClick result` 日志，结构大致如下：

```js
{
	caseName: '绷急孝典乐_嘴炮对防御',
	advanced: true,
	playerAction: 'taunt',
	enemyAction: 'defend',
	before: { ... },
	after: { ... },
	newLogs: [ ... ],
	skillLogs: [ ... ],
	expectation: [ ... ],
	expectationResult: [
		{ text: '...', matched: true }
	],
	passed: true
}
```

批量命令 `runBatchA/B/C()` 会额外输出一张总表，并返回一个总结果对象，结构大致如下：

```js
{
	caseName: '批次A_批量执行',
	rows: [
		{
			skill: '绷急孝典乐',
			caseName: '绷急孝典乐_嘴炮对防御',
			advanced: true,
			passed: true,
			keyObservation: '...'
		}
	],
	detail: [ ... ],
	passed: true
}
```

### 如何判断是否通过

- `advanced: true` 代表这一回合正常结算完成。
- `passed: true` 代表这次一键测试捕捉到了预期关键字。
- `newLogs` 是这次回合新增的战斗日志。
- `skillLogs` 是从 `newLogs` 中筛出来的技能相关日志。
- `expectationResult` 用来逐条看预期关键字是否命中。
- 对于批量命令，重点看 `rows` 和控制台里的 `console.table` 总表。
- 批量命令最顶层的 `passed: true` 代表该批次所有技能测试都通过。

### 额外建议

- 第六项先配合浏览器控制台过滤 `[SkillTest]`。
- 第七项优先使用分批一键命令，不建议纯手动刷敌方动作。
- `compareSpecialDamage(0.2)` 用于比对肉斩骨断满血与残血的差异，但如果敌人太弱被提前打死，需要重新开一局再测。
- 如果你只想快速验一个技能，优先用单项命令，不必先跑整批。
- 造化度厄针的测试用例会自动将敌人血量设为 9999，避免绝招秒杀导致技能不触发。

## 一、基础冒烟

- [√] 打开藏经阁，点击技能习得，确认技能列表正常显示（共 16 个技能）。
- [√] 学习一个 Lv1 技能，确认弹出学习确认框，确认后成功学习。
- [√] 学习成功后，确认技能习得中该技能显示为"已学 Lv1"或"Lv1 → Lv2"。
- [√] 打开查看技能，确认该技能出现在"已学技能"区域。
- [√] 点击装备，确认该技能进入"已装备技能"区域。
- [√] 确认记忆点已使用值增加。
- [√] 点击卸下，确认该技能从"已装备技能"区域移除。
- [√] 确认卸下后记忆点恢复。

## 二、学习规则

- [√] 金钱不足时尝试学习，确认被阻止并弹出提示。
- [√] 前置条件不满足时尝试学习，确认被阻止并弹出提示。
- [√] 满足前置条件后再次学习，确认可以成功学习。
- [√] 将同一个技能从 Lv1 升到更高等级，确认已学等级正确递增。
- [√] 如果该技能处于已装备状态，继续学习更高等级后，确认已装备等级自动同步到当前最高等级。
- [√] 将一个技能学到 Lv5，确认技能习得中显示已满级，不能继续学习。

## 三、记忆点规则

- [√] 使用金手指把学识改为 0，确认记忆点上限为 0。
- [√] 使用金手指把学识改为 12，确认记忆点上限为 1。
- [√] 使用金手指把学识改为 28，确认记忆点上限为 2。
- [√] 使用金手指把学识改为 48，确认记忆点上限为 3。
- [√] 使用金手指把学识改为 100，确认记忆点上限为 5。
- [√] 使用金手指把学识改为 132，确认记忆点上限为 6。
- [√] 使用金手指把学识改为 300，确认记忆点上限为 10。
- [√] 装备多个技能后，确认记忆点使用值为各技能固定记忆点之和。
- [√] 记忆点不足时尝试装备新技能，确认被阻止。

## 四、界面一致性

- [√] 技能习得中只保留"等级详情"，不再出现单独"详情"按钮。
- [√] 技能管理的"已装备技能"区域只显示名称、等级、效果、记忆点、卸下按钮。
- [√] 技能管理的"已学技能"区域不显示等级切换器。
- [√] 技能管理的"已学技能"区域不显示不同等级不同记忆点的提示。
- [√] 未装备技能显示"装备"按钮；已装备技能显示状态提示或卸下按钮，不出现"替换等级"等旧按钮。

## 五、持久化

- [ ] 学习一个技能后刷新页面，确认已学状态保留。
- [ ] 装备一个技能后刷新页面，确认已装备状态保留。
- [ ] 刷新后再次打开查看技能，确认记忆点进度条与已装备列表一致。
- [ ] 刷新后再次进入技能习得，确认已学最高等级与下一可学等级正确。

## 六、战斗传参与触发

先打开浏览器控制台，过滤关键字：`[SkillTest]`。

推荐先执行：

1. `skillTestHelper.logParentSnapshot()`
2. `await skillTestHelper.injectBattleHelper()`
3. `await skillTestHelper.battleSnapshot()`
4. `await skillTestHelper.battleHelper().logSkillsByTiming()`

- [√] 装备 1 个技能后发起战斗，确认主界面控制台出现"准备传入战斗的技能数据"日志。
- [√] 进入战斗页后，确认战斗页控制台出现"解析战斗技能参数成功"日志。
- [√] 确认战斗页控制台出现"当前玩家技能列表"日志。
- [√] 确认每回合只在符合 triggerTiming 的时机打印对应技能触发日志。

### 第六项期望输出

- 主页面控制台能看到 `[SkillTest] showBattleGame 技能传参`。
- 战斗页控制台能看到 `[SkillTest] 解析战斗技能参数成功`。
- 战斗页控制台能看到 `[SkillTest] 当前玩家技能列表`。
- 使用 `skillTestHelper.battleHelper().logSkillsByTiming()` 时，返回结果里能按 `onGather`、`onDefend`、`onTauntHitDefend` 等分组。

## 七、16 个技能分批专项验证

### 操作总流程

```
步骤1：在主页面控制台执行 技能测试批次预设脚本.js
步骤2：执行 await skillBatchPresetHelper.setupBatch('A') 或 'B' / 'C'
步骤3：进入战斗后执行 技能系统测试辅助脚本.js 并跑对应批次测试
```

---

### 批次 A：绷急孝典乐 + 小梨飞刀 + 开山九式 + 冰川点穴手 + 灵狐剑法 + 连羽缠丝 + 百草心经

**装备：** 绷急孝典乐(1) + 小梨飞刀(2) + 开山九式(2) + 冰川点穴手(2) + 灵狐剑法(1) + 连羽缠丝(1) + 百草心经(1) = 10/10

**一键命令：** `await skillTestHelper.oneClick().runBatchA()`

期望输出：控制台出现 `console.table` 总表，13 行测试结果，`passed: true`。

#### 7.1 绷急孝典乐

单项命令：`await skillTestHelper.oneClick().tauntVsDefend()`

- [ ] 玩家嘴炮 + 对方防御 → 战斗日志出现追加伤害
- [ ] 控制台有 `[SkillTest] onTauntHitDefend 计算` 日志

#### 7.2 小梨飞刀

单项命令：`await skillTestHelper.oneClick().xiaoLiFeiDao()`

- [ ] 轻击命中集气目标 → 暗器追加伤害
- [ ] 轻击命中嘲讽目标 → 暗器追加伤害
- [ ] 敌人残血时追加伤害有残血加成
- [ ] 轻击命中防御目标 → **不触发**

#### 7.3 开山九式

单项命令：`await skillTestHelper.oneClick().kaiShanJiuShi()`

- [ ] 重击命中防御目标 → 破防追加伤害
- [ ] 重击克制轻击目标 → 追加伤害
- [ ] 重击命中集气目标 → **不触发**

#### 7.4 冰川点穴手

单项命令：`await skillTestHelper.oneClick().bingChuanDianXueShou()`

- [ ] 攻击命中集气目标 → 削减能量
- [ ] 敌人高能量时有高能量追加削气
- [ ] 攻击命中防御目标 → **不触发**削气

#### 7.5 灵狐剑法

单项命令：`await skillTestHelper.oneClick().lingHuJianFa()`

- [ ] 上回合攻击 + 本回合攻击命中 → 连斩追加伤害
- [ ] 上回合非攻击 + 本回合攻击 → **不触发**

#### 7.6 连羽缠丝

单项命令：`await skillTestHelper.oneClick().lianYuChanSi()`

- [ ] 重击命中集气目标 → 削减能量
- [ ] 重击命中嘲讽目标 → 削减能量
- [ ] 重击命中防御目标 → **不触发**

#### 7.7 百草心经

单项命令：`await skillTestHelper.oneClick().baiCaoXinJing()`

- [ ] 上回合非集气 + 本回合集气 → 恢复生命
- [ ] 上回合集气 + 本回合集气（连续集气） → **不触发**回血

---

### 批次 B：冰心诀 + 肉斩骨断 + 不动明王诀 + 猿臂拳 + 青鸟衔书

**装备：** 冰心诀(3) + 肉斩骨断(1) + 不动明王诀(2) + 猿臂拳(2) + 青鸟衔书(2) = 10/10

**一键命令：** `await skillTestHelper.oneClick().runBatchB()`

期望输出：控制台出现 `console.table` 总表，6 行测试结果，`passed: true`。

#### 7.8 冰心诀

单项命令：`await skillTestHelper.oneClick().gather()`

- [ ] 连续集气 → 额外获得能量
- [ ] 控制台有 `[SkillTest] onGather 计算` 日志

#### 7.9 肉斩骨断

单项命令：`await skillTestHelper.oneClick().compareSpecialDamage(0.2)`

- [ ] 满血使用绝招 → 绝招伤害提高 X%
- [ ] 残血使用绝招 → 绝招伤害提高 Y%（Y > X）
- [ ] 控制台有 `[SkillTest] onSpecialUse 计算` 日志

#### 7.10 不动明王诀

单项命令：`await skillTestHelper.oneClick().defendVsLightAttack()`

- [ ] 防御时 → 恢复生命
- [ ] 控制台有 `[SkillTest] onDefend 计算` 日志

#### 7.11 猿臂拳

单项命令：`await skillTestHelper.oneClick().yuanBiQuan()`

- [ ] 受伤时 → 以伤化力蓄力
- [ ] 蓄力后轻击 → 反击追加伤害

#### 7.12 青鸟衔书

单项命令：`await skillTestHelper.oneClick().qingNiaoXianShu()`

- [ ] 防御受击 → 回复能量
- [ ] 集气受击 → **不触发**
- [ ] 控制台有 `[SkillTest] onTakeDamage 计算` 日志

---

### 批次 C：霜雪葬花 + 无剑真意 + 天象示警 + 造化度厄针

**装备：** 霜雪葬花(3) + 无剑真意(3) + 天象示警(1) + 造化度厄针(3) = 10/10

**一键命令：** `await skillTestHelper.oneClick().runBatchC()`

期望输出：控制台出现 `console.table` 总表，9 行测试结果，`passed: true`。

#### 7.13 霜雪葬花

单项命令：`await skillTestHelper.oneClick().shuangXueZangHua()`

- [ ] 轻击命中集气目标 → 回复能量
- [ ] 轻击命中嘲讽目标 → 回复能量
- [ ] 轻击命中防御目标 → **不触发**

#### 7.14 无剑真意

单项命令：`await skillTestHelper.oneClick().wuJianZhenYiAccumulate()`

- [ ] 切换行动（上回合≠本回合） → 积累剑意
- [ ] 攻击命中 + 有剑意层 → 剑意爆发追加伤害
- [ ] 相同行动（上回合=本回合） → **不积层**

#### 7.15 天象示警

单项命令：`await skillTestHelper.oneClick().tianXiangShiJing()`

- [ ] 集气时被攻击 → 减免伤害
- [ ] 防御时被攻击 → **不触发**
- [ ] 控制台有 `[SkillTest] onTakeDamage 计算` 日志

#### 7.16 造化度厄针

单项命令：`await skillTestHelper.oneClick().zaoHuaDuEZhen()`

- [ ] 绝招命中 → 窃取能量（脚本会自动将敌人血量设高，防止秒杀）
- [ ] 轻击命中 → **不触发**
- [ ] 控制台有 `[SkillTest] onAttackHit` 相关日志

## 八、多技能组合

- [ ] 同时装备冰心诀和肉斩骨断（批次 B 已覆盖）。
- [ ] 非连续集气时，确认冰心诀不触发。
- [ ] 连续集气回合确认只触发冰心诀。
- [ ] 绝招回合确认只触发肉斩骨断。
- [ ] 同时装备不动明王诀和青鸟衔书，防御受击时确认两者都触发（回血 + 回气）。

## 九、回归检查

- [ ] 学习、装备、卸下流程没有引发其他普通弹窗层级错误。
- [ ] 小屏下技能习得和技能管理仍可正常滚动与操作。
- [ ] 古风和扁平两种 UI 下，技能弹窗都能正常操作。


不带场地效果（默认，推荐先用这个）：

刷新主页面
控制台粘贴执行 技能测试批次预设脚本.js
await skillBatchPresetHelper.setupBatch('A')
点击"切磋"进入战斗
控制台粘贴执行 技能系统测试辅助脚本.js
await skillTestHelper.injectBattleHelper()
await skillTestHelper.battleHelper().logSkillsByTiming() 确认不是 {}
await skillTestHelper.oneClick().runBatchA()
场地效果默认禁用，执行完看控制台最后的 ✅/❌ 总结框即可。

然后换批次 B/C 重复步骤 1-8（把 'A' 换成 'B'/'C'，命令换成 runBatchB()/runBatchC()）。