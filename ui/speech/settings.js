/** M3 opt-in and local pending-round decisions. Original settings and pipeline own the work. */
var speechRoundUI = (function () {
    'use strict';
    function owner() {
        return mediaContext.workspaceId();
    }
    async function mount(root, workspaceId, current) {
        if (!root) return;
        root.textContent = '读取整轮朗读…';
        try {
            var prefs = await speechRound.preferences(workspaceId),
                draft = await speechRound.load(workspaceId);
            current();
            if (!root.isConnected) return;
            root.innerHTML =
                '<h4>Drama 3整轮朗读（横屏阅卷）</h4><p>同一主回复标记每段归属，声音准备完成后按原回合流程提交并展示。每轮最多24个NPC片段、3000字；旁白与玩家不朗读。</p>' +
                '<label><input type="checkbox" id="sr-enabled"> 后续正文启用整轮朗读</label><button type="button" class="modal-btn" id="sr-save">保存整轮选择</button>' +
                '<p id="sr-status" role="status"></p><div id="sr-pending" hidden><p id="sr-description"></p><p id="sr-error"></p>' +
                '<button type="button" class="modal-btn" id="sr-resume">继续准备</button><button type="button" class="modal-btn" id="sr-silent">本轮无声继续</button><button type="button" class="modal-btn" id="sr-discard">放弃待办</button></div>';
            var $ = function (id) {
                return root.querySelector('#' + id);
            };
            $('sr-enabled').checked = prefs.enabled;
            function available() {
                current();
                if (!root.isConnected || owner() !== workspaceId)
                    throw new Error('工作区或设置页已经切换');
                if (mediaContext.isBusy()) throw new Error('请先完成或停止当前准备');
            }
            $('sr-save').onclick = async function () {
                try {
                    available();
                    var enabled = $('sr-enabled').checked;
                    if (
                        enabled &&
                        !prefs.enabled &&
                        !confirm(
                            '开启后，后续每轮会使用Fish Drama 3为已绑定NPC生成语音，按实际发送的台词＋表现描述UTF-8字节计费；最多24片段/3000字不是费用保证。确认开启？',
                        )
                    ) {
                        $('sr-enabled').checked = false;
                        return;
                    }
                    prefs = await speechRound.savePreferences({ enabled: enabled }, workspaceId);
                    current();
                    $('sr-status').textContent = enabled
                        ? '已开启后续整轮朗读；现有正文不补生成。'
                        : '已关闭后续整轮朗读；已有待办仍可明确处理。';
                } catch (error) {
                    if (root.isConnected) $('sr-status').textContent = error.message;
                }
            };
            if (speechRound.pending(draft)) {
                var phases = {
                    draft: '待处理',
                    preparing: '准备中',
                    paused: '已暂停',
                    ready: '可发布',
                    committing: '提交待核对',
                };
                $('sr-pending').hidden = false;
                $('sr-description').textContent =
                    '待办状态：' +
                    (phases[draft.phase] || draft.phase) +
                    '；' +
                    (draft.plan && draft.plan.units ? draft.plan.units.length : 0) +
                    '个候选语音片段。';
                $('sr-error').textContent = draft.error || '';
                var evidence = storageService.loadUIConversation().filter(function (m) {
                    return m && m.roundSpeech && m.roundSpeech.draftId === draft.id;
                });
                var reconcile =
                    draft.phase === 'committing' &&
                    evidence.length === 1 &&
                    evidence[0].content === draft.input.mainText;
                var uncertain = draft.phase === 'committing';
                $('sr-resume').disabled = uncertain && !reconcile;
                $('sr-silent').disabled = uncertain;
                $('sr-discard').disabled = uncertain;
                if (uncertain)
                    $('sr-error').textContent =
                        '上次提交状态待核对。请检查当前历史，不能自动再次结算。';
                if (reconcile) {
                    $('sr-resume').textContent = '同步已发布状态';
                    $('sr-error').textContent =
                        '当前历史已有同一正文；这里只补齐待办状态，不再次结算。';
                }
                async function resume(silent) {
                    try {
                        available();
                        var options = { silent: !!silent };
                        if (!silent && !reconcile) {
                            var captured = await speechRound.settings(workspaceId);
                            available();
                            if (captured.fingerprint !== draft.settingsFingerprint) {
                                if (
                                    !confirm(
                                        '连接或声线已改变。使用当前配置继续可能重新生成已成功的片段。确认采用当前配置？',
                                    )
                                )
                                    return;
                                options.adoptSettings = captured.fingerprint;
                            }
                        }
                        if (typeof closeGameSettings === 'function') closeGameSettings();
                        await pipeline.resumeRoundSpeech(draft.id, options);
                    } catch (error) {
                        if (root.isConnected) $('sr-status').textContent = error.message;
                        else if (typeof showModal === 'function')
                            showModal(
                                String(error.message || error)
                                    .replace(/&/g, '&amp;')
                                    .replace(/</g, '&lt;')
                                    .replace(/>/g, '&gt;'),
                            );
                    }
                }
                $('sr-resume').onclick = function () {
                    resume(false);
                };
                $('sr-silent').onclick = function () {
                    resume(true);
                };
                $('sr-discard').onclick = async function () {
                    try {
                        available();
                        if (
                            !confirm('放弃这份待发布正文？已经生成的录音仍按原缓存规则保留或淘汰。')
                        )
                            return;
                        await speechRound.discard(draft.id);
                        current();
                        await mount(root, workspaceId, current);
                    } catch (error) {
                        if (root.isConnected) $('sr-status').textContent = error.message;
                    }
                };
            }
        } catch (error) {
            if (root.isConnected) root.textContent = '整轮设置读取失败：' + error.message;
        }
    }
    function decision(draft, error, signal) {
        if (signal.aborted) return Promise.resolve('pause');
        return new Promise(function (resolve) {
            var node = document.createElement('section');
            node.id = 'speech-round-decision-modal';
            node.className = 'modal';
            node.style.display = 'block';
            node.style.zIndex = '5200';
            node.innerHTML =
                '<div class="modal-content" style="max-width:650px;text-align:left"><h3>本轮声音尚未完成</h3><p id="srd-error"></p><p>重试只复用身份一致的成功片段；未成功的请求再次重试仍可能计费。无声继续会按原流程展示本轮正文。</p><div class="modal-buttons"><button class="modal-btn" id="srd-retry">重试声音</button><button class="modal-btn" id="srd-silent">本轮无声继续</button><button class="modal-btn" id="srd-pause">暂停，稍后处理</button></div></div>';
            node.querySelector('#srd-error').textContent = String(
                (error && error.message) || error,
            );
            var finished = false;
            function close(choice) {
                if (finished) return;
                finished = true;
                signal.removeEventListener('abort', abort);
                if (node._unbindFit) node._unbindFit();
                node.remove();
                resolve(choice);
            }
            function abort() {
                close('pause');
            }
            ['retry', 'silent', 'pause'].forEach(function (choice) {
                node.querySelector('#srd-' + choice).onclick = function () {
                    close(owner() === draft.workspaceId ? choice : 'pause');
                };
            });
            node.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    close('pause');
                }
            });
            signal.addEventListener('abort', abort, { once: true });
            document.body.appendChild(node);
            if (typeof fitModalToViewport === 'function') fitModalToViewport(node);
            if (typeof bindModalAutoFit === 'function') bindModalAutoFit(node);
            node.querySelector('#srd-pause').focus();
        });
    }
    return { mount: mount, decision: decision };
})();

