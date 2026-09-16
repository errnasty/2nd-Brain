import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// `void someAsync(...)` is this codebase's idiom for fire-and-forget work
// (embedding, tagging, wikilink sync, usage accounting). It is only safe if the
// promise cannot reject: Node terminates the process on an unhandled rejection
// by default. (Client components are exempt — see the check below.)
//
// Most of these helpers swallow their own errors — embedNote, embedDocument,
// syncWikilinks, recordAiUsage and markConceptViewed all wrap their bodies in
// try/catch. autoTagDirectoryItem does not, because it is also awaited
// elsewhere for its return value, so its `void` call sites need an explicit
// .catch(). This checks every `void` call either attaches one or names a
// function that handles its own errors.

const SRC = join(process.cwd(), "src");

/** Async helpers that wrap their whole body in try/catch, so `void` is safe. */
const SELF_HANDLING = new Set([
  "embedNote",
  "embedDocument",
  "embedArticle",
  "syncWikilinks",
  "recordAiUsage",
  "markConceptViewed",
  "report",
  "ensureVectorSchema",
  "bustMapCache",
  "bustUnreadCounts",
]);

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return [];
    return [full];
  });
}

describe("fire-and-forget promises cannot reject unhandled", () => {
  it("every `void fn(...)` either catches or calls a self-handling helper", () => {
    const offenders: string[] = [];

    for (const file of tsFiles(SRC)) {
      const src = readFileSync(file, "utf8");
      // Server code only. In the browser an unhandled rejection logs to the
      // console; on the server Node's default is to terminate the process, and
      // that is the failure this guards.
      if (/^\s*["']use client["']/m.test(src)) continue;
      const lines = src.split("\n");

      lines.forEach((line, i) => {
        const m = /^\s*void\s+([A-Za-z_$][\w$.]*)\s*\(/.exec(line);
        if (!m) return;
        const callee = m[1].split(".").pop()!;
        if (SELF_HANDLING.has(callee)) return;

        // A .catch may sit on this line or within the call's continuation.
        const window = lines.slice(i, i + 8).join("\n");
        const upToNextStatement = window.split(/\n\s*\n/)[0];
        if (/\.catch\s*\(/.test(upToNextStatement)) return;

        offenders.push(
          `${relative(process.cwd(), file)}:${i + 1} → void ${m[1]}(…) with no .catch`,
        );
      });
    }

    expect(offenders).toEqual([]);
  });
});
