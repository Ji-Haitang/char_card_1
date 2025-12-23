/**
 * special-event.js - 特殊事件管理
 * 
 * 文件概述：
 * 定义和管理特殊事件，在跳过一周时检查条件并触发符合条件的事件。
 * 支持复杂的条件检查、变量修改和预设文本发送。
 * 
 * 主要功能：
 * 1. 定义特殊事件数据结构
 * 2. 检查事件触发条件
 * 3. 应用事件效果（修改游戏变量）
 * 4. 发送预设的事件文本
 * 5. 防止事件重复触发
 * 
 * 对外暴露的主要函数：
 * - checkSpecialEvents(): 检查是否有符合条件的特殊事件
 * - triggerSpecialEvent(event): 触发指定的特殊事件
 * 
 * 依赖关系：
 * - 依赖 game-state.js 中的状态变量
 * - 依赖 game-utils.js 中的渲染环境检测函数
 */

// ==================== 特殊事件定义 ====================
/**
 * 事件数据结构说明：
 * {
 *   id: string,           // 唯一标识符，用于防止重复触发
 *   name: string,         // 事件名称（调试用）
 *   priority: number,     // 优先级，数字越大越优先检查
 *   conditions: {         // 触发条件，全部满足才触发
 *     variablePath: {     // 变量路径，支持嵌套如 "npcFavorability.C"
 *       min: number,      // 最小值（可选）
 *       max: number,      // 最大值（可选）
 *       equals: any,      // 精确匹配（可选）
 *       in: array         // 值在数组中（可选）
 *     }
 *   },
 *   effects: {            // 触发后的变量修改
 *     variablePath: value | { add: number } | { set: value }
 *   },
 *   text: string          // 要发送的预设文本（SLG_MODE格式）
 * }
 */

