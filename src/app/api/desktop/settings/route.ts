import { NextResponse } from "next/server";
import { promises as fs } from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Desktop-only: read/write the local settings.json that Electron injects into
// the server env at launch. Single-user local app, so values (incl. keys) are
// returned to the local renderer as-is — they already live in a plaintext file
// the user can open from the Tools menu.

const EDITABLE = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "VOYAGE_API_KEY",
  "EMBEDDINGS_PROVIDER",
  "DATABASE_URL",
] as const;

function guard(): NextResponse | null {
  if (process.env.APP_RUNTIME !== "desktop" || !process.env.SETTINGS_FILE) {
    return NextResponse.json({ error: "desktop-only" }, { status: 404 });
  }
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

export async function GET() {
  const blocked = guard();
  if (blocked) return blocked;
  const data = await readFile();
  const env: Record<string, string> = {};
  for (const k of EDITABLE) env[k] = data.env[k] ?? "";
  return NextResponse.json({ env });
}

export async function POST(req: Request) {
  const blocked = guard();
  if (blocked) return blocked;
  let body: { env?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const incoming = body.env ?? {};
  const current = await readFile();
  // Merge: only touch editable keys, preserve anything else already in the file.
  for (const k of EDITABLE) {
    if (k in incoming) current.env[k] = String(incoming[k] ?? "");
  }
  await fs.writeFile(process.env.SETTINGS_FILE!, JSON.stringify(current, null, 2), "utf8");
  return NextResponse.json({ ok: true });
}
