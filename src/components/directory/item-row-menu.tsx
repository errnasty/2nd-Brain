"use client";

import * as React from "react";
import { Brain, Eye, FolderInput, HelpCircle, Inbox, Trash2 } from "lucide-react";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import type { DirectoryFolder } from "@/lib/db/schema";

// The same actions are offered two ways — right-click (ContextMenu) and a hover
// kebab (DropdownMenu). Those are different Radix primitives, so we render the
// item list once against an injected set of components rather than duplicating
// the JSX (and, worse, the handler wiring) in both menus.
type MenuItemComp = React.ComponentType<{
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  children: React.ReactNode;
}>;
type MenuPlainComp = React.ComponentType<{ className?: string; children?: React.ReactNode }>;

export type MenuPrimitives = {
  Item: MenuItemComp;
  Sub: MenuPlainComp;
  SubTrigger: MenuPlainComp;
  SubContent: MenuPlainComp;
  Separator: React.ComponentType<{ className?: string }>;
};

export const CONTEXT_MENU_PRIMITIVES: MenuPrimitives = {
  Item: ContextMenuItem as unknown as MenuItemComp,
  Sub: ContextMenuSub as unknown as MenuPlainComp,
  SubTrigger: ContextMenuSubTrigger as unknown as MenuPlainComp,
  SubContent: ContextMenuSubContent as unknown as MenuPlainComp,
  Separator: ContextMenuSeparator as unknown as MenuPrimitives["Separator"],
};

export const DROPDOWN_MENU_PRIMITIVES: MenuPrimitives = {
  Item: DropdownMenuItem as unknown as MenuItemComp,
  Sub: DropdownMenuSub as unknown as MenuPlainComp,
  SubTrigger: DropdownMenuSubTrigger as unknown as MenuPlainComp,
  SubContent: DropdownMenuSubContent as unknown as MenuPlainComp,
  Separator: DropdownMenuSeparator as unknown as MenuPrimitives["Separator"],
};

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
