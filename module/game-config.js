/**
 * game-config.js - 游戏配置文件
 * 
 * 文件概述：
 * 包含游戏的所有静态配置数据，如数值范围、NPC信息、地点名称、概率配置等。
 * 这是一个纯配置文件，不包含任何逻辑函数，其他模块会引用这些配置。
 * 
 * 主要内容：
 * - valueRanges: 各项数值的最小值和最大值范围定义
 * - locationNames: 地点ID到中文名称的映射
 * - npcs: NPC基本信息（名字、描述、头像ID）
 * - npcNameToId: NPC名字到ID的映射表
 * - npcPortraits: NPC立绘图片URL映射
 * - locationBackgrounds: 地点背景图URL映射
 * - actionConfigs: 各种行动的配置（天赋加成、影响属性）
 * - npcLocationProbability: NPC在各地点出现的概率配置
 * - defaultGameData: 游戏初始数据
 * 
 * 对外暴露的主要变量：
 * - valueRanges: 用于数值范围检查
 * - locationNames: 用于显示地点中文名
 * - npcs/npcNameToId/npcPortraits: 用于NPC相关功能
 * - actionConfigs: 用于计算行动结果
 * - defaultGameData: 用于初始化游戏数据
 * 
 * 依赖关系：
 * 无依赖，是最底层的配置文件
 */

// 数值范围定义
const valueRanges = {
    playerTalents: {
        根骨: { min: 0, max: 100 },
        悟性: { min: 0, max: 100 },
        心性: { min: 0, max: 100 },
        魅力: { min: 0, max: 100 }
    },
    playerStats: {
        武学: { min: 0, max: 300 },
        学识: { min: 0, max: 300 },
        声望: { min: 0, max: 300 },
        金钱: { min: 0, max: 999999 }
    },
    combatStats: {
        攻击力: { min: 10, max: 300 },
        生命值: { min: 25, max: 600 }
    },
    playerMood: { min: 0, max: 100 },
    npcFavorability: { min: 0, max: 100 },
    actionPoints: { min: 0, max: 3 },
    currentWeek: { min: 1, max: 9999 }
};

// 地点名称映射
const locationNames = {
    yanwuchang: '演武场',
    cangjingge: '藏经阁',
    huofang: '伙房',
    houshan: '后山',
    yishiting: '议事厅',
    tiejiangpu: '铁匠铺',
    nandizi: '男弟子房',
    nvdizi: '女弟子房',
    shanmen: '山门',
    tianshanpai: '天山派',
    none: 'none'
};

// NPC定义
const npcs = {
    A: {
        name: "破阵子",
        description: "天山派外务长老，西域义军统领，呼延显的师父。<br>34岁回鹘族人，身材高大魁梧。<br>豪爽不羁，爱赌爱饮，人称道法将军。表面粗豪实则心思缜密，重情重义。",
        avatar: "A"
    },
    B: {
        name: "洞庭君",
        description: "天山派刑罚长老，钱塘君的姐姐。<br>27岁却因修炼特殊内功停留在14岁童身，身材娇小，常需踮脚维持威严。<br>沉默寡言，公正严明，努力维持成熟气质。",
        avatar: "B"
    },
    C: {
        name: "钱塘君",
        description: "天山派内门弟子，洞庭君的妹妹。<br>16岁少女，苗条挺拔，英气逼人，银白长发编成双辫。<br>活泼俏丽，言行跳脱，没心没肺的狐朋狗友。",
        avatar: "C"
    },
    D: {
        name: "萧白瑚",
        description: "天山派外门弟子，年纪最小的弟子之一。<br>14岁女孩，银白色双髻配红色铃铛，活泼灵动。<br>傲娇好胜爱逞强，嘴硬心软。自称要成为天下第一。",
        avatar: "D"
    },
    E: {
        name: "姬姒",
        description: "天山派内门弟子，归义军遗民。<br>外表27岁实际100余岁，运功陷入假死状态长眠，每隔一段时间苏醒活跃。<br>心思单纯，饕口馋舌，娇憨正直却武功高强。",
        avatar: "E"
    },
    F: {
        name: "施延年",
        description: "天山派外门弟子，藏经阁管理员。<br>16岁少女，身材纤细，清雅脱俗，谈吐不凡。<br>温文尔雅的书呆子，醉心典籍安贫乐道。但偶尔会慷慨激昂针砭时弊。",
        avatar: "F"
    },
    G: {
        name: "呼延显",
        description: "天山派内门大师兄，破阵子之徒，带发修行的僧侣。<br>24岁匈奴族人，男生女相，面容柔美。<br>平时玩世不恭满嘴歪理，能言善辩。关键时刻亦有可靠的一面。",
        avatar: "G"
    },
    H: {
        name: "雨烛",
        description: "天山派内门弟子，破阵子长老的小徒弟。<br>15岁梵衍那族少女，金发碧眼，腰后生有青色半透明羽翼，身姿轻盈如仙。<br>活泼乖巧的团宠小天使，纯真善良。是门派的开心果。",
        avatar: "H"
    },
    I: {
        name: "安慕",
        description: "天山派外门弟子，伙房主厨<br>18岁少女，身材娇小力大无穷，金色猫耳猫尾，因近视常眯眼显凶。<br>刀子嘴豆腐心的小厨娘，不善言辞却用美食温暖人心。天生怪力让人不敢靠近。",
        avatar: "I"
    }
};

// NPC名字到ID的映射
const npcNameToId = {
    "破阵子": "A",
    "洞庭君": "B",
    "钱塘君": "C",
    "萧白瑚": "D",
    "姬姒": "E",
    "施延年": "F",
    "呼延显": "G",
    "雨烛": "H",
    "安慕": "I"
};