const specialEvents = [
    {
        id: "Apprenticeship_Storyline_1",
        name: "拜师剧情1",
        priority: 100,
        conditions: {
            currentWeek: { min: 2 }  // 第2周（第一个月末）
        },
        effects: {
            GameMode: { set: 1 },
            inputEnable: { set: 0 },
            mapLocation: { set: '天山派外堡' },  
            companionNPC: { push: '苓雪妃' }
        }, 
        text: `<SLG_MODE>

<MAIN_TEXT>
新的一周，某日，官道上，阳光有些刺眼。你骑在马上，感觉屁股都快颠成八瓣了——这该死的劣马，跑起来跟抽风似的，四条腿各干各的，仿佛它们之间有什么深仇大恨。同行的是四个和你一样刚入门不久的外门弟子，大家都穿着劲装便服，腰间挎着长剑，看上去倒是有几分江湖中人的样子。|none|沙漠|none|none

你左侧那个叫阿福的少年小声问道：「师兄，咱们和车队约好碰头的地方就是前面的驿站吗？」他遥指远处那座破败的驿站。你点头回应，这次下山，你们领命去接应采买粮食的车队，照理说只是再寻常不过的日常，但是不知为何，从刚才开始你心中一阵忐忑不安——就像小时候偷吃了供桌上的贡品，总觉得下一秒就要遭报应。但你什么也没说，只是下意识地握紧了剑柄。|none|沙漠|none|none

很快你们策马抵达了驿站。破败的土墙，坍塌的门楼，周围是枯黄的戈壁草滩，风吹过，卷起细碎的沙砾，打在脸上生疼。周围太安静了，官道上连个人影都没有，驿站里也没有半点动静。按理说，车队应该早就到了才对。你发现驿站门前的官道上有车辙印，看深浅应该不出半日，但是车队却不见踪迹……你心跳突然加速：「不对，这里有问题——」|none|废墟|none|none

砰！一声闷响，阿福突然从马上栽了下去，胸口插着一支箭羽还在颤动的重箭。你的喊声还没出口，破空声已经从四面八方响起，密集的箭雨如蝗群般破空而来。你本能地侧身，一支箭矢擦着你的肩膀飞过，带起一片布料。身后传来惨叫——你回头一看，一名师兄连人带马轰然倒地，三支箭同时命中了他，肩膀、大腿、还有一支直接钉在了马背上。|none|沙漠|none|none

「该死！」你猛地拨转马头，「快跑！往回——」话还没说完，官道两侧的沙丘后涌出一队全副武装的骑兵。黑色的战甲，猩红的披风，手持弯刀和强弓——是西夏擒生军！至少有三十骑！为首那个军官脸上带着狰狞的笑容，用生硬的汉语喊道：「天山派的崽子们！今天一个都别想跑！」你的脑子瞬间转了起来：车队恐怕已经全灭，敌军早就埋伏好了——情报泄露了！这是个陷阱！「跑！」你嘶吼道，「分散跑！回门派求援！」|none|沙漠|none|none

追兵的马蹄声在身后响起，如同滚雷。你拼命地挥动缰绳，恨不得自己也长出四条腿。余光瞥见身后的擒生军熟练地在马上张弓搭箭，破空声再次响起！你下意识地俯身，一支箭矢擦着头顶飞过，射断了几根头发。心脏在胸腔里狂跳，喉咙发干，冷汗顺着脊背往下流。你左后方的师弟惨叫一声，被一箭射中后背，从马上翻滚下去。现在只剩你和另一个叫狗娃的少年了。|none|沙漠|none|none

「不要回头！」你嘶吼，「跑！告诉门派！擒生军摸清了咱们的运粮路线！」你们疯狂地策马狂奔，身后的追兵越来越近，你能听到他们的喊声，能听到弓弦拉动的声音。距离外堡还有二十多里，你不知道自己能不能跑回去，但你必须跑——至少要有一个人活着回去，把消息传回去！狗娃的马突然一个趔趄，差点摔倒。你看了一眼，他的马腿上插着一支箭。「师兄！我马受伤了！」狗娃的声音里带着哭腔。|none|沙漠|none|none

你咬了咬牙，还没来得及说什么，却听到身后又是一声闷响——狗娃从马上栽了下去，后脑插着一支箭羽。他的马惊叫着冲出几步，又轰然倒地。你咬紧牙关，拼命地抽打马鞭，劣马吃痛，发出凄厉的嘶鸣，四蹄翻飞。泪水模糊了你的视线，你用袖子胡乱抹了一把，一起下山的师兄弟全死了，就剩你一个人了。「该死！该死！该死！」你一边跑一边骂，不知道是在骂敌人，还是在骂自己的无能。|none|沙漠|none|none

奇怪的是，身后的箭雨突然停了。你愣了一下，下意识地回头看——那队擒生军依然紧追不舍，但确实没有继续放箭了，他们保持着大约七十步的距离，不紧不慢地跟着你。你心中疑惑：「为什么不射？难道箭用完了？不对，他们刚才射了那么多箭，绝对还有存货。那为什么……」前方的地形你很熟悉——再有十里，就是通往门派的峡谷入口了！只要冲进峡谷，穿过那条狭窄的通道，就能抵达天山派的外堡！希望就在眼前！|none|山谷|none|none

你的心跳得更快了，劣马似乎也感觉到了，拼尽最后的力气狂奔。风在耳边呼啸，你能看到远处那道熟悉的山崖轮廓——那里就是回家的路！你心中突然闪过一个念头：「可是……为什么追兵还不射箭？」一个念头在脑海里炸开——他们在跟踪你！他们想让你活着回去，想让你把他们带到天山派的隐藏入口！你的心一下子凉透了。西夏擒生军一直在找天山派的所在，可峡谷入口藏得极隐蔽，外人根本找不到。而你现在就像一只慌不择路的兔子，正要把狼群引向自己的窝。外堡里还有几千难民——老人、孩子、妇女——都是这些年天山派救下的无辜百姓，如果西夏人找到入口，如果他们把这个消息带回擒生军大营……你不敢想下去。|none|山谷|none|none
</MAIN_TEXT>

<SUMMARY>
你与四名外门师兄弟奉命前往驿站接应运粮车队，途中心生不祥预感。抵达后发现驿站空无一人，车队不知所踪。突然遭到西夏擒生军伏击，阿福、狗娃等师兄弟相继中箭身亡，仅你一人拼死逃脱。追兵却突然停止射箭，保持距离跟踪。你恍然大悟——敌人是想利用你找到天山派隐蔽的峡谷入口，外堡内还有数千无辜难民，你陷入两难绝境。
</SUMMARY>

<SIDE_NOTE>
{
    "随机事件": {
        "事件类型": "选项事件",
        "事件描述": "西夏擒生军紧追不舍，你意识到他们想利用你找到天山派入口。继续逃往峡谷将暴露门派位置，停下则必死无疑。",
        "选项一": {
            "描述": "特殊剧情: 继续",
            "奖励": "",
            "成功率": "100%"
        }
    },
    "时间": "10:30",
    "用户": {
        "位置变动": "山道"
    },
    "当前NPC": {}
}
</SIDE_NOTE>

</SLG_MODE>`
    },
    {
        id: "Apprenticeship_Storyline_2",
        name: "拜师剧情2",
        priority: 99,
        conditions: {
            currentSpecialEvent: { equals: 'Apprenticeship_Storyline_1' } 
        },
        effects: {},  // 无属性变化
        text: `<SLG_MODE>

<MAIN_TEXT>
你强迫自己深呼吸，故意放慢了马速，劣马正好也跑得气喘吁吁，一听你收紧缰绳，立刻慢了下来。身后的马蹄声也慢了下来。你心一沉——果然！他们在跟踪你！「该死的杂碎……」你低声骂道，手心里全是冷汗。你深吸一口气，心脏狂跳。「对不起了……爹娘……」前方出现了一个岔路口——左边通往峡谷，右边是一片人迹罕至的山林，里面到处是野兽和毒虫，连猎户都不愿意进去，据外堡的说书先生讲，这林子深处还住着厉鬼，进去的人都会失踪。你猛地一拉缰绳，劣马嘶鸣着转向右侧，冲进了茂密的林子。|none|山道|none|none

「嗯？那小子朝右边了！」身后传来擒生军的喊声，「追！别让他跑了！」你咬着牙，拼命往林子深处钻。树枝刮破了衣服，划伤了脸颊，你根本顾不上。劣马在树林里跑得跌跌撞撞，几次差点摔倒。十里、十一里、十二里……你不知道自己跑了多久，只知道天色渐暗，林子里的光线越来越暗。劣马的呼吸声像风箱一样，四条腿在打颤。「再坚持一下……再坚持一下……」你轻轻拍了拍劣马的脖子，给它鼓劲，又像是喃喃自语。|none|山道|none|none

突然——咔嚓！劣马的前蹄踩到一根横在地上的树根，整匹马一头栽了下去！你被甩出去，在地上翻滚了好几圈，背部撞在一棵树上，疼得眼前发黑。劣马躺在地上抽搐着，发出凄厉的嘶鸣。身后的马蹄声越来越近。你浑身都在疼，肋骨可能断了几根，左手臂也动不了了，嘴里全是血腥味。但你还是踉踉跄跄地站起来。你的手摸向腰间的剑柄——那是入门时发的制式长剑，你连剑法都没学全，平时最多就是劈劈柴，偶尔还差点劈到自己的脚。|none|山道|none|none

铮——出鞘声在寂静的林子里格外清脆。你右手握剑，摆出尚未熟练的起手式——虽然姿势肯定歪七扭八，虽然双腿在打颤，虽然你知道自己根本不是那些精锐骑兵的对手。但你不能给天山派丢脸。「来吧……杂碎们……」你握紧了剑。擒生军的骑兵们策马围拢上来，为首的军官冷笑着举起弯刀：「给我抓活的，到时候把他手指挨个掰断，不信他不招天山派的贼窟在哪。」你咬紧牙关，右手握剑，尽管知道自己根本不是对手，但至少——至少要站着死。|none|山道|none|none

「呵，还挺有骨气——」仿佛是幻听，不知哪里传来女声，随即一道黑影如鬼魅般从林间闪过。咔嚓！为首的军官脑袋被拧到背后，他瞪大眼睛，一声呻吟都来不及发出就直挺挺从马上栽了下去。「什么——！」其他擒生军还没反应过来，黑影又往复闪过。随着一声声闷响，又有几个倒霉蛋被拧断了脖子落马坠地。你甚至看不清那影子是怎么动的——只能看到残影掠过，然后就有人倒地。「鬼！是鬼！」「快跑——！」剩下的擒生军吓破了胆，调转马头就要逃。|none|山道|none|none

但为时已晚——黑影在林间穿梭，每一次闪现都带走一条人命，轻功之快，简直不像人类能做到的。不到盏茶工夫，三十多个擒生军精锐，全军覆没。林子里重新陷入寂静。你的心脏狂跳，冷汗顺着脊背往下流。你突然想起外堡的传闻——这片林子深处住着厉鬼……你心中发毛：「该不会……真的是鬼吧？」你喃喃自语，下意识地后退，剑尖对准四周。|none|山道|none|none

风吹过树梢，发出诡异的呜呜声。夕阳的余晖把树影拉得很长，像一只只张牙舞爪的怪物。你的手在发抖，但还是死死握着剑——哪怕是鬼，你也要拼一把！又退了两步。突然——你的后背撞在了什么柔软温热的东西上。不对！是人！有人站在你身后！「啊——！」你惊叫一声，本能地转身，手中长剑横扫而出！铮——剑刃在空中划出一道寒光，却在距离对方咽喉三寸的地方突然停住了。|苓雪妃|山道|特殊CG1|none

对方只是轻描淡写地伸出两根手指，就夹住了你全力挥出的剑刃——就像夹一根筷子那么轻松。你这才看清面前的人。那是一个女子，准确说，是一个美得让人屏息的女子——哪怕她脸上写满了疲惫和冷漠，浑身上下散发着生人勿近的冰冷气息。乌黑的长发略显凌乱，白衫黑裙外罩着黑色貂裘披风，赤红色的眼眸冷冷地打量着你。最引人注目的是她头顶那对黑色的下垂兔耳——在夕阳余晖下微微晃动。|苓雪妃|山道|特殊CG1|none

「你……」你的声音在发颤，「你是……」「妾身正要问你，」女子松开夹着剑刃的手指，语气冰冷，「擅闯禁林，所为何事？」她的眼神越来越冷，像是在看一只不知死活的虫子：「这林子已经荒废多年，妾身也在此清净多时。你是头一个闯进来的。」你这才意识到——刚才杀光那些擒生军的，就是眼前这个女子！而且，她明显不欢迎你。|苓雪妃|山道|严肃|none
</MAIN_TEXT>

<SUMMARY>
你意识到擒生军在跟踪你想找到天山派入口，于是冒险冲入传闻有厉鬼的禁林。逃亡途中劣马摔倒，你身负重伤被敌军包围。危急时刻，一道黑影从林间闪出，瞬间全歼三十余名擒生军。你惊恐中发现救你的是一名美貌女子——黑发红眸，头顶垂着一对黑色兔耳。她语气冰冷地质问你为何擅闯禁林，显然对你的到来并不欢迎。
</SUMMARY>

<SIDE_NOTE>
{
    "随机事件": {
        "事件类型": "选项事件",
        "事件描述": "神秘的兔耳女子救了你，但她对你的闯入显然十分不满。你身负重伤，必须设法解释自己的来意并取得她的信任。",
        "选项一": {
            "描述": "特殊剧情: 继续",
            "奖励": "",
            "成功率": "100%"
        }
    },
    "时间": "15:30",
    "用户": {
        "位置变动": "树林"
    },
    "当前NPC": {
        "苓雪妃": {
            "好感变化": "不变",
            "位置变动": "树林"
        }
    }
}
</SIDE_NOTE>

</SLG_MODE>`
    },
    {
        id: "Apprenticeship_Storyline_3",
        name: "拜师剧情3",
        priority: 98,
        conditions: {
            currentSpecialEvent: { equals: 'Apprenticeship_Storyline_2' } 
        },
        effects: {},  // 无属性变化
        text: `<SLG_MODE>

<MAIN_TEXT>
「我、我不是故意闯进来的！」你连忙解释，声音因为紧张而有些结巴，「我是天山派外门弟子！今天奉命去接应门派采买粮食的车队，结果遭到西夏擒生军埋伏——」你一口气把事情的来龙去脉说了出来：同伴全部阵亡，自己被追杀，意识到敌人想利用自己找到天山派入口，所以故意把他们引到这片林子里来。「为了不让他们找到外堡，我只能往这边跑……」你咽了口唾沫，「我真的不知道这里是前辈您隐居的地方……对不起！」|苓雪妃|树林|平静|none

女子面无表情地听完，赤红色的眼眸在你身上扫了一遍，最后落在你那件破破烂烂、沾满血污的天山派制式劲装上。「天山派……」她喃喃自语，语气中带着一丝复杂的情绪，「呵。」她突然冷笑一声：「为了保护门派，宁可把追兵引向未知的险地，把自己置于死地？」「是。」你点点头。「愚蠢。」她淡淡地吐出两个字，「以一己之命，能换来什么？现在的天山派，多你一个不多，少你一个不少。」她的话像刀子一样扎在你心上，但你没有反驳——因为你知道她说的是实话。|苓雪妃|树林|不满|none

她的目光最后定格在你那还死死握着剑柄的手上——虽然剑尖在发抖，但你始终没有松开。「身体挺直。」她突然道。「啊？」「让妾身看看你的站姿。」你愣了一下，忍着疼痛站直了身体，摆出才学了一个月的起手式。虽然浑身都在痛，虽然姿势肯定歪七扭八，但你还是努力做到最好。女子盯着你看了一会儿，突然走了过来。|苓雪妃|树林|平静|none

「重心偏了。」她用脚尖踢了踢你的左脚，力道不重，但你差点摔倒，「握剑的手腕太僵硬。剑意散乱。」「我……」「闭嘴。」她绕着你转了一圈，就像在打量一件次品，「根骨平庸，资质低劣。内力薄弱，剑法稀烂。」每一句话都像刀子一样扎在你心上。「这就是天山派现在的弟子水平？」她冷笑，「难怪……」她没说完，但语气里的轻蔑和失望让你脸上发烧。你心里腹诽：「这前辈武功虽高，但是嘴巴也太毒了，但凡她嘴下留情一点，我也不至于想找个地缝钻进去。」嘴上却一句话不敢说。|苓雪妃|树林|特殊CG2|none

「不过……」她突然停下脚步，站在你面前，「面对必死之局，没有跪地求饶，也没有临阵脱逃。宁可把敌人引入险地，也不出卖门派。」她的眼神依然冷淡，「算是有几分气节。」你愣住了。这是……夸奖？|苓雪妃|树林|特殊CG2|none

「妾身实在看不下去现在天山派弟子的水平了。」她沉吟片刻，黑色兔耳微微一动，「罢了，妾身便收你为徒，亲自调教一番。」什么？！你的脑子嗡的一声。收徒？眼前这个冷艳绝伦、武功绝世的女子，要收你为徒？这……这是天上掉馅饼吗？不对！|苓雪妃|树林|平静|none

「晚辈……晚辈不能。」你咬着牙说。「嗯？」女子回过头，眼神危险，「你在拒绝妾身？」「不是……」你额头冒汗，「是晚辈已经拜入天山派，虽为外门弟子，但也是正式入门。按江湖规矩，不能另行拜师，否则便是背叛师门……」「江湖规矩？」她冷笑，「天山派的规矩，需要你一个外门弟子来教我？」「我不是……我是说……」|苓雪妃|树林|不满|none

「还是说，」她眯起眼睛，「你觉得妾身配不上做你的师父？」「不敢不敢！」你连忙摇头，「前辈武功盖世，晚辈高攀不起！只是……只是真的不能违背师门规矩……」女子盯着你，一言不发。林子里安静得可怕。你的心脏狂跳，冷汗顺着脊背往下流。但你还是咬着牙，没有改口。你心想：「行吧，今天大概是要交代在这了。」|苓雪妃|树林|严肃|none
</MAIN_TEXT>

<SUMMARY>
你向神秘女子解释了遭擒生军伏击、引敌入林的经过。女子虽嘲讽你愚蠢，但也认可你宁死不出卖门派的气节。她检视你的站姿和根骨后，毒舌点评你资质平庸、剑法稀烂，却出人意料地提出要收你为徒。你因已拜入天山派，按江湖规矩不能另投师门，只得硬着头皮拒绝。女子眼神转冷，质问你是否看不起她，气氛一时剑拔弩张。
</SUMMARY>

<SIDE_NOTE>
{
    "随机事件": {
        "事件类型": "选项事件",
        "事件描述": "神秘女子提出收你为徒，你以江湖规矩为由婉拒，她显然对此十分不满。气氛僵持，你不知她下一步会如何。",
        "选项一": {
            "描述": "特殊剧情: 继续",
            "奖励": "",
            "成功率": "100%"
        }
    },
    "时间": "16:00",
    "用户": {
        "位置变动": "树林"
    },
    "当前NPC": {
        "苓雪妃": {
            "好感变化": "不变",
            "位置变动": "树林"
        }
    }
}
</SIDE_NOTE>

</SLG_MODE>`
    },
    {
        id: "Apprenticeship_Storyline_4",
        name: "拜师剧情4",
        priority: 97,
        conditions: {
            currentSpecialEvent: { equals: 'Apprenticeship_Storyline_3' } 
        },
        effects: {},  // 无属性变化
        text: `<SLG_MODE>

<MAIN_TEXT>
半晌——「呵。」她突然轻笑了一声，伸手按在腰间的剑柄上。完了。你的心一沉。自己刚才拒绝她，惹她不快了，现在她要杀人灭口了。你握紧手中的剑，虽然知道自己根本不是她的对手——别说打赢，能在她手下撑过一招都难——但你还是摆出了防守的姿势。至少……至少要死得有尊严一点。|苓雪妃|树林|严肃|none

「你怕吗？」她的声音飘过来。「怕。」你老实回答，声音在发抖，「但……但该守的规矩还是要守。该说的话还是要说。」「哦？」她挑了挑眉，「知道妾身要杀你？」「晚辈……晚辈猜测是这样。」你咽了口唾沫，努力让自己的声音不要抖得太厉害，「不过前辈高义，救晚辈性命，晚辈感激不尽。若是因为晚辈言语冒犯，惹前辈不快……那晚辈认了。」|苓雪妃|树林|平静|none

女子嘴角扬起一个极淡的弧度。那笑容稍纵即逝，但你确实看到了。她把手中的剑横着递到你面前。「拿着。」你愣了一下，伸手接过那柄剑。剑身修长，通体漆黑，剑锋却泛着淡淡的寒光，一看便不是凡铁。最重要的是——剑柄上，刻着天山派的标记——一朵雪莲，环绕宝剑！|苓雪妃|树林|微笑|none

「这、这是……」你瞪大眼睛。「天山派徽记。」她淡淡道，「看到了？」「您……您也是天山派的？！」「苓雪妃，天山派第七代弟子。」苓雪妃的兔耳抖动，「算起来，是你的长辈。」苓雪妃？！你的脑子又嗡了一声。这个名字你儿时便在外堡的说书先生口中屡屡听闻，传说中天山派不世出的剑圣，侍剑长老，曾持一把快剑，只身一人荡平拜火教群魔，剿灭邪教分舵十数所！|苓雪妃|树林|平静|none

难怪……难怪她的武功这么可怕！你心中暗道：「等等，这位就是传说中的苓雪妃？说书先生说她身高八尺，虎背熊腰，一顿饭要生吞五个鞑子……这也差太多了吧！」「既然同为天山弟子，方才所说拜师之事，便不算违背规矩了吧？」她看了你一眼，眼神中带着些微的促狭。「不算……」你连忙摇头，「只是晚辈何德何能……」|苓雪妃|树林|得意|none

「妾身不管你有没有德，有没有能。」她打断你，「你不明白的事，做不到的事，妾身会全部教给你。」她的语气又突然变得冷硬起来：「当然，你也可以拒绝。反正妾身也不缺徒弟。」「不不不！」你连忙跪下，「弟子愿意！弟子愿意拜师！」你心想：开玩笑，天山派第一高手要收你为徒，这种好事上哪找去？！|苓雪妃|树林|特殊CG3|none

「起来吧。」她挥了挥手，「为师不喜欢这些虚礼。你只需记住——为师的要求很高。若是偷懒懈怠，为师绝不容情。」「弟子明白！」「很好。」她点点头，然后皱起眉头看着你，「现在，带为师回天山派。你这副半死不活的样子，还需要尽快医治。」「是！」你连忙站起来，忍着疼痛准备带路。|苓雪妃|树林|特殊CG3|none

「等等。」她突然伸手按在你的肩膀上。一股温热的内力注入你的体内，疼痛顿时减轻了大半。「应付一下，免得你走到半路就死了，还烦扰我收尸。」她淡淡道，「真正的治疗回去再说。」「弟子拜谢恩师！」你心中一暖，感激之情脱口而出。「肉麻死了，恶心……」她的语气依然冷淡甚至带着嫌弃，但嘴角又扬起那个不易察觉的弧度，「先熬过为师的调教再说，愚钝的弟子。」你小心翼翼地偷看了她一眼——果然，嘴上说着嫌弃，兔耳却又微微抖了一下。|苓雪妃|树林|害羞|none
</MAIN_TEXT>

<SUMMARY>
你以为苓雪妃要杀你灭口，但她却递来一柄刻有天山派徽记的宝剑，亮明自己正是传说中的天山派剑圣——第七代弟子苓雪妃。既是同门长辈，拜师便不违规矩，你当即跪地认师。苓雪妃警告你修炼要求极高，不容懈怠，随后以内力为你暂时疗伤，准备带你返回天山派。
</SUMMARY>

<SIDE_NOTE>
{
    "随机事件": {
        "事件类型": "选项事件",
        "事件描述": "你正式拜苓雪妃为师，成为天山派剑圣的唯一弟子。她为你以内力暂时疗伤，准备带你返回天山派进行正式治疗。",
        "选项一": {
            "描述": "特殊剧情: 继续",
            "奖励": "",
            "成功率": "100%"
        }
    },
    "时间": "17:00",
    "用户": {
        "位置变动": "树林"
    },
    "当前NPC": {
        "苓雪妃": {
            "好感变化": "不变",
            "位置变动": "树林"
        }
    }
}
</SIDE_NOTE>

</SLG_MODE>`
    },
    {
        id: "Apprenticeship_Storyline_5",
        name: "拜师剧情5",
        priority: 96,
        conditions: {
            currentSpecialEvent: { equals: 'Apprenticeship_Storyline_4' } 
        },
        effects: {},  // 无属性变化
        text: `<SLG_MODE>

<MAIN_TEXT>
夜幕降临时，你终于带着苓雪妃来到了天山派的山门。「是{{user}}！快去叫人！」当值守门的弟子认出了你，「他受伤了——等等，他身边那个人是谁？」所有人的目光都落在苓雪妃身上。她依然是那副冷漠的表情，貂裘在夜风中摆动，赤红色的眼眸扫过众人，一言不发。守卫弟子咽了口唾沫:「这位姑娘，请问你是——」|苓雪妃|山门|平静|none

苓雪妃面无表情，用手肘顶了一下你。你会意，连忙替她向众人解释：「她……她是门派的人！是本门第七代的前辈！」你心中暗道：「虽然我也很想说她是我在林子里捡的女鬼……但我怕挨打。」「可是我从没见过——」话音未落，山门另一侧突然传来急促的脚步声。破阵子高大的身影从黑暗中冲出，身后跟着洞庭君、玄天青几位长老。|苓雪妃|山门|平静|none

「听说{{user}}受伤回来了，怎么——」破阵子的话卡在喉咙里。他看到了苓雪妃。气氛凝固了。破阵子瞪大眼睛，洞庭君愣在原地，就连一向沉稳的玄天青都惊得下意识扶了扶眼镜。「雪、雪妃？」破阵子的声音有些发颤，「你……你回来了？」「嗯。」苓雪妃面无表情地点点头，「回来了。」|苓雪妃|山门|平静|none

玄天青深吸一口气：「师妹，你这几年……」「不必担心。」苓雪妃当即打断寒暄，「妾身活得好好的。」「雪妃……」洞庭君强装镇定，眼眶却红了，「你终于肯回来了……」「只是顺路。」苓雪妃淡淡道，「这个弟子把追兵引到了妾身隐居的地方，妾身只好送他回来。」|苓雪妃|山门|平静|none

你站在一旁，看着几位长老的反应，心里突然有些不是滋味。你心想：「原来……她一个人在那片林子里，已经住了很久了吗？」「追兵？」破阵子皱眉，「什么追兵？」你连忙上前，把今天发生的事情一五一十地说了出来：伏击、同伴阵亡、情报泄露、擒生军……|none|山门|none|none

「这……」玄天青沉吟道，「此事蹊跷，还需从长计议。你先去处理伤口，详细情况明日再说。」「是。」「雪妃，」破阵子的语气软了下来，「你的住处我让人去准备，长老厢房一直给你留着——」「不必了。」苓雪妃的声音冷得像冰，「妾身住普通的女弟子房便可，不必费心。」|苓雪妃|山门|严肃|none

「可是——」「就这样。」她没有再给任何人说话的机会，径直朝女弟子居住的方向走去。你愣了一下，连忙跟上去：「师父！等等我！」「师父？！」三位长老面面相觑。你回头，看到他们脸上写满了震惊——还有某种难以言喻的……如释重负？|none|山门|none|none

「这倒是……」玄天青若有所思，「也许是个转机。」洞庭君冰蓝色的眼眸里闪过光亮：「至少……她愿意回来了。」「去吧。」破阵子挥挥手，声音有些沙哑，「照顾好你师父。」你点点头，快步追上苓雪妃。|none|山门|none|none
</MAIN_TEXT>

<SUMMARY>
夜幕降临，你带苓雪妃回到天山派山门。破阵子、洞庭君、玄天青等长老闻讯赶来，惊见失踪多年的苓雪妃归来，激动万分。苓雪妃冷淡回应，称只是顺路送你回来。你向长老们汇报了遭伏击、情报泄露的情况。苓雪妃拒绝住长老厢房，执意住普通女弟子房。你追上她时喊出「师父」，长老们震惊之余又流露出如释重负之色，似乎她的回归与收徒是某种转机。
</SUMMARY>

<SIDE_NOTE>
{
    "随机事件": {
        "事件类型": "选项事件",
        "事件描述": "你带苓雪妃回到天山派，长老们对她的归来既惊喜又感慨。苓雪妃收你为徒一事已被长老们知晓，似乎暗藏某种深意。",
        "选项一": {
            "描述": "特殊剧情: 继续",
            "奖励": "",
            "成功率": "100%"
        }
    },
    "时间": "19:30",
    "用户": {
        "位置变动": "山门"
    },
    "当前NPC": {
        "苓雪妃": {
            "好感变化": "不变",
            "位置变动": "山门"
        }
    }
}
</SIDE_NOTE>

</SLG_MODE>`
    },
    {
        id: "Apprenticeship_Storyline_6",
        name: "拜师剧情6",
        priority: 95,
        conditions: {
            currentSpecialEvent: { equals: 'Apprenticeship_Storyline_5' } 
        },
        effects: {
            GameMode: { set: 0 },
            inputEnable: { set: 1 },
            mapLocation: { set: '天山派' },  
            companionNPC: { set: [] },
            userLocation: { set: 'nvdizi' }
        },  // 无属性变化
        text: `<SLG_MODE>

<MAIN_TEXT>
女弟子房是一排依山而建的木屋，最里面有几间偏僻的单间，平时很少有人住——因为在山坳背阴处，冬天起夜冻死个人。苓雪妃偏偏选了最里面、最偏僻的那一间。「师父，这里……」你看着眼前这间破落的小屋，欲言又止。屋子不大，只有一张木床、一张桌子、一把椅子，墙角有些漏风。「够了。」苓雪妃淡淡道，「为师不需要太多。」你想说什么，却又不知道该说什么。你心中暗想：「她明明是长老，为什么要住这种地方……」

「去打盆水来。」她坐到椅子上，「为师要给你处理伤口。」「是！」你跑出去打水，回来时发现屋里多了一盏油灯——不知道是谁悄悄送来的，可能是某个路过的师姐。昏黄的灯光摇曳，照亮苓雪妃疲惫的侧脸。你心想：「原来……也有人在偷偷关心她啊。」

她示意你趴到床上，开始帮你处理伤口。她的动作很轻，但药粉洒上去还是疼得你龇牙咧嘴。「忍着。」她淡淡道，「这点疼都忍不了？」「弟子忍得住！」「哼，嘴硬。」苓雪妃开始替你包扎伤口，突然开口：「为师有几条规矩，你要记住。」「是！请师父示下！」

「第一，」她居高临下，赤红色的眼眸直视着你，「为师是带罪之身，不再是长老。你也不许以内门弟子自居。在外人面前，你依然是外门弟子。明白吗？」你本欲替她抱不平，但看着她坚决的眼神，只能点头：「弟子……明白。」

「第二，」她继续道，「不要在外人面前提及师徒关系。行事低调，不可张扬。若有人问起，你就说……」她顿了顿。「就说你在林子里捡了个农妇回来。」「……农妇？？？师父，这也太——」「有意见？」「没有没有！弟子没有意见！」你心中腹诽：「谁信啊！哪个农妇长这么好看！哪个农妇能徒手拧断擒生军的脖子！」

「很好。第三，」她的语气稍微缓和了一点，「你根基尚浅，每日的早课和操练不可懈怠，习武切忌冒进，等到时机成熟，为师自会倾囊相授。」「弟子谨记！」「另外，」罕见的，苓雪妃竟有一丝犹豫，「不要试图打听为师的过去。不要试图劝慰为师。」
</MAIN_TEXT>

<SUMMARY>
苓雪妃选了女弟子房中最偏僻破落的单间居住，拒绝长老待遇。她为你处理伤口时，立下三条规矩：一、她是带罪之身，你不得以内门弟子自居；二、不可对外提及师徒关系，若有人问便称她是你捡回来的农妇；三、修行不可冒进，时机成熟她自会倾囊相授。最后她犹豫着补充——不要打听她的过去，也不要试图劝慰她。
</SUMMARY>

<SIDE_NOTE>
{
    "时间": "20:30",
    "用户": {
        "位置变动": "女弟子房"
    },
    "当前NPC": {
        "苓雪妃": {
            "好感变化": "上升",
            "位置变动": "女弟子房"
        }
    }
}
</SIDE_NOTE>

</SLG_MODE>`
    },
    // ==================== 示例事件：钱塘君好感触发 ====================
    {
        id: "event_qiantangjun_invitation",
        name: "钱塘君邀请下山",
        priority: 20,
        conditions: {
            currentWeek: { min: 999 },           // 至少第5周
            "npcFavorability.C": { min: 100 }   // 钱塘君好感度≥100
        },
        effects: {
            "playerStats.声望": { add: 3 }     // 声望+3
        },
        text: `<SLG_MODE>
<MAIN_TEXT>
清晨，你刚准备出门，就被一个熟悉的身影堵在了门口。

「嘿！」钱塘君笑嘻嘻地站在你面前，手里拎着一个包袱，「我跟姐姐请了假，今天我们下山去玩！」

「下山？」你有些意外，「这……合适吗？」

「有什么不合适的！」钱塘君不由分说地拉起你的手往外走，「我都安排好了！山下的集市今天有庙会，可热闹了！再说了，整天闷在山上练功，不闷出病来才怪！」

你无奈地被她拖着走，心想这个从小一起长大的损友，还是一如既往地我行我素……

不过话说回来，偶尔放松一下，似乎也不错？
</MAIN_TEXT>

<SUMMARY>
钱塘君邀请{{user}}下山逛庙会，不由分说地拖着{{user}}出发。这是两人自{{user}}入门以来首次一起外出。
</SUMMARY>

<SIDE_NOTE>
{
    "用户": {
        "位置变动": "山门"
    },
    "当前NPC": {
        "钱塘君": {
            "好感变化": "上升",
            "位置变动": "山门"
        }
    }
}
</SIDE_NOTE>
</SLG_MODE>`
    },

    // ==================== 测试事件集 ====================
    // 以下事件用于调试，覆盖各种条件和效果类型

//     // 【测试1】条件: equals字符串 + 效果: set字符串
//     {
//         id: "test_string_equals_set",
//         name: "[测试] 字符串条件与设置",
//         priority: 100,  // 高优先级，方便测试
//         conditions: {
//             mapLocation: { equals: '天山派' },  // 条件: 地点等于"天山派"
//             currentWeek: { min: 2 }              // 条件: 至少第2周
//         },
//         effects: {
//             mapLocation: { set: '天山派后山' },  // 效果: 地点变为"天山派后山"
//             userLocation: '后山'                  // 效果: 直接赋值字符串
//         },
//         text: `<SLG_MODE>
// <MAIN_TEXT>
// 【测试事件】字符串条件与设置测试

// 这是一个测试事件，用于验证：
// - 条件: mapLocation equals "天山派" ✓
// - 效果: mapLocation 设置为 "天山派后山"
// - 效果: userLocation 直接赋值为 "后山"
// </MAIN_TEXT>
// <SUMMARY>测试事件触发成功。</SUMMARY>
// </SLG_MODE>`
//     },

//     // 【测试2】条件: max + 效果: add数值
//     {
//         id: "test_max_condition_add",
//         name: "[测试] 最大值条件与加法效果",
//         priority: 99,
//         conditions: {
//             currentWeek: { min: 2, max: 10 },    // 条件: 周数在2-10之间
//             playerMood: { max: 80 }               // 条件: 体力不超过80
//         },
//         effects: {
//             playerMood: { add: 10 },              // 效果: 体力+10
//             "playerStats.金钱": { add: 100 }      // 效果: 金钱+100
//         },
//         text: `<SLG_MODE>
// <MAIN_TEXT>
// 【测试事件】最大值条件与加法效果测试

// 这是一个测试事件，用于验证：
// - 条件: currentWeek 在 2-10 之间 ✓
// - 条件: playerMood ≤ 80 ✓
// - 效果: playerMood +10
// - 效果: playerStats.金钱 +100
// </MAIN_TEXT>
// <SUMMARY>测试事件触发成功。</SUMMARY>
// </SLG_MODE>`
//     },

//     // 【测试3】条件: in数组 + 效果: multiply乘法
//     {
//         id: "test_in_condition_multiply",
//         name: "[测试] in条件与乘法效果",
//         priority: 98,
//         conditions: {
//             currentWeek: { in: [3, 6, 9, 12] },  // 条件: 周数在指定数组中
//             difficulty: { in: ['easy', 'normal'] } // 条件: 难度在指定数组中
//         },
//         effects: {
//             "playerStats.武学": { multiply: 1.5 }  // 效果: 武学×1.5
//         },
//         text: `<SLG_MODE>
// <MAIN_TEXT>
// 【测试事件】in条件与乘法效果测试

// 这是一个测试事件，用于验证：
// - 条件: currentWeek 在 [3, 6, 9, 12] 中 ✓
// - 条件: difficulty 在 ["easy", "normal"] 中 ✓
// - 效果: playerStats.武学 ×1.5
// </MAIN_TEXT>
// <SUMMARY>测试事件触发成功。</SUMMARY>
// </SLG_MODE>`
//     },

//     // 【测试4】条件: notEquals + 效果: push数组
//     {
//         id: "test_notequals_push",
//         name: "[测试] notEquals条件与数组push",
//         priority: 97,
//         conditions: {
//             currentWeek: { min: 2 },
//             GameMode: { notEquals: 1 }            // 条件: 游戏模式不等于1
//         },
//         effects: {
//             companionNPC: { push: '钱塘君' }      // 效果: 向随行NPC数组添加"钱塘君"
//         },
//         text: `<SLG_MODE>
// <MAIN_TEXT>
// 【测试事件】notEquals条件与数组push测试

// 这是一个测试事件，用于验证：
// - 条件: GameMode ≠ 1 ✓
// - 效果: companionNPC.push("钱塘君")
// </MAIN_TEXT>
// <SUMMARY>测试事件触发成功。</SUMMARY>
// </SLG_MODE>`
//     },

//     // 【测试5】效果: remove数组元素
//     {
//         id: "test_remove_from_array",
//         name: "[测试] 数组remove操作",
//         priority: 96,
//         conditions: {
//             currentWeek: { min: 3 }
//             // 注意：需要确保companionNPC数组中已有"钱塘君"才能测试remove
//         },
//         effects: {
//             companionNPC: { remove: '钱塘君' }    // 效果: 从随行NPC数组移除"钱塘君"
//         },
//         text: `<SLG_MODE>
// <MAIN_TEXT>
// 【测试事件】数组remove操作测试

// 这是一个测试事件，用于验证：
// - 效果: companionNPC.remove("钱塘君")
// </MAIN_TEXT>
// <SUMMARY>测试事件触发成功。</SUMMARY>
// </SLG_MODE>`
//     },

//     // 【测试6】效果: concat合并数组
//     {
//         id: "test_concat_array",
//         name: "[测试] 数组concat操作",
//         priority: 95,
//         conditions: {
//             currentWeek: { equals: 5 }
//         },
//         effects: {
//             companionNPC: { concat: ['洞庭君', '破阵子'] }  // 效果: 合并多个NPC到数组
//         },
//         text: `<SLG_MODE>
// <MAIN_TEXT>
// 【测试事件】数组concat操作测试

// 这是一个测试事件，用于验证：
// - 效果: companionNPC.concat(["洞庭君", "破阵子"])
// </MAIN_TEXT>
// <SUMMARY>测试事件触发成功。</SUMMARY>
// </SLG_MODE>`
//     },

//     // 【测试7】多层嵌套路径 + 多种效果组合
//     {
//         id: "test_nested_path_combo",
//         name: "[测试] 嵌套路径与组合效果",
//         priority: 94,
//         conditions: {
//             "npcFavorability.A": { min: 10 },     // 破阵子好感≥10
//             "npcFavorability.B": { min: 10 },     // 洞庭君好感≥10
//             "playerStats.武学": { min: 30 }       // 武学≥30
//         },
//         effects: {
//             "npcFavorability.A": { add: 5 },      // 破阵子好感+5
//             "npcFavorability.B": { add: 5 },      // 洞庭君好感+5
//             "playerTalents.悟性": { add: 2 },     // 悟性+2
//             "playerStats.声望": { add: 10 },      // 声望+10
//             "combatStats.攻击力": { add: 5 }      // 攻击力+5
//         },
//         text: `<SLG_MODE>
// <MAIN_TEXT>
// 【测试事件】嵌套路径与组合效果测试

// 这是一个测试事件，用于验证多个嵌套路径的读取和设置：
// - 条件: npcFavorability.A ≥ 10 ✓
// - 条件: npcFavorability.B ≥ 10 ✓
// - 条件: playerStats.武学 ≥ 30 ✓
// - 效果: npcFavorability.A +5
// - 效果: npcFavorability.B +5
// - 效果: playerTalents.悟性 +2
// - 效果: playerStats.声望 +10
// - 效果: combatStats.攻击力 +5
// </MAIN_TEXT>
// <SUMMARY>测试事件触发成功。</SUMMARY>
// </SLG_MODE>`
//     },

//     // 【测试8】设置顶层变量
//     {
//         id: "test_set_top_level_vars",
//         name: "[测试] 设置顶层变量",
//         priority: 93,
//         conditions: {
//             currentWeek: { equals: 6 }
//         },
//         effects: {
//             GameMode: { set: 1 },                 // 设置游戏模式为1
//             randomEvent: { set: 0 },              // 重置随机事件标记
//             battleEvent: { set: 0 },              // 重置战斗事件标记
//             actionPoints: { set: 3 },             // 设置行动点为3
//             enamor: { set: 0 }                    // 重置魅惑值
//         },
//         text: `<SLG_MODE>
// <MAIN_TEXT>
// 【测试事件】设置顶层变量测试

// 这是一个测试事件，用于验证顶层变量的设置：
// - 效果: GameMode = 1
// - 效果: randomEvent = 0
// - 效果: battleEvent = 0
// - 效果: actionPoints = 3
// - 效果: enamor = 0
// </MAIN_TEXT>
// <SUMMARY>测试事件触发成功。</SUMMARY>
// </SLG_MODE>`
//     },

//     // 【测试9】无效果事件（仅发送文本）
//     {
//         id: "test_text_only",
//         name: "[测试] 仅文本无效果",
//         priority: 92,
//         conditions: {
//             currentWeek: { equals: 7 }
//         },
//         effects: {},  // 无任何效果
//         text: `<SLG_MODE>
// <MAIN_TEXT>
// 【测试事件】仅文本无效果测试

// 这是一个测试事件，用于验证：
// - 事件可以没有任何效果
// - 仅发送预设文本
// </MAIN_TEXT>
// <SUMMARY>测试事件触发成功，无属性变化。</SUMMARY>
// </SLG_MODE>`
//     },

//     // 【测试10】背包道具操作
//     {
//         id: "test_inventory_operation",
//         name: "[测试] 背包道具操作",
//         priority: 91,
//         conditions: {
//             currentWeek: { equals: 8 }
//         },
//         effects: {
//             "inventory.大力丸": { add: 3 },       // 大力丸+3
//             "inventory.金疮药": { add: 5 },       // 金疮药+5
//             "inventory.丹参": { set: 10 }         // 丹参设为10
//         },
//         text: `<SLG_MODE>
// <MAIN_TEXT>
// 【测试事件】背包道具操作测试

// 这是一个测试事件，用于验证背包操作：
// - 效果: inventory.大力丸 +3
// - 效果: inventory.金疮药 +5
// - 效果: inventory.丹参 = 10
// </MAIN_TEXT>
// <SUMMARY>测试事件触发成功。</SUMMARY>
// </SLG_MODE>`
//     }

    // ==================== 在此添加更多事件 ====================
    // 复制上面的模板，修改 id、conditions、effects 和 text
];

