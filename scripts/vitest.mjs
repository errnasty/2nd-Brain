/**
 * Vitest launcher that normalizes the working directory to its canonical
 * on-disk casing before starting vitest, then spawns the real vitest CLI.
 *
 * Why normalize cwd: on Windows, shells sometimes hand a process a lowercase
 * drive letter (`c:\...` instead of `C:\...`). Vite's module runner can then
 * see the project under two different URLs, load a second copy of
 * @vitest/runner with no state, and every suite fails at `describe()` with
 * "TypeError: Cannot read properties of undefined (reading 'config')".
 * realpathSync.native() resolves the true casing, so vitest always runs from
 * one canonical path regardless of which shell launched it.
 *
 * Why the binary is located via the package.json export: vitest 4 does NOT
 * expose `vitest/vitest.mjs` as an export subpath, so `require.resolve("vitest/vitest.mjs")`
 * throws ERR_PACKAGE_PATH_NOT_EXPORTED. The CLI bin (`vitest.mjs`) sits next to
 * the package root, which we reach through the exported `vitest/package.json`.
 */
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const cwd = realpathSync.native(process.cwd());
const require = createRequire(import.meta.url);

const pkgJsonPath = require.resolve("vitest/package.json");
const vitestBin = join(dirname(pkgJsonPath), "vitest.mjs");

const result = spawnSync(process.execPath, [vitestBin, ...process.argv.slice(2)], {
  cwd,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
