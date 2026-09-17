import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { RETENTION_DAYS, RETENTION_MS, articleWindowDays } from "./retention";
import { TRUST_WINDOW_DAYS } from "@/lib/today/feed-trust";

describe("articleWindowDays", () => {
  it("passes a window through when it fits inside retention", () => {
    expect(articleWindowDays(7)).toBe(7);
    expect(articleWindowDays(RETENTION_DAYS)).toBe(RETENTION_DAYS);
  });

  it("clamps a window that reaches past what the purge keeps", () => {
    expect(articleWindowDays(RETENTION_DAYS + 1)).toBe(RETENTION_DAYS);
    expect(articleWindowDays(365)).toBe(RETENTION_DAYS);
  });

  it("RETENTION_MS agrees with RETENTION_DAYS", () => {
    expect(RETENTION_MS).toBe(RETENTION_DAYS * 24 * 60 * 60 * 1000);
  });
});

describe("feed trust cannot outrun retention", () => {
  // The purge deletes READ articles and keeps unread ones, so a window longer
  // than retention computes read ÷ delivered over a leftover biased against
  // reading: the more diligently a feed is read, the worse it would score.
  it("the trust window is inside the retention window", () => {
    expect(TRUST_WINDOW_DAYS).toBeLessThanOrEqual(RETENTION_DAYS);
  });
});

// Any NEW window over `articles` has to be clamped too. This finds the day
// constants that feed a query against `articles` and checks each one.
const SRC = join(process.cwd(), "src");

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return [];
    return [full];
  });
}

describe("no article-derived window reaches past retention", () => {
  it("every *_DAYS constant in a module that queries articles is clamped", () => {
    const offenders: string[] = [];

    for (const file of tsFiles(SRC)) {
      const src = readFileSync(file, "utf8");
      // Only modules that actually read the articles table.
      if (!/from\(articles\)|from articles\b/.test(src)) continue;

      for (const m of src.matchAll(
        /(?:export\s+)?const\s+([A-Z][A-Z0-9_]*_DAYS)\s*=\s*([^;\n]+)/g,
      )) {
        const [, name, init] = m;
        // A literal is only safe if it is within retention; anything routed
        // through articleWindowDays is safe by construction.
        if (/articleWindowDays\s*\(/.test(init)) continue;
        const literal = Number(init.trim());
        if (Number.isFinite(literal) && literal <= RETENTION_DAYS) continue;
        offenders.push(
          `${relative(process.cwd(), file)} → ${name} = ${init.trim()} (retention is ${RETENTION_DAYS}d)`,
        );
      }
    }

    expect(offenders).toEqual([]);
  });

  it("the detector would catch an unclamped window", () => {
    const sample = `
      import { articles } from "@/lib/db/schema";
      const LOOKBACK_DAYS = 90;
      await db.select().from(articles);
    `;
    const found = [...sample.matchAll(/const\s+([A-Z][A-Z0-9_]*_DAYS)\s*=\s*([^;\n]+)/g)];
    expect(found).toHaveLength(1);
    expect(Number(found[0][2].trim())).toBeGreaterThan(RETENTION_DAYS);
  });
});
