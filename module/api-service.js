/**
 * api-service.js - API 调用服务
 * 支持 OpenAI 兼容格式 + Gemini，流式 / 非流式。
 * 
 * 依赖：无
 */

var apiService = (function() {
    var config = {
        endpoint: '',
        apiKey: '',
        model: '',
        type: 'openai',
        temperature: 0.9,
        maxOutputTokens: 18000,
        maxContextTokens: 500000,
        corsProxyUrl: 'https://jxz-cors-proxy.nicholaswuai.workers.dev/'  // 部署后替换为你的 Worker 地址
    };

    function loadConfig() {
        try {
            var saved = localStorage.getItem('jxz_apiConfig');
            if (saved) {
                var parsed = JSON.parse(saved);
                // corsProxyUrl 若用户从未手动改过（为空），保留代码默认值
                var defaultProxy = config.corsProxyUrl;
                Object.assign(config, parsed);
                if (!config.corsProxyUrl) config.corsProxyUrl = defaultProxy;
            }
        } catch (e) {
            console.warn('加载 API 配置失败', e);
        }
    }

    function saveConfig() {
        localStorage.setItem('jxz_apiConfig', JSON.stringify(config));
    }

    function getConfig() {
        return config;
    }

    function updateConfig(newConfig) {
        Object.assign(config, newConfig);
        saveConfig();
    }

    // ========== 环境检测 & CORS 代理路由 ==========

    /**
     * 检测当前运行环境
     * @returns {'file'|'electron'|'webview'|'web'}
     */
    function _getRunEnv() {
        // Electron 环境
        if (typeof process !== 'undefined' && process.versions && process.versions.electron) {
            return 'electron';
        }
        // Android WebView（通过 window.Android 或 userAgent 判断）
        if (typeof window !== 'undefined' && window.Android) {
            return 'webview';
        }
        // file:// 协议本地运行
        if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
            return 'file';
        }
        // 其他：线上 web 部署
        return 'web';
    }

    /**
     * 根据运行环境决定实际请求 URL
     * web 环境且配置了 corsProxyUrl 时，通过代理中转
     * @param {string} url - 原始 API URL
     * @returns {string}
     */
    function _resolveUrl(url) {
        var env = _getRunEnv();
        if (env === 'web' && config.corsProxyUrl) {
            var proxy = config.corsProxyUrl.replace(/\/+$/, '');
            return proxy + '?target=' + encodeURIComponent(url);
        }
        return url;
    }

    async function sendMessages(messages, options) {
        if (!config.endpoint || !config.apiKey || !config.model) {
            throw new Error('请先配置 API 信息（endpoint, key, model）');
        }
        var signal = options && options.signal;
        if (config.type === 'gemini') {
            return _callGemini(messages, signal);
        }
        return _callOpenAI(messages, signal);
    }

    async function _callOpenAI(messages, signal) {
        var url = _resolveUrl(config.endpoint.replace(/\/+$/, '') + '/chat/completions');
        console.log('[API] 发送请求到 OpenAI:', url);
        var fetchOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + config.apiKey
            },
            body: JSON.stringify({
                model: config.model,
                messages: messages,
                temperature: config.temperature,
                max_tokens: config.maxOutputTokens
            })
        };
        if (signal) fetchOptions.signal = signal;
        var response = await fetch(url, fetchOptions);
        if (!response.ok) {
            var text = '';
            try { text = await response.text(); } catch (e) {}
            throw new Error('API 错误 ' + response.status + (text ? ': ' + text.substring(0, 200) : ''));
        }
        var data = await response.json();
        console.log('[API] OpenAI 响应, usage:', data.usage);
        return {
            content: data.choices[0].message.content,
            usage: data.usage
        };
    }

    async function _callGemini(messages) {
        var systemMsgs = messages.filter(function(m) { return m.role === 'system'; });
        var chatMsgs = messages.filter(function(m) { return m.role !== 'system'; });
        var systemPrompt = systemMsgs.map(function(m) { return m.content; }).join('\n\n');

        var contents = chatMsgs.map(function(m) {
            return {
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }]
            };
        });

        var url = _resolveUrl(config.endpoint.replace(/\/+$/, '') + '/models/' + config.model + ':generateContent?key=' + encodeURIComponent(config.apiKey));
        console.log('[API] 发送请求到 Gemini:', url);

        var response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: contents,
                systemInstruction: { parts: [{ text: systemPrompt }] },
                generationConfig: {
                    temperature: config.temperature,
                    maxOutputTokens: config.maxOutputTokens
                }
            })
        });
        if (!response.ok) {
            var text = '';
            try { text = await response.text(); } catch (e) {}
            throw new Error('Gemini 错误 ' + response.status + (text ? ': ' + text.substring(0, 200) : ''));
        }
        var data = await response.json();
        console.log('[API] Gemini 响应, usage:', data.usageMetadata);
        return {
            content: data.candidates[0].content.parts[0].text,
            usage: data.usageMetadata
        };
    }

    // ========== 模型列表 ==========

    async function fetchModels(endpoint, apiKey, type) {
        if (!endpoint || !apiKey) {
            throw new Error('请填写 API 地址和 Key');
        }
        if (type === 'gemini') {
            return _fetchGeminiModels(endpoint, apiKey);
        }
        return _fetchOpenAIModels(endpoint, apiKey);
    }

    async function _fetchOpenAIModels(endpoint, apiKey) {
        var url = _resolveUrl(endpoint.replace(/\/+$/, '') + '/models');
        var response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': 'Bearer ' + apiKey }
        });
        if (!response.ok) {
            var text = '';
            try { text = await response.text(); } catch (e) {}
            throw new Error('获取模型列表失败 ' + response.status + (text ? ': ' + text.substring(0, 200) : ''));
        }
        var data = await response.json();
        var models = (data.data || []).map(function(m) {
            return { id: m.id, name: m.id };
        });
        // 按 id 字母排序
        models.sort(function(a, b) { return a.id.localeCompare(b.id); });
        return models;
    }

    async function _fetchGeminiModels(endpoint, apiKey) {
        var url = _resolveUrl(endpoint.replace(/\/+$/, '') + '/models?key=' + encodeURIComponent(apiKey));
        var response = await fetch(url, {
            method: 'GET'
        });
        if (!response.ok) {
            var text = '';
            try { text = await response.text(); } catch (e) {}
            throw new Error('获取模型列表失败 ' + response.status + (text ? ': ' + text.substring(0, 200) : ''));
        }
        var data = await response.json();
        var models = (data.models || []).map(function(m) {
            // Gemini 返回 "models/gemini-pro" 格式，只取后半部分
            var id = m.name || '';
            if (id.indexOf('models/') === 0) id = id.substring(7);
            return { id: id, name: m.displayName || id };
        });
        models.sort(function(a, b) { return a.id.localeCompare(b.id); });
        return models;
    }

    // ========== 测试消息 ==========

    async function sendTestMessage(tempConfig) {
        if (!tempConfig.endpoint || !tempConfig.apiKey || !tempConfig.model) {
            return { success: false, content: '', error: '请填写完整的 API 信息' };
        }
        var testMessages = [{ role: 'user', content: '你好，请用一句话回复' }];
        try {
            var result;
            if (tempConfig.type === 'gemini') {
                result = await _callGeminiWith(tempConfig, testMessages);
            } else {
                result = await _callOpenAIWith(tempConfig, testMessages);
            }
            return { success: true, content: result.content, error: '' };
        } catch (e) {
            return { success: false, content: '', error: e.message };
        }
    }

    async function _callOpenAIWith(cfg, messages) {
        var url = cfg.endpoint.replace(/\/+$/, '') + '/chat/completions';
        var response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + cfg.apiKey
            },
            body: JSON.stringify({
                model: cfg.model,
                messages: messages,
                temperature: cfg.temperature || 0.85,
                max_tokens: 100
            })
        });
        if (!response.ok) {
            var text = '';
            try { text = await response.text(); } catch (e) {}
            throw new Error('API 错误 ' + response.status + (text ? ': ' + text.substring(0, 200) : ''));
        }
        var data = await response.json();
        return { content: data.choices[0].message.content };
    }

    async function _callGeminiWith(cfg, messages) {
        var contents = messages.map(function(m) {
            return { role: 'user', parts: [{ text: m.content }] };
        });
        var url = cfg.endpoint.replace(/\/+$/, '') + '/models/' + cfg.model + ':generateContent?key=' + encodeURIComponent(cfg.apiKey);
        var response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: contents,
                generationConfig: { temperature: cfg.temperature || 0.85, maxOutputTokens: 100 }
            })
        });
        if (!response.ok) {
            var text = '';
            try { text = await response.text(); } catch (e) {}
            throw new Error('Gemini 错误 ' + response.status + (text ? ': ' + text.substring(0, 200) : ''));
        }
        var data = await response.json();
        return { content: data.candidates[0].content.parts[0].text };
    }

    // ========== 流式调用 (SSE) ==========

    /**
     * 流式发送消息
     * @param {Array} messages - 消息数组
     * @param {object} callbacks - { onToken(text), onThinking(text), onComplete(fullText, usage), onError(err) }
     * @returns {{ abort: Function }} 中断控制器
     */
    function sendMessagesStream(messages, callbacks) {
        if (!config.endpoint || !config.apiKey || !config.model) {
            callbacks.onError(new Error('请先配置 API 信息'));
            return { abort: function() {} };
        }

        var controller = new AbortController();

        if (config.type === 'gemini') {
            _streamGemini(messages, callbacks, controller);
        } else {
            _streamOpenAI(messages, callbacks, controller);
        }

        return { abort: function() { controller.abort(); } };
    }

    async function _streamOpenAI(messages, callbacks, controller) {
        var url = _resolveUrl(config.endpoint.replace(/\/+$/, '') + '/chat/completions');
        var fullContent = '';
        var fullThinking = '';

        var requestBody = {
            model: config.model,
            messages: messages,
            temperature: config.temperature,
            max_tokens: config.maxOutputTokens,
            stream: true
        };
        console.log('[API][DEBUG] 流式请求 body (非messages部分):', JSON.stringify({
            model: requestBody.model,
            temperature: requestBody.temperature,
            max_tokens: requestBody.max_tokens,
            stream: requestBody.stream
        }));

        try {
            var response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + config.apiKey
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal
            });

            if (!response.ok) {
                var errText = '';
                try { errText = await response.text(); } catch (e) {}
                throw new Error('API 错误 ' + response.status + (errText ? ': ' + errText.substring(0, 200) : ''));
            }

            var reader = response.body.getReader();
            var decoder = new TextDecoder();
            var buffer = '';

            while (true) {
                var readResult = await reader.read();
                if (readResult.done) break;

                buffer += decoder.decode(readResult.value, { stream: true });
                var lines = buffer.split('\n');
                buffer = lines.pop(); // 保留不完整的最后一行

                for (var i = 0; i < lines.length; i++) {
                    var line = lines[i].trim();
                    if (!line || !line.startsWith('data: ')) continue;
                    var dataStr = line.substring(6);
                    if (dataStr === '[DONE]') {
                        callbacks.onComplete(fullContent, null);
                        return;
                    }
                    try {
                        var chunk = JSON.parse(dataStr);
                        var delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
                        if (!delta) continue;

                        // DeepSeek reasoning_content（思考链）
                        if (delta.reasoning_content) {
                            fullThinking += delta.reasoning_content;
                            if (callbacks.onThinking) callbacks.onThinking(delta.reasoning_content);
                        }
                        // 正常内容
                        if (delta.content) {
                            fullContent += delta.content;
                            callbacks.onToken(delta.content);
                        }
                    } catch (e) {
                        // JSON 解析失败，跳过
                    }
                }
            }
            // 流结束但没收到 [DONE]
            callbacks.onComplete(fullContent, null);
        } catch (err) {
            if (err.name === 'AbortError') {
                // 用户中断，将已收到的内容作为完成
                callbacks.onComplete(fullContent, null);
            } else {
                callbacks.onError(err);
            }
        }
    }

    async function _streamGemini(messages, callbacks, controller) {
        var systemMsgs = messages.filter(function(m) { return m.role === 'system'; });
        var chatMsgs = messages.filter(function(m) { return m.role !== 'system'; });
        var systemPrompt = systemMsgs.map(function(m) { return m.content; }).join('\n\n');
        var contents = chatMsgs.map(function(m) {
            return {
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }]
            };
        });

        var url = _resolveUrl(config.endpoint.replace(/\/+$/, '') + '/models/' + config.model + ':streamGenerateContent?alt=sse&key=' + encodeURIComponent(config.apiKey));
        var fullContent = '';

        try {
            var response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: contents,
                    systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
                    generationConfig: {
                        temperature: config.temperature,
                        maxOutputTokens: config.maxOutputTokens
                    }
                }),
                signal: controller.signal
            });

            if (!response.ok) {
                var errText = '';
                try { errText = await response.text(); } catch (e) {}
                throw new Error('Gemini 错误 ' + response.status + (errText ? ': ' + errText.substring(0, 200) : ''));
            }

            var reader = response.body.getReader();
            var decoder = new TextDecoder();
            var buffer = '';

            while (true) {
                var readResult = await reader.read();
                if (readResult.done) break;

                buffer += decoder.decode(readResult.value, { stream: true });
                var lines = buffer.split('\n');
                buffer = lines.pop();

                for (var i = 0; i < lines.length; i++) {
                    var line = lines[i].trim();
                    if (!line || !line.startsWith('data: ')) continue;
                    var dataStr = line.substring(6);
                    try {
                        var chunk = JSON.parse(dataStr);
                        var parts = chunk.candidates && chunk.candidates[0] &&
                                    chunk.candidates[0].content && chunk.candidates[0].content.parts;
                        if (parts && parts.length > 0 && parts[0].text) {
                            var text = parts[0].text;
                            fullContent += text;
                            callbacks.onToken(text);
                        }
                    } catch (e) {
                        // JSON 解析失败，跳过
                    }
                }
            }
            callbacks.onComplete(fullContent, null);
        } catch (err) {
            if (err.name === 'AbortError') {
                callbacks.onComplete(fullContent, null);
            } else {
                callbacks.onError(err);
            }
        }
    }

    // ========== 健康检查 ==========

    async function healthCheck() {
        try {
            await sendMessages([{ role: 'user', content: 'ping' }]);
            return true;
        } catch (e) {
            return false;
        }
    }

    return {
        loadConfig: loadConfig,
        saveConfig: saveConfig,
        getConfig: getConfig,
        updateConfig: updateConfig,
        sendMessages: sendMessages,
        sendMessagesStream: sendMessagesStream,
        fetchModels: fetchModels,
        sendTestMessage: sendTestMessage,
        healthCheck: healthCheck,
        getRunEnv: _getRunEnv
    };
})();