// NPC立绘URL映射
const npcPortraits = {
    A: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/NPC/破阵子.png',
    B: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/NPC/洞庭君.png',
    C: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/NPC/钱塘君.png',
    D: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/NPC/萧白瑚.png',
    E: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/NPC/姬姒.png',
    F: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/NPC/施延年.png',
    G: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/NPC/呼延显.png',
    H: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/NPC/雨烛.png',
    I: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/NPC/安慕.png'
};

// 地点背景图映射
const locationBackgrounds = {
    yanwuchang: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/演武场.png',
    cangjingge: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/藏经阁.png',
    huofang: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/伙房.png',
    houshan: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/后山.png',
    yishiting: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/议事厅.png',
    tiejiangpu: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/铁匠铺.png',
    nandizi: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/男弟子房.png',
    nvdizi: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/女弟子房.png',
    shanmen: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/山门.png',
    tianshanpai: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/天山派.png'
};

// 互动配置
const actionConfigs = {
    练武: { talentBonus: '根骨', affects: '武学' },
    学习: { talentBonus: '悟性', affects: '学识' },
    打杂: { talentBonus: '根骨', affects: '金钱' },
    秘密赌场: { talentBonus: '魅力', affects: '金钱' },
    探索: { talentBonus: '悟性', affects: '金钱' },
    汇报: { talentBonus: '悟性', affects: '声望' },
    打铁: { talentBonus: '心性', affects: '金钱' },
    休息: { talentBonus: '心性', affects: '心情' },
    拜访: { talentBonus: '魅力', affects: '声望' },
    下山: { talentBonus: '心性', affects: '声望' }
};

// NPC在各地点的出现概率
const npcLocationProbability = {
    A: {
        yanwuchang: 0.15,
        cangjingge: 0.05,
        huofang: 0.05,
        houshan: 0.20,
        yishiting: 0.20,
        tiejiangpu: 0.05,
        nandizi: 0.05,
        nvdizi: 0.00,
        shanmen: 0.05,
        none: 0.2
    },
    B: {
        yanwuchang: 0.15,
        cangjingge: 0.10,
        huofang: 0.05,
        houshan: 0.05,
        yishiting: 0.35,
        tiejiangpu: 0.05,
        nandizi: 0.00,
        nvdizi: 0.15,
        shanmen: 0.05,
        none: 0.05
    },
    C: {
        yanwuchang: 0.15,
        cangjingge: 0.05,
        huofang: 0.05,
        houshan: 0.30,
        yishiting: 0.05,
        tiejiangpu: 0.15,
        nandizi: 0.00,
        nvdizi: 0.15,
        shanmen: 0.05,
        none: 0.05
    },
    D: {
        yanwuchang: 0.20,
        cangjingge: 0.05,
        huofang: 0.20,
        houshan: 0.20,
        yishiting: 0.00,
        tiejiangpu: 0.05,
        nandizi: 0.00,
        nvdizi: 0.20,
        shanmen: 0.05,
        none: 0.05
    },
    E: {
        yanwuchang: 0.10,
        cangjingge: 0.10,
        huofang: 0.30,
        houshan: 0.15,
        yishiting: 0.05,
        tiejiangpu: 0.05,
        nandizi: 0.00,
        nvdizi: 0.15,
        shanmen: 0.05,
        none: 0.05
    },
    F: {
        yanwuchang: 0.05,
        cangjingge: 0.55,
        huofang: 0.05,
        houshan: 0.05,
        yishiting: 0.05,
        tiejiangpu: 0.05,
        nandizi: 0.00,
        nvdizi: 0.10,
        shanmen: 0.05,
        none: 0.05
    },
    G: {
        yanwuchang: 0.20,
        cangjingge: 0.20,
        huofang: 0.05,
        houshan: 0.15,
        yishiting: 0.10,
        tiejiangpu: 0.05,
        nandizi: 0.10,
        nvdizi: 0.00,
        shanmen: 0.05,
        none: 0.10
    },
    H: {
        yanwuchang: 0.15,
        cangjingge: 0.10,
        huofang: 0.20,
        houshan: 0.25,
        yishiting: 0.05,
        tiejiangpu: 0.05,
        nandizi: 0.00,
        nvdizi: 0.15,
        shanmen: 0.05,
        none: 0.00
    },
    I: {
        yanwuchang: 0.05,
        cangjingge: 0.05,
        huofang: 0.50,
        houshan: 0.15,
        yishiting: 0.05,
        tiejiangpu: 0.05,
        nandizi: 0.00,
        nvdizi: 0.10,
        shanmen: 0.05,
        none: 0.00
    }
};

// 默认游戏数据
const defaultGameData = {
    userLocation: "houshan",
    playerTalents: { "根骨": 25, "悟性": 25, "心性": 25, "魅力": 25 },
    playerStats:   { "武学": 20, "学识": 20, "声望": 20, "金钱": 500 },
    combatStats:   { "攻击力": 20, "生命值": 50 },
    playerMood: 100,
    martialArts: {
        "太白仙迹": 0, "岱宗如何": 0, "掠风窃尘": 0, "流云飞袖": 0,
        "惊鸿照影": 0, "踏雪无痕": 0, "醉卧沙场": 0, "万剑归宗": 0
    },
    npcFavorability: { "A": 0,"B": 0,"C": 0,"D": 0,"E": 0,"F": 0,"G": 0,"H": 0,"I": 0},
    actionPoints: 3,
    currentWeek: 1,
    npcLocations: { "A":"none","B":"yishiting","C":"yishiting","D":"shanmen","E":"nvdizi","F":"cangjingge","G":"yanwuchang","H":"houshan","I":"huofang"}
};
