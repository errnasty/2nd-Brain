import { and, eq, ilike, or, sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { directoryItems, profiles } from "@/lib/db/schema";
import { buildDirectoryMap, retrieveFromDirectory, type RagSource } from "@/lib/ai/rag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────
// Minimal Model Context Protocol (MCP) server over HTTP/JSON-RPC 2.0.
// Lets an external Claude Desktop/mobile client read this Second Brain.
//
// Auth: a static `X-MCP-Token` header checked against env MCP_TOKEN.
// Target user: resolved from env MCP_USER_EMAIL (matched against profiles.email),
// or the sole profile if there's exactly one.
//
// Tools exposed:
//   - search_second_brain(query): hybrid keyword + semantic search → text chunks
//   - fetch_directory_tree(): structural folder/item map
// ─────────────────────────────────────────────────────────────────────

const SERVER_INFO = { name: "second-brain", version: "1.0.0" };
const PROTOCOL_VERSION = "2024-11-05";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
};

const TOOLS = [
  {
    name: "search_second_brain",
    description:
      "Hybrid keyword + semantic search across the user's Second Brain (notes, saved articles, uploaded documents). Returns the most relevant text chunks with their titles.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for." },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_directory_tree",
    description:
      "Return the structural layout of the user's Second Brain — folder hierarchy and item titles (no bodies) — so you can see where knowledge lives.",
    inputSchema: { type: "object", properties: {} },
  },
];

async function resolveUserId(): Promise<string | null> {
  const email = process.env.MCP_USER_EMAIL;
  if (email) {
    const [row] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, email))
      .limit(1);
    if (row) return row.id;
  }
  // Fall back to the sole profile (personal single-user deployment).
  const all = await db.select({ id: profiles.id }).from(profiles).limit(2);
  if (all.length === 1) return all[0].id;
  return null;
}

/** Keyword search over directory item titles + content. */
async function keywordSearch(userId: string, query: string, limit: number) {
  const pattern = `%${query.replace(/[%_]/g, "\\$&")}%`;
  const titleOrContent = or(ilike(directoryItems.title, pattern), ilike(directoryItems.content, pattern));
  return db
    .select({
      id: directoryItems.id,
      title: directoryItems.title,
      kind: directoryItems.kind,
      snippet: sql<string>`substring(coalesce(${directoryItems.content}, ''), 1, 400)`.as("snippet"),
    })
    .from(directoryItems)
    .where(titleOrContent ? and(eq(directoryItems.userId, userId), titleOrContent) : eq(directoryItems.userId, userId))
    .limit(limit);
}

async function hybridSearch(userId: string, query: string): Promise<string> {
  // Semantic (vector) + keyword, deduped by directory item id. Semantic may be
  // empty if embeddings aren't built; keyword still returns hits.
  let semantic: RagSource[] = [];
  try {
    semantic = await retrieveFromDirectory(userId, query, 8);
  } catch {
    // ignore — keyword carries it
  }
  const keyword = await keywordSearch(userId, query, 8).catch(() => []);

  const byId = new Map<string, { title: string; kind: string; snippet: string }>();
  for (const s of semantic) {
    byId.set(s.directoryItemId, { title: s.title, kind: s.kind, snippet: s.snippet });
  }
  for (const k of keyword) {
    if (!byId.has(k.id)) byId.set(k.id, { title: k.title, kind: k.kind, snippet: (k.snippet ?? "").trim() });
  }

  const results = Array.from(byId.values()).slice(0, 12);
  if (results.length === 0) return `No results in the Second Brain for "${query}".`;
  return results
    .map((r, i) => `[${i + 1}] ${r.title} (${r.kind.replace("_", " ")})\n${r.snippet}`)
    .join("\n\n");
}

function rpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result });
}
function rpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

export async function POST(req: Request) {
  // ── Auth ──
  if (!process.env.MCP_TOKEN) {
    return NextResponse.json({ error: "MCP not configured" }, { status: 503 });
  }
  const supplied = Buffer.from(req.headers.get("x-mcp-token") ?? "");
  const expected = Buffer.from(process.env.MCP_TOKEN);
  // Constant-time compare (length check leaks only length, which is fine).
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: JsonRpcRequest;
  try {
    body = (await req.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  const { id, method, params } = body;

  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });

    case "notifications/initialized":
      // Notification — no response body expected.
      return new NextResponse(null, { status: 204 });

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, { tools: TOOLS });

    case "tools/call": {
      const userId = await resolveUserId();
      if (!userId) {
        return rpcError(id, -32603, "Could not resolve a Second Brain user. Set MCP_USER_EMAIL.");
      }
      const toolName = (params?.name as string) ?? "";
      const args = (params?.arguments as Record<string, unknown>) ?? {};

      try {
        if (toolName === "search_second_brain") {
          const query = String(args.query ?? "").trim();
          if (!query) return rpcError(id, -32602, "Missing required argument: query");
          const text = await hybridSearch(userId, query);
          return rpcResult(id, { content: [{ type: "text", text }] });
        }
        if (toolName === "fetch_directory_tree") {
          const text = await buildDirectoryMap(userId);
          return rpcResult(id, { content: [{ type: "text", text }] });
        }
        return rpcError(id, -32601, `Unknown tool: ${toolName}`);
      } catch (err) {
        return rpcError(id, -32603, err instanceof Error ? err.message : "Tool execution failed");
      }
    }

    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

// A GET probe so you can verify the endpoint is alive (no secrets leaked).
export async function GET() {
  return NextResponse.json({
    server: SERVER_INFO,
    protocol: PROTOCOL_VERSION,
    transport: "http/json-rpc",
    auth: "X-MCP-Token header",
    tools: TOOLS.map((t) => t.name),
  });
}
