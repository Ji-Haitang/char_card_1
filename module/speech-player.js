/** 单音轨播放器：停止立即生效；晚到Blob/play Promise不能抢回舞台。无自动翻页。 */
var speechPlayer = (function () {
    'use strict';
    function create(options) {
        options = options || {};
        var generation = 0, current = null, state = { phase: 'idle' }, listeners = new Set();
        function setState(value) {
            state=value;listeners.forEach(function(listener){try{listener(Object.assign({},state));}catch(_){}});
        }
        var makeAudio = options.makeAudio || function () { return new Audio(); };
        var makeURL = options.makeURL || function (blob) { return URL.createObjectURL(blob); };
        var revokeURL = options.revokeURL || function (url) { URL.revokeObjectURL(url); };
        function release(entry) {
            if (!entry) return;
            entry.audio.onended = entry.audio.onerror = null;
            entry.audio.pause(); entry.audio.removeAttribute('src'); entry.audio.load();
            revokeURL(entry.url);
        }
        function stop() {
            generation++; release(current); current = null; setState({ phase: 'idle' });
        }
        async function play(blobOrLoader, identity, options) {
            options=options||{};
            stop(); var ticket = generation;
            var owner = Object.assign({}, identity || {});
            setState(Object.assign({ phase: 'loading' }, owner));
            try {
                var blob = await (typeof blobOrLoader === 'function' ? blobOrLoader() : blobOrLoader);
                if (ticket !== generation) return false;
                if (!(blob instanceof Blob) || !blob.size) throw new Error('本机没有可播放的语音');
                var audio = makeAudio(), entry = { audio: audio, url: makeURL(blob) };
                current = entry; audio.src = entry.url;
                audio.onended = function () { if (ticket === generation) {stop();if(generation===ticket+1&&typeof options.onEnded==='function')options.onEnded();} };
                audio.onerror = function () {
                    if (ticket !== generation) return;
                    stop(); setState(Object.assign({ phase: 'error', message: '语音文件无法播放' }, owner));
                };
                await audio.play();
                if (ticket !== generation) return false;
                setState(Object.assign({ phase: 'playing' }, owner));
                return true;
            } catch (error) {
                if (ticket !== generation) return false;
                stop(); setState(Object.assign({ phase: 'error', message: error.name === 'NotAllowedError' ? '请点击台词启用声音' : error.message }, owner));
                throw error;
            }
        }
        return { play: play, stop: stop, getState: function () { return Object.assign({}, state); },
            subscribe:function(listener){if(typeof listener!=='function')throw new Error('播放状态监听无效');listeners.add(listener);return function(){listeners.delete(listener);};} };
    }
    var player = create(); player.create = create;
    if (typeof window !== 'undefined') window.addEventListener('pagehide', player.stop);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', function () { if (document.hidden) player.stop(); });
    return player;
})();
