/** Explicit HTTP transport; never patches fetch or enables CapacitorHttp globally.
 * Android Capacitor 8.4 buffers the entire response before crossing the bridge.
 * maxBytes is a logical JS limit, NOT a native download/memory limit. Aborting
 * only abandons the result: the native request (including a paid POST) continues.
 * The caller owns the wall-clock AbortController/timer. Never retry on failure.
 * Disable Capacitor bridge logging in app configuration before using real keys:
 * debug bridge logging itself includes request options, outside this adapter.
 */
var illustrationHttp = (function () {
    'use strict';
    var DEFAULT_MAX = 32 * 1024 * 1024;

    function fault(code, message) {
        var error = new Error(message);
        error.code = code;
        if (code === 'aborted') error.name = 'AbortError';
        return error;
    }

    function nativePlugin() {
        var cap = typeof Capacitor !== 'undefined' ? Capacitor : null;
        try {
            if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform() ||
                typeof cap.getPlatform !== 'function' || cap.getPlatform() !== 'android') return null;
            var plugin = cap.Plugins && cap.Plugins.CapacitorHttp;
            if (typeof cap.isPluginAvailable === 'function' && !cap.isPluginAvailable('CapacitorHttp')) return null;
            return plugin && typeof plugin.request === 'function' ? plugin : null;
        } catch (_) { return null; }
    }

    function nativeAvailable() { return !!nativePlugin(); }

    function checkedLimit(value) {
        if (value === undefined) return DEFAULT_MAX;
        if (!Number.isSafeInteger(value) || value < 0) throw fault('configuration', '无效的响应大小上限');
        return value;
    }

    function checkSize(size, maxBytes) {
        if (size > maxBytes) throw fault('too_large', '服务返回的数据超过允许大小');
    }

    function textBytes(text, maxBytes) {
        // UTF-8 is at least one byte per UTF-16 code unit (including replacements).
        checkSize(text.length, maxBytes);
        var bytes = new TextEncoder().encode(text);
        checkSize(bytes.length, maxBytes);
        return bytes;
    }

    function base64Bytes(value, maxBytes) {
        if (typeof value !== 'string') throw fault('protocol', '原生网络返回了无效的数据');
        // Android Base64.DEFAULT includes line breaks. Count before allocating
        // the normalized string, atob result, or Uint8Array.
        var length = 0, padding = 0, padded = false;
        for (var i = 0; i < value.length; i++) {
            var c = value.charAt(i);
            if (c === '\r' || c === '\n' || c === '\t' || c === ' ') continue;
            length++;
            if (c === '=') { padded = true; padding++; }
            else if (padded || !/[A-Za-z0-9+/]/.test(c)) throw fault('protocol', '原生网络返回了无效的数据');
        }
        if (length % 4 || padding > 2 || (padding && length < 4)) throw fault('protocol', '原生网络返回了无效的数据');
        var size = length / 4 * 3 - padding;
        checkSize(size, maxBytes);
        var binary;
        try { binary = atob(value.replace(/[\r\n\t ]/g, '')); }
        catch (_) { throw fault('protocol', '原生网络返回了无效的数据'); }
        checkSize(binary.length, maxBytes);
        var bytes = new Uint8Array(binary.length);
        for (var j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
        return bytes;
    }

    function makeResponse(result, maxBytes, method) {
        if (!result || !Number.isInteger(result.status) || result.status < 200 || result.status > 599) {
            throw fault('protocol', '原生网络返回了无效的状态');
        }
        var headers;
        try { headers = new Headers(result.headers || {}); }
        catch (_) { throw fault('protocol', '原生网络返回了无效的响应头'); }
        var noBody = method === 'HEAD' || [204, 205, 304].includes(result.status);
        if (!noBody) {
            var advertised = headers.get('content-length');
            if (advertised && /^\d+$/.test(advertised)) checkSize(Number(advertised), maxBytes);
        }
        var data = result.data, bytes = null;
        if (!noBody) {
            // Android ignores arraybuffer for application/json and for error
            // streams (JSON object/primitive or text). Do NOT atob those values.
            var contentType = headers.get('content-type') || '';
            var json = contentType.includes('application/json') ||
                ((result.error === true || result.status >= 400) && contentType.includes('application/vnd.api+json'));
            if (json || (data !== null && typeof data === 'object') || typeof data === 'number' || typeof data === 'boolean' || data === null) {
                var serialized;
                try { serialized = JSON.stringify(data); }
                catch (_) { throw fault('protocol', '原生网络返回了无效的JSON'); }
                if (serialized === undefined) throw fault('protocol', '原生网络返回了无效的JSON');
                bytes = textBytes(serialized, maxBytes);
            } else if (result.error === true || result.status >= 400) {
                if (typeof data !== 'string') throw fault('protocol', '原生网络返回了无效的数据');
                bytes = textBytes(data, maxBytes);
            } else {
                bytes = base64Bytes(data, maxBytes);
            }
        }
        return new Response(bytes, { status: result.status, headers: headers });
    }

    function nativeOptions(url, options, limits) {
        var headers = new Headers(options.headers || {});
        var request = {
            url: String(url), method: String(options.method || 'GET').toUpperCase(),
            headers: {}, disableRedirects: true, responseType: 'arraybuffer',
            connectTimeout: 15000, readTimeout: 45000
        };
        if (limits.timeoutMs !== undefined) {
            if (!Number.isFinite(limits.timeoutMs) || limits.timeoutMs <= 0) throw fault('configuration', '无效的网络超时设置');
            request.readTimeout = Math.max(1, Math.min(2147483647, Math.floor(limits.timeoutMs)));
            request.connectTimeout = Math.min(15000, request.readTimeout);
        }
        if (options.nativeFormData !== undefined) {
            if (!Array.isArray(options.nativeFormData)) throw fault('input', '无效的原生上传数据');
            request.data = options.nativeFormData.map(function (entry) {
                if (!entry || !['string', 'base64File'].includes(entry.type) || typeof entry.key !== 'string' ||
                    /[\r\n\"]/.test(entry.key) || typeof entry.value !== 'string') throw fault('input', '无效的原生上传数据');
                var item = { key: entry.key, type: entry.type, value: entry.value };
                if (entry.type === 'base64File') {
                    if (typeof entry.fileName !== 'string' || /[\r\n\"]/.test(entry.fileName) ||
                        typeof entry.contentType !== 'string' || /[\r\n]/.test(entry.contentType) ||
                        entry.value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(entry.value)) {
                        throw fault('input', '无效的原生上传数据');
                    }
                    item.fileName = entry.fileName;
                    item.contentType = entry.contentType;
                }
                return item;
            });
            request.dataType = 'formData';
            // Native writer generates its own boundary; browser FormData's
            // boundary must never be reused with the serialized native entries.
            headers.set('Content-Type', 'multipart/form-data');
            headers.delete('Content-Length');
        } else if (options.body !== undefined && options.body !== null) {
            if (typeof options.body !== 'string') throw fault('input', '原生网络请求需要JSON或序列化上传数据');
            if ((headers.get('content-type') || '').includes('application/json')) {
                try { request.data = JSON.parse(options.body); }
                catch (_) { throw fault('input', '无效的JSON请求'); }
            } else {
                request.data = options.body;
                if (!headers.has('content-type')) headers.set('Content-Type', 'text/plain;charset=UTF-8');
            }
        }
        headers.forEach(function (value, key) { request.headers[key] = value; });
        return request;
    }

    async function fetchLike(url, options, limits) {
        options = options || {};
        limits = limits || {};
        var transport = limits.transport || 'auto';
        if (!['auto', 'web', 'native'].includes(transport)) throw fault('configuration', '无效的网络传输方式');
        var signals = [options.signal, limits.signal].filter(function (signal, i, all) { return signal && all.indexOf(signal) === i; });
        if (signals.some(function (signal) { return signal.aborted; })) throw fault('aborted', '已停止等待');
        var plugin = transport === 'web' ? null : nativePlugin();
        if (!plugin && transport === 'native') throw fault('native_unavailable', '当前环境不支持原生网络');
        if (!plugin) {
            var webOptions = Object.assign({}, options);
            delete webOptions.nativeFormData;
            if (!webOptions.signal && limits.signal) webOptions.signal = limits.signal;
            return fetch(url, webOptions);
        }
        var maxBytes = checkedLimit(limits.maxBytes);
        var request;
        try { request = nativeOptions(url, options, limits); }
        catch (error) {
            if (error.code) throw error;
            throw fault('input', '无效的原生网络请求');
        }
        // Install abort listeners before dispatch, handle both Promise outcomes
        // even after abandoning, and never invoke a fallback or automatic retry.
        return new Promise(function (resolve, reject) {
            var settled = false;
            function finish(error, value) {
                if (settled) return;
                settled = true;
                signals.forEach(function (signal) { signal.removeEventListener('abort', abort); });
                if (error) reject(error); else resolve(value);
            }
            function abort() { finish(fault('aborted', '已停止等待')); }
            signals.forEach(function (signal) { signal.addEventListener('abort', abort, { once: true }); });
            if (signals.some(function (signal) { return signal.aborted; })) { abort(); return; }
            var pending;
            try { pending = plugin.request(request); }
            catch (_) { finish(fault('network', '原生网络请求失败')); return; }
            Promise.resolve(pending).then(function (result) {
                if (settled) return;
                try { finish(null, makeResponse(result, maxBytes, request.method)); }
                catch (error) { finish(error.code ? error : fault('protocol', '原生网络返回了无效的数据')); }
            }, function () { finish(fault('network', '原生网络请求失败')); });
        });
    }

    return { nativeAvailable: nativeAvailable, fetchLike: fetchLike };
})();
