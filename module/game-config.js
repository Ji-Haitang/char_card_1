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
 * - seasonNameMap: 季节英文到中文的映射
 * - npcs: NPC基本信息（名字、描述、头像ID）
 * - npcNameToId: NPC名字到ID的映射表
 * - npcPortraits: NPC立绘图片URL映射
 * - locationBackgrounds: 地点背景图URL映射
 * - actionConfigs: 各种行动的配置（天赋加成、影响属性）
 * - npcLocationProbability: NPC在各地点出现的概率配置
 * - npcSparRewards: NPC切磋奖励配置
 * - defaultGameData: 游戏初始数据
 * - slgEmotionOptions: SLG模式表情选项列表
 * - slgCGOptions: SLG模式CG选项列表
 * - emotionSynonyms/sceneSynonyms/npcSynonyms/cgSynonyms: 模糊匹配同义词映射
 * 
 * 对外暴露的主要变量：
 * - valueRanges: 用于数值范围检查
 * - locationNames/seasonNameMap: 用于显示地点和季节中文名
 * - npcs/npcNameToId/npcPortraits: 用于NPC相关功能
 * - actionConfigs: 用于计算行动结果
 * - item_list: 由 item-list.js 提供
 * - defaultGameData: 用于初始化游戏数据
 * - slgEmotionOptions/slgCGOptions: 用于SLG模式文本解析
 * 
 * 依赖关系：
 * 无依赖，是最底层的配置文件
 */

// 自适应资源路径：index 链路用相对路径，index-SR 链路用 CDN 绝对路径
// file:// 协议下（直接双击打开）也走 CDN，避免 Chrome CORS 拦截
const _CDN_BASE = 'https://cdn.jsdelivr.net/gh/Ji-Haitang/char_card_1@main/';
const _PAGES_BASE = 'https://Ji-Haitang.github.io/char_card_1/';
function _assetUrl(path) {
    const isFileProt = typeof location !== 'undefined' && location.protocol === 'file:';
    return (typeof window !== 'undefined' && window.USE_CDN) || isFileProt ? _CDN_BASE + path : path;
}
// iframe 子页面路径：USE_CDN=true（ST角色卡）时指向 github.io，本地链路用相对路径
function _iframeUrl(page) {
    return (typeof window !== 'undefined' && window.USE_CDN) ? _PAGES_BASE + page : page;
}

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
        生命值: { min: 25, max: 600 },
        暴击率: { min: 0, max: 100 },
        暴击伤害: { min: 0, max: 250 },
        格挡: { min: 0, max: 9999 },
        穿甲: { min: 0, max: 9999 },
        回转: { min: 0, max: 1 },
        吸血: { min: 0, max: 100 },
        反伤: { min: 0, max: 100 }
    },
    playerMood: { min: 0, max: 120 },
    npcFavorability: { min: 0, max: 100 },
    actionPoints: { min: 0, max: 3 },
    currentWeek: { min: 1, max: 9999 }
};

