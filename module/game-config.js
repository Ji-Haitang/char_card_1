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
    playerMood: { min: 0, max: 120 },
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
    gongtian: '公田', 
    tianshanpai: '天山派',
    none: 'none'
};

const seasonNameMap = {
    'spring': '春天',
    'summer': '夏天',
    'autumn': '秋天',
    'winter': '冬天'
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
        description: "天山派内门弟子，洞庭君的妹妹。<br>19岁少女，苗条挺拔，英气逼人，银白长发编成双辫。<br>活泼俏丽，言行跳脱，没心没肺的狐朋狗友。",
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
        description: "天山派外门弟子，伙房主厨。<br>18岁少女，身材娇小力大无穷，金色猫耳猫尾，因近视常眯眼显凶。<br>刀子嘴豆腐心的小厨娘，不善言辞却用美食温暖人心。天生怪力让人不敢靠近。",
        avatar: "I"
    },
    J: {
        name: "唐沐梨",
        description: "蜀中唐门大小姐，天山派客座弟子。<br>20岁少女，身姿挺拔气质高贵，粉紫渐变长发紫罗兰杏眼，生有粉色猫耳猫尾。<br>颐指气使的千金大小姐，实则重情重义。精于商道算计，暗器百发百中。",
        avatar: "J"
    },
    K: {
        name: "洛潜幽",
        description: "天山派外门弟子，负责女红织绣和接待贵客。<br>17岁少女，身形纤弱楚楚可怜，深蓝长发水蓝杏眼，耳侧生有鱼鳍。<br>对他人温和善良，唯独对你冷若冰霜。精通观星占卜，心思敏感易碎。",
        avatar: "K"
    },
    L: {
        name: "神秘杂役",
        description: "天山派杂役。<br>高大肥胖，从不以真面目示人。<br>名字身份来历都未知的神秘人物...",
        avatar: "L"
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
    "安慕": "I",
    "唐沐梨": "J",
    "洛潜幽": "K",
    "神秘杂役": "L"
};

// NPC立绘URL映射
const npcPortraits = {
    A: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/NPC/破阵子.webp',
    B: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/NPC/洞庭君.webp',
    C: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/NPC/钱塘君.webp',
    D: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/NPC/萧白瑚.webp',
    E: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/NPC/姬姒.webp',
    F: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/NPC/施延年.webp',
    G: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/NPC/呼延显.webp',
    H: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/NPC/雨烛.webp',
    I: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/NPC/安慕.webp',
    J: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/NPC/唐沐梨.webp',
    K: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/NPC/洛潜幽.webp',
    L: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/NPC/神秘杂役.webp'
};

// 地点背景图映射
const locationBackgrounds = {
    yanwuchang: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/演武场.webp',
    cangjingge: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/藏经阁.webp',
    huofang: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/伙房.webp',
    houshan: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/后山.webp',
    yishiting: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/议事厅.webp',
    tiejiangpu: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/铁匠铺.webp',
    nandizi: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/男弟子房.webp',
    nvdizi: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/女弟子房.webp',
    shanmen: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/山门.webp',
    tianshanpai: 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/img/location/天山派.webp'
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
    休息: { talentBonus: '心性', affects: '体力' },
    拜访: { talentBonus: '魅力', affects: '声望' },
    下山: { talentBonus: '心性', affects: '声望' }
};

const npcSparRewards = {
    A: { type: '武学', value: 5 },      // 破阵子 - 武学+3
    B: { type: '声望', value: 5 },      // 洞庭君 - 声望+2
    C: { type: '金钱', value: 500 },    // 钱塘君 - 金钱+300
    D: { type: '武学', value: 1 },      // 萧白瑚 - 根骨+1
    E: { type: '武学', value: 3 },      // 姬姒 - 武学+5
    F: { type: '学识', value: 3 },      // 施延年 - 学识+3
    G: { type: '学识', value: 4 },      // 呼延显 - 悟性+1
    H: { type: '声望', value: 1 },      // 雨烛 - 心性+1
    I: { type: '金钱', value: 300 },    // 安慕 - 金钱+500
    J: { type: '金钱', value: 1000 },      // 唐沐梨 - 魅力+1
    K: { type: '学识', value: 2 },      // 洛潜幽 - 学识+2
    L: { type: '金钱', value: 3000 }   // 神秘杂役 - 金钱+1000
};

