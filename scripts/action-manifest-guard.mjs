// Build-time guard against the "Server Action not found on the server" class of
// bug (the Next.js failed-to-find-server-action error).
//
// Root cause we hit: the desktop app bundles a Next.js `standalone` server in
// its install resources. The Server Action manifest is generated at `next build`
// time and baked into that bundled server. The client bundle references action
// IDs that must exist in the SERVER's manifest. If the standalone server is
// stale relative to the client (e.g. a partial rebuild, or electron-builder
// shipped an older .next/standalone), every Server Action call fails with
// "Server Action '<hash>' was not found on the server".
//
// This module compares the action-ID sets of the two manifests that the build
// is about to package and throws if they disagree — turning a cryptic runtime
// error into a loud, early build failure. It is pure (no fs side effects) so it
// is unit-testable without running a full `next build`.

/**
 * Extract the set of Server Action IDs from a parsed Next.js
 * server-reference-manifest.json. The manifest shape is
 * `{ node: { <id>: {...} }, edge: { <id>: {...} } }`
 * (one or both may be present).
 * @param {unknown} manifest
 * @returns {Set<string>}
 */
export function actionIdsFromManifest(manifest) {
  /** @type {Set<string>} */
  const ids = new Set();
  if (!manifest || typeof manifest !== "object") return ids;
  const groups =
    (/** @type {any} */ (manifest)).node ?? (/** @type {any} */ (manifest)).edge;
  if (!groups || typeof groups !== "object") return ids;
  for (const key of Object.keys(groups)) {
    // Action IDs are 40+ char hex strings; ignore any other keys defensively.
    if (/^[0-9a-f]{40,}$/.test(key)) ids.add(key);
  }
  return ids;
}

/**
 * Compare two action manifests. Throws if they disagree — this is the guard that
 * prevents shipping a standalone server whose action manifest is stale relative
 * to the client (the cause of the runtime "Server Action not found" error).
 * @param {unknown} serverManifest
 * @param {unknown} standaloneManifest
 */
export function assertActionManifestsConsistent(serverManifest, standaloneManifest) {
  const server = actionIdsFromManifest(serverManifest);
  const standalone = actionIdsFromManifest(standaloneManifest);

  const inServerNotStandalone = Array.from(server).filter((id) => !standalone.has(id));
  const inStandaloneNotServer = Array.from(standalone).filter((id) => !server.has(id));

  if (inServerNotStandalone.length === 0 && inStandaloneNotServer.length === 0) {
    return;
  }

  throw new Error(
    "Server Action manifest mismatch between the build output and the bundled " +
      "standalone server. This means the desktop app would fail at runtime with " +
      "\"Server Action '<hash>' was not found on the server\".\n" +
      `  actions only in server manifest (${inServerNotStandalone.length}): ` +
      inServerNotStandalone.slice(0, 5).join(", ") +
      (inServerNotStandalone.length > 5 ? " …" : "") +
      "\n" +
      `  actions only in standalone manifest (${inStandaloneNotServer.length}): ` +
      inStandaloneNotServer.slice(0, 5).join(", ") +
      (inStandaloneNotServer.length > 5 ? " …" : ""),
  );
}
