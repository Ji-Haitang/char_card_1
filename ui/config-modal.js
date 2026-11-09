/**
 * config-modal.js - API 配置弹窗（增强版）
 * 支持连接测试、模型列表、测试消息
 * 主 API（id 前缀 api）+ 可折叠的副 API（id 前缀 api2）：两者参数完全一致，
 * 副 API 额外可勾选「使用副API的后台请求」；提示词预设（ny/夏瑾）也在此按主/副分别配置。
 * 使用 CSS class 驱动样式，适配暗色/亮色主题
 * 依赖：api-service.js
 */

// Shared presentation layer for configuration and nested prompt editors (also on the start screen).
(function () {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('settings-dialogs.css', document.currentScript.src).href;
    document.head.appendChild(link);
})();

var _CFG_PRIMARY = 'api';
var _CFG_SECONDARY = 'api2';

// 后台请求清单（api-service 未加载该字段时的兜底，与 apiService.BACKGROUND_TASKS 保持一致）
var _CFG_BACKGROUND_TASKS_FALLBACK = [
    { key: 'summary',        label: '周总结' },
    { key: 'event',          label: '剧情事件抽取' },
    { key: 'location',       label: '地点信息更新' },
    { key: 'sideQuestRumor', label: '支线传闻生成' },
    { key: 'sideQuestTree',  label: '支线剧情树生成' },
    { key: 'sideQuestJudge', label: '支线阶段判断' },
    { key: 'bounty',         label: '悬赏任务生成' }
];

function _cfgBackgroundTasks() {
    return (typeof apiService !== 'undefined' && apiService.BACKGROUND_TASKS) || _CFG_BACKGROUND_TASKS_FALLBACK;
}

function _cfgEl(p, suffix) {
    return document.getElementById((p || _CFG_PRIMARY) + '-' + suffix);
}

// 带「启用」勾选的数值参数（Top P / Top K / 惩罚项）
function _cfgToggleNumber(p, label, suffix, min, max, step, value, enabled) {
    return '<div style="flex:1"><label class="cfg-label">' + label + '</label>' +
        '<div class="cfg-row" style="align-items:center;gap:6px">' +
        '<input id="' + p + '-' + suffix + '-input" type="number" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '" class="cfg-input" style="flex:1">' +
        '<label style="display:flex;align-items:center;gap:4px;white-space:nowrap;cursor:pointer;font-size:12px">' +
        '<input type="checkbox" id="' + p + '-' + suffix + '-enabled"' + (enabled ? ' checked' : '') + '>启用</label></div></div>';
}

/**
 * 生成一组 API 设置字段（主/副共用）。p 为 id 前缀：'api' 主 API（保持既有 id）/ 'api2' 副 API。
 */