// NPC在各地点的出现概率
const npcLocationProbability = {
    A: {  // 破阵子 - 外务长老，需要视察公田
        yanwuchang: 0.15,
        cangjingge: 0.05,
        huofang: 0.05,
        houshan: 0.15,
        yishiting: 0.20,
        tiejiangpu: 0.05,
        nandizi: 0.05,
        nvdizi: 0.00,
        shanmen: 0.05,
        gongtian: 0.10,  // 视察农业生产
        none: 0.15
    },
    B: {  // 洞庭君 - 刑罚长老，偶尔视察
        yanwuchang: 0.15,
        cangjingge: 0.10,
        huofang: 0.05,
        houshan: 0.05,
        yishiting: 0.30,
        tiejiangpu: 0.05,
        nandizi: 0.00,
        nvdizi: 0.15,
        shanmen: 0.05,
        gongtian: 0.05,  // 偶尔视察
        none: 0.05
    },
    C: {  // 钱塘君 - 活泼好动，会去公田玩
        yanwuchang: 0.15,
        cangjingge: 0.05,
        huofang: 0.05,
        houshan: 0.25,
        yishiting: 0.05,
        tiejiangpu: 0.10,
        nandizi: 0.00,
        nvdizi: 0.15,
        shanmen: 0.05,
        gongtian: 0.10,  // 去捣乱或帮忙
        none: 0.05
    },
    D: {  // 萧白瑚 - 外门弟子，需要参与劳作
        yanwuchang: 0.20,
        cangjingge: 0.05,
        huofang: 0.15,
        houshan: 0.15,
        yishiting: 0.00,
        tiejiangpu: 0.05,
        nandizi: 0.00,
        nvdizi: 0.20,
        shanmen: 0.05,
        gongtian: 0.10,  // 外门弟子劳作
        none: 0.05
    },
    E: {  // 姬姒 - 贪吃，会去看有什么能吃的
        yanwuchang: 0.10,
        cangjingge: 0.10,
        huofang: 0.25,
        houshan: 0.15,
        yishiting: 0.05,
        tiejiangpu: 0.05,
        nandizi: 0.00,
        nvdizi: 0.15,
        shanmen: 0.05,
        gongtian: 0.05,  // 看看有什么能吃的
        none: 0.05
    },
    F: {  // 施延年 - 书呆子，很少去公田
        yanwuchang: 0.05,
        cangjingge: 0.50,
        huofang: 0.05,
        houshan: 0.05,
        yishiting: 0.05,
        tiejiangpu: 0.05,
        nandizi: 0.00,
        nvdizi: 0.10,
        shanmen: 0.05,
        gongtian: 0.05,  // 偶尔去透透气
        none: 0.05
    },
    G: {  // 呼延显 - 大师兄，可能指导劳作
        yanwuchang: 0.20,
        cangjingge: 0.15,
        huofang: 0.05,
        houshan: 0.15,
        yishiting: 0.10,
        tiejiangpu: 0.05,
        nandizi: 0.10,
        nvdizi: 0.00,
        shanmen: 0.05,
        gongtian: 0.05,  // 偶尔指导
        none: 0.10
    },
    H: {  // 雨烛 - 活泼小天使，会去玩耍
        yanwuchang: 0.15,
        cangjingge: 0.10,
        huofang: 0.15,
        houshan: 0.20,
        yishiting: 0.05,
        tiejiangpu: 0.05,
        nandizi: 0.00,
        nvdizi: 0.15,
        shanmen: 0.05,
        gongtian: 0.10,  // 去玩耍帮忙
        none: 0.00
    },
    I: {  // 安慕 - 伙房主厨，需要新鲜食材
        yanwuchang: 0.05,
        cangjingge: 0.00,
        huofang: 0.50,
        houshan: 0.15,
        yishiting: 0.00,
        tiejiangpu: 0.05,
        nandizi: 0.00,
        nvdizi: 0.10,
        shanmen: 0.05,
        gongtian: 0.10,  // 不再需要去公田
        none: 0.00
    },
    J: {  // 唐慕梨 - 商人，对农产品感兴趣
        yanwuchang: 0.10,
        cangjingge: 0.05,
        huofang: 0.10,
        houshan: 0.05,
        yishiting: 0.15,
        tiejiangpu: 0.10,
        nandizi: 0.00,
        nvdizi: 0.20,
        shanmen: 0.15,
        gongtian: 0.05,  // 查看农产品商机
        none: 0.05
    },
    K: {  // 洛潜幽 - 可能去采花装饰
        yanwuchang: 0.05,
        cangjingge: 0.10,
        huofang: 0.10,
        houshan: 0.15,
        yishiting: 0.15,
        tiejiangpu: 0.00,
        nandizi: 0.00,
        nvdizi: 0.25,
        shanmen: 0.05,
        gongtian: 0.05,  // 不需要劳作
        none: 0.10
    },
    L: {  // 神秘杂役 - 神秘出没
        yanwuchang: 0.02,
        cangjingge: 0.01,
        huofang: 0.01,
        houshan: 0.01,
        yishiting: 0.01,
        tiejiangpu: 0.01,
        nandizi: 0.01,
        nvdizi: 0.00,
        shanmen: 0.01,
        gongtian: 0.01,  // 偶尔在公田出现
        none: 0.90
    }
};

