"use client";

import { useEffect, useState } from "react";
import type { CelebrateDetail } from "@/lib/gamify/celebrate";

const DEFAULT_COLORS = ["#f59e0b", "#ec4899", "#3b82f6", "#22c55e", "#a855f7", "#ef4444"];

type Burst = { id: number; colors: string[]; count: number };

/**
 * Dependency-free confetti burst. Mounted once globally; listens for the
 * `gamify-celebrate` event (fired by lib/gamify/celebrate.ts) and rains a short
 * burst. The event can carry the milestone's own colors and an intensity, so a
 * tier evolution or rank-up showers in that milestone's palette rather than a
 * generic one. Self-contained keyframes so it touches no global CSS.
 */
export function Confetti() {
  const [bursts, setBursts] = useState<Burst[]>([]);

  useEffect(() => {
    let n = 0;
    function go(e: Event) {
      const detail = (e as CustomEvent<CelebrateDetail>).detail ?? {};
      const id = (n += 1);
      const colors = detail.colors?.length ? detail.colors : DEFAULT_COLORS;
      const count = Math.round(70 * Math.min(2, Math.max(0.5, detail.intensity ?? 1)));
      setBursts((b) => [...b, { id, colors, count }]);
      setTimeout(() => setBursts((b) => b.filter((x) => x.id !== id)), 2200);
    }
    window.addEventListener("gamify-celebrate", go);
    return () => window.removeEventListener("gamify-celebrate", go);
  }, []);

  if (bursts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[100] overflow-hidden" aria-hidden>
      <style>{`@keyframes sb-confetti { to { transform: translateY(110vh) rotate(720deg); opacity: 0.15; } }`}</style>
      {bursts.map((burst) => (
        <div key={burst.id}>
          {Array.from({ length: burst.count }).map((_, i) => {
            const left = Math.random() * 100;
            const delay = Math.random() * 0.25;
            const dur = 1 + Math.random() * 0.7;
            const size = 6 + Math.random() * 7;
            return (
              <span
                key={i}
                style={{
                  position: "absolute",
                  left: `${left}%`,
                  top: "-12px",
                  width: size,
                  height: size,
                  background: burst.colors[i % burst.colors.length],
                  borderRadius: 2,
                  animation: `sb-confetti ${dur}s ${delay}s ease-in forwards`,
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
