"use client";

import { Brain, Eye, FolderInput, HelpCircle, Inbox, Trash2 } from "lucide-react";
import type { MenuPrimitives } from "@/components/ui/menu-primitives";
import type { DirectoryFolder } from "@/lib/db/schema";

export {
  CONTEXT_MENU_PRIMITIVES,
  DROPDOWN_MENU_PRIMITIVES,
  type MenuPrimitives,
} from "@/components/ui/menu-primitives";

export function ItemRowMenuItems({
  prims,
  folders,
  onOpen,
  onMakeCards,
  onMakeQuiz,
  onMove,
  onDelete,
}: {
  prims: MenuPrimitives;
  folders: DirectoryFolder[];
  onOpen: () => void;
  onMakeCards: () => void;
  onMakeQuiz: () => void;
  /** Move this item to a folder (null = Unsorted). */
  onMove: (folderId: string | null, folderName: string) => void;
  onDelete: () => void;
}) {
  const { Item, Sub, SubTrigger, SubContent, Separator } = prims;
  const realFolders = folders.filter((f) => !f.isInbox);

  return (
    <>
      <Item onClick={onOpen}>
        <Eye className="mr-2 h-3.5 w-3.5" /> Open
      </Item>
      <Item onClick={onMakeCards}>
        <Brain className="mr-2 h-3.5 w-3.5" /> Make flashcards
      </Item>
      <Item onClick={onMakeQuiz}>
        <HelpCircle className="mr-2 h-3.5 w-3.5" /> Make quiz
      </Item>
      <Sub>
        <SubTrigger>
          <FolderInput className="mr-2 h-3.5 w-3.5" /> Move to…
        </SubTrigger>
        <SubContent className="max-h-[40vh] overflow-y-auto">
          <Item onClick={() => onMove(null, "Unsorted")}>
            <Inbox className="mr-2 h-3.5 w-3.5" /> Unsorted
          </Item>
          {realFolders.map((f) => (
            <Item key={f.id} onClick={() => onMove(f.id, f.name)}>
              <FolderInput className="mr-2 h-3.5 w-3.5 text-muted-foreground" /> {f.name}
            </Item>
          ))}
        </SubContent>
      </Sub>
      <Separator />
      <Item onClick={onDelete} className="text-destructive focus:text-destructive">
        <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
      </Item>
    </>
  );
}
