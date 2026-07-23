import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { directoryItems } from "@/lib/db/schema";
import {
  createNoteAction,
  updateNoteAction,
  bulkMoveDirectoryItemsAction,
  createDirectoryFolderAction,
  autoTagItemAction,
  deleteDirectoryItemAction,
} from "@/app/(app)/directory/actions";
import type { AgentProposal } from "@/lib/ai/agent/stream";

export const runtime = "nodejs";

/**
 * Applies an agent proposal the user approved in the Ask UI (see
 * AgentProposal in lib/ai/agent/stream.ts). The agent's write "tools" never
 * mutate anything themselves — this is the only place a proposal actually
 * turns into a Directory write, and only once a human clicked Approve.
 * Dispatches to the existing directory server actions, which re-check
 * ownership via requireUser() themselves.
 */
export async function POST(req: Request) {
  let auth;
  try {
    auth = await requireUser();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  const userId = auth.user.id;

  let body: { proposal?: AgentProposal };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const proposal = body.proposal;
  if (!proposal || typeof proposal.action !== "string") {
    return Response.json({ ok: false, error: "Missing proposal" }, { status: 400 });
  }

  try {
    switch (proposal.action) {
      case "create_note": {
        const r = await createNoteAction({
          title: proposal.title,
          content: proposal.content,
          folderId: proposal.folderId ?? null,
        });
        return Response.json(r);
      }
      case "append_note":
      case "add_task": {
        // Read the current (full, unclamped) content directly — RAG's
        // fetchItemContents truncates for prompt budget, which would silently
        // chop the note if used as the base for a write-back here.
        const [row] = await db
          .select({ content: directoryItems.content })
          .from(directoryItems)
          .where(and(eq(directoryItems.id, proposal.itemId), eq(directoryItems.userId, userId)))
          .limit(1);
        if (!row) return Response.json({ ok: false, error: "Item not found" }, { status: 404 });
        const current = row.content ?? "";
        const addition = proposal.action === "add_task" ? `- [ ] ${proposal.text}` : proposal.text;
        const next = current.trim().length > 0 ? `${current}\n\n${addition}` : addition;
        const r = await updateNoteAction({ id: proposal.itemId, content: next });
        return Response.json(r);
      }
      case "move": {
        const r = await bulkMoveDirectoryItemsAction([proposal.itemId], proposal.folderId);
        return Response.json(r);
      }
      case "create_folder": {
        const r = await createDirectoryFolderAction(proposal.name, proposal.parentId ?? null);
        return Response.json(r);
      }
      case "autotag": {
        const r = await autoTagItemAction(proposal.itemId);
        return Response.json(r);
      }
      case "delete": {
        await deleteDirectoryItemAction(proposal.itemId);
        return Response.json({ ok: true });
      }
      default:
        return Response.json({ ok: false, error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Couldn't apply that change" },
      { status: 500 },
    );
  }
}
