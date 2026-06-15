/**
 * build.js - 将游戏文件镜像到 www/ 目录供 Capacitor 打包
 * 用法：node build.js
 * 或通过 npm run build 调用
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');   // 游戏源文件根目录
const DEST = path.join(__dirname, 'www'); // 打包暂存目录

// 需要复制到 www/ 的目录和文件
const INCLUDE_DIRS = [
    'module',
    'assets',
    'img',
    'bgm',
    'music',
    'worker',
    'ui',
    'tools',
];

// APK 文件映射：{ 源文件: 目标文件名 }（Capacitor 入口固定为 index.html）
const INCLUDE_FILES = [
    { src: 'start-screen-noST.html', dest: 'index.html' }, // APK 入口
    { src: 'index.html',            dest: 'game.html'  }, // 主游戏
    { src: 'start-screen-noST.html', dest: 'start-screen-noST.html' },
    { src: 'start-screen.html',      dest: 'start-screen.html'     },
    { src: 'world_map.html',           dest: 'world_map.html'           },
    { src: 'turn-based-battle.html',     dest: 'turn-based-battle.html'   },
    { src: 'turn-based-battle-new.html', dest: 'turn-based-battle-new.html' },
    { src: 'alchemy.html',               dest: 'alchemy.html'             },
    { src: 'blackjack.html',             dest: 'blackjack.html'           },
    { src: 'farm.html',                  dest: 'farm.html'                },
];

// 排除目录（不复制）
const EXCLUDE_DIRS = new Set([
    'android',
    'node_modules',
    'www',
    '.git',
    'history_version',
    'char_card_information',
    '开发文档',
    '技能系统相关文档和脚本',
    'TavernHeadless',
]);

function copyFileSync(src, dest) {
    const destDir = path.dirname(dest);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, dest);
}

function copyDirSync(src, dest) {
    if (!fs.existsSync(src)) {
        console.warn(`  [跳过] 目录不存在: ${src}`);
        return;
    }
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            if (EXCLUDE_DIRS.has(entry.name)) continue;
            copyDirSync(srcPath, destPath);
        } else {
            copyFileSync(srcPath, destPath);
        }
    }
}

function cleanDir(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name === '.gitkeep') continue;
        const p = path.join(dir, entry.name);
        fs.rmSync(p, { recursive: true, force: true });
    }
}

console.log('[build] 清理 www/ ...');
cleanDir(DEST);

console.log('[build] 复制目录...');
for (const dir of INCLUDE_DIRS) {
    const src = path.join(ROOT, dir);
    const dest = path.join(DEST, dir);
    process.stdout.write(`  ${dir}/ ...`);
    copyDirSync(src, dest);
    console.log(' 完成');
}

console.log('[build] 复制 HTML 文件...');
const copiedDest = new Set();
for (const entry of INCLUDE_FILES) {
    const { src, dest } = entry;
    if (copiedDest.has(dest)) continue; // 同一目标只写一次
    const srcPath = path.join(ROOT, src);
    if (!fs.existsSync(srcPath)) {
        console.warn(`  [跳过] 文件不存在: ${src}`);
        continue;
    }
    copyFileSync(srcPath, path.join(DEST, dest));
    console.log(`  ${src} → ${dest}`);
    copiedDest.add(dest);
}

console.log('[build] APK 入口: index.html=开局界面, game.html=主游戏');

// 修正开局界面内的跳转目标：index.html?intent= → game.html?intent=
const entryPath = path.join(DEST, 'index.html');
const entryContent = fs.readFileSync(entryPath, 'utf8')
    .replace(/(['"`])index\.html\?intent=/g, '$1game.html?intent=');
fs.writeFileSync(entryPath, entryContent, 'utf8');

console.log('[build] 完成！www/ 目录已更新。');
console.log('[build] 下一步运行: npx cap sync android');
