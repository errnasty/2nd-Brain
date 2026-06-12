// Repairs the Electron binary on Windows when its postinstall left it
// incomplete. The bundled extractor (extract-zip) silently fails extracting the
// large electron zip on some Windows setups — only `locales/` lands, with no
// electron.exe and no path.txt. We re-extract the cached zip with PowerShell's
// Expand-Archive (a different, reliable code path) and write path.txt.
//
// No-op everywhere except Windows, and only when the binary is actually missing.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function main() {
  if (process.platform !== "win32") return;

  let electronDir;
  try {
    electronDir = path.dirname(require.resolve("electron/package.json"));
  } catch {
    return; // electron not installed (e.g. production web install) — nothing to do
  }

  const exe = path.join(electronDir, "dist", "electron.exe");
  const pathTxt = path.join(electronDir, "path.txt");
  if (fs.existsSync(exe) && fs.existsSync(pathTxt)) return; // already healthy

  const cacheRoot = path.join(process.env.LOCALAPPDATA || "", "electron", "Cache");
  const zip = findZip(cacheRoot);
  if (!zip) {
    console.warn("[fix-binary] no cached electron zip found; run `node node_modules/electron/install.js` first.");
    return;
  }

  const dist = path.join(electronDir, "dist");
  fs.rmSync(dist, { recursive: true, force: true });
  console.log("[fix-binary] re-extracting electron via Expand-Archive…");
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Expand-Archive -Path '${zip}' -DestinationPath '${dist}' -Force`,
    ],
    { stdio: "inherit" },
  );
  fs.writeFileSync(pathTxt, "electron.exe");
  console.log("[fix-binary] electron.exe present:", fs.existsSync(exe));
}

function findZip(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    const s = fs.statSync(p);
    if (s.isDirectory()) {
      const found = findZip(p);
      if (found) return found;
    } else if (entry.endsWith(".zip")) {
      return p;
    }
  }
  return null;
}

try {
  main();
} catch (err) {
  console.warn("[fix-binary] skipped:", err instanceof Error ? err.message : err);
}