function _apiFieldsHtml(p, config) {
    var corsFieldId = p === _CFG_PRIMARY ? 'cors-proxy-field' : p + '-cors-proxy-field';
    var preset = config.promptPreset === 'xiajin' ? 'xiajin' : 'ny';
    return '' +
        // API 类型
        '<div class="cfg-field"><label class="cfg-label">API 类型</label>' +
        '<select id="' + p + '-type-select" class="cfg-input">' +
        '<option value="openai"' + (config.type === 'openai' ? ' selected' : '') + '>OpenAI 兼容</option>' +
        '<option value="gemini"' + (config.type === 'gemini' ? ' selected' : '') + '>Gemini</option></select></div>' +

        // API 地址
        '<div class="cfg-field"><label class="cfg-label">API 地址（Endpoint）</label>' +
        '<input id="' + p + '-endpoint-input" type="text" placeholder="如 https://api.openai.com/v1" value="' + _escapeHtml(config.endpoint) + '" class="cfg-input"></div>' +

        // API Key
        '<div class="cfg-field"><label class="cfg-label">API Key</label>' +
        '<input id="' + p + '-key-input" type="password" placeholder="sk-..." value="' + _escapeHtml(config.apiKey) + '" class="cfg-input"></div>' +

        // 连接测试按钮 + 切换设置按钮
        '<div class="cfg-field cfg-row">' +
        '<button id="' + p + '-connect-btn" onclick="_doConnectTest(\'' + p + '\')" class="cfg-btn cfg-btn-blue">🔗 连接测试</button>' +
        '<button onclick="_togglePresetDropdown(\'' + p + '\')" class="cfg-btn cfg-btn-subtle">⚙ 切换设置</button>' +
        '</div>' +
        '<div id="' + p + '-preset-container" class="cfg-history-container" style="display:none;margin-top:-4px;margin-bottom:4px"></div>' +
        // 连接状态 + 分隔线
        '<div class="cfg-field" style="padding-top:0;margin-top:-4px">' +
        '<span id="' + p + '-connect-status" class="cfg-status">未连接</span></div>' +
        '<hr style="margin:6px 0 10px;border:none;border-top:1px solid rgba(128,128,128,0.2)">' +

        // 模型选择区域
        '<div class="cfg-field">' +
        '<label class="cfg-label">模型选择</label>' +
        '<div class="cfg-row" style="margin-bottom:6px">' +
        '<select id="' + p + '-model-select" class="cfg-input" style="flex:1" onchange="_onModelSelected(\'' + p + '\')" disabled>' +
        '<option value="">-- 请先连接测试 --</option></select>' +
        '<button onclick="_toggleManualModel(\'' + p + '\')" class="cfg-btn cfg-btn-subtle">✎ 手动输入</button></div>' +
        '<input id="' + p + '-model-input" type="text" placeholder="如 gpt-4o-mini" value="' + _escapeHtml(config.model) + '" class="cfg-input"></div>' +

        // Temperature + 最大输出 Token
        '<div class="cfg-field cfg-row">' +
        '<div style="flex:1"><label class="cfg-label">Temperature</label>' +
        '<input id="' + p + '-temp-input" type="number" min="0" max="2" step="0.05" value="' + config.temperature + '" class="cfg-input"></div>' +
        '<div style="flex:1"><label class="cfg-label">最大输出 Token</label>' +
        '<input id="' + p + '-max-tokens-input" type="number" min="100" max="128000" step="100" value="' + config.maxOutputTokens + '" class="cfg-input"></div></div>' +

        // Top P + Top K（默认不勾选=不发送该参数，勾上才带进请求体）
        '<div class="cfg-field cfg-row">' +
        _cfgToggleNumber(p, 'Top P', 'top-p', 0, 1, 0.01, config.topP, config.topPEnabled) +
        _cfgToggleNumber(p, 'Top K', 'top-k', 0, 500, 1, config.topK, config.topKEnabled) + '</div>' +

        // Frequency Penalty + Presence Penalty（同样默认不勾选）
        '<div class="cfg-field cfg-row">' +
        _cfgToggleNumber(p, 'Frequency Penalty', 'freq-penalty', -2, 2, 0.05, config.frequencyPenalty, config.frequencyPenaltyEnabled) +
        _cfgToggleNumber(p, 'Presence Penalty', 'pres-penalty', -2, 2, 0.05, config.presencePenalty, config.presencePenaltyEnabled) + '</div>' +

        // 上下文窗口 + 请求方式（流式/非流式）
        '<div class="cfg-field cfg-row">' +
        '<div style="flex:1"><label class="cfg-label">上下文窗口（Token）</label>' +
        '<input id="' + p + '-ctx-tokens-input" type="number" min="1000" max="2000000" step="1000" value="' + config.maxContextTokens + '" class="cfg-input"></div>' +
        '<div style="flex:1"><label class="cfg-label">请求方式</label>' +
        '<select id="' + p + '-stream-mode-select" class="cfg-input">' +
        '<option value="stream"' + (config.streamMode !== 'non-stream' ? ' selected' : '') + '>流式</option>' +
        '<option value="non-stream"' + (config.streamMode === 'non-stream' ? ' selected' : '') + '>非流式</option>' +
        '</select></div></div>' +

        // 提示词预设（ny / 夏瑾），原在游戏设置，现随 API 配置保存
        '<div class="cfg-field"><label class="cfg-label">提示词预设</label>' +
        '<select id="' + p + '-prompt-preset-select" class="cfg-input">' +
        '<option value="ny"' + (preset === 'ny' ? ' selected' : '') + '>ny预设</option>' +
        '<option value="xiajin"' + (preset === 'xiajin' ? ' selected' : '') + '>夏瑾预设</option>' +
        '</select></div>' +

        // 预设穿甲强化（工具输出模式，默认关闭，需接口支持 tools）
        '<div class="cfg-field">' +
        '<label class="cfg-label" for="' + p + '-tool-output-enabled" style="display:flex;align-items:center;gap:6px;cursor:pointer">' +
        '<input type="checkbox" id="' + p + '-tool-output-enabled"' + (config.toolOutputEnabled ? ' checked' : '') + '>预设穿甲强化</label>' +
        '</div>' +

        // CORS 代理地址（网页与 APK 均显示；勾选启用后才生效，默认 web 勾 / APK 不勾）
        '<div class="cfg-field" id="' + corsFieldId + '"><label class="cfg-label">CORS 代理</label>' +
        '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:6px">' +
        '<input type="checkbox" id="' + p + '-cors-proxy-enabled"' + (config.corsProxyEnabled ? ' checked' : '') + '>' +
        '<span style="font-size:12px;color:rgba(55,55,55,0.7)">启用 CORS 代理（勾选后通过代理中转 API 请求）</span></label>' +
        '<input id="' + p + '-cors-proxy-input" type="text" placeholder="https://your-worker.your-name.workers.dev" value="' + _escapeHtml(config.corsProxyUrl || '') + '" class="cfg-input">' +
        '</div>' +

        // 测试消息
        '<div class="cfg-field">' +
        '<button id="' + p + '-test-btn" onclick="_doSendTest(\'' + p + '\')" class="cfg-btn cfg-btn-green">📨 发送测试消息</button>' +
        '<div id="' + p + '-test-result" class="cfg-test-result"></div></div>';
}

// 副 API 的「使用副API的后台请求」复选列表（runturn 正文请求不在列，固定走主 API）
function _secondaryTasksHtml(secondary) {
    var selected = Array.isArray(secondary.backgroundTasks) ? secondary.backgroundTasks : [];
    var tasks = _cfgBackgroundTasks();
    var html = '<div class="cfg-field"><label class="cfg-label">使用副API的后台请求</label>' +
        '<div class="cfg-task-list" style="display:flex;flex-wrap:wrap;gap:6px 16px">';
    for (var i = 0; i < tasks.length; i++) {
        var id = _CFG_SECONDARY + '-task-' + tasks[i].key;
        html += '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px">' +
            '<input type="checkbox" class="cfg-secondary-task" id="' + id + '" data-task="' + tasks[i].key + '"' +
            (selected.indexOf(tasks[i].key) !== -1 ? ' checked' : '') + '>' + _escapeHtml(tasks[i].label) + '</label>';
    }
    html += '</div><div class="cfg-hint" style="margin:6px 0 0">勾选的后台请求走副 API；未勾选的仍走主 API。正文生成（runturn）始终走主 API。仅当副 API 开关打开且地址、Key、模型均有效时才生效。</div></div>';
    return html;
}