// ==================== 工具函数 ====================

/**
 * 根据路径获取变量值
 * 支持嵌套路径，如 "npcFavorability.C" 或 "playerStats.声望"
 * @param {string} path - 变量路径
 * @returns {any} 变量值
 */
function getValueByPath(path) {
    const parts = path.split('.');
    
    // 定义可访问的全局变量映射
    // 注意：这些变量需要在运行时可访问
    const globalVars = {
        currentWeek: typeof currentWeek !== 'undefined' ? currentWeek : undefined,
        playerMood: typeof playerMood !== 'undefined' ? playerMood : undefined,
        actionPoints: typeof actionPoints !== 'undefined' ? actionPoints : undefined,
        GameMode: typeof GameMode !== 'undefined' ? GameMode : undefined,
        difficulty: typeof difficulty !== 'undefined' ? difficulty : undefined,
        enamor: typeof enamor !== 'undefined' ? enamor : undefined,
        newWeek: typeof newWeek !== 'undefined' ? newWeek : undefined,
        randomEvent: typeof randomEvent !== 'undefined' ? randomEvent : undefined,
        battleEvent: typeof battleEvent !== 'undefined' ? battleEvent : undefined,
        mapLocation: typeof mapLocation !== 'undefined' ? mapLocation : undefined,
        userLocation: typeof userLocation !== 'undefined' ? userLocation : undefined,
        seasonStatus: typeof seasonStatus !== 'undefined' ? seasonStatus : undefined,
        dayNightStatus: typeof dayNightStatus !== 'undefined' ? dayNightStatus : undefined,
        companionNPC: typeof companionNPC !== 'undefined' ? companionNPC : undefined,
        npcFavorability: typeof npcFavorability !== 'undefined' ? npcFavorability : undefined,
        playerTalents: typeof playerTalents !== 'undefined' ? playerTalents : undefined,
        playerStats: typeof playerStats !== 'undefined' ? playerStats : undefined,
        combatStats: typeof combatStats !== 'undefined' ? combatStats : undefined,
        martialArts: typeof martialArts !== 'undefined' ? martialArts : undefined,
        inventory: typeof inventory !== 'undefined' ? inventory : undefined,
        equipment: typeof equipment !== 'undefined' ? equipment : undefined,
        npcVisibility: typeof npcVisibility !== 'undefined' ? npcVisibility : undefined,
        npcGiftGiven: typeof npcGiftGiven !== 'undefined' ? npcGiftGiven : undefined,
        npcSparred: typeof npcSparred !== 'undefined' ? npcSparred : undefined,
        triggeredEvents: typeof triggeredEvents !== 'undefined' ? triggeredEvents : undefined,
        currentSpecialEvent: typeof currentSpecialEvent !== 'undefined' ? currentSpecialEvent : undefined,
        inputEnable: typeof inputEnable !== 'undefined' ? inputEnable : undefined
    };
    
    let value = globalVars[parts[0]];
    
    // 逐层访问嵌套属性
    for (let i = 1; i < parts.length && value !== undefined; i++) {
        value = value[parts[i]];
    }
    
    return value;
}

