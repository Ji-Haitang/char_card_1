import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inspect, types } from 'node:util';
import vm from 'node:vm';
import test from 'node:test';

// Only source files are read. Every configuration, key, DOM node, and storage
// failure below is synthetic; no browser profile or network transport is used.
const apiSource = fs.readFileSync(new URL('../module/api-service.js', import.meta.url), 'utf8');
const uiSource = fs.readFileSync(new URL('../ui/config-modal.js', import.meta.url), 'utf8');
const HISTORY = 'jxz_apiConfigHistory';
const SECRET = 'SYNTHETIC-DO-NOT-LOG-KEY-39e';
const SLOTS = {
    primary: { prefix: 'api', key: 'jxz_apiConfig', get: 'getConfig', update: 'updateConfig' },
    secondary: { prefix: 'api2', key: 'jxz_apiConfigSecondary', get: 'getSecondaryConfig', update: 'updateSecondaryConfig' }
};
const plain = value => JSON.parse(JSON.stringify(value));
const otherSlot = section => section === 'primary' ? 'secondary' : 'primary';
const decode = value => value.replace(/&quot;/g, '"').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attr = (text, name) => decode(new RegExp('(?:^|\\s)' + name + '="([^"]*)"').exec(text)?.[1] || '');
const flag = (text, name) => new RegExp('(?:^|\\s)' + name + '(?:\\s|$)').test(text);
const storageError = name => Object.assign(new Error(SECRET + ': synthetic storage failure'), { name });
const historyEntry = (model, extra = {}) => ({
    endpoint: 'https://history.invalid/v1', model, apiKey: 'FAKE-history-key', _label: model, ...extra
});

function setup(t, { historyRaw = '[]' } = {}) {
    const nodes = new Map();
    const storage = new Map([[HISTORY, historyRaw]]);
    const reads = [], writes = [], committed = [], logs = [], alerts = [];
    const destructive = [], network = [];
    const h = { nodes, storage, reads, writes, committed, logs, alerts, destructive, network,
        readFailures: new Map(), writeFailures: new Map(), beforeWrite: null };
    const noNetwork = (...args) => {
        network.push(args);
        throw new Error('Network is forbidden in persistence tests');
    };
    const context = {
        URL,
        window: { location: { protocol: 'https:' } },
        console: Object.fromEntries(['log', 'warn', 'error', 'info', 'debug'].map(level =>
            [level, (...args) => logs.push({ level, args })])),
        alert(message) { alerts.push(message); },
        confirm() { return true; },
        fetch: noNetwork,
        XMLHttpRequest: function () { noNetwork('XMLHttpRequest'); },
        WebSocket: function () { noNetwork('WebSocket'); },
        localStorage: {
            getItem(key) {
                reads.push(key);
                if (h.readFailures.has(key)) throw h.readFailures.get(key);
                return storage.get(key) ?? null;
            },
            setItem(key, value) {
                const write = { key, value: String(value) };
                writes.push(write);
                h.beforeWrite?.(write);
                if (h.writeFailures.has(key)) throw h.writeFailures.get(key);
                storage.set(key, write.value);
                committed.push(write);
            },
            removeItem(key) { destructive.push(['removeItem', key]); throw new Error('Deletion forbidden'); },
            clear() { destructive.push(['clear']); throw new Error('Clearing forbidden'); }
        },
        document: {
            currentScript: { src: 'https://synthetic.invalid/ui/config-modal.js' },
            head: { appendChild() {} },
            createElement() { return {}; },
            getElementById(id) { return nodes.get(id) || null; },
            body: {
                // Parse the actual rendered control IDs, values, and select options;
                // do not replace the product form readers or configuration setters.
                insertAdjacentHTML(position, markup) {
                    assert.equal(position, 'beforeend');
                    for (const match of markup.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
                        const [, tagName, attributes, id] = match;
                        const classes = new Set(attr(attributes, 'class').split(/\s+/).filter(Boolean));
                        nodes.set(id, {
                            tagName, type: attr(attributes, 'type'), value: attr(attributes, 'value'),
                            checked: flag(attributes, 'checked'), disabled: flag(attributes, 'disabled'),
                            style: { display: /(?:^|;)\s*display\s*:\s*([^;]+)/.exec(attr(attributes, 'style'))?.[1] || '' },
                            textContent: '', innerHTML: '', className: attr(attributes, 'class'),
                            classList: { toggle(name, force) {
                                const add = force ?? !classes.has(name);
                                if (add) classes.add(name); else classes.delete(name);
                                return add;
                            } },
                            setAttribute(name, value) { this[name] = value; },
                            remove() { if (id === 'api-config-modal') nodes.clear(); }
                        });
                    }
                    for (const match of markup.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
                        const node = nodes.get(attr(match[1], 'id'));
                        if (!node) continue;
                        node.options = [...match[2].matchAll(/<option\b([^>]*)>/g)].map(option => ({
                            value: attr(option[1], 'value'), selected: flag(option[1], 'selected')
                        }));
                        node.value = (node.options.find(option => option.selected) || node.options[0])?.value || '';
                    }
                }
            }
        }
    };
    vm.createContext(context);
    vm.runInContext(apiSource, context, { filename: 'module/api-service.js' });
    h.context = context;
    h.api = context.apiService;
    h.live = section => h.api[SLOTS[section].get]();
    h.status = section => nodes.get('cfg-' + section + '-save-status');
    // Derive all sampling/proxy defaults from the actual service, not a parallel
    // hand-maintained defaults object. Only identifying fields are fixture data.
    for (const section of Object.keys(SLOTS)) {
        storage.set(SLOTS[section].key, JSON.stringify({
            ...plain(h.live(section)), endpoint: 'https://old-' + section + '.invalid/v1',
            apiKey: 'FAKE-old-' + section + '-key', model: 'old-' + section,
            ...(section === 'secondary' ? { enabled: true, backgroundTasks: ['summary'] } : {})
        }));
    }
    h.api.loadConfig();
    vm.runInContext(uiSource, context, { filename: 'ui/config-modal.js' });
    context.showConfigModal();
    for (const section of Object.keys(SLOTS)) setDraft(h, section);
    reads.length = writes.length = committed.length = 0;
    t.after(() => {
        assert.deepEqual(network, [], 'saving must never contact a network transport');
        assert.deepEqual(destructive, [], 'saving must not delete/clear user storage');
        assertSafeFeedback(h);
    });
    return h;
}

