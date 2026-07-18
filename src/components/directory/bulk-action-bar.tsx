"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderInput, HelpCircle, Inbox, Trash2, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { generateQuizAction } from "@/app/(app)/study/quiz-actions";
import { toast } from "sonner";
import type { DirectoryFolder } from "@/lib/db/schema";

export function BulkActionBar({
  selectedIds,
  folders,
  onClear,
  onDelete,
  onMove,
}: {
  selectedIds: string[];
  folders: DirectoryFolder[];
  onClear: () => void;
  /** Delete the selection via the shell's undo-toast flow (also clears it). */
  onDelete: (ids: string[]) => void;
  /** Move the selection via the shell's undo-toast flow (also clears it). */
  onMove: (ids: string[], folderId: string | null, folderName: string) => void;
}) {
  const router = useRouter();
  const [makingQuiz, setMakingQuiz] = useState(false);
  const count = selectedIds.length;
  if (count === 0) return null;

  function handleMakeQuiz() {
    if (makingQuiz) return;
    setMakingQuiz(true);
    generateQuizAction(selectedIds)
      .then((r) => {
        if (r.ok) {
          toast.success(`Quiz ready — ${r.count} question${r.count === 1 ? "" : "s"}`);
          onClear();
          router.push(`/study?tab=quiz&quiz=${r.id}`);
        } else {
          toast.error(r.error);
        }
      })
      .catch((e) => toast.error(`Quiz failed: ${e instanceof Error ? e.message : "error"}`))
      .finally(() => setMakingQuiz(false));
  }

  return (
    <div className="pointer-events-auto fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-2xl border border-border bg-card/95 px-4 py-2 shadow-lg backdrop-blur lg:bottom-6 lg:flex-nowrap lg:rounded-full">
      <span className="text-sm font-medium">
        {count} selected
      </span>
      <span className="h-4 w-px bg-border" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost">
            <FolderInput className="mr-1.5 h-3.5 w-3.5" />
            Move to…
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" side="top" className="max-h-[40vh] overflow-y-auto">
          <DropdownMenuLabel>Move {count} item{count === 1 ? "" : "s"} to</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onMove(selectedIds, null, "Unsorted")}>
            <Inbox className="mr-2 h-3.5 w-3.5" /> Unsorted
          </DropdownMenuItem>
          {folders.filter((f) => !f.isInbox).length > 0 && <DropdownMenuSeparator />}
          {folders
            .filter((f) => !f.isInbox)
            .map((folder) => (
              <DropdownMenuItem key={folder.id} onClick={() => onMove(selectedIds, folder.id, folder.name)}>
                <FolderInput className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                {folder.name}
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button size="sm" variant="ghost" onClick={handleMakeQuiz} disabled={makingQuiz}>
        {makingQuiz ? (
          <Spinner className="mr-1.5 h-3.5 w-3.5" />
        ) : (
          <HelpCircle className="mr-1.5 h-3.5 w-3.5" />
        )}
        Quiz
      </Button>

      <Button
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={() => onDelete(selectedIds)}
      >
        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
        Delete
      </Button>

      <span className="h-4 w-px bg-border" />
      <button
        onClick={onClear}
        className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        title="Clear selection"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
