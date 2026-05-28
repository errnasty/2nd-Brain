"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * Downloads /api/export/memory as second_brain_memory.md — a structured
 * snapshot of the whole knowledge base for uploading to external LLM sandboxes.
 */
export function ExportMemoryButton() {
  const [busy, setBusy] = useState(false);

  async function exportMemory() {
    setBusy(true);
    try {
      const res = await fetch("/api/export/memory", { cache: "no-store" });
      if (!res.ok) {
        toast.error(`Export failed (HTTP ${res.status})`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "second_brain_memory.md";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Knowledge base exported");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={exportMemory} disabled={busy}>
      {busy ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="mr-1.5 h-3.5 w-3.5" />
      )}
      Export Knowledge Base
    </Button>
  );
}