/** M2a: explicit one-NPC/one-line test. No automatic synthesis, planner request or business settlement. */
var speechSingleTest = (function () {
    'use strict';
    var generation = 0,
        active = null,
        modalOwner = null,
        checkView = null;
    function owner() {
        return mediaContext.workspaceId();
    }
    function chars() {
        return Object.keys(npcs)
            .filter(function (id) {
                return id !== 'USER';
            })
            .map(function (id) {
                return { id: id, name: npcs[id].name };
            });
    }
    function latest() {
        return storageService
            .loadUIConversation()
            .slice()
            .reverse()
            .find(function (m) {
                return m && m.role === 'assistant';
            });
    }
    function viewKey() {
        return JSON.stringify([
            currentStoryText,
            currentPage,
            isStoryExpanded,
            typeof storyHistoryOffset === 'undefined' ? 0 : storyHistoryOffset,
            document.body.classList.contains('layout-landscape'),
            typeof stageStory === 'undefined' ? null : stageStory.sentence(),
        ]);
    }
    function stop() {
        generation++;
        if (active) {
            active.abort();
            active = null;
        }
        speechService.stop();
    }
    function close() {
        checkView = null;
        if (modalOwner === null || modalOwner === owner()) stop();
        else {
            generation++;
            if (active) active.abort();
            active = null;
        }
        modalOwner = null;
        var node = document.getElementById('speech-single-test-modal');
        if (node) {
            if (node._unbindFit) node._unbindFit();
            node.remove();
        }
    }
    async function open() {
        close();
        var ticket = generation,
            workspaceId = owner(),
            context = mediaContext.capture(),
            key = viewKey(),
            record = structuredClone(latest() || null),
            node = document.createElement('div');
        modalOwner = workspaceId;
        node.id = 'speech-single-test-modal';
        node.className = 'modal';
        node.style.display = 'block';
        node.style.zIndex = '5100';
        node.innerHTML =
            '<div class="modal-content" style="max-width:720px;text-align:left"><h3>单句语音测试</h3>' +
            '<p>生成当前正文中所选NPC的第一条已标注台词，使用主回复提供的归属与表现描述。</p>' +
            '<p><label><input id="sst-enabled" type="checkbox">让后续主回复附单句测试标记</label></p>' +
            '<p><label>测试角色 <select id="sst-npc"></select></label> <button type="button" id="sst-save">保存测试选择（不联网）</button></p>' +
            '<p>连接与声线在“语音配置”保存。使用Fish Drama 3，简短表现描述随台词发送；本机录音可直接回放。</p>' +
            '<p>测试录音也占用最近10条本机缓存。停止不保证服务端取消或退款。</p>' +
            '<p id="sst-line"></p><p id="sst-emotion"></p><p id="sst-status" role="status">读取当前正文…</p>' +
            '<div class="modal-buttons"><button type="button" id="sst-generate" disabled>合成并播放这一句（可能计费）</button>' +
            '<button type="button" id="sst-play" disabled>只播放本机录音</button><button type="button" id="sst-stop">停止</button>' +
            '<button type="button" id="sst-close">关闭</button></div></div>';
        node.querySelector('.modal-content').style.animation = 'none';
        node.querySelectorAll('button').forEach(function (button) {
            button.classList.add('modal-btn');
        });
        document.body.appendChild(node);
        if (typeof fitModalToViewport === 'function') fitModalToViewport(node);
        if (typeof bindModalAutoFit === 'function') bindModalAutoFit(node);
        var $ = function (id) {
                return node.querySelector('#' + id);
            },
            status = $('sst-status'),
            busy = false,
            selection = null;
        chars().forEach(function (c) {
            var option = document.createElement('option');
            option.value = c.id;
            option.textContent = c.name;
            $('sst-npc').appendChild(option);
        });
        function current(requireView) {
            if (
                !node.isConnected ||
                ticket !== generation ||
                !mediaContext.isCurrent(context) ||
                owner() !== workspaceId
            )
                throw new Error('工作区或测试页已切换，请重新打开');
            if (
                requireView &&
                (document.hidden ||
                    key !== viewKey() ||
                    !record ||
                    latest()?.id !== record.id ||
                    latest()?.content !== record.content ||
                    JSON.stringify(latest()?.singleSpeech) !== JSON.stringify(record.singleSpeech))
            )
                throw new Error('正文或阅读位置已变化，请重新打开');
        }
        checkView = function (force) {
            if (ticket !== generation) return;
            try {
                current(true);
                if (force) throw new Error('页面已离开');
            } catch (e) {
                if (owner() === workspaceId) stop();
                else {
                    generation++;
                    if (active) active.abort();
                    active = null;
                }
                $('sst-generate').disabled = true;
                $('sst-play').disabled = true;
                if (node.isConnected)
                    status.textContent = '阅读位置或页面已变化，已取消本次单句操作。请重新打开。';
            }
        };
        function error(e) {
            if (node.isConnected && owner() === workspaceId)
                status.textContent = e.message || String(e);
        }
        $('sst-close').onclick = function () {
            if (document.getElementById(node.id) === node) close();
        };
        $('sst-stop').onclick = function () {
            try {
                current(false);
                stop();
                status.textContent = '已停止；原音频文件保留。重新测试请关闭后再打开。';
            } catch (e) {
                error(e);
            }
        };
        node.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && document.getElementById(node.id) === node) {
                e.preventDefault();
                e.stopPropagation();
                close();
            }
        });
        $('sst-save').onclick = async function () {
            try {
                current(false);
                var setting = {
                    provider: 'fish-drama3',
                    enabled: $('sst-enabled').checked,
                    targetNpcId: $('sst-npc').value,
                };
                await speechStore.setSetting('single-test:' + workspaceId, setting);
                current(false);
                status.textContent = '已保存。只影响后续主回复，不重发当前正文或自动合成。';
            } catch (e) {
                error(e);
            }
        };
        function planForOne() {
            return { sourceHash: selection.plan.sourceHash, units: [selection.unit], issues: [] };
        }
        async function loadSelection() {
            if (typeof storyHistoryOffset !== 'undefined' && storyHistoryOffset > 0)
                throw new Error('本小节只测试最新正文，请先返回最新记录');
            if (!record || !record.singleSpeech || record.content !== currentStoryText)
                throw new Error(
                    '当前没有已提交的单句测试记录。先保存测试选择，再通过原行动入口生成新正文。',
                );
            if (
                storageService.loadUIConversation().filter(function (m) {
                    return m.id === record.id;
                }).length !== 1
            )
                throw new Error('正文ID不唯一，未允许配音');
            var saved = record.singleSpeech;
            if (saved.renderVersion !== 'drama3-v1') throw new Error('录音渲染版本不支持');
            if (
                saved.version !== 'inline-v1' ||
                !['stop', 'STOP', 'end_turn', 'tool_calls'].includes(saved.finishReason)
            )
                throw new Error('本轮没有正常完成标志，未允许语音请求');
            var plan = await speechPlan.fromMainText(saved.rawSource, chars(), {
                finishReason: saved.finishReason,
            });
            current(true);
            if (
                plan.issues.length ||
                saved.issues.length ||
                plan.sourceHash !== saved.sourceHash ||
                plan.source !== speechPlan.documentFor(record.content).source
            )
                throw new Error('本轮标记或正文身份校验未通过，未允许合成');
            var unit = plan.units.find(function (u) {
                return (
                    u.kind === 'speech' &&
                    u.speakerId === saved.targetNpcId &&
                    u.speakerId !== 'USER' &&
                    npcs[u.speakerId]
                );
            });
            if (!unit) throw new Error('本轮没有测试角色的明确台词。不会猜说话人或追加模型请求。');
            if (Array.from(unit.text).length > 240)
                throw new Error('本小节只测试不超过240字的一条台词，不截断或拆成额外请求');
            selection = { plan: plan, unit: unit, turnId: 'd3-m2a:' + record.id };
            $('sst-line').textContent = npcs[unit.speakerId].name + '：' + unit.text;
            var cost = speechDrama3.estimate(unit.text, unit.emotion || '');
            $('sst-emotion').textContent =
                '表现描述：' +
                unit.emotion +
                '；发送约' +
                cost.billableBytes +
                ' UTF-8字节，官网估价 $' +
                cost.estimatedUsd.toFixed(5) +
                '（非账单保证）。';
            $('sst-generate').disabled = !speechTransport.describe().configured;
            var cached = await cachedSelection();
            current(true);
            $('sst-play').disabled = !cached;
            status.textContent = !speechTransport.describe().configured
                ? speechTransport.describe().message
                : cached
                  ? '本机已有Drama 3录音。'
                  : '尚无本机录音。合成按钮会使用Drama 3连接与声线，按字节计费。';
        }
        async function cachedSelection() {
            var hit = await speechReplay.resolve({
                workspaceId: workspaceId,
                record: record,
                characters: chars(),
            });
            current(true);
            return hit;
        }
        async function playCached() {
            current(true);
            var cached = await cachedSelection();
            current(true);
            if (!cached) throw new Error('没有匹配的本机录音，不会自动生成');
            var played = await speechService.play(
                workspaceId,
                cached.turnId,
                selection.unit.id + '/0',
            );
            current(true);
            status.textContent = played ? '已启动本机录音播放，可停止或重播。' : '本次播放已取消。';
        }
        $('sst-play').onclick = async function () {
            try {
                if (!selection || busy) return;
                await playCached();
            } catch (e) {
                error(e);
            }
        };
        $('sst-generate').onclick = async function () {
            if (busy || !selection) return;
            try {
                current(true);
                if (pipeline.isStreaming() || speechService.isBusy())
                    throw new Error('原回合或语音仍在处理');
                if (
                    !confirm(
                        '使用当前Fish Drama 3配置合成此句及其表现描述并播放，将按UTF-8字节计费。继续？',
                    )
                )
                    return;
                busy = true;
                active = new AbortController();
                var controller = active;
                $('sst-generate').disabled = true;
                $('sst-play').disabled = true;
                status.textContent = '正在处理这一句，不会自动重试…';
                var settings = await speechService.getConfig(workspaceId);
                current(true);
                if (!settings.voices?.[selection.unit.speakerId]?.speakerId)
                    throw new Error('请先在语音配置中绑定该NPC的测试声线');
                await speechService.prepare(
                    {
                        workspaceId: workspaceId,
                        turnId: selection.turnId,
                        sourceHash: selection.plan.sourceHash,
                        createdAt: record.createdAt,
                    },
                    planForOne(),
                    { manual: true, settings: settings, signal: controller.signal },
                );
                current(true);
                if (controller.signal.aborted) throw new DOMException('已停止', 'AbortError');
                $('sst-play').disabled = false;
                await playCached();
            } catch (e) {
                error(e);
            } finally {
                busy = false;
                if (active === controller) active = null;
                if (node.isConnected && ticket === generation)
                    $('sst-generate').disabled =
                        !selection || !speechTransport.describe().configured;
            }
        };
        try {
            var setting = await speechStore.getSetting('single-test:' + workspaceId);
            current(false);
            $('sst-enabled').checked =
                setting?.enabled === true && setting?.provider === 'fish-drama3';
            if (setting?.targetNpcId && npcs[setting.targetNpcId])
                $('sst-npc').value = setting.targetNpcId;
            await loadSelection();
        } catch (e) {
            error(e);
        }
        if (node.isConnected && ticket === generation && owner() === workspaceId)
            $('sst-enabled').focus();
    }
    function invalidate() {
        if (checkView) checkView(false);
    }
    document.addEventListener('visibilitychange', invalidate);
    window.addEventListener('pagehide', function () {
        if (checkView) checkView(true);
    });
    return { open: open, close: close, invalidate: invalidate };
})();

