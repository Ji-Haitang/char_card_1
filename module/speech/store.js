/** 本机语音缓存：每Workspace最多10条有音频的正文；与剧情存档/角色声音配置分离。 */
var speechStore = (function () {
    'use strict';
    var opening,
        LIMIT = 10;
    function notify(workspaceId) {
        if (
            typeof window !== 'undefined' &&
            typeof window.dispatchEvent === 'function' &&
            typeof CustomEvent === 'function'
        ) {
            window.dispatchEvent(
                new CustomEvent('speech-cache-change', { detail: { workspaceId: workspaceId } }),
            );
        }
    }
    function key(workspaceId, turnId, unitId) {
        if (!workspaceId || !turnId) throw new Error('语音缺少正文归属');
        return JSON.stringify(
            unitId === undefined ? [workspaceId, turnId] : [workspaceId, turnId, unitId],
        );
    }
    function db() {
        if (!opening)
            opening = new Promise(function (resolve, reject) {
                var request = indexedDB.open('jxz_speech_v1', 1);
                request.onupgradeneeded = function () {
                    request.result.createObjectStore('turns', { keyPath: 'id' });
                    var clips = request.result.createObjectStore('clips', { keyPath: 'id' });
                    clips.createIndex('turnKey', 'turnKey');
                    request.result.createObjectStore('settings', { keyPath: 'id' });
                };
                request.onerror = function () {
                    opening = null;
                    reject(request.error);
                };
                request.onblocked = function () {
                    opening = null;
                    reject(new Error('请关闭旧语音设置页后重试'));
                };
                request.onsuccess = function () {
                    var database = request.result;
                    database.onversionchange = function () {
                        database.close();
                        opening = null;
                    };
                    resolve(database);
                };
            });
        return opening;
    }
    async function read(store, id) {
        var database = await db();
        return new Promise(function (resolve, reject) {
            var tx = database.transaction(store, 'readonly');
            var request = tx.objectStore(store).get(id);
            tx.oncomplete = function () {
                resolve(request.result || null);
            };
            tx.onabort = tx.onerror = function () {
                reject(tx.error || new Error('语音读取失败'));
            };
        });
    }
    async function putClip(turn, clip) {
        if (turn.renderVersion !== 'drama3-v1' || !/^[a-f0-9]{64}$/.test(turn.renderHash || ''))
            throw new Error('语音渲染版本或指令指纹无效');
        var render = { renderVersion: turn.renderVersion, renderHash: turn.renderHash };
        if (turn.model !== undefined) render.model = turn.model;
        turn = {
            workspaceId: turn.workspaceId,
            turnId: turn.turnId,
            sourceHash: turn.sourceHash,
            planHash: turn.planHash || null,
            createdAt: turn.createdAt,
            units: (turn.units || []).map(function (u) {
                return {
                    id: u.id,
                    text: u.text,
                    speakerId: u.speakerId,
                    sourceLine: u.sourceLine,
                    start: u.start,
                    end: u.end,
                };
            }),
            ...render,
        };
        clip = {
            unitId: clip.unitId,
            cacheKey: clip.cacheKey,
            speakerId: clip.speakerId,
            blob: clip.blob,
        };
        var turnKey = key(turn.workspaceId, turn.turnId);
        if (
            !turn.sourceHash ||
            !Number.isFinite(turn.createdAt) ||
            !clip.unitId ||
            !clip.cacheKey ||
            !(clip.blob instanceof Blob) ||
            !clip.blob.size ||
            clip.blob.size > 16 * 1024 * 1024 ||
            clip.blob.type !== 'audio/mpeg'
        )
            throw new Error('语音记录无效或音频超过16MB');
        var database = await db();
        return new Promise(function (resolve, reject) {
            var tx = database.transaction(['turns', 'clips'], 'readwrite');
            var turns = tx.objectStore('turns'),
                clips = tx.objectStore('clips');
            var removed = [],
                failure = null;
            var previous = turns.get(turnKey);
            previous.onsuccess = function () {
                if (
                    previous.result &&
                    (previous.result.sourceHash !== turn.sourceHash ||
                        (previous.result.planHash || null) !== turn.planHash ||
                        (previous.result.renderVersion || null) !== (turn.renderVersion || null) ||
                        (previous.result.renderHash || null) !== (turn.renderHash || null))
                ) {
                    failure = new Error('同一正文ID的内容已变化，不能覆盖旧声音');
                    tx.abort();
                    return;
                }
                var record = previous.result || {
                    id: turnKey,
                    workspaceId: turn.workspaceId,
                    turnId: turn.turnId,
                    sourceHash: turn.sourceHash,
                    planHash: turn.planHash,
                    createdAt: turn.createdAt,
                    units: turn.units,
                    ...render,
                };
                // 只保存明确字段，避免将API凭证或整个游戏对象写入历史音频。
                record.units = turn.units;
                turns.put(record);
                clips.put({
                    id: key(turn.workspaceId, turn.turnId, clip.unitId),
                    turnKey: turnKey,
                    unitId: clip.unitId,
                    cacheKey: clip.cacheKey,
                    speakerId: clip.speakerId || null,
                    blob: clip.blob,
                    bytes: clip.blob.size,
                });
                var all = turns.getAll();
                all.onsuccess = function () {
                    var owned = all.result
                        .filter(function (t) {
                            return t.workspaceId === turn.workspaceId;
                        })
                        .sort(function (a, b) {
                            return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
                        });
                    owned.slice(0, Math.max(0, owned.length - LIMIT)).forEach(function (old) {
                        removed.push(old.turnId);
                        turns.delete(old.id);
                        var cursor = clips.index('turnKey').openCursor(IDBKeyRange.only(old.id));
                        cursor.onsuccess = function () {
                            if (cursor.result) {
                                cursor.result.delete();
                                cursor.result.continue();
                            }
                        };
                    });
                };
            };
            tx.oncomplete = function () {
                notify(turn.workspaceId);
                resolve({ retained: !removed.includes(turn.turnId), removedTurnIds: removed });
            };
            tx.onabort = tx.onerror = function () {
                reject(failure || tx.error || new Error('语音保存失败，旧缓存未清除'));
            };
        });
    }
    async function listTurns(workspaceId) {
        var database = await db();
        return new Promise(function (resolve, reject) {
            var tx = database.transaction('turns', 'readonly'),
                request = tx.objectStore('turns').getAll();
            tx.oncomplete = function () {
                resolve(
                    request.result
                        .filter(function (t) {
                            return t.workspaceId === workspaceId;
                        })
                        .sort(function (a, b) {
                            return b.createdAt - a.createdAt || b.id.localeCompare(a.id);
                        }),
                );
            };
            tx.onabort = tx.onerror = function () {
                reject(tx.error);
            };
        });
    }
    async function clearWorkspace(workspaceId) {
        var database = await db();
        return new Promise(function (resolve, reject) {
            var tx = database.transaction(['turns', 'clips'], 'readwrite'),
                turns = tx.objectStore('turns'),
                clips = tx.objectStore('clips');
            var all = turns.getAll();
            all.onsuccess = function () {
                all.result
                    .filter(function (t) {
                        return t.workspaceId === workspaceId;
                    })
                    .forEach(function (turn) {
                        turns.delete(turn.id);
                        var cursor = clips.index('turnKey').openCursor(IDBKeyRange.only(turn.id));
                        cursor.onsuccess = function () {
                            if (cursor.result) {
                                cursor.result.delete();
                                cursor.result.continue();
                            }
                        };
                    });
            };
            tx.oncomplete = function () {
                notify(workspaceId);
                resolve();
            };
            tx.onabort = tx.onerror = function () {
                reject(tx.error);
            };
        });
    }
    async function setSetting(id, value) {
        var database = await db(),
            copied = structuredClone(value);
        return new Promise(function (resolve, reject) {
            var tx = database.transaction('settings', 'readwrite');
            tx.objectStore('settings').put({ id: id, value: copied });
            tx.oncomplete = function () {
                resolve();
            };
            tx.onabort = tx.onerror = function () {
                reject(tx.error);
            };
        });
    }
    return {
        limit: LIMIT,
        putClip: putClip,
        listTurns: listTurns,
        clearWorkspace: clearWorkspace,
        getTurn: function (workspaceId, turnId) {
            return read('turns', key(workspaceId, turnId));
        },
        getClip: function (workspaceId, turnId, unitId) {
            return read('clips', key(workspaceId, turnId, unitId));
        },
        getSetting: async function (id) {
            var record = await read('settings', id);
            return record ? record.value : null;
        },
        setSetting: setSetting,
    };
})();
