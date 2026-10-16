import fs from 'node:fs/promises';
import path from 'node:path';
import { assert, absolute, safeRelative, uniquePaths, noSymlinks, exists, fileInfo, readJson, atomicJson, copyFiles, verifyFiles, verifyRelease, sha256 } from './artifact-utils.mjs';
import { withRun, requireStep, isMain, runCli } from './run-record.mjs';

export const WEB_DIRS = ['module', 'assets', 'img', 'bgm', 'music', 'worker', 'ui', 'tools'];
// Root resources are reviewed explicitly: never copy arbitrary root files/secrets.
// Unlike module/ui descendants these are not covered by the recursive WEB_DIRS.
export const WEB_ROOT_FILES = ['secondary-pages-responsive.css'];
export const HTML_MAPPING = [
  ['start-screen-noST.html', 'index.html'], ['index.html', 'game.html'],
  ...['start-screen-noST.html', 'start-screen.html', 'world_map.html', 'turn-based-battle.html', 'turn-based-battle-new.html', 'alchemy.html', 'blackjack.html', 'farm.html'].map(name => [name, name])
];
export const EXPECTED_PLUGINS = [
  { pkg: '@capacitor/filesystem', classpath: 'com.capacitorjs.plugins.filesystem.FilesystemPlugin' },
  { pkg: '@capacitor/share', classpath: 'com.capacitorjs.plugins.share.SharePlugin' }
];
const EXCLUDE_DIRS = new Set(['node_modules', 'build', 'www', '.git', '.gradle', '.idea', '.kotlin', '.scene3d-work', 'history_version', 'char_card_information', '开发文档', '技能系统相关文档和脚本', 'TavernHeadless']);
const SECRET_FILE = /(?:^\.env(?:\.|$)|^\.npmrc$|\.(?:jks|keystore|p12|pfx|pem|key|apk|aab)$|^(?:google-services\.json|key\.properties|keystore\.properties|local\.properties)$)/i;
const APK_ROOT_FILES = ['build.js', 'gen-icons.js', 'capacitor.config.json', 'package.json', 'package-lock.json'];
const ANDROID_ROOT_FILES = ['build.gradle', 'settings.gradle', 'variables.gradle', 'gradle.properties', 'gradlew', 'gradlew.bat', 'capacitor.settings.gradle'];
const ANDROID_APP_FILES = ['build.gradle', 'capacitor.build.gradle', 'proguard-rules.pro'];
export const EMPTY_FILE_INFO = { bytes: 0, sha256: sha256(Buffer.alloc(0)) };
export function canonical(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(item => JSON.parse(canonical(item))));
  if (value && typeof value === 'object') return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])));
  return JSON.stringify(value);
}
export function validateNativeConfig(config, expected = undefined) {
  assert(config?.appId === 'com.jihaitang.jxz' && config.appName === '瀚海', 'Native application identity mismatch');
  assert(config.webDir === 'www' && config.server?.androidScheme === 'https' && config.server?.hostname === 'localhost', 'Native local HTTPS/webDir mismatch');
  assert(!Object.hasOwn(config.server, 'url'), 'Remote server.url prohibited');
  if (expected) assert(canonical(config) === canonical(expected), 'Native Capacitor config semantics changed');
  return config;
}
export function validatePlugins(plugins) {
  assert(Array.isArray(plugins) && plugins.length === EXPECTED_PLUGINS.length, 'Native plugin count mismatch');
  const sorted = [...plugins].sort((a, b) => String(a.pkg).localeCompare(String(b.pkg)));
  assert(canonical(sorted) === canonical(EXPECTED_PLUGINS), 'Native Filesystem/Share plugin classes mismatch');
}
export function parseGradleIdentity(code) {
  const applicationId = /\bapplicationId\s*(?:=\s*)?["']([^"']+)["']/.exec(code)?.[1];
  const versionCode = Number(/\bversionCode\s*(?:=\s*)?(\d+)/.exec(code)?.[1]);
  const versionName = /\bversionName\s*(?:=\s*)?["']([^"']+)["']/.exec(code)?.[1];
  assert(applicationId === 'com.jihaitang.jxz' && versionCode === 6 && versionName === '1.5', 'Unapproved Android application/version change');
  return { applicationId, versionCode, versionName };
}
export function apkPaths(record, runDir) {
  const isolatedRoot = path.join(runDir, 'apk-copy');
  const apkRoot = path.join(isolatedRoot, 'apk'), androidRoot = path.join(apkRoot, 'android');
  return { isolatedRoot, apkRoot, androidRoot, wwwRoot: path.join(apkRoot, 'www'), assetsRoot: path.join(androidRoot, 'app/src/main/assets'), apkPath: path.join(androidRoot, 'app/build/outputs/apk/debug/app-debug.apk'), wwwExpectedManifest: path.join(runDir, 'www-expected-manifest.json') };
}
export async function loadPrepared(record, runDir) {
  const prepared = requireStep(record, 'prepare:apk');
  const expected = apkPaths(record, runDir);
  for (const [key, value] of Object.entries(expected)) assert(prepared[key] === value, `Prepared APK path mismatch: ${key}`);
  assert(prepared.inputManifest === path.join(runDir, 'apk-input-manifest.json'), 'APK input manifest path mismatch');
  assert((await fileInfo(prepared.inputManifest)).sha256 === prepared.inputManifestSha256, 'APK input manifest changed');
  const input = await readJson(prepared.inputManifest);
  assert(input.schemaVersion === 1 && input.buildId === record.buildId && input.runId === record.runId, 'APK input run mismatch');
  for (const value of Object.values(expected)) { absolute(value); await noSymlinks(value); }
  return { prepared, input, paths: expected };
}
async function collectTree(root, relative, files, { exclude3d = false, excludeNativeAssets = false } = {}) {
  const full = path.join(root, relative); await noSymlinks(full);
  assert((await fs.stat(full)).isDirectory(), `Required source directory absent: ${relative}`);
  for (const item of await fs.readdir(full, { withFileTypes: true })) {
    const name = `${relative}/${item.name}`.replaceAll('\\', '/');
    if (EXCLUDE_DIRS.has(item.name) || item.name.startsWith('.') || SECRET_FILE.test(item.name)) continue;
    if (exclude3d && name === 'assets/sect3d') continue;
    // User-supplied design reference, not a runtime game asset.
    if (name === 'assets/image/others/UI设计方案.png') continue;
    if (excludeNativeAssets && name.startsWith('apk/android/app/src/main/assets')) continue;
    safeRelative(name); assert(!item.isSymbolicLink(), `Source symlink prohibited: ${name}`);
    if (item.isDirectory()) await collectTree(root, name, files, { exclude3d, excludeNativeAssets });
    else { assert(item.isFile(), `Nonregular source: ${name}`); files[name] = await fileInfo(path.join(root, name)); }
  }
}
async function addRequired(root, name, files) { files[name] = await fileInfo(path.join(root, ...name.split('/'))); }
async function frozenRelease(record) {
  const built = requireStep(record, 'build'), published = requireStep(record, 'publish:assets');
  const pointerPath = path.join(record.publishRoot, 'current.json');
  const pointerInfo = await fileInfo(pointerPath), pointer = await readJson(pointerPath);
  assert(pointerInfo.sha256 === published.pointerSha256, 'Current pointer differs from this run');
  assert(pointer.schemaVersion === 1 && pointer.buildId === record.buildId && pointer.manifest === `${record.buildId}/manifest.json` && pointer.manifestSha256 === built.manifestSha256, 'Pointer build/manifest mismatch');
  assert(pointer.bridgeProtocol?.min === 1 && pointer.bridgeProtocol?.max === 1, 'Pointer protocol mismatch');
  const root = path.join(record.publishRoot, record.buildId);
  const { manifest } = await verifyRelease(root, record.buildId, built.manifestSha256);
  return { pointer, pointerInfo, manifest, manifestInfo: await fileInfo(path.join(root, 'manifest.json')) };
}
export async function prepareApk(record, { runDir }) {
  const paths = apkPaths(record, runDir);
  const stage = path.join(runDir, 'apk-copy-stage');
  await noSymlinks(stage); assert(!await exists(stage) && !await exists(paths.isolatedRoot), 'APK copy already exists; never overwrite a previous copy');
  const release = await frozenRelease(record), files = Object.create(null);
  for (const dir of WEB_DIRS) await collectTree(record.projectRoot, dir, files, { exclude3d: true });
  for (const source of new Set([...HTML_MAPPING.map(([name]) => name), ...WEB_ROOT_FILES])) await addRequired(record.projectRoot, source, files);
  for (const name of APK_ROOT_FILES) await addRequired(record.projectRoot, `apk/${name}`, files);
  for (const name of ANDROID_ROOT_FILES) await addRequired(record.projectRoot, `apk/android/${name}`, files);
  for (const name of ANDROID_APP_FILES) await addRequired(record.projectRoot, `apk/android/app/${name}`, files);
  for (const dir of ['apk/android/gradle', 'apk/android/app/src']) await collectTree(record.projectRoot, dir, files, { excludeNativeAssets: true });
  for (const dir of ['apk/android/app/libs', 'apk/android/capacitor-cordova-android-plugins']) if (await exists(path.join(record.projectRoot, dir))) await collectTree(record.projectRoot, dir, files);
  for (const dir of ['scene3d/src', 'scene3d/scripts']) await collectTree(record.projectRoot, dir, files);
  for (const name of ['scene3d/package.json', 'scene3d/package-lock.json', 'scene3d/vite.config.js']) await addRequired(record.projectRoot, name, files);
  for (const name of ['apk/android/gradle/wrapper/gradle-wrapper.jar', 'apk/android/gradle/wrapper/gradle-wrapper.properties', 'apk/android/app/src/main/AndroidManifest.xml']) assert(Object.hasOwn(files, name), `Required native build input absent: ${name}`);
  files['assets/sect3d/current.json'] = release.pointerInfo;
  files[`assets/sect3d/${record.buildId}/manifest.json`] = release.manifestInfo;
  for (const [name, info] of Object.entries(release.manifest.files)) files[`assets/sect3d/${record.buildId}/${name}`] = info;
  uniquePaths(Object.keys(files));
  const config = validateNativeConfig(await readJson(path.join(record.projectRoot, 'apk/capacitor.config.json')));
  const identity = parseGradleIdentity(await fs.readFile(path.join(record.projectRoot, 'apk/android/app/build.gradle'), 'utf8'));
  const lock = await readJson(path.join(record.projectRoot, 'apk/package-lock.json'));
  const cliVersion = lock.packages?.['node_modules/@capacitor/cli']?.version;
  assert(cliVersion === '8.4.0', `Unreviewed Capacitor CLI version: ${cliVersion}`);
  const packageJson = await readJson(path.join(record.projectRoot, 'apk/package.json'));
  assert(Object.keys(packageJson.dependencies || {}).every(name => ['@capacitor/android', '@capacitor/cli', '@capacitor/core', '@capacitor/filesystem', '@capacitor/share'].includes(name)), 'Unreviewed APK runtime dependency/Cordova plugin');
  for (const name of ['@capacitor/android', '@capacitor/core', '@capacitor/cli', ...EXPECTED_PLUGINS.map(plugin => plugin.pkg)]) assert(lock.packages?.[`node_modules/${name}`]?.version && packageJson.dependencies?.[name], `Native dependency missing: ${name}`);
  const input = { schemaVersion: 1, runId: record.runId, buildId: record.buildId, sourceRoot: record.projectRoot, files, release: { pointer: release.pointer, manifest: release.manifest }, native: { config, identity, plugins: EXPECTED_PLUGINS, capacitorCliVersion: cliVersion, dependencyVersions: Object.fromEntries(Object.keys(packageJson.dependencies).map(name => [name, lock.packages[`node_modules/${name}`]?.version])) }, exclusions: [...EXCLUDE_DIRS, 'secrets/keyfiles', 'local.properties', 'native generated assets', 'noncurrent sect3d versions'] };
  const inputManifest = path.join(runDir, 'apk-input-manifest.json');
  await atomicJson(inputManifest, input, { exclusive: true });
  await fs.mkdir(stage); await copyFiles(record.projectRoot, stage, files); await verifyFiles(stage, files);
  // No npm, Capacitor, Gradle, signing, installation, or writes to source apk/www occur here.
  await fs.rename(stage, paths.isolatedRoot);
  return { ...paths, inputManifest, inputManifestSha256: (await fileInfo(inputManifest)).sha256, sourceFileCount: Object.keys(files).length, next: 'Run the copied apk/build.js with this same --runRecord; then npm ci and cap sync in the copy. Supply SDK via ANDROID_HOME/ANDROID_SDK_ROOT; machine local.properties is intentionally excluded.' };
}
function verifyLocalEntrypointReferences(files, html, filename) {
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const url = match[1];
    if (/^(?:https?:|data:|\/\/|#)/i.test(url)) continue;
    const relative = decodeURIComponent(url.split(/[?#]/)[0]).replace(/^\.\//, '');
    if (!relative) continue;
    safeRelative(relative);
    assert(Object.hasOwn(files, relative), `Missing required local entry resource in ${filename}: ${relative}`);
  }
}
export async function buildApkWww(record, { runDir }, invokedApkRoot) {
  const { input, paths } = await loadPrepared(record, runDir);
  assert(absolute(invokedApkRoot) === paths.apkRoot, 'apk/build.js must execute from the prepared isolated copy, not source apk/www');
  assert(!await exists(paths.wwwRoot), 'Isolated www already exists; refuse implicit cleanup or overwrite');
  const expected = Object.create(null), mappings = Object.create(null), rewritten = new Map();
  for (const [name, info] of Object.entries(input.files)) {
    if (!WEB_ROOT_FILES.includes(name) && !WEB_DIRS.some(dir => name.startsWith(`${dir}/`))) continue;
    expected[name] = info; mappings[name] = { source: name, transform: 'identity' };
  }
  for (const [source, destination] of HTML_MAPPING) {
    const info = input.files[source]; assert(info, `Required HTML missing: ${source}`);
    const bytes = await fs.readFile(path.join(paths.isolatedRoot, source));
    assert(sha256(bytes) === info.sha256 && bytes.length === info.bytes, `Prepared HTML changed: ${source}`);
    const output = destination === 'index.html' ? Buffer.from(bytes.toString('utf8').replace(/(['"`])index\.html\?intent=/g, '$1game.html?intent=')) : bytes;
    verifyLocalEntrypointReferences(input.files, output.toString('utf8'), source);
    expected[destination] = { bytes: output.length, sha256: sha256(output) };
    mappings[destination] = { source, transform: destination === 'index.html' ? 'start-index-intent-to-game' : 'identity' };
    rewritten.set(destination, output);
  }
  uniquePaths(Object.keys(expected));
  const stage = path.join(paths.apkRoot, 'www-stage'); await noSymlinks(stage);
  assert(!await exists(stage), 'Partial www stage exists; explicit review/new run required');
  await fs.mkdir(stage);
  for (const [destination, info] of Object.entries(expected)) {
    if (rewritten.has(destination)) continue;
    await copyFiles(paths.isolatedRoot, stage, { [destination]: info });
  }
  for (const [destination, bytes] of rewritten) await fs.writeFile(path.join(stage, destination), bytes, { flag: 'wx' });
  await verifyFiles(stage, expected);
  const pointer = await readJson(path.join(stage, 'assets/sect3d/current.json'));
  assert(canonical(pointer) === canonical(input.release.pointer), 'Prepared pointer changed');
  await verifyRelease(path.join(stage, 'assets/sect3d', record.buildId), record.buildId, pointer.manifestSha256);
  const manifest = { schemaVersion: 1, runId: record.runId, buildId: record.buildId, wwwRoot: paths.wwwRoot, files: expected, mappings, native: input.native, release: { pointer, manifestSha256: pointer.manifestSha256 } };
  await atomicJson(paths.wwwExpectedManifest, manifest, { exclusive: true });
  await fs.rename(stage, paths.wwwRoot);
  return { wwwRoot: paths.wwwRoot, wwwExpectedManifest: paths.wwwExpectedManifest, wwwExpectedManifestSha256: (await fileInfo(paths.wwwExpectedManifest)).sha256, fileCount: Object.keys(expected).length };
}
export async function loadWwwExpected(record, runDir) {
  const prepared = await loadPrepared(record, runDir), built = requireStep(record, 'apk:www');
  assert(built.wwwExpectedManifest === prepared.paths.wwwExpectedManifest, 'www expectation path mismatch');
  assert((await fileInfo(built.wwwExpectedManifest)).sha256 === built.wwwExpectedManifestSha256, 'www expected manifest changed');
  const expected = await readJson(built.wwwExpectedManifest);
  assert(expected.schemaVersion === 1 && expected.runId === record.runId && expected.buildId === record.buildId && expected.wwwRoot === prepared.paths.wwwRoot, 'www expected run mismatch');
  return { ...prepared, expected, built };
}
if (isMain(import.meta.url)) runCli(() => withRun('prepare:apk', prepareApk));