/**
 * 根据路径设置变量值
 * @param {string} path - 变量路径
 * @param {any} newValue - 新值
 */
function setValueByPath(path, newValue) {
    const parts = path.split('.');
    const oldValue = getValueByPath(path);
    
    console.log(`[SpecialEvent] 设置变量: ${path}`);
    console.log(`[SpecialEvent]   旧值: ${JSON.stringify(oldValue)}`);
    console.log(`[SpecialEvent]   新值: ${JSON.stringify(newValue)}`);
    
    if (parts.length === 1) {
        // 顶层变量，需要特殊处理（使用 eval 或 window 对象在某些环境可能不可靠，这里用 switch）
        switch (parts[0]) {
            case 'currentWeek': currentWeek = newValue; console.log(`[SpecialEvent]   ✓ 已设置顶层变量 currentWeek`); break;
            case 'playerMood': playerMood = newValue; console.log(`[SpecialEvent]   ✓ 已设置顶层变量 playerMood`); break;
            case 'actionPoints': actionPoints = newValue; console.log(`[SpecialEvent]   ✓ 已设置顶层变量 actionPoints`); break;
            case 'GameMode': GameMode = newValue; console.log(`[SpecialEvent]   ✓ 已设置顶层变量 GameMode`); break;
            case 'difficulty': difficulty = newValue; console.log(`[SpecialEvent]   ✓ 已设置顶层变量 difficulty`); break;
            case 'enamor': enamor = newValue; console.log(`[SpecialEvent]   ✓ 已设置顶层变量 enamor`); break;
            case 'newWeek': newWeek = newValue; console.log(`[SpecialEvent]   ✓ 已设置顶层变量 newWeek`); break;
            case 'randomEvent': randomEvent = newValue; console.log(`[SpecialEvent]   ✓ 已设置顶层变量 randomEvent`); break;
            case 'battleEvent': battleEvent = newValue; console.log(`[SpecialEvent]   ✓ 已设置顶层变量 battleEvent`); break;
            case 'mapLocation': mapLocation = newValue; console.log(`[SpecialEvent]   ✓ 已设置顶层变量 mapLocation`); break;
            case 'userLocation': userLocation = newValue; console.log(`[SpecialEvent]   ✓ 已设置顶层变量 userLocation`); break;
            case 'seasonStatus': seasonStatus = newValue; console.log(`[SpecialEvent]   ✓ 已设置顶层变量 seasonStatus`); break;
            case 'dayNightStatus': dayNightStatus = newValue; console.log(`[SpecialEvent]   ✓ 已设置顶层变量 dayNightStatus`); break;
            case 'companionNPC': companionNPC = newValue; console.log(`[SpecialEvent]   ✓ 已设置顶层变量 companionNPC`); break;
            default:
                console.warn(`[SpecialEvent]   ✗ 无法设置顶层变量: ${parts[0]}（未在支持列表中）`);
        }
    } else {
        // 嵌套变量
        const globalVars = {
            npcFavorability: typeof npcFavorability !== 'undefined' ? npcFavorability : null,
            playerTalents: typeof playerTalents !== 'undefined' ? playerTalents : null,
            playerStats: typeof playerStats !== 'undefined' ? playerStats : null,
            combatStats: typeof combatStats !== 'undefined' ? combatStats : null,
            martialArts: typeof martialArts !== 'undefined' ? martialArts : null,
            inventory: typeof inventory !== 'undefined' ? inventory : null,
            equipment: typeof equipment !== 'undefined' ? equipment : null
        };
        
        let obj = globalVars[parts[0]];
        if (!obj) {
            console.warn(`[SpecialEvent]   ✗ 未找到对象: ${parts[0]}`);
            return;
        }
        
        // 遍历到倒数第二层
        for (let i = 1; i < parts.length - 1; i++) {
            obj = obj[parts[i]];
            if (obj === undefined) {
                console.warn(`[SpecialEvent]   ✗ 路径不存在: ${path}`);
                return;
            }
        }
        
        // 设置最后一层的值
        obj[parts[parts.length - 1]] = newValue;
        console.log(`[SpecialEvent]   ✓ 已设置嵌套变量 ${path}`);
    }
}

