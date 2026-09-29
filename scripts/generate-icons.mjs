/**
 * 生成 PWA/Capacitor 应用图标（sharp 栅格化 SVG）
 * 产出: public/icons/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png(180)
 * 用法: node scripts/generate-icons.mjs
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

mkdirSync('public/icons', { recursive: true });

// 品牌蓝渐变 + 知识网络节点图形
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

// full: 满幅圆角方形;maskable: 缩小 72% 留安全区(Android 圆形/异形裁切)
const svg = (safe) => Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a84ff"/>
      <stop offset="1" stop-color="#0071e3"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="256" height="256" rx="${safe ? 0 : 56}" fill="url(#g)"/>
  ${safe ? `<g transform="translate(36,36) scale(0.71875)">${glyph}</g>` : glyph}
</svg>`);

await sharp(svg(false)).resize(192).png().toFile('public/icons/icon-192.png');
await sharp(svg(false)).resize(512).png().toFile('public/icons/icon-512.png');
await sharp(svg(true)).resize(512).png().toFile('public/icons/icon-maskable-512.png');
await sharp(svg(false)).resize(180).png().toFile('public/icons/apple-touch-icon.png');
console.log('icons generated: public/icons/{icon-192,icon-512,icon-maskable-512,apple-touch-icon}.png');
