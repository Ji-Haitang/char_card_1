/** Fish Drama 3 transport. Load msgpack.js first for inline references.
 * No storage, persistent voice creation, fallback provider, balance lookup or retries.
 */
var speechDrama3 = (function () {
    'use strict';
    var PROVIDER = 'fish-drama3',
        MODEL = 'drama-3',
        ENDPOINT = 'https://api.fish.audio/v1/tts';
    var FORMAT = 'mp3',
        SAMPLE_RATE = 44100;
    var MAX_REFERENCE = 10 * 1024 * 1024,
        MAX_AUDIO = 16 * 1024 * 1024;
    var MAX_TRANSCRIPT = 64 * 1024,
        PROMOTION_END = '2026-12-01T08:00:00.000Z';
    var safeErrors = new WeakSet(),
        utf8 = new TextEncoder();
    function fault(code) {
        var messages = {
            configuration: '请显式配置Fish Drama 3及有效API Key；模型与官方上游固定',
            input: '台词或简短表现描述无效，未修改原文或发送合成请求',
            voice: '请绑定有效Fish音色ID或原始参考音频及准确转录、匹配的SHA-256',
            environment: '当前环境缺少语音合成所需的浏览器能力',
            aborted: '语音请求已取消',
            http: 'Fish语音服务返回HTTP错误',
            network: 'Fish语音网络请求失败，未自动重试',
            stream: '语音流中断或不完整，未保存残缺音频',
            empty: '语音服务未返回音频',
            content_type: '语音服务未返回受支持的MP3音频',
            too_large: '语音响应超过本地16MB限制',
            estimate: '费用估算时间无效',
        };
        var error = new Error(messages[code]);
        error.code = code;
        if (code === 'aborted') error.name = 'AbortError';
        safeErrors.add(error);
        return error;
    }
    function wellFormed(text) {
        for (var i = 0; i < text.length; i++) {
            var c = text.charCodeAt(i);
            if (c >= 0xd800 && c <= 0xdbff) {
                var next = text.charCodeAt(++i);
                if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
            } else if (c >= 0xdc00 && c <= 0xdfff) return false;
        }
        return true;
    }
    function normalizeConfig(config) {
        try {
            if (!config || config.kind !== PROVIDER || typeof config.apiKey !== 'string')
                throw fault('configuration');
            var key = config.apiKey.trim(),
                speed = config.speed === undefined ? 1 : config.speed;
            if (
                !key ||
                key.length > 4096 ||
                !/^[\x21-\x7e]+$/.test(key) ||
                typeof speed !== 'number' ||
                !Number.isFinite(speed) ||
                speed < 0.5 ||
                speed > 2
            )
                throw fault('configuration');
            var fixed = {
                provider: PROVIDER,
                endpoint: ENDPOINT,
                model: MODEL,
                format: FORMAT,
                sampleRate: SAMPLE_RATE,
            };
            Object.keys(fixed).forEach(function (name) {
                if (config[name] !== undefined && config[name] !== fixed[name])
                    throw fault('configuration');
            });
            if (config.proxyUrl) throw fault('configuration');
            // Platform routing is handled separately below; this protocol adapter keeps the Fish endpoint fixed.
            return Object.freeze({
                kind: PROVIDER,
                provider: PROVIDER,
                apiKey: key,
                endpoint: ENDPOINT,
                model: MODEL,
                format: FORMAT,
                sampleRate: SAMPLE_RATE,
                speed: speed,
            });
        } catch (_) {
            throw fault('configuration');
        }
    }
    function composeText(text, direction) {
        if (
            typeof text !== 'string' ||
            text.length > 480 ||
            !text.trim() ||
            Array.from(text).length > 240 ||
            !wellFormed(text)
        )
            throw fault('input');
        // Fish bracket directions, paired/language/phoneme/speaker tags are executable.
        // Reject complete bracket/tag syntax conservatively; never strip or rewrite the dialogue.
        if (/\[[^\]]*\]|<[^>]*>/u.test(text)) throw fault('input');
        if (direction === undefined || direction === null || direction === '') return text;
        if (
            typeof direction !== 'string' ||
            direction.length > 48 ||
            !direction.trim() ||
            Array.from(direction).length > 24 ||
            !wellFormed(direction) ||
            /[\[\]【】<>|；;\p{Cc}\p{Cf}]/u.test(direction)
        )
            throw fault('input');
        return '[' + direction + '] ' + text;
    }
    function snapshotVoice(voice) {
        try {
            if (!voice || voice.kind !== PROVIDER) throw fault('voice');
            var hasId = voice.referenceId !== undefined && voice.referenceId !== null;
            var hasReference = voice.reference !== undefined && voice.reference !== null;
            if (hasId === hasReference) throw fault('voice');
            if (hasId) {
                var id = voice.referenceId;
                // OpenAPI declares a string, not a specific UUID shape. Accept a bounded ASCII token.
                if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id))
                    throw fault('voice');
                return { referenceId: id };
            }
            var ref = voice.reference;
            if (
                !ref ||
                !(ref.audio instanceof Uint8Array) ||
                !ref.audio.byteLength ||
                ref.audio.byteLength > MAX_REFERENCE ||
                typeof ref.text !== 'string' ||
                !ref.text.trim() ||
                ref.text.length > MAX_TRANSCRIPT ||
                !wellFormed(ref.text) ||
                utf8.encode(ref.text).length > MAX_TRANSCRIPT ||
                typeof ref.sha256 !== 'string' ||
                !/^[a-fA-F0-9]{64}$/.test(ref.sha256)
            )
                throw fault('voice');
            // Snapshot before the first await: hashing and sending must use the same immutable bytes/text.
            return {
                reference: {
                    audio: new Uint8Array(ref.audio),
                    text: ref.text,
                    sha256: ref.sha256.toLowerCase(),
                },
            };
        } catch (_) {
            throw fault('voice');
        }
    }
    async function verifyVoice(snapshot) {
        if (snapshot.referenceId) return JSON.stringify([PROVIDER, 'id', snapshot.referenceId]);
        var ref = snapshot.reference;
        if (!globalThis.crypto || !globalThis.crypto.subtle) throw fault('environment');
        var digest;
        try {
            digest = await globalThis.crypto.subtle.digest('SHA-256', ref.audio);
        } catch (_) {
            throw fault('voice');
        }
        var hex = Array.from(new Uint8Array(digest), function (n) {
            return n.toString(16).padStart(2, '0');
        }).join('');
        if (hex !== ref.sha256) throw fault('voice');
        // Versioned, collision-free tuple preserves exact transcript (no trim/Unicode normalization).
        return JSON.stringify([PROVIDER, 'reference-sha256-v1', hex, ref.text]);
    }
    async function voiceIdentity(voice) {
        return verifyVoice(snapshotVoice(voice));
    }
    function estimate(text, direction, now) {
        var sent = composeText(text, direction);
        var time = now === undefined ? Date.now() : new Date(now).getTime();
        if (!Number.isFinite(time)) throw fault('estimate');
        var bytes = utf8.encode(sent).length,
            promotional = time < Date.parse(PROMOTION_END);
        var rate = promotional ? 10 : 50;
        return {
            billableBytes: bytes,
            currency: 'USD',
            estimatedUsd: (bytes * rate) / 1000000,
            usdPerMillionBytes: rate,
            standardUsdPerMillionBytes: 50,
            promotional: promotional,
            promotionEndsAt: PROMOTION_END,
            estimateOnly: true,
        };
    }
    // Cleanup never blocks cancellation or leaks a transport's exception/reason.
    function cancelReader(reader) {
        if (!reader) return;
        try {
            Promise.resolve(reader.cancel()).catch(function () {});
        } catch (_) {}
    }
    function discardResponse(response) {
        var reader;
        try {
            if (response && response.body) {
                reader = response.body.getReader();
                cancelReader(reader);
            }
        } catch (_) {
        } finally {
            try {
                if (reader) reader.releaseLock();
            } catch (_) {}
        }
    }
    function looksLikeMp3(parts, total) {
        function byteAt(index) {
            for (var i = 0; i < parts.length; i++) {
                if (index < parts[i].length) return parts[i][index];
                index -= parts[i].length;
            }
            return -1;
        }
        var start = 0;
        // Signature sanity only; full decode validation belongs to the existing Blob player.
        // ID3 metadata alone is not audio: skip its declared bytes and require an MPEG frame header.
        if (byteAt(0) === 73 && byteAt(1) === 68 && byteAt(2) === 51) {
            if (total < 10 || byteAt(3) < 2 || byteAt(3) > 4 || byteAt(4) === 255) return false;
            var tagSize = 0;
            for (var n = 6; n < 10; n++) {
                var b = byteAt(n);
                if (b & 128) return false;
                tagSize = tagSize * 128 + b;
            }
            start = 10 + tagSize + (byteAt(3) === 4 && byteAt(5) & 16 ? 10 : 0);
        }
        var second = byteAt(start + 1),
            third = byteAt(start + 2);
        return (
            total >= start + 4 &&
            byteAt(start) === 255 &&
            (second & 224) === 224 &&
            (second & 24) !== 8 &&
            (second & 6) === 2 &&
            third >> 4 > 0 &&
            third >> 4 < 15 &&
            (third & 12) !== 12
        );
    }
    async function synthesize(config, request, options) {
        var reader,
            response,
            signal,
            onAbort,
            rejectWait,
            stage = 'configuration';
        var successful = false;
        try {
            options = options || {};
            signal = options.signal;
            if (signal && signal.aborted) throw fault('aborted');
            onAbort = function () {
                cancelReader(reader);
                if (rejectWait) rejectWait(fault('aborted'));
            };
            if (signal) signal.addEventListener('abort', onAbort, { once: true });
            function checkAbort() {
                if (signal && signal.aborted) throw fault('aborted');
            }
            function wait(promise) {
                // One current waiter, not a forever-pending abort Promise retaining every stream chunk.
                return new Promise(function (resolve, reject) {
                    rejectWait = reject;
                    Promise.resolve(promise).then(
                        function (value) {
                            if (rejectWait === reject) rejectWait = null;
                            resolve(value);
                        },
                        function (error) {
                            if (rejectWait === reject) rejectWait = null;
                            reject(error);
                        },
                    );
                    // Covers synchronous abort in a mock fetch before this waiter was installed.
                    if (signal && signal.aborted) reject(fault('aborted'));
                });
            }
            var settings = normalizeConfig(config);
            stage = 'input';
            if (!request || typeof request !== 'object') throw fault('input');
            var text = composeText(request.text, request.direction),
                billableBytes = utf8.encode(text).length;
            stage = 'voice';
            var voice = snapshotVoice(request.voice);
            await wait(verifyVoice(voice));
            checkAbort();
            var body = {
                text: text,
                format: FORMAT,
                sample_rate: SAMPLE_RATE,
                latency: 'normal',
                prosody: { speed: settings.speed },
            };
            var contentType = 'application/json';
            if (voice.referenceId) {
                body.reference_id = voice.referenceId;
                body = JSON.stringify(body);
            } else {
                if (typeof speechMsgpack === 'undefined') throw fault('environment');
                body.references = [{ audio: voice.reference.audio, text: voice.reference.text }];
                body = speechMsgpack.encode(body);
                contentType = 'application/msgpack';
            }
            var fetcher = options.fetch === undefined ? globalThis.fetch : options.fetch;
            if (typeof fetcher !== 'function') throw fault('environment');
            checkAbort();
            stage = 'network';
            var pending = Promise.resolve(
                fetcher(ENDPOINT, {
                    method: 'POST',
                    redirect: 'error',
                    credentials: 'omit',
                    referrerPolicy: 'no-referrer',
                    signal: signal,
                    headers: {
                        Authorization: 'Bearer ' + settings.apiKey,
                        model: MODEL,
                        'Content-Type': contentType,
                        Accept: 'audio/mpeg, audio/mp3',
                    },
                    body: body,
                }),
            ).then(function (late) {
                if (signal && signal.aborted) {
                    discardResponse(late);
                    throw fault('aborted');
                }
                return late;
            });
            response = await wait(pending);
            checkAbort();
            stage = 'stream';
            if (!response || !response.headers || typeof response.status !== 'number')
                throw fault('stream');
            if (!response.ok) {
                var error = fault('http');
                if (
                    Number.isInteger(response.status) &&
                    response.status >= 100 &&
                    response.status <= 599
                ) {
                    error.status = response.status;
                    error.message += '（' + response.status + '）';
                }
                throw error;
            }
            if (response.redirected) throw fault('network');
            var mime = (response.headers.get('Content-Type') || '')
                .split(';')[0]
                .trim()
                .toLowerCase();
            if (mime !== 'audio/mpeg' && mime !== 'audio/mp3') throw fault('content_type');
            var declared = response.headers.get('Content-Length'),
                expected = null;
            if (declared !== null && /^\d+$/.test(declared)) {
                expected = Number(declared);
                if (expected > MAX_AUDIO) throw fault('too_large');
                // Content-Length measures encoded wire bytes when Content-Encoding is present.
                if (response.headers.get('Content-Encoding')) expected = null;
            }
            if (!response.body || typeof response.body.getReader !== 'function')
                throw fault('empty');
            reader = response.body.getReader();
            var parts = [],
                total = 0,
                block = null,
                used = 0;
            while (true) {
                checkAbort();
                var part = await wait(reader.read());
                checkAbort();
                if (part.done) break;
                if (!(part.value instanceof Uint8Array)) throw fault('stream');
                if (part.value.byteLength > MAX_AUDIO - total) throw fault('too_large');
                // Coalesce tiny network chunks: bounded payload must also mean bounded array overhead.
                for (var at = 0; at < part.value.byteLength; ) {
                    if (!block) {
                        block = new Uint8Array(65536);
                        used = 0;
                    }
                    var size = Math.min(block.length - used, part.value.byteLength - at);
                    block.set(part.value.subarray(at, at + size), used);
                    used += size;
                    at += size;
                    if (used === block.length) {
                        parts.push(block);
                        block = null;
                    }
                }
                total += part.value.byteLength;
            }
            if (block && used) parts.push(block.subarray(0, used));
            if (!total) throw fault('empty');
            if (expected !== null && total !== expected) throw fault('stream');
            if (!looksLikeMp3(parts, total)) throw fault('content_type');
            checkAbort();
            var blob = new Blob(parts, { type: 'audio/mpeg' });
            successful = true;
            return {
                blob: blob,
                provider: PROVIDER,
                model: MODEL,
                format: FORMAT,
                sampleRate: SAMPLE_RATE,
                billableBytes: billableBytes,
            };
        } catch (error) {
            if (signal && signal.aborted) throw fault('aborted');
            if (safeErrors.has(error)) throw error;
            throw fault(stage); // No server body/statusText, cause, abort reason, URL or Key copied.
        } finally {
            rejectWait = null;
            if (signal && onAbort) signal.removeEventListener('abort', onAbort);
            if (!successful) {
                if (reader) cancelReader(reader);
                else discardResponse(response);
            }
            try {
                if (reader) reader.releaseLock();
            } catch (_) {}
        }
    }
    return Object.freeze({
        provider: PROVIDER,
        model: MODEL,
        endpoint: ENDPOINT,
        format: FORMAT,
        sampleRate: SAMPLE_RATE,
        normalizeConfig: normalizeConfig,
        composeText: composeText,
        voiceIdentity: voiceIdentity,
        synthesize: synthesize,
        estimate: estimate,
    });
})();

