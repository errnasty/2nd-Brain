# Second Brain — Desktop (local-first) app

The desktop app runs the whole app **locally** on an embedded Postgres (PGlite)
so reads/writes are instant and work offline — like Obsidian. Supabase stays the
**cloud** that devices sync through. The Netlify web app is unaffected.

```
Electron window → local Next.js server → PGlite (local Postgres + pgvector)   ← instant
                                          └─ background sync ⇄ Supabase (cloud)
```

---

## 1. Prerequisites
- **Node 20** (`.nvmrc` is set to 20). Check: `node -v`.
- Git + this repo cloned.

## 2. Install
```bash
npm install
```
**Windows note:** Electron's binary sometimes fails to extract during install
(error `electron/path.txt ENOENT` when you run the app). If so, run once:
```bash
npm run desktop:fix
```

## 3. Run the desktop app (dev)
```bash
npm run desktop:dev
```
This launches Electron, which boots the local server in desktop mode
(`APP_RUNTIME=desktop`) against the embedded PGlite DB and opens the window.

On **first launch** the app auto-creates `settings.json` (see §4) and, if your
Supabase URL/key aren't set yet, shows a dialog with the file path and offers to
open it. Fill it in (§4), reopen the app, then sign in once **while online** with
your Supabase account — this establishes your identity and creates your local
profile. After that, the app trusts the stored session and runs locally.

> The first run seeds `settings.json` from the project's `.env.local` if present,
> so existing web-app config carries over automatically.

---

## 4. Where do the API keys / Supabase URL go?

**Easiest: the in-app Settings page.** Open **Settings** in the app — the desktop
build shows a **Keys & connection** section (Supabase URL/key, Anthropic key,
embeddings provider, cloud `DATABASE_URL`) plus a **Cloud sync** panel with live
status and a **Sync now** button. Edit, **Save**, then **Restart now**. No file
editing required.

Under the hood they're stored in a local **`settings.json`** (auto-created on first
launch). You can still edit it directly: menu **Tools → Open settings file (keys /
cloud sync)…**, then **Tools → Restart app**.

`settings.json` lives in the app's user-data folder:

| OS | Path |
|----|------|
| Windows | `%APPDATA%\Second Brain\settings.json` (e.g. `C:\Users\<you>\AppData\Roaming\Second Brain\settings.json`) |
| macOS | `~/Library/Application Support/Second Brain/settings.json` |
| Linux | `~/.config/Second Brain/settings.json` |

Shape — everything under `env` is injected into the local server's environment:

```json
{
  "env": {
    "NEXT_PUBLIC_SUPABASE_URL": "https://YOUR-PROJECT.supabase.co",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY": "eyJhbGciOi... (anon public key)",

    "ANTHROPIC_API_KEY": "sk-ant-... (for Ask / Daily Brief / Study plan)",

    "EMBEDDINGS_PROVIDER": "local",

    "DATABASE_URL": "postgresql://postgres:PASSWORD@db.YOUR-PROJECT.supabase.co:5432/postgres"
  }
}
```

What each one is for:
- **`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`** — login/auth. Get
  them in Supabase → Project Settings → **API** (URL + `anon` `public` key).
- **`ANTHROPIC_API_KEY`** — AI features run locally with your own key. The desktop
  build uses a stronger model (Sonnet) for a more detailed study plan, since
  there's no serverless time limit. (Optional: `STUDY_PLAN_MODEL` to force e.g.
  `claude-opus-4-7`.)
- **Embeddings** — set `EMBEDDINGS_PROVIDER=local` to embed on-device with no key
  (the `@xenova` model is bundled; the ~130 MB weights download once on first use
  and cache under `…/Second Brain/models`), **or** provide `OPENAI_API_KEY` /
  `VOYAGE_API_KEY` and set the provider accordingly. Switching providers later
  requires re-embedding (vectors from different models aren't comparable).
- **`DATABASE_URL`** — your cloud Supabase Postgres connection string, used **only
  by sync** (Phase 4). Supabase → Project Settings → **Database** → Connection
  string (URI). Leave blank to run purely local with no cloud sync.

> The local database itself needs no configuration. It's created automatically at
> `…/Second Brain/db` and the schema is set up on first launch.

---

## 5. Sync with the cloud
Set `DATABASE_URL` (above) to your Supabase. Sync reconciles the local DB with the
cloud by last-write-wins (newest `updatedAt` wins): it runs on launch, every 5 min,
and on demand (**Sync now** in Settings, or **Tools → Sync now**). Embeddings are
never synced — they regenerate locally to save bandwidth. Deletes propagate via
tombstones. The first sync of a full account pulls everything (~tens of thousands of
rows) in batches; later syncs only move what changed.

**Multi-device conflicts.** If you edit the same note on two devices between syncs,
last-write-wins keeps the newer one — and a banner appears in the app letting you
**review and copy** the overwritten local version so nothing is silently lost.

> Sync targets whatever `DATABASE_URL` points at. To trial it safely first, point at
> a throwaway Supabase project, confirm round-trips, then switch to your real creds.

---

## 6. Build a distributable installer
```bash
npm run desktop:icons   # regenerate app icons (once / after changing the mark)
npm run desktop:build
```
Produces an installer in `dist-desktop/` (`.exe`/NSIS ~137 MB on Windows, `.dmg` on
macOS, AppImage/`.deb` on Linux). Build on the target OS for that OS's installer.
On Windows the installer lands at `dist-desktop\Second Brain Setup <version>.exe`.

### Auto-update (optional)
The app self-updates from **GitHub Releases** via `electron-updater`. To enable:
1. In `package.json` → `build.publish`, set `owner` to your GitHub user and `repo`.
2. `set GH_TOKEN=<a token with repo scope>` and run `npx electron-builder --win --publish always`.
3. Installed apps then check on launch (and **Tools → Check for updates…**), download
   in the background, and prompt to restart. Until a release is published this is a
   harmless no-op.

### Open from the web
The web app's Settings has **Open in desktop app**, which hands off to the installed
desktop app via the `secondbrain://` protocol and jumps to the same page.

---

## Troubleshooting
- **`electron/path.txt ENOENT`** → `npm run desktop:fix` (Windows extraction quirk).
- **AI features say "not configured"** → add the relevant key in **Settings → Keys &
  connection** (or `settings.json`), Save, then Restart.
- **Login keeps redirecting** → you must sign in once online first; check the
  Supabase URL + anon key.
- **Reset the local DB** → quit the app and delete the `db` folder in the user-data
  directory above; it rebuilds on next launch (cloud data re-syncs if configured).
