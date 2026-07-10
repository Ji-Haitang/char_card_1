/**
 * prompt-manager-modal.js - 提示词管理面板（系统设置-游戏设置-提示词管理）
 *
 * 按 prompt-builder.js 实际拼装顺序，列出可查看/可编辑的 prompt 条目：
 *   - 可调条目：编辑后保存为 promptOverrides（全局配置，不随存档走）
 *   - 不可调条目：仅供查看原始内容
 *   - 下拉框条目（地点信息/主要NPC信息/行动指导/思维链）：任选一项单独编辑
 *
 * 依赖：prompt-overrides.js, prompt-data-core.js, prompt-data-npc.js,
 *        prompt-data-actions.js, prompt-data-extra.js, prompt-builder.js（LOCATION_REGISTRY）
 */

var promptManagerModal = (function() {

    // --- 行动指导：从 ACTION_REGISTRY 的首个 key 推导展示名 ---
    function _actionDisplayName(entry) {
        var k = (entry.keys && entry.keys[0]) || entry.varName;
        return k.replace(/^行动选择[:：]\s*/, '');
    }

    function _npcOverrideKey(varName) { return varName.replace(/^PROMPT_/, ''); }
    function _actionOverrideKey(varName) { return varName.replace(/^PROMPT_/, ''); }

    // --- 渲染整个面板 ---
    function render(root) {
        if (!root) return;

        var html = '';
        html += '<style>.pm-section > .gs-switch-row:last-child { border-bottom: none; }</style>';
        // html += '<p class="cfg-hint">以下内容按实际发送给 LLM 的拼装顺序列出。"可调"条目点开后可编辑并保存，保存为全局配置（不随存档走，所有存档共用）；"只读"条目仅供查看。</p>';

        // 分组1：PROMPT头部
        html += _pmSection([
            _pmBtn('OPENING', 'PROMPT头部', false)
        ]);

        // 分组2：叙事基调 / 故事背景
        html += _pmSection([
            _pmBtn('INFO_TONE', '叙事基调', true),
            _pmBtn('CORE_010', '故事背景', true)
        ]);

        // 分组3：地点信息 / 主要NPC信息 / 主角信息
        html += _pmSection([
            _pmLocationDropdown(),
            _pmNpcDropdown(),
            _pmBtn('CORE_040', '主角信息', true)
        ]);

        // 世界书大类No.1（插入位置：</UserInfo> 与 ] 之间，即主角信息之后）
        html += _pmWorldbookCategory('1');

        // 分组4a：文笔风格 / 对话历史 / 防止重复要求
        html += _pmSection([
            _pmBtn('WRITING_STYLE', '文笔风格', true),
            _pmDisabledBtn('对话历史'),
            _pmBtn('FRESH', '防止重复要求', false)
        ]);

        // 世界书大类No.2（插入位置：</fresh> 与 <user_input> 之间）
        html += _pmWorldbookCategory('2');

        // 分组4b：本次用户输入 / 行动指导 / 信息列表 / 输出格式规范
        html += _pmSection([
            _pmDisabledBtn('本次用户输入'),
            _pmActionDropdown(),
            _pmBtn('CORE_105', '信息列表', false),
            _pmBtn('CORE_110', '输出格式规范', false)
        ]);

        // 分组5：剧情生成要求 / 思维链
        html += _pmSection([
            _pmBtn('ORDER', '剧情生成要求', true),
            _pmThinkGuidanceDropdown()
        ]);

        // 分组6：越狱前缀 / 最终指令
        html += _pmSection([
            _pmBtn('JAILBREAK_PREFILL', '越狱前缀', false),
            _pmBtn('FINAL_INSTRUCTION', '最终指令', false)
        ]);

        root.innerHTML = html;
    }

    function _pmSection(rowsHtml) {
        return '<div class="pm-section">' + rowsHtml.join('') + '</div><div style="height:3px;background:#000;margin:14px 0;border:none;"></div>';
    }

    function _hasOverrideBadge(key, editable) {
        if (!editable) return '';
        var has = (typeof promptOverrides !== 'undefined') && promptOverrides.has(key);
        return has ? ' <span style="font-size:12px;color:#4CAF50">（已自定义）</span>' : '';
    }

    function _pmBtn(key, label, editable) {
        var badge = _hasOverrideBadge(key, editable);
        return '<div class="gs-switch-row">' +
            '<span class="gs-switch-label">' + label + badge + '</span>' +
            '<button class="cfg-btn cfg-btn-subtle" onclick="promptManagerModal.open(\'' + key + '\')">' + (editable ? '编辑' : '查看') + '</button>' +
            '</div>';
    }

    function _pmDisabledBtn(label) {
        return '<div class="gs-switch-row">' +
            '<span class="gs-switch-label" style="opacity:0.6">' + label + '</span>' +
            '<button class="cfg-btn cfg-btn-subtle" disabled style="opacity:0.4;cursor:not-allowed">不可调</button>' +
            '</div>';
    }

    function _pmLocationDropdown() {
        var opts = '<option value="">-- 选择地点 --</option>';
        var reg = window.LOCATION_REGISTRY || [];
        for (var i = 0; i < reg.length; i++) {
            var overridden = (typeof promptOverrides !== 'undefined') && promptOverrides.has('LOCATION_' + reg[i]);
            opts += '<option value="' + _escapeHtml(reg[i]) + '">' + _escapeHtml(reg[i]) + (overridden ? '（已自定义）' : '') + '</option>';
        }
        return '<div class="gs-switch-row">' +
            '<span class="gs-switch-label">地点信息</span>' +
            '<select class="cfg-input" style="flex:1 1 160px;max-width:220px;min-width:0" onchange="promptManagerModal._openLocation(this)">' + opts + '</select>' +
            '</div>';
    }

    function _pmNpcDropdown() {
        var opts = '<option value="">-- 选择NPC --</option>';
        var reg = window.NPC_REGISTRY || [];
        for (var i = 0; i < reg.length; i++) {
            var key = _npcOverrideKey(reg[i].varName);
            var overridden = (typeof promptOverrides !== 'undefined') && promptOverrides.has(key);
            opts += '<option value="' + _escapeHtml(reg[i].varName) + '">' + _escapeHtml(reg[i].name) + (overridden ? '（已自定义）' : '') + '</option>';
        }
        return '<div class="gs-switch-row">' +
            '<span class="gs-switch-label">主要NPC信息</span>' +
            '<select class="cfg-input" style="flex:1 1 160px;max-width:220px;min-width:0" onchange="promptManagerModal._openNpc(this)">' + opts + '</select>' +
            '</div>';
    }

    function _pmActionDropdown() {
        var opts = '<option value="">-- 选择行动 --</option>';
        var reg = window.ACTION_REGISTRY || [];
        for (var i = 0; i < reg.length; i++) {
            var key = _actionOverrideKey(reg[i].varName);
            var overridden = (typeof promptOverrides !== 'undefined') && promptOverrides.has(key);
            opts += '<option value="' + _escapeHtml(reg[i].varName) + '">' + _escapeHtml(_actionDisplayName(reg[i])) + (overridden ? '（已自定义）' : '') + '</option>';
        }
        return '<div class="gs-switch-row">' +
            '<span class="gs-switch-label">行动指导</span>' +
            '<select class="cfg-input" style="flex:1 1 160px;max-width:220px;min-width:0" onchange="promptManagerModal._openAction(this)">' + opts + '</select>' +
            '</div>';
    }

    function _pmThinkGuidanceDropdown() {
        var options = [
            { key: 'THINK_GUIDANCE', label: '默认（非DeepSeek模型）' },
            { key: 'THINK_GUIDANCE_DEEPSEEK', label: 'DeepSeek模型' }
        ];
        var opts = '<option value="">-- 选择模型 --</option>';
        for (var i = 0; i < options.length; i++) {
            var overridden = (typeof promptOverrides !== 'undefined') && promptOverrides.has(options[i].key);
            opts += '<option value="' + options[i].key + '">' + options[i].label + (overridden ? '（已自定义）' : '') + '</option>';
        }
        return '<div class="gs-switch-row">' +
            '<span class="gs-switch-label">思维链</span>' +
            '<select class="cfg-input" style="flex:1 1 160px;max-width:220px;min-width:0" onchange="promptManagerModal._openThink(this)">' + opts + '</select>' +
            '</div>';
    }

    // --- 下拉框选中后打开编辑弹窗 ---
    function _openLocation(sel) {
        var name = sel.value;
        if (!name) return;
        var defaults = (typeof getPromptLocationDefaults === 'function') ? getPromptLocationDefaults() : {};
        open('LOCATION_' + name, '地点信息 - ' + name, true, defaults[name] || '');
        sel.selectedIndex = 0;
    }

    function _openNpc(sel) {
        var varName = sel.value;
        if (!varName) return;
        var key = _npcOverrideKey(varName);
        var reg = window.NPC_REGISTRY || [];
        var label = varName;
        for (var i = 0; i < reg.length; i++) { if (reg[i].varName === varName) { label = reg[i].name; break; } }
        open(key, '主要NPC信息 - ' + label, true, window[varName] || '');
        sel.selectedIndex = 0;
    }

    function _openAction(sel) {
        var varName = sel.value;
        if (!varName) return;
        var key = _actionOverrideKey(varName);
        var reg = window.ACTION_REGISTRY || [];
        var label = varName;
        for (var i = 0; i < reg.length; i++) { if (reg[i].varName === varName) { label = _actionDisplayName(reg[i]); break; } }
        open(key, '行动指导 - ' + label, true, window[varName] || '');
        sel.selectedIndex = 0;
    }

    function _openThink(sel) {
        var key = sel.value;
        if (!key) return;
        var label = (key === 'THINK_GUIDANCE_DEEPSEEK') ? '思维链 - DeepSeek模型' : '思维链 - 默认';
        var defaultText = (key === 'THINK_GUIDANCE_DEEPSEEK')
            ? (typeof PROMPT_THINK_GUIDANCE_DEEPSEEK !== 'undefined' ? PROMPT_THINK_GUIDANCE_DEEPSEEK : '')
            : (typeof PROMPT_THINK_GUIDANCE !== 'undefined' ? PROMPT_THINK_GUIDANCE : '');
        open(key, label, true, defaultText);
        sel.selectedIndex = 0;
    }

    // --- 固定 key -> 默认常量 / 展示名 映射（用于单按钮条目）---
    var _FIXED_MAP = {
        OPENING:            { title: 'PROMPT头部',     editable: false, get: function() { return typeof PROMPT_OPENING !== 'undefined' ? PROMPT_OPENING : ''; } },
        INFO_TONE:          { title: '叙事基调',        editable: true,  get: function() { return typeof PROMPT_INFO_TONE !== 'undefined' ? PROMPT_INFO_TONE : ''; } },
        CORE_010:           { title: '故事背景',        editable: true,  get: function() { return typeof PROMPT_CORE_010 !== 'undefined' ? PROMPT_CORE_010 : ''; } },
        CORE_040:           { title: '主角信息',        editable: true,  get: function() { return typeof PROMPT_CORE_040 !== 'undefined' ? PROMPT_CORE_040 : ''; } },
        WRITING_STYLE:      { title: '文笔风格',        editable: true,  get: function() { return typeof PROMPT_WRITING_STYLE !== 'undefined' ? PROMPT_WRITING_STYLE : ''; } },
        FRESH:              { title: '防止重复要求',    editable: false, get: function() { return typeof PROMPT_FRESH !== 'undefined' ? PROMPT_FRESH : ''; } },
        CORE_105:           { title: '信息列表',        editable: false, get: function() { return typeof PROMPT_CORE_105 !== 'undefined' ? PROMPT_CORE_105 : ''; } },
        CORE_110:           { title: '输出格式规范',    editable: false, get: function() { return typeof PROMPT_CORE_110 !== 'undefined' ? PROMPT_CORE_110 : ''; } },
        ORDER:              { title: '剧情生成要求',    editable: true,  get: function() { return typeof PROMPT_ORDER !== 'undefined' ? PROMPT_ORDER : ''; } },
        JAILBREAK_PREFILL:  { title: '越狱前缀',        editable: false, get: function() {
            var a = typeof PROMPT_JAILBREAK_PREFILL !== 'undefined' ? PROMPT_JAILBREAK_PREFILL : '';
            var b = typeof PROMPT_JAILBREAK_PREFILL_DEEPSEEK !== 'undefined' ? PROMPT_JAILBREAK_PREFILL_DEEPSEEK : '';
            return '【非DeepSeek模型版本】\n' + a + '\n\n【DeepSeek模型版本】\n' + b;
        } },
        FINAL_INSTRUCTION:  { title: '最终指令',        editable: false, get: function() { return typeof PROMPT_FINAL_INSTRUCTION !== 'undefined' ? PROMPT_FINAL_INSTRUCTION : ''; } }
    };

    /**
     * 打开编辑/查看弹窗
     * @param {string} key - 覆盖 key（不可调条目也复用同一套 key，只是不会写入覆盖）
     * @param {string} titleOverride - 可选，标题覆盖（下拉框条目用）
     * @param {boolean} editableOverride - 可选，是否可编辑（下拉框条目用）
     * @param {string} defaultTextOverride - 可选，默认内容（下拉框条目用）
     */
    function open(key, titleOverride, editableOverride, defaultTextOverride) {
        var title, editable, defaultText;
        if (typeof titleOverride !== 'undefined') {
            title = titleOverride;
            editable = !!editableOverride;
            defaultText = defaultTextOverride || '';
        } else {
            var fixed = _FIXED_MAP[key];
            if (!fixed) return;
            title = fixed.title;
            editable = fixed.editable;
            defaultText = fixed.get();
        }

        var existing = document.getElementById('prompt-editor-modal');
        if (existing) existing.remove();

        var current = editable ? ((typeof promptOverrides !== 'undefined') ? promptOverrides.get(key, defaultText) : defaultText) : defaultText;
        var hasOverride = editable && (typeof promptOverrides !== 'undefined') && promptOverrides.has(key);

        var innerHtml =
            '<h3 class="cfg-title">' + _escapeHtml(title) + (hasOverride ? ' <span style="font-size:13px;color:#4CAF50">（已自定义）</span>' : '') + '</h3>' +
            (editable
                ? '<p class="cfg-hint">修改后点击"保存"生效（全局配置，不随存档走）。点击"恢复默认"可撤销自定义，恢复出厂内容。</p>'
                : '<p class="cfg-hint">此条目为只读展示，不可编辑。</p>') +
            '<textarea id="prompt-editor-textarea" class="cfg-input" style="width:100%;height:50vh;min-height:260px;font-family:monospace;font-size:12px;white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word;box-sizing:border-box;resize:vertical"' +
            (editable ? '' : ' readonly') + '>' + _escapeHtml(current) + '</textarea>' +
            '<div class="modal-buttons" style="margin-top:12px">' +
            (editable
                ? '<button class="cfg-btn cfg-btn-subtle" onclick="promptManagerModal._resetDefault(\'' + key + '\')">恢复默认</button>' +
                  '<button class="cfg-btn cfg-btn-subtle" onclick="promptManagerModal._close()">取消</button>' +
                  '<button class="cfg-btn cfg-btn-green" onclick="promptManagerModal._save(\'' + key + '\')">保存</button>'
                : '<button class="cfg-btn cfg-btn-subtle" onclick="promptManagerModal._close()">关闭</button>') +
            '</div>';

        var html;
        if (typeof fitModalToViewport === 'function') {
            html = '<div id="prompt-editor-modal" class="modal viewport-overlay" style="z-index:5000">' +
                '<div class="modal-content" style="display:flex;justify-content:flex-start;align-items:center;background:transparent;border:none;box-shadow:none;padding:3% 16px;box-sizing:border-box;overflow-y:auto">' +
                '<div class="cfg-panel" style="max-width:720px;width:100%;box-sizing:border-box">' + innerHtml + '</div>' +
                '</div></div>';
        } else {
            html = '<div id="prompt-editor-modal" class="cfg-overlay" style="z-index:5000">' +
                '<div class="cfg-panel" style="max-width:720px;width:100%;box-sizing:border-box">' + innerHtml + '</div>' +
                '</div>';
        }

        document.body.insertAdjacentHTML('beforeend', html);
        var modal = document.getElementById('prompt-editor-modal');
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

    function _close() {
        var modal = document.getElementById('prompt-editor-modal');
        if (modal) modal.remove();
    }

    function _refreshRoot() {
        var root = document.getElementById('gs-prompt-manager-root');
        if (root) render(root);
    }

    function _save(key) {
        var ta = document.getElementById('prompt-editor-textarea');
        if (!ta || typeof promptOverrides === 'undefined') { _close(); return; }
        promptOverrides.set(key, ta.value);
        _close();
        _refreshRoot();
        if (typeof showModal === 'function') showModal('已保存自定义提示词');
    }

    function _resetDefault(key) {
        if (typeof promptOverrides !== 'undefined') promptOverrides.reset(key);
        _close();
        _refreshRoot();
        if (typeof showModal === 'function') showModal('已恢复默认提示词');
    }

    // ========== 自定义世界书 ==========

    var _pendingConfirmYes = null;

    /**
     * 一个世界书分类的完整块：插入按钮 + 条目列表，合并为同一个 pm-section（前后各一条粗分割线）
     * @param {string} slot - '1' 或 '2'
     */
    function _pmWorldbookCategory(slot) {
        var list = (typeof customWorldbook !== 'undefined') ? customWorldbook.getAll(slot) : [];

        var insertRow = '<div style="text-align:center;padding:12px 0 4px;">' +
            '<button class="cfg-btn cfg-btn-blue" onclick="promptManagerModal._openWorldbookEditor(\'' + slot + '\')">➕ 插入世界书</button>' +
            '</div>';

        var rows = '';
        for (var i = 0; i < list.length; i++) {
            var e = list[i];
            var offBadge = (e.enabled === false) ? ' <span style="font-size:12px;color:#999">（已关闭）</span>' : '';
            var upDisabled = (i === 0) ? ' disabled style="opacity:0.3;cursor:not-allowed"' : ' style="cursor:pointer"';
            var downDisabled = (i === list.length - 1) ? ' disabled style="opacity:0.3;cursor:not-allowed"' : ' style="cursor:pointer"';
            rows += '<div class="pm-wb-row" style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:10px 0;border-bottom:1px solid #f0f0f0;">' +
                '<button class="cfg-btn cfg-btn-subtle" style="flex:1 1 120px;min-width:0;text-align:left" onclick="promptManagerModal._openWorldbookEditor(\'' + slot + '\', \'' + _escapeHtml(e.id) + '\')">' +
                _escapeHtml(e.name || '(未命名世界书)') + offBadge +
                '</button>' +
                '<button onclick="promptManagerModal._wbMoveUp(\'' + slot + '\', \'' + _escapeHtml(e.id) + '\')"' + upDisabled + ' title="上移" ' +
                'class="cfg-btn cfg-btn-subtle" style="padding:2px 8px;font-size:12px;line-height:1;">▲</button>' +
                '<button onclick="promptManagerModal._wbMoveDown(\'' + slot + '\', \'' + _escapeHtml(e.id) + '\')"' + downDisabled + ' title="下移" ' +
                'class="cfg-btn cfg-btn-subtle" style="padding:2px 8px;font-size:12px;line-height:1;">▼</button>' +
                '<button onclick="promptManagerModal._confirmDeleteWorldbook(\'' + slot + '\', \'' + _escapeHtml(e.id) + '\')" ' +
                'style="background:none;border:none;color:#c0392b;font-size:18px;line-height:1;cursor:pointer;padding:2px 8px;" title="删除世界书">×</button>' +
                '</div>';
        }
        return '<div class="pm-section">' + insertRow + rows + '</div><div style="height:3px;background:#000;margin:14px 0;border:none;"></div>';
    }

    function _wbMoveUp(slot, id) {
        if (typeof customWorldbook === 'undefined') return;
        var list = customWorldbook.getAll(slot);
        var ids = list.map(function(x) { return x.id; });
        var idx = ids.indexOf(id);
        if (idx <= 0) return;
        var tmp = ids[idx - 1];
        ids[idx - 1] = ids[idx];
        ids[idx] = tmp;
        customWorldbook.reorder(slot, ids);
        _refreshRoot();
    }

    function _wbMoveDown(slot, id) {
        if (typeof customWorldbook === 'undefined') return;
        var list = customWorldbook.getAll(slot);
        var ids = list.map(function(x) { return x.id; });
        var idx = ids.indexOf(id);
        if (idx === -1 || idx >= ids.length - 1) return;
        var tmp = ids[idx + 1];
        ids[idx + 1] = ids[idx];
        ids[idx] = tmp;
        customWorldbook.reorder(slot, ids);
        _refreshRoot();
    }

    function _onWbToggle(chk) {
        var hint = chk.parentElement.querySelector('.gs-toggle-hint');
        if (hint) hint.textContent = chk.checked ? '开' : '关';
    }

    function _openWorldbookEditor(slot, id) {
        var existing = document.getElementById('wb-editor-modal');
        if (existing) existing.remove();

        var entry = null;
        if (id && typeof customWorldbook !== 'undefined') {
            var list = customWorldbook.getAll(slot);
            for (var i = 0; i < list.length; i++) { if (list[i].id === id) { entry = list[i]; break; } }
        }
        var isNew = !entry;
        var name = entry ? entry.name : '';
        var keywords = entry ? entry.keywords : '';
        var content = entry ? entry.content : '';
        var enabled = entry ? entry.enabled !== false : true;

        var innerHtml =
            '<h3 class="cfg-title">' + (isNew ? '插入世界书' : '编辑世界书') + '</h3>' +
            '<div class="cfg-field"><label class="cfg-label">世界书名称</label>' +
            '<input id="wb-name-input" type="text" class="cfg-input" value="' + _escapeHtml(name) + '" placeholder="如：西域地理设定"></div>' +
            '<div class="cfg-field"><label class="cfg-label">关键词</label>' +
            '<input id="wb-keywords-input" type="text" class="cfg-input" value="' + _escapeHtml(keywords) + '" placeholder="多个关键词用逗号或换行分隔，留空则不看关键词，只按开关插入"></div>' +
            '<div class="cfg-field"><label class="cfg-label">世界书内容</label>' +
            '<textarea id="wb-content-textarea" class="cfg-input" style="width:100%;height:32vh;min-height:180px;white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word;box-sizing:border-box;resize:vertical">' + _escapeHtml(content) + '</textarea></div>' +
            '<div class="gs-switch-row" style="border-bottom:none">' +
            '<span class="gs-switch-label">启用世界书</span>' +
            '<label class="gs-toggle-wrap">' +
            '<input type="checkbox" id="wb-enabled-toggle" onchange="promptManagerModal._onWbToggle(this)"' + (enabled ? ' checked' : '') + '>' +
            '<span class="gs-toggle-track"><span class="gs-toggle-thumb"></span></span>' +
            '<span class="gs-toggle-hint">' + (enabled ? '开' : '关') + '</span>' +
            '</label></div>' +
            '<div class="modal-buttons" style="margin-top:12px">' +
            '<button class="cfg-btn cfg-btn-subtle" onclick="promptManagerModal._closeWorldbookEditor()">取消</button>' +
            '<button class="cfg-btn cfg-btn-green" onclick="promptManagerModal._saveWorldbookEntry(\'' + slot + '\', \'' + (isNew ? '' : _escapeHtml(id)) + '\')">' +
            (isNew ? '创建世界书' : '更新世界书') + '</button>' +
            '</div>';

        var html;
        if (typeof fitModalToViewport === 'function') {
            html = '<div id="wb-editor-modal" class="modal viewport-overlay" style="z-index:5100">' +
                '<div class="modal-content" style="display:flex;justify-content:flex-start;align-items:center;background:transparent;border:none;box-shadow:none;padding:3% 16px;box-sizing:border-box;overflow-y:auto">' +
                '<div class="cfg-panel" style="max-width:640px;width:100%;box-sizing:border-box">' + innerHtml + '</div>' +
                '</div></div>';
        } else {
            html = '<div id="wb-editor-modal" class="cfg-overlay" style="z-index:5100">' +
                '<div class="cfg-panel" style="max-width:640px;width:100%;box-sizing:border-box">' + innerHtml + '</div>' +
                '</div>';
        }

        document.body.insertAdjacentHTML('beforeend', html);
        var modal = document.getElementById('wb-editor-modal');
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

    function _closeWorldbookEditor() {
        var modal = document.getElementById('wb-editor-modal');
        if (modal) modal.remove();
    }

    function _saveWorldbookEntry(slot, id) {
        var nameEl = document.getElementById('wb-name-input');
        var keywordsEl = document.getElementById('wb-keywords-input');
        var contentEl = document.getElementById('wb-content-textarea');
        var enabledEl = document.getElementById('wb-enabled-toggle');
        if (!nameEl || !contentEl || typeof customWorldbook === 'undefined') { _closeWorldbookEditor(); return; }

        customWorldbook.upsert(slot, {
            id: id || null,
            name: nameEl.value.trim(),
            keywords: keywordsEl ? keywordsEl.value.trim() : '',
            content: contentEl.value,
            enabled: !!(enabledEl && enabledEl.checked)
        });
        _closeWorldbookEditor();
        _refreshRoot();
        if (typeof showModal === 'function') showModal(id ? '世界书已更新' : '世界书已创建');
    }

    function _confirmDeleteWorldbook(slot, id) {
        var name = id;
        if (typeof customWorldbook !== 'undefined') {
            var list = customWorldbook.getAll(slot);
            for (var i = 0; i < list.length; i++) { if (list[i].id === id) { name = list[i].name || '(未命名世界书)'; break; } }
        }
        _confirm('确定删除世界书「' + name + '」吗？此操作不可撤销。', function() {
            if (typeof customWorldbook !== 'undefined') customWorldbook.remove(slot, id);
            _refreshRoot();
        });
    }

    function _confirm(message, onYes) {
        var existing = document.getElementById('pm-confirm-modal');
        if (existing) existing.remove();
        var html = '<div id="pm-confirm-modal" style="position:fixed;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:6000;display:flex;align-items:center;justify-content:center;">' +
            '<div class="cfg-panel" style="max-width:420px;width:90%;box-sizing:border-box;">' +
            '<p style="margin:0 0 16px;">' + _escapeHtml(message) + '</p>' +
            '<div class="modal-buttons">' +
            '<button class="cfg-btn cfg-btn-subtle" onclick="document.getElementById(\'pm-confirm-modal\').remove()">取消</button>' +
            '<button class="cfg-btn" style="background:rgba(220,80,80,0.25);border-color:rgba(220,80,80,0.5);color:#ffb3b3" onclick="promptManagerModal._confirmYes()">确定</button>' +
            '</div></div></div>';
        document.body.insertAdjacentHTML('beforeend', html);
        _pendingConfirmYes = onYes;
    }

    function _confirmYes() {
        var modal = document.getElementById('pm-confirm-modal');
        if (modal) modal.remove();
        if (typeof _pendingConfirmYes === 'function') {
            var fn = _pendingConfirmYes;
            _pendingConfirmYes = null;
            fn();
        }
    }

    return {
        render: render,
        open: open,
        _openLocation: _openLocation,
        _openNpc: _openNpc,
        _openAction: _openAction,
        _openThink: _openThink,
        _save: _save,
        _resetDefault: _resetDefault,
        _close: _close,
        _wbMoveUp: _wbMoveUp,
        _wbMoveDown: _wbMoveDown,
        _onWbToggle: _onWbToggle,
        _openWorldbookEditor: _openWorldbookEditor,
        _closeWorldbookEditor: _closeWorldbookEditor,
        _saveWorldbookEntry: _saveWorldbookEntry,
        _confirmDeleteWorldbook: _confirmDeleteWorldbook,
        _confirmYes: _confirmYes
    };
})();
