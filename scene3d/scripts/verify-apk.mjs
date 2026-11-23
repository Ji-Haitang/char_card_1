import fs from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { assert, safeRelative, uniquePaths, noSymlinks, fileInfo, readJson, atomicJson, sha256, verifyFiles } from './artifact-utils.mjs';
import { withRun, requireStep, isMain, runCli } from './run-record.mjs';
import { loadWwwExpected, validateNativeConfig, validatePlugins, canonical } from './prepare-apk.mjs';

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index; for (let i = 0; i < 8; i++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 255] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }
const utf8 = new TextDecoder('utf-8', { fatal: true });
function extraFields(bytes, { allowAlignmentPadding = false } = {}) {
  const fields = new Map();
  for (let position = 0; position < bytes.length;) {
    // Android zipalign may append 1–3 (or more) zero bytes to LOCAL extras
    // rather than encoding them as a TLV. Only all-zero trailing padding is allowed.
    if (allowAlignmentPadding && bytes.subarray(position).every(byte => byte === 0)) break;
    assert(position + 4 <= bytes.length, 'Truncated ZIP extra header');
    const id = bytes.readUInt16LE(position), size = bytes.readUInt16LE(position + 2); position += 4;
    assert(position + size <= bytes.length && !fields.has(id), 'Invalid/duplicate ZIP extra field');
    fields.set(id, bytes.subarray(position, position + size)); position += size;
  }
  assert(!fields.has(1), 'ZIP64 is outside this verifier contract'); return fields;
}
// No extraction and no external process. APK signing blocks between local entries and
// central directory are allowed; publisher/signature trust is a separate device/signing gate.
export function readZip(bytes, { maxEntryBytes = 256 * 1024 * 1024, maxTotalBytes = 1024 * 1024 * 1024 } = {}) {
  assert(Buffer.isBuffer(bytes) && bytes.length >= 22, 'Truncated ZIP');
  let end = -1;
  for (let position = bytes.length - 22; position >= Math.max(0, bytes.length - 65557); position--) {
    if (bytes.readUInt32LE(position) === 0x06054b50 && position + 22 + bytes.readUInt16LE(position + 20) === bytes.length) { end = position; break; }
  }
  assert(end >= 0, 'ZIP end record missing');
  assert(bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0, 'Multi-disk ZIP prohibited');
  const count = bytes.readUInt16LE(end + 10), centralSize = bytes.readUInt32LE(end + 12), centralOffset = bytes.readUInt32LE(end + 16);
  assert(count === bytes.readUInt16LE(end + 8) && count !== 0xffff && centralOffset !== 0xffffffff && centralSize !== 0xffffffff, 'ZIP64/multi-disk ZIP unsupported');
  assert(centralOffset + centralSize === end, 'Central directory bounds mismatch');
  const entries = new Map(), seen = new Map(), spellings = new Map(), ranges = []; let cursor = centralOffset, total = 0;
  for (let index = 0; index < count; index++) {
    assert(cursor + 46 <= end && bytes.readUInt32LE(cursor) === 0x02014b50, 'Bad central ZIP header');
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), crc = bytes.readUInt32LE(cursor + 16), compressedSize = bytes.readUInt32LE(cursor + 20), size = bytes.readUInt32LE(cursor + 24);
    const nameSize = bytes.readUInt16LE(cursor + 28), extraSize = bytes.readUInt16LE(cursor + 30), commentSize = bytes.readUInt16LE(cursor + 32), localOffset = bytes.readUInt32LE(cursor + 42);
    assert(!(flags & (1 | 0x40 | 0x2000)) && [0, 8].includes(method), 'Encrypted/unsupported ZIP entry');
    assert(bytes.readUInt16LE(cursor + 34) === 0 && localOffset !== 0xffffffff && size !== 0xffffffff && compressedSize !== 0xffffffff, 'ZIP64/multidisk entry prohibited');
    assert(size <= maxEntryBytes && (total += size) <= maxTotalBytes, 'ZIP decompression budget exceeded');
    const next = cursor + 46 + nameSize + extraSize + commentSize; assert(next <= end, 'Central ZIP entry overflow');
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameSize), extra = extraFields(bytes.subarray(cursor + 46 + nameSize, cursor + 46 + nameSize + extraSize));
    let name = utf8.decode(rawName); // UTF-8 Chinese is accepted, even from writers omitting bit 11.
    if (extra.has(0x7075)) {
      const unicode = extra.get(0x7075);
      assert(unicode.length >= 5 && unicode[0] === 1 && unicode.readUInt32LE(1) === crc32(rawName), 'Invalid Unicode ZIP path metadata');
      const unicodeName = utf8.decode(unicode.subarray(5)); assert(name === unicodeName, 'Ambiguous Unicode ZIP path');
    }
    const directory = name.endsWith('/'); if (directory) name = name.slice(0, -1);
    safeRelative(name);
    const segments = name.split('/');
    for (let part = 1; part <= segments.length; part++) {
      const prefix = segments.slice(0, part).join('/'), key = prefix.normalize('NFC').toLowerCase();
      assert(!spellings.has(key) || spellings.get(key) === prefix, `ZIP directory case/Unicode collision: ${name}`); spellings.set(key, prefix);
    }
    const folded = name.normalize('NFC').toLowerCase(); assert(!seen.has(folded), `Duplicate/case-colliding ZIP entry: ${name}`); seen.set(folded, name);
    const mode = bytes.readUInt32LE(cursor + 38) >>> 16;
    assert((mode & 0xf000) !== 0xa000, `ZIP symlink prohibited: ${name}`);
    assert(localOffset + 30 <= centralOffset && bytes.readUInt32LE(localOffset) === 0x04034b50, 'Bad local ZIP header');
    const localNameSize = bytes.readUInt16LE(localOffset + 26), localExtraSize = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameSize + localExtraSize, dataEnd = dataStart + compressedSize;
    assert(dataEnd <= centralOffset && dataStart >= localOffset + 30, 'Local ZIP data bounds mismatch');
    assert(bytes.readUInt16LE(localOffset + 6) === flags && bytes.readUInt16LE(localOffset + 8) === method && bytes.subarray(localOffset + 30, localOffset + 30 + localNameSize).equals(rawName), 'Local/central ZIP header mismatch');
    extraFields(bytes.subarray(localOffset + 30 + localNameSize, dataStart), { allowAlignmentPadding: true });
    let rangeEnd = dataEnd;
    if (!(flags & 8)) assert(bytes.readUInt32LE(localOffset + 14) === crc && bytes.readUInt32LE(localOffset + 18) === compressedSize && bytes.readUInt32LE(localOffset + 22) === size, 'Local ZIP size/CRC mismatch');
    else {
      let descriptor = dataEnd;
      if (descriptor + 4 <= centralOffset && bytes.readUInt32LE(descriptor) === 0x08074b50) descriptor += 4;
      assert(descriptor + 12 <= centralOffset && bytes.readUInt32LE(descriptor) === crc && bytes.readUInt32LE(descriptor + 4) === compressedSize && bytes.readUInt32LE(descriptor + 8) === size, 'ZIP data descriptor mismatch');
      rangeEnd = descriptor + 12;
    }
    ranges.push([localOffset, rangeEnd]);
    const compressed = bytes.subarray(dataStart, dataEnd);
    const content = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, size) });
    assert(content.length === size && crc32(content) === crc, `ZIP byte/CRC mismatch: ${name}`);
    if (directory) assert(size === 0, 'ZIP directory contains data');
    else entries.set(name, content);
    cursor = next;
  }
  assert(cursor === end, 'Central ZIP size/count mismatch'); uniquePaths([...entries.keys()]);
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) assert(ranges[i - 1][1] <= ranges[i][0], 'Overlapping ZIP local entries');
  return entries;
}
function binaryXmlStrings(bytes, offset, headerSize, chunkSize) {
  const count = bytes.readUInt32LE(offset + 8), flags = bytes.readUInt32LE(offset + 16), dataOffset = bytes.readUInt32LE(offset + 20);
  assert(headerSize >= 28 && headerSize + count * 4 <= chunkSize && dataOffset < chunkSize, 'Invalid Android string pool');
  const strings = [];
  for (let index = 0; index < count; index++) {
    let at = offset + dataOffset + bytes.readUInt32LE(offset + headerSize + index * 4);
    assert(at >= offset + dataOffset && at < offset + chunkSize, 'Android string bounds');
    function length8() { assert(at < offset + chunkSize, 'Android UTF8 length bounds'); const first = bytes[at++]; if (!(first & 0x80)) return first; assert(at < offset + chunkSize, 'Android UTF8 length bounds'); return ((first & 0x7f) << 8) | bytes[at++]; }
    function length16() { assert(at + 2 <= offset + chunkSize, 'Android UTF16 length bounds'); const first = bytes.readUInt16LE(at); at += 2; if (!(first & 0x8000)) return first; assert(at + 2 <= offset + chunkSize, 'Android UTF16 length bounds'); const second = bytes.readUInt16LE(at); at += 2; return (first & 0x7fff) * 65536 + second; }
    if (flags & 0x100) { length8(); const size = length8(); assert(at + size < offset + chunkSize && bytes[at + size] === 0, 'Android UTF8 string bounds'); strings.push(utf8.decode(bytes.subarray(at, at + size))); }
    else { const size = length16() * 2; assert(at + size + 2 <= offset + chunkSize && bytes.readUInt16LE(at + size) === 0, 'Android UTF16 string bounds'); strings.push(bytes.subarray(at, at + size).toString('utf16le')); }
  }
  return strings;
}
export function parseAndroidManifest(bytes) {
  assert(Buffer.isBuffer(bytes) && bytes.length >= 8 && bytes.readUInt16LE(0) === 0x0003 && bytes.readUInt32LE(4) === bytes.length, 'Expected Android binary XML manifest');
  let strings = null, manifest = null;
  for (let offset = bytes.readUInt16LE(2); offset < bytes.length;) {
    assert(offset + 8 <= bytes.length, 'Truncated Android XML chunk');
    const type = bytes.readUInt16LE(offset), headerSize = bytes.readUInt16LE(offset + 2), size = bytes.readUInt32LE(offset + 4);
    assert(headerSize >= 8 && size >= headerSize && offset + size <= bytes.length, 'Android XML chunk bounds');
    if (type === 1) strings = binaryXmlStrings(bytes, offset, headerSize, size);
    if (type === 0x0102) {
      assert(strings && headerSize >= 16 && size >= 36, 'Android XML start element invalid');
      const name = strings[bytes.readUInt32LE(offset + 20)];
      if (name === 'manifest') {
        assert(!manifest, 'Duplicate Android manifest root'); manifest = {};
        const start = bytes.readUInt16LE(offset + 24), stride = bytes.readUInt16LE(offset + 26), count = bytes.readUInt16LE(offset + 28);
        assert(stride >= 20 && offset + 16 + start + count * stride <= offset + size, 'Android XML attribute bounds');
        for (let index = 0; index < count; index++) {
          const at = offset + 16 + start + index * stride;
          const namespace = bytes.readUInt32LE(at), key = strings[bytes.readUInt32LE(at + 4)], raw = bytes.readUInt32LE(at + 8), valueType = bytes[at + 15], data = bytes.readUInt32LE(at + 16);
          if (!['package', 'versionCode', 'versionName'].includes(key)) continue;
          assert(key === 'package' ? namespace === 0xffffffff : strings[namespace] === 'http://schemas.android.com/apk/res/android', 'Android identity attribute namespace mismatch');
          assert(!Object.hasOwn(manifest, key), 'Duplicate Android identity attribute');
          manifest[key] = raw !== 0xffffffff ? strings[raw] : valueType === 3 ? strings[data] : [0x10, 0x11].includes(valueType) ? data : undefined;
        }
      }
    }
    offset += size;
  }
  assert(manifest && typeof manifest.package === 'string' && manifest.versionName !== undefined && manifest.versionCode !== undefined, 'Missing APK identity/version attributes');
  return { applicationId: manifest.package, versionCode: Number(manifest.versionCode), versionName: String(manifest.versionName) };
}
export function dexDefinedClasses(bytes) {
  assert(bytes.length >= 112 && /^dex\n0[3-4][0-9]\u0000$/.test(bytes.subarray(0, 8).toString('ascii')), 'APK DEX header invalid');
  assert(bytes.readUInt32LE(32) === bytes.length && bytes.readUInt32LE(36) === 112 && bytes.readUInt32LE(40) === 0x12345678, 'APK DEX size/endian mismatch');
  const stringsCount = bytes.readUInt32LE(56), stringsOffset = bytes.readUInt32LE(60), typesCount = bytes.readUInt32LE(64), typesOffset = bytes.readUInt32LE(68), classCount = bytes.readUInt32LE(96), classesOffset = bytes.readUInt32LE(100);
  assert(stringsOffset + stringsCount * 4 <= bytes.length && typesOffset + typesCount * 4 <= bytes.length && classesOffset + classCount * 32 <= bytes.length, 'APK DEX table bounds');
  const classes = new Set();
  for (let index = 0; index < classCount; index++) {
    const typeIndex = bytes.readUInt32LE(classesOffset + index * 32); assert(typeIndex < typesCount, 'APK DEX class type index');
    const stringIndex = bytes.readUInt32LE(typesOffset + typeIndex * 4); assert(stringIndex < stringsCount, 'APK DEX descriptor string index');
    let at = bytes.readUInt32LE(stringsOffset + stringIndex * 4), lengthBytes = 0, value;
    do { assert(at < bytes.length && lengthBytes++ < 5, 'APK DEX string length bounds'); value = bytes[at++]; } while (value & 0x80);
    const end = bytes.indexOf(0, at); assert(end >= at, 'APK DEX string terminator missing');
    const descriptor = bytes.subarray(at, end).toString('utf8');
    assert(!classes.has(descriptor), 'APK DEX duplicate class definition'); classes.add(descriptor);
  }
  return classes;
}
// Reviewed @capacitor/android 8.4.0 library asset, merged by AGP from
// capacitor/src/main/assets. These fingerprints were independently checked in
// the registry tarball after verifying the frozen SHA512 npm integrity below.
// Verification itself is offline. Never infer permission from APK extras or a scan.
const CAP_ANDROID = Object.freeze({
  version: '8.4.0',
  resolved: 'https://registry.npmjs.org/@capacitor/android/-/android-8.4.0.tgz',
  integrity: 'sha512-K1ZPkQzvRzPEALz9nBdLx5p5nAPzp5fsTYWk7LRiKZeH/NXqjDvqfTv7lrLgrziQNoDeaL6ijg64oBREzXiV+g==',
});
const BRIDGE_INFO = Object.freeze({ bytes: 53467, sha256: '8ecc290bdd4f54605a6851e73023d4ba5ba0e56aa1d3eba75962242482b8fb4e' });
const LIBRARY_BUILD_INFO = Object.freeze({ bytes: 4039, sha256: '2b03df6b575178a8de490b4db114cc84647c06a580342046a2e5f9f797920717' });
export async function verifyLibraryAssetProvenance(paths, input, staging) {
  assert(staging.native.dependencyVersions?.['@capacitor/android'] === CAP_ANDROID.version && input.native.dependencyVersions?.['@capacitor/android'] === CAP_ANDROID.version, 'Unreviewed Capacitor Android library version');
  async function exact(filename, expected, label) {
    const actual = await fileInfo(filename);
    assert(expected && actual.bytes === expected.bytes && actual.sha256 === expected.sha256, `Capacitor library provenance mismatch: ${label}`);
    return actual;
  }
  const lockPath = path.join(paths.apkRoot, 'package-lock.json');
  const lockInfo = await exact(lockPath, input.files['apk/package-lock.json'], 'frozen lock');
  const lock = await readJson(lockPath), locked = lock.packages?.['node_modules/@capacitor/android'];
  assert(locked && Object.entries(CAP_ANDROID).every(([key, value]) => locked[key] === value), 'Capacitor Android reviewed lock provenance mismatch');
  const libraryRoot = path.join(paths.apkRoot, 'node_modules/@capacitor/android');
  const metadataPath = path.join(libraryRoot, 'package.json'); await noSymlinks(metadataPath);
  const metadata = await readJson(metadataPath);
  assert(metadata.name === '@capacitor/android' && metadata.version === CAP_ANDROID.version && Array.isArray(metadata.files) && metadata.files.includes('capacitor/src/main/'), 'Capacitor Android package structure mismatch');
  const libraryBuild = await exact(path.join(libraryRoot, 'capacitor/build.gradle'), LIBRARY_BUILD_INFO, 'reviewed library Gradle');
  const source = path.join(libraryRoot, 'capacitor/src/main/assets/native-bridge.js');
  const asset = await exact(source, BRIDGE_INFO, 'reviewed native-bridge.js');
  const appPath = path.join(paths.androidRoot, 'app/build.gradle'), settingsPath = path.join(paths.androidRoot, 'capacitor.settings.gradle');
  await exact(appPath, input.files['apk/android/app/build.gradle'], 'frozen app Gradle');
  await exact(appPath, staging.gradleEvidence?.appBuild, 'staged app Gradle');
  await exact(settingsPath, staging.gradleEvidence?.settings, 'staged settings');
  const app = await fs.readFile(appPath, 'utf8'), settings = await fs.readFile(settingsPath, 'utf8');
  assert(/^\s*implementation\s+project\(':capacitor-android'\)\s*$/m.test(app), 'Capacitor Android implementation missing');
  assert(/^include ':capacitor-android'\s*$/m.test(settings) && /^project\(':capacitor-android'\)\.projectDir = new File\('\.\.\/node_modules\/@capacitor\/android\/capacitor'\)\s*$/m.test(settings), 'Capacitor Android library source mapping mismatch');
  assert(!Object.hasOwn(staging.assetFiles, 'native-bridge.js'), 'App staging collides with library native-bridge.js');
  return { package: '@capacitor/android', ...CAP_ANDROID, lock: lockInfo, libraryBuild, source, apkAsset: 'assets/native-bridge.js', ...asset };
}
export function verifyApkEntries(entries, staging) {
  assert(staging.native.dependencyVersions?.['@capacitor/android'] === CAP_ANDROID.version, 'Unreviewed Capacitor Android library version');
  assert(!Object.hasOwn(staging.assetFiles, 'native-bridge.js'), 'App staging collides with library native-bridge.js');
  const actualAssets = [...entries.keys()].filter(name => name.startsWith('assets/')).sort();
  const expectedAssets = [...Object.keys(staging.assetFiles).map(name => `assets/${name}`), 'assets/native-bridge.js'].sort();
  const expectedSet = new Set(expectedAssets);
  // assembleRelease adds AGP-generated ART baseline profiles (androidx.profileinstaller).
  // Only these exact binary paths are tolerated; they never come from www/public.
  const allowedGenerated = new Set(['assets/dexopt/baseline.prof', 'assets/dexopt/baseline.profm']);
  const missing = expectedAssets.filter(name => !entries.has(name));
  const extra = actualAssets.filter(name => !expectedSet.has(name) && !allowedGenerated.has(name));
  assert(!missing.length && !extra.length, `APK assets exact file set mismatch: ${JSON.stringify({ missing, extra })}`);
  const bridge = entries.get('assets/native-bridge.js');
  assert(bridge.length === BRIDGE_INFO.bytes && sha256(bridge) === BRIDGE_INFO.sha256, 'APK library native-bridge.js bytes mismatch');
  for (const [name, info] of Object.entries(staging.assetFiles)) {
    const bytes = entries.get(`assets/${name}`);
    assert(bytes?.length === info.bytes && sha256(bytes) === info.sha256, `APK asset bytes mismatch: ${name}`);
  }
  validateNativeConfig(JSON.parse(utf8.decode(entries.get('assets/capacitor.config.json'))), staging.native.config);
  validatePlugins(JSON.parse(utf8.decode(entries.get('assets/capacitor.plugins.json'))));
  const identity = parseAndroidManifest(entries.get('AndroidManifest.xml'));
  assert(canonical(identity) === canonical(staging.native.identity), 'APK application/version mismatch');
  const dex = [...entries].filter(([name]) => /^classes(?:\d+)?\.dex$/.test(name)).map(([, bytes]) => bytes);
  assert(dex.length > 0, 'APK native DEX missing');
  const definedClasses = dex.map(dexDefinedClasses);
  for (const plugin of staging.native.plugins) {
    const descriptor = `L${plugin.classpath.replaceAll('.', '/')};`;
    assert(definedClasses.some(classes => classes.has(descriptor)), `APK native plugin class definition missing: ${plugin.pkg}`);
  }
  assert(definedClasses.some(classes => classes.has('Lcom/getcapacitor/Bridge;')), 'APK native Capacitor Bridge class definition missing');
  return { identity, fileCount: entries.size, assetCount: expectedAssets.length, stagedAssetCount: Object.keys(staging.assetFiles).length, libraryAssets: { 'assets/native-bridge.js': BRIDGE_INFO }, pluginClassDescriptors: staging.native.plugins.map(plugin => plugin.classpath) };
}
export async function verifyApk(record, { runDir }) {
  const { paths, built, input } = await loadWwwExpected(record, runDir), stage = requireStep(record, 'verify:staging');
  assert(stage.stagingManifest === path.join(runDir, 'android-staging-manifest.json') && stage.apkPath === paths.apkPath, 'Staging/APK paths mismatch');
  assert((await fileInfo(stage.stagingManifest)).sha256 === stage.stagingManifestSha256, 'Verified staging manifest changed');
  const staging = await readJson(stage.stagingManifest);
  assert(staging.status === 'passed' && staging.runId === record.runId && staging.buildId === record.buildId && staging.upstreamManifestSha256 === built.wwwExpectedManifestSha256, 'Staging provenance mismatch');
  // Bind the APK to the exact already-verified staging bytes, not a fresh self-authorized scan.
  await verifyFiles(paths.assetsRoot, staging.assetFiles);
  const libraryAssetProvenance = await verifyLibraryAssetProvenance(paths, input, staging);
  await noSymlinks(paths.apkPath);
  const before = await fileInfo(paths.apkPath), bytes = await fs.readFile(paths.apkPath);
  assert(sha256(bytes) === before.sha256, 'APK changed while reading');
  const result = verifyApkEntries(readZip(bytes), staging);
  const report = { schemaVersion: 1, runId: record.runId, buildId: record.buildId, status: 'passed', apkPath: paths.apkPath, apk: before, stagingManifestSha256: stage.stagingManifestSha256, libraryAssetProvenance, ...result, verifiedAt: new Date().toISOString(), scope: 'ZIP assets, native config/plugins, binary Android identity and DEX class-definition tables; not signer verification, installation, device or API acceptance' };
  const reportPath = path.join(runDir, 'verify-apk.json'); await atomicJson(reportPath, report);
  return { reportPath, reportSha256: (await fileInfo(reportPath)).sha256, apkPath: paths.apkPath, apkSha256: before.sha256 };
}
if (isMain(import.meta.url)) runCli(() => withRun('verify:apk', verifyApk));
