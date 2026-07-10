"use client";

import * as React from "react";
import { forwardRef } from "react";

export type Edge = {
  childId: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  highlighted: boolean;
};

/** SVG layer drawing a smooth bezier from each parent anchor to its child card,
 *  plus an anchor dot at the start. Sits under the world transform (same
 *  translate/scale), so world coords map 1:1. */
export const Edges = forwardRef<SVGSVGElement, { edges: Edge[] }>(function Edges({ edges }, ref) {
  return (
    <svg
      ref={ref}
      className="pointer-events-none absolute left-0 top-0 origin-top-left overflow-visible"
      style={{ width: 1, height: 1 }}
    >
      {edges.map((e) => {
        const dx = Math.max(40, Math.abs(e.end.x - e.start.x) / 2);
        const d = `M ${e.start.x} ${e.start.y} C ${e.start.x + dx} ${e.start.y}, ${e.end.x - dx} ${e.end.y}, ${e.end.x} ${e.end.y}`;
        return (
          <g key={e.childId} className={e.highlighted ? "text-primary" : "text-border"}>
            <path d={d} fill="none" stroke="currentColor" strokeWidth={e.highlighted ? 2 : 1.5} />
            <circle cx={e.start.x} cy={e.start.y} r={3} fill="currentColor" />
          </g>
        );
      })}
    </svg>
  );
});
