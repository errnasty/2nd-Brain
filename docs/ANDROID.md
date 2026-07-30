# Android app (Trusted Web Activity)

The Android app is a **Trusted Web Activity**: a ~2 MB native shell that renders
`https://remarkable-boba-9e956e.netlify.app` full screen, using the copy of
Chrome already on the device. It contains none of the app's code.

That one design choice is why this is cheap to maintain:

| What changed | You do | Users do |
| --- | --- | --- |
| App code, UI, a new feature | `git push` (as always) | Nothing — next launch is current |
| App **name**, **icon**, **package**, or **origin** | Rebuild the APK (below) | Reinstall once |

Content ships through Netlify, so the APK itself is built rarely — realistically
once, and again only if the site moves to a custom domain.

---

## The one thing that silently breaks this

Android decides whether to hide the browser address bar by fetching
`https://<origin>/.well-known/assetlinks.json` **with no cookies** and checking
that it names this app's package and signing key.

If that request returns anything other than `200` with the right JSON, the app
still installs and still works — it just has a Chrome address bar pinned to the
top of every screen, forever. Nothing is logged, and no error is shown.

Two guards are in place for this, both worth knowing about before you edit them:

- `src/middleware.ts` excludes `.well-known` from its matcher. Without that, the
  auth middleware redirects the uncredentialed verifier to `/login` (a 307), and
  verification fails. This is the same failure the file already documents for
  `manifest.webmanifest`.
- `src/lib/supabase/middleware.ts` also lists `/.well-known` in `isAuthRoute`, as
  a second layer in case the matcher is ever rewritten.

**Verify it before you distribute anything:**

```bash
curl -i https://remarkable-boba-9e956e.netlify.app/.well-known/assetlinks.json
```

You want `HTTP/2 200` and the JSON body. A `307` means the middleware guard is
gone. A `404` means the deploy hasn't landed yet.

---

## First-time setup

### 1. Create the signing key — once, and keep it forever

The keystore is the app's identity. Android will only install an update over an
existing install if it's signed with the **same** key.

```powershell
keytool -genkeypair -v -keystore android.keystore -storetype PKCS12 `
        -keyalg RSA -keysize 2048 -validity 10000 -alias android
```

It prompts for a password and some identity fields (name, org — any sane values
are fine for a self-signed app). Save the file and the password in your password
manager.

> **If you lose it:** you cannot ship an update to anyone who installed the old
> APK. They'd have to uninstall and reinstall, losing nothing but their session.
> Not fatal, but avoidable — back it up now.

No JDK on the machine? Bubblewrap downloads one; the path is recorded in
`~/.bubblewrap/config.json` under `jdkPath`, and `keytool.exe` lives in
`<jdkPath>\bin\`.

`.gitignore` blocks `*.keystore` and `*.jks` repo-wide, so it can't be committed
by accident.

### 2. Put the fingerprint in `assetlinks.json`

```powershell
keytool -list -v -keystore android.keystore -alias android
```

Copy the value on the `SHA256:` line — already in the colon-separated uppercase
form Android wants — and replace `REPLACE_WITH_YOUR_KEYSTORE_SHA256_FINGERPRINT`
in `public/.well-known/assetlinks.json`.

### 3. Deploy, then verify

Push, wait for Netlify, then run the `curl` above. **Do this before building the
APK.** Android caches the verification result at install time, so an APK
installed before the file is live keeps its address bar until it's reinstalled.

### 4. Build the APK

```powershell
npm install -g @bubblewrap/cli     # needs JDK 17 — not 11, not 21
cd android
bubblewrap init --manifest https://remarkable-boba-9e956e.netlify.app/manifest.webmanifest
```

`init` asks a series of questions. `twa-manifest.json` in this directory already
holds every answer — package id, colours, icon, signing key — so accept what it
offers and correct anything that differs from that file. Point it at the
`android.keystore` from step 1.

```powershell
bubblewrap build
```

Output: **`android/app-release-signed.apk`** — that's the file to publish. A
`.aab` is produced alongside it; that's a Play Store format and can be ignored.

Only `android/twa-manifest.json` is tracked in git. Everything else `init`
generates is regenerable and stays out of the repo.

### 5. Publish it

Create a GitHub Release and attach the APK **named exactly `second-brain.apk`**.
The download page links to:

```
https://github.com/errnasty/2nd-Brain/releases/latest/download/second-brain.apk
```

That permalink always resolves to the newest release, which is why
`src/app/download/page.tsx` carries no version number and never needs editing.

---

## Rebuilding later

Bump `appVersionCode` in `android/twa-manifest.json` — **it must strictly
increase**, or Android refuses to install over the existing app — then re-run
`bubblewrap build` and attach the new APK to a new Release.

If the **origin** changes (custom domain), update it in `android/twa-manifest.json`
(three places: `host`, `iconUrl`, `webManifestUrl`), redeploy `assetlinks.json`
on the new domain, and rebuild. Existing installs keep pointing at the old
origin until users reinstall.

---

## Testing a build

```bash
adb install -r android/app-release-signed.apk
```

1. **No address bar at the top.** This is the pass/fail signal for asset-link
   verification — everything else can look right while this is wrong.
2. Launcher shows "2nd Brain" with the right icon; splash is black.
3. Sign in, force-stop the app, reopen — you're still signed in.
4. Airplane mode: pages you've visited still open; an unvisited page shows the
   app's offline fallback rather than a Chrome error.
5. Push a visible change, wait for Netlify, relaunch — it's there, no reinstall.

Render problems are debuggable over `chrome://inspect` from a desktop Chrome with
the phone plugged in.

---

## Known limits

- **Needs a current Chrome.** On a device with no Chrome, or a very old one, the
  shell falls back to opening the site in whatever browser exists — with that
  browser's chrome visible. Virtually all Android phones are fine; it's called
  out on the download page rather than hidden.
- **Backgrounded apps get killed.** Standard Android behaviour: relaunch reloads
  the page. Cookies, cached pages, and local data survive; unsaved in-progress
  UI state doesn't — same as a discarded browser tab.
- **No push notifications.** The shell is built with notification delegation off
  (`enableNotifications: false`) because the site doesn't send web push. Turning
  it on later is a `twa-manifest.json` flag plus a rebuild.
- **No iOS build.** Apple has no TWA equivalent. Safari's "Add to Home Screen"
  gets most of the way there and needs nothing from us.