function showConfigModal() {
    var existing = document.getElementById('api-config-modal');
    if (existing) closeConfigModal();

    var config = apiService.getConfig();
    var secondary = (apiService.getSecondaryConfig ? apiService.getSecondaryConfig() : null) ||
        Object.assign({}, config, { endpoint: '', apiKey: '', model: '', enabled: false, backgroundTasks: [] });
    var secondaryEnabled = secondary.enabled === true;
    // 内容区 HTML（与外层结构无关）
    var _emb = (typeof embeddingService !== 'undefined') ? embeddingService : null;
    var innerHtml =
        '<h3 class="cfg-title" id="api-config-title">API 配置</h3>' +
        '<div class="cfg-scroll-body">' +
        '<p class="cfg-hint">请输入您的 API 信息。支持 OpenAI 兼容格式与 Gemini API。密钥仅保存在浏览器本地。主 API、副 API、向量化记忆三部分各自保存，互不影响。</p>' +

        // ===== 主 API 设置 =====
        '<div id="cfg-primary-section" class="cfg-section" oninput="_cfgMarkDirty(\'primary\')" onchange="_cfgMarkDirty(\'primary\')">' +
        '<div class="cfg-section-title">🧠 主 API（正文生成及未分流的后台请求）</div>' +
        _apiFieldsHtml(_CFG_PRIMARY, config) +
        _cfgSectionActions('primary', '主 API') +
        '</div>' +

        // ===== 副 API 设置（开关控制展开/折叠）=====
        '<div id="api2-section" class="cfg-collapsible' + (secondaryEnabled ? ' is-open' : '') + '"' +
        ' oninput="_cfgMarkDirty(\'secondary\')" onchange="_cfgMarkDirty(\'secondary\')">' +
        '<label class="cfg-collapsible-summary" for="api2-enabled">' +
        '<input type="checkbox" id="api2-enabled"' + (secondaryEnabled ? ' checked' : '') + ' onchange="_onSecondaryToggle()">' +
        '<span>🔀 副 API</span>' +
        '<span id="api2-summary-state" class="cfg-collapsible-state"></span></label>' +
        '<div id="api2-body" class="cfg-collapsible-body"' + (secondaryEnabled ? '' : ' style="display:none"') +
        ' oninput="_updateSecondaryState()" onchange="_updateSecondaryState()">' +
        _apiFieldsHtml(_CFG_SECONDARY, secondary) +
        _secondaryTasksHtml(secondary) +
        '</div>' +
        _cfgSectionActions('secondary', '副 API') +
        '</div>' +

        // ===== Embedding 配置（Phase 3）=====
        '<hr style="margin:12px 0;border-color:rgba(255,255,255,0.15)">' +
        '<div id="cfg-embedding-section" class="cfg-section" oninput="_cfgMarkDirty(\'embedding\')" onchange="_cfgMarkDirty(\'embedding\')">' +
        '<div class="cfg-section-title" style="font-size:13px;font-weight:600;margin-bottom:8px">🔍 向量化记忆（可选）</div>' +
        '<div class="cfg-field"><label class="cfg-label">启用向量召回</label>' +
        '<label style="display:flex;align-items:center;gap:6px;cursor:pointer">' +
        '<input type="checkbox" id="emb-enabled-input"' + (_emb && _emb.isEnabled() ? ' checked' : '') + '>' +
        '<span style="font-size:12px;color:rgba(55,55,55,0.6)">启用后可召回语义相关的历史摘要</span></label></div>' +
        '<div class="cfg-field"><label class="cfg-label">Embedding 地址</label>' +
        '<input id="emb-endpoint-input" type="text" class="cfg-input" placeholder="https://api.siliconflow.cn/v1/embeddings" value="' +
        _escapeHtml((_emb && _emb.getConfig().endpoint) || '') + '"></div>' +
        '<div class="cfg-field"><label class="cfg-label">Embedding Key</label>' +
        '<input id="emb-key-input" type="password" class="cfg-input" placeholder="独立 Key，不复用主 API Key" value="' +
        _escapeHtml((_emb && _emb.getConfig().apiKey) || '') + '"></div>' +
        '<div class="cfg-field"><label class="cfg-label">模型名称</label>' +
        '<input id="emb-model-input" type="text" class="cfg-input" placeholder="BAAI/bge-m3" value="' +
        _escapeHtml((_emb && _emb.getConfig().model) || 'BAAI/bge-m3') + '"></div>' +
        '<div class="cfg-field"><label class="cfg-label">重排模型（Rerank）</label>' +
        '<input id="emb-rerank-model-input" type="text" class="cfg-input" placeholder="BAAI/bge-reranker-v2-m3" value="' +
        _escapeHtml((_emb && _emb.getConfig().rerankModel) || 'BAAI/bge-reranker-v2-m3') + '"></div>' +
        '<div class="cfg-field">' +
        '<button class="cfg-btn" onclick="_doEmbeddingTest()">🔌 测试连接</button>&nbsp;' +
        '<button class="cfg-btn" onclick="_doRebuildEmbeddingIndex()">🔄 重建索引</button>' +
        '<div id="emb-status" style="font-size:12px;margin-top:6px;color:rgba(255,255,255,0.6)"></div>' +
        '<div id="emb-progress" style="font-size:12px;margin-top:4px;color:rgba(255,255,255,0.5)"></div>' +
        '</div>' +
        _cfgSectionActions('embedding', '向量设置') +
        '</div>' +

        // 安全提示
        '<div class="cfg-notice">⚠️ API Key 保存在浏览器本地，请求时会发送给 API 服务；启用代理时也会经过该代理。仅使用可信服务，推荐 HTTPS，HTTP 会明文传输密钥和内容。</div>' +

        // 底部按钮：各部分已各自保存，底部只负责关闭（有未保存修改时会确认）
        '</div><div class="cfg-footer">' +
        '<button class="cfg-btn cfg-btn-subtle" onclick="_requestCloseConfigModal()">关闭</button></div>';

    _cfgDirty = { primary: false, secondary: false, embedding: false };

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
    _updateSecondaryState();

    var modal = document.getElementById('api-config-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'api-config-title');
    if (typeof fitModalToViewport === 'function') {
        modal.style.display = 'block';
        requestAnimationFrame(function() {
            if (!modal.isConnected) return;
            fitModalToViewport(modal);
            if (typeof bindModalAutoFit === 'function') bindModalAutoFit(modal);
        });
    } else {
        modal.style.display = 'flex';
    }
}

function closeConfigModal() {
    var modal = document.getElementById('api-config-modal');
    if (modal) {
        if (modal._unbindFit) modal._unbindFit();
        modal.remove();
    }
}

function _cfgChecked(p, suffix) {
    var el = _cfgEl(p, suffix);
    return !!(el && el.checked);
}

function _cfgVal(p, suffix, fallback) {
    var el = _cfgEl(p, suffix);
    return (el && el.value != null) ? String(el.value) : (fallback == null ? '' : String(fallback));
}

/**
 * 读取一组 API 表单（主/副共用）为配置对象；缺失的控件回退到对应已保存配置的值
 */
function _readApiForm(p) {
    var base = (p === _CFG_SECONDARY && apiService.getSecondaryConfig) ? apiService.getSecondaryConfig() : apiService.getConfig();
    base = base || {};
    var cfg = {
        type: _cfgVal(p, 'type-select', base.type || 'openai'),
        endpoint: _cfgVal(p, 'endpoint-input', base.endpoint).trim(),
        apiKey: _cfgVal(p, 'key-input', base.apiKey).trim(),
        model: _cfgVal(p, 'model-input', base.model).trim(),
        temperature: parseFloat(_cfgVal(p, 'temp-input', base.temperature)) || 0.85,
        maxOutputTokens: parseInt(_cfgVal(p, 'max-tokens-input', base.maxOutputTokens)) || 8192,
        maxContextTokens: parseInt(_cfgVal(p, 'ctx-tokens-input', base.maxContextTokens)) || 128000,
        streamMode: _cfgVal(p, 'stream-mode-select', base.streamMode) || 'stream',
        promptPreset: _cfgVal(p, 'prompt-preset-select', base.promptPreset) === 'xiajin' ? 'xiajin' : 'ny',
        toolOutputEnabled: _cfgChecked(p, 'tool-output-enabled'),
        topP: parseFloat(_cfgVal(p, 'top-p-input', base.topP)),
        topPEnabled: _cfgChecked(p, 'top-p-enabled'),
        topK: parseInt(_cfgVal(p, 'top-k-input', base.topK), 10),
        topKEnabled: _cfgChecked(p, 'top-k-enabled'),
        frequencyPenalty: parseFloat(_cfgVal(p, 'freq-penalty-input', base.frequencyPenalty)),
        frequencyPenaltyEnabled: _cfgChecked(p, 'freq-penalty-enabled'),
        presencePenalty: parseFloat(_cfgVal(p, 'pres-penalty-input', base.presencePenalty)),
        presencePenaltyEnabled: _cfgChecked(p, 'pres-penalty-enabled')
    };
    // CORS 代理（网页与 APK 均有此输入框与勾选框）
    var corsInput = _cfgEl(p, 'cors-proxy-input');
    if (corsInput) cfg.corsProxyUrl = corsInput.value.trim();
    var corsEnabledInput = _cfgEl(p, 'cors-proxy-enabled');
    if (corsEnabledInput) cfg.corsProxyEnabled = !!corsEnabledInput.checked;
    return cfg;
}

// 返回副 API 三项的问题描述；全部有效时返回空串（与 apiService.isSecondaryComplete 规则一致）
function _secondaryProblem(cfg) {
    var missing = [];
    if (!/^https?:\/\/[^\s\/]+/i.test((cfg.endpoint || '').trim())) missing.push('地址');
    if (!(cfg.apiKey || '').trim()) missing.push('Key');
    if (!(cfg.model || '').trim()) missing.push('模型');
    return missing.length ? missing.join('、') + '无效或未填写' : '';
}

function _setSecondaryOpen(open) {
    var section = document.getElementById('api2-section');
    var body = document.getElementById('api2-body');
    var toggle = _cfgEl(_CFG_SECONDARY, 'enabled');
    if (toggle) toggle.checked = !!open;
    if (body) body.style.display = open ? '' : 'none';
    if (section && section.classList) section.classList.toggle('is-open', !!open);
    _updateSecondaryState();
}

// 开关：打开自动展开具体配置，关闭则折叠（配置保留，仅不启用）
function _onSecondaryToggle() {
    _setSecondaryOpen(_cfgChecked(_CFG_SECONDARY, 'enabled'));
}

// 标题旁的实时状态：未启用 / 待补全 / 已启用
function _updateSecondaryState() {
    var state = document.getElementById('api2-summary-state');
    if (!state) return;
    if (!_cfgChecked(_CFG_SECONDARY, 'enabled')) {
        state.textContent = '（关闭，全部走主 API）';
        return;
    }
    var problem = _secondaryProblem({
        endpoint: _cfgVal(_CFG_SECONDARY, 'endpoint-input'),
        apiKey: _cfgVal(_CFG_SECONDARY, 'key-input'),
        model: _cfgVal(_CFG_SECONDARY, 'model-input')
    });
    state.textContent = problem ? '（' + problem + '，暂不生效）' : '（已启用）';
}

function _readSecondaryTasks() {
    var tasks = _cfgBackgroundTasks();
    var picked = [];
    for (var i = 0; i < tasks.length; i++) {
        var el = document.getElementById(_CFG_SECONDARY + '-task-' + tasks[i].key);
        if (el && el.checked) picked.push(tasks[i].key);
    }
    return picked;
}

// ========== 分区保存 ==========
// 主 API / 副 API / 向量设置各自独立保存，互不影响；底部只保留「关闭」。

var _cfgDirty = { primary: false, secondary: false, embedding: false };
var _CFG_SECTION_NAMES = { primary: '主 API', secondary: '副 API', embedding: '向量设置' };

function _cfgSectionActions(section, label) {
    return '<div class="cfg-section-actions">' +
        '<span id="cfg-' + section + '-save-status" class="cfg-save-status"></span>' +
        '<button id="cfg-' + section + '-save-btn" class="cfg-btn cfg-btn-green" onclick="_cfgSaveSection(\'' + section + '\')">💾 保存' + label + '</button>' +
        '</div>';
}

function _cfgSetStatus(section, text, kind) {
    var el = document.getElementById('cfg-' + section + '-save-status');
    if (!el) return;
    el.textContent = text;
    el.className = 'cfg-save-status' + (kind ? ' is-' + kind : '');
}

function _cfgMarkDirty(section) {
    if (!_cfgDirty[section]) {
        _cfgDirty[section] = true;
    }
    _cfgSetStatus(section, '● 有未保存的修改', 'dirty');
}

// 保存主 API；返回错误信息（成功返回空串）
function _savePrimaryConfig() {
    var newConfig = _readApiForm(_CFG_PRIMARY);
    if (!newConfig.endpoint || !newConfig.apiKey || !newConfig.model) {
        return '请填写完整的主 API 信息（地址、Key、模型名）';
    }
    apiService.updateConfig(newConfig);
    _saveConfigHistory(newConfig);
    return '';
}

// 保存副 API：开关打开时三项必须全部有效；开关关闭时照常保存草稿但不启用
function _saveSecondaryConfig() {
    if (!_cfgEl(_CFG_SECONDARY, 'endpoint-input') || !apiService.updateSecondaryConfig) return '';
    var secondaryConfig = _readApiForm(_CFG_SECONDARY);
    secondaryConfig.backgroundTasks = _readSecondaryTasks();
    secondaryConfig.enabled = _cfgChecked(_CFG_SECONDARY, 'enabled');
    var problem = secondaryConfig.enabled ? _secondaryProblem(secondaryConfig) : '';
    if (problem) {
        _setSecondaryOpen(true);
        return '副 API 已打开但' + problem + '：请补全后再保存，或关闭副 API 开关';
    }
    apiService.updateSecondaryConfig(secondaryConfig);
    if (secondaryConfig.endpoint) _saveConfigHistory(secondaryConfig);
    return '';
}

// 保存向量化记忆设置
function _saveEmbeddingConfig() {
    if (typeof embeddingService === 'undefined') return '';
    var embEnabled = !!(document.getElementById('emb-enabled-input') && document.getElementById('emb-enabled-input').checked);
    var embEndpoint = (document.getElementById('emb-endpoint-input') || {}).value || '';
    var embKey = (document.getElementById('emb-key-input') || {}).value || '';
    var embModel = (document.getElementById('emb-model-input') || {}).value || '';
    var embRerankModel = (document.getElementById('emb-rerank-model-input') || {}).value || '';
    var _wasEnabled = embeddingService.isEnabled();
    embeddingService.updateConfig({
        enabled: embEnabled,
        endpoint: embEndpoint.trim(),
        apiKey: embKey.trim(),
        model: embModel.trim(),
        rerankModel: embRerankModel.trim() || 'BAAI/bge-reranker-v2-m3'
    });
    // Phase L2：embedding 从关切换到开 → 触发事件层从 watermark=0 起补建
    if (!_wasEnabled && embEnabled && typeof eventRunner !== 'undefined') {
        eventRunner.resumeOnLoad();
    }
    return '';
}

var _CFG_SAVERS = { primary: _savePrimaryConfig, secondary: _saveSecondaryConfig, embedding: _saveEmbeddingConfig };

/**
 * 单独保存某一部分（不关闭弹窗，不影响其他部分的未保存修改）
 * @param {'primary'|'secondary'|'embedding'} section
 */
function _cfgSaveSection(section) {
    var error = _CFG_SAVERS[section]();
    if (error) {
        _cfgSetStatus(section, '✖ ' + error, 'error');
        alert(error);
        return false;
    }
    _cfgDirty[section] = false;
    var t = new Date();
    var pad = function(n) { return (n < 10 ? '0' : '') + n; };
    _cfgSetStatus(section, '✔ 已保存 ' + pad(t.getHours()) + ':' + pad(t.getMinutes()) + ':' + pad(t.getSeconds()), 'ok');
    console.log('[ConfigModal] 已保存' + _CFG_SECTION_NAMES[section]);
    return true;
}

// 关闭：有未保存的部分时先确认，避免误丢修改
function _requestCloseConfigModal() {
    var pending = [];
    for (var key in _cfgDirty) {
        if (_cfgDirty[key]) pending.push(_CFG_SECTION_NAMES[key]);
    }
    if (pending.length && typeof confirm === 'function' &&
        !confirm(pending.join('、') + ' 有未保存的修改，确定放弃并关闭吗？')) {
        return;
    }
    closeConfigModal();
}

/**
 * 兼容旧入口：依次保存全部三部分并关闭（任一部分校验失败则不关闭，已通过的部分仍会保存）
 */
function saveConfigAndClose() {
    var sections = ['primary', 'secondary', 'embedding'];
    for (var i = 0; i < sections.length; i++) {
        if (!_cfgSaveSection(sections[i])) return;
    }
    closeConfigModal();
    if (typeof showModal === 'function') showModal('API 配置已保存！');
}

// ========== 连接测试 ==========

function _apiConnectionError(message, endpoint, proxyEnabled, proxyUrl) {
    message = String(message || '未知错误');
    if (message.indexOf('Only HTTPS targets are allowed') !== -1) {
        return message + '；当前 CORS 代理只接受 HTTPS API，请向服务商索取 HTTPS 地址。';
    }
    if (/^http:\/\//i.test(endpoint) && !(proxyEnabled && proxyUrl) &&
        window.location.protocol === 'https:') {
        return message + '；HTTPS 游戏页面不能直连 HTTP API，请使用 HTTPS API 或可信的 HTTPS 中转。';
    }
    if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
        return message + '；请检查网络、代理是否可达及服务端 CORS。直连时需显式允许 Authorization 请求头，不能仅使用 Allow-Headers: *。';
    }
    return message;
}

