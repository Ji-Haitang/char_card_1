/* ============================================================================
 * dialog-panel.js — 视窗内三栏面板弹窗的共享挂载助手
 *
 * 复刻 module/inventory-panel.js 的 size()/Escape/Tab/关闭委托逻辑，供
 * 查看技能 / 技能习得 / 交易 三个弹窗复用，避免各弹窗重复实现几何填充。
 *
 * 用法：
 *   const panel = DialogPanel.mount(document.getElementById('my-modal'));
 *   panel.modal.addEventListener('click', e => { /* 处理 tabs/items/actions *\/ });
 *   panel.open(document.activeElement);   // 记录 opener 用于关闭后还焦
 *   panel.close();
 * ========================================================================== */
(function () {
    'use strict';

    function mount(modal) {
        const viewport = document.getElementById('main-viewport');
        if (!modal || !viewport) return null;
        if (modal.__dp) return modal.__dp;

        viewport.appendChild(modal);

        const api = { modal, viewport, opener: null };

        // 绝对定位按 padding box 填充；含 viewport 边框宽，恰好填满不多不少。
        api.size = function () {
            const s = getComputedStyle(viewport);
            const left = parseFloat(s.borderLeftWidth) || 0, top = parseFloat(s.borderTopWidth) || 0;
            const right = parseFloat(s.borderRightWidth) || 0, bottom = parseFloat(s.borderBottomWidth) || 0;
            modal.style.left = -left + 'px';
            modal.style.top = -top + 'px';
            modal.style.width = `calc(100% + ${left + right}px)`;
            modal.style.height = `calc(100% + ${top + bottom}px)`;
            modal.style.setProperty('--panel-font', Math.max(11, Math.min(22, viewport.clientWidth / 42)) + 'px');
        };

        api.isOpen = function () { return modal.style.display === 'block'; };
        api.open = function (openerEl) {
            api.opener = (openerEl && openerEl.isConnected) ? openerEl : null;
            api.size();
            modal.style.display = 'block';
        };
        api.close = function () {
            modal.style.display = 'none';
            if (api.opener && api.opener.isConnected) {
                try { api.opener.focus({ preventScroll: true }); } catch (_) {}
            }
            api.opener = null;
        };

        modal.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') { event.preventDefault(); api.close(); }
            if (event.key === 'Tab') {
                const buttons = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')].filter(el => el.getClientRects().length);
                if (!buttons.length) return;
                const first = buttons[0], last = buttons[buttons.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
        });

        // 统一退出按钮委托：任何 [data-dialog-close] 点击即关闭。
        modal.addEventListener('click', function (event) {
            if (event.target.closest('[data-dialog-close]')) api.close();
        });

        new ResizeObserver(api.size).observe(viewport);

        modal.__dp = api;
        return api;
    }

    window.DialogPanel = Object.freeze({ mount });
})();
