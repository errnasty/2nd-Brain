// Electron host for the local-first desktop app.
//
// Boots the existing Next.js server locally with APP_RUNTIME=desktop so it uses
// the embedded PGlite database (instant, offline), then opens a window onto it.
// AI keys + cloud-sync credentials are read from a local settings.json and
// injected into the server's environment.
const { app, BrowserWindow, shell, Menu, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");

// Stable name so the user-data folder is the same in dev and packaged builds
// (otherwise dev uses the package.json "name", "second-brain"). MUST run before
// any getPath("userData").
app.setName("Second Brain");

const isDev = !app.isPackaged;
const PORT = process.env.DESKTOP_PORT || "3939";
const HOST = "127.0.0.1";
const userData = app.getPath("userData");
const settingsPath = path.join(userData, "settings.json");
const appRoot = path.join(__dirname, "..");

const SETTINGS_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "VOYAGE_API_KEY",
  "EMBEDDINGS_PROVIDER",
  "DATABASE_URL",
];

/** Minimal .env parser (KEY=VALUE lines) for pre-filling settings from .env.local. */
function readEnvFile(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      out[m[1]] = v;
    }
  } catch {
    // no file — ignore
  }
  return out;
}

/** Ensure settings.json exists. First run: seed from the project's .env.local
 *  (if present) so existing web-app config carries over. Returns the env block. */
function ensureSettingsFile() {
  fs.mkdirSync(userData, { recursive: true });
  if (!fs.existsSync(settingsPath)) {
    const fromEnv = readEnvFile(path.join(appRoot, ".env.local"));
    const env = {};
    for (const k of SETTINGS_KEYS) env[k] = fromEnv[k] || "";
    if (!env.EMBEDDINGS_PROVIDER) env.EMBEDDINGS_PROVIDER = "local";
    fs.writeFileSync(settingsPath, JSON.stringify({ env }, null, 2));
    console.log(`[settings] created ${settingsPath}`);
  }
  console.log(`[settings] file: ${settingsPath}`);
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    return raw && typeof raw.env === "object" ? raw.env : {};
  } catch {
    return {};
  }
}

let serverProc = null;

function startServer() {
  const env = {
    ...process.env,
    ...ensureSettingsFile(),
    APP_RUNTIME: "desktop",
    LOCAL_DB_DIR: path.join(userData, "db"),
    PORT: String(PORT),
    HOSTNAME: HOST,
    NODE_ENV: isDev ? "development" : "production",
  };

  if (isDev) {
    // Dev: run the project's Next dev server in desktop mode.
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    serverProc = spawn(npm, ["run", "dev", "--", "-p", String(PORT), "-H", HOST], {
      cwd: appRoot,
      env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  } else {
    // Prod: run the standalone Next server bundled into resources.
    // ELECTRON_RUN_AS_NODE makes the Electron binary behave as plain Node —
    // without it, server.js would boot a second Electron app and fail.
    const serverJs = path.join(process.resourcesPath, "app", ".next", "standalone", "server.js");
    serverProc = spawn(process.execPath, [serverJs], {
      cwd: path.dirname(serverJs),
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "inherit",
    });
  }

  serverProc.on("exit", (code) => {
    if (code && code !== 0) console.error(`Next server exited with code ${code}`);
  });
}

/** Poll until the local server answers, then call cb. */
function waitForServer(cb, attempt = 0) {
  const req = http.get({ host: HOST, port: PORT, path: "/login", timeout: 1500 }, (res) => {
    res.destroy();
    cb();
  });
  req.on("error", () => {
    if (attempt > 120) {
      console.error("Local server did not start in time.");
      app.quit();
      return;
    }
    setTimeout(() => waitForServer(cb, attempt + 1), 500);
  });
  req.on("timeout", () => req.destroy());
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0a0a0a",
    title: "Second Brain",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  win.loadURL(`http://${HOST}:${PORT}/`);
  // External links (article sources etc.) open in the OS browser, not the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://${HOST}:${PORT}`)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
}

function buildMenu() {
  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    {
      label: "Tools",
      submenu: [
        {
          label: "Open settings file (keys / cloud sync)…",
          click: () => {
            ensureSettingsFile();
            shell.openPath(settingsPath);
          },
        },
        {
          label: "Sync now (cloud)",
          click: () => {
            const req = http.request(
              { host: HOST, port: PORT, path: "/api/sync", method: "POST", timeout: 120000 },
              (res) => {
                let body = "";
                res.on("data", (c) => (body += c));
                res.on("end", () => {
                  let msg = body;
                  try {
                    const s = JSON.parse(body);
                    msg = s.ok
                      ? `Synced — pulled ${s.pulled}, pushed ${s.pushed}, deletes ${s.deletesApplied + s.deletesPushed}` +
                        (s.skipped ? `, ${s.skipped} skipped` : "")
                      : `Sync failed: ${s.error || "unknown"}`;
                  } catch {
                    /* show raw body */
                  }
                  dialog.showMessageBox({ type: "info", title: "Sync", message: msg });
                });
              },
            );
            req.on("error", (e) => dialog.showMessageBox({ type: "error", title: "Sync", message: e.message }));
            req.end();
          },
        },
        { label: "Restart app (apply settings)", click: () => { app.relaunch(); app.exit(0); } },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// PGlite is a single-writer embedded DB. A second app instance would spawn a
// second server opening the same data dir and corrupt/lock it. Refuse to start
// a second instance; focus the existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on("second-instance", () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  buildMenu();
  // First-run guard: without Supabase URL/key the app can't load. Tell the user
  // exactly where to put them and offer to open the file.
  const env = ensureSettingsFile();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const choice = dialog.showMessageBoxSync({
      type: "warning",
      title: "Setup needed",
      message: "Add your Supabase URL and anon key to continue.",
      detail:
        `Edit:\n${settingsPath}\n\n` +
        `Fill NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (Supabase → Project Settings → API), ` +
        `plus ANTHROPIC_API_KEY for AI. Then reopen the app.`,
      buttons: ["Open settings file", "Continue anyway"],
      defaultId: 0,
    });
    if (choice === 0) {
      shell.openPath(settingsPath);
      app.quit();
      return;
    }
  }
  startServer();
  waitForServer(createWindow);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function shutdown() {
  if (serverProc && !serverProc.killed) serverProc.kill();
}
app.on("window-all-closed", () => {
  shutdown();
  if (process.platform !== "darwin") app.quit();
});
app.on("quit", shutdown);
process.on("exit", shutdown);
