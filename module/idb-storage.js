/**
 * idb-storage.js - IndexedDB 底层封装
 * 提供简单的 Key-Value 异步存储接口
 * 
 * 依赖：无
 */

var idbStorage = (function() {
    var DB_NAME = 'jxz_db';
    var DB_VERSION = 1;
    var STORE_NAME = 'keyval';
    var _db = null;

    /**
     * 打开/创建数据库
     * @returns {Promise<IDBDatabase>}
     */
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
                console.log('[IDB] 数据库打开成功');
                resolve(_db);
            };
            request.onerror = function(event) {
                console.error('[IDB] 数据库打开失败', event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * 读取值
     * @param {string} key
     * @returns {Promise<any>}
     */
    function get(key) {
        return new Promise(function(resolve, reject) {
            if (!_db) { reject(new Error('IDB not open')); return; }
            var tx = _db.transaction(STORE_NAME, 'readonly');
            var store = tx.objectStore(STORE_NAME);
            var request = store.get(key);
            request.onsuccess = function() { resolve(request.result); };
            request.onerror = function() { reject(request.error); };
        });
    }

    /**
     * 写入值
     * @param {string} key
     * @param {any} value
     * @returns {Promise<void>}
     */
    function put(key, value) {
        return putMany([[key, value]]);
    }

    /**
     * 在同一个事务中写入多条记录；只有事务真正提交（oncomplete）后才 resolve。
     * request.onsuccess 并不代表数据已落盘，配额不足等错误会在之后以事务 abort 的形式出现。
     * @param {Array<[string, any]>} entries
     * @returns {Promise<void>}
     */
    function putMany(entries) {
        return _write(function(store) {
            for (var i = 0; i < entries.length; i++) store.put(entries[i][1], entries[i][0]);
        });
    }

    /**
     * 删除值（事务提交后 resolve）
     * @param {string} key
     * @returns {Promise<void>}
     */
    function remove(key) {
        return _write(function(store) { store.delete(key); });
    }

    function _write(fill) {
        return new Promise(function(resolve, reject) {
            if (!_db) { reject(new Error('IDB not open')); return; }
            var tx;
            try {
                tx = _db.transaction(STORE_NAME, 'readwrite');
                fill(tx.objectStore(STORE_NAME));
            } catch (e) {
                try { if (tx) tx.abort(); } catch (_) {}
                reject(e);
                return;
            }
            tx.oncomplete = function() { resolve(); };
            tx.onabort = function() { reject(tx.error || new Error('IDB transaction aborted')); };
            tx.onerror = function(event) {
                // 交给 onabort 统一 reject；这里只阻止错误继续冒泡到 window。
                if (event && event.stopPropagation) event.stopPropagation();
            };
        });
    }

    /**
     * 获取所有 key
     * @returns {Promise<string[]>}
     */
    function getAllKeys() {
        return new Promise(function(resolve, reject) {
            if (!_db) { reject(new Error('IDB not open')); return; }
            var tx = _db.transaction(STORE_NAME, 'readonly');
            var store = tx.objectStore(STORE_NAME);
            var request = store.getAllKeys();
            request.onsuccess = function() { resolve(request.result || []); };
            request.onerror = function() { reject(request.error); };
        });
    }

    /**
     * 获取所有 key-value 对
     * @returns {Promise<Object>}
     */
    function getAll() {
        return new Promise(function(resolve, reject) {
            if (!_db) { reject(new Error('IDB not open')); return; }
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
        putMany: putMany,
        remove: remove,
        getAllKeys: getAllKeys,
        getAll: getAll
    };
})();
