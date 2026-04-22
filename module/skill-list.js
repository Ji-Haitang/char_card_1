/**
 * skill-list.js - 战斗技能配置
 *
 * 结构说明：
 * - id: 唯一标识符（英文），用于存档和战斗传参
 * - name: 显示名称（中文）
 * - description: 技能总体描述（不随等级变化的风味文本）
 * - category: 分类标签，用于 UI 分组和筛选
 *     候选值: "攻击" | "防御" | "辅助" | "控制"
 * - memorySlots: 该技能装备后固定占用的记忆点数
 * - triggerTiming: 技能触发时机（战斗页面据此挂钩逻辑）
 * - levels: 长度为 5 的数组，索引 0~4 对应 Lv1~Lv5
 *     每级包含：
 *       cost        - 学习价格（金钱）
 *       requires    - 前置条件对象（与 special-event.js 的 conditions 格式一致）
 *       effectDesc  - 该等级效果的文字说明
 *       params      - 传入战斗页面的数值参数（键值对，具体含义由 triggerTiming 决定）
 *
 * 结算备注：
 * - 「主伤害前置乘算/修正」：技能效果先作用到本次攻击主伤害，再进入防御/格挡/穿甲/暴击等常规结算。
 *   当前代表：肉斩骨断（onSpecialUse）。
 * - 「真实伤害式后置追加」：主伤害先按常规结算完成，技能再以独立追加段直接扣除生命，
 *   不再经过防御/格挡/穿甲/暴击二次结算，体感更接近“真实伤害”。
 *   当前代表：绷急孝典乐、小梨飞刀、开山九式、猿臂拳、无剑真意。
 * - 「非伤害型修正」：技能效果主要表现为回血、回气、削气、减伤、反伤等，不属于上述两类追加伤害。
 *
 * triggerTiming 候选值：
 *   onTauntHitDefend - 嘲讽命中防御时
 *   onAttackHit      - 任意攻击（轻/重/绝招）命中时
 *   onDefend         - 选择防御时（回合结算阶段）
 *   onGather         - 选择集气时
 *   onTakeDamage     - 受到伤害时
 *   onSpecialUse     - 使用绝招时
 *   onBattleStart    - 战斗开始时
 *   onCrit           - 暴击触发时
 *   passive          - 被动常驻
 *
 * 依赖关系：
 * 无依赖，纯配置文件
 */

