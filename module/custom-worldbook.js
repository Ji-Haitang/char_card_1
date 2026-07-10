/**
 * custom-worldbook.js - 用户自定义世界书
 *
 * 在"系统设置-游戏设置-提示词管理"里创建的自定义世界书条目：
 * 名称 + 关键词（可留空） + 内容 + 启用开关。
 * 全局存储（不随存档走，所有存档共用），持久化委托给 storageService。
 * 匹配逻辑与 worldbookEngine.matchNPCs 一致：在本次用户输入 + 上一次 AI 回复中找关键词，
 * 关键词留空则只看启用开关。
 *
 * 支持两个独立分类（slot）：
 *   slot '1'：插入位置为 </UserInfo> 与 ] 之间（主角信息之后）
 *   slot '2'：插入位置为 </fresh> 与 <user_input> 之间（防止重复要求之后）
 * 两个分类的条目各自独立存储、独立排序，互不影响。
 *
 * 依赖：storage-service.js
 */

var customWorldbook = (function() {

    function getAll(slot) {
        if (typeof storageService === 'undefined') return [];
        return storageService.loadCustomWorldbook(slot);
    }

    function _persist(slot, list) {
        if (typeof storageService === 'undefined') return;
        storageService.saveCustomWorldbook(slot, list);
    }

    /**
     * 新建或更新一条世界书条目
     * @param {string} slot - '1' 或 '2'
     * @param {object} entry - { id?: string, name, keywords, content, enabled }
     * @returns {object} 保存后的条目
     */
    function upsert(slot, entry) {
        entry = entry || {};
        var list = getAll(slot).slice();

        if (entry.id) {
            for (var i = 0; i < list.length; i++) {
                if (list[i].id === entry.id) {
                    list[i] = {
                        id: entry.id,
                        name: entry.name || '',
                        keywords: entry.keywords || '',
                        content: entry.content || '',
                        enabled: entry.enabled !== false
                    };
                    _persist(slot, list);
                    return list[i];
                }
            }
        }

        // 新建：新的排在最前面
        var newEntry = {
            id: 'wb_' + Date.now() + '_' + Math.floor(Math.random() * 100000),
            name: entry.name || '',
            keywords: entry.keywords || '',
            content: entry.content || '',
            enabled: entry.enabled !== false
        };
        list.unshift(newEntry);
        _persist(slot, list);
        return newEntry;
    }

    function remove(slot, id) {
        var list = getAll(slot).filter(function(e) { return e.id !== id; });
        _persist(slot, list);
    }

    /**
     * 按给定 id 顺序重新排序
     */
    function reorder(slot, orderedIds) {
        var list = getAll(slot);
        var map = {};
        for (var i = 0; i < list.length; i++) map[list[i].id] = list[i];
        var next = [];
        for (var j = 0; j < orderedIds.length; j++) {
            if (map[orderedIds[j]]) { next.push(map[orderedIds[j]]); delete map[orderedIds[j]]; }
        }
        // 兆底：遗漏的条目追加到末尾
        for (var k = 0; k < list.length; k++) {
            if (map[list[k].id]) next.push(list[k]);
        }
        _persist(slot, next);
    }

    function _splitKeywords(raw) {
        if (!raw) return [];
        return raw.split(/[,，\n]/).map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });
    }

    /**
     * 匹配需要注入的世界书条目内容（顺序 = 保存顺序，即"新的在上面"）
     * @param {string} slot - '1' 或 '2'
     * @param {string} userInput - 本次用户输入
     * @param {string} lastAIReply - 上一次 AI 完整回复
     * @returns {Array<string>} 匹配到的条目内容数组
     */
    function match(slot, userInput, lastAIReply) {
        var list = getAll(slot);
        var searchText = (userInput || '') + (lastAIReply || '');
        var result = [];
        for (var i = 0; i < list.length; i++) {
            var e = list[i];
            if (!e || e.enabled === false) continue;
            var kws = _splitKeywords(e.keywords);
            if (kws.length === 0) {
                result.push(e.content);
                continue;
            }
            for (var k = 0; k < kws.length; k++) {
                if (searchText.indexOf(kws[k]) !== -1) { result.push(e.content); break; }
            }
        }
        return result;
    }

    return {
        getAll: getAll,
        upsert: upsert,
        remove: remove,
        reorder: reorder,
        match: match
    };
})();
