"use client";

import { createContext, useCallback, useContext, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { Button } from "./button";
import { Input } from "./input";

// One themed confirm/prompt for the whole app, replacing native confirm()/prompt()
// (which ignore the theme, clash with our Radix dialogs, and are clunky on
// mobile). Both return a Promise so call sites read like the native APIs:
//   if (await confirm({ title, body, destructive: true })) { … }
//   const name = await promptText({ title, label });  // null = cancelled

type ConfirmOpts = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};
type PromptOpts = {
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
};

type Pending =
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: "prompt"; opts: PromptOpts; resolve: (v: string | null) => void };

type Ctx = {
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  promptText: (opts: PromptOpts) => Promise<string | null>;
};

const AppDialogContext = createContext<Ctx | null>(null);

export function useConfirm(): Ctx["confirm"] {
  const ctx = useContext(AppDialogContext);
  if (!ctx) throw new Error("useConfirm must be used within AppDialogProvider");
  return ctx.confirm;
}
export function usePromptText(): Ctx["promptText"] {
  const ctx = useContext(AppDialogContext);
  if (!ctx) throw new Error("usePromptText must be used within AppDialogProvider");
  return ctx.promptText;
}

export function AppDialogProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState("");

  const confirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) => setPending({ kind: "confirm", opts, resolve })),
    [],
  );
  const promptText = useCallback(
    (opts: PromptOpts) =>
      new Promise<string | null>((resolve) => {
        setValue(opts.defaultValue ?? "");
        setPending({ kind: "prompt", opts, resolve });
      }),
    [],
  );

  const settle = useCallback(
    (result: boolean | string | null) => {
      setPending((p) => {
        if (p) {
          if (p.kind === "confirm") p.resolve(result as boolean);
          else p.resolve(result as string | null);
        }
        return null;
      });
    },
    [],
  );

  // Esc / outside-click → cancel (Radix Dialog handles both and calls this).
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open) settle(pending?.kind === "confirm" ? false : null);
    },
    [pending, settle],
  );

  return (
    <AppDialogContext.Provider value={{ confirm, promptText }}>
      {children}
      <Dialog open={!!pending} onOpenChange={onOpenChange}>
        {pending && (
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{pending.opts.title}</DialogTitle>
              {pending.kind === "confirm" && pending.opts.body && (
                <DialogDescription>{pending.opts.body}</DialogDescription>
              )}
              {pending.kind === "prompt" && pending.opts.description && (
                <DialogDescription>{pending.opts.description}</DialogDescription>
              )}
            </DialogHeader>

            {pending.kind === "prompt" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (value.trim()) settle(value.trim());
                }}
              >
                <Input
                  autoFocus
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={pending.opts.placeholder}
                />
              </form>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={() => settle(pending.kind === "confirm" ? false : null)}>
                {pending.kind === "confirm" ? pending.opts.cancelLabel ?? "Cancel" : "Cancel"}
              </Button>
              <Button
                variant={pending.kind === "confirm" && pending.opts.destructive ? "destructive" : "default"}
                disabled={pending.kind === "prompt" && !value.trim()}
                onClick={() => settle(pending.kind === "confirm" ? true : value.trim() || null)}
              >
                {pending.opts.confirmLabel ?? (pending.kind === "confirm" ? "Confirm" : "Save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </AppDialogContext.Provider>
  );
}
