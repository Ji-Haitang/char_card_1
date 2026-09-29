/**
 * memory-editor.js - 记忆编辑器（手动修正记忆内容）
 * 2026-08-15 新增
 *
 * 功能：
 * - 四类记忆的查看/编辑/删除/新增：
 *   1. 碎片日记（summaryHistory，L0 层）
 *   2. 剧情事件（eventHistory，L2 层）
 *   3. 已确立事实 + 人物弧光（eventMeta.facts / eventMeta.arcs）
 *   4. 每周总结（weekHistory）
 * - 保存时自动处理向量一致性：
 *   L0/L2 编辑/删除后删除对应向量（emb_* 与 wevt_* + 内存缓存），
 *   下一轮 pipeline 的 _sync 自愈机制按新文本自动补生成向量；
 *   词法倒排索引由 removeFromCacheL2 / addToCacheL2 增量维护，无需全量重建。
 * - eventMeta 不走向量，直接 saveMeta + _refreshAliasMap。
 * - weekHistory 不向量化，replaceByMarkWeek 自动补 [至X周的历史记录] 后缀。
 *
 * 依赖：storageService, memoryRecall, summaryHistoryService,
 *        eventHistoryService, weekHistoryService（均在本文件之前加载）
 */

var memoryEditor = (function() {
    'use strict';

    var _tab = 'summary';   // 当前页签：summary | events | meta | week
    var _view = 'list';     // list | edit
    var _editType = null;   // 编辑对象类型：summary | event | fact | arc | week | newevent | newfact | newarc
    var _editKey = null;    // 编辑对象标识（id / fact key / arc name / markWeek）
    // 各页签分别记录列表滚动位置；进入编辑页再返回时恢复原处，避免保存后跳回顶部。
    var _listScrollByTab = { summary: 0, events: 0, meta: 0, week: 0 };

    // =========================================================================
    // 工具
    // =========================================================================

    function _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _fmtWeek(week) {
        var w = Number(week) || 1;
        var y = Math.floor((w - 1) / 48) + 1;
        var r = (w - 1) % 48;
        var m = Math.floor(r / 4) + 1;
        var k = r % 4 + 1;
        return '[第' + y + '年第' + m + '月第' + k + '周]';
    }

    function _short(s, n) {
        s = String(s || '');
        n = n || 60;
        return s.length > n ? s.slice(0, n) + '…' : s;
    }

    function _splitList(s) {
        if (!s) return [];
        return String(s).split(/[,，、\n]+/).map(function(x) { return x.trim(); }).filter(function(x) { return x.length > 0; });
    }

    function _nowAddedAt() {
        // 手动新增/编辑条目：用当前时间戳（注入排序按 _addedAt 新→旧，手动条目排最前）
        return Date.now();
    }

    function _rememberListScroll() {
        if (_view !== 'list') return;
        var body = document.getElementById('memory-editor-body');
        if (body) _listScrollByTab[_tab] = body.scrollTop || 0;
    }

    function _restoreListScroll(body) {
        var target = _listScrollByTab[_tab] || 0;
        var restore = function() { body.scrollTop = target; };
        restore();
        // 等列表重新排版完成后再恢复一次，避免图片/字体加载导致位置被浏览器重置。
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restore);
    }

    // =========================================================================
    // 弹窗骨架
    // =========================================================================

    function open() {
        close();
        var overlay = document.createElement('div');
        overlay.id = 'memory-editor-overlay';
        overlay.className = 'modal viewport-overlay';
        overlay.dataset.selfManagedViewport = 'true';
        overlay.style.cssText = 'display:flex;align-items:center;justify-content:center;position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;overflow:hidden;box-sizing:border-box;padding:max(10px,env(safe-area-inset-top,0px)) max(10px,env(safe-area-inset-right,0px)) max(10px,env(safe-area-inset-bottom,0px)) max(10px,env(safe-area-inset-left,0px));z-index:100001;';
        overlay.innerHTML =
            '<style>@media (orientation:landscape) and (max-height:300px){#memory-editor-overlay .memory-editor-footer{display:none!important}#memory-editor-overlay .modal-content{border-width:8px!important;border-image-width:10px!important;padding:6px!important}#memory-editor-overlay .memory-editor-header,#memory-editor-overlay .memory-editor-tabs{margin-bottom:4px!important}#memory-editor-overlay .memory-editor-subtitle{display:none!important}#memory-editor-overlay .memory-editor-tabs .modal-btn{min-height:32px!important;padding:3px 8px!important;font-size:12px!important}}</style>'
            + '<style>.memory-editor-heading{min-width:0!important}#memory-editor-overlay .memory-editor-header .memory-editor-heading>h3{display:inline-block!important;align-self:flex-start!important;width:max-content!important;max-width:100%!important;background-color:var(--paper-base,#f4f0e6)!important;background-image:url("assets/image/static/水墨笔触2.png")!important;background-size:contain!important;background-position:left center!important;background-repeat:no-repeat!important;background-blend-mode:multiply!important;color:var(--paper-base,#f4f0e6)!important;border:0!important;padding:6px 10px!important;margin:0 0 8px!important;transform:rotate(-1.6deg)!important;font-family:var(--font-serif,"Kaiti",serif)!important;font-size:20px!important;line-height:1.35!important;letter-spacing:.04em!important;-webkit-text-stroke:1.5px var(--ink-black,#1a1a1a)!important;paint-order:stroke fill!important;text-shadow:0 0 1px rgba(0,0,0,.5)!important;white-space:nowrap!important}.memory-editor-heading>.memory-editor-subtitle{display:block!important;padding-left:0!important;font-size:12px!important;line-height:1.45!important;color:#888!important;font-weight:normal!important;-webkit-text-stroke:0!important;text-shadow:none!important;letter-spacing:0!important}body.ui-style-flat #memory-editor-overlay .memory-editor-header .memory-editor-heading>h3{background:none!important;color:var(--f-text,#e8ecf5)!important;border-bottom:2px solid var(--f-accent,#4ecdc4)!important;transform:none!important;-webkit-text-stroke:0!important;text-shadow:none!important}@media (orientation:landscape) and (max-height:600px){#memory-editor-overlay .memory-editor-header .memory-editor-heading>h3{padding:3px 8px!important;margin-bottom:4px!important;font-size:18px!important}}</style>'
            + '<div class="modal-content" style="position:relative!important;left:auto!important;top:auto!important;transform:none!important;width:min(94vw,760px)!important;height:min(calc(100vh - 20px),920px)!important;height:min(calc(100dvh - 20px),920px)!important;max-width:760px!important;max-height:none!important;margin:0;display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box;">'
            + '<div class="memory-editor-header" style="display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:10px;margin-bottom:10px;flex-shrink:0;">'
            + '<div class="memory-editor-heading"><h3>记忆编辑</h3><span class="memory-editor-subtitle">修改内容保存后，向量将在下一轮自动重建</span></div>'
            + '<button class="modal-btn cancel" style="padding:4px 12px;font-size:13px;flex-shrink:0;" onclick="memoryEditor.close()" title="关闭（退出编辑）">✕ 退出</button>'
            + '</div>'
            + '<div class="memory-editor-tabs" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;flex-shrink:0;">'
            + _tabBtn('summary', '碎片日记')
            + _tabBtn('events', '剧情事件')
            + _tabBtn('meta', '事实/弧光')
            + _tabBtn('week', '每周总结')
            + '</div>'
            + '<div id="memory-editor-body" style="flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;"></div>'
            + '<div class="modal-buttons memory-editor-footer" style="margin-top:10px;flex-shrink:0;">'
            + '<button class="modal-btn cancel" onclick="memoryEditor.close()">关闭</button>'
            + '</div>'
            + '</div>';
        document.body.appendChild(overlay);
        render();
    }

    function _tabBtn(tab, label) {
        var active = _tab === tab ? ' style="background:#c8a96e;color:#1a1a2e;border-color:#c8a96e;"' : '';
        return '<button class="modal-btn" data-tab="' + tab + '"' + active
            + ' onclick="memoryEditor.switchTab(\'' + tab + '\')">' + label + '</button>';
    }

    function close() {
        var el = document.getElementById('memory-editor-overlay');
        if (el) el.parentNode.removeChild(el);
        _view = 'list';
        _editType = null;
        _editKey = null;
    }

    function switchTab(tab) {
        _rememberListScroll();
        _tab = tab;
        _view = 'list';
        _editType = null;
        _editKey = null;
        render();
    }

    function render() {
        var body = document.getElementById('memory-editor-body');
        if (!body) return;
        if (_view === 'edit') {
            body.innerHTML = _renderEditForm();
            body.scrollTop = 0;
            return;
        }
        if (_tab === 'summary') body.innerHTML = _renderSummaryList();
        else if (_tab === 'events') body.innerHTML = _renderEventList();
        else if (_tab === 'meta') body.innerHTML = _renderMetaList();
        else if (_tab === 'week') body.innerHTML = _renderWeekList();
        _restoreListScroll(body);
    }

    // =========================================================================
    // ① 碎片日记（summaryHistory）
    // =========================================================================

    function _renderSummaryList() {
        var list = (typeof summaryHistoryService !== 'undefined') ? summaryHistoryService.getAll() : [];
        var rows = list.slice().reverse().map(function(s) {
            return '<div style="border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:8px 10px;margin-bottom:8px;">'
                + '<div style="font-size:11px;color:#888;">' + _esc(s.id) + ' · ' + _fmtWeek(s.week) + ' · 来源:' + _esc(s.source || 'llm') + '</div>'
                + '<div style="margin:4px 0 6px;">' + _esc(_short(s.summaryText, 120)) + '</div>'
                + '<button class="modal-btn" style="padding:3px 12px;font-size:12px;" onclick="memoryEditor.edit(\'summary\',\'' + _esc(s.id) + '\')">编辑</button> '
                + '<button class="modal-btn cancel" style="padding:3px 12px;font-size:12px;" onclick="memoryEditor.remove(\'summary\',\'' + _esc(s.id) + '\')">删除</button>'
                + '</div>';
        }).join('');
        return '<div style="font-size:12px;color:#aaa;margin-bottom:8px;">共 ' + list.length + ' 条（全部保留，不自动裁剪）</div>' + (rows || '<div style="color:#888;">暂无日记</div>');
    }

    // =========================================================================
    // ② 剧情事件（eventHistory）
    // =========================================================================

    function _renderEventList() {
        var list = (typeof eventHistoryService !== 'undefined') ? eventHistoryService.getAll() : [];
        var rows = list.slice().reverse().map(function(ev) {
            var refs = list.filter(function(e) { return e.causedBy && e.causedBy.indexOf(ev.id) !== -1; });
            var refTxt = refs.length > 0 ? ' <span style="color:#e0a030;">被引' + refs.length + '</span>' : '';
            return '<div style="border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:8px 10px;margin-bottom:8px;">'
                + '<div style="font-size:11px;color:#888;">' + _esc(ev.id) + ' · ' + _esc(ev.title || '无标题') + ' · ' + _fmtWeek(ev.week) + refTxt + '</div>'
                + '<div style="margin:4px 0;">' + _esc(_short(ev.description, 110)) + '</div>'
                + '<div style="font-size:11px;color:#999;">关键词: ' + _esc((ev.keywords || []).join('、') || '无') + ' · NPC: ' + _esc((ev.npc || []).join('、') || '无') + ' · ' + _esc(ev.location || '无地点') + '</div>'
                + '<div style="margin-top:5px;">'
                + '<button class="modal-btn" style="padding:3px 12px;font-size:12px;" onclick="memoryEditor.edit(\'event\',\'' + _esc(ev.id) + '\')">编辑</button> '
                + '<button class="modal-btn cancel" style="padding:3px 12px;font-size:12px;" onclick="memoryEditor.remove(\'event\',\'' + _esc(ev.id) + '\')">删除</button>'
                + '</div></div>';
        }).join('');
        return '<div style="font-size:12px;color:#aaa;margin-bottom:8px;">共 ' + list.length + ' 条</div>'
            + '<button class="modal-btn" style="margin-bottom:10px;padding:4px 14px;font-size:12px;" onclick="memoryEditor.edit(\'newevent\',\'\')">＋ 新增事件</button>'
            + (rows || '<div style="color:#888;">暂无事件</div>');
    }

    // =========================================================================
    // ③ 已确立事实 + 人物弧光（eventMeta）
    // =========================================================================

    function _renderMetaList() {
        var meta = (typeof eventHistoryService !== 'undefined') ? eventHistoryService.getMeta() : { facts: {}, arcs: {} };
        var facts = meta.facts || {};
        var arcs = meta.arcs || {};

        var factKeys = Object.keys(facts);
        var factRows = factKeys.map(function(k) {
            var f = facts[k];
            var parts = String(k).split('|');
            var s = parts[0] || '', p = parts[1] || '';
            var tag = f.isState ? ' <span style="color:#6a9fd8;">核心</span>' : ' <span style="color:#888;">软记忆</span>';
            return '<div style="border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:8px 10px;margin-bottom:8px;">'
                + '<div style="font-size:11px;color:#888;">' + _esc(k) + tag + (f.trend ? ' · trend=' + _esc(f.trend) : '') + '</div>'
                + '<div style="margin:4px 0;">' + _esc(_short(f.o, 90)) + '</div>'
                + '<button class="modal-btn" style="padding:3px 12px;font-size:12px;" onclick="memoryEditor.edit(\'fact\',\'' + _esc(k) + '\')">编辑</button> '
                + '<button class="modal-btn cancel" style="padding:3px 12px;font-size:12px;" onclick="memoryEditor.remove(\'fact\',\'' + _esc(k) + '\')">删除</button>'
                + '</div>';
        }).join('');

        var arcNames = Object.keys(arcs);
        var arcRows = arcNames.map(function(n) {
            var a = arcs[n];
            var traj = Array.isArray(a.trajectory) ? a.trajectory : (a.trajectory ? [String(a.trajectory)] : []);
            return '<div style="border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:8px 10px;margin-bottom:8px;">'
                + '<div style="font-size:11px;color:#888;">' + _esc(n) + ' · progress=' + (typeof a.progress === 'number' ? a.progress.toFixed(2) : '0.00') + '</div>'
                + '<div style="margin:4px 0;">' + _esc(_short(traj.join(' → '), 90)) + (a.newMoment ? ' · <span style="color:#c8a96e;">' + _esc(_short(a.newMoment, 40)) + '</span>' : '') + '</div>'
                + '<button class="modal-btn" style="padding:3px 12px;font-size:12px;" onclick="memoryEditor.edit(\'arc\',\'' + _esc(n) + '\')">编辑</button> '
                + '<button class="modal-btn cancel" style="padding:3px 12px;font-size:12px;" onclick="memoryEditor.remove(\'arc\',\'' + _esc(n) + '\')">删除</button>'
                + '</div>';
        }).join('');

        return '<h4 style="margin:4px 0 6px;color:#c8a96e;font-size:14px;">已确立事实（' + factKeys.length + '）</h4>'
            + '<button class="modal-btn" style="margin-bottom:10px;padding:3px 12px;font-size:12px;" onclick="memoryEditor.edit(\'newfact\',\'\')">＋ 新增事实</button>'
            + (factRows || '<div style="color:#888;margin-bottom:12px;">暂无事实</div>')
            + '<h4 style="margin:14px 0 6px;color:#c8a96e;font-size:14px;">人物弧光（' + arcNames.length + '）</h4>'
            + '<button class="modal-btn" style="margin-bottom:10px;padding:3px 12px;font-size:12px;" onclick="memoryEditor.edit(\'newarc\',\'\')">＋ 新增弧光</button>'
            + (arcRows || '<div style="color:#888;">暂无弧光</div>');
    }

    // =========================================================================
    // ④ 每周总结（weekHistory）
    // =========================================================================

    function _renderWeekList() {
        var list = (typeof weekHistoryService !== 'undefined') ? weekHistoryService.getAll() : [];
        // 按 markWeek 分组（同一周可能多条：初版 runTurn 多条 + runSummary 最终版替换第一条）
        var groups = {};
        var order = [];
        for (var i = 0; i < list.length; i++) {
            var mw = list[i].markWeek || list[i].week || 1;
            if (!groups[mw]) { groups[mw] = []; order.push(mw); }
            groups[mw].push(list[i]);
        }
        var rows = order.slice().reverse().map(function(mw) {
            var items = groups[mw];
            var w = items[0];
            var text = (w.summaryText || '').replace(/\n?\[至\d+周的历史记录\]\s*$/, '').trim();
            var multi = items.length > 1 ? ' <span style="color:#e0a030;">×' + items.length + '条</span>' : '';
            return '<div style="border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:8px 10px;margin-bottom:8px;">'
                + '<div style="font-size:11px;color:#888;">markWeek=' + mw + ' · ' + _esc(w.source || 'runTurn') + multi + '</div>'
                + '<div style="margin:4px 0;">' + _esc(_short(text, 120)) + '</div>'
                + '<button class="modal-btn" style="padding:3px 12px;font-size:12px;" onclick="memoryEditor.edit(\'week\',\'' + mw + '\')">编辑</button> '
                + '<button class="modal-btn cancel" style="padding:3px 12px;font-size:12px;" onclick="memoryEditor.remove(\'week\',\'' + mw + '\')">删除</button>'
                + '</div>';
        }).join('');
        return '<div style="font-size:12px;color:#aaa;margin-bottom:8px;">共 ' + order.length + ' 周（跳周时生成，不参与向量召回）</div>' + (rows || '<div style="color:#888;">暂无周总结</div>');
    }

    // =========================================================================
    // 编辑表单
    // =========================================================================

    function edit(type, key) {
        _rememberListScroll();
        _view = 'edit';
        _editType = type;
        _editKey = key;
        render();
    }

    function _renderEditForm() {
        var t = _editType;
        var key = _editKey;
        var html = '';

        if (t === 'summary') {
            var s = _findSummary(key);
            if (!s) return _err('未找到该日记');
            html = '<h4 style="margin:0 0 8px;">编辑碎片日记 <span style="font-size:11px;color:#888;">' + _esc(s.id) + ' · ' + _fmtWeek(s.week) + '</span></h4>'
                + '<label style="font-size:12px;color:#aaa;">日记内容（白描，80~120字左右）</label>'
                + '<textarea id="me-summary-text" rows="6" style="width:100%;box-sizing:border-box;margin:4px 0 10px;background:#111;color:#ddd;border:1px solid #333;border-radius:6px;padding:8px;">' + _esc(s.summaryText || '') + '</textarea>';
        } else if (t === 'event' || t === 'newevent') {
            var ev = t === 'event' ? _findEvent(key) : null;
            if (t === 'event' && !ev) return _err('未找到该事件');
            var list = (typeof eventHistoryService !== 'undefined') ? eventHistoryService.getAll() : [];
            var idTxt = t === 'newevent'
                ? 'evt-' + ((typeof eventHistoryService !== 'undefined' && eventHistoryService.getMaxEventId) ? eventHistoryService.getMaxEventId() + 1 : 1)
                : ev.id;
            var causedOpts = list.map(function(e) {
                return '<option value="' + _esc(e.id) + '"' + (ev && ev.causedBy && ev.causedBy.indexOf(e.id) !== -1 ? ' selected' : '') + '>' + _esc(e.id) + ' ' + _esc(e.title || '') + '</option>';
            }).join('');
            var causedVal = ev && ev.causedBy && ev.causedBy.length > 0 ? ev.causedBy.join(',') : '';
            html = '<h4 style="margin:0 0 8px;">' + (t === 'newevent' ? '新增事件' : '编辑事件') + ' <span style="font-size:11px;color:#888;">' + _esc(idTxt) + '</span></h4>'
                + _field('me-ev-title', '标题（短，8~12字）', ev ? ev.title : '')
                + _field('me-ev-time', '时间标签（如：第一年二月第三周）', ev ? ev.timeLabel : '')
                + _field('me-ev-loc', '地点', ev ? ev.location : '')
                + '<label style="font-size:12px;color:#aaa;">描述（叙事主干，60~100字）</label>'
                + '<textarea id="me-ev-desc" rows="5" style="width:100%;box-sizing:border-box;margin:4px 0 10px;background:#111;color:#ddd;border:1px solid #333;border-radius:6px;padding:8px;">' + _esc(ev ? ev.description : '') + '</textarea>'
                + _field('me-ev-kw', '关键词（逗号分隔，3~6个）', ev ? (ev.keywords || []).join(',') : '')
                + _field('me-ev-npc', '在场NPC（逗号分隔）', ev ? (ev.npc || []).join(',') : '')
                + '<label style="font-size:12px;color:#aaa;">前因事件（causedBy，逗号分隔，仅填已存在 id）</label>'
                + '<input id="me-ev-caused" value="' + _esc(causedVal) + '" placeholder="evt-3,evt-7" style="width:100%;box-sizing:border-box;margin:4px 0 10px;background:#111;color:#ddd;border:1px solid #333;border-radius:6px;padding:8px;">'
                + '<div style="font-size:11px;color:#888;margin-bottom:10px;">可选（不填：该事件不挂日记证据锚点，仅按语义召回）</div>';
            if (list.length > 0) {
                html += '<select id="me-ev-caused-pick" multiple size="4" style="width:100%;box-sizing:border-box;margin-bottom:10px;background:#111;color:#ddd;border:1px solid #333;border-radius:6px;">' + causedOpts + '</select>';
            }
        } else if (t === 'fact' || t === 'newfact') {
            var meta = (typeof eventHistoryService !== 'undefined') ? eventHistoryService.getMeta() : { facts: {} };
            var fact = t === 'fact' ? (meta.facts || {})[key] : null;
            if (t === 'fact' && !fact) return _err('未找到该事实');
            var kp = t === 'fact' ? String(key).split('|') : ['', ''];
            var trendSel = '<select id="me-fact-trend" style="width:100%;box-sizing:border-box;margin:4px 0 10px;background:#111;color:#ddd;border:1px solid #333;border-radius:6px;padding:8px;">'
                + '<option value="">（无趋势）</option>'
                + ['破裂','厌恶','反感','陌生','投缘','亲密','交融'].map(function(x) {
                    return '<option value="' + x + '"' + (fact && fact.trend === x ? ' selected' : '') + '>' + x + '</option>';
                }).join('') + '</select>';
            html = '<h4 style="margin:0 0 8px;">' + (t === 'newfact' ? '新增事实' : '编辑事实') + '</h4>'
                + _field('me-fact-s', '主体', kp[0])
                + _field('me-fact-p', '谓语（关系类用"对X的看法"）', kp[1])
                + '<label style="font-size:12px;color:#aaa;">宾语（o，短句，≤20字）</label>'
                + '<input id="me-fact-o" value="' + _esc(fact ? fact.o : '') + '" style="width:100%;box-sizing:border-box;margin:4px 0 10px;background:#111;color:#ddd;border:1px solid #333;border-radius:6px;padding:8px;">'
                + '<label style="font-size:12px;color:#aaa;">趋势（关系类）</label>' + trendSel
                + '<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#aaa;margin-bottom:10px;">'
                + '<input type="checkbox" id="me-fact-isstate"' + (fact && fact.isState ? ' checked' : '') + '> 核心约束（位置/身份/生死/归属/关系，永不自动删）</label>';
        } else if (t === 'arc' || t === 'newarc') {
            var meta2 = (typeof eventHistoryService !== 'undefined') ? eventHistoryService.getMeta() : { arcs: {} };
            var arc = t === 'arc' ? (meta2.arcs || {})[key] : null;
            if (t === 'arc' && !arc) return _err('未找到该弧光');
            var traj = arc && Array.isArray(arc.trajectory) ? arc.trajectory.join(' → ') : (arc && arc.trajectory ? String(arc.trajectory) : '');
            html = '<h4 style="margin:0 0 8px;">' + (t === 'newarc' ? '新增弧光' : '编辑弧光') + '</h4>'
                + _field('me-arc-name', '角色名', arc ? key : '')
                + _field('me-arc-traj', '阶段轨迹（用 → 分隔，如：从戒备转为试探性靠近）', traj)
                + '<label style="font-size:12px;color:#aaa;">进度（0.0~1.0，1.0=已定型不再注入）</label>'
                + '<input id="me-arc-prog" type="number" min="0" max="1" step="0.05" value="' + (arc && typeof arc.progress === 'number' ? arc.progress : 0) + '" style="width:100%;box-sizing:border-box;margin:4px 0 10px;background:#111;color:#ddd;border:1px solid #333;border-radius:6px;padding:8px;">'
                + _field('me-arc-moment', '最新关键时刻（newMoment）', arc ? arc.newMoment : '');
        } else if (t === 'week') {
            var w = _findWeek(key);
            if (!w) return _err('未找到该周总结');
            var wtext = (w.summaryText || '').replace(/\n?\[至\d+周的历史记录\]\s*$/, '').trim();
            html = '<h4 style="margin:0 0 8px;">编辑每周总结 <span style="font-size:11px;color:#888;">markWeek=' + _esc(key) + '</span></h4>'
                + '<label style="font-size:12px;color:#aaa;">内容（保留 [第x年…] 前缀，保存时自动补 [至X周的历史记录] 后缀）</label>'
                + '<textarea id="me-week-text" rows="8" style="width:100%;box-sizing:border-box;margin:4px 0 10px;background:#111;color:#ddd;border:1px solid #333;border-radius:6px;padding:8px;">' + _esc(wtext) + '</textarea>';
        } else {
            return _err('未知编辑类型');
        }

        html += '<div class="modal-buttons" style="margin-top:6px;">'
            + '<button class="modal-btn" onclick="memoryEditor.save()">保存</button>'
            + '<button class="modal-btn cancel" onclick="memoryEditor.cancelEdit()">取消</button>'
            + '</div>';
        return html;
    }

    function _field(id, label, val) {
        return '<label style="font-size:12px;color:#aaa;">' + label + '</label>'
            + '<input id="' + id + '" value="' + _esc(val || '') + '" style="width:100%;box-sizing:border-box;margin:4px 0 10px;background:#111;color:#ddd;border:1px solid #333;border-radius:6px;padding:8px;">';
    }

    function _err(msg) {
        return '<div style="color:#e06060;margin:12px 0;">' + msg + '</div>'
            + '<button class="modal-btn cancel" onclick="memoryEditor.cancelEdit()">返回</button>';
    }

    function cancelEdit() {
        _view = 'list';
        _editType = null;
        _editKey = null;
        render();
    }

    function _val(id) {
        var el = document.getElementById(id);
        return el ? el.value : '';
    }

    function _chk(id) {
        var el = document.getElementById(id);
        return !!(el && el.checked);
    }

    // =========================================================================
    // 查找
    // =========================================================================

    function _findSummary(id) {
        var list = (typeof summaryHistoryService !== 'undefined') ? summaryHistoryService.getAll() : [];
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
    }

    function _findEvent(id) {
        var list = (typeof eventHistoryService !== 'undefined') ? eventHistoryService.getAll() : [];
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
    }

    function _findWeek(markWeek) {
        var list = (typeof weekHistoryService !== 'undefined') ? weekHistoryService.getAll() : [];
        var mw = Number(markWeek);
        for (var i = 0; i < list.length; i++) if ((list[i].markWeek || list[i].week || 1) === mw) return list[i];
        return null;
    }

    // =========================================================================
    // 保存
    // =========================================================================

    function save() {
        var t = _editType;
        var key = _editKey;
        var msg = '';
        try {
            if (t === 'summary') {
                var s = _findSummary(key);
                if (!s) return _fail('未找到该日记');
                var text = _val('me-summary-text');
                if (!text || !text.trim()) return _fail('日记内容不能为空');
                s.summaryText = text.trim();
                summaryHistoryService.save(summaryHistoryService.getAll());
                _dropL0Vector(key);
                msg = '已保存，向量将于下一轮自动重建';
            } else if (t === 'event' || t === 'newevent') {
                var evId = (t === 'newevent') ? null : key;
                var ev = evId ? _findEvent(evId) : null;
                var id = ev ? ev.id : _nextEventId();
                var causedRaw = _splitList(_val('me-ev-caused'));
                // 合并多选下拉框的选择
                var pickEl = document.getElementById('me-ev-caused-pick');
                if (pickEl) {
                    for (var pi = 0; pi < pickEl.options.length; pi++) {
                        if (pickEl.options[pi].selected && causedRaw.indexOf(pickEl.options[pi].value) === -1) {
                            causedRaw.push(pickEl.options[pi].value);
                        }
                    }
                }
                // 校验 causedBy 存在性
                var allEvents = (typeof eventHistoryService !== 'undefined') ? eventHistoryService.getAll() : [];
                var existingIds = {};
                for (var ei = 0; ei < allEvents.length; ei++) existingIds[allEvents[ei].id] = true;
                var bad = causedRaw.filter(function(c) { return !existingIds[c] || c === id; });
                if (bad.length > 0) return _fail('前因引用无效（不存在或指向自身）: ' + bad.join(', '));

                var desc = _val('me-ev-desc');
                if (!desc || !desc.trim()) return _fail('描述不能为空');
                var patch = {
                    title: _val('me-ev-title').trim(),
                    timeLabel: _val('me-ev-time').trim(),
                    location: _val('me-ev-loc').trim(),
                    description: desc.trim(),
                    keywords: _splitList(_val('me-ev-kw')),
                    npc: _splitList(_val('me-ev-npc')),
                    causedBy: causedRaw.slice(0, 2)
                };
                if (ev) {
                    for (var pk in patch) ev[pk] = patch[pk];
                    ev.source = ev.source || 'manual';
                } else {
                    var nowWeek = (typeof currentWeek !== 'undefined') ? currentWeek : 1;
                    allEvents.push({
                        id: id,
                        week: nowWeek,
                        timeLabel: patch.timeLabel,
                        description: patch.description,
                        uiStart: null,
                        uiEnd: null,
                        causedBy: patch.causedBy,
                        npc: patch.npc,
                        location: patch.location,
                        title: patch.title,
                        keywords: patch.keywords,
                        source: 'manual',
                        createdAt: Date.now()
                    });
                }
                eventHistoryService.appendEvents(allEvents);
                if (evId) _dropL2Vector(evId);
                msg = '已保存（新事件无向量，下一轮自动补生成）';
            } else if (t === 'fact' || t === 'newfact') {
                var s2 = _val('me-fact-s').trim();
                var p2 = _val('me-fact-p').trim();
                var o2 = _val('me-fact-o').trim();
                if (!s2 || !p2) return _fail('主体和谓语不能为空');
                if (!o2) return _fail('宾语不能为空');
                var meta = (typeof eventHistoryService !== 'undefined') ? eventHistoryService.getMeta() : { facts: {}, arcs: {}, aliases: {} };
                var newKey = s2 + '|' + p2;
                var oldKey = key;
                var prev = meta.facts[oldKey];
                meta.facts[newKey] = {
                    o: o2,
                    isState: _chk('me-fact-isstate'),
                    trend: _val('me-fact-trend') || undefined,
                    _addedAt: (prev && prev._addedAt) ? prev._addedAt : _nowAddedAt()
                };
                if (oldKey && oldKey !== newKey) delete meta.facts[oldKey];
                _saveMeta(meta);
                msg = '已保存';
            } else if (t === 'arc' || t === 'newarc') {
                var name = _val('me-arc-name').trim();
                if (!name) return _fail('角色名不能为空');
                var trajText = _val('me-arc-traj');
                var trajParts = trajText.split('→').map(function(x) { return x.trim(); }).filter(function(x) { return x.length > 0; });
                var prog = parseFloat(_val('me-arc-prog'));
                if (isNaN(prog)) prog = 0;
                prog = Math.max(0, Math.min(1, prog));
                var meta2 = (typeof eventHistoryService !== 'undefined') ? eventHistoryService.getMeta() : { arcs: {}, facts: {}, aliases: {} };
                var prevArc = meta2.arcs[key];
                meta2.arcs[name] = {
                    trajectory: trajParts.length > 0 ? trajParts : (prevArc && prevArc.trajectory ? prevArc.trajectory : []),
                    progress: prog,
                    newMoment: _val('me-arc-moment').trim(),
                    _addedAt: (prevArc && prevArc._addedAt) ? prevArc._addedAt : _nowAddedAt()
                };
                if (key && key !== name) delete meta2.arcs[key];
                _saveMeta(meta2);
                msg = '已保存';
            } else if (t === 'week') {
                var w2 = _findWeek(key);
                if (!w2) return _fail('未找到该周总结');
                var wtext = _val('me-week-text');
                if (!wtext || !wtext.trim()) return _fail('内容不能为空');
                var mw = Number(key);
                var ok = weekHistoryService.replaceByMarkWeek(mw, wtext.trim(), 'manual');
                if (!ok) return _fail('按 markWeek=' + key + ' 未找到周总结条目');
                msg = '已保存';
            } else {
                return _fail('未知类型');
            }
        } catch (e) {
            console.error('[MemoryEditor] 保存失败:', e);
            return _fail('保存失败：' + (e && e.message || e));
        }
        console.log('[MemoryEditor] ' + t + ' 保存成功: ' + key, msg);
        _view = 'list';
        _editType = null;
        _editKey = null;
        render();
        if (typeof showModal === 'function') showModal(msg);
    }

    function _fail(msg) {
        if (typeof showModal === 'function') showModal(msg);
        console.warn('[MemoryEditor] 校验失败:', msg);
        return false;
    }

    function _nextEventId() {
        var max = (typeof eventHistoryService !== 'undefined' && eventHistoryService.getMaxEventId) ? eventHistoryService.getMaxEventId() : 0;
        return 'evt-' + (max + 1);
    }

    function _saveMeta(meta) {
        if (typeof eventHistoryService !== 'undefined' && eventHistoryService.saveMeta) {
            eventHistoryService.saveMeta(meta);
        }
        if (typeof memoryRecall !== 'undefined' && memoryRecall._refreshAliasMap) {
            memoryRecall._refreshAliasMap(meta);
        }
    }

    // 删 L0 向量 → 下一轮 _syncEmbeddingsWithSummaryHistory 自愈
    function _dropL0Vector(id) {
        if (typeof storageService !== 'undefined' && storageService.deleteEmbedding) storageService.deleteEmbedding(id);
        if (typeof memoryRecall !== 'undefined' && memoryRecall.removeFromCache) memoryRecall.removeFromCache(id);
    }

    // 删 L2 向量 → 下一轮 _syncL2EmbeddingsWithEventHistory 自愈 + 词法索引增量清理
    function _dropL2Vector(id) {
        if (typeof storageService !== 'undefined' && storageService.deleteL2Embedding) storageService.deleteL2Embedding(id);
        if (typeof memoryRecall !== 'undefined' && memoryRecall.removeFromCacheL2) memoryRecall.removeFromCacheL2(id);
    }

    // =========================================================================
    // 删除
    // =========================================================================

    function remove(type, key) {
        _rememberListScroll();
        try {
            if (type === 'summary') {
                var s0 = _findSummary(key);
                if (!confirm('删除这条碎片日记？\n\n' + ((s0 && s0.summaryText) || '').slice(0, 60))) return;
                var list = summaryHistoryService.getAll();
                summaryHistoryService.save(list.filter(function(s) { return s.id !== key; }));
                _dropL0Vector(key);
            } else if (type === 'event') {
                var all = eventHistoryService.getAll();
                var refs = all.filter(function(e) { return e.causedBy && e.causedBy.indexOf(key) !== -1; });
                if (refs.length > 0) {
                    if (!confirm('该事件被 ' + refs.length + ' 条事件引用为前因：' + refs.map(function(r) { return r.id; }).join('、') + '\n删除后这些引用将失效（不会崩溃，只是不再显示）。仍要删除？')) return;
                } else {
                    if (!confirm('删除事件 ' + key + '？')) return;
                }
                eventHistoryService.save(all.filter(function(e) { return e.id !== key; }));
                _dropL2Vector(key);
            } else if (type === 'fact') {
                if (!confirm('删除事实 ' + key + '？')) return;
                var meta = eventHistoryService.getMeta();
                delete meta.facts[key];
                _saveMeta(meta);
            } else if (type === 'arc') {
                if (!confirm('删除弧光 ' + key + '？')) return;
                var meta2 = eventHistoryService.getMeta();
                delete meta2.arcs[key];
                _saveMeta(meta2);
            } else if (type === 'week') {
                var wlist = weekHistoryService.getAll();
                var mw = Number(key);
                var wItems = wlist.filter(function(x) { return (x.markWeek || x.week || 1) === mw; });
                if (wItems.length === 0) return;
                if (!confirm('删除 markWeek=' + key + ' 的周总结？' + (wItems.length > 1 ? '（该周共 ' + wItems.length + ' 条记录，将全部删除）' : ''))) return;
                weekHistoryService.save(wlist.filter(function(x) { return (x.markWeek || x.week || 1) !== mw; }));
            } else {
                return;
            }
            console.log('[MemoryEditor] 已删除 ' + type + ': ' + key);
            if (typeof showModal === 'function') showModal('已删除');
            render();
        } catch (e) {
            console.error('[MemoryEditor] 删除失败:', e);
            if (typeof showModal === 'function') showModal('删除失败：' + (e && e.message || e));
        }
    }

    return {
        open: open,
        close: close,
        switchTab: switchTab,
        edit: edit,
        save: save,
        cancelEdit: cancelEdit,
        remove: remove
    };
})();