// 地点危险度配置
const locationDangerLevels = {
    '伊州': '中',
    '千佛洞': '低',
    '博斯坦村': '低',
    '博格达峰': '高',
    '哈密绿洲': '较低',
    '大沙海': '高',
    '天山派外堡': '低',
    '崆峒派': '低',
    '拜火教总坛': '高',
    '昆仑派': '低',
    '月牙泉': '低',
    '沙州': '高',
    '瓜州': '高',
    '白驼山': '较高',
    '迪坎儿村': '较低',
    '高昌': '较低',
    '龟兹': '较低',
    '天山派': '低'  // 添加天山派的危险度
};

// SLG模式可选场景配置
const slgSceneOptions = [
    '沙漠',
    '山道',
    '雪山',
    '山谷',
    '冰川',
    '水边',
    '树林',
    '绿洲',
    '村落',
    '山洞',
    '客房',
    '酒肆',
    '商铺',
    '街道',
    '浴室',
    '市集',
    '废墟',
    '寺庙',
    '石窟',
    '熔岩洞',
    '地牢',
    '邪教祭坛',
    '武侠门派',
    '山门',
    '演武场',
    '宫殿',
    '庭院',
    '府邸',
    '军营'
];

// SLG模式可选CG配置
const slgCGOptions = [
    '露阴',
    '露胸',
    '接吻',
    '舔奶',
    '揉胸',
    '口交',
    '自慰',
    '足交',
    '手交',
    '乳交',
    '指交',
    '舔阴',
    '后入式',
    '正常位',
    '女上位',
    '69式',
    '火车便当式',
    'none'
];

// SLG模式可选表情配置
const slgEmotionOptions = [
    '大笑',
    '平静',
    '生气',
    '兴奋',
    '微笑',
    '不满',
    '严肃',
    '害羞',
    '尴尬',
    '为难',
    '惊讶',
    '紧张',
    '害怕',
    '悲伤',
    '哭泣',
    '得意',
    '发情',
    'none'
];

// 危险度对应的事件概率
const dangerEventChance = {
    '低': { battle: 0, random: 10 },      // 战斗5%，随机事件10%
    '较低': { battle: 5, random: 10 },    // 战斗8%，随机事件10%
    '中': { battle: 10, random: 10 },     // 战斗12%，随机事件10%
    '较高': { battle: 15, random: 10 },   // 战斗16%，随机事件10%
    '高': { battle: 25, random: 10 }      // 战斗25%，随机事件10%
};

