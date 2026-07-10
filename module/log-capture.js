/**
 * log-capture.js - 轻量控制台日志拦截器
 *
 * 拦截 console.log，按前缀分流到内存环形缓冲区（各保留最近 20 条），
 * 供"历史管理-日志查看"弹窗的"每周总结日志"/"事件总结日志"标签页展示。
 * 每周总结日志 = [SummaryRunner] + [WeekHistory]；事件总结日志 = [EventRunner] + [EventHistory]。
 * 不修改 console.log 原有行为（原样透传），仅额外做一次前缀匹配 + 缓冲。
 *
 * 依赖：无（应尽早加载，越早越能捕获到启动阶段的日志）
 */

(function() {
    var MAX_LINES = 20;

    window._summaryRunnerLogs = window._summaryRunnerLogs || [];
    window._eventRunnerLogs = window._eventRunnerLogs || [];

    function _stringifyArg(a) {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch (e) { return String(a); }
    }

    function _pushLine(buffer, line) {
        buffer.push(line);
        if (buffer.length > MAX_LINES) buffer.shift();
    }

    var _origLog = console.log;
    console.log = function() {
        try {
            var first = arguments[0];
            if (typeof first === 'string') {
                var isSummary = (first.indexOf('[SummaryRunner]') === 0 || first.indexOf('[WeekHistory]') === 0);
                var isEvent = (first.indexOf('[EventRunner]') === 0 || first.indexOf('[EventHistory]') === 0);
                if (isSummary || isEvent) {
                    var parts = [];
                    for (var i = 0; i < arguments.length; i++) parts.push(_stringifyArg(arguments[i]));
                    var line = parts.join(' ');
                    _pushLine(isSummary ? window._summaryRunnerLogs : window._eventRunnerLogs, line);
                }
            }
        } catch (e) { /* 拦截失败不影响原有日志输出 */ }
        return _origLog.apply(console, arguments);
    };
})();