/** Drama 3 BYOK configuration. Saving/reference binding is local; synthesis is always a separate action. */
var speechUI = (function () {
    'use strict';
    var serial = 0;
    async function render(root) {
        if (!root) return;
        var ticket = ++serial,
            workspaceId = speechService.workspaceId(),
            context = mediaContext.capture();
        root.textContent = '读取语音配置…';
        function current() {
            if (
                ticket !== serial ||
                !root.isConnected ||
                !mediaContext.isCurrent(context) ||
                speechService.workspaceId() !== workspaceId
            )
                throw new Error('游戏上下文或设置页已变更，请重新打开语音设置');
        }
        try {
            var settings = await speechService.getConfig(workspaceId),
                cached = await speechStore.listTurns(workspaceId);
            current();
            var quote = speechDrama3.estimate('示例', '', Date.now());
            root.innerHTML =
                '<style>#speech-panel-root form label{display:block;margin-bottom:6px}#speech-panel-root input:not([type=checkbox]),#speech-panel-root select,#speech-panel-root textarea{box-sizing:border-box;max-width:100%;width:100%}#speech-panel-root fieldset{min-width:0;margin:10px 0}#speech-panel-root .speech-voice-row{display:grid;grid-template-columns:minmax(0,1fr) 55px;gap:8px}#speech-panel-root p{overflow-wrap:anywhere}</style>' +
                '<p class="gs-section-desc">Fish Drama 3：主回复同次提供台词归属与简短表现描述。整轮朗读默认关闭；连接与参考保存于本机，声音按相应按钮或开关生成。</p>' +
                '<form id="speech-config-form" autocomplete="off"><label>Fish API Key <input name="apiKey" type="password" autocomplete="new-password"></label>' +
                '<label>语速（0.5～2，默认1）<input name="speed" type="number" min="0.5" max="2" step="0.05"></label>' +
                '<p>模型：drama-3；音频：MP3 / 44.1kHz。Fish Key保存在本机，合成使用当前玩家的账户。</p><p id="speech-connection-status" role="status"></p><p id="speech-price"></p>' +
                '<h4>Fish声线 → 游戏角色</h4><p class="gs-section-desc">已预设14个公开声线ID，可按角色调整。留空取消该角色绑定；实际音色可用性以Fish返回为准。</p><div id="speech-voices"></div>' +
                '<p><button type="submit" class="modal-btn">保存配置</button> <button type="button" id="speech-check" class="modal-btn">本地校验</button></p></form>' +
                '<details><summary>高级：绑定本地参考音频</summary><p>可改用WAV/MP3/FLAC参考（≤10MiB），建议10～30秒干净语音，必须填写准确转录。仅本机保存；合成时才向Fish发送此参考。</p>' +
                '<label>角色 <select id="speech-reference-npc"></select></label><label>参考音频 <input id="speech-reference-file" type="file" accept="audio/wav,audio/mpeg,audio/flac,.wav,.mp3,.flac"></label>' +
                '<label>准确转录 <textarea id="speech-reference-text" rows="3"></textarea></label><button id="speech-reference-save" type="button" class="modal-btn">本机保存参考绑定</button></details>' +
                '<p id="speech-status" role="status"></p><hr><p id="speech-cache-status"></p><button type="button" id="speech-clear" class="modal-btn">清除本机语音</button><hr><div id="speech-round-controls"></div>';
            root.querySelector('#speech-price').textContent =
                '按发送文本UTF-8字节计费（含表现指令）。当前官网估价 $' +
                quote.usdPerMillionBytes +
                '/百万字节；标准价 $50。' +
                (quote.promotional ? '活动至2026-12-01 08:00 UTC。' : '') +
                '此处不是账户账单或硬性消费上限。';
            var form = root.querySelector('form'),
                field = function (name) {
                    return form.elements.namedItem(name);
                };
            field('apiKey').value = settings.provider.apiKey || '';
            field('speed').value = String(settings.provider.speed || 1);
            var connection = speechTransport.describe();
            root.querySelector('#speech-connection-status').textContent = connection.message;
            root.querySelector('details').hidden = connection.mode === 'android-native';
            var voicesRoot = root.querySelector('#speech-voices'),
                referenceSelect = root.querySelector('#speech-reference-npc'),
                voiceInputs = [];
            Object.keys(npcs)
                .filter(function (id) {
                    return id !== 'USER' && npcs[id].name;
                })
                .forEach(function (id) {
                    var row = document.createElement('p'),
                        label = document.createElement('label'),
                        voice = document.createElement('input'),
                        version = document.createElement('input');
                    label.textContent = npcs[id].name + ' ';
                    voice.placeholder = 'Fish reference_id';
                    voice.value = settings.voices?.[id]?.speakerId || '';
                    voice.setAttribute('aria-label', npcs[id].name + '音色ID');
                    version.value = settings.voices?.[id]?.version || '1';
                    version.setAttribute('aria-label', npcs[id].name + '声音版本');
                    row.className = 'speech-voice-row';
                    var versionLabel = document.createElement('label');
                    versionLabel.textContent = '版本';
                    versionLabel.append(version);
                    label.append(voice);
                    row.append(label, versionLabel);
                    voicesRoot.append(row);
                    voiceInputs.push({ id: id, voice: voice, version: version });
                    var option = document.createElement('option');
                    option.value = id;
                    option.textContent = npcs[id].name;
                    referenceSelect.append(option);
                });
            var status = root.querySelector('#speech-status');
            function values() {
                current();
                var next = {
                    provider: {
                        kind: 'fish-drama3',
                        apiKey: field('apiKey').value.trim(),
                        speed: Number(field('speed').value),
                    },
                    voices: {},
                };
                voiceInputs.forEach(function (row) {
                    var id = row.voice.value.trim(),
                        old = settings.voices?.[row.id];
                    if (id)
                        next.voices[row.id] = {
                            kind: 'fish-drama3',
                            speakerId: id,
                            version: row.version.value.trim() || '1',
                        };
                    else if (old && old.speakerId) next.voices[row.id] = null;
                });
                return next;
            }
            form.onsubmit = async function (event) {
                event.preventDefault();
                try {
                    settings = await speechService.saveConfig(values(), workspaceId);
                    current();
                    status.textContent = 'Drama 3配置已保存到本机；请在下方单独确认启用朗读。';
                } catch (e) {
                    if (ticket === serial) status.textContent = e.message;
                }
            };
            root.querySelector('#speech-check').onclick = async function () {
                try {
                    var next = values();
                    speechDrama3.normalizeConfig(next.provider);
                    var bound = Object.entries(next.voices).filter(function (entry) {
                        return !!entry[1];
                    });
                    if (!bound.length) throw new Error('请至少绑定一个NPC声线');
                    var latest = await speechService.getConfig(workspaceId);
                    current();
                    for (var entry of bound) {
                        var complete = Object.assign({}, latest.voices[entry[0]] || {}, entry[1]);
                        var voice = await speechConfig.resolveVoice(complete, workspaceId);
                        current();
                        speechTransport.checkVoice(voice);
                        await speechDrama3.voiceIdentity(voice);
                        current();
                    }
                    status.textContent =
                        '本地字段、' +
                        bound.length +
                        '个绑定与参考哈希通过；账号权限和音质另行验证。';
                } catch (e) {
                    if (ticket === serial) status.textContent = e.message;
                }
            };
            root.querySelector('#speech-reference-save').onclick = async function () {
                try {
                    var next = values(),
                        npc = referenceSelect.value,
                        file = root.querySelector('#speech-reference-file').files[0],
                        text = root.querySelector('#speech-reference-text').value;
                    if (!file) throw new Error('请先选择参考音频');
                    if (!file.size || file.size > 10 * 1024 * 1024)
                        throw new Error('参考音频须为不超过10MiB的文件');
                    if (!text.trim()) throw new Error('请填写参考音频的准确转录');
                    await speechService.validateAudio(file);
                    current();
                    var binding = await speechConfig.putReference(file, text, workspaceId);
                    current();
                    next.voices[npc] = binding;
                    settings = await speechService.saveConfig(next, workspaceId);
                    current();
                    var row = voiceInputs.find(function (r) {
                        return r.id === npc;
                    });
                    row.voice.value = binding.speakerId;
                    row.version.value = binding.version;
                    status.textContent =
                        npcs[npc].name + '参考已保存在本机，原文件未修改；可在单句测试中试听。';
                } catch (e) {
                    if (ticket === serial) status.textContent = e.message;
                }
            };
            root.querySelector('#speech-cache-status').textContent =
                '本机缓存：' +
                cached.length +
                '/10轮。本机录音可直接回放；超出保留范围时淘汰最早音频，正文保持。';
            root.querySelector('#speech-clear').onclick = async function () {
                try {
                    current();
                    if (!confirm('只清除本机语音文件，不删除正文、参考音频、声线或API配置。继续？'))
                        return;
                    speechService.stop();
                    await speechStore.clearWorkspace(workspaceId);
                    current();
                    status.textContent = '本机语音已清除。';
                    root.querySelector('#speech-cache-status').textContent = '本机缓存：0/10轮。';
                } catch (e) {
                    if (ticket === serial) status.textContent = e.message;
                }
            };
            if (typeof speechRoundUI !== 'undefined')
                await speechRoundUI.mount(
                    root.querySelector('#speech-round-controls'),
                    workspaceId,
                    current,
                );
        } catch (error) {
            if (ticket === serial) root.textContent = '语音设置读取失败：' + error.message;
        }
    }
    return {
        render: render,
        openSingle: speechSingleTest.open,
        closeSingle: speechSingleTest.close,
        invalidateSingle: speechSingleTest.invalidate,
    };
})();
