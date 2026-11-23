/** Cached M2a replay in the existing portrait text view. Read-only source/DOM projection. */
var speechInlinePlayer = (function () {
    'use strict';
    var serial = 0,
        active = null,
        last = null;
    function owner() {
        return mediaContext.workspaceId();
    }
    function key() {
        return JSON.stringify([
            owner(),
            currentStoryText,
            currentPage,
            isStoryExpanded,
            typeof storyHistoryOffset === 'undefined' ? 0 : storyHistoryOffset,
            GameMode,
            document.body.classList.contains('layout-landscape'),
        ]);
    }
    function portrait() {
        return (
            document.body.classList.contains('layout-portrait') &&
            !document.body.classList.contains('layout-landscape')
        );
    }
    function turns() {
        return storageService.loadUIConversation().filter(function (m) {
            return m && m.role === 'assistant' && typeof m.content === 'string' && m.content.trim();
        });
    }
    function selected(view) {
        var list = turns();
        return list[list.length - 1 - (view.expanded ? view.historyOffset : 0)] || null;
    }
    function stamp(record) {
        return record
            ? JSON.stringify([record.id, record.content, record.createdAt, record.singleSpeech])
            : '';
    }
    // Structural fingerprint without cloning/loading HTML resources. Only our own wrapper is transparent.
    function signature(root, wrapper) {
        function visit(node) {
            if (node === wrapper) return Array.from(node.childNodes).flatMap(visit);
            if (node.nodeType !== 1) return [[node.nodeType, node.nodeValue]];
            return [
                [
                    node.nodeName,
                    Array.from(node.attributes, (a) => [a.name, a.value]).sort(),
                    Array.from(node.childNodes).flatMap(visit),
                ],
            ];
        }
        return JSON.stringify(Array.from(root.childNodes).flatMap(visit));
    }
    function valid(op) {
        return (
            active === op &&
            op.ticket === serial &&
            !document.hidden &&
            portrait() &&
            op.root.isConnected &&
            document.getElementById('story-text') === op.root &&
            key() === op.key &&
            stamp(selected(op.view)) === op.recordStamp &&
            signature(op.root, op.node) === op.signature
        );
    }
    function status(text) {
        var root = document.getElementById('story-text'),
            node = document.getElementById('speech-replay-status');
        if (!root) return;
        if (!node) {
            node = document.createElement('div');
            node.id = 'speech-replay-status';
            node.setAttribute('role', 'status');
            root.after(node);
        }
        node.textContent = text || '';
        node.hidden = !text;
    }
    function invalidate() {
        serial++;
        var previous = active;
        active = null;
        if (speechPlayer.getState().view === 'inline-replay') speechPlayer.stop();
        if (previous && previous.node && previous.node.parentNode) {
            previous.node.replaceWith.apply(previous.node, Array.from(previous.node.childNodes));
        }
        status('');
    }
    function template(html) {
        var node = document.createElement('template');
        node.innerHTML = html;
        return node;
    }
    function canonical(html) {
        return template(html).innerHTML;
    }
    function markdown(html) {
        return window
            .markdownit({ html: html, breaks: true, linkify: true, typographer: true })
            .disable('strikethrough');
    }
    function paragraph(op, hit, pages) {
        var blocks = speechPlan.documentFor(op.record.content).blocks.map(function (b) {
            return {
                sourceLine: b.sourceLine,
                text: b.text.trim(),
                leading: b.text.length - b.text.trimStart().length,
            };
        });
        var bodyAt = 0;
        blocks.forEach(function (b) {
            b.start = bodyAt;
            b.end = bodyAt + b.text.length;
            bodyAt = b.end + 2;
        });
        var main = pages.filter(function (p) {
            return !p.event;
        });
        if (
            main
                .map(function (p) {
                    return p.text;
                })
                .join('\n\n') !==
            blocks
                .map(function (b) {
                    return b.text;
                })
                .join('\n\n')
        )
            return null;
        var block = blocks.find(function (b) {
            return b.sourceLine === hit.unit.sourceLine;
        });
        if (
            !block ||
            hit.unit.start !== block.leading ||
            hit.unit.end !== block.leading + block.text.length ||
            hit.unit.text !== block.text
        )
            return null;
        var pageAt = 0,
            target = -1;
        pages.forEach(function (p, index) {
            if (!p.event) {
                p.start = pageAt;
                p.end = pageAt + p.text.length;
                if (block.start >= p.start && block.end <= p.end) target = index;
                pageAt = p.end + 2;
            }
        });
        if (target < 0 || (!op.view.expanded && target !== op.view.pageIndex)) return null;
        var selectedPages = op.view.expanded ? pages : [pages[op.view.pageIndex]];
        if (
            selectedPages.some(function (p) {
                return !p;
            }) ||
            canonical(
                selectedPages
                    .map(function (p) {
                        return p.html;
                    })
                    .join(''),
            ) !== op.root.innerHTML
        )
            return null;
        var domOffset = 0,
            elements = null;
        selectedPages.forEach(function (p) {
            var expected = template(p.html).content,
                dom = Array.from(op.root.children).slice(
                    domOffset,
                    domOffset + expected.children.length,
                );
            domOffset += expected.children.length;
            if (p === pages[target])
                elements = p.wrapped
                    ? dom.length === 1
                        ? Array.from(dom[0].children)
                        : null
                    : dom;
        });
        if (!elements) return null;
        var page = pages[target],
            parts = blocks.filter(function (b) {
                return b.start >= page.start && b.end <= page.end;
            });
        if (
            parts
                .map(function (b) {
                    return b.text;
                })
                .join('\n\n') !== page.text
        )
            return null;
        var md = markdown(page.htmlEnabled),
            html = parts.map(function (b) {
                return md.render(b.text);
            });
        var expectedPage = template(page.html).content,
            expectedInner = page.wrapped
                ? expectedPage.firstElementChild.innerHTML
                : canonical(page.html);
        if (canonical(html.join('')) !== expectedInner) return null;
        var offset = 0,
            result = null;
        parts.forEach(function (b, index) {
            var frag = template(html[index]).content;
            if (
                b === block &&
                frag.children.length === 1 &&
                frag.firstElementChild.tagName === 'P' &&
                !frag.firstElementChild.attributes.length &&
                Array.from(frag.childNodes).every(function (n) {
                    return (
                        n === frag.firstElementChild || (n.nodeType === 3 && !n.nodeValue.trim())
                    );
                })
            )
                result = elements[offset];
            offset += frag.children.length;
        });
        if (!result || result.tagName !== 'P' || result.attributes.length) return null;
        var allowed = [
            'STRONG',
            'EM',
            'B',
            'I',
            'U',
            'S',
            'CODE',
            'BR',
            'SMALL',
            'SUB',
            'SUP',
            'MARK',
        ];
        if (
            Array.from(result.querySelectorAll('*')).some(function (n) {
                return !allowed.includes(n.tagName) || n.attributes.length;
            })
        )
            return null;
        return result;
    }
    function paint(state) {
        var op = active;
        if (!op || !op.node) return;
        var mine =
            state.view === 'inline-replay' &&
            state.workspaceId === op.workspaceId &&
            state.turnId === op.hit.turnId &&
            state.unitId === op.hit.unitId;
        var phase = mine ? state.phase : 'idle';
        op.node.dataset.speechState = phase;
        op.node.setAttribute(
            'aria-pressed',
            phase === 'loading' || phase === 'playing' ? 'true' : 'false',
        );
        op.node.title = phase === 'playing' ? '点击停止本机录音' : '播放这句已有录音';
        if (mine && phase === 'error') status(state.message || '本机录音暂时无法播放。');
    }
    async function play(op) {
        if (!valid(op)) {
            if (active === op) invalidate();
            return;
        }
        if (pipeline.isStreaming() || speechService.isBusy()) {
            status('当前操作尚未完成，请稍后点播。');
            return;
        }
        var current = speechPlayer.getState();
        if (
            current.view === 'inline-replay' &&
            current.workspaceId === op.workspaceId &&
            current.turnId === op.hit.turnId &&
            current.unitId === op.hit.unitId &&
            ['loading', 'playing'].includes(current.phase)
        ) {
            speechPlayer.stop();
            return;
        }
        try {
            status('');
            await speechPlayer.play(
                async function () {
                    var fresh = await speechReplay.resolve({
                        record: op.record,
                        workspaceId: op.workspaceId,
                        characters: op.characters,
                    });
                    if (!valid(op)) throw new DOMException('阅读位置已改变', 'AbortError');
                    if (
                        !fresh ||
                        fresh.turnId !== op.hit.turnId ||
                        fresh.unitId !== op.hit.unitId ||
                        fresh.clip.cacheKey !== op.hit.clip.cacheKey
                    )
                        throw new Error('缓存已失效');
                    return fresh.clip.blob;
                },
                {
                    view: 'inline-replay',
                    workspaceId: op.workspaceId,
                    turnId: op.hit.turnId,
                    unitId: op.hit.unitId,
                },
            );
        } catch (error) {
            if (valid(op)) {
                if (error && error.name === 'NotAllowedError')
                    status('浏览器尚未允许声音，请再次点击这句台词播放。');
                else {
                    invalidate();
                    status('这句本机录音暂时无法播放，正文仍可正常阅读。');
                }
            }
        }
    }
    async function render(root, view) {
        invalidate();
        last = { root: root, view: structuredClone(view) };
        if (
            !root ||
            !root.isConnected ||
            !portrait() ||
            document.hidden ||
            view.source !== currentStoryText ||
            view.pageIndex !== currentPage ||
            view.expanded !== isStoryExpanded ||
            view.historyOffset !==
                (typeof storyHistoryOffset === 'undefined' ? 0 : storyHistoryOffset)
        )
            return;
        var record = selected(view);
        if (
            !record ||
            (!view.historyOffset && record.content !== view.source) ||
            storageService.loadUIConversation().filter(function (m) {
                return m && m.id === record.id;
            }).length !== 1 ||
            root.querySelector('.speech-replay-unit')
        )
            return;
        var op = {
            root: root,
            view: structuredClone(view),
            ticket: serial,
            workspaceId: owner(),
            key: key(),
            recordStamp: stamp(record),
            record: structuredClone({
                id: record.id,
                role: record.role,
                content: record.content,
                createdAt: record.createdAt,
                singleSpeech: record.singleSpeech,
            }),
            characters: Object.keys(npcs)
                .filter(function (id) {
                    return id !== 'USER';
                })
                .map(function (id) {
                    return { id: id, name: npcs[id].name };
                }),
            node: null,
        };
        op.signature = signature(root, null);
        active = op;
        try {
            var hit = await speechReplay.resolve({
                record: op.record,
                workspaceId: op.workspaceId,
                characters: op.characters,
            });
            if (!valid(op) || !hit) return;
            var pages = view.historyOffset
                    ? _buildHistoryPages(record.content, true)
                    : structuredClone(view.pages),
                p = paragraph(op, hit, pages);
            if (!valid(op) || !p) return;
            var node = document.createElement('span');
            node.className = 'speech-replay-unit';
            node.tabIndex = 0;
            node.setAttribute('role', 'button');
            node.setAttribute(
                'aria-label',
                '播放' + npcs[hit.unit.speakerId].name + '的已缓存台词',
            );
            node.setAttribute('aria-pressed', 'false');
            node.dataset.speechState = 'idle';
            node.title = '播放这句已有录音';
            while (p.firstChild) node.appendChild(p.firstChild);
            p.appendChild(node);
            op.node = node;
            op.hit = hit;
            var down = null,
                dragged = false;
            node.addEventListener('pointerdown', function (e) {
                down = { x: e.clientX, y: e.clientY };
                dragged = false;
            });
            node.addEventListener('pointermove', function (e) {
                if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) dragged = true;
            });
            node.addEventListener('pointercancel', function () {
                dragged = true;
                down = null;
            });
            node.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var selection = window.getSelection();
                if (
                    dragged ||
                    (selection && !selection.isCollapsed && root.contains(selection.anchorNode))
                )
                    return;
                play(op);
            });
            node.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    play(op);
                }
            });
            paint(speechPlayer.getState());
        } catch (_) {
            if (active === op) invalidate();
        }
    }
    function refresh() {
        return last ? render(last.root, last.view) : Promise.resolve();
    }
    speechPlayer.subscribe(paint);
    window.addEventListener('speech-cache-change', function (e) {
        if (e.detail && e.detail.workspaceId === owner()) refresh();
    });
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) invalidate();
        else refresh();
    });
    window.addEventListener('pagehide', invalidate);
    return { render: render, refresh: refresh, invalidate: invalidate };
})();

var speechPlaybackUI = Object.freeze({
    render: speechInlinePlayer.render,
    invalidate: speechInlinePlayer.invalidate,
});
