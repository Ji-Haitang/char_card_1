/**
 * event-history-service.js - L2 剧情事件层存储（向量化方案优化2）
 *
 * 维护两块持久化数据（均随快照/存档回滚）：
 *  1. eventHistory：逐事件结构化记录数组（每条含事件级 keywords）
 *  2. eventMeta：批次级滚动状态（角色弧光 arcs + SPO 世界事实 facts）
 *
 * 事件记录字段：
 *  { id:'evt-N', week, timeLabel, description, uiStart, uiEnd,
 *    causedBy:[], npc:[], location, title, keywords:[], source, createdAt }
 *  uiStart/uiEnd 为 uiConversation 总数组下标（整数，含 user 条目）。
 *
 * runSummary / weekHistory 完全不受影响，本模块为纯增量旁路。
 *
 * 依赖：storageService（在本文件之前加载）
 */

var eventHistoryService = (function() {

    // =========================================================================
    // eventHistory（逐事件记录数组）
    // =========================================================================

    function load() {
        if (typeof storageService !== 'undefined' && storageService.loadEventHistory) {
            return storageService.loadEventHistory();
        }
        try {
            var raw = localStorage.getItem('jxz_eventHistory');
            if (!raw || raw === 'undefined' || raw === 'null') return [];
            return JSON.parse(raw) || [];
        } catch (e) { return []; }
    }

    function save(history) {
        if (typeof storageService !== 'undefined' && storageService.saveEventHistory) {
            storageService.saveEventHistory(history);
            return;
        }
        try { localStorage.setItem('jxz_eventHistory', JSON.stringify(history)); } catch (e) {}
    }

    function getAll() { return load(); }

    function importAll(arr) {
        save(Array.isArray(arr) ? arr.slice() : []);
    }

    function clear() { save([]); }

    /**
     * 解析 'evt-N' → 数值 N（解析失败返回 0）
     */
    function _parseEventNum(id) {
        if (!id) return 0;
        var m = String(id).match(/(\d+)\s*$/);
        return m ? parseInt(m[1], 10) : 0;
    }

    /**
     * 当前 eventHistory 中最大事件号（跨窗连续 id 用）。空则返回 0。
     */
    function getMaxEventId() {
        var history = load();
        var max = 0;
        for (var i = 0; i < history.length; i++) {
            var n = _parseEventNum(history[i].id);
            if (n > max) max = n;
        }
        return max;
    }

    /**
     * 取最近事件：uiEnd >= minUiEnd 的已入库事件（用于回灌 causedBy + 去重）
     * @param {number} minUiEnd - total index 阈值
     */
    function getRecentEvents(minUiEnd) {
        var history = load();
        var threshold = typeof minUiEnd === 'number' ? minUiEnd : 0;
        return history.filter(function(e) {
            return typeof e.uiEnd === 'number' && e.uiEnd >= threshold;
        });
    }

    /**
     * 批量追加事件记录（按 id 去重，已存在则替换）
     * @param {Array} events
     */
    function appendEvents(events) {
        if (!Array.isArray(events) || events.length === 0) return load();
        var history = load();
        var byId = {};
        for (var i = 0; i < history.length; i++) byId[history[i].id] = i;
        for (var j = 0; j < events.length; j++) {
            var ev = events[j];
            if (!ev || !ev.id) continue;
            if (byId[ev.id] != null) {
                history[byId[ev.id]] = ev;
            } else {
                byId[ev.id] = history.length;
                history.push(ev);
            }
        }
        // 按 uiEnd 升序保持有序（便于召回/挂载遍历）
        history.sort(function(a, b) {
            var ea = typeof a.uiEnd === 'number' ? a.uiEnd : 0;
            var eb = typeof b.uiEnd === 'number' ? b.uiEnd : 0;
            if (ea !== eb) return ea - eb;
            return _parseEventNum(a.id) - _parseEventNum(b.id);
        });
        save(history);
        console.log('[EventHistory] 追加 ' + events.length + ' 条事件，当前共 ' + history.length + ' 条');
        return history;
    }

    /**
     * 构建一条事件的向量化文本（地点/NPC 前缀 + 时间标签 + 描述）。
     * 格式与 L0 对齐，使两层向量落在同一语义空间。
     */
    function buildEventEmbedText(event) {
        if (!event) return '';
        var prefix = '';
        if (event.location) prefix += '地点：' + event.location + '\n';
        if (Array.isArray(event.npc) && event.npc.length > 0) {
            prefix += '在场NPC：' + event.npc.join('、') + '\n';
        }
        var body = '';
        if (event.timeLabel) body += '[' + event.timeLabel + '] ';
        body += (event.description || '');
        return prefix + body;
    }

    // =========================================================================
    // eventMeta（批次级滚动状态：arcs + facts）
    // =========================================================================

    function _defaultMeta() { return { arcs: {}, facts: {}, aliases: {} }; }

    function loadMeta() {
        var meta = null;
        if (typeof storageService !== 'undefined' && storageService.loadEventMeta) {
            meta = storageService.loadEventMeta();
        } else {
            try {
                var raw = localStorage.getItem('jxz_eventMeta');
                meta = raw && raw !== 'undefined' && raw !== 'null' ? JSON.parse(raw) : null;
            } catch (e) { meta = null; }
        }
        if (!meta || typeof meta !== 'object') return _defaultMeta();
        if (!meta.arcs) meta.arcs = {};
        if (!meta.facts) meta.facts = {};
        if (!meta.aliases) meta.aliases = {};
        return meta;
    }

    function saveMeta(meta) {
        var m = (meta && typeof meta === 'object') ? meta : _defaultMeta();
        if (typeof storageService !== 'undefined' && storageService.saveEventMeta) {
            storageService.saveEventMeta(m);
            return;
        }
        try { localStorage.setItem('jxz_eventMeta', JSON.stringify(m)); } catch (e) {}
    }

    function getMeta() { return loadMeta(); }

    // 非状态类（isState=false）客观事实：每个主体最多保留多少条，超出按 _addedAt LRU 淘汰最旧
    var FACTS_LIMIT_PER_SUBJECT = 10;
    // 角色弧光 trajectory FIFO 上限
    var ARC_TRAJ_MAX = 20;

    /**
     * 应用批次级增量到滚动状态 eventMeta（代码侧合并，不劳 LLM）。
     * - arcs： trajectory 改为 FIFO 数组（最多 ARC_TRAJ_MAX 条），LLM 每次输出的新阶段追加到数组尾部，相邻重复则跳过；
     *   progress/newMoment 仍直接覆盖，_addedAt 刷新为最近活跃
     * - facts：按 s+p 覆盖 o/isState/trend；{retracted:true} 删除该键；首建记 _addedAt，覆盖时保留
     * - 淘汰：仅对 isState=false 的客观事实，每个主体超过上限按 _addedAt 删最旧（关系/态度状态永不淘汰）
     * @param {{arcUpdates?:Array, factUpdates?:Array}} updates
     * @param {number} [floor] - 本批的楼层号（total index），作为 _addedAt 时间戳
     */
    function applyMetaUpdates(updates, floor) {
        if (!updates) return loadMeta();
        var meta = loadMeta();
        var fl = typeof floor === 'number' ? floor : 0;
        var arcUpdates = Array.isArray(updates.arcUpdates) ? updates.arcUpdates : [];
        var factUpdates = Array.isArray(updates.factUpdates) ? updates.factUpdates : [];
        var aliasUpdates = Array.isArray(updates.aliasUpdates) ? updates.aliasUpdates : [];

        for (var i = 0; i < arcUpdates.length; i++) {
            var a = arcUpdates[i];
            if (!a || !a.name) continue;
            var prevArc = meta.arcs[a.name];
            // 兴导迁移：老存档单字符串格式自动包装成数组
            var prevTraj = (prevArc && Array.isArray(prevArc.trajectory))
                ? prevArc.trajectory
                : (prevArc && prevArc.trajectory ? [String(prevArc.trajectory)] : []);
            var newEntry = (a.trajectory != null) ? String(a.trajectory).trim() : '';
            var updatedTraj;
            if (newEntry) {
                // 相邻重复则跳过，防止 LLM 复读同一阶段
                if (prevTraj.length > 0 && prevTraj[prevTraj.length - 1] === newEntry) {
                    updatedTraj = prevTraj;
                } else {
                    updatedTraj = prevTraj.concat([newEntry]);
                    if (updatedTraj.length > ARC_TRAJ_MAX) updatedTraj = updatedTraj.slice(updatedTraj.length - ARC_TRAJ_MAX);
                }
            } else {
                updatedTraj = prevTraj;
            }
            meta.arcs[a.name] = {
                trajectory: updatedTraj,
                progress: typeof a.progress === 'number' ? a.progress : (prevArc && prevArc.progress) || 0,
                newMoment: a.newMoment != null ? a.newMoment : '',
                _addedAt: fl  // 弧光按"最近活跃"刷新，供注入时排序
            };
        }

        for (var j = 0; j < factUpdates.length; j++) {
            var f = factUpdates[j];
            if (!f || !f.s || !f.p) continue;
            var key = f.s + '|' + f.p;
            if (f.retracted === true) {
                delete meta.facts[key];
                continue;
            }
            var prevFact = meta.facts[key];
            meta.facts[key] = {
                o: f.o != null ? f.o : '',
                isState: !!f.isState,
                trend: f.trend != null ? f.trend : (prevFact && prevFact.trend) || undefined,
                // 首次建立记当前 floor，后续覆盖保留首建时间戳（淘汰以"建立早晚"为准）
                _addedAt: (prevFact && typeof prevFact._addedAt === 'number') ? prevFact._addedAt : fl
            };
        }

        // 容量淘汰：仅统计 isState=false 的客观事实，按主体分组，超额删最旧
        var evicted = 0;
        var bySubject = {};
        var allKeys = Object.keys(meta.facts);
        for (var k = 0; k < allKeys.length; k++) {
            var fo = meta.facts[allKeys[k]];
            if (fo && fo.isState) continue;  // 关系/态度状态豁免淘汰
            var subj = allKeys[k].split('|')[0];
            (bySubject[subj] = bySubject[subj] || []).push(allKeys[k]);
        }
        var subjects = Object.keys(bySubject);
        for (var s = 0; s < subjects.length; s++) {
            var keys = bySubject[subjects[s]];
            if (keys.length > FACTS_LIMIT_PER_SUBJECT) {
                keys.sort(function(k1, k2) {
                    return (meta.facts[k1]._addedAt || 0) - (meta.facts[k2]._addedAt || 0);
                });
                var removeN = keys.length - FACTS_LIMIT_PER_SUBJECT;
                for (var ri = 0; ri < removeN; ri++) {
                    delete meta.facts[keys[ri]];
                    evicted++;
                }
            }
        }

        if (!meta.aliases) meta.aliases = {};
        for (var ai = 0; ai < aliasUpdates.length; ai++) {
            var au = aliasUpdates[ai];
            if (!au || !au.alias || !au.canonical) continue;
            meta.aliases[String(au.alias).trim()] = String(au.canonical).trim();
        }

        saveMeta(meta);
        if (arcUpdates.length > 0 || factUpdates.length > 0 || evicted > 0 || aliasUpdates.length > 0) {
            console.log('[EventHistory] eventMeta 已合并 arcs+' + arcUpdates.length + ' facts+' + factUpdates.length +
                ' aliases+' + aliasUpdates.length +
                (evicted > 0 ? '（淘汰旧背景事实 ' + evicted + ' 条）' : ''));
        }
        return meta;
    }

    function importMeta(meta) {
        if (!meta || typeof meta !== 'object') { saveMeta(_defaultMeta()); return; }
        saveMeta({ arcs: meta.arcs || {}, facts: meta.facts || {}, aliases: meta.aliases || {} });
    }

    function clearMeta() { saveMeta(_defaultMeta()); }

    // 简易 token 估算：中文按 1，其它按 1/4
    function _estimateTokens(s) {
        if (!s) return 0;
        s = String(s);
        var zh = (s.match(/[\u4e00-\u9fff]/g) || []).length;
        return Math.ceil(zh + (s.length - zh) / 4);
    }

    // 从关系谓词"对X的…"解析关系目标 X
    function _parseRelationTarget(p) {
        var m = String(p || '').match(/^对(.+?)的/);
        return m ? m[1] : '';
    }

    var ARC_TOKEN_BUDGET = 800;    // 弧光基线 token 预算
    var FACT_TOKEN_BUDGET = 1500;  // 事实基线 token 预算

    /**
     * 构建回灌给 prompt 的基线文本，三道闸门防膨胀：
     *   ① 在场过滤：只注入本批对话文本中出现的实体（用 meta 内已有实体名自举匹配）；主角恒在场
     *   ② 完成退役：progress>=1 的弧光不再回灌（已定型，需要时靠事件召回）
     *   ③ token 预算：弧光/事实分别按 _addedAt 新→旧排序，填满预算即截断
     * @param {string} [batchText] - 本批对话全文（用于判定在场实体）；不传则不过滤（全量，仅保留完成退役+预算）
     * @returns {string}
     */
    function getMetaBaseline(batchText) {
        var meta = loadMeta();
        var text = String(batchText || '');
        var hasFilter = text.length > 0;

        // 构建"在场实体"集合：用已知实体名（arcs.name + facts.s）去本批文本匹配
        var focus = { '主角': true };  // 主角恒在场
        function markIfPresent(name) {
            var n = String(name || '').trim();
            if (n && n !== '主角' && text.indexOf(n) !== -1) focus[n] = true;
        }
        if (hasFilter) {
            var aAll = Object.keys(meta.arcs);
            for (var ai = 0; ai < aAll.length; ai++) markIfPresent(aAll[ai]);
            var fAll = Object.keys(meta.facts);
            for (var fi = 0; fi < fAll.length; fi++) markIfPresent(fAll[fi].split('|')[0]);
        }
        function inFocus(name) { return !hasFilter || !!focus[String(name || '').trim()]; }

        var lines = [];

        // ---- ① 角色弧光：在场 + 未完成(progress<1)，按最近活跃排序，预算截断 ----
        var arcNames = Object.keys(meta.arcs);
        var arcSkipDone = 0, arcSkipAbsent = 0;
        var arcCandidates = [];
        for (var i = 0; i < arcNames.length; i++) {
            var n = arcNames[i];
            var arc = meta.arcs[n];
            var prog = typeof arc.progress === 'number' ? arc.progress : 0;
            if (prog >= 1) { arcSkipDone++; continue; }
            if (!inFocus(n)) { arcSkipAbsent++; continue; }
            arcCandidates.push({ name: n, arc: arc, addedAt: arc._addedAt || 0 });
        }
        arcCandidates.sort(function(a, b) { return b.addedAt - a.addedAt; });
        var arcLines = [], arcUsed = 0;
        for (var ac = 0; ac < arcCandidates.length; ac++) {
            var c = arcCandidates[ac];
            var prg = (typeof c.arc.progress === 'number' ? c.arc.progress : 0).toFixed(2);
            // trajectory 可能是 FIFO 数组（新）或字符串（老存档兼容）
            var trajArr = Array.isArray(c.arc.trajectory) ? c.arc.trajectory
                : (c.arc.trajectory ? [String(c.arc.trajectory)] : []);
            var trajStr = trajArr.join(' → ');
            var ln = '- ' + c.name + '：' + (trajStr || '') + '（progress=' + prg + '）';
            var t = _estimateTokens(ln);
            if (arcUsed + t > ARC_TOKEN_BUDGET) break;
            arcLines.push(ln); arcUsed += t;
        }
        if (arcLines.length > 0) {
            lines.push('【角色弧光基线】（仅本批在场、进行中）');
            lines = lines.concat(arcLines);
        }

        // ---- 世界事实：相关性过滤（s 或关系目标在场）+ 新→旧排序 + 预算 ----
        var factKeys = Object.keys(meta.facts);
        var factSkipAbsent = 0;
        var factCandidates = [];
        for (var j = 0; j < factKeys.length; j++) {
            var fk = factKeys[j];
            var fact = meta.facts[fk];
            var parts = fk.split('|');
            var fs = parts[0], fp = parts[1] || '';
            var relTarget = _parseRelationTarget(fp);
            var relevant = inFocus(fs) || (relTarget && inFocus(relTarget));
            if (!relevant) { factSkipAbsent++; continue; }
            factCandidates.push({ s: fs, p: fp, fact: fact, addedAt: fact._addedAt || 0 });
        }
        factCandidates.sort(function(a, b) { return b.addedAt - a.addedAt; });
        var factLines = [], factUsed = 0;
        for (var fc = 0; fc < factCandidates.length; fc++) {
            var fd = factCandidates[fc];
            var trendStr = fd.fact.trend ? ('，trend=' + fd.fact.trend) : '';
            var ln2 = '- ' + fd.s + ' / ' + fd.p + ' → ' + (fd.fact.o || '') + trendStr;
            var t2 = _estimateTokens(ln2);
            if (factUsed + t2 > FACT_TOKEN_BUDGET) break;
            factLines.push(ln2); factUsed += t2;
        }
        if (factLines.length > 0) {
            lines.push('【世界事实基线】（仅本批相关）');
            lines = lines.concat(factLines);
        }

        // ---- 已记录别名：防止 LLM 重复输出已知 alias，无在场/预算限制（体量通常很小）----
        var aliasKeys = Object.keys(meta.aliases || {});
        if (aliasKeys.length > 0) {
            var aliasLines = [];
            for (var al = 0; al < aliasKeys.length; al++) {
                var aliasKey = aliasKeys[al];
                aliasLines.push('- ' + aliasKey + ' → ' + meta.aliases[aliasKey]);
            }
            lines.push('【已记录别名（勿重复输出）】');
            lines = lines.concat(aliasLines);
        }

        if (hasFilter) {
            console.log('[EventHistory] 基线注入：弧光 ' + arcLines.length + '/' + arcNames.length +
                '（跳过 完成' + arcSkipDone + '、未出场' + arcSkipAbsent + '）| 事实 ' + factLines.length + '/' + factKeys.length +
                '（跳过 不相关' + factSkipAbsent + '）| 别名 ' + aliasKeys.length + ' 条 | 在场实体 ' + Object.keys(focus).length + ' 个');
        }

        return lines.join('\n');
    }

    return {
        // eventHistory
        load: load,
        save: save,
        getAll: getAll,
        importAll: importAll,
        clear: clear,
        getMaxEventId: getMaxEventId,
        getRecentEvents: getRecentEvents,
        appendEvents: appendEvents,
        buildEventEmbedText: buildEventEmbedText,
        // eventMeta
        loadMeta: loadMeta,
        saveMeta: saveMeta,
        getMeta: getMeta,
        applyMetaUpdates: applyMetaUpdates,
        importMeta: importMeta,
        clearMeta: clearMeta,
        getMetaBaseline: getMetaBaseline
    };
})();
