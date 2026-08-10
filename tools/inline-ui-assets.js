/*
 * inline-ui-assets.js
 * ------------------------------------------------------------
 * 将 module/game-styles-beautify.css 中引用的 assets/ui 图标/纹样
 * 全部内联为 data-URI（CSS 变量注册表），并把 @font-face 拆分到
 * module/game-styles-fonts.css。
 *
 * 原因：file:// 协议下浏览器以 CORS 拦截 CSS 引用的外部子资源
 * （mask-image 的 SVG、@font-face 的字体），导致双击打开 index.html
 * 时控制台大量报错。内联 + 字体条件加载后：
 *   双击 file:// 打开 / 本地 http 服务器 / Capacitor APK WebView
 * 三种环境均零报错。
 *
 * 用法：node tools/inline-ui-assets.js
 * 幂等：可重复运行（重复运行时找不到 ../assets/ui/ 引用，仅重建字体拆分）。
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const cssPath = path.join(root, 'module', 'game-styles-beautify.css');
const fontsPath = path.join(root, 'module', 'game-styles-fonts.css');

let css = fs.readFileSync(cssPath, 'utf8');

/* ---------- 1. 拆分 @font-face ---------- */
const fontFaceRe = /@font-face\s*\{[^}]*\}\s*/g;
const faces = css.match(fontFaceRe) || [];

if (faces.length > 0) {
    const fontsCss =
`/*
 * ============================================================
 * 姬侠传 字体注册（game-styles-fonts.css）
 * ------------------------------------------------------------
 * 由 index.html 中的条件脚本加载：file:// 协议下跳过
 * （浏览器 CORS 会拦截 file:// 字体子资源，且 3 个 TTF 约 19.5MB
 * 不适合内联），此时自动回退本地楷体/衬线字体。
 * http/https/Capacitor WebView 环境正常加载。
 * ============================================================
 */

${faces.join('\n')}`;
    fs.writeFileSync(fontsPath, fontsCss);
    console.log(`[fonts] 拆出 ${faces.length} 个 @font-face -> module/game-styles-fonts.css`);
} else {
    console.log('[fonts] 未找到 @font-face（可能已拆分过），跳过');
}

/* 用说明注释替换原“1. 本地字体注册”整节（含 @font-face 块） */
const section1Re = /\/\* =+ 1\. 本地字体注册[\s\S]*?(?=\/\* =+ 2\.)/;
const section1Note =
`/* ============ 1. 素材加载策略说明 ============
 * 图标/纹样：全部以 data-URI 内联在下方注册表（原 SVG 保留于 assets/ui/ 供署名与再编辑）。
 * 字体：@font-face 已移至 module/game-styles-fonts.css，由 index.html 条件脚本加载。
 * 原因：file:// 协议下浏览器以 CORS 拦截 CSS 引用的外部字体与 mask-image SVG，
 *       内联 + 条件加载后，双击打开 / 本地服务器 / APK WebView 三种环境均零报错。
 */

`;
if (section1Re.test(css)) {
    css = css.replace(section1Re, section1Note);
} else {
    // 已替换过时，单独清掉残留的 @font-face
    css = css.replace(fontFaceRe, '');
}

/* ---------- 2. 内联 SVG 为 data-URI 注册表 ---------- */
function svgToDataUri(svg) {
    const s = svg
        .replace(/<!--[\s\S]*?-->/g, '')   // 去注释
        .replace(/\r?\n+/g, ' ')           // 折叠换行
        .replace(/\s{2,}/g, ' ')           // 折叠空白
        .replace(/>\s+</g, '><')           // 标签间空白
        .replace(/"/g, "'")                // CSS url 用双引号包裹，内部改单引号
        .trim();
    return 'data:image/svg+xml,' + s
        .replace(/%/g, '%25')
        .replace(/</g, '%3C')
        .replace(/>/g, '%3E')
        .replace(/#/g, '%23')
        .replace(/[^\x00-\x7F]/g, c => encodeURIComponent(c));
}

const refRe = /url\((['"]?)\.\.\/assets\/ui\/((?:icons|decor)\/[^'")]+?\.svg)\1\)/g;
const registry = new Map(); // varName -> dataUri
let missCount = 0;

css = css.replace(refRe, (match, _q, rel) => {
    const varName = '--be-i-' + rel.replace(/\.svg$/i, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    if (!registry.has(varName)) {
        const abs = path.join(root, 'assets', 'ui', rel);
        if (!fs.existsSync(abs)) {
            console.warn(`[warn] 文件不存在，保留原引用: ${rel}`);
            missCount++;
            return match;
        }
        registry.set(varName, svgToDataUri(fs.readFileSync(abs, 'utf8')));
    }
    return `var(${varName})`;
});

if (registry.size > 0) {
    let totalBytes = 0;
    const lines = [];
    for (const [name, uri] of [...registry.entries()].sort()) {
        lines.push(`    ${name}: url("${uri}");`);
        totalBytes += uri.length;
    }
    const registryBlock =
`/* ---- 内联 SVG 注册表（由 tools/inline-ui-assets.js 生成，请勿手改） ---- */
:root {
${lines.join('\n')}
}

`;
    // 插入到“图标系统底座”一节之前；若已存在旧注册表则先删除
    css = css.replace(/\/\* ---- 内联 SVG 注册表[\s\S]*?\}\n\n/, '');
    const anchor = css.indexOf('/* ============ 3. 图标系统底座');
    if (anchor === -1) {
        throw new Error('未找到“3. 图标系统底座”锚点，无法插入注册表');
    }
    css = css.slice(0, anchor) + registryBlock + css.slice(anchor);
    console.log(`[icons] 内联 ${registry.size} 个 SVG，data-URI 共 ${(totalBytes / 1024).toFixed(1)} KB`);
} else {
    console.log('[icons] 未发现 ../assets/ui/ 引用（可能已内联过），跳过');
}

fs.writeFileSync(cssPath, css);
console.log(`[done] game-styles-beautify.css 更新完成${missCount ? `，${missCount} 个缺失文件保留原引用` : ''}`);
