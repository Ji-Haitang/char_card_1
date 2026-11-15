import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const env = vm.createContext({ Uint8Array, TextEncoder, DataView });
vm.runInContext(readFileSync(new URL('../module/speech-msgpack.js', import.meta.url), 'utf8'), env);
const encode = env.speechMsgpack.encode;
const hex = value => Buffer.from(encode(value)).toString('hex');

test('MessagePack known scalar/integer vectors, including safe 64-bit bounds', () => {
    const vectors = [[null, 'c0'], [false, 'c2'], [true, 'c3'], [0, '00'], [127, '7f'],
        [128, 'cc80'], [255, 'ccff'], [256, 'cd0100'], [65535, 'cdffff'], [65536, 'ce00010000'],
        [0xffffffff, 'ceffffffff'], [0x100000000, 'cf0000000100000000'],
        [Number.MAX_SAFE_INTEGER, 'cf001fffffffffffff'], [-1, 'ff'], [-32, 'e0'],
        [-33, 'd0df'], [-128, 'd080'], [-129, 'd1ff7f'], [-32768, 'd18000'],
        [-32769, 'd2ffff7fff'], [-2147483648, 'd280000000'],
        [-2147483649, 'd3ffffffff7fffffff'], [Number.MIN_SAFE_INTEGER, 'd3ffe0000000000001']];
    for (const [value, expected] of vectors) assert.equal(hex(value), expected, String(value));
});
test('finite floats preserve IEEE doubles and negative zero', () => {
    assert.equal(hex(1.5), 'cb3ff8000000000000');
    assert.equal(hex(-0), 'cb8000000000000000');
    for (const n of [Number.MIN_VALUE, Number.MAX_VALUE, 2 ** 54, Math.PI]) {
        const out = encode(n); assert.equal(out[0], 0xcb);
        assert.equal(new DataView(out.buffer, out.byteOffset + 1).getFloat64(0), n);
    }
});
test('known UTF-8 vectors count bytes rather than UTF-16 units', () => {
    assert.equal(hex(''), 'a0'); assert.equal(hex('你好😀'), 'aae4bda0e5a5bdf09f9880');
    assert.equal(hex('é'), 'a2c3a9'); assert.equal(hex('e\u0301'), 'a365cc81');
    assert.equal(hex('a'.repeat(31)).slice(0, 2), 'bf');
    assert.equal(hex('a'.repeat(32)).slice(0, 4), 'd920');
    assert.equal(hex('a'.repeat(256)).slice(0, 6), 'da0100');
    assert.equal(hex('a'.repeat(65536)).slice(0, 10), 'db00010000');
});
test('raw bytes use binary tags (never JSON arrays), preserving view offsets and source', () => {
    const bytes = new Uint8Array([99, 0, 127, 128, 255, 99]);
    assert.equal(hex(bytes.subarray(1, 5)), 'c404007f80ff');
    assert.equal(hex([0, 127, 128, 255]), '94007fcc80ccff');
    assert.equal(hex(new Uint8Array()), 'c400');
    assert.equal(hex(new Uint8Array(256)).slice(0, 6), 'c50100');
    assert.equal(hex(new Uint8Array(65536)).slice(0, 10), 'c600010000');
    assert.deepEqual([...bytes], [99, 0, 127, 128, 255, 99]);
});
test('known map and array vectors, null-prototype maps and repeated noncyclic objects', () => {
    assert.equal(hex({ audio: new Uint8Array([0, 255]), text: '中' }), '82a5617564696fc40200ffa474657874a3e4b8ad');
    assert.equal(hex([null, true, '中']), '93c0c3a3e4b8ad');
    assert.equal(hex(Object.assign(Object.create(null), { x: 1 })), '81a17801');
    const shared = { x: 1 }; assert.equal(hex([shared, shared]), '9281a1780181a17801');
    assert.equal(hex(Array(16).fill(null)).slice(0, 6), 'dc0010');
    assert.equal(hex(Object.fromEntries(Array.from({ length: 16 }, (_, i) => [String(i), null]))).slice(0, 6), 'de0010');
});
test('array32 and map32 lengths encode correctly within local node budget', () => {
    assert.equal(hex(Array(65536).fill(null)).slice(0, 10), 'dd00010000');
    const map = Object.fromEntries(Array.from({ length: 65536 }, (_, i) => [String(i), null]));
    assert.equal(hex(map).slice(0, 10), 'df00010000');
});
test('reject unsupported values, nonplain objects, getters, symbols and sparse arrays', () => {
    const getter = Object.defineProperty({}, 'x', { enumerable: true, get() { throw new Error('secret'); } });
    for (const value of [undefined, NaN, Infinity, -Infinity, 1n, Symbol('x'), () => {},
        new Date(), new Map(), new Set(), new ArrayBuffer(2), new Uint16Array(1), /x/,
        new (class Example {})(), [undefined], { x: undefined }, getter, { [Symbol('x')]: 1 },
        Array(2), Object.assign([1], { extra: 2 }), Object.defineProperty({}, 'hidden', { value: 1 })]) {
        assert.throws(() => encode(value), e => e.name === 'TypeError' && !e.message.includes('secret'));
    }
});
test('reject malformed Unicode instead of silently replacing original input', () => {
    for (const s of ['\ud800', '\udc00', 'a\ud800b', '\ud800\ud800']) assert.throws(() => encode(s));
});
test('reject circular graphs, excessive depth, excessive nodes and oversized binary/string/output', () => {
    const cyclic = {}; cyclic.self = cyclic; assert.throws(() => encode(cyclic));
    const a = []; a.push(a); assert.throws(() => encode(a));
    let deep = null; for (let i = 0; i < 66; i++) deep = [deep]; assert.throws(() => encode(deep));
    assert.throws(() => encode(Array(100001).fill(0)));
    assert.throws(() => encode(new Uint8Array(16 * 1024 * 1024)));
    assert.throws(() => encode('a'.repeat(4 * 1024 * 1024 + 1)));
    assert.throws(() => encode('中'.repeat(2 * 1024 * 1024)));
    assert.throws(() => encode([new Uint8Array(9 * 1024 * 1024), new Uint8Array(8 * 1024 * 1024)]));
});
test('output does not alias caller-owned binary', () => {
    const data = new Uint8Array([1, 2]); const packed = encode(data); data.fill(9);
    assert.deepEqual([...packed], [0xc4, 2, 1, 2]);
});
