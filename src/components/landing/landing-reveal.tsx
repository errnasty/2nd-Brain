"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Landing-page scroll trigger. Adds the `motion-safe-in` class to its child
 * (or itself) when it scrolls into view, which drives the 1A CSS animations
 * (hero word stagger, rule-grow). Honors prefers-reduced-motion by leaving the
 * child at its final visible state (handled in globals.css).
 *
 * `as="self"` applies the class to the wrapper itself (for section rules);
 * default applies it to the single child so the stagger scope stays correct.
 */
export function LandingReveal({
  children,
  className,
  delay,
  as = "child",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: "self" | "child";
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.dataset.reduceMotion === "true";
    const target = as === "self" ? el : (el.firstElementChild as HTMLElement | null) ?? el;
    // If the hero is already in the viewport on load (it usually is), the IO
    // callback can race past the first paint — fire immediately so the stagger
    // never gets stuck at opacity:0.
    if (reduce) {
      target.classList.add("motion-safe-in");
      return;
    }
    if (delay) target.style.animationDelay = `${delay}ms`;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          target.classList.add("motion-safe-in");
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(target);
    return () => io.disconnect();
  }, [as, delay]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
