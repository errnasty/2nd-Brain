/**
 * Procedural pixel sigils — the character sheet's avatar.
 *
 * ## What it is
 *
 * A small, mirrored bitmap generated deterministically from a seed string, in
 * the spirit of an identicon but shaped to read as a creature or crest rather
 * than as noise.
 *
 * ## The property that matters
 *
 * The SHAPE depends only on the seed, so your sigil is yours permanently — it
 * is the same on the day you install the app and a year later. What changes as
 * you rank up is the PALETTE, which comes from the tier. So progression
 * recolours a familiar thing instead of replacing it, and the sheet reads as
 * "this is me, further along" rather than "this is a different avatar now".
 * Identity is the thing that survives motivation fading; a shape that keeps
 * being swapped out never becomes identity.
 *
 * ## Why generated rather than drawn
 *
 * No binary assets, no licences, nothing to commission before the feature can
 * ship, and it themes automatically from the tier colours already in
 * `levels.ts`. It is explicitly a FIRST implementation: `SigilSource` below is
 * the seam where hand-drawn or Claude-designed sprite sheets slot in later
 * without the character sheet knowing the difference.
 *
 * Pure — no React, no DOM — so the generator is unit-testable and can render
 * to SVG, canvas or a sprite sheet exporter alike.
 */

/** Grid is mirrored down the middle, so only the left half is generated. */
export const SIGIL_SIZE = 11;
const HALF = Math.ceil(SIGIL_SIZE / 2);

/**
 * A cell's paint: 0 = empty, 1 = body, 2 = accent.
 *
 * Two inks rather than one is what stops the result looking like static — the
 * accent lands sparsely and gives the eye a focal point (it usually reads as
 * eyes or a core).
 */
export type Ink = 0 | 1 | 2;
export type SigilGrid = Ink[][];

/** xmur3 — string → well-distributed 32-bit seed. */
function seedFrom(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^= h >>> 16) >>> 0;
}

/** mulberry32 — small, fast, deterministic PRNG. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build the grid for `seed`.
 *
 * Density tapers towards the edges and the base so the shape has a dense core
 * with a lighter silhouette, rather than an even scatter that fills the square.
 * That taper is most of what makes it look designed rather than random.
 */
export function sigilGrid(seed: string): SigilGrid {
  const rand = rng(seedFrom(seed));
  const grid: SigilGrid = [];

  for (let y = 0; y < SIGIL_SIZE; y++) {
    const row: Ink[] = new Array(SIGIL_SIZE).fill(0);
    // Vertical falloff: densest in the middle third, sparse at top and bottom.
    const vy = 1 - Math.abs(y - (SIGIL_SIZE - 1) / 2) / ((SIGIL_SIZE - 1) / 2);
    for (let x = 0; x < HALF; x++) {
      // Horizontal falloff: the mirror seam is the spine, so keep it solid and
      // let the outer columns thin out.
      const vx = 1 - x / HALF;
      const p = 0.18 + 0.62 * vy * (0.45 + 0.55 * vx);
      const ink: Ink = rand() < p ? (rand() < 0.16 ? 2 : 1) : 0;
      row[x] = ink;
      row[SIGIL_SIZE - 1 - x] = ink; // mirror
    }
    grid.push(row);
  }

  // A sigil that generated almost nothing looks broken rather than minimal.
  // Rare, but deterministic per seed, so it would be broken forever for that
  // one user — force a spine instead.
  const filled = grid.flat().filter((c) => c !== 0).length;
  if (filled < SIGIL_SIZE) {
    const mid = Math.floor(SIGIL_SIZE / 2);
    for (let y = 2; y < SIGIL_SIZE - 2; y++) grid[y][mid] = 1;
  }
  return grid;
}

/** Colours a sigil is painted in — supplied by the tier, so it recolours as
 *  you rank up without the shape moving. */
export type SigilPalette = { body: string; accent: string; glow: boolean };

/**
 * The seam for future artwork.
 *
 * A sprite-backed source implements the same call and returns an image
 * reference instead of a grid; the character sheet renders whichever it is
 * given. Nothing outside this module needs to change when sprites arrive —
 * which is the point of declaring it now, while there is only one
 * implementation.
 */
export type SigilSource =
  | { kind: "procedural"; grid: SigilGrid }
  | { kind: "sprite"; src: string; frames?: number };

export function proceduralSigil(seed: string): SigilSource {
  return { kind: "procedural", grid: sigilGrid(seed) };
}
