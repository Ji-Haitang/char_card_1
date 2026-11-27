/** Public Fish voice presets mapped to the game's registered NPC IDs; saved bindings take precedence. */
var speechVoiceDefaults = (function () {
    'use strict';
    var ids = Object.freeze({
        A: 'b6e44b2400a84a2d82ac006b2718aeb1', // 破阵子
        B: '2e86853070c844bf98c37c55ca597846', // 洞庭君
        C: '2e801eb2ed5c442da7763ff17df83bff', // 钱塘君
        D: 'bd6f7862753f46908ac19b19ba84eb3c', // 萧白瑚
        E: '085f3ff87ada45db94f3bd316f070f15', // 姬姒
        F: 'b49bda63a3704dbaad59b0fb3d330dd1', // 施延年
        G: 'b5e3eb9d3cbc4c558304ad023147406a', // 呼延显
        H: 'e2bd626e3f364c0c914892dc082c8d79', // 雨烛
        I: '4ca68a299cb24ae599dbb828dc31a73c', // 安慕
        J: 'cab93dd5e1684a648dbfde02bff2c0dc', // 唐沐梨
        K: 'c14735df6db74fdea7c92d7d09f47ff6', // 洛潜幽
        M: '80a4bf8f7d5849fa93663dbaae86ebc9', // 玄天青
        N: '8e80c3dcdf894213a10b48e9b08ad8c6', // 鹿椿若
        O: 'c69f8376aa3c41fc9f7f17367562d9b6', // 苓雪妃
    });
    function create() {
        var out = {};
        Object.keys(ids).forEach(function (id) {
            out[id] = { kind: 'fish-drama3', speakerId: ids[id], version: '1' };
        });
        return out;
    }
    return Object.freeze({ create: create });
})();