// 属性分档描述文案（与 char_card_information/040主角属性.txt 中 prompt 分档完全一致）
// 用于「属性查看-角色属性」界面悬浮提示展示，独立于可被用户自定义的 PROMPT_CORE_040
// max: 该档位的数值上限（不含），按顺序取第一个 value < max 的档位；最后一档 max 为 Infinity
const attributeTierDescriptions = {
    根骨: [
        { max: 11, text: '手无缚鸡之力，肩不能挑担，手不能提篮，体力远逊于常人。' },
        { max: 21, text: '资质平平，勉强能应付日常生活，但稍有强度的劳动便会气喘吁吁。' },
        { max: 31, text: '寻常体魄，与大多数人无异，不好不坏，能完成基本的体力工作。' },
        { max: 41, text: '体格健壮，比寻常人多了几分气力，干起活来不落下风，已有几分练武的根基。' },
        { max: 51, text: '筋骨强健，精力充沛，寻常三五个壮汉也未必能轻易近身。' },
        { max: 61, text: '力能扛鼎，体魄远超常人，是天生的练武好手，基础扎实。' },
        { max: 71, text: '骨骼惊奇，天赋异禀，是万中无一的练武奇才，修行一日千里。' },
        { max: 81, text: '龙精虎猛，气血旺盛如烘炉，筋骨强韧如铁，寻常兵刃难伤。' },
        { max: 91, text: '金刚不坏，肉身强横无比，气血浩瀚如江海，已近乎人形凶兽。' },
        { max: Infinity, text: '古之恶来，天人之姿，身怀无上神力，举手投足间有崩山裂石之威，万古罕见。' }
    ],
    悟性: [
        { max: 11, text: '愚钝不堪，理解能力极差，常人一学就会的东西，只能领会十之一二。' },
        { max: 21, text: '资质平庸，学东西很慢，需要付出比常人更多的努力才能有所成就。' },
        { max: 31, text: '中人之姿，不算聪慧但也绝不愚笨，勤能补拙，尚有可为。' },
        { max: 41, text: '略有慧根，比寻常人多了几分悟性，学东西虽不算很快，但持之以恒就能渐入佳境。' },
        { max: 51, text: '颇有灵性，对事物有不错的理解力，稍加点拨便能掌握其中关键。' },
        { max: 61, text: '冰雪聪明，思维敏捷，能举一反三，触类旁通，是块学习的好材料。' },
        { max: 71, text: '过目不忘，记忆力超群，且能深入思考，任何问题都能迅速找到症结。' },
        { max: 81, text: '七窍玲珑，任何功法秘籍看上几遍便能领悟精髓，让人惊叹不已。' },
        { max: 91, text: '天纵奇才，拥有超凡的洞察力和创造力，能无师自通，开创先河。' },
        { max: Infinity, text: '慧根天成，近乎于道，一法通万法通，世间万物至理皆可洞悉。' }
    ],
    心性: [
        { max: 11, text: '心志不坚，极易受到外界蛊惑，被人三言两语便能轻易动摇本心。' },
        { max: 21, text: '心浮气躁，急功近利，做事没有耐心，常常半途而废，难成大器。' },
        { max: 31, text: '尚能自持，虽时有动摇，但大是大非面前尚能坚守本心，不至迷失。' },
        { max: 41, text: '渐趋沉稳，遇事不再轻易慌乱，虽偶有犹疑，但能咬牙坚持，不轻言放弃。' },
        { max: 51, text: '心志坚定，认准的事情便会坚持到底，寻常的困难挫折无法使其退缩。' },
        { max: 61, text: '心如磐石，意志坚韧不拔，纵使身处绝境，亦能百折不挠，寻求生机。' },
        { max: 71, text: '沉稳如山，喜怒不形于色，面对任何变故都能保持冷静，从容应对。' },
        { max: 81, text: '勇猛精进，有大毅力大决心，敢于挑战一切不可能，道心无所畏惧。' },
        { max: 91, text: '心有明镜，不染尘埃，能洞察人心，看破虚妄，外魔内邪皆不能侵。' },
        { max: Infinity, text: '道心稳固，万劫不磨，天崩地裂于前而色不变，已达圣人至境。' }
    ],
    魅力: [
        { max: 11, text: '相貌丑陋，气质猥琐，走在路上都会引人侧目，常遭人无端嫌恶。' },
        { max: 21, text: '容貌平庸，丢在人堆里就找不出来，没有任何能让人记住的特点。' },
        { max: 31, text: '五官端正，虽不英俊，但看着顺眼，给人一种老实可靠的感觉。' },
        { max: 41, text: '眉目清朗，举止得体，在人群中算得上中等偏上的相貌。' },
        { max: 51, text: '剑眉星目，气宇轩昂，身姿挺拔，已是寻常人眼中的俊朗男儿。' },
        { max: 61, text: '俊朗不凡，面如冠玉，目若朗星，自有一股出尘的气质，令人心折。' },
        { max: 71, text: '风度翩翩，谈吐不凡，一举一动都充满魅力，能轻易获得他人好感。' },
        { max: 81, text: '玉树临风，英姿勃发，无论走到哪里都是众人瞩目的焦点。' },
        { max: 91, text: '龙章凤姿，天质自然，仿佛谪仙临尘，令人自惭形秽，不敢直视。' },
        { max: Infinity, text: '神采天授，风华绝代，一言一行皆合天道，令万物为之倾倒。' }
    ],
    武学: [
        { max: 30, text: '未曾习武，拳脚功夫与寻常百姓无异，对江湖之事一无所知。' },
        { max: 60, text: '初学乍练，懂得一些基本招式和桩功，勉强能对付一两个泼皮。' },
        { max: 90, text: '小有所成，在地方上算是个好手，寻常三五人不得近身，可入三流。' },
        { max: 120, text: '融会贯通，已是门派中的二流弟子，在江湖上闯荡有了自保之力。' },
        { max: 150, text: '驾轻就熟，足以担任小门派的教习，或是在大派中成为核心弟子。' },
        { max: 180, text: '登堂入室，可称一方名宿，足以开创一门分支，或担任大派护法。' },
        { max: 210, text: '炉火纯青，已是一流高手之境，在江湖上颇有声名，能独当一面。' },
        { max: 240, text: '一代宗师，武功已臻化境，足以担任名门大派的长老，威震一方。' },
        { max: 270, text: '登峰造极，已是掌门级的顶尖人物，放眼天下也难寻几个对手。' },
        { max: Infinity, text: '武林至尊，功参造化，已是当世无敌的传说，为天下武人所共尊。' }
    ],
    学识: [
        { max: 30, text: '目不识丁，大字不识一个，只能听懂乡间俚语，对典籍一无所知。' },
        { max: 60, text: '寻常水准，识得常用字，能读懂日常告示、书信与账目，普通百姓中正常的读写水平。' },
        { max: 90, text: '知书达理，饱读诗书，在乡里间已是有名的读书人，可为蒙童教师。' },
        { max: 120, text: '才华横溢，经史子集皆有涉猎，可中举人，在文坛小有名气。' },
        { max: 150, text: '学富五车，已是进士及第的水平，其见解独到，能与大儒谈经论道。' },
        { max: 180, text: '博古通今，不仅精通文史，更对杂学有所研究，是文人雅士的座上宾。' },
        { max: 210, text: '一代名儒，学问渊博，学识水平足以在国子监讲学，其著作受文人追捧。' },
        { max: 240, text: '文坛泰斗，学究天人，已是帝师级别的人物，其思想能影响国策。' },
        { max: 270, text: '学贯古今，智慧超群，是士林公认的领袖，一言一行皆为天下表率。' },
        { max: Infinity, text: '一代圣贤，其学问已成一家之言，开创学派，其思想将流传千古。' }
    ],
    声望: [
        { max: 30, text: '默默无闻，江湖上没人听过你的名字，如同沧海一粟，毫不起眼。' },
        { max: 60, text: '乡里闻名，在左邻右舍、街坊四邻中有一些名声，但不出县城。' },
        { max: 90, text: '小有名气，在府城之内小有名望，官府和本地帮派都略有耳闻。' },
        { max: 120, text: '名动一州，事迹在一州之内广为流传，是官府重点关注的江湖人物。' },
        { max: 150, text: '威震一方，在数个州府地界都是响当当的人物，黑白两道皆要给些薄面。' },
        { max: 180, text: '誉满天下，名声传遍大江南北，无论走到哪里都会被人敬仰或畏惧。' },
        { max: 210, text: '武林名宿，在江湖上拥有极高的地位，是各大门派掌门都要礼遇的对象。' },
        { max: 240, text: '德高望重，无论是正是邪，都对你敬重三分，你的话语足以平息江湖纷争。' },
        { max: 270, text: '正道魁首，或是一方霸主，威望足以号令半个武林，是举足轻重的大人物。' },
        { max: Infinity, text: '武林神话，你的名字就是活着的传奇，是整个江湖共同敬仰的泰山北斗。' }
    ]
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
    danfang: '丹房',
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
        description: "34岁回鹘族男性，天山派外务长老，西域义军统领，呼延显和雨烛的师父。",
        avatar: "A"
    },
    B: {
        name: "洞庭君",
        description: "27岁（外表14岁）汉族女性，天山派刑罚长老，钱塘君的姐姐。",
        avatar: "B"
    },
    C: {
        name: "钱塘君",
        description: "19岁党项汉族混血女性，天山派内门弟子，洞庭君之妹，已故掌门张天义之徒。",
        avatar: "C"
    },
    D: {
        name: "萧白瑚",
        description: "14岁汉族女性，天山派外门弟子，年纪最小的第八代弟子。",
        avatar: "D"
    },
    E: {
        name: "姬姒",
        description: "外表28岁汉族女性，天山派内门弟子，辈分成谜，自掌门至第八代弟子皆称其为师姐。",
        avatar: "E"
    },
    F: {
        name: "施延年",
        description: "16岁汉族女性，天山派外门弟子，藏经阁管理员。",
        avatar: "F"
    },
    G: {
        name: "呼延显",
        description: "24岁汉族男性，天山派内门弟子，第八代大师兄，破阵子之徒，带发修行的僧侣。",
        avatar: "G"
    },
    H: {
        name: "雨烛",
        description: "15岁梵衍那族女性，天山派内门弟子，破阵子之徒。",
        avatar: "H"
    },
    I: {
        name: "安慕",
        description: "18岁汉族女性，天山派外门弟子，伙房主厨。",
        avatar: "I"
    },
    J: {
        name: "唐沐梨",
        description: "20岁汉族女性，蜀中唐门大小姐，天山派客座弟子。",
        avatar: "J"
    },
    K: {
        name: "洛潜幽",
        description: "17岁汉族女性，天山派外门弟子，负责女红织绣和接待贵客。",
        avatar: "K"
    },
    L: {
        name: "神秘杂役",
        description: "天山派杂役，高大肥胖，从不以真面目示人，名字身份来历都未知的神秘人物。",
        avatar: "L"
    },
    // Z: {
    //     name: "新角色Z",
    //     description: "占位描述：这里填写该角色的背景与性格。",
    //     avatar: "Z"
    // },
    M: {
        name: "玄天青",
        description: "31岁汉族男性，天山派岐黄长老，丹药房掌事。",
        avatar: "M"
    },
    N: {
        name: "鹿椿若",
        description: "17岁汉族女性，昆仑派弟子，天山派客座弟子，玄天青的记名弟子。",
        avatar: "N"
    },
    O: {
        name: "苓雪妃",
        description: "26岁汉族女性，天山派侍剑长老，派中第一高手。",
        avatar: "O"
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
    "神秘杂役": "L",
    // "新角色Z": "Z",
    "玄天青": "M",
    "鹿椿若": "N",
    "苓雪妃": "O"
};

