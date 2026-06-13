// Electron host for the local-first desktop app.
//
// Boots the existing Next.js server locally with APP_RUNTIME=desktop so it uses
// the embedded PGlite database (instant, offline), then opens a window onto it.
// AI keys + cloud-sync credentials are read from a local settings.json and
// injected into the server's environment.
const { app, BrowserWindow, shell, Menu, dialog, ipcMain } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");

// Optional auto-update (electron-updater). Guarded require so the app still runs
// if it isn't packaged. Active only in packaged builds with a valid GitHub
// `publish` config (see package.json → build.publish) + a published release.
let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
} catch {
  /* not bundled — auto-update disabled */
}

function initAutoUpdate(menuTriggered = false) {
  if (!autoUpdater || !app.isPackaged) {
    if (menuTriggered) dialog.showMessageBox({ type: "info", title: "Updates", message: "Auto-update isn't available in this build." });
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.on("update-available", (info) => {
    if (menuTriggered) dialog.showMessageBox({ type: "info", title: "Update", message: `Downloading version ${info.version}…` });
  });
  autoUpdater.on("update-not-available", () => {
    if (menuTriggered) dialog.showMessageBox({ type: "info", title: "Updates", message: "You're on the latest version." });
  });
  autoUpdater.on("update-downloaded", (info) => {
    dialog
      .showMessageBox({
        type: "info",
        title: "Update ready",
        message: `Version ${info.version} downloaded. Restart to install?`,
        buttons: ["Restart now", "Later"],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });
  autoUpdater.on("error", (err) => {
    if (menuTriggered) dialog.showMessageBox({ type: "error", title: "Update failed", message: String(err?.message || err) });
  });
  autoUpdater.checkForUpdates().catch(() => {
    /* offline / no feed — ignore */
  });
}

// Stable name so the user-data folder is the same in dev and packaged builds
// (otherwise dev uses the package.json "name", "second-brain"). MUST run before
// any getPath("userData").
app.setName("Second Brain");

const isDev = !app.isPackaged;
const PORT = process.env.DESKTOP_PORT || "3939";
const HOST = "127.0.0.1";
const userData = app.getPath("userData");
const settingsPath = path.join(userData, "settings.json");
const serverLogPath = path.join(userData, "server.log");
const launchLogPath = path.join(userData, "launch.log");
const appRoot = path.join(__dirname, "..");

// A packaged GUI app has no console, so any startup failure is otherwise
// invisible (the app just vanishes). Log launch milestones + the child server's
// output to files in the user-data folder so failures are always diagnosable.
try {
  fs.mkdirSync(userData, { recursive: true });
} catch {
  /* ignore */
}
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(" ")}`;
  try {
    fs.appendFileSync(launchLogPath, line + "\n");
  } catch {
    /* ignore */
  }
  console.log(line);
}
function tailFile(file, n = 30) {
  try {
    return fs.readFileSync(file, "utf8").split(/\r?\n/).slice(-n).join("\n");
  } catch {
    return "(no log)";
  }
}
// Any unhandled error in the main process lands in launch.log instead of
// vanishing — the single most useful breadcrumb when the app won't open.
process.on("uncaughtException", (err) => {
  log("UNCAUGHT:", (err && err.stack) || String(err));
});
log(`=== launch ${app.getVersion?.() || ""} packaged=${app.isPackaged} ===`);
let windowCreated = false;
let serverFailedShown = false;
function showServerError(reason) {
  if (serverFailedShown || windowCreated) return;
  serverFailedShown = true;
  log("FATAL:", reason);
  const choice = dialog.showMessageBoxSync({
    type: "error",
    title: "Second Brain failed to start",
    message: "The local app server didn't start.",
    detail: `${reason}\n\nLast server log:\n${tailFile(serverLogPath, 20)}`,
    buttons: ["Open log folder", "Quit"],
    defaultId: 0,
  });
  if (choice === 0) shell.openPath(userData);
  app.quit();
}

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
    // The in-app Settings page reads/writes this file via /api/desktop/settings.
    SETTINGS_FILE: settingsPath,
    LOCAL_DB_DIR: path.join(userData, "db"),
    // Local-embeddings model cache. The packaged server's cwd is under the
    // install dir (read-only on Win/mac), so @xenova must write its ~130MB
    // model into the user-data folder instead. Persists across launches.
    TRANSFORMERS_CACHE: path.join(userData, "models"),
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
    if (!fs.existsSync(serverJs)) {
      showServerError(`Bundled server missing at:\n${serverJs}\nThe install looks incomplete — reinstall.`);
      return;
    }
    log("spawning server:", serverJs);
    // Capture the child's stdout/stderr to server.log (a GUI app can't inherit a
    // console, so "inherit" would silently discard every error).
    let out = "ignore";
    try {
      out = fs.openSync(serverLogPath, "w");
    } catch {
      /* fall back to ignore */
    }
    serverProc = spawn(process.execPath, [serverJs], {
      cwd: path.dirname(serverJs),
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", out, out],
    });
  }

  serverProc.on("error", (err) => {
    showServerError(`Could not launch the server process: ${err.message}`);
  });
  serverProc.on("exit", (code) => {
    log(`server exited code=${code}`);
    if (code && code !== 0) showServerError(`Server process exited early (code ${code}).`);
  });
}

/** Poll until the local server answers, then call cb. */
function waitForServer(cb, attempt = 0) {
  if (serverFailedShown) return;
  const req = http.get({ host: HOST, port: PORT, path: "/login", timeout: 1500 }, (res) => {
    res.destroy();
    log(`server ready after ${attempt} attempts`);
    cb();
  });
  req.on("error", () => {
    if (attempt > 120) {
      showServerError("The server did not respond on 127.0.0.1:" + PORT + " within 60 seconds.");
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
  windowCreated = true;
  log("window created, loading app");
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
        { type: "separator" },
        { label: "Check for updates…", click: () => initAutoUpdate(true) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// PGlite is a single-writer embedded DB. A second app instance would spawn a
// second server opening the same data dir and corrupt/lock it. Refuse to start
// a second instance; focus the existing window instead. Guard whenReady with
// the result — otherwise a stale lock would silently quit and the app "won't
// open" with no clue why.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  log("another instance holds the lock — quitting");
  app.quit();
}
function focusWindow() {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
  return win;
}

// Deep links from the web app: secondbrain://open?path=/today → navigate the
// desktop window to that route. Lets "Open in desktop app" jump straight in.
function handleDeepLink(url) {
  if (!url || !url.startsWith("secondbrain://")) return;
  try {
    const p = new URL(url).searchParams.get("path") || "/";
    const route = p.startsWith("/") ? p : `/${p}`;
    const win = focusWindow();
    if (win) win.webContents.loadURL(`http://${HOST}:${PORT}${route}`);
  } catch {
    /* malformed link — ignore */
  }
}

