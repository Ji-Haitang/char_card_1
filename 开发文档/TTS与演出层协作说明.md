# TTS与演出层协作说明

基线：主仓main `b0b744c795c45a840fbb9b43b3a35ddd9e4d0a6c`。实验分支：`experiment/tts-presentation-20261115`。运行资源、花名册、双NPC显示和玩法沿用上游。

## 使用与行为

游戏设置新增“语音配置”，填写玩家自己的Fish Key并调整预设声线。整轮朗读默认关闭；单句测试可独立开启。台词格式为`正文【稳定ID；简短表现描述】`，置于原五字段行的正文末尾；主回复同次给出归属，旁白/玩家保持无声。表现描述随请求发送并参与音频身份。

Android使用CapacitorHttp直接访问Fish；网页沿用API设置中的跨域路由。模型固定`drama-3`，输出MP3。Key、参考和最近10轮音频在独立本机语音库中，普通存档保存正文/标记/阅读计划与游标。原生桥日志关闭。

完整回复进入横屏演出；中区返回原操作界面，原正文续读、原翻页定位到对应短段。气泡与菜单共用原输入节点。声音准备完成后调用原回合提交；上游支线后处理完成才产生自动入场回执。待处理支线选择沿原界面操作。待办可刷新后继续或无声发布，提交结果不确定时保留核对状态。未发布待办由新业务入口在扣资源前拦截，原设置和只读面板可用；提交后更新阅读环境，保持已准备声音的切片身份。

## 维护接口

| 层 | 主要文件 | 责任 |
|---|---|---|
| 语音核心 | `speech-plan/drama3/msgpack/config/store/player/service` | 台词范围、请求、配置、缓存及播放 |
| 平台与回合 | `speech-transport/round-plan/round/turn`、`media-context` | 路由快照、待办、上下文失效、调用原commit |
| 演出 | `presentation-*`、`gal-scene-resources` | 只读显示、节点租借、上下文恢复；复用上游GAL与3D |
| 原游戏挂点 | `pipeline/api-service/game-ui/game-events/storage-service/index` | 结束原因、提交回执、进入/退出、读档与布局生命周期 |

音频以持久命名空间`main`存储；epoch及gameData引用保护在途操作。已有历史在页面初始化时恢复其正文和事件，首次开局应用开场状态。角色文本、提示词和资源保持基线内容。

## 验证

- 本批单元/合同：461项通过，包含上游API工具输出、副API、支线与GAL。
- 浏览器共26组通过：双视口/双模式及共享输入4组；主回合与语音8组；生命周期4组；刷新待办2组；业务前置门控3组；真实3D渲染器1组；跨域预检/Worker4组。
- 模型及Fish HTTP使用公开夹具，IndexedDB、解码、DOM与原业务实际执行。模拟原生桥与浏览器视口分别记录。

```powershell
npm ci --prefix scene3d
node --test "tests/*.test.mjs" "tests/*.unit.mjs" "tests/gal/*.unit.mjs"
node tests/media-stage.browser.mjs
node tests/media-turn.browser.mjs
node tests/media-lifecycle.browser.mjs
node tests/media-resume.browser.mjs
node tests/media-pending.browser.mjs
node tests/media-3d.browser.mjs
node tests/speech-web.browser.mjs
```

完整检出可直接运行。稀疏开发环境可用`JXZ_TEST_ASSET_ROOT`共享同一版本的资源；`JXZ_TEST_ASSET_REV`指定固定Git提交以读取文本资源原始字节。测试产物写入`.scene3d-work`。

额外补跑的原3D/打包全套仍有未通过项：稀疏检出的GLB/图片依赖、原相机夹具缺少`panOrigin`、合成APK夹具版本1.3与main的1.6.1不符。上述不计入本批通过数字，生产渲染器与APK版本保持上游。

## 发布与协作

作者需将`worker/cors-proxy.js`的model透传及Fish响应处理同步到实际服务。实际Fish音质/费用、正式网络和新APK设备验收待分别完成；原生取消结束本地等待，服务器请求仍可能继续。16MiB为JS逻辑检查限额。

本批次交付功能代码、必要测试和本说明。建议作者负责上游业务/UI整合，语音模块侧负责请求与联动回归；`pipeline/index`由一方统一整合。实验分支完成共同验证后再评审合入main。