/** Drama 3 settings, voice presets and local reference ownership. */
var speechConfig = (function () {
    'use strict';
    var KIND = 'fish-drama3';
    function owner() {
        return mediaContext.workspaceId();
    }
    function guard(id) {
        var context = mediaContext.capture();
        return function () {
            if (id !== owner() || !mediaContext.isCurrent(context))
                throw new DOMException('语音配置期间游戏上下文已变更', 'AbortError');
        };
    }
    function defaults() {
        return {
            enabled: false,
            provider: { kind: KIND, apiKey: '', speed: 1 },
            voices: typeof speechVoiceDefaults !== 'undefined' ? speechVoiceDefaults.create() : {},
        };
    }
    function object(v) {
        if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
        var p = Object.getPrototypeOf(v);
        return p === null || Object.getPrototypeOf(p) === null;
    }
    function merge(base, patch) {
        if (!object(base) || !object(patch)) return structuredClone(patch);
        var out = structuredClone(base);
        Object.keys(patch).forEach(function (k) {
            Object.defineProperty(out, k, {
                value:
                    object(base[k]) && object(patch[k])
                        ? merge(base[k], patch[k])
                        : structuredClone(patch[k]),
                enumerable: true,
                writable: true,
                configurable: true,
            });
        });
        return out;
    }
    function project(raw) {
        if (!raw) {
            const fresh = defaults();
            fresh.provider.model = 's2.1-pro';
            return fresh;
        }
        if (!object(raw) || !raw.provider || raw.provider.kind !== KIND)
            throw new Error('本机语音配置版本不受支持，原记录保持不变');
        const voices=structuredClone(raw.voices || {});
        if(voices.B?.kind===KIND && voices.B.speakerId==='2e86853070c844bf98c37c55ca597844')
            voices.B.speakerId=speechVoiceDefaults.create().B.speakerId;
        return {
            enabled: raw.enabled === true,
            provider: merge(defaults().provider, raw.provider),
            voices,
        };
    }
    async function get(workspaceId) {
        var id = workspaceId || owner();
        return project(await speechStore.getSetting('config:' + id));
    }
    function voiceBinding(v) {
        if (!object(v) || v.kind !== KIND || typeof v.speakerId !== 'string' || !v.speakerId.trim())
            throw new Error('请重新绑定Drama 3音色或参考音频');
        var out = structuredClone(v);
        out.speakerId = out.speakerId.trim();
        out.version = String(out.version || '1');
        if (out.speakerId.startsWith('ref:')) {
            if (
                !/^[a-f0-9]{64}$/.test(out.referenceHash || '') ||
                out.speakerId !== 'ref:' + out.referenceHash ||
                typeof out.referenceText !== 'string' ||
                !out.referenceText.trim()
            )
                throw new Error('本地音色参考缺少哈希或准确转录');
        } else if (!/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(out.speakerId))
            throw new Error('Fish音色ID格式不合法');
        return out;
    }
    async function save(value, workspaceId) {
        var id = workspaceId || owner(),
            patch = structuredClone(value),
            verify = guard(id);
        verify();
        if (
            !object(patch) ||
            Object.keys(patch).some(function (key) {
                return !['enabled', 'provider', 'voices'].includes(key);
            })
        )
            throw new Error('语音配置补丁不合法');
        if (patch.provider && patch.provider.kind !== KIND)
            throw new Error('配置页版本已变化，请刷新并填写Fish Drama 3凭证');
        var raw = await speechStore.getSetting('config:' + id);
        verify();
        var next = merge(project(raw), patch);
        next.enabled = next.enabled === true;
        next.provider = merge(defaults().provider, next.provider || {});
        next.provider.apiKey = String(next.provider.apiKey || '').trim();
        next.provider.speed = Number(next.provider.speed);
        if (
            !Number.isFinite(next.provider.speed) ||
            next.provider.speed < 0.5 ||
            next.provider.speed > 2
        )
            throw new Error('语速须在0.5至2之间');
        Object.keys(patch.voices || {}).forEach(function (id) {
            if (patch.voices[id] === null) {
                delete next.voices[id];
                return;
            }
            if (
                id === 'USER' ||
                (typeof npcs !== 'undefined' && !Object.prototype.hasOwnProperty.call(npcs, id))
            )
                throw new Error('仅支持注册NPC的音色绑定');
            next.voices[id] = voiceBinding(next.voices[id]);
        });
        if (
            next.provider.model !== undefined &&
            !speechDrama3.models.includes(next.provider.model)
        )
            throw new Error('仅支持S2.1 Pro或Drama 3配音模型');
        if (next.enabled || next.provider.apiKey) speechDrama3.normalizeConfig(next.provider);
        verify();
        await speechStore.setSetting('config:' + id, next);
        verify();
        return next;
    }
    async function putReference(blob, text, workspaceId) {
        var id = workspaceId || owner(),
            verify = guard(id);
        verify();
        if (!(blob instanceof Blob) || !blob.size || blob.size > 10 * 1024 * 1024)
            throw new Error('参考音频须为不超过10MiB的音频文件');
        if (
            typeof text !== 'string' ||
            !text.trim() ||
            new TextEncoder().encode(text).length > 65536
        )
            throw new Error('请填写参考音频的准确转录（不超过64KiB）');
        var audio = new Uint8Array(await blob.arrayBuffer());
        verify();
        var hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', audio)))
            .map(function (b) {
                return b.toString(16).padStart(2, '0');
            })
            .join('');
        verify();
        await speechStore.setSetting('fish-reference:' + id + ':' + hash, {
            audio: audio,
            sha256: hash,
        });
        verify();
        return {
            kind: KIND,
            speakerId: 'ref:' + hash,
            referenceHash: hash,
            referenceText: text,
            referenceName: typeof blob.name === 'string' ? blob.name : '本地参考',
            version: '1',
        };
    }
    async function resolveVoice(value, workspaceId) {
        var id = workspaceId || owner(),
            verify = guard(id);
        verify();
        var voice = voiceBinding(value);
        if (!voice.speakerId.startsWith('ref:'))
            return { kind: KIND, referenceId: voice.speakerId };
        var saved = await speechStore.getSetting(
            'fish-reference:' + id + ':' + voice.referenceHash,
        );
        verify();
        if (!saved || saved.sha256 !== voice.referenceHash || !(saved.audio instanceof Uint8Array))
            throw new Error('本机参考音频不存在，请重新选择');
        return {
            kind: KIND,
            reference: {
                audio: new Uint8Array(saved.audio),
                text: voice.referenceText,
                sha256: voice.referenceHash,
            },
        };
    }
    return {
        kind: KIND,
        defaults: defaults,
        get: get,
        save: save,
        putReference: putReference,
        resolveVoice: resolveVoice,
        voiceBinding: voiceBinding,
    };
})();