/**
 * 检查单个条件是否满足
 * @param {any} value - 当前值
 * @param {object} condition - 条件对象
 * @param {string} path - 变量路径（用于日志）
 * @returns {boolean} 是否满足条件
 */
function checkCondition(value, condition, path = '') {
    const logPrefix = `[SpecialEvent] 条件检查 [${path}]:`;
    
    if (value === undefined) {
        console.log(`${logPrefix} 值为undefined，条件不满足`);
        return false;
    }
    
    // 检查 min 条件
    if (condition.min !== undefined) {
        const result = value >= condition.min;
        console.log(`${logPrefix} ${value} >= ${condition.min} (min) → ${result ? '✓' : '✗'}`);
        if (!result) return false;
    }
    
    // 检查 max 条件
    if (condition.max !== undefined) {
        const result = value <= condition.max;
        console.log(`${logPrefix} ${value} <= ${condition.max} (max) → ${result ? '✓' : '✗'}`);
        if (!result) return false;
    }
    
    // 检查 equals 条件
    if (condition.equals !== undefined) {
        const result = value === condition.equals;
        console.log(`${logPrefix} ${JSON.stringify(value)} === ${JSON.stringify(condition.equals)} (equals) → ${result ? '✓' : '✗'}`);
        if (!result) return false;
    }
    
    // 检查 in 条件
    if (condition.in !== undefined) {
        const result = condition.in.includes(value);
        console.log(`${logPrefix} ${JSON.stringify(value)} in ${JSON.stringify(condition.in)} → ${result ? '✓' : '✗'}`);
        if (!result) return false;
    }
    
    // 检查 notEquals 条件
    if (condition.notEquals !== undefined) {
        const result = value !== condition.notEquals;
        console.log(`${logPrefix} ${JSON.stringify(value)} !== ${JSON.stringify(condition.notEquals)} (notEquals) → ${result ? '✓' : '✗'}`);
        if (!result) return false;
    }
    
    return true;
}

