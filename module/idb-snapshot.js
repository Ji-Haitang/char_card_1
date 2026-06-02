/**
 * idb-snapshot.js - 快照专用 IndexedDB 封装
 * 独立数据库 jxz_snapshot_db，与 jxz_db 平级。
 * 接口与 idb-storage.js 完全一致，对外暴露 idbSnapshot 对象。
 *
 * 依赖：无
 */

var idbSnapshot = (function() {
    var DB_NAME = 'jxz_snapshot_db';
    var DB_VERSION = 1;
    var STORE_NAME = 'keyval';
    var _db = null;

    function open() {
        if (_db) return Promise.resolve(_db);
        return new Promise(function(resolve, reject) {
            var request;
            try {
                request = indexedDB.open(DB_NAME, DB_VERSION);
            } catch (e) {
                reject(e);
                return;
            }
            request.onupgradeneeded = function(event) {
                var db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
            request.onsuccess = function(event) {
                _db = event.target.result;
                console.log('[IDB-Snapshot] 数据库打开成功');
                resolve(_db);
            };
            request.onerror = function(event) {
                console.error('[IDB-Snapshot] 数据库打开失败', event.target.error);
                reject(event.target.error);
            };
        });
    }

    function get(key) {
        return new Promise(function(resolve, reject) {
            if (!_db) { reject(new Error('IDB-Snapshot not open')); return; }
            var tx = _db.transaction(STORE_NAME, 'readonly');
            var store = tx.objectStore(STORE_NAME);
            var request = store.get(key);
            request.onsuccess = function() { resolve(request.result); };
            request.onerror = function() { reject(request.error); };
        });
    }

    function put(key, value) {
        return new Promise(function(resolve, reject) {
            if (!_db) { reject(new Error('IDB-Snapshot not open')); return; }
            var tx = _db.transaction(STORE_NAME, 'readwrite');
            var store = tx.objectStore(STORE_NAME);
            var request = store.put(value, key);
            request.onsuccess = function() { resolve(); };
            request.onerror = function() { reject(request.error); };
        });
    }

    function remove(key) {
        return new Promise(function(resolve, reject) {
            if (!_db) { reject(new Error('IDB-Snapshot not open')); return; }
            var tx = _db.transaction(STORE_NAME, 'readwrite');
            var store = tx.objectStore(STORE_NAME);
            var request = store.delete(key);
            request.onsuccess = function() { resolve(); };
            request.onerror = function() { reject(request.error); };
        });
    }

    function getAllKeys() {
        return new Promise(function(resolve, reject) {
            if (!_db) { reject(new Error('IDB-Snapshot not open')); return; }
            var tx = _db.transaction(STORE_NAME, 'readonly');
            var store = tx.objectStore(STORE_NAME);
            var request = store.getAllKeys();
            request.onsuccess = function() { resolve(request.result || []); };
            request.onerror = function() { reject(request.error); };
        });
    }

    function getAll() {
        return new Promise(function(resolve, reject) {
            if (!_db) { reject(new Error('IDB-Snapshot not open')); return; }
            var tx = _db.transaction(STORE_NAME, 'readonly');
            var store = tx.objectStore(STORE_NAME);
            var result = {};
            var cursorRequest = store.openCursor();
            cursorRequest.onsuccess = function(event) {
                var cursor = event.target.result;
                if (cursor) {
                    result[cursor.key] = cursor.value;
                    cursor.continue();
                } else {
                    resolve(result);
                }
            };
            cursorRequest.onerror = function() { reject(cursorRequest.error); };
        });
    }

    return {
        open: open,
        get: get,
        put: put,
        remove: remove,
        getAllKeys: getAllKeys,
        getAll: getAll
    };
})();
