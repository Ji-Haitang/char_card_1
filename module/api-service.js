/**
 * api-service.js - API 调用服务
 * 支持 OpenAI 兼容格式（非流式），Phase 1。
 * 
 * 依赖：无
 */

var apiService = (function() {
    var config = {
        endpoint: '',
        apiKey: '',
        model: '',
        type: 'openai',
        temperature: 0.85,
        maxOutputTokens: 8192,
        maxContextTokens: 128000
    };

    function loadConfig() {
        try {
            var saved = localStorage.getItem('jxz_apiConfig');
            if (saved) {
                var parsed = JSON.parse(saved);
                Object.assign(config, parsed);
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

    /** 非流式调用 */
    async function sendMessages(messages) {
        if (!config.endpoint || !config.apiKey || !config.model) {
            throw new Error('请先配置 API 信息（endpoint, key, model）');
        }
        if (config.type === 'gemini') {
            return _callGemini(messages);
        }
        return _callOpenAI(messages);
    }

    async function _callOpenAI(messages) {
        var url = config.endpoint.replace(/\/+$/, '') + '/chat/completions';
        console.log('[API] 发送请求到 OpenAI:', url, '\n[API] 请求体 messages:', JSON.stringify(messages, null, 2));
        var response = await fetch(url, {
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
        });
        if (!response.ok) {
            var text = '';
            try { text = await response.text(); } catch (e) {}
            throw new Error('API 错误 ' + response.status + (text ? ': ' + text.substring(0, 200) : ''));
        }
        var data = await response.json();
        console.log('[API] OpenAI 原始响应:', JSON.stringify(data, null, 2));
        return {
            content: data.choices[0].message.content,
            usage: data.usage
        };
    }

    async function _callGemini(messages) {
        var systemMsgs = messages.filter(function(m) { return m.role === 'system'; });
        var chatMsgs = messages.filter(function(m) { return m.role !== 'system'; });
        var systemPrompt = systemMsgs.map(function(m) { return m.content; }).join('\n\n');

        var url = config.endpoint.replace(/\/+$/, '') + '/models/' + config.model + ':generateContent?key=' + encodeURIComponent(config.apiKey);
        console.log('[API] 发送请求到 Gemini:', url, '\n[API] 请求体 contents:', JSON.stringify(contents, null, 2), '\n[API] systemInstruction:', systemPrompt);
        var contents = chatMsgs.map(function(m) {
            return {
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }]
            };
        });

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
        console.log('[API] Gemini 原始响应:', JSON.stringify(data, null, 2));
        return {
            content: data.candidates[0].content.parts[0].text,
            usage: data.usageMetadata
        };
    }

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
        healthCheck: healthCheck
    };
})();