// NPC立绘URL映射
const npcPortraits = {
    A: _assetUrl('img/NPC/破阵子.webp'),
    B: _assetUrl('img/NPC/洞庭君.webp'),
    C: _assetUrl('img/NPC/钱塘君.webp'),
    D: _assetUrl('img/NPC/萧白瑚.webp'),
    E: _assetUrl('img/NPC/姬姒.webp'),
    F: _assetUrl('img/NPC/施延年.webp'),
    G: _assetUrl('img/NPC/呼延显.webp'),
    H: _assetUrl('img/NPC/雨烛.webp'),
    I: _assetUrl('img/NPC/安慕.webp'),
    J: _assetUrl('img/NPC/唐沐梨.webp'),
    K: _assetUrl('img/NPC/洛潜幽.webp'),
    L: _assetUrl('img/NPC/神秘杂役.webp'),
    // Z: _assetUrl('img/NPC/杂鱼1.webp'),
    M: _assetUrl('img/NPC/玄天青.webp'),
    N: _assetUrl('img/NPC/鹿椿若.webp'),
    O: _assetUrl('img/NPC/苓雪妃.webp')
};

// 地点背景图映射
const locationBackgrounds = {
    yanwuchang: _assetUrl('img/location/演武场.webp'),
    cangjingge: _assetUrl('img/location/藏经阁.webp'),
    huofang: _assetUrl('img/location/伙房.webp'),
    houshan: _assetUrl('img/location/后山.webp'),
    yishiting: _assetUrl('img/location/议事厅.webp'),
    tiejiangpu: _assetUrl('img/location/铁匠铺.webp'),
    nandizi: _assetUrl('img/location/男弟子房.webp'),
    nvdizi: _assetUrl('img/location/女弟子房.webp'),
    shanmen: _assetUrl('img/location/山门.webp'),
    tianshanpai: _assetUrl('img/location/天山派.webp')
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
    下山: { talentBonus: '心性', affects: '声望' },
    炼丹: { talentBonus: '悟性', affects: '学识' }
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
    L: { type: '金钱', value: 3000 },   // 神秘杂役 - 金钱+1000
    // Z: { type: '声望', value: 1 },
    M: { type: '学识', value: 5 },      // 玄天青 - 岐黄长老，医术知识渊博
    N: { type: '学识', value: 1 },      // 鹿椿若 - 武功平平，略懂医理
    O: { type: '武学', value: 6 }       // 苓雪妃 - 第一高手，武学巅峰
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
        danfang: 0.00,   // 很少去丹房
        none: 0.15
    },
    B: {  // 洞庭君 - 刑罚长老，偶尔视察
        yanwuchang: 0.15,
        cangjingge: 0.10,
        huofang: 0.05,
        houshan: 0.05,
        yishiting: 0.25,
        tiejiangpu: 0.05,
        nandizi: 0.00,
        nvdizi: 0.15,
        shanmen: 0.05,
        gongtian: 0.05,  // 偶尔视察
        danfang: 0.05,   // 偶尔去丹房检查
        none: 0.05
    },
    C: {  // 钱塘君 - 活泼好动，会去公田玩
        yanwuchang: 0.15,
        cangjingge: 0.05,
        huofang: 0.05,
        houshan: 0.20,
        yishiting: 0.05,
        tiejiangpu: 0.10,
        nandizi: 0.00,
        nvdizi: 0.15,
        shanmen: 0.05,
        gongtian: 0.10,  // 去捣乱或帮忙
        danfang: 0.05,   // 好奇去看看
        none: 0.05
    },
    D: {  // 萧白瑚 - 外门弟子，需要参与劳作
        yanwuchang: 0.20,
        cangjingge: 0.05,
        huofang: 0.15,
        houshan: 0.10,
        yishiting: 0.00,
        tiejiangpu: 0.05,
        nandizi: 0.00,
        nvdizi: 0.20,
        shanmen: 0.05,
        gongtian: 0.10,  // 外门弟子劳作
        danfang: 0.05,   // 帮忙打杂
        none: 0.05
    },
    E: {  // 姬姒 - 贪吃，会去看有什么能吃的
        yanwuchang: 0.10,
        cangjingge: 0.10,
        huofang: 0.20,
        houshan: 0.15,
        yishiting: 0.05,
        tiejiangpu: 0.05,
        nandizi: 0.00,
        nvdizi: 0.15,
        shanmen: 0.05,
        gongtian: 0.05,  // 看看有什么能吃的
        danfang: 0.05,   // 对丹药有兴趣
        none: 0.05
    },
    F: {  // 施延年 - 书呆子，对丹药典籍感兴趣
        yanwuchang: 0.05,
        cangjingge: 0.40,
        huofang: 0.05,
        houshan: 0.05,
        yishiting: 0.05,
        tiejiangpu: 0.05,
        nandizi: 0.00,
        nvdizi: 0.10,
        shanmen: 0.05,
        gongtian: 0.05,  // 偶尔去透透气
        danfang: 0.10,   // 研究丹药典籍
        none: 0.05
    },
    G: {  // 呼延显 - 大师兄，可能指导劳作
        yanwuchang: 0.20,
        cangjingge: 0.10,
        huofang: 0.05,
        houshan: 0.15,
        yishiting: 0.10,
        tiejiangpu: 0.05,
        nandizi: 0.10,
        nvdizi: 0.00,
        shanmen: 0.05,
        gongtian: 0.05,  // 偶尔指导
        danfang: 0.05,   // 偶尔来看看
        none: 0.10
    },
    H: {  // 雨烛 - 活泼小天使，会去玩耍
        yanwuchang: 0.15,
        cangjingge: 0.10,
        huofang: 0.15,
        houshan: 0.15,
        yishiting: 0.05,
        tiejiangpu: 0.05,
        nandizi: 0.00,
        nvdizi: 0.15,
        shanmen: 0.05,
        gongtian: 0.10,  // 去玩耍帮忙
        danfang: 0.05,   // 好奇来看看
        none: 0.00
    },
    I: {  // 安慕 - 伙房主厨，需要新鲜食材
        yanwuchang: 0.05,
        cangjingge: 0.00,
        huofang: 0.45,
        houshan: 0.15,
        yishiting: 0.00,
        tiejiangpu: 0.05,
        nandizi: 0.00,
        nvdizi: 0.10,
        shanmen: 0.05,
        gongtian: 0.10,  // 采集食材
        danfang: 0.05,   // 取药材调味
        none: 0.00
    },
    J: {  // 唐沐梨 - 商人，对丹药生意感兴趣
        yanwuchang: 0.10,
        cangjingge: 0.05,
        huofang: 0.10,
        houshan: 0.05,
        yishiting: 0.10,
        tiejiangpu: 0.10,
        nandizi: 0.00,
        nvdizi: 0.20,
        shanmen: 0.15,
        gongtian: 0.05,  // 查看农产品商机
        danfang: 0.05,   // 查看丹药商机
        none: 0.05
    },
    K: {  // 洛潜幽 - 可能去采花装饰
        yanwuchang: 0.05,
        cangjingge: 0.10,
        huofang: 0.10,
        houshan: 0.10,
        yishiting: 0.15,
        tiejiangpu: 0.00,
        nandizi: 0.00,
        nvdizi: 0.25,
        shanmen: 0.05,
        gongtian: 0.05,  // 不需要劳作
        danfang: 0.05,   // 采集药草
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
        danfang: 0.01,   // 神秘出没
        none: 0.89
    },
    // Z: { // 新角色Z - 占位：均衡分布
    //     yanwuchang: 0.10,
    //     cangjingge: 0.10,
    //     huofang: 0.10,
    //     houshan: 0.10,
    //     yishiting: 0.10,
    //     tiejiangpu: 0.10,
    //     nandizi: 0.05,
    //     nvdizi: 0.05,
    //     shanmen: 0.10,
    //     gongtian: 0.05,
    //     danfang: 0.05,   // 均衡分布
    //     none: 0.10
    // },
    M: {  // 玄天青 - 岐黄长老，常在丹房
        yanwuchang: 0.02,
        cangjingge: 0.20,
        huofang: 0.05,
        houshan: 0.15,
        yishiting: 0.10,
        tiejiangpu: 0.00,
        nandizi: 0.05,
        nvdizi: 0.00,
        shanmen: 0.03,
        gongtian: 0.05,
        danfang: 0.30,
        none: 0.05
    },
    N: {  // 鹿椿若 - 采药迷路
        yanwuchang: 0.02,
        cangjingge: 0.05,
        huofang: 0.05,
        houshan: 0.25,
        yishiting: 0.02,
        tiejiangpu: 0.02,
        nandizi: 0.00,
        nvdizi: 0.08,
        shanmen: 0.05,
        gongtian: 0.15,
        danfang: 0.20,
        none: 0.11
    },
    O: {  // 苓雪妃 - 在公田耕种
        yanwuchang: 0.00,
        cangjingge: 0.02,
        huofang: 0.02,
        houshan: 0.15,
        yishiting: 0.05,
        tiejiangpu: 0.00,
        nandizi: 0.00,
        nvdizi: 0.10,
        shanmen: 0.02,
        gongtian: 0.35,
        danfang: 0.02,
        none: 0.27
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

// SLG模式场景同义词映射（用于模糊匹配）
const slgSceneSynonyms = {
    // 沙漠类
    '戈壁': '沙漠', '沙地': '沙漠', '荒漠': '沙漠', '旷野': '沙漠', '黄沙': '沙漠',
    // 山道类
    '山路': '山道', '小径': '山道', '小道': '山道', '崎岖': '山道', '栈道': '山道',
    // 树林类
    '林间': '树林', '森林': '树林', '密林': '树林', '竹林': '树林', '丛林': '树林', '林中': '树林',
    // 水边类
    '河边': '水边', '湖边': '水边', '溪边': '水边', '池塘': '水边', '河畔': '水边', '湖畔': '水边', '溪流': '水边',
    // 村落类
    '小镇': '村落', '村庄': '村落', '聚落': '村落', '乡村': '村落', '镇子': '村落',
    // 山洞类
    '洞穴': '山洞', '岩洞': '山洞', '石洞': '山洞', '洞窟': '山洞', '暗洞': '山洞',
    // 雪山类
    '雪峰': '雪山', '雪岭': '雪山', '雪地': '雪山', '雪原': '雪山',
    // 冰川类
    '冰原': '冰川', '冰湖': '冰川', '冰窟': '冰川', '冰洞': '冰川',
    // 绿洲类
    '绿地': '绿洲', '草地': '绿洲', '草原': '绿洲',
    // 酒肆类
    '酒楼': '酒肆', '酒馆': '酒肆', '酒家': '酒肆', '茶馆': '酒肆', '饭馆': '酒肆',
    // 客房类
    '旅店': '客房', '客栈': '客房', '旅馆': '客房', '房间': '客房', '卧室': '客房', '寝室': '客房', '厢房': '客房',
    // 商铺类
    '店铺': '商铺', '铺子': '商铺', '商店': '商铺', '杂货': '商铺',
    // 市集类
    '集市': '市集', '闹市': '市集', '街市': '市集', '夜市': '市集', '早市': '市集',
    // 废墟类
    '遗迹': '废墟', '残垣': '废墟', '废址': '废墟', '荒废': '废墟', '断壁': '废墟',
    // 寺庙类
    '佛寺': '寺庙', '道观': '寺庙', '庙宇': '寺庙', '古刹': '寺庙', '禅寺': '寺庙', '神庙': '寺庙',
    // 邪教祭坛类
    '祭坛': '邪教祭坛', '邪坛': '邪教祭坛', '血祭': '邪教祭坛',
    // 武侠门派类
    '门派': '武侠门派', '宗门': '武侠门派', '山庄': '武侠门派', '帮派': '武侠门派',
    // 宫殿类
    '大殿': '宫殿', '殿堂': '宫殿', '皇宫': '宫殿', '王宫': '宫殿', '金殿': '宫殿',
    // 庭院类
    '庭园': '庭院', '花园': '庭院', '院子': '庭院', '天井': '庭院', '后院': '庭院', '前院': '庭院',
    // 府邸类
    '府宅': '府邸', '宅院': '府邸', '豪宅': '府邸', '大宅': '府邸', '宅子': '府邸',
    // 军营类
    '兵营': '军营', '营帐': '军营', '营地': '军营', '军帐': '军营',
    // 山谷类
    '峡谷': '山谷', '幽谷': '山谷', '深谷': '山谷', '溪谷': '山谷',
    // 街道类
    '大街': '街道', '小巷': '街道', '巷子': '街道', '长街': '街道', '胡同': '街道'
};

// GameMode=0 → 1 切换时，LLM 可能受历史上下文影响仍输出的旧版（普通模式）地点名
// 命中这批名称时，走旧的 img/location/{name}_{昼|夜}.webp 图片规则（兜底，见 matchScene / updateStoryDisplay）
const legacySceneOptions = [
    '议事厅',
    '藏经阁',
    '伙房',
    '铁匠铺',
    '后山',
    '男弟子房',
    '女弟子房',
    '丹房'
];

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

// SLG模式表情同义词映射（用于模糊匹配）
const slgEmotionSynonyms = {
    // 大笑类
    '狂笑': '大笑', '开心': '大笑', '欢笑': '大笑', '高兴': '大笑', '喜悦': '大笑',
    // 微笑类
    '浅笑': '微笑', '含笑': '微笑', '笑容': '微笑', '轻笑': '微笑', '温柔': '微笑',
    // 平静类
    '冷静': '平静', '淡然': '平静', '从容': '平静', '无表情': '平静', '面无表情': '平静', '普通': '平静', '正常': '平静', '默然': '平静',
    // 生气类
    '愤怒': '生气', '恼怒': '生气', '发火': '生气', '怒气': '生气', '暴怒': '生气', '气愤': '生气',
    // 兴奋类
    '激动': '兴奋', '亢奋': '兴奋', '期待': '兴奋', '热情': '兴奋',
    // 不满类
    '嫌弃': '不满', '厌恶': '不满', '反感': '不满', '嫌恶': '不满', '不悦': '不满', '皱眉': '不满',
    // 严肃类
    '认真': '严肃', '肃穆': '严肃', '凝重': '严肃', '郑重': '严肃', '正经': '严肃',
    // 害羞类
    '羞涩': '害羞', '脸红': '害羞', '羞红': '害羞', '娇羞': '害羞', '含羞': '害羞', '羞怯': '害羞',
    // 尴尬类
    '窘迫': '尴尬', '困窘': '尴尬', '难堪': '尴尬', '局促': '尴尬',
    // 为难类
    '犹豫': '为难', '迟疑': '为难', '踌躇': '为难', '左右为难': '为难', '纠结': '为难',
    // 惊讶类
    '震惊': '惊讶', '吃惊': '惊讶', '诧异': '惊讶', '惊愕': '惊讶', '惊奇': '惊讶', '错愕': '惊讶',
    // 紧张类
    '不安': '紧张', '焦虑': '紧张', '慌乱': '紧张', '局促不安': '紧张',
    // 害怕类
    '恐惧': '害怕', '惊恐': '害怕', '畏惧': '害怕', '惧怕': '害怕', '惊吓': '害怕', '胆怯': '害怕',
    // 悲伤类
    '难过': '悲伤', '伤心': '悲伤', '哀伤': '悲伤', '忧伤': '悲伤', '痛苦': '悲伤', '悲痛': '悲伤',
    // 哭泣类
    '流泪': '哭泣', '落泪': '哭泣', '泪目': '哭泣', '眼泪': '哭泣', '泣不成声': '哭泣',
    // 得意类
    '自豪': '得意', '骄傲': '得意', '自得': '得意', '洋洋得意': '得意', '嘚瑟': '得意', '傲娇': '得意',
    // 发情类
    '情动': '发情', '动情': '发情', '渴望': '发情', '欲望': '发情', '媚眼': '发情', '迷离': '发情', '春情': '发情'
};

// SLG模式可选表情配置
// 注意：除以下固定选项外，还支持"特殊CGx"格式（x为任意数字，如：特殊CG1、特殊CG999）
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

// 场景语义关键词兜底映射（用于处理LLM幻觉输出）
// 当所有匹配方式都失败时，检查输入是否包含这些关键字
// 注意：按优先级排列，多字关键词在前，遍历时先匹配到的生效
const sceneSemanticKeywords = {
    // ===== 多字关键词（优先匹配）=====
    '悬崖': '山道',
    '峭壁': '山道',
    '山顶': '雪山',
    '山巅': '雪山',
    '峰顶': '雪山',
    '冰雪': '冰川',
    '监狱': '地牢',
    '牢房': '地牢',
    '火山': '熔岩洞',
    '岩浆': '熔岩洞',
    '佛洞': '石窟',
    '练武': '演武场',
    '比武': '演武场',
    '擂台': '演武场',
    '皇城': '宫殿',
    '王城': '宫殿',
    
    // ===== 单字关键词 =====
    // 山岳类
    '峰': '雪山',
    '巅': '雪山',
    '岭': '雪山',
    '崖': '山道',
    '坡': '山道',
    '径': '山道',
    '山': '山道',
    // 水域类
    '河': '水边',
    '湖': '水边',
    '溪': '水边',
    '泉': '水边',
    '潭': '水边',
    '瀑': '水边',
    '江': '水边',
    // 植被类
    '林': '树林',
    '森': '树林',
    // 洞穴类
    '洞': '山洞',
    '穴': '山洞',
    '窟': '石窟',
    '窖': '地牢',
    // 建筑-门派类
    '派': '武侠门派',
    '宗': '武侠门派',
    '帮': '武侠门派',
    // 建筑-居住类
    '庄': '府邸',
    '府': '府邸',
    '宅': '府邸',
    '院': '庭院',
    '园': '庭院',
    '殿': '宫殿',
    '宫': '宫殿',
    '房': '客房',
    '室': '客房',
    // 建筑-商业类
    '店': '商铺',
    '铺': '商铺',
    '市': '市集',
    '坊': '市集',
    // 建筑-宗教类
    '寺': '寺庙',
    '庙': '寺庙',
    '观': '寺庙',
    '祠': '寺庙',
    '坛': '邪教祭坛',
    // 聚落类
    '城': '街道',
    '镇': '村落',
    '村': '村落',
    '寨': '村落',
    '营': '军营',
    '帐': '军营',
    '门': '街道',
    // 地形类
    '谷': '山谷',
    '峡': '山谷',
    '漠': '沙漠',
    '沙': '沙漠',
    '荒': '沙漠',
    '冰': '冰川',
    '雪': '雪山',
    '草': '绿洲',
    '牢': '地牢',
    '狱': '地牢'
};

// 表情语义关键词兜底映射（用于处理LLM幻觉输出）
const emotionSemanticKeywords = {
    // 正面情绪
    '笑': '微笑',
    '乐': '大笑',
    '喜': '大笑',
    // 负面情绪
    '怒': '生气',
    '愤': '生气',
    '气': '生气',
    '哭': '哭泣',
    '泪': '哭泣',
    '泣': '哭泣',
    '悲': '悲伤',
    '伤': '悲伤',
    '哀': '悲伤',
    '忧': '悲伤',
    // 恐惧紧张类
    '怕': '害怕',
    '惧': '害怕',
    '恐': '害怕',
    '慌': '紧张',
    '急': '紧张',
    '焦': '紧张',
    // 羞涩类
    '羞': '害羞',
    '臊': '害羞',
    '红': '害羞',
    // 惊讶类
    '惊': '惊讶',
    '讶': '惊讶',
    '愕': '惊讶',
    // 其他
    '傲': '得意',
    '骄': '得意',
    '媚': '发情',
    '欲': '发情',
    '情': '发情',
    '静': '平静',
    '淡': '平静',
    '肃': '严肃',
    '正': '严肃'
};

// 危险度对应的事件概率
const dangerEventChance = {
    '低': { battle: 0, random: 10 },      // 战斗5%，随机事件10%
    '较低': { battle: 5, random: 10 },    // 战斗8%，随机事件10%
    '中': { battle: 10, random: 10 },     // 战斗12%，随机事件10%
    '较高': { battle: 15, random: 10 },   // 战斗16%，随机事件10%
    '高': { battle: 25, random: 10 }      // 战斗25%，随机事件10%
};

// 默认游戏数据
const defaultGameData = {
    playerName: "主角",    // 角色名称
    userLocation: "tianshanpai",
    userBackground: "A", // 新增：角色出身编码（A 农家子弟，B 府兵军户，C 经史传家，D 天潢贵胄，E 自定义）
    userOriginDesc: "", // 自定义出身时的背景描述（userBackground===E时生效）
    textFontLevel: 2, // 新增：正文字体档位（1~5），默认第二档
    uiStyle: 0, // 新增：UI风格（0=古风UI，1=扁平化UI）
    playerTalents: { "根骨": 25, "悟性": 25, "心性": 25, "魅力": 25 },
    playerStats:   { "武学": 20, "学识": 20, "声望": 20, "金钱": 500 },
    combatStats:   { "攻击力": 20, "生命值": 50, "暴击率": 10, "暴击伤害": 150, "格挡": 0, "穿甲": 0, "回转": 0, "吸血": 0, "反伤": 0 },
    equipStats:    { "攻击力": 0, "生命值": 0, "暴击率": 0, "暴击伤害": 0, "格挡": 0, "穿甲": 0, "回转": 0, "吸血": 0, "反伤": 0, "根骨": 0, "悟性": 0, "心性": 0, "魅力": 0 },
    playerMood: 100,
    martialArts: {
        "太白仙迹": 0, "岱宗如何": 0, "掠风窃尘": 0, "流云飞袖": 0,
        "惊鸿照影": 0, "踏雪无痕": 0, "醉卧沙场": 0, "万剑归宗": 0
    },
    npcFavorability: { "A": 0,"B": 0,"C": 0,"D": 0,"E": 0,"F": 0,"G": 0,"H": 0,"I": 0,"J": 0,"K": 0,"L": 0, /* "Z": 0, */ "M": 0, "N": 0, "O": 0},
    weekStartFavorability: { "A": 0,"B": 0,"C": 0,"D": 0,"E": 0,"F": 0,"G": 0,"H": 0,"I": 0,"J": 0,"K": 0,"L": 0, /* "Z": 0, */ "M": 0, "N": 0, "O": 0},  // 新增：记录本周开始时的好感度快照
    actionPoints: 3,
    currentWeek: 1,
    dayNightStatus: 'daytime',  // 新增：昼夜状况 'daytime' 或 'night'
    seasonStatus: 'winter',      // 新增：四季状况 'spring', 'summer', 'autumn', 'winter'
    npcLocations: { "A":"none","B":"yishiting","C":"yishiting","D":"shanmen","E":"nvdizi","F":"cangjingge","G":"yanwuchang","H":"houshan","I":"huofang","J":"tiejiangpu","K":"nvdizi","L":"none",/* "Z":"none", */"M":"danfang","N":"danfang","O":"none"},
    GameMode: 0,  // 游戏模式，0=普通模式，1=SLG模式
    difficulty: 'normal', // 默认难度 
    npcVisibility: { "A": true,"B": true,"C": true,"D": true,"E": true,"F": true,"G": true,"H": true,"I": true,"J": true,"K": true,"L": true, /* "Z": true, */ "M": true, "N": true, "O": false}, // 新增：NPC是否显示
    npcGiftGiven: { "A": false,"B": false,"C": false,"D": false,"E": false,"F": false,"G": false,"H": false,"I": false,"J": false,"K": false,"L": false, /* "Z": false, */ "M": false, "N": false, "O": false}, // 新增：本周是否已送礼
    npcSparred: { "A": false,"B": false,"C": false,"D": false,"E": false,"F": false,"G": false,"H": false,"I": false,"J": false,"K": false,"L": false, /* "Z": false, */ "M": false, "N": false, "O": false}, // 新增：本周是否已切磋
    lastFarmWeek: 1,  // 新增：上次耕种的周数
    farmGrid: [],     // 新增：农场地块状态
    inventory: {}, 
    equipment: {
        "武器": null,
        "防具": null,
        "饰品1": null,
        "饰品2": null
    },
    learnedSkills: {},
    equippedSkills: {},
    lastUserMessage: "",     // 已存在：储存上轮用户输入
    summary_Small: "",
    summary_Week: "",
    summary_Backup: "",
    newWeek: 0,
    markWeek: 1,           // 新增：最近一次新周开始时的周数
    randomEvent: 0,       // 随机事件标记
    battleEvent: 0,       // 战斗事件标记
    companionNPC: [],     // 随行NPC数组
    mapLocation: '天山派', // 地图位置
    cgContentEnabled: false,  // 新增：CG内容开关（默认关）
    compressSummary: false,    // 新增：强力总结（默认关）
    haveEvent: 1,              // 新增：随机事件开关（1=开，0=关）
    enamor: 0,              // 新增：倾慕触发标记（默认0）
    alchemyDone: false,      // 新增：本周是否已炼丹（默认false）
    triggeredEvents: [],     // 新增：已触发的特殊事件ID列表
    currentSpecialEvent: "", // 新增：当前触发的特殊事件ID
    inputEnable: 1,          // 新增：自由行动输入框可用状态（1=可用，0=不可用）
    bgmName: '',             // BGM：当前正在播放的BGM路径（战斗BGM期间不更新此字段）
    bgmEnabled: true,        // BGM：是否开启（通过音乐设置弹窗控制）
    bgmVolume: 0.5,          // BGM：音量，范围 0.0~1.0（通过音乐设置弹窗控制）
    recallConfig: {          // 新增：<RecalledMemories> 召回管理（通过 系统设置-游戏设置-召回管理 弹窗控制）
        previous:  { enabled: true, maxTokens: 20000 }, // <PreviousMemories>（weekHistory，超限保留较新/丢弃较旧）
        facts:     { enabled: true, maxTokens: 2000 },  // [已确立事实]
        arcs:      { enabled: true, maxTokens: 1000 },  // [人物弧光]
        events:    { enabled: true, maxTokens: 5000 },  // [相关历史事件]
        fragments: { enabled: true, maxTokens: 3000 }   // [相关碎片记忆]
    },
    summaryConfig: {         // 新增：总结管理（通过 系统设置-游戏设置-总结管理 弹窗控制）
        weekly: { enabled: true },  // 每周总结（runSummary），触发时机不变，仅控制开关
        event:  { enabled: true, turnsPerBatch: 10 },  // 事件总结（runEventSum），触发时机不变，仅控制开关；
                                                        // turnsPerBatch 是自适应 eventStep 的归位基线（×2＝eventStep），
                                                        // 防止「卡长场景 step+=10」正常入库归位时被硬编码默认值覆盖
        location: { enabled: true }  // 地点更新（location-runner.runLocationUpdate），触发时机不变，仅控制开关
    },
    locationVisit: null      // 新增：当前"下山地点"访问会话的临时标记（{active,location,startUiIndex,startWeek}），返回天山派时清空
};

// === BGM 配置 ===
// 支持情绪BGM的基调名称（不含"平淡"，平淡走地点逻辑）
const bgmMoodOptions = ['紧张', '激昂', '欢快', '悲伤', '暧昧', '钱塘君剧情1'];

// 情绪BGM及战斗BGM文件清单（路径必须与磁盘文件名完全一致）
const bgmFileManifest = {
    钱塘君剧情1: [
        'bgm/钱塘君剧情1/林蝉 - 龙脉长歌.mp3'
    ],
    紧张: [
        'bgm/紧张/晚鐘聲 千燈行 (活俠傳遊戲配樂).mp3'
    ],
    激昂: [
        'bgm/激昂/OPUS龍脈常歌原聲帶15. Our Name Was Known Across the Stars OPUS_ Echo of Starsong OST.mp3',
        'bgm/激昂/唐門薪火 自古如今 (活俠傳遊戲配樂).mp3',
        'bgm/激昂/歷劫知俠氣 (活俠傳遊戲配樂).mp3'
    ],
    欢快: [
        'bgm/欢快/得意須盡歡 (活俠傳遊戲配樂).mp3',
        'bgm/欢快/每天都歡似過年 (活俠傳遊戲配樂).mp3'
    ],
    悲伤: [
        'bgm/悲伤/OPUS龍脈常歌原聲帶14. If Its With You, Then I Would Love To See It OPUS_ Echo of Starsong OST.mp3',
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

// 平淡BGM文件清单（按地图位置分类，兜底位置为天山派）
const bgmPingdanManifest = {
    '天山派':     ['bgm/平淡/天山派/青山新歌謠 (活俠傳遊戲配樂).mp3'],
    '伊州':       ['bgm/平淡/伊州/鼎沸煙火氣 (活俠傳遊戲配樂).mp3'],
    '千佛洞':     ['bgm/平淡/千佛洞/彿門清淨.mp3'],
    '博斯坦村':   ['bgm/平淡/博斯坦村/山中好歲月 (活俠傳遊戲配樂).mp3'],
    '博格达峰':   ['bgm/平淡/博格达峰/山野煮雨 - 小野.mp3'],
    '哈密绿洲':   ['bgm/平淡/哈密绿洲/柔兹兰站在河岸上 (feat. 鲍捷).mp3'],
    '大沙海':     ['bgm/平淡/大沙海/Dannagh Desert - Xenoblade Chronicles 3 OST.mp3'],
    '天山派外堡': ['bgm/平淡/天山派外堡/猜猜無猜心 (活俠傳遊戲配樂).mp3'],
    '崆峒派':     ['bgm/平淡/崆峒派/錦繡織歲玄燭照心 (活俠傳遊戲配樂).mp3'],
    '拜火教总坛': ['bgm/平淡/拜火教总坛/鬼門開 (活俠傳遊戲配樂).mp3'],
    '昆仑派':     ['bgm/平淡/昆仑派/雨後松林香 (活俠傳遊戲配樂).mp3'],
    '月牙泉':     ['bgm/平淡/月牙泉/Lcz-Sv《镜湖》【Hi-Res】.mp3'],
    '沙州':       ['bgm/平淡/沙州/仙境傳說RO音樂BGM 79 龍之城 洛陽 雄偉 The Great 라그나로크 온라인 ラグナロクオンライン大傑音樂.mp3'],
    '瓜州':       ['bgm/平淡/瓜州/仙劍奇俠傳三樂曲玄色風重樓主題.mp3'],
    '白驼山':     ['bgm/平淡/白驼山/燕雲十六聲 4K MV26  玉門關 (河西) [WhereWindsMeet] Yumen Pass BGM (Hexi).mp3'],
    '迪坎儿村':   ["bgm/平淡/迪坎儿村/OPUS龍脈常歌原聲帶5. Veteran's Abode Guifang OPUS_ Echo of Starsong  OST.mp3"],
    '高昌':       ['bgm/平淡/高昌/敕勒歌.mp3'],
    '龟兹':       ['bgm/平淡/龟兹/玉珠盘.mp3']
};
