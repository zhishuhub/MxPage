// 生成 K图 图标：SVG（不依赖字体，K 用多边形画）→ PNG（512）→ ICO（16–256，内嵌 PNG）。
// 用法：node scripts/build-ktu-icon.mjs
import { writeFileSync } from "node:fs";
import sharp from "sharp";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2a0f4f"/>
      <stop offset="1" stop-color="#c026d3"/>
    </linearGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fde68a"/>
      <stop offset="1" stop-color="#f59e0b"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#bg)"/>
  <polygon points="92,104 162,104 162,228 258,104 340,104 234,236 340,408 262,408 194,290 162,326 162,408 92,408" fill="#ffffff"/>
  <rect x="356" y="330" width="28" height="78" rx="9" fill="url(#bar)"/>
  <rect x="394" y="290" width="28" height="118" rx="9" fill="url(#bar)"/>
  <rect x="432" y="248" width="28" height="160" rx="9" fill="url(#bar)"/>
</svg>`;

const png512 = await sharp(Buffer.from(svg)).png().toBuffer();
writeFileSync("public/brand-icon.png", png512);

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map(size => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, index) => {
  const entry = 6 + index * 16;
  header.writeUInt8(size >= 256 ? 0 : size, entry);
  header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
  header.writeUInt8(0, entry + 2);
  header.writeUInt8(0, entry + 3);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[index].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
});
const ico = Buffer.concat([header, ...images]);
writeFileSync("public/brand-icon.ico", ico);
writeFileSync("app/favicon.ico", ico);
console.log("icons written");