function setDraft(h, section, changes = {}) {
    const prefix = SLOTS[section].prefix;
    const values = { endpoint: 'https://new-' + section + '.invalid/v1',
        key: SECRET + '-' + section, model: 'new-' + section, ...changes };
    for (const suffix of ['endpoint', 'key', 'model']) h.nodes.get(prefix + '-' + suffix + '-input').value = values[suffix];
    if (section === 'secondary') {
        h.nodes.get('api2-enabled').checked = true;
        for (const task of h.api.BACKGROUND_TASKS) h.nodes.get('api2-task-' + task.key).checked = task.key === 'event';
    }
    h.context._cfgMarkDirty(section);
}

function draftState(h, section) {
    const prefix = SLOTS[section].prefix + '-';
    return [...h.nodes].filter(([id]) => id.startsWith(prefix)).map(([id, node]) =>
        [id, node.value, node.checked]);
}

function sectionState(h, section) {
    return { live: plain(h.live(section)), stored: h.storage.get(SLOTS[section].key),
        dirty: h.context._cfgDirty[section], draft: draftState(h, section),
        status: h.status(section).textContent, statusClass: h.status(section).className };
}

function expectedCandidate(h, section) {
    return { ...plain(h.live(section)), ...plain(h.context._readApiForm(SLOTS[section].prefix)),
        ...(section === 'secondary' ? {
            enabled: h.nodes.get('api2-enabled').checked,
            backgroundTasks: [...h.context._readSecondaryTasks()]
        } : {}) };
}

function reloadConfig(h, section) {
    const reloaded = {
        URL, console: h.context.console, window: { location: { protocol: 'https:' } },
        fetch: h.context.fetch,
        localStorage: {
            getItem(key) { return h.storage.get(key) ?? null; },
            setItem() { assert.fail('loading configuration must not write storage'); }
        }
    };
    vm.createContext(reloaded);
    vm.runInContext(apiSource, reloaded);
    reloaded.apiService.loadConfig();
    return plain(reloaded.apiService[SLOTS[section].get]());
}

function assertSafeFeedback(h) {
    const feedback = [...h.alerts, ...h.logs.flatMap(record => record.args),
        ...Object.keys(SLOTS).map(section => h.status(section)?.textContent || '')];
    const rejectErrors = value => {
        assert.equal(types.isNativeError(value), false, 'do not log/pass raw Error objects');
        if (value && typeof value === 'object') for (const child of Object.values(value)) rejectErrors(child);
    };
    for (const value of feedback) {
        rejectErrors(value);
        assert.equal(inspect(value, { depth: 10 }).includes(SECRET), false, 'feedback must not expose a key or injected error message');
    }
}