async function _doConnectTest(p) {
    p = p || _CFG_PRIMARY;
    var btn = _cfgEl(p, 'connect-btn');
    var status = _cfgEl(p, 'connect-status');
    var select = _cfgEl(p, 'model-select');

    btn.disabled = true;
    btn.textContent = '⏳ 连接中...';
    status.textContent = '连接中...';
    status.style.color = '#888';

    var endpoint = _cfgEl(p, 'endpoint-input').value.trim();
    var apiKey = _cfgEl(p, 'key-input').value.trim();
    var type = _cfgEl(p, 'type-select').value;

    var corsProxyUrl = (_cfgEl(p, 'cors-proxy-input') || {}).value || '';
    var corsProxyEnabled = _cfgChecked(p, 'cors-proxy-enabled');

    try {
        var models = await apiService.fetchModels(endpoint, apiKey, type, {
            corsProxyUrl: corsProxyUrl.trim(),
            corsProxyEnabled: corsProxyEnabled
        });
        status.textContent = models.length ? '🟢 已连接（' + models.length + ' 个模型）' : '🟡 接口未返回可选模型，请确认 Key 的模型权限，或手动输入模型 ID 后发送测试消息。';
        status.style.color = models.length ? '#4CAF50' : '#b7791f';

        // 填充模型下拉框
        select.innerHTML = models.length ? '<option value="">-- 请选择模型 --</option>' : '<option value="">-- 无可选模型，可手动输入 --</option>';
        for (var i = 0; i < models.length; i++) {
            var opt = document.createElement('option');
            opt.value = models[i].id;
            opt.textContent = models[i].name || models[i].id;
            select.appendChild(opt);
        }
        select.disabled = false;

        // 如果当前已有模型名，尝试自动选中
        var currentModel = _cfgEl(p, 'model-input').value.trim();
        if (currentModel) {
            for (var j = 0; j < select.options.length; j++) {
                if (select.options[j].value === currentModel) {
                    select.selectedIndex = j;
                    break;
                }
            }
        }
    } catch (e) {
        status.textContent = '🔴 获取模型失败: ' + _apiConnectionError(e.message, endpoint, corsProxyEnabled, corsProxyUrl.trim()) + '（若服务不提供模型列表，可手动输入模型 ID 再发送测试消息；手动输入不能绕过网络限制）';
        status.style.color = '#f44336';
        select.innerHTML = '<option value="">-- 连接失败 --</option>';
        select.disabled = true;
    }

    btn.disabled = false;
    btn.textContent = '🔗 连接测试';
}