/**
 * 检查事件的所有条件是否满足
 * @param {object} event - 事件对象
 * @returns {boolean} 是否满足所有条件
 */
function checkEventConditions(event) {
    console.log(`\n[SpecialEvent] ========== 检查事件: ${event.name} (${event.id}) ==========`);
    
    // 检查是否已触发过
    if (triggeredEvents && triggeredEvents.includes(event.id)) {
        console.log(`[SpecialEvent] → 事件已触发过，跳过`);
        return false;
    }
    
    console.log(`[SpecialEvent] 事件条件数量: ${Object.keys(event.conditions).length}`);
    
    // 检查所有条件
    let allConditionsMet = true;
    for (const [path, condition] of Object.entries(event.conditions)) {
        const value = getValueByPath(path);
        console.log(`[SpecialEvent] 读取变量 ${path} = ${JSON.stringify(value)}`);
        if (!checkCondition(value, condition, path)) {
            console.log(`[SpecialEvent] → 条件不满足，事件不触发`);
            allConditionsMet = false;
            break;
        }
    }
    
    if (allConditionsMet) {
        console.log(`[SpecialEvent] → 所有条件满足！事件将被触发`);
    }
    
    return allConditionsMet;
}

/**
 * 应用事件效果（修改游戏变量）
 * 支持的操作类型：
 * - { add: number } - 加法操作（数值类型）
 * - { set: any } - 直接设置为指定值（任意类型：数值、字符串、数组等）
 * - { multiply: number } - 乘法操作（数值类型）
 * - { push: any } - 向数组末尾添加元素
 * - { remove: any } - 从数组中移除元素
 * - { concat: array } - 将数组与另一个数组合并
 * - 直接赋值 - 非对象值直接赋值
 *
 * @param {object} event - 事件对象
 */