function assertSaved(h, section, expected) {
    assert.equal(h.context._cfgDirty[section], false);
    assert.match(h.status(section).textContent, /已保存\s+\d{2}:\d{2}:\d{2}/);
    assert.doesNotMatch(h.status(section).className, /is-error/);
    assert.deepEqual(plain(h.live(section)), expected);
    assert.deepEqual(JSON.parse(h.storage.get(SLOTS[section].key)), expected);
    assert.deepEqual(reloadConfig(h, section), expected, 'new VM must reload the saved configuration');
}

for (const section of Object.keys(SLOTS)) {
    const slot = SLOTS[section];
    test(`${section}: service commits only after persistence and preserves the live reference`, t => {
        const h = setup(t);
        const ref = h.live(section), before = plain(ref), other = sectionState(h, otherSlot(section));
        const expected = expectedCandidate(h, section);
        h.beforeWrite = ({ key, value }) => {
            assert.equal(key, slot.key);
            assert.deepEqual(plain(ref), before, 'live state must still be old inside setItem');
            assert.deepEqual(JSON.parse(value), expected);
        };
        h.api[slot.update](expected);
        assert.strictEqual(h.live(section), ref);
        assert.deepEqual(plain(ref), expected);
        assert.deepEqual(reloadConfig(h, section), expected);
        assert.deepEqual(sectionState(h, otherSlot(section)), other);
        assert.deepEqual(h.committed.map(write => write.key), [slot.key]);
    });

    for (const name of ['QuotaExceededError', 'SecurityError', 'Error']) {
        test(`${section}: service ${name} leaves live and persistent state unchanged`, t => {
            const h = setup(t);
            const ref = h.live(section), before = sectionState(h, section);
            const other = sectionState(h, otherSlot(section));
            const routeBefore = plain(h.api.getConfigFor('summary'));
            h.writeFailures.set(slot.key, storageError(name));
            assert.throws(() => h.api[slot.update](expectedCandidate(h, section)), { name });
            assert.strictEqual(h.live(section), ref);
            assert.deepEqual(sectionState(h, section), before);
            assert.deepEqual(sectionState(h, otherSlot(section)), other);
            assert.deepEqual(plain(h.api.getConfigFor('summary')), routeBefore);
            assert.deepEqual(reloadConfig(h, section), before.live);
            assert.equal(h.committed.length, 0);
        });

        test(`${section}: UI catches ${name}, retains drafts, and reports a safe error code`, t => {
            const h = setup(t);
            const ref = h.live(section), before = sectionState(h, section);
            const other = sectionState(h, otherSlot(section)), history = h.storage.get(HISTORY);
            h.writeFailures.set(slot.key, storageError(name));
            assert.equal(h.context._cfgSaveSection(section), false);
            assert.strictEqual(h.live(section), ref);
            assert.deepEqual(plain(ref), before.live);
            assert.equal(h.storage.get(slot.key), before.stored);
            assert.deepEqual(reloadConfig(h, section), before.live);
            assert.deepEqual(draftState(h, section), before.draft);
            assert.equal(h.context._cfgDirty[section], true);
            assert.match(h.status(section).className, /is-error/);
            assert.doesNotMatch(h.status(section).textContent, /已保存/);
            assert.match(h.status(section).textContent,
                name === 'Error' ? /Error|UNKNOWN|SAVE_FAILED/ : new RegExp(name));
            assert.deepEqual(sectionState(h, otherSlot(section)), other);
            assert.equal(h.storage.get(HISTORY), history);
            assert.deepEqual(h.writes.map(write => write.key), [slot.key]);
            assert.equal(h.committed.length, 0);
        });
    }

    test(`${section}: unknown exception names cannot disclose injected secrets`, t => {
        const h = setup(t);
        const before = sectionState(h, section), other = sectionState(h, otherSlot(section));
        h.writeFailures.set(slot.key, storageError(SECRET + '-UnrecognizedError'));
        assert.equal(h.context._cfgSaveSection(section), false);
        assert.match(h.status(section).textContent, /Error|UNKNOWN|SAVE_FAILED/);
        assert.match(h.status(section).className, /is-error/);
        assert.equal(h.context._cfgDirty[section], true);
        assert.deepEqual(plain(h.live(section)), before.live);
        assert.equal(h.storage.get(slot.key), before.stored);
        assert.deepEqual(draftState(h, section), before.draft);
        assert.deepEqual(sectionState(h, otherSlot(section)), other);
        assert.equal(h.committed.length, 0);
    });

    test(`${section}: successful UI save timestamps only its own section`, t => {
        const h = setup(t);
        const ref = h.live(section), old = plain(ref), expected = expectedCandidate(h, section);
        const other = sectionState(h, otherSlot(section));
        h.beforeWrite = ({ key }) => {
            if (key === slot.key) assert.deepEqual(plain(ref), old);
        };
        assert.equal(h.context._cfgSaveSection(section), true);
        assert.strictEqual(h.live(section), ref);
        assertSaved(h, section, expected);
        assert.deepEqual(sectionState(h, otherSlot(section)), other);
        assert.deepEqual(h.committed.map(write => write.key), [slot.key, HISTORY]);
        assert.equal(h.alerts.length, 0);
    });

    test(`${section}: validation failure is visible and does not write storage`, t => {
        const h = setup(t);
        setDraft(h, section, { model: '' });
        const ref = h.live(section), before = plain(ref), other = sectionState(h, otherSlot(section));
        assert.equal(h.context._cfgSaveSection(section), false);
        assert.strictEqual(h.live(section), ref);
        assert.deepEqual(plain(ref), before);
        assert.equal(h.context._cfgDirty[section], true);
        assert.match(h.status(section).className, /is-error/);
        assert.equal(h.writes.length, 0);
        assert.deepEqual(sectionState(h, otherSlot(section)), other);
    });

    test(`${section}: a retry after quota recovery saves the untouched draft`, t => {
        const h = setup(t);
        const expected = expectedCandidate(h, section), draft = draftState(h, section);
        const other = sectionState(h, otherSlot(section));
        h.writeFailures.set(slot.key, storageError('QuotaExceededError'));
        assert.equal(h.context._cfgSaveSection(section), false);
        h.writeFailures.delete(slot.key);
        assert.deepEqual(draftState(h, section), draft);
        assert.equal(h.context._cfgSaveSection(section), true);
        assertSaved(h, section, expected);
        assert.deepEqual(sectionState(h, otherSlot(section)), other);
    });

    for (const [label, historyRaw] of [
        ['null', 'null'], ['object', '{}'], ['number', '42'], ['boolean', 'true'],
        ['string', '"legacy"'], ['null entry', '[null]'], ['invalid JSON', '{']
    ]) {
        test(`${section}: malformed history ${label} cannot suppress saved feedback`, t => {
            const h = setup(t, { historyRaw });
            const expected = expectedCandidate(h, section);
            assert.equal(h.context._cfgSaveSection(section), true);
            assertSaved(h, section, expected);
            const history = JSON.parse(h.storage.get(HISTORY));
            assert.equal(history.length, 1);
            assert.equal(history[0].model, expected.model);
            assert.equal(history[0].endpoint, expected.endpoint);
        });
    }

    for (const [operation, name] of [
        ['read', 'SecurityError'], ['write', 'QuotaExceededError'],
        ['write', 'SecurityError'], ['write', 'Error']
    ]) {
        test(`${section}: optional history ${operation} ${name} never fails the core save`, t => {
            const oldHistory = JSON.stringify([historyEntry('retained-history')]);
            const h = setup(t, { historyRaw: oldHistory });
            const expected = expectedCandidate(h, section), other = sectionState(h, otherSlot(section));
            h[operation === 'read' ? 'readFailures' : 'writeFailures'].set(HISTORY, storageError(name));
            assert.equal(h.context._cfgSaveSection(section), true);
            assertSaved(h, section, expected);
            assert.deepEqual(sectionState(h, otherSlot(section)), other);
            if (operation === 'write') assert.equal(h.storage.get(HISTORY), oldHistory);
            assert.equal(h.committed.filter(write => write.key === slot.key).length, 1);
        });
    }

    test(`${section}: valid history keeps newest three and deduplicates endpoint plus model`, t => {
        const h = setup(t, { historyRaw: JSON.stringify([
            historyEntry('old-a'), historyEntry('old-b'), historyEntry('old-c')
        ]) });
        const other = sectionState(h, otherSlot(section));
        assert.equal(h.context._cfgSaveSection(section), true);
        let history = JSON.parse(h.storage.get(HISTORY));
        assert.deepEqual(history.map(entry => entry.model), ['new-' + section, 'old-a', 'old-b']);
        setDraft(h, section, { key: 'FAKE-updated-history-key' });
        assert.equal(h.context._cfgSaveSection(section), true);
        history = JSON.parse(h.storage.get(HISTORY));
        assert.equal(history.length, 3);
        assert.equal(history[0].apiKey, 'FAKE-updated-history-key');
        assert.equal(history.filter(entry => entry.model === 'new-' + section).length, 1);
        assert.equal('backgroundTasks' in history[0], false);
        setDraft(h, section, { endpoint: 'https://different.invalid/v1' });
        assert.equal(h.context._cfgSaveSection(section), true);
        history = JSON.parse(h.storage.get(HISTORY));
        assert.equal(history.length, 3);
        assert.deepEqual(history.map(entry => entry.endpoint), [
            'https://different.invalid/v1', 'https://new-' + section + '.invalid/v1', 'https://history.invalid/v1'
        ]);
        assert.deepEqual(sectionState(h, otherSlot(section)), other);
    });

    test(`${section}: dropdown uses a safe model fallback for malformed labels`, t => {
        const model = 'fallback <model> & "quoted"';
        const h = setup(t, { historyRaw: JSON.stringify([
            historyEntry(model, { _label: { bad: true } }),
            historyEntry('number-label', { _label: 42 }),
            historyEntry('null-label', { _label: null }),
            historyEntry('missing-label', { _label: undefined })
        ]) });
        const normalized = plain(h.context._loadConfigHistory());
        assert.deepEqual(normalized.map(entry => entry._label), [model, 'number-label', 'null-label', 'missing-label']);
        h.context._togglePresetDropdown(slot.prefix);
        const container = h.nodes.get(slot.prefix + '-preset-container');
        assert.equal(container.style.display, 'block');
        assert.ok(container.innerHTML.includes('fallback &lt;model&gt; &amp; &quot;quoted&quot;'));
        assert.ok(container.innerHTML.includes('number-label'));
        assert.doesNotMatch(container.innerHTML, /\[object Object\]|>42<|<model>/);
        assert.equal(h.writes.length, 0, 'opening history must not persist a draft');
    });
}

