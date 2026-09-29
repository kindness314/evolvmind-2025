/**
 * 生成 Android 启动图标(mipmap 各密度 + 自适应图标前景)
 * 输入: public/icons 的 SVG 同款图形;输出到 android/app/src/main/res/
 * 用法: node scripts/generate-android-icons.mjs
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const glyph = `
  <g stroke="rgba(255,255,255,0.85)" stroke-width="6" fill="white">
    <line x1="128" y1="150" x2="196" y2="108"/>
    <line x1="128" y1="150" x2="196" y2="192"/>
    <line x1="128" y1="150" x2="60"  y2="108"/>
    <line x1="128" y1="150" x2="60"  y2="192"/>
    <line x1="196" y1="108" x2="196" y2="192" opacity="0.6"/>
    <line x1="60"  y1="108" x2="60"  y2="192" opacity="0.6"/>
    <circle cx="128" cy="150" r="26" stroke="none"/>
    <circle cx="196" cy="108" r="16" stroke="none"/>
    <circle cx="196" cy="192" r="16" stroke="none"/>
    <circle cx="60"  cy="108" r="16" stroke="none"/>
    <circle cx="60"  cy="192" r="16" stroke="none"/>
  </g>`;

const base = (extra = '') => Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a84ff"/>
      <stop offset="1" stop-color="#0071e3"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="256" height="256" rx="${extra === 'round' ? 128 : 56}" fill="url(#g)"/>
  ${glyph}
</svg>`);

// 自适应图标前景: 108dp 画布、内容占中间 72dp 安全区
const foreground = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="512" height="512">
  <g transform="translate(34,34) scale(0.734375)">${glyph}</g>
</svg>`);

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

for (const [density, scale] of Object.entries(DENSITIES)) {
  const dir = `android/app/src/main/res/mipmap-${density}`;
  mkdirSync(dir, { recursive: true });
  await sharp(base()).resize(48 * scale).png().toFile(`${dir}/ic_launcher.png`);
  await sharp(base('round')).resize(48 * scale).png().toFile(`${dir}/ic_launcher_round.png`);
  await sharp(foreground).resize(108 * scale).png().toFile(`${dir}/ic_launcher_foreground.png`);
}

// 背景色(自适应图标引用)
mkdirSync('android/app/src/main/res/values', { recursive: true });
console.log('android launcher icons generated for mdpi~xxxhdpi');
