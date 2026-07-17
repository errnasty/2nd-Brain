"use client";

import * as React from "react";
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

// The same row actions are offered two ways — right-click (ContextMenu) and a
// hover kebab (DropdownMenu). Those are different Radix primitives, so a menu's
// item list is written once against this injected set of components rather than
// duplicating the JSX (and handler wiring) per menu. Shared by the Directory
// and Feeds row menus.
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