function applyEventEffects(event) {
    console.log(`\n[SpecialEvent] ========== 应用事件效果: ${event.name} ==========`);
    
    if (!event.effects || Object.keys(event.effects).length === 0) {
        console.log(`[SpecialEvent] 该事件无效果需要应用`);
        return;
    }
    
    console.log(`[SpecialEvent] 效果数量: ${Object.keys(event.effects).length}`);
    
    for (const [path, effect] of Object.entries(event.effects)) {
        const currentValue = getValueByPath(path);
        let newValue;
        let skipSet = false;  // 标记是否跳过设置（用于 push/remove 等就地修改操作）
        let operationType = '';
        
        console.log(`\n[SpecialEvent] 处理效果: ${path}`);
        console.log(`[SpecialEvent]   当前值: ${JSON.stringify(currentValue)} (类型: ${Array.isArray(currentValue) ? 'array' : typeof currentValue})`);
        console.log(`[SpecialEvent]   效果定义: ${JSON.stringify(effect)}`);
        
        if (typeof effect === 'object' && effect !== null) {
            if (effect.add !== undefined) {
                // 加法操作（数值）
                operationType = 'add';
                newValue = (currentValue || 0) + effect.add;
                console.log(`[SpecialEvent]   操作类型: add（加法）`);
                console.log(`[SpecialEvent]   计算: ${currentValue || 0} + ${effect.add} = ${newValue}`);
            } else if (effect.set !== undefined) {
                // 直接设置（支持任意类型：字符串、数值、数组、对象等）
                operationType = 'set';
                newValue = effect.set;
                console.log(`[SpecialEvent]   操作类型: set（直接设置）`);
                console.log(`[SpecialEvent]   将设置为: ${JSON.stringify(newValue)}`);
            } else if (effect.multiply !== undefined) {
                // 乘法操作（数值）
                operationType = 'multiply';
                newValue = (currentValue || 0) * effect.multiply;
                console.log(`[SpecialEvent]   操作类型: multiply（乘法）`);
                console.log(`[SpecialEvent]   计算: ${currentValue || 0} × ${effect.multiply} = ${newValue}`);
            } else if (effect.push !== undefined) {
                // 向数组末尾添加元素
                operationType = 'push';
                console.log(`[SpecialEvent]   操作类型: push（数组添加）`);
                if (Array.isArray(currentValue)) {
                    console.log(`[SpecialEvent]   添加元素: ${JSON.stringify(effect.push)}`);
                    console.log(`[SpecialEvent]   数组操作前: ${JSON.stringify(currentValue)}`);
                    currentValue.push(effect.push);
                    console.log(`[SpecialEvent]   数组操作后: ${JSON.stringify(currentValue)}`);
                    console.log(`[SpecialEvent]   ✓ push 操作成功`);
                    skipSet = true;
                } else {
                    console.warn(`[SpecialEvent]   ✗ push 操作失败: ${path} 不是数组类型`);
                }
            } else if (effect.remove !== undefined) {
                // 从数组中移除元素
                operationType = 'remove';
                console.log(`[SpecialEvent]   操作类型: remove（数组移除）`);
                if (Array.isArray(currentValue)) {
                    console.log(`[SpecialEvent]   要移除的元素: ${JSON.stringify(effect.remove)}`);
                    console.log(`[SpecialEvent]   数组操作前: ${JSON.stringify(currentValue)}`);
                    const index = currentValue.indexOf(effect.remove);
                    if (index > -1) {
                        currentValue.splice(index, 1);
                        console.log(`[SpecialEvent]   数组操作后: ${JSON.stringify(currentValue)}`);
                        console.log(`[SpecialEvent]   ✓ remove 操作成功`);
                    } else {
                        console.log(`[SpecialEvent]   ⚠ 未找到要移除的元素`);
                    }
                    skipSet = true;
                } else {
                    console.warn(`[SpecialEvent]   ✗ remove 操作失败: ${path} 不是数组类型`);
                }
            } else if (effect.concat !== undefined) {
                // 将数组与另一个数组合并
                operationType = 'concat';
                console.log(`[SpecialEvent]   操作类型: concat（数组合并）`);
                if (Array.isArray(currentValue) && Array.isArray(effect.concat)) {
                    console.log(`[SpecialEvent]   要合并的数组: ${JSON.stringify(effect.concat)}`);
                    newValue = currentValue.concat(effect.concat);
                    console.log(`[SpecialEvent]   合并后: ${JSON.stringify(newValue)}`);
                } else {
                    console.warn(`[SpecialEvent]   ✗ concat 操作失败: 需要两个数组`);
                }
            } else {
                console.log(`[SpecialEvent]   ⚠ 未知的对象效果类型: ${JSON.stringify(effect)}`);
            }
        } else {
            // 直接赋值（非对象值）
            operationType = 'direct';
            newValue = effect;
            console.log(`[SpecialEvent]   操作类型: 直接赋值`);
            console.log(`[SpecialEvent]   将设置为: ${JSON.stringify(newValue)}`);
        }
        
        if (!skipSet && newValue !== undefined) {
            setValueByPath(path, newValue);
            console.log(`[SpecialEvent]   ✓ 效果已应用`);
        }
    }
    
    console.log(`\n[SpecialEvent] ========== 效果应用完成 ==========\n`);
    
    // 检查数值范围
    if (typeof checkAllValueRanges === 'function') {
        checkAllValueRanges();
    }
}

