"use client";

import { useEffect, useState } from "react";

const COLORS = ["#f59e0b", "#ec4899", "#3b82f6", "#22c55e", "#a855f7", "#ef4444"];

/**
 * Dependency-free confetti burst. Mounted once globally; listens for the
 * `gamify-celebrate` event (fired by lib/gamify/celebrate.ts) and rains a short
 * burst. Self-contained keyframes so it touches no global CSS.
 */
export function Confetti() {
  const [bursts, setBursts] = useState<number[]>([]);

  useEffect(() => {
    let n = 0;
    function go() {
      const id = (n += 1);
      setBursts((b) => [...b, id]);
      setTimeout(() => setBursts((b) => b.filter((x) => x !== id)), 1800);
    }
    window.addEventListener("gamify-celebrate", go);
    return () => window.removeEventListener("gamify-celebrate", go);
  }, []);

  if (bursts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[100] overflow-hidden" aria-hidden>
      <style>{`@keyframes sb-confetti { to { transform: translateY(110vh) rotate(720deg); opacity: 0.15; } }`}</style>
      {bursts.map((id) => (
        <div key={id}>
          {Array.from({ length: 70 }).map((_, i) => {
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
                  background: COLORS[i % COLORS.length],
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