/** Speech HTTP routing: Android native adapter and the game's configured Web CORS service. */
var speechTransport = (function () {
    'use strict';
    var UPSTREAM = 'https://api.fish.audio/v1/tts',
        MAX_AUDIO = 16 * 1024 * 1024,
        TIMEOUT = 180000;
    function nativePlatform() {
        try {
            return (
                typeof Capacitor !== 'undefined' &&
                Capacitor.isNativePlatform() &&
                Capacitor.getPlatform() === 'android'
            );
        } catch (_) {
            return false;
        }
    }
    function fault(code, message) {
        var e = new Error(message);
        e.code = code;
        return e;
    }
    function route() {
        if (nativePlatform()) {
            var ready =
                typeof illustrationHttp !== 'undefined' && illustrationHttp.nativeAvailable();
            return {
                configured: ready,
                mode: 'android-native',
                endpoint: UPSTREAM,
                origin: 'https://api.fish.audio',
                supportsReference: false,
                message: ready ? 'Android原生连接：Fish Audio' : '当前APK的原生联网桥暂不可用。',
            };
        }
        try {
            var config = apiService.getConfig();
            if (
                config.corsProxyEnabled !== true ||
                typeof config.corsProxyUrl !== 'string' ||
                !config.corsProxyUrl.trim()
            )
                throw new Error();
            var url = new URL(config.corsProxyUrl.trim());
            if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
                throw new Error();
            return {
                configured: true,
                mode: 'web-proxy',
                endpoint: url.href.replace(/\/+$/, '') + '?target=' + encodeURIComponent(UPSTREAM),
                origin: url.origin,
                supportsReference: true,
                message:
                    '网页连接：使用API设置中的跨域服务。Fish Key和本次语音请求将经此服务转交Fish。',
            };
        } catch (_) {
            return {
                configured: false,
                mode: 'web-proxy',
                origin: '',
                supportsReference: true,
                message: '请在API设置中启用有效的HTTPS跨域服务，语音请求使用该路由。',
            };
        }
    }
    function describe() {
        var r = route();
        return {
            configured: r.configured,
            mode: r.mode,
            origin: r.origin,
            supportsReference: r.supportsReference,
            message: r.message,
        };
    }
    function checkVoiceFor(mode, voice) {
        if (mode === 'android-native' && voice && voice.reference)
            throw fault('native-reference', '当前APK语音请选择Fish声线ID。');
    }
    function checkVoice(voice) {
        checkVoiceFor(nativePlatform() ? 'android-native' : 'web-proxy', voice);
    }
    function nativeFetch(options) {
        var headers = new Headers(options.headers || {});
        if (
            !headers.get('content-type')?.toLowerCase().startsWith('application/json') ||
            typeof options.body !== 'string'
        )
            throw fault('native-reference', '当前APK语音请求需要JSON声线ID参数。');
        var controller = new AbortController(),
            timedOut = false;
        function abort() {
            controller.abort();
        }
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener('abort', abort, { once: true });
        var timer = setTimeout(function () {
            timedOut = true;
            controller.abort();
        }, TIMEOUT);
        return illustrationHttp
            .fetchLike(
                UPSTREAM,
                { method: 'POST', headers: headers, body: options.body, signal: controller.signal },
                { transport: 'native', maxBytes: MAX_AUDIO, timeoutMs: TIMEOUT },
            )
            .catch(function (error) {
                if (timedOut) throw fault('timeout', '原生语音等待超时，服务端结果仍需核对。');
                throw error;
            })
            .finally(function () {
                clearTimeout(timer);
                options.signal?.removeEventListener('abort', abort);
            });
    }
    function capture() {
        var selected = route();
        if (!selected.configured)
            throw fault(
                selected.mode === 'android-native' ? 'native-unavailable' : 'web-route',
                selected.message,
            );
        return Object.freeze({
            endpoint: selected.endpoint,
            mode: selected.mode,
            checkVoice: function (voice) {
                checkVoiceFor(selected.mode, voice);
            },
            fetch: function (url, options) {
                options = options || {};
                var headers = new Headers(options.headers || {});
                if (
                    url !== UPSTREAM ||
                    options.method !== 'POST' ||
                    headers.get('model') !== 'drama-3'
                )
                    throw fault('target', '语音传输目标或模型不合法');
                var forwarded = new Headers();
                ['Authorization', 'Content-Type', 'model'].forEach(function (k) {
                    if (headers.has(k)) forwarded.set(k, headers.get(k));
                });
                if (selected.mode === 'android-native')
                    return nativeFetch({
                        headers: forwarded,
                        body: options.body,
                        signal: options.signal,
                    });
                return globalThis.fetch(selected.endpoint, {
                    method: 'POST',
                    headers: forwarded,
                    body: options.body,
                    signal: options.signal,
                    mode: 'cors',
                    credentials: 'omit',
                    redirect: 'error',
                    cache: 'no-store',
                });
            },
        });
    }
    return Object.freeze({
        capture: capture,
        endpoint: function () {
            return capture().endpoint;
        },
        describe: describe,
        checkVoice: checkVoice,
        fetch: function (url, options) {
            return capture().fetch(url, options);
        },
    });
})();
