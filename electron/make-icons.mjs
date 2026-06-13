// Generates all app icons from one SVG: web manifest PNGs (public/) and the
// electron-builder icons (build/). Run: npm run desktop:icons
// Needs `sharp` (already a transitive dep) and ImageMagick `convert` for .ico.
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Assemble a .ico that embeds PNG images directly (supported Vista+). No native
// tooling needed — ImageMagick isn't reliably present on Windows.
function buildIco(pngs /* {size, buf}[] */) {
  const dir = Buffer.alloc(6 + pngs.length * 16);
  dir.writeUInt16LE(0, 0); // reserved
  dir.writeUInt16LE(1, 2); // type = icon
  dir.writeUInt16LE(pngs.length, 4);
  let offset = dir.length;
  pngs.forEach((p, i) => {
    const e = 6 + i * 16;
    dir.writeUInt8(p.size >= 256 ? 0 : p.size, e + 0); // width (0 = 256)
    dir.writeUInt8(p.size >= 256 ? 0 : p.size, e + 1); // height
    dir.writeUInt8(0, e + 2); // palette
    dir.writeUInt8(0, e + 3); // reserved
    dir.writeUInt16LE(1, e + 4); // planes
    dir.writeUInt16LE(32, e + 6); // bpp
    dir.writeUInt32LE(p.buf.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += p.buf.length;
  });
  return Buffer.concat([dir, ...pngs.map((p) => p.buf)]);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = path.join(root, "public");
const build = path.join(root, "build");
mkdirSync(build, { recursive: true });

// "Second Brain" mark: dark rounded tile + a small connected-node graph
// (knowledge graph) over a warm radial glow. Serif "2B" anchors the brand.
const SVG = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="g" cx="38%" cy="30%" r="85%">
      <stop offset="0%" stop-color="#2a2622"/>
      <stop offset="55%" stop-color="#141312"/>
      <stop offset="100%" stop-color="#0a0a0a"/>
    </radialGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#e8c08a"/>
      <stop offset="100%" stop-color="#b98a4e"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="512" height="512" rx="112" fill="url(#g)"/>
  <g stroke="url(#edge)" stroke-width="7" stroke-linecap="round" opacity="0.85">
    <line x1="150" y1="150" x2="256" y2="118"/>
    <line x1="256" y1="118" x2="372" y2="168"/>
    <line x1="150" y1="150" x2="176" y2="300"/>
    <line x1="372" y1="168" x2="360" y2="320"/>
    <line x1="176" y1="300" x2="300" y2="378"/>
    <line x1="360" y1="320" x2="300" y2="378"/>
    <line x1="176" y1="300" x2="360" y2="320"/>
  </g>
  <g fill="#f4e7d2">
    <circle cx="150" cy="150" r="20"/>
    <circle cx="256" cy="118" r="15"/>
    <circle cx="372" cy="168" r="20"/>
    <circle cx="176" cy="300" r="15"/>
    <circle cx="360" cy="320" r="17"/>
    <circle cx="300" cy="378" r="22"/>
  </g>
  <text x="256" y="300" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"
        font-size="180" font-weight="700" fill="#f4e7d2" opacity="0.16">2B</text>
</svg>`;

const svgBuf = Buffer.from(SVG);
const png = (size) => sharp(svgBuf, { density: 384 }).resize(size, size).png();

// Web manifest icons
await png(192).toFile(path.join(pub, "icon-192.png"));
await png(512).toFile(path.join(pub, "icon-512.png"));
await png(180).toFile(path.join(pub, "apple-touch-icon.png"));
await sharp(svgBuf, { density: 384 }).resize(32, 32).toFile(path.join(pub, "favicon.png"));

// electron-builder: icon.png (mac/linux source, ≥512) + icon.ico (Windows)
await png(1024).toFile(path.join(build, "icon.png"));
const icoSizes = [16, 32, 48, 64, 128, 256];
const icoPngs = [];
for (const s of icoSizes) icoPngs.push({ size: s, buf: await png(s).toBuffer() });
writeFileSync(path.join(build, "icon.ico"), buildIco(icoPngs));

console.log("icons written → public/{icon-192,icon-512,apple-touch-icon,favicon}.png, build/{icon.png,icon.ico}");