test('history normalization retains only object records with string endpoint/model/key fields', t => {
    const valid = historyEntry('valid');
    const noKey = historyEntry('without-key');
    delete noKey.apiKey;
    const emptyStrings = { endpoint: '', model: '', apiKey: '', _label: '' };
    const h = setup(t, { historyRaw: JSON.stringify([
        null, [], 42, true, 'legacy', {}, { endpoint: 'https://missing-model.invalid' },
        { model: 'missing-endpoint' }, historyEntry('number-endpoint', { endpoint: 42 }),
        historyEntry(42), historyEntry('number-key', { apiKey: 42 }),
        historyEntry('null-key', { apiKey: null }), valid, noKey, emptyStrings
    ]) });
    const history = plain(h.context._loadConfigHistory());
    assert.equal(history.length, 3);
    assert.deepEqual(history.map(entry => [entry.endpoint, entry.model, entry.apiKey]), [
        [valid.endpoint, valid.model, valid.apiKey], [noKey.endpoint, noKey.model, undefined], ['', '', '']
    ]);
    assert.equal(h.writes.length, 0);
});

for (const fail of [false, true]) {
    test(`secondary normalization ${fail ? 'does not mutate live state on failure' : 'commits normalized candidate after persistence'}`, t => {
        const h = setup(t);
        const ref = h.live('secondary'), before = plain(ref);
        const patch = { enabled: 'true', backgroundTasks: 'summary' };
        h.beforeWrite = ({ value }) => {
            assert.deepEqual(plain(ref), before);
            const candidate = JSON.parse(value);
            assert.equal(candidate.enabled, false);
            assert.deepEqual(candidate.backgroundTasks, []);
        };
        if (fail) {
            h.writeFailures.set(SLOTS.secondary.key, storageError('QuotaExceededError'));
            assert.throws(() => h.api.updateSecondaryConfig(patch), { name: 'QuotaExceededError' });
            assert.deepEqual(plain(ref), before);
            assert.deepEqual(reloadConfig(h, 'secondary'), before);
        } else {
            h.api.updateSecondaryConfig(patch);
            assert.equal(ref.enabled, false);
            assert.deepEqual([...ref.backgroundTasks], []);
            assert.deepEqual(reloadConfig(h, 'secondary'), plain(ref));
        }
        assert.strictEqual(h.live('secondary'), ref);
    });
}