const item_list = {
    "小麦种子": {
        "描述": "小麦的种子，可以在田地里种植",
        "可交易": true,
        "买入价格": 75,
        "卖出价格": 37,
        "可使用": false,
        "影响属性": null,
        "影响数值": null,
        "可装备": false,
        "装备类型": null,
        "装备属性": null,
        "装备数值": null
    },
    "茄子种子": {
        "描述": "茄子的种子，可以在田地里种植",
        "可交易": true,
        "买入价格": 115,
        "卖出价格": 57,
        "可使用": false,
        "影响属性": null,
        "影响数值": null,
        "可装备": false,
        "装备类型": null,
        "装备属性": null,
        "装备数值": null
    },
    "甜瓜种子": {
        "描述": "甜瓜的种子，可以在田地里种植",
        "可交易": true,
        "买入价格": 165,
        "卖出价格": 82,
        "可使用": false,
        "影响属性": null,
        "影响数值": null,
        "可装备": false,
        "装备类型": null,
        "装备属性": null,
        "装备数值": null
    },
    "甘蔗种子": {
        "描述": "甘蔗的种子，可以在田地里种植",
        "可交易": true,
        "买入价格": 240,
        "卖出价格": 120,
        "可使用": false,
        "影响属性": null,
        "影响数值": null,
        "可装备": false,
        "装备类型": null,
        "装备属性": null,
        "装备数值": null
    },
    "胡饼": {
      "描述": "西域风味的烤饼，香脆可口，便于携带",
      "可交易": true,
      "买入价格": 500,
      "卖出价格": 250,
      "可使用": true,
      "影响属性": "playerMood",
      "影响数值": 20,
      "可装备": false,
      "装备类型": null,
      "装备属性": null,
      "装备数值": null
    },
    "桂花糕": {
        "描述": "带有桂花香气的精致糕点，清甜爽口，是不少女弟子的最爱",
        "可交易": true,
        "买入价格": 800,
        "卖出价格": 400,
        "可使用": true,
        "影响属性": "playerMood",
        "影响数值": 40,
        "可装备": false,
        "装备类型": null,
        "装备属性": null,
        "装备数值": null
    },
    "烤羊腿": {
        "描述": "安慕特制的烤羊腿，香气扑鼻，让人垂涎欲滴",
        "可交易": true,
        "买入价格": 1500,
        "卖出价格": 750,
        "可使用": true,
        "影响属性": "playerMood",
        "影响数值": 100,
        "可装备": false,
        "装备类型": null,
        "装备属性": null,
        "装备数值": null
    },
    "制式铁剑": {
      "描述": "天山派弟子入门时统一配发的铁剑，虽然平平无奇，但亦是你剑道的起点",
      "可交易": true,
      "买入价格": 1500,
      "卖出价格": 750,
      "可使用": false,
      "影响属性": null,
      "影响数值": null,
      "可装备": true,
      "装备类型": "武器",
      "装备属性": "攻击力",
      "装备数值": 10
    },
    "精钢长剑": {
        "描述": "天山铁匠铺精心打造的长剑，锋利异常，是不少弟子梦寐以求的武器",
        "可交易": true,
        "买入价格": 5000,
        "卖出价格": 2500,
        "可使用": false,
        "影响属性": null,
        "影响数值": null,
        "可装备": true,
        "装备类型": "武器",
        "装备属性": "攻击力",
        "装备数值": 20
    },
    "归义军长剑": {
        "描述": "古法锻造，外观一如百年之前，形制虽已古旧但威力不减",
        "可交易": false,
        "买入价格": 9000,
        "卖出价格": 4500,
        "可使用": false,
        "影响属性": null,
        "影响数值": null,
        "可装备": true,
        "装备类型": "武器",
        "装备属性": "攻击力",
        "装备数值": 30
      },
    "普通弟子服": {
      "描述": "天山派弟子入门时统一配发的弟子服",
      "可交易": true,
      "买入价格": 1500,
      "卖出价格": 750,
      "可使用": false,
      "影响属性": null,
      "影响数值": null,
      "可装备": true,
      "装备类型": "防具",
      "装备属性": "生命值",
      "装备数值": 25
    },
    "铁环软锁甲": {
        "描述": "铁匠铺打造的改良型锁子甲，采用特殊工艺让铁环更加细密柔软，贴身而不妨碍活动",
        "可交易": true,
        "买入价格": 5000,
        "卖出价格": 2500,
        "可使用": false,
        "影响属性": null,
        "影响数值": null,
        "可装备": true,
        "装备类型": "防具",
        "装备属性": "生命值",
        "装备数值": 50
      },
    // 根骨类饰品
    "血玉护符": {
        "描述": "以西域血玉雕刻的护身符，佩戴可强健体魄",
        "可交易": true,
        "买入价格": 8000,
        "卖出价格": 4000,
        "可使用": false,
        "影响属性": null,
        "影响数值": null,
        "可装备": true,
        "装备类型": "饰品",
        "装备属性": "根骨",
        "装备数值": 2
      },
    "青铜力士环": {
        "描述": "仿古青铜打造的臂环，上刻力士图案",
        "可交易": true,
        "买入价格": 12000,
        "卖出价格": 6000,
        "可使用": false,
        "影响属性": null,
        "影响数值": null,
        "可装备": true,
        "装备类型": "饰品",
        "装备属性": "根骨",
        "装备数值": 3
    },
    "千年龟甲坠": {
        "描述": "用千年老龟的背甲制成，蕴含长寿之气",
        "可交易": true,
        "买入价格": 18000,
        "卖出价格": 9000,
        "可使用": false,
        "影响属性": null,
        "影响数值": null,
        "可装备": true,
        "装备类型": "饰品",
        "装备属性": "根骨",
        "装备数值": 4
    },
    "凤血石戒指": {
        "描述": "传说中凤凰血化成的宝石，能够改造体质",
        "可交易": false,
        "买入价格": 25000,
        "卖出价格": 12500,
        "可使用": false,
        "影响属性": null,
        "影响数值": null,
        "可装备": true,
        "装备类型": "饰品",
        "装备属性": "根骨",
        "装备数值": 5
    },
    // 悟性类饰品
    "静心玉扇坠": {
        "描述": "小巧的玉扇形吊坠，有助于静心悟道",
        "可交易": true,
        "买入价格": 8000,
        "卖出价格": 4000,
        "可使用": false,
        "影响属性": null,
        "影响数值": null,
        "可装备": true,
        "装备类型": "饰品",
        "装备属性": "悟性",
        "装备数值": 2
    },
    "菩提子手串": {
        "描述": "一百零八颗菩提子串成，助人开悟",
        "可交易": true,
        "买入价格": 12000,
        "卖出价格": 6000,
        "可使用": false,
        "影响属性": null,
        "影响数值": null,
        "可装备": true,
        "装备类型": "饰品",
        "装备属性": "悟性",
        "装备数值": 3
    },
    "灵犀玉佩": {
        "描述": "心有灵犀一点通，此玉能通人心智",
        "可交易": true,
        "买入价格": 18000,
        "卖出价格": 9000,
        "可使用": false,
        "影响属性": null,
        "影响数值": null,
        "可装备": true,
        "装备类型": "饰品",
        "装备属性": "悟性",
        "装备数值": 4
    },
    "星罗盘坠": {
        "描述": "司天监流传的观星盘缩小版，蕴含天地玄机",
        "可交易": false,
        "买入价格": 25000,
        "卖出价格": 12500,
        "可使用": false,
        "影响属性": null,
        "影响数值": null,
        "可装备": true,
        "装备类型": "饰品",
        "装备属性": "悟性",
        "装备数值": 5
    },
    // 心性类饰品
    "凝神香囊": {
        "描述": "装有安神香料的锦囊，让人心平气和",
        "可交易": true,
        "买入价格": 8000,
        "卖出价格": 4000,
        "可使用": false,
        "影响属性": null,
        "影响数值": null,
        "可装备": true,
        "装备类型": "饰品",
        "装备属性": "心性",
        "装备数值": 2
    },
    "定心铜钟": {
        "描述": "小巧的铜钟挂饰，清音能定心神",
        "可交易": true,
        "买入价格": 12000,
        "卖出价格": 6000,
        "可使用": false,
        "影响属性": null,
        "影响数值": null,
        "可装备": true,
        "装备类型": "饰品",
        "装备属性": "心性",
        "装备数值": 3
    },
    "净心琉璃珠": {
        "描述": "七宝琉璃制成的念珠，净化心灵",
        "可交易": true,
        "买入价格": 18000,
        "卖出价格": 9000,
        "可使用": false,
        "影响属性": null,
        "影响数值": null,
        "可装备": true,
        "装备类型": "饰品",
        "装备属性": "心性",
        "装备数值": 4
    },
    "归义军虎符": {
        "描述": "晚唐传承至今的军中信物，承载着守护百姓的信念",
        "可交易": false,
        "买入价格": 25000,
        "卖出价格": 12500,
        "可使用": false,
        "影响属性": null,
        "影响数值": null,
        "可装备": true,
        "装备类型": "饰品",
        "装备属性": "心性",
        "装备数值": 5
    },
    
    // 魅力类饰品
    "碧玉发钗": {
        "描述": "精美的碧玉发钗，增添几分风采",
        "可交易": true,
        "买入价格": 8000,
        "卖出价格": 4000,
        "可使用": false,
        "影响属性": null,
        "影响数值": null,
        "可装备": true,
        "装备类型": "饰品",
        "装备属性": "魅力",
        "装备数值": 2
    },
    "流光腰坠": {
        "描述": "会随光线变换颜色的神奇宝石",
        "可交易": true,
        "买入价格": 12000,
        "卖出价格": 6000,
        "可使用": false,
        "影响属性": null,
        "影响数值": null,
        "可装备": true,
        "装备类型": "饰品",
        "装备属性": "魅力",
        "装备数值": 3
    },
    "凤翎耳坠": {
        "描述": "以珍禽羽毛制成的耳环，光彩夺目",
        "可交易": true,
        "买入价格": 18000,
        "卖出价格": 9000,
        "可使用": false,
        "影响属性": null,
        "影响数值": null,
        "可装备": true,
        "装备类型": "饰品",
        "装备属性": "魅力",
        "装备数值": 4
    },
    "明月珠冠": {
        "描述": "发冠上镶嵌的夜明珠产自万里之外，即使在白昼也能散发柔和光芒",
        "可交易": false,
        "买入价格": 25000,
        "卖出价格": 12500,
        "可使用": false,
        "影响属性": null,
        "影响数值": null,
        "可装备": true,
        "装备类型": "饰品",
        "装备属性": "魅力",
        "装备数值": 5
    }
};
// 默认游戏数据
const defaultGameData = {
    userLocation: "tianshanpai",
    playerTalents: { "根骨": 25, "悟性": 25, "心性": 25, "魅力": 25 },
    playerStats:   { "武学": 20, "学识": 20, "声望": 20, "金钱": 500 },
    combatStats:   { "攻击力": 20, "生命值": 50 },
    playerMood: 100,
    martialArts: {
        "太白仙迹": 0, "岱宗如何": 0, "掠风窃尘": 0, "流云飞袖": 0,
        "惊鸿照影": 0, "踏雪无痕": 0, "醉卧沙场": 0, "万剑归宗": 0
    },
    npcFavorability: { "A": 0,"B": 0,"C": 0,"D": 0,"E": 0,"F": 0,"G": 0,"H": 0,"I": 0,"J": 0,"K": 0,"L": 0},
    actionPoints: 3,
    currentWeek: 1,
    dayNightStatus: 'daytime',  // 新增：昼夜状况 'daytime' 或 'night'
    seasonStatus: 'winter',      // 新增：四季状况 'spring', 'summer', 'autumn', 'winter'
    npcLocations: { "A":"none","B":"yishiting","C":"yishiting","D":"shanmen","E":"nvdizi","F":"cangjingge","G":"yanwuchang","H":"houshan","I":"huofang","J":"tiejiangpu","K":"nvdizi","L":"none"},
    GameMode: 0,  // 游戏模式，0=普通模式，1=SLG模式
    difficulty: 'normal', // 默认难度 
    npcVisibility: { "A": true,"B": true,"C": true,"D": true,"E": true,"F": true,"G": true,"H": true,"I": true,"J": true,"K": true,"L": true}, // 新增：NPC是否显示
    npcGiftGiven: { "A": false,"B": false,"C": false,"D": false,"E": false,"F": false,"G": false,"H": false,"I": false,"J": false,"K": false,"L": false}, // 新增：本周是否已送礼
    npcSparred: { "A": false,"B": false,"C": false,"D": false,"E": false,"F": false,"G": false,"H": false,"I": false,"J": false,"K": false,"L": false}, // 新增：本周是否已切磋
    lastFarmWeek: 1,  // 新增：上次耕种的周数
    farmGrid: [],     // 新增：农场地块状态
    inventory: {
        "胡饼": 5,
        "小麦种子": 5
    },
    equipment: {
        "武器": null,
        "防具": null,
        "饰品1": null,
        "饰品2": null
    },
    lastUserMessage: "",     // 已存在：储存上轮用户输入
    summary_Small: "",
    newWeek: 0,
    randomEvent: 0,       // 随机事件标记
    battleEvent: 0,       // 战斗事件标记
    companionNPC: [],     // 随行NPC数组
    mapLocation: '天山派', // 地图位置
    cgContentEnabled: false  // 新增：CG内容开关（默认关）
};
