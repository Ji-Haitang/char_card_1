/* Main-game dialog presentation only. No game state, callbacks or visibility changes.
 * Explicit allowlist intentionally excludes API/config/prompt editor ownership.
 * Existing nodes are moved (never cloned), preserving IDs and event listeners.
 */
(function () {
    'use strict';
    const ids = new Set([
        'modal', 'difficulty-modal', 'game-settings-modal', 'cheat-modal',
        'pipeline-log-modal', 'history-summary-modal',
        'equipment-modal', 'item-detail-modal', 'trading-modal', 'shop-detail-modal',
        'bounty-modal', 'load-modal', 'save-list-modal', 'last-input-modal',
        'skill-library-modal', 'skill-equipment-modal', 'music-modal', 'font-modal',
        'side-quest-modal'
    ]);
    const frames = new Set(['worldmap-modal', 'blackjack-modal', 'battle-modal', 'farm-modal', 'alchemy-modal']);
    const headerSelector = 'h2,h3,.skill-modal-header,.pl-tabs';

    function prepare(modal) {
        if (!ids.has(modal.id)) return;
        const panel = Array.from(modal.children).find(el => el.classList.contains('modal-content'));
        if (!panel) return;
        modal.classList.add('game-dialog');
        // Escape the map's clipping/stacking context in both 2D and 3D modes.
        if (modal.parentElement !== document.body) document.body.appendChild(modal);
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        let body = Array.from(panel.children).find(el => el.classList.contains('game-dialog-body'));
        if (!body) {
            body = document.createElement('div');
            body.className = 'game-dialog-body';
            const children = Array.from(panel.childNodes);
            const header = children.find(el => el.nodeType === 1 && el.matches(headerSelector));
            const footer = children.find(el => el.nodeType === 1 && el.classList.contains('modal-buttons'));
            if (header) {
                header.classList.add('game-dialog-header');
                const title = header.matches('h2,h3') ? header : header.querySelector('h2,h3');
                if (title) {
                    if (!title.id) title.id = modal.id + '-dialog-title';
                    panel.setAttribute('aria-labelledby', title.id);
                }
            } else {
                panel.setAttribute('aria-label', modal.id === 'modal' ? '游戏提示' : '游戏面板');
            }
            if (footer) footer.classList.add('game-dialog-footer');
            children.forEach(el => { if (el !== header && el !== footer) body.appendChild(el); });
            panel.insertBefore(body, footer || null);
            // Load/import/export actions are content, not five rows of sticky footer.
            // Keep the original footer element/handlers, with only Close pinned.
            if (modal.id === 'load-modal' && footer) {
                const actions = document.createElement('div');
                actions.className = 'game-dialog-file-actions';
                Array.from(footer.children).forEach(el => {
                    if (!el.classList.contains('cancel')) actions.appendChild(el);
                });
                body.appendChild(actions);
            }
        }
        // Only legacy inline viewport-sized typography is normalized. Semantic
        // headings, labels, small print and class-based font hierarchy remain CSS-owned.
        panel.querySelectorAll('[style*="vw"], [style*="vmin"], [style*="vh"]').forEach(el => {
            if (/v(w|h|min|max)/.test(el.style.fontSize) && !el.hasAttribute('data-dialog-fluid-font')) {
                el.setAttribute('data-dialog-fluid-font', el.matches('h1,h2,h3') ? 'title' : 'body');
            }
        });
    }

    function updateViewport() {
        const v = window.visualViewport;
        const root = document.documentElement.style;
        root.setProperty('--game-dialog-vh', (v ? v.height : window.innerHeight) + 'px');
        root.setProperty('--game-dialog-vw', (v ? v.width : window.innerWidth) + 'px');
        root.setProperty('--game-dialog-top', (v ? v.offsetTop : 0) + 'px');
        root.setProperty('--game-dialog-left', (v ? v.offsetLeft : 0) + 'px');
    }
    function scan(root) {
        if (!(root instanceof Element)) return;
        if (ids.has(root.id)) prepare(root);
        root.querySelectorAll('.modal').forEach(prepare);
        const owner = root.closest('.game-dialog');
        if (owner) prepare(owner);
    }
    function start() {
        updateViewport();
        scan(document.body);
        frames.forEach(id => {
            const frame = document.getElementById(id);
            if (frame) {
                frame.classList.add('game-frame-dialog');
                // Keep mini-game shells inside #main-viewport so their iframe is
                // exactly the viewport rectangle; moving them to body breaks the
                // host scene coordinate system on phones.
            }
        });
        // Observe child insertions only: fitModalToViewport's inline style writes
        // and our own class/ARIA annotations must not cause a mutation loop.
        new MutationObserver(records => {
            const roots = new Set();
            records.forEach(record => {
                if (record.target instanceof Element && record.target.closest('.game-dialog')) roots.add(record.target);
                record.addedNodes.forEach(node => { if (node instanceof Element) roots.add(node); });
            });
            roots.forEach(scan);
        }).observe(document.body, { childList: true, subtree: true });
        window.addEventListener('resize', updateViewport, { passive: true });
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', updateViewport, { passive: true });
            window.visualViewport.addEventListener('scroll', updateViewport, { passive: true });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
}());
