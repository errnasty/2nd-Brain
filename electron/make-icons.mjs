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

// "Second Brain" mark: a layered neural net (perceptron) — knowledge as a
// network. Black net on a white rounded tile (the finalized brand direction).
// Two forms, generated from shared node/edge data: the FULL 3×3×2 net for
// large icons (room for detail), and a simplified 3→1→2 FUNNEL for small
// sizes (legible down to 16px). The net lives in a 140×120 box, centered into
// a padded square tile.
const INK = "#0e0d10";
const TILE = "#ffffff";

// Full net — 3 input, 3 hidden, 2 output, fully connected.
const FULL = {
  nodes: [
    [20, 18], [20, 60], [20, 102],
    [70, 18], [70, 60], [70, 102],
    [120, 40], [120, 80],
  ],
  edges: [
    [0, 3], [0, 4], [0, 5], [1, 3], [1, 4], [1, 5], [2, 3], [2, 4], [2, 5],
    [3, 6], [3, 7], [4, 6], [4, 7], [5, 6], [5, 7],
  ],
  nodeR: 9,
  stroke: 2.4,
};

// Funnel — 3 input → 1 hidden → 2 output. Node 3 (center) is the hub.
const FUNNEL = {
  nodes: [
    [20, 18], [20, 60], [20, 102],
    [70, 60],
    [120, 40], [120, 80],
  ],
  edges: [[0, 3], [1, 3], [2, 3], [3, 4], [3, 5]],
  nodeR: 11,
  hubR: 13,
  hub: 3,
  stroke: 5,
};

/** Render a net (edges + nodes) as SVG markup at the given ink color. */
function net({ nodes, edges, nodeR, hubR, hub, stroke }, color) {
  const lines = edges
    .map(([a, b]) => `<line x1="${nodes[a][0]}" y1="${nodes[a][1]}" x2="${nodes[b][0]}" y2="${nodes[b][1]}"/>`)
    .join("");
  const circles = nodes
    .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${hub === i ? hubR : nodeR}"/>`)
    .join("");
  return `<g stroke="${color}" stroke-width="${stroke}" stroke-linecap="round">${lines}</g><g fill="${color}">${circles}</g>`;
}

/** White rounded tile, `size` px, with the net centered in a padded box. */
function tile(size, form) {
  const rx = Math.round(size * 0.22);
  // Net box: ~72% of the tile, centered. Aspect 140:120 preserved.
  const bw = size * 0.72;
  const bh = bw * (120 / 140);
  const bx = (size - bw) / 2;
  const by = (size - bh) / 2;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" rx="${rx}" fill="${TILE}"/>
    <svg x="${bx}" y="${by}" width="${bw}" height="${bh}" viewBox="0 0 140 120" preserveAspectRatio="xMidYMid meet">
      ${net(form, INK)}
    </svg>
  </svg>`;
}

const bigBuf = Buffer.from(tile(512, FULL));
const smallBuf = Buffer.from(tile(512, FUNNEL));
const pngFull = (size) => sharp(bigBuf, { density: 384 }).resize(size, size).png();
const pngMark = (size) => sharp(smallBuf, { density: 384 }).resize(size, size).png();

// Web manifest icons — full net (room for detail).
await pngFull(192).toFile(path.join(pub, "icon-192.png"));
await pngFull(512).toFile(path.join(pub, "icon-512.png"));
await pngFull(180).toFile(path.join(pub, "apple-touch-icon.png"));
// Favicon — simplified funnel stays legible at 32/16px.
await pngMark(32).toFile(path.join(pub, "favicon.png"));

// electron-builder: icon.png (mac/linux source, ≥512) + icon.ico (Windows).
await pngFull(1024).toFile(path.join(build, "icon.png"));
const icoSizes = [16, 32, 48, 64, 128, 256];
const icoPngs = [];
// Small sizes use the funnel; larger use the full net.
for (const s of icoSizes) icoPngs.push({ size: s, buf: await (s <= 48 ? pngMark(s) : pngFull(s)).toBuffer() });
writeFileSync(path.join(build, "icon.ico"), buildIco(icoPngs));

console.log("icons written → public/{icon-192,icon-512,apple-touch-icon,favicon}.png, build/{icon.png,icon.ico}");
