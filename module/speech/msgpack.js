/** Browser-only MessagePack subset for Fish raw-reference requests; no JSON binary shim. */
var speechMsgpack = (function () {
    'use strict';
    // Local resource limits, not claims about the provider's limits.
    var MAX_BYTES = 16 * 1024 * 1024,
        MAX_NODES = 100000,
        MAX_DEPTH = 64;
    var MAX_STRING = 4 * 1024 * 1024;
    function invalid() {
        return new TypeError('MessagePack输入类型、结构或大小无效');
    }
    function encode(value) {
        var buffer = new Uint8Array(1024),
            view = new DataView(buffer.buffer),
            offset = 0;
        var ancestors = new Set(),
            nodes = 0,
            utf8 = new TextEncoder();
        function reserve(size) {
            if (size > MAX_BYTES - offset) throw invalid();
            if (offset + size <= buffer.length) return;
            var grown = new Uint8Array(
                Math.min(MAX_BYTES, Math.max(buffer.length * 2, offset + size)),
            );
            grown.set(buffer.subarray(0, offset));
            buffer = grown;
            view = new DataView(buffer.buffer);
        }
        function byte(n) {
            reserve(1);
            buffer[offset++] = n;
        }
        function number(tag, n, size, method) {
            reserve(size + 1);
            buffer[offset++] = tag;
            view[method](offset, n, false);
            offset += size;
        }
        function length(n, fix, fixLimit, tag8, tag16, tag32) {
            if (fix !== null && n < fixLimit) byte(fix | n);
            else if (tag8 !== null && n <= 255) number(tag8, n, 1, 'setUint8');
            else if (n <= 65535) number(tag16, n, 2, 'setUint16');
            else number(tag32, n, 4, 'setUint32');
        }
        function string(text) {
            if (text.length > MAX_STRING) throw invalid();
            // Reject unpaired surrogates rather than silently changing supplied text to U+FFFD.
            for (var i = 0; i < text.length; i++) {
                var c = text.charCodeAt(i);
                if (c >= 0xd800 && c <= 0xdbff) {
                    var next = text.charCodeAt(++i);
                    if (!(next >= 0xdc00 && next <= 0xdfff)) throw invalid();
                } else if (c >= 0xdc00 && c <= 0xdfff) throw invalid();
            }
            var bytes = utf8.encode(text);
            if (bytes.length > MAX_STRING) throw invalid();
            length(bytes.length, 0xa0, 32, 0xd9, 0xda, 0xdb);
            reserve(bytes.length);
            buffer.set(bytes, offset);
            offset += bytes.length;
        }
        function integer(n) {
            if (n >= 0 && n <= 127) byte(n);
            else if (n >= -32 && n < 0) byte(n & 255);
            else if (n >= 0 && n <= 255) number(0xcc, n, 1, 'setUint8');
            else if (n >= 0 && n <= 65535) number(0xcd, n, 2, 'setUint16');
            else if (n >= 0 && n <= 0xffffffff) number(0xce, n, 4, 'setUint32');
            else if (n >= -128 && n < 0) number(0xd0, n, 1, 'setInt8');
            else if (n >= -32768 && n < 0) number(0xd1, n, 2, 'setInt16');
            else if (n >= -2147483648 && n < 0) number(0xd2, n, 4, 'setInt32');
            else {
                reserve(9);
                buffer[offset++] = n >= 0 ? 0xcf : 0xd3;
                view.setUint32(offset, Math.floor(n / 4294967296), false);
                view.setUint32(offset + 4, n >>> 0, false);
                offset += 8;
            }
        }
        function visit(item, depth) {
            if (++nodes > MAX_NODES || depth > MAX_DEPTH) throw invalid();
            if (item === null) {
                byte(0xc0);
                return;
            }
            if (typeof item === 'boolean') {
                byte(item ? 0xc3 : 0xc2);
                return;
            }
            if (typeof item === 'string') {
                string(item);
                return;
            }
            if (typeof item === 'number') {
                if (!Number.isFinite(item)) throw invalid();
                if (Number.isSafeInteger(item) && !Object.is(item, -0)) integer(item);
                else number(0xcb, item, 8, 'setFloat64');
                return;
            }
            if (item instanceof Uint8Array) {
                length(item.byteLength, null, 0, 0xc4, 0xc5, 0xc6);
                reserve(item.byteLength);
                buffer.set(item, offset);
                offset += item.byteLength;
                return;
            }
            if (typeof item !== 'object') throw invalid();
            var array = Array.isArray(item),
                proto = Object.getPrototypeOf(item);
            // Permit plain records from another browser realm, but not class instances.
            if (
                !array &&
                proto !== null &&
                !(
                    Object.getPrototypeOf(proto) === null &&
                    Object.prototype.hasOwnProperty.call(proto, 'constructor') &&
                    proto.constructor.name === 'Object'
                )
            )
                throw invalid();
            if (ancestors.has(item)) throw invalid();
            ancestors.add(item);
            try {
                var keys = Reflect.ownKeys(item);
                if (
                    keys.length > MAX_NODES ||
                    keys.some(function (key) {
                        return typeof key !== 'string';
                    })
                )
                    throw invalid();
                if (array) {
                    if (item.length > MAX_NODES || keys.length !== item.length + 1) throw invalid();
                    length(item.length, 0x90, 16, null, 0xdc, 0xdd);
                    for (var i = 0; i < item.length; i++) {
                        var element = Object.getOwnPropertyDescriptor(item, String(i));
                        if (!element || !Object.prototype.hasOwnProperty.call(element, 'value'))
                            throw invalid();
                        visit(element.value, depth + 1);
                    }
                } else {
                    length(keys.length, 0x80, 16, null, 0xde, 0xdf);
                    keys.forEach(function (key) {
                        var property = Object.getOwnPropertyDescriptor(item, key);
                        if (
                            !property.enumerable ||
                            !Object.prototype.hasOwnProperty.call(property, 'value')
                        )
                            throw invalid();
                        string(key);
                        visit(property.value, depth + 1);
                    });
                }
            } finally {
                ancestors.delete(item);
            }
        }
        try {
            visit(value, 0);
            return buffer.slice(0, offset);
        } catch (_) {
            throw invalid();
        } // Never echo a getter/proxy exception or supplied data.
    }
    return Object.freeze({ encode: encode });
})();
