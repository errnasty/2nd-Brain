// Minimal, safe bridge for the local renderer. Exposes only an explicit relaunch
// (used by the in-app Settings page to apply new keys/creds) — no general IPC.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  isDesktop: true,
  relaunch: () => ipcRenderer.invoke("desktop:relaunch"),
});