function _onModelSelected(p) {
    var select = _cfgEl(p, 'model-select');
    var input = _cfgEl(p, 'model-input');
    if (select.value) {
        input.value = select.value;
    }
}

function _toggleManualModel(p) {
    var input = _cfgEl(p, 'model-input');
    input.focus();
    input.select();
}

// ========== 测试消息 ==========

async function _doSendTest(p) {
    p = p || _CFG_PRIMARY;
    var btn = _cfgEl(p, 'test-btn');
    var resultDiv = _cfgEl(p, 'test-result');

    btn.disabled = true;
    btn.textContent = '⏳ 发送中...';
    resultDiv.style.display = 'block';
    resultDiv.className = 'cfg-test-result cfg-test-loading';
    resultDiv.textContent = '正在发送测试消息...';

    // 使用表单草稿发送（不保存、不影响全局 config）
    var tempConfig = _readApiForm(p);
    tempConfig.corsProxyUrl = tempConfig.corsProxyUrl || '';

    var result = await apiService.sendTestMessage(tempConfig);

    if (result.success) {
        var preview = result.content.length > 100 ? result.content.substring(0, 100) + '...' : result.content;
        resultDiv.className = 'cfg-test-result cfg-test-ok';
        resultDiv.textContent = '✅ 测试通过！AI 回复: ' + preview;
    } else {
        resultDiv.className = 'cfg-test-result cfg-test-fail';
        resultDiv.textContent = '❌ 测试失败: ' + _apiConnectionError(result.error, tempConfig.endpoint, tempConfig.corsProxyEnabled, tempConfig.corsProxyUrl);
    }

    btn.disabled = false;
    btn.textContent = '📨 发送测试消息';
}

