/**
 * gen-icons.js - 从源图片生成所有尺寸的 Android 图标
 * 用法：node gen-icons.js
 * 依赖：sharp（npm install sharp --save-dev）
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SRC = path.join(__dirname, '..', 'assets', 'image', 'static', '游戏logo.png');
const RES = path.join(__dirname, 'android', 'app', 'src', 'main', 'res');

// 各密度目录对应的图标尺寸
const CONFIGS = [
    { dir: 'mipmap-mdpi',    size: 48  },
    { dir: 'mipmap-hdpi',    size: 72  },
    { dir: 'mipmap-xhdpi',   size: 96  },
    { dir: 'mipmap-xxhdpi',  size: 144 },
    { dir: 'mipmap-xxxhdpi', size: 192 },
];

// 前景图（adaptive icon）留白10%，尺寸为108dp（anydpi-v26规范）
const FOREGROUND_SIZE = 108;

async function main() {
    if (!fs.existsSync(SRC)) {
        console.error('[gen-icons] 找不到源图片: ' + SRC);
        process.exit(1);
    }

    console.log('[gen-icons] 源图片: ' + SRC);

    for (const cfg of CONFIGS) {
        const destDir = path.join(RES, cfg.dir);
        fs.mkdirSync(destDir, { recursive: true });

        // ic_launcher.png（方形图标）
        await sharp(SRC)
            .resize(cfg.size, cfg.size, { fit: 'cover' })
            .png()
            .toFile(path.join(destDir, 'ic_launcher.png'));

        // ic_launcher_round.png（圆形裁剪）
        const circle = Buffer.from(
            `<svg><circle cx="${cfg.size / 2}" cy="${cfg.size / 2}" r="${cfg.size / 2}"/></svg>`
        );
        await sharp(SRC)
            .resize(cfg.size, cfg.size, { fit: 'cover' })
            .composite([{ input: circle, blend: 'dest-in' }])
            .png()
            .toFile(path.join(destDir, 'ic_launcher_round.png'));

        // ic_launcher_foreground.png（adaptive icon 前景，带留白）
        const padding = Math.round(cfg.size * 0.1);
        const innerSize = cfg.size - padding * 2;
        await sharp(SRC)
            .resize(innerSize, innerSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .extend({ top: padding, bottom: padding, left: padding, right: padding, background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toFile(path.join(destDir, 'ic_launcher_foreground.png'));

        console.log(`  [${cfg.dir}] ${cfg.size}x${cfg.size} 完成`);
    }

    console.log('[gen-icons] 全部图标生成完成！');
}

main().catch(function(e) {
    console.error('[gen-icons] 失败:', e.message);
    process.exit(1);
});