const skillList = {

    // ============================================================
    // 绷急孝典乐 —— 控制系 | onTauntHitDefend
    // 结算类型：真实伤害式后置追加
    // 嘲讽命中防御时，额外造成一次基于攻击力的伤害
    // 设计思路：奖励玩家精准读出对手防御的操作，让嘴炮不再只是
    // 功能性控制，而是附带惩罚伤害的进攻手段。
    // ============================================================
    beng_ji_xiao_dian_le: {
        id: "beng_ji_xiao_dian_le",
        name: "绷急孝典乐",
        description: "以言语刺激对手，令其因分神而露出破绽。嘲讽成功命中防御时，额外造成一次基于攻击力的伤害。",
        category: "控制",
        memorySlots: 1,
        triggerTiming: "onTauntHitDefend",
        levels: [
            {
                cost: 1000,
                requires: { "npcFavorability.G": { min: 15 } },
                effectDesc: "嘲讽命中防御时，额外造成 0.2 倍攻击力的伤害",
                params: { extraDamageRatio: 0.2 }
            },
            {
                cost: 1500,
                requires: {
                    "playerStats.声望": { min: 20 },
                    "npcFavorability.G": { min: 30 }
                },
                effectDesc: "嘲讽命中防御时，额外造成 0.4 倍攻击力的伤害",
                params: { extraDamageRatio: 0.4 }
            },
            {
                cost: 2500,
                requires: {
                    "playerStats.声望": { min: 50 },
                    "npcFavorability.G": { min: 45 }
                },
                effectDesc: "嘲讽命中防御时，额外造成 0.6 倍攻击力的伤害",
                params: { extraDamageRatio: 0.6 }
            },
            {
                cost: 4000,
                requires: {
                    "playerStats.声望": { min: 100 },
                    "npcFavorability.G": { min: 60 }
                },
                effectDesc: "嘲讽命中防御时，额外造成 0.8 倍攻击力的伤害",
                params: { extraDamageRatio: 0.8 }
            },
            {
                cost: 6000,
                requires: {
                    "playerStats.声望": { min: 160 },
                    "npcFavorability.G": { min: 75 }
                },
                effectDesc: "嘲讽命中防御时，额外造成 1.0 倍攻击力的伤害",
                params: { extraDamageRatio: 1.0 }
            }
        ]
    },

    // ============================================================
    // 冰心诀 —— 辅助系 | onGather
    // 结算类型：非伤害型修正（回气）
    // 仅在连续集气时额外获得能量
    // 设计思路：鼓励玩家维持稳定调息节奏，而不是任意插入一次
    // 集气就白拿收益。只有上一回合也是集气时，本回合集气才获得
    // 额外能量，更适合蓄势型打法。
    // ============================================================
    bin_xin_jue: {
        id: "bin_xin_jue",
        name: "冰心诀",
        description: "凝神守一，澄心静气。只有连续集气时，才能额外获得能量。",
        category: "辅助",
        memorySlots: 3,
        triggerTiming: "onGather",
        levels: [
            {
                cost: 4000,
                requires: { "npcFavorability.B": { min: 15 } },
                effectDesc: "连续集气时额外获得 0.2 点能量",
                params: { extraEnergy: 0.2 }
            },
            {
                cost: 6000,
                requires: {
                    "playerStats.学识": { min: 30 },
                    "npcFavorability.B": { min: 30 }
                },
                effectDesc: "连续集气时额外获得 0.4 点能量",
                params: { extraEnergy: 0.4 }
            },
            {
                cost: 9000,
                requires: {
                    "playerStats.学识": { min: 70 },
                    "npcFavorability.B": { min: 45 }
                },
                effectDesc: "连续集气时额外获得 0.6 点能量",
                params: { extraEnergy: 0.6 }
            },
            {
                cost: 15000,
                requires: {
                    "playerStats.学识": { min: 120 },
                    "npcFavorability.B": { min: 60 }
                },
                effectDesc: "连续集气时额外获得 0.8 点能量",
                params: { extraEnergy: 0.8 }
            },
            {
                cost: 25000,
                requires: {
                    "playerStats.学识": { min: 180 },
                    "npcFavorability.B": { min: 75 }
                },
                effectDesc: "连续集气时额外获得 1.0 点能量",
                params: { extraEnergy: 1.0 }
            }
        ]
    },

    // ============================================================
    // 肉斩骨断 —— 攻击系 | onSpecialUse
    // 结算类型：主伤害前置乘算/修正
    // 使用绝招时，根据已损失生命比例获得额外伤害倍率
    // 设计思路：绝招花5气且一般在关键时刻使用，此技能奖励"背水
    // 一战"的冒险——血越少绝招越痛。最高等级满血时也有基础加成。
    // params.baseBonusRatio: 无论血量多少都有的基础加成
    // params.maxBonusRatio: 残血时的最大额外加成（线性插值）
    // 实际倍率 = baseBonusRatio + maxBonusRatio × (1 - 当前HP/最大HP)
    // ============================================================
    rou_zhan_gu_duan: {
        id: "rou_zhan_gu_duan",
        name: "肉斩骨断",
        description: "置之死地而后生。使用绝招时，生命值越低，造成的伤害越高。",
        category: "攻击",
        memorySlots: 1,
        triggerTiming: "onSpecialUse",
        levels: [
            {
                cost: 1000,
                requires: {
                    "playerStats.武学": { min: 20 },
                    "npcFavorability.I": { min: 15 }
                },
                effectDesc: "绝招伤害 +0~15%（根据已损失生命比例）",
                params: { baseBonusRatio: 0, maxBonusRatio: 0.15 }
            },
            {
                cost: 1500,
                requires: {
                    "playerStats.武学": { min: 50 },
                    "npcFavorability.I": { min: 30 }
                },
                effectDesc: "绝招伤害 +5%~25%（根据已损失生命比例）",
                params: { baseBonusRatio: 0.05, maxBonusRatio: 0.25 }
            },
            {
                cost: 2500,
                requires: {
                    "playerStats.武学": { min: 90 },
                    "npcFavorability.I": { min: 45 }
                },
                effectDesc: "绝招伤害 +10%~40%（根据已损失生命比例）",
                params: { baseBonusRatio: 0.10, maxBonusRatio: 0.40 }
            },
            {
                cost: 4000,
                requires: {
                    "playerStats.武学": { min: 140 },
                    "npcFavorability.I": { min: 60 }
                },
                effectDesc: "绝招伤害 +15%~60%（根据已损失生命比例）",
                params: { baseBonusRatio: 0.15, maxBonusRatio: 0.60 }
            },
            {
                cost: 6000,
                requires: {
                    "playerStats.武学": { min: 200 },
                    "npcFavorability.I": { min: 75 }
                },
                effectDesc: "绝招伤害 +20%~80%（根据已损失生命比例）",
                params: { baseBonusRatio: 0.20, maxBonusRatio: 0.80 }
            }
        ]
    },

    // ============================================================
    // 不动明王诀 —— 防御系 | onDefend
    // 结算类型：非伤害型修正（回血）
    // 选择防御时，回复一定比例的最大生命值
    // 设计思路：原版防御只减伤不回血，此技能让防御变成一个主动
    // 回血手段，鼓励玩家在合适时机选择防御而非一味进攻。
    // ============================================================
    tie_bu_shan: {
        id: "tie_bu_shan",
        name: "不动明王诀",
        description: "金钟罩不动明王诀，防御时凝聚内力修复伤势。选择防御时，回复一定比例的最大生命值。",
        category: "防御",
        memorySlots: 2,
        triggerTiming: "onDefend",
        levels: [
            {
                cost: 1500,
                requires: { "npcFavorability.G": { min: 15 } },
                effectDesc: "防御时回复 2.25% 最大生命值",
                params: { healRatio: 0.0225 }
            },
            {
                cost: 2500,
                requires: {
                    "playerStats.武学": { min: 30 },
                    "npcFavorability.G": { min: 30 }
                },
                effectDesc: "防御时回复 3.75% 最大生命值",
                params: { healRatio: 0.0375 }
            },
            {
                cost: 4000,
                requires: {
                    "playerStats.武学": { min: 60 },
                    "npcFavorability.G": { min: 45 }
                },
                effectDesc: "防御时回复 5.25% 最大生命值",
                params: { healRatio: 0.0525 }
            },
            {
                cost: 6000,
                requires: {
                    "playerStats.武学": { min: 110 },
                    "npcFavorability.G": { min: 60 }
                },
                effectDesc: "防御时回复 6.75% 最大生命值",
                params: { healRatio: 0.0675 }
            },
            {
                cost: 9000,
                requires: {
                    "playerStats.武学": { min: 170 },
                    "npcFavorability.G": { min: 75 }
                },
                effectDesc: "防御时回复 8.25% 最大生命值",
                params: { healRatio: 0.0825 }
            }
        ]
    },

    // ============================================================
    // 小梨飞刀 —— 攻击系 | onAttackHit
    // 结算类型：真实伤害式后置追加
    // 轻击命中正在集气或嘲讽的目标时，追加暗器伤害
    // 设计思路：趁敌人无防备时乘虚而入。残血目标追加伤害更高。
    // 触发条件：玩家轻击命中 + 目标本回合选择集气或嘲讽
    // 追加伤害 = basicDamage × extraDamageRatio × lowHealthBonusMultiplier
    // ============================================================
    xiao_li_fei_dao: {
        id: "xiao_li_fei_dao",
        name: "小梨飞刀",
        description: "唐门暗器绝技，趁敌人集气或嘴炮的空隙，暗器乘虚而入。目标残血时伤害更高。",
        category: "攻击",
        memorySlots: 2,
        triggerTiming: "onAttackHit",
        levels: [
            {
                cost: 1500,
                requires: { "npcFavorability.J": { min: 15 } },
                effectDesc: "轻击命中集气/嘲讽目标时，追加 0.12 倍攻击力伤害（残血 ×1.3）",
                params: { extraDamageRatio: 0.12, lowHealthBonusMultiplier: 1.3, requireLightAttack: true, requireTargetGatherOrTaunt: true }
            },
            {
                cost: 2500,
                requires: {
                    "playerStats.武学": { min: 25 },
                    "npcFavorability.J": { min: 30 }
                },
                effectDesc: "轻击命中集气/嘲讽目标时，追加 0.2 倍攻击力伤害（残血 ×1.35）",
                params: { extraDamageRatio: 0.2, lowHealthBonusMultiplier: 1.35, requireLightAttack: true, requireTargetGatherOrTaunt: true }
            },
            {
                cost: 4000,
                requires: {
                    "playerStats.武学": { min: 55 },
                    "npcFavorability.J": { min: 45 }
                },
                effectDesc: "轻击命中集气/嘲讽目标时，追加 0.28 倍攻击力伤害（残血 ×1.4）",
                params: { extraDamageRatio: 0.28, lowHealthBonusMultiplier: 1.4, requireLightAttack: true, requireTargetGatherOrTaunt: true }
            },
            {
                cost: 6000,
                requires: {
                    "playerStats.武学": { min: 100 },
                    "npcFavorability.J": { min: 60 }
                },
                effectDesc: "轻击命中集气/嘲讽目标时，追加 0.336 倍攻击力伤害（残血 ×1.5）",
                params: { extraDamageRatio: 0.336, lowHealthBonusMultiplier: 1.5, requireLightAttack: true, requireTargetGatherOrTaunt: true }
            },
            {
                cost: 9000,
                requires: {
                    "playerStats.武学": { min: 160 },
                    "npcFavorability.J": { min: 75 }
                },
                effectDesc: "轻击命中集气/嘲讽目标时，追加 0.4 倍攻击力伤害（残血 ×1.6）",
                params: { extraDamageRatio: 0.4, lowHealthBonusMultiplier: 1.6, requireLightAttack: true, requireTargetGatherOrTaunt: true }
            }
        ]
    },

    // ============================================================
    // 开山九式 —— 攻击系 | onAttackHit
    // 结算类型：真实伤害式后置追加
    // 重击命中防御中的目标 或 重击克制对方轻击时，追加伤害
    // 设计思路：大开大合的斧法，破防或以重压轻时更强。
    // 触发条件：玩家重击命中 + (目标防御 或 目标轻击被克制)
    // 追加伤害 = basicDamage × extraDamageRatio × defendBonusMultiplier
    // ============================================================
    kai_shan_jiu_shi: {
        id: "kai_shan_jiu_shi",
        name: "开山九式",
        description: "钱塘君传授的斧法，大开大合，威力惊人。重击破防或克制轻击时追加伤害。",
        category: "攻击",
        memorySlots: 2,
        triggerTiming: "onAttackHit",
        levels: [
            {
                cost: 1500,
                requires: { "npcFavorability.C": { min: 15 } },
                effectDesc: "重击克制/破防时，追加 0.3 倍攻击力伤害（破防 ×1.5）",
                params: { extraDamageRatio: 0.3, defendBonusMultiplier: 1.5, requireHeavyAttack: true, requireTargetDefendOrCountered: true }
            },
            {
                cost: 2500,
                requires: {
                    "playerStats.武学": { min: 30 },
                    "npcFavorability.C": { min: 30 }
                },
                effectDesc: "重击克制/破防时，追加 0.5 倍攻击力伤害（破防 ×1.5）",
                params: { extraDamageRatio: 0.5, defendBonusMultiplier: 1.5, requireHeavyAttack: true, requireTargetDefendOrCountered: true }
            },
            {
                cost: 4000,
                requires: {
                    "playerStats.武学": { min: 65 },
                    "npcFavorability.C": { min: 45 }
                },
                effectDesc: "重击克制/破防时，追加 0.7 倍攻击力伤害（破防 ×1.5）",
                params: { extraDamageRatio: 0.7, defendBonusMultiplier: 1.5, requireHeavyAttack: true, requireTargetDefendOrCountered: true }
            },
            {
                cost: 6000,
                requires: {
                    "playerStats.武学": { min: 110 },
                    "npcFavorability.C": { min: 60 }
                },
                effectDesc: "重击克制/破防时，追加 0.84 倍攻击力伤害（破防 ×1.5）",
                params: { extraDamageRatio: 0.84, defendBonusMultiplier: 1.5, requireHeavyAttack: true, requireTargetDefendOrCountered: true }
            },
            {
                cost: 9000,
                requires: {
                    "playerStats.武学": { min: 170 },
                    "npcFavorability.C": { min: 75 }
                },
                effectDesc: "重击克制/破防时，追加 1.0 倍攻击力伤害（破防 ×1.5）",
                params: { extraDamageRatio: 1.0, defendBonusMultiplier: 1.5, requireHeavyAttack: true, requireTargetDefendOrCountered: true }
            }
        ]
    },

    // ============================================================
    // 冰川点穴手 —— 控制系 | onAttackHit
    // 结算类型：非伤害型修正（削气）
    // 攻击命中正在集气的目标时，削减其能量
    // 设计思路：精准打穴，扰乱对方蓄力节奏。
    // 触发条件：玩家任意攻击命中 + 目标本回合选择集气
    // 基础削气 fixedEnergyLoss + 高能量追加 extraEnergyLoss
    // ============================================================
    bing_chuan_dian_xue_shou: {
        id: "bing_chuan_dian_xue_shou",
        name: "冰川点穴手",
        description: "洞庭君执法专用点穴手法，打断对手蓄力，精准削减能量。",
        category: "控制",
        memorySlots: 2,
        triggerTiming: "onAttackHit",
        levels: [
            {
                cost: 1500,
                requires: { "npcFavorability.B": { min: 20 } },
                effectDesc: "攻击命中集气目标时，削气 0.3（目标气≥5 再削 0.1）",
                params: { fixedEnergyLoss: 0.3, extraEnergyLoss: 0.1, highEnergyThreshold: 5, requireTargetGather: true }
            },
            {
                cost: 2500,
                requires: {
                    "playerStats.学识": { min: 35 },
                    "npcFavorability.B": { min: 35 }
                },
                effectDesc: "攻击命中集气目标时，削气 0.5（目标气≥5 再削 0.2）",
                params: { fixedEnergyLoss: 0.5, extraEnergyLoss: 0.2, highEnergyThreshold: 5, requireTargetGather: true }
            },
            {
                cost: 4000,
                requires: {
                    "playerStats.学识": { min: 75 },
                    "npcFavorability.B": { min: 50 }
                },
                effectDesc: "攻击命中集气目标时，削气 0.7（目标气≥5 再削 0.3）",
                params: { fixedEnergyLoss: 0.7, extraEnergyLoss: 0.3, highEnergyThreshold: 5, requireTargetGather: true }
            },
            {
                cost: 6000,
                requires: {
                    "playerStats.学识": { min: 125 },
                    "npcFavorability.B": { min: 65 }
                },
                effectDesc: "攻击命中集气目标时，削气 0.85（目标气≥5 再削 0.4）",
                params: { fixedEnergyLoss: 0.85, extraEnergyLoss: 0.4, highEnergyThreshold: 5, requireTargetGather: true }
            },
            {
                cost: 9000,
                requires: {
                    "playerStats.学识": { min: 185 },
                    "npcFavorability.B": { min: 80 }
                },
                effectDesc: "攻击命中集气目标时，削气 1.0（目标气≥5 再削 0.5）",
                params: { fixedEnergyLoss: 1.0, extraEnergyLoss: 0.5, highEnergyThreshold: 5, requireTargetGather: true }
            }
        ]
    },

    // ============================================================
    // 猿臂拳 —— 攻击系 | onTakeDamage
    // 结算类型：真实伤害式后置追加（受击先挂 buff，命中后独立追伤）
    // 受到伤害后，下次轻击或重击命中时追加伤害
    // 设计思路：以伤化力，受击后反打更猛。
    // 触发条件：上回合受伤 → 本回合轻击/重击命中
    // 追加伤害 = basicDamage × nextAttackBonusRatio
    // ============================================================
    yuan_bi_quan: {
        id: "yuan_bi_quan",
        name: "猿臂拳",
        description: "破阵子传授的拳法，即使空手也毫不逊色。受伤后蓄力反击，下次攻击追加伤害。",
        category: "攻击",
        memorySlots: 2,
        triggerTiming: "onTakeDamage",
        levels: [
            {
                cost: 1500,
                requires: { "npcFavorability.A": { min: 15 } },
                effectDesc: "受伤后下次攻击追加 0.2 倍攻击力伤害",
                params: { nextAttackBonusRatio: 0.2 }
            },
            {
                cost: 2500,
                requires: {
                    "playerStats.武学": { min: 30 },
                    "npcFavorability.A": { min: 30 }
                },
                effectDesc: "受伤后下次攻击追加 0.27 倍攻击力伤害",
                params: { nextAttackBonusRatio: 0.27 }
            },
            {
                cost: 4000,
                requires: {
                    "playerStats.武学": { min: 65 },
                    "npcFavorability.A": { min: 45 }
                },
                effectDesc: "受伤后下次攻击追加 0.33 倍攻击力伤害",
                params: { nextAttackBonusRatio: 0.33 }
            },
            {
                cost: 6000,
                requires: {
                    "playerStats.武学": { min: 110 },
                    "npcFavorability.A": { min: 60 }
                },
                effectDesc: "受伤后下次攻击追加 0.4 倍攻击力伤害",
                params: { nextAttackBonusRatio: 0.4 }
            },
            {
                cost: 9000,
                requires: {
                    "playerStats.武学": { min: 170 },
                    "npcFavorability.A": { min: 75 }
                },
                effectDesc: "受伤后下次攻击追加 0.45 倍攻击力伤害",
                params: { nextAttackBonusRatio: 0.45 }
            }
        ]
    },

    // ============================================================
    // 归义剑诀 —— 辅助系 | onAttackHit
    // 结算类型：非伤害型修正（回气）
    // 轻击命中正在集气或嘲讽的目标时，回复能量
    // 设计思路：以精妙剑势化力为气，趁隙调息。
    // 触发条件：玩家轻击命中 + 目标本回合选择集气或嘲讽
    // 回气量 = energyRecoveryRatio（固定值，不乘任何系数）
    // ============================================================
    gui_yi_jian_jue: {
        id: "gui_yi_jian_jue",
        name: "霜雪葬花",
        description: "苓雪妃精研的剑法，轻击命中集气或嘲讽中的对手时，以精妙剑势化力为气，回复能量。",
        category: "辅助",
        memorySlots: 3,
        triggerTiming: "onAttackHit",
        levels: [
            {
                cost: 4000,
                requires: { "npcFavorability.O": { min: 20 } },
                effectDesc: "轻击命中集气/嘲讽目标时，回复 0.8 点能量",
                params: { energyRecoveryRatio: 0.8, requireLightAttack: true, requireTargetGatherOrTaunt: true }
            },
            {
                cost: 6000,
                requires: {
                    "playerStats.武学": { min: 40 },
                    "npcFavorability.O": { min: 35 }
                },
                effectDesc: "轻击命中集气/嘲讽目标时，回复 1.1 点能量",
                params: { energyRecoveryRatio: 1.1, requireLightAttack: true, requireTargetGatherOrTaunt: true }
            },
            {
                cost: 9000,
                requires: {
                    "playerStats.武学": { min: 80 },
                    "npcFavorability.O": { min: 50 }
                },
                effectDesc: "轻击命中集气/嘲讽目标时，回复 1.4 点能量",
                params: { energyRecoveryRatio: 1.4, requireLightAttack: true, requireTargetGatherOrTaunt: true }
            },
            {
                cost: 15000,
                requires: {
                    "playerStats.武学": { min: 130 },
                    "npcFavorability.O": { min: 65 }
                },
                effectDesc: "轻击命中集气/嘲讽目标时，回复 1.7 点能量",
                params: { energyRecoveryRatio: 1.7, requireLightAttack: true, requireTargetGatherOrTaunt: true }
            },
            {
                cost: 25000,
                requires: {
                    "playerStats.武学": { min: 190 },
                    "npcFavorability.O": { min: 80 }
                },
                effectDesc: "轻击命中集气/嘲讽目标时，回复 2.0 点能量",
                params: { energyRecoveryRatio: 2.0, requireLightAttack: true, requireTargetGatherOrTaunt: true }
            }
        ]
    },

    // ============================================================
    // 无剑真意 —— 辅助系 | passive
    // 结算类型：真实伤害式后置追加（积层后命中独立爆发）
    // 行动轮转时积累剑意层，攻击命中时消耗全部剑意追加伤害
    // 设计思路：操作型技能，奖励切换行动的灵活打法。
    // 触发条件：本回合行动与上回合不同 → +1层剑意 → 攻击命中消耗
    // 追加伤害 = basicDamage × perStackDamageRatio × 剑意层数
    // ============================================================
    wu_jian_zhen_yi: {
        id: "wu_jian_zhen_yi",
        name: "无剑真意",
        description: "姬姒的无剑境界，木棒筷子皆可使剑法。变换招式积蓄剑意，攻击命中时爆发。",
        category: "辅助",
        memorySlots: 3,
        triggerTiming: "passive",
        levels: [
            {
                cost: 4000,
                requires: { "npcFavorability.E": { min: 20 } },
                effectDesc: "切换行动积 1 层剑意（最多 2 层），攻击命中时每层追加 0.1 倍攻击力",
                params: { perStackDamageRatio: 0.1, maxStacks: 2 }
            },
            {
                cost: 6000,
                requires: {
                    "playerStats.学识": { min: 35 },
                    "npcFavorability.E": { min: 35 }
                },
                effectDesc: "切换行动积 1 层剑意（最多 2 层），攻击命中时每层追加 0.14 倍攻击力",
                params: { perStackDamageRatio: 0.14, maxStacks: 2 }
            },
            {
                cost: 9000,
                requires: {
                    "playerStats.学识": { min: 75 },
                    "npcFavorability.E": { min: 50 }
                },
                effectDesc: "切换行动积 1 层剑意（最多 3 层），攻击命中时每层追加 0.18 倍攻击力",
                params: { perStackDamageRatio: 0.18, maxStacks: 3 }
            },
            {
                cost: 15000,
                requires: {
                    "playerStats.学识": { min: 125 },
                    "npcFavorability.E": { min: 65 }
                },
                effectDesc: "切换行动积 1 层剑意（最多 3 层），攻击命中时每层追加 0.22 倍攻击力",
                params: { perStackDamageRatio: 0.22, maxStacks: 3 }
            },
            {
                cost: 25000,
                requires: {
                    "playerStats.学识": { min: 185 },
                    "npcFavorability.E": { min: 80 }
                },
                effectDesc: "切换行动积 1 层剑意（最多 3 层），攻击命中时每层追加 0.25 倍攻击力",
                params: { perStackDamageRatio: 0.25, maxStacks: 3 }
            }
        ]
    },

    // ============================================================
    // 灵狐剑法 —— 攻击系 | onAttackHit
    // 结算类型：真实伤害式后置追加
    // 攻击命中且上回合也是攻击时，追加一段伤害
    // ============================================================
    ling_hu_lian_zhan: {
        id: "ling_hu_lian_zhan",
        name: "灵狐剑法",
        description: "萧白瑚自创的灵狐剑法，招式跳脱灵动，连续进攻时越打越顺。",
        category: "攻击",
        memorySlots: 1,
        triggerTiming: "onAttackHit",
        levels: [
            {
                cost: 1000,
                requires: { "npcFavorability.D": { min: 15 } },
                effectDesc: "连续攻击命中时，追加 0.32 倍攻击力伤害",
                params: { extraDamageRatio: 0.32, requireConsecutiveAttack: true }
            },
            {
                cost: 1500,
                requires: {
                    "playerStats.武学": { min: 25 },
                    "npcFavorability.D": { min: 30 }
                },
                effectDesc: "连续攻击命中时，追加 0.56 倍攻击力伤害",
                params: { extraDamageRatio: 0.56, requireConsecutiveAttack: true }
            },
            {
                cost: 2500,
                requires: {
                    "playerStats.武学": { min: 55 },
                    "npcFavorability.D": { min: 45 }
                },
                effectDesc: "连续攻击命中时，追加 0.8 倍攻击力伤害",
                params: { extraDamageRatio: 0.8, requireConsecutiveAttack: true }
            },
            {
                cost: 4000,
                requires: {
                    "playerStats.武学": { min: 100 },
                    "npcFavorability.D": { min: 60 }
                },
                effectDesc: "连续攻击命中时，追加 0.96 倍攻击力伤害",
                params: { extraDamageRatio: 0.96, requireConsecutiveAttack: true }
            },
            {
                cost: 6000,
                requires: {
                    "playerStats.武学": { min: 160 },
                    "npcFavorability.D": { min: 75 }
                },
                effectDesc: "连续攻击命中时，追加 1.12 倍攻击力伤害",
                params: { extraDamageRatio: 1.12, requireConsecutiveAttack: true }
            }
        ]
    },

    // ============================================================
    // 万卷归宗 —— 辅助系 | onTakeDamage
    // 结算类型：非伤害型修正（防御受击回气）
    // ============================================================
    wan_juan_gui_zong: {
        id: "wan_juan_gui_zong",
        name: "青鸟衔书",
        description: "施延年通晓天山典籍，防御受击时能借势调息，将被动守势化为内力积蓄。",
        category: "辅助",
        memorySlots: 2,
        triggerTiming: "onTakeDamage",
        levels: [
            {
                cost: 1500,
                requires: { "npcFavorability.F": { min: 15 } },
                effectDesc: "防御受击时，回复 0.25 点能量",
                params: { energyRecovery: 0.25, requirePlayerDefending: true }
            },
            {
                cost: 2500,
                requires: {
                    "playerStats.学识": { min: 25 },
                    "npcFavorability.F": { min: 30 }
                },
                effectDesc: "防御受击时，回复 0.4 点能量",
                params: { energyRecovery: 0.4, requirePlayerDefending: true }
            },
            {
                cost: 4000,
                requires: {
                    "playerStats.学识": { min: 55 },
                    "npcFavorability.F": { min: 45 }
                },
                effectDesc: "防御受击时，回复 0.55 点能量",
                params: { energyRecovery: 0.55, requirePlayerDefending: true }
            },
            {
                cost: 6000,
                requires: {
                    "playerStats.学识": { min: 100 },
                    "npcFavorability.F": { min: 60 }
                },
                effectDesc: "防御受击时，回复 0.7 点能量",
                params: { energyRecovery: 0.7, requirePlayerDefending: true }
            },
            {
                cost: 9000,
                requires: {
                    "playerStats.学识": { min: 160 },
                    "npcFavorability.F": { min: 75 }
                },
                effectDesc: "防御受击时，回复 0.8 点能量",
                params: { energyRecovery: 0.8, requirePlayerDefending: true }
            }
        ]
    },

    // ============================================================
    // 连羽缠丝 —— 控制系 | onAttackHit
    // 结算类型：非伤害型修正（削气）
    // ============================================================
    lian_yu_chan_si: {
        id: "lian_yu_chan_si",
        name: "连羽缠丝",
        description: "雨烛的连羽索法柔中带刚，重击趁虚而入时能缠住对手经脉，打断其节奏。",
        category: "控制",
        memorySlots: 1,
        triggerTiming: "onAttackHit",
        levels: [
            {
                cost: 1000,
                requires: { "npcFavorability.H": { min: 15 } },
                effectDesc: "重击命中非防御、非绝招目标时，削减 0.3 点能量",
                params: { energyDrain: 0.3, requireHeavyAttack: true, requireTargetNonDefendOrSpecial: true }
            },
            {
                cost: 1500,
                requires: {
                    "playerStats.武学": { min: 25 },
                    "npcFavorability.H": { min: 30 }
                },
                effectDesc: "重击命中非防御、非绝招目标时，削减 0.45 点能量",
                params: { energyDrain: 0.45, requireHeavyAttack: true, requireTargetNonDefendOrSpecial: true }
            },
            {
                cost: 2500,
                requires: {
                    "playerStats.武学": { min: 55 },
                    "npcFavorability.H": { min: 45 }
                },
                effectDesc: "重击命中非防御、非绝招目标时，削减 0.6 点能量",
                params: { energyDrain: 0.6, requireHeavyAttack: true, requireTargetNonDefendOrSpecial: true }
            },
            {
                cost: 4000,
                requires: {
                    "playerStats.武学": { min: 100 },
                    "npcFavorability.H": { min: 60 }
                },
                effectDesc: "重击命中非防御、非绝招目标时，削减 0.75 点能量",
                params: { energyDrain: 0.75, requireHeavyAttack: true, requireTargetNonDefendOrSpecial: true }
            },
            {
                cost: 6000,
                requires: {
                    "playerStats.武学": { min: 160 },
                    "npcFavorability.H": { min: 75 }
                },
                effectDesc: "重击命中非防御、非绝招目标时，削减 0.9 点能量",
                params: { energyDrain: 0.9, requireHeavyAttack: true, requireTargetNonDefendOrSpecial: true }
            }
        ]
    },

    // ============================================================
    // 天象示警 —— 防御系 | onTakeDamage
    // 结算类型：非伤害型修正（集气受击减伤）
    // ============================================================
    tian_xiang_shi_jing: {
        id: "tian_xiang_shi_jing",
        name: "天象示警",
        description: "洛潜幽天生敏于星象，在集气时若遭突袭，会本能预警并提前规避部分伤害。",
        category: "防御",
        memorySlots: 1,
        triggerTiming: "onTakeDamage",
        levels: [
            {
                cost: 1000,
                requires: { "npcFavorability.K": { min: 20 } },
                effectDesc: "集气受击时，减免 8% 伤害",
                params: { gatherDamageReduction: 0.08, requirePlayerGathering: true }
            },
            {
                cost: 1500,
                requires: {
                    "playerStats.学识": { min: 35 },
                    "npcFavorability.K": { min: 35 }
                },
                effectDesc: "集气受击时，减免 12% 伤害",
                params: { gatherDamageReduction: 0.12, requirePlayerGathering: true }
            },
            {
                cost: 2500,
                requires: {
                    "playerStats.学识": { min: 75 },
                    "npcFavorability.K": { min: 50 }
                },
                effectDesc: "集气受击时，减免 16% 伤害",
                params: { gatherDamageReduction: 0.16, requirePlayerGathering: true }
            },
            {
                cost: 4000,
                requires: {
                    "playerStats.学识": { min: 125 },
                    "npcFavorability.K": { min: 65 }
                },
                effectDesc: "集气受击时，减免 20% 伤害",
                params: { gatherDamageReduction: 0.20, requirePlayerGathering: true }
            },
            {
                cost: 6000,
                requires: {
                    "playerStats.学识": { min: 185 },
                    "npcFavorability.K": { min: 80 }
                },
                effectDesc: "集气受击时，减免 25% 伤害",
                params: { gatherDamageReduction: 0.25, requirePlayerGathering: true }
            }
        ]
    },

    // ============================================================
    // 造化度厄针 —— 控制系 | onAttackHit
    // 结算类型：非伤害型修正（窃气）
    // ============================================================
    zao_hua_du_e_zhen: {
        id: "zao_hua_du_e_zhen",
        name: "造化度厄针",
        description: "玄天青的针法无声封穴，绝招命中时可窃夺对手气脉，化为己用。",
        category: "控制",
        memorySlots: 3,
        triggerTiming: "onAttackHit",
        levels: [
            {
                cost: 4000,
                requires: { "npcFavorability.M": { min: 20 } },
                effectDesc: "绝招命中时，窃取 0.45 点能量",
                params: { energySteal: 0.45, requireSpecialAttack: true }
            },
            {
                cost: 6000,
                requires: {
                    "playerStats.学识": { min: 35 },
                    "npcFavorability.M": { min: 35 }
                },
                effectDesc: "绝招命中时，窃取 0.75 点能量",
                params: { energySteal: 0.75, requireSpecialAttack: true }
            },
            {
                cost: 9000,
                requires: {
                    "playerStats.学识": { min: 75 },
                    "npcFavorability.M": { min: 50 }
                },
                effectDesc: "绝招命中时，窃取 1.05 点能量",
                params: { energySteal: 1.05, requireSpecialAttack: true }
            },
            {
                cost: 15000,
                requires: {
                    "playerStats.学识": { min: 125 },
                    "npcFavorability.M": { min: 65 }
                },
                effectDesc: "绝招命中时，窃取 1.26 点能量",
                params: { energySteal: 1.26, requireSpecialAttack: true }
            },
            {
                cost: 25000,
                requires: {
                    "playerStats.学识": { min: 185 },
                    "npcFavorability.M": { min: 80 }
                },
                effectDesc: "绝招命中时，窃取 1.5 点能量",
                params: { energySteal: 1.5, requireSpecialAttack: true }
            }
        ]
    },

    // ============================================================
    // 百草心经 —— 防御系 | onGather
    // 结算类型：非伤害型修正（非连续集气回血）
    // ============================================================
    bai_cao_xin_jing: {
        id: "bai_cao_xin_jing",
        name: "百草心经",
        description: "鹿椿若精于药理，调息时百草药性自发流转。非连续集气时可顺势恢复伤势。",
        category: "防御",
        memorySlots: 1,
        triggerTiming: "onGather",
        levels: [
            {
                cost: 1000,
                requires: { "npcFavorability.N": { min: 15 } },
                effectDesc: "非连续集气时，回复 1.5% 最大生命值",
                params: { healRatio: 0.015, requireNonConsecutiveGather: true }
            },
            {
                cost: 1500,
                requires: {
                    "playerStats.学识": { min: 25 },
                    "npcFavorability.N": { min: 30 }
                },
                effectDesc: "非连续集气时，回复 2.5% 最大生命值",
                params: { healRatio: 0.025, requireNonConsecutiveGather: true }
            },
            {
                cost: 2500,
                requires: {
                    "playerStats.学识": { min: 55 },
                    "npcFavorability.N": { min: 45 }
                },
                effectDesc: "非连续集气时，回复 3.5% 最大生命值",
                params: { healRatio: 0.035, requireNonConsecutiveGather: true }
            },
            {
                cost: 4000,
                requires: {
                    "playerStats.学识": { min: 100 },
                    "npcFavorability.N": { min: 60 }
                },
                effectDesc: "非连续集气时，回复 4.25% 最大生命值",
                params: { healRatio: 0.0425, requireNonConsecutiveGather: true }
            },
            {
                cost: 6000,
                requires: {
                    "playerStats.学识": { min: 160 },
                    "npcFavorability.N": { min: 75 }
                },
                effectDesc: "非连续集气时，回复 5% 最大生命值",
                params: { healRatio: 0.05, requireNonConsecutiveGather: true }
            }
        ]
    }

};
