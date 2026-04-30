/**
 * config-modal.js - API 配置弹窗
 * 依赖：api-service.js
 */

function showConfigModal() {
    var existing = document.getElementById('api-config-modal');
    if (existing) existing.remove();

    var config = apiService.getConfig();
    var html = '<div id="api-config-modal" class="modal viewport-overlay"><div class="modal-content" style="max-width:480px"><h3>API 配置</h3><p style="font-size:13px;color:#888;margin-bottom:15px">请输入您的 API 信息。支持 OpenAI 兼容格式与 Gemini API。密钥仅保存在浏览器本地。</p>';
    html += '<div style="margin-bottom:12px"><label style="display:block;margin-bottom:4px">API 类型</label><select id="api-type-select" style="width:100%;padding:8px;border-radius:6px;border:1px solid #ccc"><option value="openai"' + (config.type==='openai'?' selected':'') + '>OpenAI 兼容</option><option value="gemini"' + (config.type==='gemini'?' selected':'') + '>Gemini</option></select></div>';
    html += '<div style="margin-bottom:12px"><label style="display:block;margin-bottom:4px">API 地址（Endpoint）</label><input id="api-endpoint-input" type="text" placeholder="如 https://api.openai.com/v1" value="' + _escapeHtml(config.endpoint) + '" style="width:100%;padding:8px;border-radius:6px;border:1px solid #ccc"></div>';
    html += '<div style="margin-bottom:12px"><label style="display:block;margin-bottom:4px">API Key</label><input id="api-key-input" type="password" placeholder="sk-..." value="' + _escapeHtml(config.apiKey) + '" style="width:100%;padding:8px;border-radius:6px;border:1px solid #ccc"></div>';
    html += '<div style="margin-bottom:12px"><label style="display:block;margin-bottom:4px">模型名称</label><input id="api-model-input" type="text" placeholder="如 gpt-4o-mini" value="' + _escapeHtml(config.model) + '" style="width:100%;padding:8px;border-radius:6px;border:1px solid #ccc"></div>';
    html += '<div style="margin-bottom:12px;display:flex;gap:8px"><div style="flex:1"><label style="display:block;margin-bottom:4px">Temperature</label><input id="api-temp-input" type="number" min="0" max="2" step="0.05" value="' + config.temperature + '" style="width:100%;padding:8px;border-radius:6px;border:1px solid #ccc"></div><div style="flex:1"><label style="display:block;margin-bottom:4px">最大输出 Token</label><input id="api-max-tokens-input" type="number" min="100" max="128000" step="100" value="' + config.maxOutputTokens + '" style="width:100%;padding:8px;border-radius:6px;border:1px solid #ccc"></div></div>';
    html += '<div style="margin-bottom:12px"><label style="display:block;margin-bottom:4px">上下文窗口（Token）</label><input id="api-ctx-tokens-input" type="number" min="1000" max="2000000" step="1000" value="' + config.maxContextTokens + '" style="width:100%;padding:8px;border-radius:6px;border:1px solid #ccc"></div>';
    html += '<div style="background:#fff3cd;padding:8px 12px;border-radius:6px;margin-bottom:15px;font-size:12px;color:#856404">⚠️ 安全提示：API Key 仅保存在浏览器本地，不会上传到任何服务器。请使用支持 CORS 的中转站或部署代理服务。</div>';
    html += '<div class="modal-buttons"><button class="modal-btn cancel" onclick="closeConfigModal()">取消</button><button class="modal-btn" style="background:#4CAF50;color:#fff" onclick="saveConfigAndClose()">保存</button></div></div></div>';

    document.body.insertAdjacentHTML('beforeend', html);
    document.getElementById('api-config-modal').style.display = 'block';
    try {
        requestAnimationFrame(function() {
            var modal = document.getElementById('api-config-modal');
            if (typeof fitModalToViewport === 'function') fitModalToViewport(modal);
            if (typeof bindModalAutoFit === 'function') bindModalAutoFit(modal);
        });
    } catch(e) {}
}

function closeConfigModal() {
    var modal = document.getElementById('api-config-modal');
    if (modal) modal.style.display = 'none';
}

function saveConfigAndClose() {
    var newConfig = {
        type: document.getElementById('api-type-select').value,
        endpoint: document.getElementById('api-endpoint-input').value.trim(),
        apiKey: document.getElementById('api-key-input').value.trim(),
        model: document.getElementById('api-model-input').value.trim(),
        temperature: parseFloat(document.getElementById('api-temp-input').value) || 0.85,
        maxOutputTokens: parseInt(document.getElementById('api-max-tokens-input').value) || 8192,
        maxContextTokens: parseInt(document.getElementById('api-ctx-tokens-input').value) || 128000
    };
    if (!newConfig.endpoint || !newConfig.apiKey || !newConfig.model) {
        alert('请填写完整的 API 信息（地址、Key、模型名）');
        return;
    }
    apiService.updateConfig(newConfig);
    closeConfigModal();
    if (typeof showModal === 'function') showModal('API 配置已保存！');
}

function _escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
