/**
 * prompt-overrides.js - 提示词自定义覆盖层
 *
 * 用户在"系统设置-游戏设置-提示词管理"里编辑保存的 prompt 内容，
 * 全局存储（不随存档走，所有存档共用），持久化委托给 storageService。
 *
 * 依赖：storage-service.js
 */

var promptOverrides = (function() {

    /**
     * 获取某个 prompt 条目的当前生效内容
     * @param {string} key - 覆盖 key，如 'CORE_010'、'NPC_ANMU'、'LOCATION_伊州'
     * @param {string} fallback - 未被覆盖时的默认内容（原始常量）
     * @returns {string}
     */
    function get(key, fallback) {
        if (typeof storageService === 'undefined') return fallback;
        var all = storageService.loadPromptOverrides();
        return (all && Object.prototype.hasOwnProperty.call(all, key)) ? all[key] : fallback;
    }

    /**
     * 是否存在覆盖（用于 UI 显示"已自定义"标记）
     */
    function has(key) {
        if (typeof storageService === 'undefined') return false;
        var all = storageService.loadPromptOverrides();
        return !!(all && Object.prototype.hasOwnProperty.call(all, key));
    }

    /**
     * 保存/更新覆盖内容
     */
    function set(key, text) {
        if (typeof storageService === 'undefined') return;
        storageService.savePromptOverride(key, text);
    }

    /**
     * 删除覆盖，恢复默认
     */
    function reset(key) {
        if (typeof storageService === 'undefined') return;
        storageService.resetPromptOverride(key);
    }

    return {
        get: get,
        has: has,
        set: set,
        reset: reset
    };
})();