// Register secondbrain:// as this app's protocol (dev needs the script path).
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient("secondbrain", process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient("secondbrain");
}

app.on("second-instance", (_event, argv) => {
  const link = argv.find((a) => a.startsWith("secondbrain://"));
  if (link) handleDeepLink(link);
  else focusWindow();
});

// macOS delivers protocol launches here.
app.on("open-url", (_event, url) => {
  handleDeepLink(url);
});

// Let the in-app Settings page restart the app so new keys/creds take effect
// (settings.json is read once at server spawn).
ipcMain.handle("desktop:relaunch", () => {
  app.relaunch();
  app.exit(0);
});

if (gotSingleInstanceLock)
app.whenReady().then(() => {
  log(`app ready (packaged=${app.isPackaged}, userData=${userData})`);
  buildMenu();
  // First-run guard: without Supabase URL/key the app can't load. Tell the user
  // exactly where to put them and offer to open the file.
  const env = ensureSettingsFile();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    log("first-run: Supabase creds missing");
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
  try {
    startServer();
  } catch (err) {
    showServerError(`Startup error: ${err && err.message ? err.message : err}`);
    return;
  }
  waitForServer(() => {
    createWindow();
    // Cold-start protocol launch (Windows/Linux pass the URL in argv).
    const coldLink = process.argv.find((a) => a.startsWith("secondbrain://"));
    if (coldLink) setTimeout(() => handleDeepLink(coldLink), 600);
  });
  // Check for updates shortly after launch (no-op unless packaged + feed set).
  setTimeout(() => initAutoUpdate(false), 10_000);
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
