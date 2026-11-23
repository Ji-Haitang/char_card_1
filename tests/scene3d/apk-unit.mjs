// Synthetic infrastructure evidence only. Never builds, signs, installs, or overwrites a real APK.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { atomicJson, fileInfo, readJson, sha256 } from '../../scene3d/scripts/artifact-utils.mjs';
import { createRunRecord, loadRunRecord, withRun } from '../../scene3d/scripts/run-record.mjs';
import { prepareApk, buildApkWww, HTML_MAPPING, WEB_DIRS, WEB_ROOT_FILES, EXPECTED_PLUGINS, validateNativeConfig, validatePlugins } from '../../scene3d/scripts/prepare-apk.mjs';
import { verifyStaging } from '../../scene3d/scripts/verify-staging.mjs';
import { crc32, readZip, parseAndroidManifest, verifyApk, verifyLibraryAssetProvenance } from '../../scene3d/scripts/verify-apk.mjs';
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
async function put(root, name, bytes) { const full = path.join(root, name); await fs.mkdir(path.dirname(full), { recursive: true }); await fs.writeFile(full, bytes); }
async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'scene3d-apk-unit-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true })); // Only this test-created root.
  const root = path.join(temporary, 'game'), sourceRoot = path.join(temporary, 'baseline-pro');
  await put(root, 'scene3d/package.json', '{"type":"module"}');
  await put(root, 'scene3d/package-lock.json', '{"lockfileVersion":3}');
  await put(root, 'scene3d/vite.config.js', '// synthetic fixture, no Vite build');
  await put(root, 'scene3d/src/index.js', 'export function mount() {}');
  for (const name of ['artifact-utils', 'run-record', 'prepare-apk', 'verify-staging', 'verify-apk']) {
    await put(root, `scene3d/scripts/${name}.mjs`, await fs.readFile(path.join(repository, `scene3d/scripts/${name}.mjs`)));
  }
  for (const dir of WEB_DIRS) await put(root, `${dir}/保留.txt`, `original ${dir}`);
  await put(root, 'module/required.js', 'export const fixture = true;');
  for (const name of WEB_ROOT_FILES) await put(root, name, '/* synthetic reviewed root stylesheet */');
  for (const name of new Set(HTML_MAPPING.map(([source]) => source))) await put(root, name, `<html><script src="module/required.js"></script><script>const page='${name}'; const to='index.html?intent=start';</script></html>`);
  for (const name of ['build.js', 'capacitor.config.json']) await put(root, `apk/${name}`, await fs.readFile(path.join(repository, `apk/${name}`)));
  await put(root, 'apk/gen-icons.js', '// fixture icon script');
  const dependencies = Object.fromEntries(['android', 'cli', 'core', 'filesystem', 'share'].map(name => [`@capacitor/${name}`, '8.4.0']));
  await atomicJson(path.join(root, 'apk/package.json'), { dependencies });
  await atomicJson(path.join(root, 'apk/package-lock.json'), { lockfileVersion: 3, packages: Object.fromEntries(Object.keys(dependencies).map(name => [`node_modules/${name}`, { version: '8.4.0', ...(name === '@capacitor/android' ? { resolved: 'https://registry.npmjs.org/@capacitor/android/-/android-8.4.0.tgz', integrity: 'sha512-K1ZPkQzvRzPEALz9nBdLx5p5nAPzp5fsTYWk7LRiKZeH/NXqjDvqfTv7lrLgrziQNoDeaL6ijg64oBREzXiV+g==' } : {}) }])) });
  for (const name of ['build.gradle', 'settings.gradle', 'variables.gradle', 'gradle.properties', 'gradlew', 'gradlew.bat', 'capacitor.settings.gradle', 'app/build.gradle', 'app/capacitor.build.gradle', 'app/proguard-rules.pro', 'gradle/wrapper/gradle-wrapper.properties', 'app/src/main/AndroidManifest.xml']) {
    await put(root, `apk/android/${name}`, await fs.readFile(path.join(repository, `apk/android/${name}`)));
  }
  await put(root, 'apk/android/gradle/wrapper/gradle-wrapper.jar', 'synthetic wrapper placeholder - never execute');
  await put(root, 'apk/android/app/src/main/java/com/jihaitang/jxz/MainActivity.java', 'class MainActivity {}');
  await put(root, 'apk/android/app/src/main/res/values/strings.xml', '<resources/>');
  await put(root, 'apk/www/user-original.txt', 'must survive');
  await put(root, 'apk/android/app/build/outputs/apk/debug/app-debug.apk', 'old user debug APK');
  await put(root, 'apk/android/local.properties', 'sdk.dir=DO_NOT_COPY');
  await put(root, 'apk/android/app/src/main/private.keystore', 'SECRET_DO_NOT_COPY');
  await put(root, 'apk/node_modules/private-module/a.js', 'DO_NOT_COPY');
  await put(root, '.scene3d-work/other-run/private.json', 'DO_NOT_COPY');
  await put(root, 'assets/sect3d/old-version/old.glb', 'keep old version');
  await put(sourceRoot, 'sect_diorama.glb', 'dummy model');
  const sourceManifest = path.join(temporary, 'source.json');
  await atomicJson(sourceManifest, { schemaVersion: 1, sourceRoot, files: { 'sect_diorama.glb': { ...await fileInfo(path.join(sourceRoot, 'sect_diorama.glb')), publish: true } } });
  const runDir = path.join(root, '.scene3d-work', 'synthetic-apk-run'), recordPath = path.join(runDir, 'run.json');
  await createRunRecord(recordPath, { runId: 'synthetic-apk-run', buildId: 'synthetic-build', projectRoot: root, sourceRoot, sourceManifest, resourceRoot: path.join(runDir, 'resources'), releaseDir: path.join(runDir, 'release'), publishRoot: path.join(root, 'assets/sect3d') });
  const files = { 'entry.mjs': Buffer.from('export function mount() {}'), 'scene3d.css': Buffer.from('.fixture{}'), '模型/门派.glb': Buffer.from('dummy model') };
  const manifest = { schemaVersion: 1, buildId: 'synthetic-build', bridgeProtocol: { min: 1, max: 1 }, entry: 'entry.mjs', css: ['scene3d.css'], files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, { bytes: bytes.length, sha256: sha256(bytes) }])) };
  const versionRoot = path.join(root, 'assets/sect3d/synthetic-build');
  for (const [name, bytes] of Object.entries(files)) await put(versionRoot, name, bytes);
  await atomicJson(path.join(versionRoot, 'manifest.json'), manifest);
  const manifestSha256 = (await fileInfo(path.join(versionRoot, 'manifest.json'))).sha256;
  await atomicJson(path.join(root, 'assets/sect3d/current.json'), { schemaVersion: 1, buildId: 'synthetic-build', bridgeProtocol: { min: 1, max: 1 }, manifest: 'synthetic-build/manifest.json', manifestSha256 });
  const record = await loadRunRecord(recordPath);
  // Explicit synthetic upstream statuses: not claimed as real renderer/build evidence.
  record.steps.build = { status: 'succeeded', result: { manifestSha256, releaseDir: record.releaseDir } };
  record.steps['publish:assets'] = { status: 'succeeded', result: { pointerSha256: (await fileInfo(path.join(root, 'assets/sect3d/current.json'))).sha256, versionRoot, manifestSha256 } };
  await atomicJson(recordPath, record);
  const args = [`--runRecord=${recordPath}`];
  return { temporary, root, runDir, recordPath, args, record: () => loadRunRecord(recordPath), run: (step, fn) => withRun(step, fn, args) };
}
async function preparedWww(t) {
  const f = await fixture(t); f.prepared = await f.run('prepare:apk', prepareApk);
  await f.run('apk:www', (record, context) => buildApkWww(record, context, f.prepared.apkRoot));
  return f;
}
async function syntheticSync(f) {
  const p = f.prepared;
  for (const name of ['cli', 'android', 'core']) await atomicJson(path.join(p.apkRoot, `node_modules/@capacitor/${name}/package.json`), { name: `@capacitor/${name}`, version: '8.4.0' });
  for (const name of ['package.json', 'capacitor/build.gradle', 'capacitor/src/main/assets/native-bridge.js']) {
    await put(p.apkRoot, `node_modules/@capacitor/android/${name}`, await fs.readFile(path.join(repository, 'apk/node_modules/@capacitor/android', name)));
  }
  await put(p.apkRoot, 'node_modules/@capacitor/cli/dist/cordova.js', await fs.readFile(path.join(repository, 'apk/node_modules/@capacitor/cli/dist/cordova.js')));
  for (const plugin of EXPECTED_PLUGINS) await atomicJson(path.join(p.apkRoot, `node_modules/${plugin.pkg}/package.json`), { name: plugin.pkg, version: '8.4.0', capacitor: { android: { src: 'android' } } });
  await fs.mkdir(p.assetsRoot, { recursive: true });
  await fs.cp(p.wwwRoot, path.join(p.assetsRoot, 'public'), { recursive: true });
  await put(p.assetsRoot, 'public/cordova.js', ''); await put(p.assetsRoot, 'public/cordova_plugins.js', '');
  const config = await readJson(path.join(p.apkRoot, 'capacitor.config.json'));
  // Reordered/pretty-printed config remains semantically equal.
  await atomicJson(path.join(p.assetsRoot, 'capacitor.config.json'), Object.fromEntries(Object.entries(config).reverse()));
  await atomicJson(path.join(p.assetsRoot, 'capacitor.plugins.json'), [...EXPECTED_PLUGINS].reverse());
}
function binaryManifest({ applicationId = 'com.jihaitang.jxz', versionCode = 10, versionName = '1.6.3' } = {}) {
  const strings = ['manifest', 'package', applicationId, 'http://schemas.android.com/apk/res/android', 'versionCode', 'versionName', versionName];
  const encoded = strings.map(value => { const bytes = Buffer.from(value); assert.ok(bytes.length < 128); return Buffer.concat([Buffer.from([value.length, bytes.length]), bytes, Buffer.from([0])]); });
  const pool = Buffer.alloc(28 + 4 * strings.length + encoded.reduce((sum, bytes) => sum + bytes.length, 0));
  pool.writeUInt16LE(1); pool.writeUInt16LE(28, 2); pool.writeUInt32LE(pool.length, 4); pool.writeUInt32LE(strings.length, 8); pool.writeUInt32LE(0x100, 16); pool.writeUInt32LE(28 + 4 * strings.length, 20);
  let at = 0; for (let i = 0; i < strings.length; i++) { pool.writeUInt32LE(at, 28 + i * 4); encoded[i].copy(pool, 28 + 4 * strings.length + at); at += encoded[i].length; }
  const node = Buffer.alloc(36 + 3 * 20); node.writeUInt16LE(0x0102); node.writeUInt16LE(16, 2); node.writeUInt32LE(node.length, 4); node.writeUInt32LE(0xffffffff, 16); node.writeUInt32LE(0, 20); node.writeUInt16LE(20, 24); node.writeUInt16LE(20, 26); node.writeUInt16LE(3, 28);
  for (const [i, [ns, name, type, value]] of [[0xffffffff, 1, 3, 2], [3, 4, 0x10, versionCode], [3, 5, 3, 6]].entries()) { const offset = 36 + i * 20; node.writeUInt32LE(ns, offset); node.writeUInt32LE(name, offset + 4); node.writeUInt32LE(0xffffffff, offset + 8); node.writeUInt16LE(8, offset + 12); node[offset + 15] = type; node.writeUInt32LE(value, offset + 16); }
  const header = Buffer.alloc(8); header.writeUInt16LE(3); header.writeUInt16LE(8, 2); header.writeUInt32LE(8 + pool.length + node.length, 4);
  return Buffer.concat([header, pool, node]);
}
function zip(items) {
  const locals = [], central = []; let position = 0;
  for (const item of items) {
    const { name, bytes, method = 0, flags = 0x800, mode = 0x81a4, localPadding = Buffer.alloc(0) } = item;
    const nameBytes = Buffer.from(name), data = method === 8 ? deflateRawSync(bytes) : bytes, crc = crc32(bytes);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(localPadding.length, 28);
    const entry = Buffer.concat([local, nameBytes, localPadding, data]); locals.push(entry);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(0x314, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(flags, 8); c.writeUInt16LE(method, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(bytes.length, 24); c.writeUInt16LE(nameBytes.length, 28); c.writeUInt32LE((mode * 65536) >>> 0, 38); c.writeUInt32LE(position, 42); central.push(Buffer.concat([c, nameBytes])); position += entry.length;
  }
  const centralBytes = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(items.length, 8); end.writeUInt16LE(items.length, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(position, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}
function dexWithClasses(classpaths) {
  const descriptors = classpaths.map(name => Buffer.from(`L${name.replaceAll('.', '/')};`));
  const count = descriptors.length, stringOffset = 112, typeOffset = 112 + count * 4, classOffset = typeOffset + count * 4, dataOffset = classOffset + count * 32;
  const bytes = Buffer.alloc(dataOffset + descriptors.reduce((sum, descriptor) => sum + descriptor.length + 2, 0));
  bytes.write('dex\n039\0', 0, 'ascii'); bytes.writeUInt32LE(bytes.length, 32); bytes.writeUInt32LE(112, 36); bytes.writeUInt32LE(0x12345678, 40);
  for (const [offset, value] of [[56, count], [60, stringOffset], [64, count], [68, typeOffset], [96, count], [100, classOffset]]) bytes.writeUInt32LE(value, offset);
  let at = dataOffset;
  descriptors.forEach((descriptor, index) => {
    assert.ok(descriptor.length < 128); bytes.writeUInt32LE(at, stringOffset + index * 4); bytes.writeUInt32LE(index, typeOffset + index * 4); bytes.writeUInt32LE(index, classOffset + index * 32);
    bytes[at++] = descriptor.length; descriptor.copy(bytes, at); at += descriptor.length + 1;
  });
  return bytes;
}
async function syntheticApk(f, mutate = () => {}) {
  const stage = await readJson(path.join(f.runDir, 'android-staging-manifest.json'));
  const items = [];
  for (const name of Object.keys(stage.assetFiles)) items.push({ name: `assets/${name}`, bytes: await fs.readFile(path.join(f.prepared.assetsRoot, name)), method: 8 });
  items.push({ name: 'AndroidManifest.xml', bytes: binaryManifest() });
  items.push({ name: 'assets/native-bridge.js', bytes: await fs.readFile(path.join(f.prepared.apkRoot, 'node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js')) });
  items.push({ name: 'classes.dex', bytes: dexWithClasses([...EXPECTED_PLUGINS.map(plugin => plugin.classpath), 'com.getcapacitor.Bridge']) });
  mutate(items); await put(f.prepared.androidRoot, 'app/build/outputs/apk/release/app-release-unsigned.apk', zip(items));
}

test('prepare copies only current version and full native inputs without source writes/secrets', async t => {
  const f = await fixture(t), prepared = await f.run('prepare:apk', prepareApk);
  const input = await readJson(prepared.inputManifest);
  assert.ok(input.files['apk/android/gradle/wrapper/gradle-wrapper.jar']);
  assert.ok(input.files['apk/android/app/src/main/java/com/jihaitang/jxz/MainActivity.java']);
  for (const name of Object.keys(input.files)) assert.ok(!/node_modules|old-version|other-run|private\.keystore|local\.properties|\/build\/|apk\/www/.test(name), name);
  assert.equal(await fs.readFile(path.join(f.root, 'apk/www/user-original.txt'), 'utf8'), 'must survive');
  assert.equal(await fs.readFile(path.join(f.root, 'apk/android/app/build/outputs/apk/debug/app-debug.apk'), 'utf8'), 'old user debug APK');
  assert.equal(await fs.readFile(path.join(f.root, 'assets/sect3d/old-version/old.glb'), 'utf8'), 'keep old version');
  await assert.rejects(() => f.run('apk:www', (record, context) => buildApkWww(record, context, path.join(f.root, 'apk'))), /prepared isolated copy/);
  const child = spawnSync(process.execPath, [path.join(prepared.apkRoot, 'build.js'), ...f.args], { stdio: 'inherit' }); assert.ifError(child.error); assert.equal(child.status, 0);
  const expected = await readJson(prepared.wwwExpectedManifest);
  assert.equal(expected.mappings['game.html'].source, 'index.html');
  assert.match(await fs.readFile(path.join(prepared.wwwRoot, 'index.html'), 'utf8'), /game\.html\?intent=/);
  assert.match(await fs.readFile(path.join(prepared.wwwRoot, 'start-screen-noST.html'), 'utf8'), /index\.html\?intent=/);
  assert.ok(expected.files['assets/sect3d/synthetic-build/模型/门派.glb']);
  assert.ok(!Object.keys(expected.files).some(name => name.includes('old-version')));
});

test('dialog assets and reviewed root CSS retain exact identity through isolated www and staging', async t => {
  const f = await fixture(t);
  const names = ['module/game-styles-dialogs.css', 'module/game-dialogs.js', 'ui/settings-dialogs.css', 'secondary-pages-responsive.css'];
  for (const name of names) await put(f.root, name, `/* synthetic ${name} */`);
  await put(f.root, 'unreviewed-root.css', 'must not be copied');
  await put(f.root, 'index.html', '<html><link rel="stylesheet" href="module/game-styles-dialogs.css"><link rel="stylesheet" href="ui/settings-dialogs.css"><script src="module/game-dialogs.js"></script></html>');
  await put(f.root, 'farm.html', '<html><link rel="stylesheet" href="./secondary-pages-responsive.css?v=1#test"></html>');
  f.prepared = await f.run('prepare:apk', prepareApk);
  const input = await readJson(f.prepared.inputManifest);
  assert.ok(!Object.hasOwn(input.files, 'unreviewed-root.css'));
  await f.run('apk:www', (record, context) => buildApkWww(record, context, f.prepared.apkRoot));
  const expected = await readJson(f.prepared.wwwExpectedManifest);
  await syntheticSync(f);
  await f.run('verify:staging', verifyStaging);
  const staged = await readJson(path.join(f.runDir, 'android-staging-manifest.json'));
  for (const name of names) {
    const original = await fileInfo(path.join(f.root, name));
    assert.deepEqual(input.files[name], original, `frozen input: ${name}`);
    assert.deepEqual(expected.files[name], original, `www expectation: ${name}`);
    assert.deepEqual(expected.mappings[name], { source: name, transform: 'identity' });
    assert.deepEqual(await fileInfo(path.join(f.prepared.wwwRoot, name)), original);
    assert.deepEqual(staged.assetFiles[`public/${name}`], original, `Android public asset: ${name}`);
  }
  // Post-freeze root-file mutation must not become a self-authorized asset.
  await put(f.prepared.wwwRoot, 'secondary-pages-responsive.css', 'mutated');
  await assert.rejects(() => f.run('verify:staging', verifyStaging), /Byte\/hash mismatch/);
});

test('reviewed root stylesheet is mandatory before the real project can be frozen', async t => {
  const f = await fixture(t);
  await fs.unlink(path.join(f.root, 'secondary-pages-responsive.css'));
  await assert.rejects(() => f.run('prepare:apk', prepareApk), /ENOENT/);
  await assert.rejects(() => fs.stat(path.join(f.runDir, 'apk-input-manifest.json')), /ENOENT/);
  await assert.rejects(() => fs.stat(path.join(f.runDir, 'apk-copy')), /ENOENT/);
});

test('missing mandatory HTML and JavaScript fail without overwriting source staging', async t => {
  const a = await fixture(t); await fs.unlink(path.join(a.root, 'index.html'));
  await assert.rejects(() => a.run('prepare:apk', prepareApk), /ENOENT/);
  const b = await fixture(t); await fs.unlink(path.join(b.root, 'module/required.js'));
  const prepared = await b.run('prepare:apk', prepareApk);
  await assert.rejects(() => b.run('apk:www', (record, context) => buildApkWww(record, context, prepared.apkRoot)), /Missing required local entry resource/);
});

test('staging verifies upstream before recording and rejects unknown/missing/mutated public files', async t => {
  const f = await preparedWww(t); await syntheticSync(f);
  await f.run('verify:staging', verifyStaging);
  const native = path.join(f.prepared.assetsRoot, 'public');
  await put(native, 'cordova_extra.js', 'unexpected');
  await assert.rejects(() => f.run('verify:staging', verifyStaging), /File set mismatch/);
  assert.equal((await f.record()).steps['verify:staging'].status, 'failed');
  await fs.unlink(path.join(native, 'cordova_extra.js'));
  await put(native, 'cordova.js', 'nonempty');
  await assert.rejects(() => f.run('verify:staging', verifyStaging), /Byte\/hash mismatch/);
  await put(native, 'cordova.js', '');
  const model = path.join(native, 'assets/sect3d/synthetic-build/模型/门派.glb');
  const original = await fs.readFile(model); await fs.unlink(model);
  await assert.rejects(() => f.run('verify:staging', verifyStaging), /File set mismatch/);
  await fs.writeFile(model, Buffer.from('wrong model'));
  await assert.rejects(() => f.run('verify:staging', verifyStaging), /Byte\/hash mismatch/);
  await fs.writeFile(model, original); await f.run('verify:staging', verifyStaging);
});

test('untrusted first staging scan never self-authorizes an unexpected file', async t => {
  const f = await preparedWww(t); await syntheticSync(f);
  await put(f.prepared.assetsRoot, 'public/injected-old.js', 'unknown');
  await assert.rejects(() => f.run('verify:staging', verifyStaging), /File set mismatch/);
  await assert.rejects(() => fs.stat(path.join(f.runDir, 'android-staging-manifest.json')), /ENOENT/);
  await assert.rejects(() => f.run('verify:apk', verifyApk), /requires succeeded verify:staging/);
});

test('native config/plugin semantic checks reject remote server, empty plugin assumptions and Gradle drift', async t => {
  const f = await preparedWww(t); await syntheticSync(f);
  const configPath = path.join(f.prepared.assetsRoot, 'capacitor.config.json');
  const config = await readJson(configPath);
  await atomicJson(configPath, { ...config, server: { ...config.server, url: 'https://remote.invalid' } });
  await assert.rejects(() => f.run('verify:staging', verifyStaging), /Remote server/);
  await atomicJson(configPath, config);
  await atomicJson(path.join(f.prepared.assetsRoot, 'capacitor.plugins.json'), []);
  await assert.rejects(() => f.run('verify:staging', verifyStaging), /plugin count/);
  await atomicJson(path.join(f.prepared.assetsRoot, 'capacitor.plugins.json'), EXPECTED_PLUGINS);
  await put(f.prepared.androidRoot, 'app/capacitor.build.gradle', "dependencies { implementation project(':capacitor-filesystem') }");
  await assert.rejects(() => f.run('verify:staging', verifyStaging), /implementation missing/);
  assert.throws(() => validateNativeConfig({ ...config, appId: 'wrong' }), /identity/);
  assert.throws(() => validatePlugins([{ pkg: '@capacitor/filesystem', classpath: 'wrong' }, EXPECTED_PLUGINS[1]]), /classes mismatch/);
});

test('ZIP accepts Chinese stored/deflated data, rejects traversal/case/duplicates/symlink/encryption/CRC', () => {
  const valid = zip([{ name: '模型/门派.glb', bytes: Buffer.from('中文'), method: 8 }, { name: 'a.js', bytes: Buffer.from('a') }]);
  assert.equal(readZip(valid).get('模型/门派.glb').toString(), '中文');
  assert.equal(readZip(zip([{ name: 'zipaligned.png', bytes: Buffer.from('png'), localPadding: Buffer.alloc(3) }])).get('zipaligned.png').toString(), 'png');
  assert.throws(() => readZip(zip([{ name: 'bad-padding', bytes: Buffer.from('x'), localPadding: Buffer.from([1]) }])), /Truncated ZIP extra/);
  assert.throws(() => readZip(zip([{ name: 'A/', bytes: Buffer.alloc(0) }, { name: 'a/x', bytes: Buffer.from('x') }])), /collision/);
  for (const names of [['../evil'], ['%2e%2e/evil'], ['a\\evil'], ['A/x', 'a/y'], ['a', 'a']]) assert.throws(() => readZip(zip(names.map(name => ({ name, bytes: Buffer.from('x') })))));
  assert.throws(() => readZip(zip([{ name: 'link', bytes: Buffer.alloc(0), mode: 0xa1ff }])), /symlink/);
  assert.throws(() => readZip(zip([{ name: 'encrypted', bytes: Buffer.from('x'), flags: 0x801 }])), /Encrypted/);
  const corrupt = zip([{ name: 'a', bytes: Buffer.from('abc') }]); corrupt[31] ^= 1;
  assert.throws(() => readZip(corrupt), /CRC/);
  assert.deepEqual(parseAndroidManifest(binaryManifest()), { applicationId: 'com.jihaitang.jxz', versionCode: 10, versionName: '1.6.3' });
});

test('library bridge contract rejects missing/changed/unrelated extras and requires native Bridge definition', async t => {
  const f = await preparedWww(t); await syntheticSync(f); await f.run('verify:staging', verifyStaging);
  for (const [mutate, pattern] of [
    [items => items.splice(items.findIndex(item => item.name === 'assets/native-bridge.js'), 1), /exact file set.*native-bridge/],
    [items => { items.find(item => item.name === 'assets/native-bridge.js').bytes = Buffer.from('forged bridge'); }, /library native-bridge.js bytes/],
    [items => { const bridge = items.find(item => item.name === 'assets/native-bridge.js'); bridge.bytes[100] ^= 1; }, /library native-bridge.js bytes/],
    [items => items.push({ name: 'assets/native-other.js', bytes: Buffer.from('extra') }), /exact file set.*native-other/],
    [items => { items.find(item => item.name === 'classes.dex').bytes = dexWithClasses(EXPECTED_PLUGINS.map(plugin => plugin.classpath)); }, /Capacitor Bridge class/],
  ]) {
    await syntheticApk(f, mutate); await assert.rejects(() => f.run('verify:apk', verifyApk), pattern);
  }
  await syntheticApk(f); await f.run('verify:apk', verifyApk);
  const report = await readJson(path.join(f.runDir, 'verify-apk.json'));
  assert.equal(report.assetCount, report.stagedAssetCount + 1);
  assert.equal(report.libraryAssetProvenance.sha256, '8ecc290bdd4f54605a6851e73023d4ba5ba0e56aa1d3eba75962242482b8fb4e');
});

test('library allowance requires frozen lock, reviewed source bytes and unchanged Gradle mapping', async t => {
  const f = await preparedWww(t); await syntheticSync(f); await f.run('verify:staging', verifyStaging);
  const input = await readJson(f.prepared.inputManifest), stage = await readJson(path.join(f.runDir, 'android-staging-manifest.json'));
  const check = () => verifyLibraryAssetProvenance(f.prepared, input, stage);
  await check();
  for (const [relative, replacement, pattern] of [
    ['package-lock.json', '{}', /frozen lock/],
    ['node_modules/@capacitor/android/package.json', '{"name":"@capacitor/android","version":"9.0.0","files":["capacitor/src/main/"]}', /package structure/],
    ['node_modules/@capacitor/android/capacitor/build.gradle', "apply plugin: 'com.android.library'", /reviewed library Gradle/],
    ['node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js', 'forged source even if APK agrees', /reviewed native-bridge/],
    ['android/capacitor.settings.gradle', "include ':capacitor-android'", /staged settings/],
    ['android/app/build.gradle', "implementation project(':capacitor-android')", /frozen app Gradle/],
  ]) {
    const filename = path.join(f.prepared.apkRoot, relative), original = await fs.readFile(filename);
    try { await fs.writeFile(filename, replacement); await assert.rejects(check, pattern); }
    finally { await fs.writeFile(filename, original); }
  }
  const lockPath = path.join(f.prepared.apkRoot, 'package-lock.json'), originalLock = await fs.readFile(lockPath);
  try {
    const lock = JSON.parse(originalLock); lock.packages['node_modules/@capacitor/android'].integrity = 'sha512-forged';
    await atomicJson(lockPath, lock);
    const forgedInput = structuredClone(input); forgedInput.files['apk/package-lock.json'] = await fileInfo(lockPath);
    await assert.rejects(() => verifyLibraryAssetProvenance(f.prepared, forgedInput, stage), /reviewed lock provenance/);
  } finally { await fs.writeFile(lockPath, originalLock); }
  // Even re-hashing a changed mapping in evidence cannot authorize a different library.
  const settingsPath = path.join(f.prepared.androidRoot, 'capacitor.settings.gradle'), originalSettings = await fs.readFile(settingsPath);
  try {
    await fs.writeFile(settingsPath, originalSettings.toString().replace('../node_modules/@capacitor/android/capacitor', '../untrusted/capacitor'));
    const forgedStage = structuredClone(stage); forgedStage.gradleEvidence.settings = await fileInfo(settingsPath);
    await assert.rejects(() => verifyLibraryAssetProvenance(f.prepared, input, forgedStage), /source mapping/);
  } finally { await fs.writeFile(settingsPath, originalSettings); }
  const badVersion = structuredClone(stage); badVersion.native.dependencyVersions['@capacitor/android'] = '8.5.0';
  await assert.rejects(() => verifyLibraryAssetProvenance(f.prepared, input, badVersion), /Unreviewed/);
  const collision = structuredClone(stage); collision.assetFiles['native-bridge.js'] = { bytes: 1, sha256: 'forged' };
  await assert.rejects(() => verifyLibraryAssetProvenance(f.prepared, input, collision), /collides/);
  await check();
});

test('APK verifies exact ZIP against prior staging and rejects missing model, old bundle, changed identity/plugins', async t => {
  const f = await preparedWww(t); await syntheticSync(f); await f.run('verify:staging', verifyStaging);
  await syntheticApk(f); await f.run('verify:apk', verifyApk);
  await syntheticApk(f, items => items.splice(items.findIndex(item => item.name.endsWith('门派.glb')), 1));
  await assert.rejects(() => f.run('verify:apk', verifyApk), /exact file set/);
  await syntheticApk(f, items => items.push({ name: 'assets/public/old-bundle.js', bytes: Buffer.from('stale') }));
  await assert.rejects(() => f.run('verify:apk', verifyApk), /exact file set/);
  await syntheticApk(f, items => { items.find(item => item.name.endsWith('门派.glb')).bytes = Buffer.from('changed'); });
  await assert.rejects(() => f.run('verify:apk', verifyApk), /asset bytes/);
  await syntheticApk(f, items => { items.find(item => item.name === 'AndroidManifest.xml').bytes = binaryManifest({ versionCode: 99 }); });
  await assert.rejects(() => f.run('verify:apk', verifyApk), /application\/version/);
  await syntheticApk(f, items => { items.find(item => item.name === 'classes.dex').bytes = dexWithClasses(['some.unrelated.Class']); });
  await assert.rejects(() => f.run('verify:apk', verifyApk), /class definition missing/);
  await syntheticApk(f); await f.run('verify:apk', verifyApk);
  assert.equal(await fs.readFile(path.join(f.root, 'apk/android/app/build/outputs/apk/debug/app-debug.apk'), 'utf8'), 'old user debug APK');
});
