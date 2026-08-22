import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards the middleware matcher against the failure that broke the embeddings
 * cron: /api/embeddings/cron-backfill authenticates itself with CRON_SECRET,
 * but the matcher only skipped the `api/cron` prefix, so middleware ran, found
 * no session cookie, and answered 307 to /login before the route's own auth
 * check ever saw the bearer token.
 *
 * Next requires config.matcher to be a statically analysable literal inside
 * middleware.ts, so it cannot be imported from a shared module. Read the
 * literal out of the source — that is exactly the value that ships.
 */
function matcherRegex(): RegExp {
  const src = readFileSync(join(process.cwd(), "src/middleware.ts"), "utf8");
  const m = src.match(/matcher:\s*\[\s*("(?:[^"\\]|\\.)*")/);
  if (!m) throw new Error("could not find config.matcher in src/middleware.ts");
  // The literal is a valid JSON string, so JSON.parse resolves its escapes.
  return new RegExp(`^${JSON.parse(m[1]) as string}$`);
}

const runsMiddleware = (path: string) => matcherRegex().test(path);

/** Routes that authenticate themselves with a token header instead of a cookie. */
const TOKEN_AUTHED = [
  "/api/cron/sync-feeds",
  "/api/cron/trending",
  "/api/embeddings/cron-backfill",
  "/api/mcp",
];

describe("middleware matcher", () => {
  it.each(TOKEN_AUTHED)("skips %s so its own token check can run", (path) => {
    expect(runsMiddleware(path)).toBe(false);
  });

  it("skips the health probe", () => {
    expect(runsMiddleware("/api/health")).toBe(false);
  });

  it.each(["/ask", "/feeds", "/directory", "/today", "/settings"])(
    "still guards the %s page",
    (path) => {
      expect(runsMiddleware(path)).toBe(true);
    },
  );

  it.each(["/api/ask", "/api/agent", "/api/map", "/api/sync"])(
    "still guards session-authed %s",
    (path) => {
      expect(runsMiddleware(path)).toBe(true);
    },
  );

  it("still guards /api/embeddings/backfill — the session-authed sibling", () => {
    // One `cron-` apart from an excluded route. Excluding this one by accident
    // would expose a user's whole library to an unauthenticated POST.
    expect(runsMiddleware("/api/embeddings/backfill")).toBe(true);
  });

  it("leaves no token-authed route unlisted", () => {
    // Walk the route tree and flag anything reading a token header that the
    // matcher would still redirect. A new cron/MCP endpoint fails here rather
    // than in production as a 307 to a login page.
    const apiDir = join(process.cwd(), "src/app/api");
    const routes: string[] = [];
    const walk = (dir: string, url: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const next = join(dir, entry.name);
        if (entry.isDirectory()) walk(next, `${url}/${entry.name}`);
        else if (entry.name === "route.ts") {
          const src = readFileSync(next, "utf8");
          const tokenAuthed =
            /checkCronAuth|CRON_SECRET/.test(src) || /x-mcp-token|MCP_TOKEN/i.test(src);
          if (tokenAuthed) routes.push(url);
        }
      }
    };
    walk(apiDir, "/api");

    const unprotected = routes.filter((r) => runsMiddleware(r));
    expect(unprotected, `token-authed routes still hit middleware: ${unprotected.join(", ")}`).toEqual([]);
    // Sanity: the scan found the routes we know about, so an empty result
    // can never be mistaken for a pass.
    expect(routes.sort()).toEqual([...TOKEN_AUTHED].sort());
  });
});
