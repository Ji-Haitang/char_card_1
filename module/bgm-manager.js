/**
 * bgm-manager.js - 背景音乐管理模块
 *
 * 仅在 index.html（独立前端）中通过 <script src> 引入，
 * index - SR.html（SillyTavern）链路永远不加载此文件，window.bgmManager 在 SR 环境下为 undefined。
 *
 * 暴露到全局：window.bgmManager
 */
(function () {
    'use strict';

    // ── 内部状态 ──────────────────────────────────────────────
    var _audio          = null;   // <audio> 元素引用
    var _currentPath    = '';     // 当前已加载/播放的文件路径
    var _preBattlePath  = '';     // 战斗前暂存路径，退出战斗后恢复
    var _enabled        = true;   // 是否启用（由 gameData.bgmEnabled 初始化及同步）
    var _volume         = 0.5;    // 音量（由 gameData.bgmVolume 初始化及同步）
    var _activeMood     = null;   // 上次情绪BGM基调，用于防重复触发
    var _activeLocation = null;   // 上次平淡BGM地点，用于防重复触发
    var _ready          = false;  // 用户首次交互后置 true，解决自动播放策略

    // ── 内部辅助 ──────────────────────────────────────────────

    /** 将相对路径编码为浏览器可识别的 src（encodeURI 保留斜杠） */
    function _toSrc(path) {
        return encodeURI(path);
    }

    /** 从数组随机取一项 */
    function _pickRandom(arr) {
        if (!arr || arr.length === 0) return null;
        return arr[Math.floor(Math.random() * arr.length)];
    }

    /** 读取 gameData（兼容 gameData 可能尚未初始化的边界情况） */
    function _gameData() {
        return (typeof gameData !== 'undefined') ? gameData : null;
    }

    // ── 公开接口 ──────────────────────────────────────────────

    /**
     * init(audioEl)
     * 绑定 <audio> 元素，从 gameData.bgmEnabled / bgmVolume 读取初始值。
     * 可多次调用（读档/导入后重新同步状态）。
     */
    function init(audioEl) {
        _audio = audioEl || _audio;
        if (_audio) {
            _audio.loop = true;
        }

        var gd = _gameData();
        if (gd) {
            _enabled = (typeof gd.bgmEnabled === 'boolean') ? gd.bgmEnabled : true;
            _volume  = (typeof gd.bgmVolume  === 'number')  ? gd.bgmVolume  : 0.5;
        }
        if (_audio) {
            _audio.volume = _volume;
        }

        // 监听用户首次交互，解锁自动播放策略
        if (!_ready) {
            var _unlock = function () {
                _ready = true;
                document.removeEventListener('click',   _unlock, true);
                document.removeEventListener('keydown', _unlock, true);
            };
            document.addEventListener('click',   _unlock, true);
            document.addEventListener('keydown', _unlock, true);
        }
    }

    /**
     * play(path)
     * 若未启用则跳过；与当前路径相同则不操作（防重复）；否则切换并播放。
     */
    function play(path) {
        if (!_enabled) return;
        if (!path) return;
        if (!_audio) return;
        if (path === _currentPath) return;

        _currentPath = path;
        _audio.src = _toSrc(path);
        _audio.volume = _volume;
        _audio.currentTime = 0;

        var playPromise = _audio.play();
        if (playPromise !== undefined) {
            playPromise.catch(function () {
                // 自动播放被阻止：等待用户交互后重试
                var _retry = function () {
                    _audio.play().catch(function () {});
                    document.removeEventListener('click',   _retry, true);
                    document.removeEventListener('keydown', _retry, true);
                };
                document.addEventListener('click',   _retry, true);
                document.addEventListener('keydown', _retry, true);
            });
        }
    }

    /**
     * stop()
     * 暂停并清空 src，重置 _currentPath。
     */
    function stop() {
        if (_audio) {
            _audio.pause();
            _audio.src = '';
        }
        _currentPath = '';
    }

    /**
     * resume(path)
     * 强制从头播放指定 path（跳过防重复检查），用于读档/导入存档后恢复播放。
     * 若 bgmEnabled=false 则仅更新 _currentPath，不实际播放。
     */
    function resume(path) {
        if (!path) return;
        if (!_audio) return;
        _currentPath = path;
        if (!_enabled) return;

        _audio.src = _toSrc(path);
        _audio.volume = _volume;
        _audio.currentTime = 0;

        var playPromise = _audio.play();
        if (playPromise !== undefined) {
            playPromise.catch(function () {
                var _retry = function () {
                    _audio.play().catch(function () {});
                    document.removeEventListener('click',   _retry, true);
                    document.removeEventListener('keydown', _retry, true);
                };
                document.addEventListener('click',   _retry, true);
                document.addEventListener('keydown', _retry, true);
            });
        }
    }

    /**
     * updateByTone(toneResult, mapLoc)
     * 根据 LLM 返回的剧情基调决策并播放 BGM。
     * toneResult = { 基调归类, 置信度 } 或 null
     */
    function updateByTone(toneResult, mapLoc) {
        // 依赖的配置常量
        var manifest  = (typeof bgmFileManifest    !== 'undefined') ? bgmFileManifest    : null;
        var pingdan   = (typeof bgmPingdanManifest !== 'undefined') ? bgmPingdanManifest : null;
        var moodOpts  = (typeof bgmMoodOptions     !== 'undefined') ? bgmMoodOptions     : [];
        if (!manifest || !pingdan) return;

        var mood = toneResult && toneResult['基调归类'] ? toneResult['基调归类'] : null;
        var conf = toneResult && toneResult['置信度']   ? parseFloat(toneResult['置信度']) : 0;
        var isValidMood = !!mood && moodOpts.indexOf(mood) !== -1;
        var isSameActiveMood = isValidMood && mood === _activeMood;
        var shouldUseMoodBgm = isValidMood && (conf > 0.75 || isSameActiveMood);

        if (shouldUseMoodBgm) {
            // ── 情绪BGM模式 ──
            if (isSameActiveMood) return; // 同一情绪延续时，不重播也不回退到平淡BGM
            var files = manifest[mood];
            var picked = _pickRandom(files);
            if (!picked) return;
            _activeMood = mood;
            _activeLocation = null;
            play(picked);
            var gd = _gameData();
            if (gd) gd.bgmName = picked;
        } else {
            // ── 平淡BGM模式 ──
            var gd = _gameData();
            var loc = mapLoc || (gd && gd.mapLocation) || '天山派';
            var normalizedLoc = pingdan[loc] ? loc : '天山派';
            if (normalizedLoc === _activeLocation && _activeMood === null) return; // 位置未变，不重新播放
            var files = pingdan[normalizedLoc];
            var picked = _pickRandom(files);
            if (!picked) return;
            _activeMood = null;
            _activeLocation = normalizedLoc;
            play(picked);
            if (gd) gd.bgmName = picked;
        }
    }

    /**
     * onBattleStart()
     * 暂存当前路径，随机播放战斗BGM（绕过 _enabled，战斗BGM始终播放）。
     * 不更新 gameData.bgmName。
     */
    function onBattleStart() {
        var manifest = (typeof bgmFileManifest !== 'undefined') ? bgmFileManifest : null;
        _preBattlePath = _currentPath;
        if (!manifest || !manifest['战斗'] || !_audio) return;
        var picked = _pickRandom(manifest['战斗']);
        if (!picked) return;
        // 直接操作 audio，绕过 _enabled
        _currentPath = picked;
        _audio.src = _toSrc(picked);
        _audio.volume = _volume;
        _audio.currentTime = 0;
        _audio.play().catch(function () {});
    }

    /**
     * onBattleEnd()
     * 恢复战斗前的BGM；若已禁用则 stop()。清空 _preBattlePath。
     */
    function onBattleEnd() {
        var path = _preBattlePath;
        _preBattlePath = '';
        // 重置活跃状态，让下一次 updateByTone 强制重新选曲
        _activeMood = null;
        _activeLocation = null;
        if (!_enabled) {
            stop();
            return;
        }
        if (path) {
            resume(path);
        } else {
            stop();
        }
    }

    /**
     * setEnabled(bool)
     * 设置启用状态，同步到 gameData.bgmEnabled。
     */
    function setEnabled(bool) {
        _enabled = !!bool;
        var gd = _gameData();
        if (gd) gd.bgmEnabled = _enabled;
        if (!_enabled) {
            stop();
        } else {
            // 恢复播放：优先用 gameData.bgmName
            var name = gd && gd.bgmName ? gd.bgmName : '';
            if (name) {
                resume(name);
            }
        }
    }

    /**
     * setVolume(val)
     * 设置音量（0.0~1.0），同步到 _audio.volume 和 gameData.bgmVolume。
     */
    function setVolume(val) {
        val = Math.max(0, Math.min(1, parseFloat(val) || 0));
        _volume = val;
        if (_audio) _audio.volume = val;
        var gd = _gameData();
        if (gd) gd.bgmVolume = val;
    }

    /** getEnabled() - 返回当前启用状态 */
    function getEnabled() { return _enabled; }

    /** getVolume() - 返回当前音量 */
    function getVolume()  { return _volume;  }

    /** getPlayingPath() - 返回当前播放路径 */
    function getPlayingPath() { return _currentPath; }

    // ── 挂载到全局 ────────────────────────────────────────────
    window.bgmManager = {
        init:           init,
        play:           play,
        stop:           stop,
        resume:         resume,
        updateByTone:   updateByTone,
        onBattleStart:  onBattleStart,
        onBattleEnd:    onBattleEnd,
        setEnabled:     setEnabled,
        setVolume:      setVolume,
        getEnabled:     getEnabled,
        getVolume:      getVolume,
        getPlayingPath: getPlayingPath
    };

    console.log('[bgm-manager] 已加载');
})();