function _escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ========== 历史配置切换 ==========

function _loadConfigHistory() {
    try {
        var raw = localStorage.getItem('jxz_apiConfigHistory');
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function _saveConfigHistory(cfg) {
    var history = _loadConfigHistory();
    // 生成标签：模型名 · 域名（或类型）
    var domain = '';
    try {
        domain = cfg.type === 'gemini' ? 'Gemini' : new URL(cfg.endpoint).hostname.replace(/^www\./, '');
    } catch (e) {
        domain = cfg.type || 'OpenAI';
    }
    // 标签加保存时间：同 endpoint+model 重复保存时只更新不新增条目，
    // 时间戳让「已更新」在下拉框中可见（否则 label 不变，用户会误以为历史没更新）
    var _now = new Date();
    var _pad = function(n) { return (n < 10 ? '0' : '') + n; };
    var timeStr = (_now.getMonth() + 1) + '-' + _pad(_now.getDate()) + ' ' + _pad(_now.getHours()) + ':' + _pad(_now.getMinutes());
    var label = (cfg.model || '未知模型') + ' · ' + domain + ' · ' + timeStr;
    // 移除相同 endpoint+model 的旧记录（去重）
    history = history.filter(function(h) {
        return !(h.endpoint === cfg.endpoint && h.model === cfg.model);
    });
    // 新配置插到最前面（后台请求分流属于副 API 槽位本身，不进入可回填的历史参数）
    var entry = Object.assign({}, cfg, { _label: label });
    delete entry.backgroundTasks;
    history.unshift(entry);
    // 最多保留 3 条（先进先出）
    if (history.length > 3) history = history.slice(0, 3);
    try {
        localStorage.setItem('jxz_apiConfigHistory', JSON.stringify(history));
    } catch (e) {
        // 写入失败（localStorage 已满/不可用）时历史会冻结在旧数据，必须留日志便于排查
        console.warn('[ConfigModal] 历史配置写入失败：', e);
    }
}

function _togglePresetDropdown(p) {
    p = p || _CFG_PRIMARY;
    var container = _cfgEl(p, 'preset-container');
    if (!container) return;
    // 切换显隐
    var isVisible = container.style.display !== 'none';
    if (isVisible) {
        container.style.display = 'none';
        return;
    }
    var history = _loadConfigHistory();
    if (history.length === 0) {
        container.innerHTML = '<div style="padding:5px 2px;color:#999;font-size:12px">暂无历史配置，保存后将自动记录</div>';
    } else {
        var html = '<select class="cfg-input" onchange="_applyPreset(this.value, \'' + p + '\');this.value=\'\'"><option value="">-- 选择历史配置回填 --</option>';
        for (var i = 0; i < history.length; i++) {
            html += '<option value="' + i + '">' + _escapeHtml(history[i]._label) + '</option>';
        }
        html += '</select>';
        container.innerHTML = html;
    }
    container.style.display = 'block';
}

function _applyPreset(indexStr, p) {
    p = p || _CFG_PRIMARY;
    var idx = parseInt(indexStr, 10);
    if (isNaN(idx)) return;
    var history = _loadConfigHistory();
    var preset = history[idx];
    if (!preset) return;
    var el;
    el = _cfgEl(p, 'type-select');        if (el) el.value = preset.type || 'openai';
    el = _cfgEl(p, 'endpoint-input');     if (el) el.value = preset.endpoint || '';
    el = _cfgEl(p, 'key-input');          if (el) el.value = preset.apiKey || '';
    el = _cfgEl(p, 'model-input');        if (el) el.value = preset.model || '';
    el = _cfgEl(p, 'temp-input');         if (el) el.value = preset.temperature != null ? preset.temperature : 0.9;
    el = _cfgEl(p, 'max-tokens-input');   if (el) el.value = preset.maxOutputTokens || 18000;
    el = _cfgEl(p, 'ctx-tokens-input');   if (el) el.value = preset.maxContextTokens || 500000;
    el = _cfgEl(p, 'stream-mode-select'); if (el) el.value = preset.streamMode === 'non-stream' ? 'non-stream' : 'stream';
    // 提示词预设：历史含该字段才回填，旧历史保留当前选择
    el = _cfgEl(p, 'prompt-preset-select'); if (el && preset.promptPreset) el.value = preset.promptPreset === 'xiajin' ? 'xiajin' : 'ny';
    // 旧历史无工具输出字段时明确关闭，避免继承当前草稿的开关。
    el = _cfgEl(p, 'tool-output-enabled'); if (el) el.checked = !!preset.toolOutputEnabled;
    el = _cfgEl(p, 'top-p-input');          if (el) el.value = preset.topP != null ? preset.topP : 1;
    el = _cfgEl(p, 'top-p-enabled');        if (el) el.checked = !!preset.topPEnabled;
    el = _cfgEl(p, 'top-k-input');          if (el) el.value = preset.topK != null ? preset.topK : 200;
    el = _cfgEl(p, 'top-k-enabled');        if (el) el.checked = !!preset.topKEnabled;
    el = _cfgEl(p, 'freq-penalty-input');   if (el) el.value = preset.frequencyPenalty != null ? preset.frequencyPenalty : 0.3;
    el = _cfgEl(p, 'freq-penalty-enabled'); if (el) el.checked = !!preset.frequencyPenaltyEnabled;
    el = _cfgEl(p, 'pres-penalty-input');   if (el) el.value = preset.presencePenalty != null ? preset.presencePenalty : 0.2;
    el = _cfgEl(p, 'pres-penalty-enabled'); if (el) el.checked = !!preset.presencePenaltyEnabled;
    el = _cfgEl(p, 'cors-proxy-input'); if (el && preset.corsProxyUrl) el.value = preset.corsProxyUrl;
    // 勾选框：preset 含该字段才回填，否则保留首次渲染按环境给的默认值（web勾/APK不勾）
    el = _cfgEl(p, 'cors-proxy-enabled'); if (el && typeof preset.corsProxyEnabled === 'boolean') el.checked = preset.corsProxyEnabled;
    // 回填完成后收起下拉
    var container = _cfgEl(p, 'preset-container');
    if (container) container.style.display = 'none';
    // 回填只改了表单草稿，标记该部分待保存
    _cfgMarkDirty(p === _CFG_SECONDARY ? 'secondary' : 'primary');
    if (p === _CFG_SECONDARY) _updateSecondaryState();
}

// ========== Phase 3: Embedding 辅助函数 ==========

async function _doEmbeddingTest() {
    var status = document.getElementById('emb-status');
    if (!status) return;
    status.textContent = '⏳ 测试中...';
    status.style.color = 'rgba(255,255,255,0.6)';
    try {
        if (typeof embeddingService === 'undefined') {
            status.textContent = '🔴 embeddingService 未加载';
            status.style.color = '#f44336';
            return;
        }
        // 临时用表单当前值测试
        var tempCfg = {
            enabled: true,
            endpoint: (document.getElementById('emb-endpoint-input') || {}).value || '',
            apiKey: (document.getElementById('emb-key-input') || {}).value || '',
            model: (document.getElementById('emb-model-input') || {}).value || ''
        };
        var result = await embeddingService.testConnection(tempCfg);
        if (result.ok) {
            status.textContent = '🟢 连接成功！维度：' + (result.dims || '?');
            status.style.color = '#4caf50';
        } else {
            status.textContent = '🔴 连接失败：' + (result.error || '未知错误');
            status.style.color = '#f44336';
        }
    } catch (e) {
        status.textContent = '🔴 测试异常：' + (e.message || e);
        status.style.color = '#f44336';
    }
}

async function _doRebuildEmbeddingIndex() {
    var status = document.getElementById('emb-status');
    var progress = document.getElementById('emb-progress');
    if (!status || !progress) return;
    if (typeof embeddingService === 'undefined' || typeof memoryRecall === 'undefined' || typeof summaryHistoryService === 'undefined') {
        status.textContent = '🔴 相关服务未加载，无法重建';
        status.style.color = '#f44336';
        return;
    }
    status.textContent = '⏳ 重建中...';
    status.style.color = 'rgba(255,255,255,0.6)';
    progress.textContent = '';

    var all = summaryHistoryService.getAll();
    if (!all || all.length === 0) {
        status.textContent = '📭 没有摘要记录，无需重建';
        return;
    }

    // 找出还没有向量的条目
    var stats = memoryRecall.getStats();
    var cachedIds = {};
    var cached = stats && stats.entries ? stats.entries : [];
    for (var ci = 0; ci < cached.length; ci++) {
        cachedIds[cached[ci].id] = true;
    }
    var todo = all.filter(function(s) { return !cachedIds[s.id]; });

    if (todo.length === 0) {
        status.textContent = '✅ 所有摘要已有向量，无需重建';
        return;
    }

    var batchSize = 10;
    var done = 0;
    var fp = embeddingService.getFingerprint();

    try {
        for (var i = 0; i < todo.length; i += batchSize) {
            var batch = todo.slice(i, i + batchSize);
            var texts = batch.map(function(s) { return s.summaryText; });
            progress.textContent = '进度：' + done + '/' + todo.length;
            var vectors = await embeddingService.embed(texts);
            for (var vi = 0; vi < batch.length; vi++) {
                if (!vectors[vi]) continue;
                var vec = new Float32Array(vectors[vi]);
                var meta = { text: batch[vi].summaryText, week: batch[vi].week || 0, fingerprint: fp, createdAt: Date.now() };
                storageService.saveEmbedding(batch[vi].id, vec, meta);
                memoryRecall.addToCache({ id: batch[vi].id, vector: vec, text: meta.text, week: meta.week, fingerprint: fp, createdAt: meta.createdAt });
            }
            done += batch.length;
        }
        progress.textContent = '进度：' + done + '/' + todo.length;
        status.textContent = '✅ 重建完成，共处理 ' + done + ' 条';
        status.style.color = '#4caf50';
    } catch (e) {
        status.textContent = '🔴 重建失败：' + (e.message || e);
        status.style.color = '#f44336';
        progress.textContent = '已完成：' + done + '/' + todo.length;
    }
}
