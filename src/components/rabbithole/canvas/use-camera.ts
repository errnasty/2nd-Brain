"use client";

import { useCallback, useEffect, useRef } from "react";

export type Camera = { x: number; y: number; scale: number };

const MIN_SCALE = 0.2;
const MAX_SCALE = 2.5;
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/**
 * Imperative pan/zoom camera for the canvas. Holds the transform in a ref and
 * writes it straight to `worldRef` / `edgesRef` — no React re-render per frame.
 * Wheel pans; ctrl/⌘+wheel zooms toward the cursor. A wheel gesture that begins
 * inside a scrollable card keeps scrolling that card until it pauses.
 *
 * @param viewportRef the overflow-hidden frame
 * @param worldRef    the transformed layer holding the cards
 * @param edgesRef    the SVG layer (kept in lockstep with the world)
 * @param onChange    called after every transform write (e.g. persist + redraw)
 */
export function useCamera(
  viewportRef: React.RefObject<HTMLDivElement | null>,
  worldRef: React.RefObject<HTMLDivElement | null>,
  edgesRef: React.RefObject<SVGSVGElement | null>,
  onChange?: (cam: Camera) => void,
) {
  const cam = useRef<Camera>({ x: 0, y: 0, scale: 1 });

  const apply = useCallback(() => {
    const t = `translate(${cam.current.x}px, ${cam.current.y}px) scale(${cam.current.scale})`;
    if (worldRef.current) worldRef.current.style.transform = t;
    if (edgesRef.current) edgesRef.current.style.transform = t;
    onChange?.(cam.current);
  }, [worldRef, edgesRef, onChange]);

  const setCamera = useCallback(
    (next: Partial<Camera>) => {
      cam.current = { ...cam.current, ...next };
      if (next.scale != null) cam.current.scale = clampScale(cam.current.scale);
      apply();
    },
    [apply],
  );

  const getCamera = useCallback(() => cam.current, []);

  /** Screen (viewport-relative px) → world coords. */
  const screenToWorld = useCallback(
    (sx: number, sy: number) => ({
      x: (sx - cam.current.x) / cam.current.scale,
      y: (sy - cam.current.y) / cam.current.scale,
    }),
    [],
  );

  /** Zoom toward a viewport point, keeping that world point under the cursor. */
  const zoomAt = useCallback(
    (sx: number, sy: number, factor: number) => {
      const next = clampScale(cam.current.scale * factor);
      if (next === cam.current.scale) return;
      const w = screenToWorld(sx, sy);
      cam.current.scale = next;
      cam.current.x = sx - w.x * next;
      cam.current.y = sy - w.y * next;
      apply();
    },
    [apply, screenToWorld],
  );

  /** Center the camera on a world rectangle (frame-all / reveal). */
  const frameRect = useCallback(
    (rect: { x: number; y: number; w: number; h: number }, pad = 80) => {
      const vp = viewportRef.current;
      if (!vp || rect.w <= 0 || rect.h <= 0) return;
      const scale = clampScale(
        Math.min((vp.clientWidth - pad * 2) / rect.w, (vp.clientHeight - pad * 2) / rect.h, 1),
      );
      cam.current.scale = scale;
      cam.current.x = vp.clientWidth / 2 - (rect.x + rect.w / 2) * scale;
      cam.current.y = vp.clientHeight / 2 - (rect.y + rect.h / 2) * scale;
      apply();
    },
    [viewportRef, apply],
  );

  // Wheel: pan by default, ctrl/⌘+wheel = zoom-at-cursor. A gesture that starts
  // inside a scrollable card stays a card-scroll until a >180ms pause.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    let kind: "pan" | "card" | null = null;
    let card: HTMLElement | null = null;
    let ts = 0;

    const canScroll = (el: HTMLElement | null, dy: number) => {
      while (el && el !== vp) {
        const style = getComputedStyle(el);
        if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) {
          if (dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1) return el;
        }
        el = el.parentElement;
      }
      return null;
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        kind = null;
        const rect = vp.getBoundingClientRect();
        zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.01));
        return;
      }
      if (!kind || e.timeStamp - ts > 180) {
        card = canScroll(e.target as HTMLElement, e.deltaY);
        kind = card ? "card" : "pan";
      }
      ts = e.timeStamp;
      if (kind === "pan") {
        e.preventDefault();
        cam.current.x -= e.deltaX;
        cam.current.y -= e.deltaY;
        apply();
      }
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [viewportRef, zoomAt, apply]);

  return { getCamera, setCamera, screenToWorld, zoomAt, frameRect, apply };
}
