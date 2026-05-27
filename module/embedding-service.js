/**
 * embedding-service.js - Embedding API 服务（硅基流动 bge-m3）
 * Phase 3：向量化历史管理
 *
 * 功能：
 * - 调用硅基流动 /v1/embeddings（OpenAI 兼容格式）
 * - 多 Key 轮询（逗号/分号/竖线/换行分隔，均摊免费 Key 的 QPS 限额）
 * - AbortController 超时（默认 15 秒）
 * - Engine Fingerprint（模型标识，用于检测旧向量是否需要重建）
 * - 存储失败通知节流（10 秒冷却期，防止连续弹窗）
 *
 * 依赖：无（纯 fetch，不依赖任何其他模块）
 */

var embeddingService = (function() {
    // --- 配置存储 ---
    var LS_KEY = 'jxz_embeddingConfig';
    var DEFAULT_CONFIG = {
        enabled: false,
        endpoint: 'https://api.siliconflow.cn/v1',
        apiKey: '',
        model: 'BAAI/bge-m3'
    };

    // --- 多 Key 轮询状态 ---
    var _keyIndex = 0;

    // --- 通知节流状态 ---
    var _lastStoreFailAt = 0;
    var STORE_FAIL_COOLDOWN = 10000; // 10 秒

    // =========================================================================
    // 配置管理
    // =========================================================================

    function getConfig() {
        try {
            var raw = localStorage.getItem(LS_KEY);
            if (!raw) return Object.assign({}, DEFAULT_CONFIG);
            return Object.assign({}, DEFAULT_CONFIG, JSON.parse(raw));
        } catch (e) {
            return Object.assign({}, DEFAULT_CONFIG);
        }
    }

    function updateConfig(cfg) {
        try {
            var merged = Object.assign({}, getConfig(), cfg);
            localStorage.setItem(LS_KEY, JSON.stringify(merged));
        } catch (e) {
            console.warn('[EmbeddingService] 保存配置失败:', e.message);
        }
    }

    /**
     * 是否已启用（enabled=true 且 apiKey 非空）
     */
    function isEnabled() {
        var cfg = getConfig();
        return !!(cfg.enabled && cfg.apiKey && cfg.apiKey.trim().length > 0);
    }

    // =========================================================================
    // 多 Key 轮询
    // =========================================================================

    function _parseKeys(rawKey) {
        return String(rawKey || '')
            .split(/[,;|\n]+/)
            .map(function(k) { return k.trim(); })
            .filter(function(k) { return k.length > 0; });
    }

    function _getNextKey(rawKey) {
        var keys = _parseKeys(rawKey);
        if (!keys.length) return null;
        if (keys.length === 1) return keys[0];
        var key = keys[_keyIndex % keys.length];
        _keyIndex = (_keyIndex + 1) % keys.length;
        return key;
    }

    // =========================================================================
    // Engine Fingerprint
    // =========================================================================

    /**
     * 返回当前 embedding 模型标识，格式：model@siliconflow
     * 用于检测历史向量是否与当前模型匹配
     */
    function getFingerprint() {
        var cfg = getConfig();
        return (cfg.model || 'BAAI/bge-m3') + '@siliconflow';
    }

    // =========================================================================
    // 核心 Embedding 接口
    // =========================================================================

    /**
     * 对文本列表计算 embedding 向量
     * @param {string[]} texts - 输入文本列表
     * @param {object} [options]
     * @param {number} [options.timeout=15000] - 超时毫秒数
     * @returns {Promise<Float32Array[]|null>} - 成功返回向量数组，失败返回 null
     */
    async function embed(texts, options) {
        options = options || {};
        if (!Array.isArray(texts) || texts.length === 0) return null;

        var cfg = getConfig();
        var key = _getNextKey(cfg.apiKey);
        if (!key) {
            console.warn('[EmbeddingService] 未配置 API Key');
            return null;
        }

        var timeout = options.timeout || 15000;
        var controller = new AbortController();
        var timeoutId = setTimeout(function() { controller.abort(); }, timeout);

        try {
            var baseUrl = (cfg.endpoint || 'https://api.siliconflow.cn/v1').replace(/\/+$/, '');
            var response = await fetch(baseUrl + '/embeddings', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + key,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: cfg.model || 'BAAI/bge-m3',
                    input: texts,
                    encoding_format: 'float'
                }),
                signal: controller.signal
            });

            if (!response.ok) {
                var errText = '';
                try { errText = await response.text(); } catch (_) {}
                throw new Error('HTTP ' + response.status + ': ' + errText.slice(0, 200));
            }

            var data = await response.json();
            if (!data || !data.data || !Array.isArray(data.data)) {
                throw new Error('响应格式异常：缺少 data 字段');
            }

            // 按 index 排序（确保顺序与输入一致）
            var sorted = data.data.slice().sort(function(a, b) { return a.index - b.index; });
            return sorted.map(function(item) {
                return new Float32Array(item.embedding);
            });

        } catch (e) {
            if (e.name === 'AbortError') {
                console.warn('[EmbeddingService] embed 超时（>' + timeout + 'ms）');
            } else {
                console.warn('[EmbeddingService] embed 失败:', e.message);
            }
            return null;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    // =========================================================================
    // 通知节流
    // =========================================================================

    /**
     * 是否可以弹出存储失败通知（10 秒冷却期）
     * @returns {boolean}
     */
    function canNotifyStoreFail() {
        var now = Date.now();
        if (now - _lastStoreFailAt < STORE_FAIL_COOLDOWN) return false;
        _lastStoreFailAt = now;
        return true;
    }

    // =========================================================================
    // 连接测试
    // =========================================================================

    /**
     * 测试 embedding 连接是否可用
     * @param {object} [tempCfg] - 临时配置覆盖（表单未保存时传入，不写 localStorage）
     * @returns {Promise<{ok: boolean, dims: number, error: string}>}
     */
    async function testConnection(tempCfg) {
        // 若传入临时配置，先暂存再恢复，避免影响正式配置
        var backup = null;
        if (tempCfg) {
            backup = getConfig();
            try { localStorage.setItem(LS_KEY, JSON.stringify(Object.assign({}, backup, tempCfg))); } catch (_) {}
        }
        try {
            var result = await embed(['测试连接'], { timeout: 20000 });
            if (!result || !result[0] || !result[0].length) {
                return { ok: false, dims: 0, error: 'API Key 无效或请求返回空结果' };
            }
            return { ok: true, dims: result[0].length, error: '' };
        } catch (e) {
            return { ok: false, dims: 0, error: e.message };
        } finally {
            // 恢复正式配置
            if (backup !== null) {
                try { localStorage.setItem(LS_KEY, JSON.stringify(backup)); } catch (_) {}
            }
        }
    }

    // =========================================================================
    // 公开接口
    // =========================================================================

    return {
        getConfig: getConfig,
        updateConfig: updateConfig,
        isEnabled: isEnabled,
        getFingerprint: getFingerprint,
        embed: embed,
        canNotifyStoreFail: canNotifyStoreFail,
        testConnection: testConnection
    };
})();
