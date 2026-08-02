"use client";

import { type SigilSource } from "@/lib/gamify/sigil";

/**
 * Renders whatever the sigil source hands over.
 *
 * Two things make this the right seam for later artwork. It takes a
 * `SigilSource` rather than a seed, so swapping in a drawn sprite sheet is a
 * change of what gets passed IN, not a rewrite of the character sheet. And it
 * draws with SVG `shapeRendering="crispEdges"` on an integer grid, which is
 * how you get genuinely hard pixel edges at any size — CSS-scaled bitmaps
 * shimmer at fractional device pixel ratios, and that shimmer is most of what
 * makes pixel art look cheap.
 *
 * The sprite branch is deliberately declared but not yet reachable: nothing
 * constructs a sprite source today. It is here so the shape of the seam is
 * fixed while there is only one implementation to fit it.
 */
export function SigilAvatar({
  source,
  body,
  accent,
  glow,
  size = 88,
  label,
}: {
  source: SigilSource;
  body: string;
  accent: string;
  glow: boolean;
  size?: number;
  label: string;
}) {
  if (source.kind === "sprite") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={source.src}
        alt={label}
        width={size}
        height={size}
        style={{ imageRendering: "pixelated" }}
      />
    );
  }

  const grid = source.grid;
  const n = grid.length;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${n} ${n}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
      style={glow ? { filter: `drop-shadow(0 0 6px ${accent})` } : undefined}
    >
      {grid.map((row, y) =>
        row.map((ink, x) =>
          ink === 0 ? null : (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width={1}
              height={1}
              fill={ink === 2 ? accent : body}
            />
          ),
        ),
      )}
    </svg>
  );
}
