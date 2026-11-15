/** Offline fixture dependencies; optional Git-blob source mode makes baseline comparisons reproducible. */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const cache = new Map();
export function readSource(name) {
    if (!/^(?:module\/[^/]+\.js|char_card_information\/[^/]+\.txt|index\.html|turn-based-battle-new\.html)$/.test(name)) {
        throw new Error(`Unsupported fixture source: ${name}`);
    }
    const revision = process.env.JXZ_TEST_SOURCE_REV;
    if (!revision) return fs.readFileSync(new URL(name, root), 'utf8');
    if (!/^[0-9a-f]{40}$/i.test(revision)) throw new Error('JXZ_TEST_SOURCE_REV must be an exact local Git commit hash');
    const key = `${revision}:${name}`;
    if (!cache.has(key)) cache.set(key, execFileSync('git', ['show', key], {
        cwd:fileURLToPath(root), encoding:'utf8', maxBuffer:8 * 1024 * 1024,
        stdio:['ignore', 'pipe', 'pipe']
    }));
    return cache.get(key);
}

export function loadBackgroundPromptBuilder(context) {
    // Keep the existing main-turn prompt spy: these tests isolate pipeline timing, not main prompt assembly.
    // The missing dependency is the real six-message background builder, used by rumor/tree/judge calls.
    const mainPromptSpy = context.promptBuilder?.buildMessages;
    const deployed = { window:{} };
    vm.runInNewContext(readSource('module/prompt-data-extra.js'), deployed, {filename:'prompt-data-extra.js'});
    context.PROMPT_NY_ASSISTANT_PREFILL = deployed.window.PROMPT_NY_ASSISTANT_PREFILL;
    context.PROMPT_FINAL_INSTRUCTION = deployed.window.PROMPT_FINAL_INSTRUCTION;
    vm.runInNewContext(readSource('module/prompt-builder.js'), context, {filename:'prompt-builder.js'});
    if (mainPromptSpy) context.promptBuilder.buildMessages = mainPromptSpy;
}

export function testAssetRoot() {
    if (!process.env.JXZ_TEST_ASSET_ROOT) return root;
    const directory = path.resolve(process.env.JXZ_TEST_ASSET_ROOT);
    const gitTree = (cwd, revision) => execFileSync('git', ['rev-parse', `${revision}:img`], {
        cwd, encoding:'utf8', stdio:['ignore', 'pipe', 'pipe']
    }).trim();
    // A sparse source worktree may share another checkout's unchanged image tree, not unrelated art.
    assert.equal(gitTree(directory, 'HEAD'), gitTree(fileURLToPath(root), process.env.JXZ_TEST_SOURCE_REV || 'HEAD'),
        'shared image checkout must have the same Git img tree as the tested source revision');
    return pathToFileURL(directory + path.sep);
}
