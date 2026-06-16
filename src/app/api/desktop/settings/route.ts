import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { getApiUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Desktop-only: read/write the local settings.json that Electron injects into
// the server env at launch.
//
// Hardening (these are real secrets — API keys + a cloud DB URL):
//  - desktop-only + a loopback Host check, so a DNS-rebinding page that resolves
//    to 127.0.0.1 (Host: attacker.com) can't reach it;
//  - requires the signed-in app session, so another local process without the
//    cookie can't read or write the keys;
//  - GET never returns secret VALUES — only a "configured" flag — so plaintext
//    keys aren't shipped over HTTP on every settings open. Saving uses
//    blank-means-keep for secrets.

const EDITABLE = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "VOYAGE_API_KEY",
  "EMBEDDINGS_PROVIDER",
  "DATABASE_URL",
] as const;

// Server secrets — never echoed back to the renderer; blank on save = keep.
// (The NEXT_PUBLIC_* values are already exposed to the browser by design, and
// the embeddings provider is a non-sensitive enum.)
const SECRET = new Set<string>(["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "VOYAGE_API_KEY", "DATABASE_URL"]);

/** Desktop + loopback Host + authenticated session. Returns an error Response or null. */
async function guard(req: Request): Promise<NextResponse | null> {
  if (process.env.APP_RUNTIME !== "desktop" || !process.env.SETTINGS_FILE) {
    return NextResponse.json({ error: "desktop-only" }, { status: 404 });
  }
  const host = (req.headers.get("host") ?? "").split(":")[0].toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]") {
    return NextResponse.json({ error: "loopback only" }, { status: 403 });
  }
  const { error } = await getApiUser();
  if (error) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

async function readFile(): Promise<{ env: Record<string, string> }> {
  try {
    const raw = JSON.parse(await fs.readFile(process.env.SETTINGS_FILE!, "utf8"));
    return raw && typeof raw.env === "object" ? raw : { env: {} };
  } catch {
    return { env: {} };
  }
}

export async function GET(req: Request) {
  const blocked = await guard(req);
  if (blocked) return blocked;
  const data = await readFile();
  const env: Record<string, string> = {};
  const configured: Record<string, boolean> = {};
  for (const k of EDITABLE) {
    const v = data.env[k] ?? "";
    configured[k] = v.trim().length > 0;
    // Secrets are returned blank (presence only); non-secret values pass through.
    env[k] = SECRET.has(k) ? "" : v;
  }
  return NextResponse.json({ env, configured });
}

export async function POST(req: Request) {
  const blocked = await guard(req);
  if (blocked) return blocked;
  let body: { env?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const incoming = body.env ?? {};
  const current = await readFile();
  for (const k of EDITABLE) {
    if (!(k in incoming)) continue;
    const v = String(incoming[k] ?? "");
    // Blank secret = keep the existing value (GET never reveals it, so the form
    // submits blank unless the user typed a replacement).
    if (SECRET.has(k) && v === "") continue;
    current.env[k] = v;
  }
  await fs.writeFile(process.env.SETTINGS_FILE!, JSON.stringify(current, null, 2), "utf8");
  return NextResponse.json({ ok: true });
}