/**
 * 标记事件为已触发
 * @param {string} eventId - 事件ID
 */
function markEventTriggered(eventId) {
    if (!triggeredEvents) {
        triggeredEvents = [];
    }
    if (!triggeredEvents.includes(eventId)) {
        triggeredEvents.push(eventId);
        console.log(`[SpecialEvent] 事件已标记为触发: ${eventId}`);
    }
}

// ==================== 主要对外函数 ====================

/**
 * 检查是否有符合条件的特殊事件
 * 按优先级排序，返回第一个符合条件的事件
 * @returns {object|null} 符合条件的事件对象，或null
 */
function checkSpecialEvents() {
    // 按优先级降序排序
    const sortedEvents = [...specialEvents].sort((a, b) => (b.priority || 0) - (a.priority || 0));
    
    for (const event of sortedEvents) {
        if (checkEventConditions(event)) {
            console.log(`[SpecialEvent] 找到符合条件的事件: ${event.name} (${event.id})`);
            return event;
        }
    }
    
    return null;
}

/**
 * 触发特殊事件
 * 应用效果、标记已触发、发送预设文本
 * @param {object} event - 事件对象
 * @returns {Promise<boolean>} 是否成功触发
 */
async function triggerSpecialEvent(event) {
    if (!event) {
        console.warn('[SpecialEvent] 事件对象为空');
        return false;
    }
    
    console.log(`[SpecialEvent] 开始触发事件: ${event.name} (${event.id})`);
    
    try {
        // 1. 应用事件效果
        applyEventEffects(event);
        
        // 2. 设置当前特殊事件ID
        if (typeof currentSpecialEvent !== 'undefined') {
            currentSpecialEvent = event.id;
            console.log(`[SpecialEvent] 已设置 currentSpecialEvent = "${event.id}"`);
        }
        
        // 3. 标记事件为已触发
        markEventTriggered(event.id);
        
        // 3. 保存游戏数据
        if (typeof saveGameData === 'function') {
            await saveGameData();
            console.log('[SpecialEvent] 游戏数据已保存');
        }
        
        // 4. 发送预设文本
        // if (event.text && typeof isInRenderEnvironment === 'function' && isInRenderEnvironment()) {
        //     const renderFunc = typeof getRenderFunction === 'function' ? getRenderFunction() : null;
        //     if (renderFunc) {
        //         const safeText = event.text
        //             .replace(/\|/g, '\\|')   // 先转义管道符
        //             .replace(/`/g, '\\`');   // 再转义反引号
        //         await renderFunc(`/sendas name={{char}} at={{lastMessageId}}+1 ${safeText}`);
        //         console.log(`[SpecialEvent] 事件文本已发送: ${event.name}`);
        //         return true;
        //     }
        // }

        setTimeout(async () => {
            if (event.text && typeof isInRenderEnvironment === 'function' && isInRenderEnvironment()) {
                const renderFunc = typeof getRenderFunction === 'function' ? getRenderFunction() : null;
                if (renderFunc) {
                    const safeText = event.text
                        .replace(/\|/g, '\\|')   // 先转义管道符
                        .replace(/`/g, '\\`');   // 再转义反引号
                    await renderFunc(`/sendas name={{char}} at={{lastMessageId}}+1 ${safeText}`);
                    console.log(`[SpecialEvent] 事件文本已发送: ${event.name}`);
                    return true;
                }
            }
        }, 500); 
        
        // 非渲染环境，用弹窗显示
        if (typeof showModal === 'function') {
            showModal(`【特殊事件】${event.name}<br><br>（非酒馆环境，事件文本无法发送）`);
        }
        
        return true;
    } catch (error) {
        console.error('[SpecialEvent] 触发事件失败:', error);
        return false;
    }
}

/**
 * 获取所有已触发的事件ID列表
 * @returns {array} 已触发事件ID数组
 */
function getTriggeredEvents() {
    return triggeredEvents || [];
}

/**
 * 重置特定事件的触发状态（用于调试）
 * @param {string} eventId - 事件ID
 */
function resetEventTrigger(eventId) {
    if (triggeredEvents) {
        const index = triggeredEvents.indexOf(eventId);
        if (index > -1) {
            triggeredEvents.splice(index, 1);
            console.log(`[SpecialEvent] 事件触发状态已重置: ${eventId}`);
        }
    }
}

// 暴露到全局（供其他模块调用）
window.checkSpecialEvents = checkSpecialEvents;
window.triggerSpecialEvent = triggerSpecialEvent;
window.getTriggeredEvents = getTriggeredEvents;
window.resetEventTrigger = resetEventTrigger;