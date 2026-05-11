/**
 * config-modal.js - API 配置弹窗（增强版）
 * 支持连接测试、模型列表、测试消息
 * 使用 CSS class 驱动样式，适配暗色/亮色主题
 * 依赖：api-service.js
 */

function showConfigModal() {
    var existing = document.getElementById('api-config-modal');
    if (existing) existing.remove();

    var config = apiService.getConfig();
    // 内容区 HTML（与外层结构无关）
    var innerHtml =
        '<h3 class="cfg-title">API 配置</h3>' +
        '<p class="cfg-hint">请输入您的 API 信息。支持 OpenAI 兼容格式与 Gemini API。密钥仅保存在浏览器本地。</p>' +

        // API 类型
        '<div class="cfg-field"><label class="cfg-label">API 类型</label>' +
        '<select id="api-type-select" class="cfg-input">' +
        '<option value="openai"' + (config.type === 'openai' ? ' selected' : '') + '>OpenAI 兼容</option>' +
        '<option value="gemini"' + (config.type === 'gemini' ? ' selected' : '') + '>Gemini</option></select></div>' +

        // API 地址
        '<div class="cfg-field"><label class="cfg-label">API 地址（Endpoint）</label>' +
        '<input id="api-endpoint-input" type="text" placeholder="如 https://api.openai.com/v1" value="' + _escapeHtml(config.endpoint) + '" class="cfg-input"></div>' +

        // API Key
        '<div class="cfg-field"><label class="cfg-label">API Key</label>' +
        '<input id="api-key-input" type="password" placeholder="sk-..." value="' + _escapeHtml(config.apiKey) + '" class="cfg-input"></div>' +

        // 连接测试按钮 + 状态
        '<div class="cfg-field cfg-row">' +
        '<button id="api-connect-btn" onclick="_doConnectTest()" class="cfg-btn cfg-btn-blue">🔗 连接测试</button>' +
        '<span id="api-connect-status" class="cfg-status">未连接</span></div>' +

        // 模型选择区域
        '<div class="cfg-field">' +
        '<label class="cfg-label">模型选择</label>' +
        '<div class="cfg-row" style="margin-bottom:6px">' +
        '<select id="api-model-select" class="cfg-input" style="flex:1" onchange="_onModelSelected()" disabled>' +
        '<option value="">-- 请先连接测试 --</option></select>' +
        '<button onclick="_toggleManualModel()" class="cfg-btn cfg-btn-subtle">✎ 手动输入</button></div>' +
        '<input id="api-model-input" type="text" placeholder="如 gpt-4o-mini" value="' + _escapeHtml(config.model) + '" class="cfg-input"></div>' +

        // Temperature + 最大输出 Token
        '<div class="cfg-field cfg-row">' +
        '<div style="flex:1"><label class="cfg-label">Temperature</label>' +
        '<input id="api-temp-input" type="number" min="0" max="2" step="0.05" value="' + config.temperature + '" class="cfg-input"></div>' +
        '<div style="flex:1"><label class="cfg-label">最大输出 Token</label>' +
        '<input id="api-max-tokens-input" type="number" min="100" max="128000" step="100" value="' + config.maxOutputTokens + '" class="cfg-input"></div></div>' +

        // 上下文窗口
        '<div class="cfg-field"><label class="cfg-label">上下文窗口（Token）</label>' +
        '<input id="api-ctx-tokens-input" type="number" min="1000" max="2000000" step="1000" value="' + config.maxContextTokens + '" class="cfg-input"></div>' +

        // CORS 代理地址（仅 web 环境显示）
        (apiService.getRunEnv() === 'web' ?
            '<div class="cfg-field" id="cors-proxy-field"><label class="cfg-label">CORS 代理地址</label>' +
            '<input id="api-cors-proxy-input" type="text" placeholder="https://your-worker.your-name.workers.dev" value="' + _escapeHtml(config.corsProxyUrl || '') + '" class="cfg-input">' +
            (config.corsProxyUrl ? '' : '<div class="cfg-notice" style="margin-top:4px">⚠️ 线上部署时需填写 CORS 代理地址，否则 API 请求会被浏览器拦截。本地 file:// 运行无需填写。</div>') +
            '</div>'
        : '') +

        // 测试消息
        '<div class="cfg-field">' +
        '<button id="api-test-btn" onclick="_doSendTest()" class="cfg-btn cfg-btn-green">📨 发送测试消息</button>' +
        '<div id="api-test-result" class="cfg-test-result"></div></div>' +

        // 安全提示
        '<div class="cfg-notice">⚠️ API Key 仅保存在浏览器本地，不会上传到任何服务器。请使用支持 CORS 的中转站或部署代理服务。</div>' +

        // 底部按钮
        '<div class="cfg-footer">' +
        '<button class="cfg-btn cfg-btn-subtle" onclick="closeConfigModal()">取消</button>' +
        '<button class="cfg-btn cfg-btn-green" onclick="saveConfigAndClose()">保存</button></div>';

    var html;
    if (typeof fitModalToViewport === 'function') {
        // index.html 环境：用 modal viewport-overlay 结构，交给 fitModalToViewport 定位
        // cfg-panel 在 modal-content 内居中，上下留 3% 边距
        html = '<div id="api-config-modal" class="modal viewport-overlay">' +
            '<div class="modal-content" style="display:flex;align-items:center;justify-content:center;background:transparent;border:none;box-shadow:none;padding:3% 16px">' +
            '<div class="cfg-panel">' + innerHtml + '</div>' +
            '</div></div>';
    } else {
        // start-screen 等独立环境：用 cfg-overlay 自己的定位
        html = '<div id="api-config-modal" class="cfg-overlay">' +
            '<div class="cfg-panel">' + innerHtml + '</div>' +
            '</div>';
    }

    document.body.insertAdjacentHTML('beforeend', html);

    var modal = document.getElementById('api-config-modal');
    if (typeof fitModalToViewport === 'function') {
        modal.style.display = 'block';
        requestAnimationFrame(function() {
            fitModalToViewport(modal);
            if (typeof bindModalAutoFit === 'function') bindModalAutoFit(modal);
        });
    } else {
        modal.style.display = 'flex';
    }
}

