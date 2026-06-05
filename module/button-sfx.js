/**
 * button-sfx.js — 全局按钮点击音效
 * 通过事件委托监听所有 <button> 的点击，播放音效。
 * 音量跟随 bgmManager（如存在），默认 0.4。
 */
(function () {
    const SFX_SRC = 'bgm/other/按钮音效.mp3';
    const DEFAULT_VOL = 0.4;

    // 预加载音效
    const _sfx = new Audio(SFX_SRC);
    _sfx.preload = 'auto';
    let _sfxReady = true;
    _sfx.addEventListener('error', () => { _sfxReady = false; }); // 文件不可用时静默禁用

    function playClick() {
        if (!_sfxReady) return; // 文件加载失败则跳过
        // 跟随 bgmManager 音量（若存在）
        const vol = (typeof bgmManager !== 'undefined' && typeof bgmManager.getVolume === 'function')
            ? bgmManager.getVolume()
            : DEFAULT_VOL;
        _sfx.volume = vol;

        // 从头播放（避免连点时上次音效未结束）
        _sfx.currentTime = 0;
        _sfx.play().catch(() => { /* 自动播放策略拦截时静默忽略 */ });
    }

    document.addEventListener('click', function (e) {
        const t = e.target;
        // 普通按钮
        const btn = t.closest('button');
        if (btn && !btn.disabled) { playClick(); return; }
        // 地图场景区域（SVG polygon）
        if (t.closest('polygon[data-location]')) { playClick(); return; }
        // NPC 立绘
        if (t.closest('.npc-portrait')) { playClick(); return; }
        // 战斗指令按钮（div.command-btn）
        const cmdBtn = t.closest('.command-btn');
        if (cmdBtn && !cmdBtn.classList.contains('disabled') && !cmdBtn.hasAttribute('disabled')) { playClick(); return; }
        // 农场格子（div.tile.farm）
        if (t.closest('.tile.farm')) { playClick(); return; }
    }, true); // 捕获阶段，确保在任何 stopPropagation 之前触发
})();
