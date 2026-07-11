/**
 * Post-build: stamp the Next build id into the service worker's cache names.
 *
 * public/sw.js is copied verbatim (webpack never touches it), so a hand-bumped
 * cache version was the only thing purging old hashed chunks — and it was
 * forgotten between deploys, letting dead chunks pile up in CacheStorage.
 * Runs as npm "postbuild", so every `npm run build` (local, Netlify CI,
 * electron/build.js) produces cache names unique to that build; the SW's
 * activate handler then deletes every cache not in its keep-set.
 *
 * Idempotent: rewrites the version suffix in place, no placeholder needed.
 * Note: this mutates public/sw.js in the working tree after a build — the
 * diff is expected; commit it or ignore it, both are safe (CI re-stamps).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const BUILD_ID_PATH = ".next/BUILD_ID";
const SW_PATH = "public/sw.js";

if (!existsSync(BUILD_ID_PATH) || !existsSync(SW_PATH)) {
  console.log("[inject-sw-buildid] BUILD_ID or sw.js missing — skipped.");
  process.exit(0);
}

const buildId = readFileSync(BUILD_ID_PATH, "utf8").trim();
// Cache names must be stable identifiers; strip anything exotic.
const safeId = buildId.replace(/[^A-Za-z0-9_-]/g, "");
const src = readFileSync(SW_PATH, "utf8");

const out = src
  .replace(/sb-static-[A-Za-z0-9_-]+/g, `sb-static-${safeId}`)
  .replace(/sb-pages-[A-Za-z0-9_-]+/g, `sb-pages-${safeId}`);

if (out === src) {
  console.log(`[inject-sw-buildid] cache names already at ${safeId}.`);
} else {
  writeFileSync(SW_PATH, out);
  console.log(`[inject-sw-buildid] stamped cache names with build id ${safeId}.`);
}