function closeConfigModal() {
    var modal = document.getElementById('api-config-modal');
    if (modal) modal.remove();
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
    // CORS 代理地址（仅 web 环境有此输入框）
    var corsInput = document.getElementById('api-cors-proxy-input');
    if (corsInput) {
        newConfig.corsProxyUrl = corsInput.value.trim();
    }
    if (!newConfig.endpoint || !newConfig.apiKey || !newConfig.model) {
        alert('请填写完整的 API 信息（地址、Key、模型名）');
        return;
    }
    apiService.updateConfig(newConfig);
    closeConfigModal();
    if (typeof showModal === 'function') showModal('API 配置已保存！');
}

// ========== 连接测试 ==========

async function _doConnectTest() {
    var btn = document.getElementById('api-connect-btn');
    var status = document.getElementById('api-connect-status');
    var select = document.getElementById('api-model-select');

    btn.disabled = true;
    btn.textContent = '⏳ 连接中...';
    status.textContent = '连接中...';
    status.style.color = '#888';

    var endpoint = document.getElementById('api-endpoint-input').value.trim();
    var apiKey = document.getElementById('api-key-input').value.trim();
    var type = document.getElementById('api-type-select').value;

    try {
        var models = await apiService.fetchModels(endpoint, apiKey, type);
        status.textContent = '🟢 已连接（' + models.length + ' 个模型）';
        status.style.color = '#4CAF50';

        // 填充模型下拉框
        select.innerHTML = '<option value="">-- 请选择模型 --</option>';
        for (var i = 0; i < models.length; i++) {
            var opt = document.createElement('option');
            opt.value = models[i].id;
            opt.textContent = models[i].name || models[i].id;
            select.appendChild(opt);
        }
        select.disabled = false;

        // 如果当前已有模型名，尝试自动选中
        var currentModel = document.getElementById('api-model-input').value.trim();
        if (currentModel) {
            for (var j = 0; j < select.options.length; j++) {
                if (select.options[j].value === currentModel) {
                    select.selectedIndex = j;
                    break;
                }
            }
        }
    } catch (e) {
        status.textContent = '🔴 连接失败: ' + e.message;
        status.style.color = '#f44336';
        select.innerHTML = '<option value="">-- 连接失败 --</option>';
        select.disabled = true;
    }

    btn.disabled = false;
    btn.textContent = '🔗 连接测试';
}

function _onModelSelected() {
    var select = document.getElementById('api-model-select');
    var input = document.getElementById('api-model-input');
    if (select.value) {
        input.value = select.value;
    }
}

function _toggleManualModel() {
    var input = document.getElementById('api-model-input');
    input.focus();
    input.select();
}

// ========== 测试消息 ==========

async function _doSendTest() {
    var btn = document.getElementById('api-test-btn');
    var resultDiv = document.getElementById('api-test-result');

    btn.disabled = true;
    btn.textContent = '⏳ 发送中...';
    resultDiv.style.display = 'block';
    resultDiv.className = 'cfg-test-result cfg-test-loading';
    resultDiv.textContent = '正在发送测试消息...';

    var tempConfig = {
        type: document.getElementById('api-type-select').value,
        endpoint: document.getElementById('api-endpoint-input').value.trim(),
        apiKey: document.getElementById('api-key-input').value.trim(),
        model: document.getElementById('api-model-input').value.trim(),
        temperature: parseFloat(document.getElementById('api-temp-input').value) || 0.85
    };

    var result = await apiService.sendTestMessage(tempConfig);

    if (result.success) {
        var preview = result.content.length > 100 ? result.content.substring(0, 100) + '...' : result.content;
        resultDiv.className = 'cfg-test-result cfg-test-ok';
        resultDiv.textContent = '✅ 测试通过！AI 回复: ' + preview;
    } else {
        resultDiv.className = 'cfg-test-result cfg-test-fail';
        resultDiv.textContent = '❌ 测试失败: ' + result.error;
    }

    btn.disabled = false;
    btn.textContent = '📨 发送测试消息';
}

function _escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
