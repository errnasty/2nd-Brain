import { toast } from "sonner";

type ActionResult = { ok: boolean; error?: string } | void | undefined | null;

/**
 * Run an optimistic UI action with automatic revert + error toast. Handles
 * actions that return {ok,error}, return void, OR throw — so no call site can
 * silently fail or fire a premature success toast.
 *
 *   apply()  → update UI immediately
 *   action() → the server action
 *   revert() → undo the optimistic update on failure
 *
 * Returns true on success.
 */
export async function runOptimistic(opts: {
  apply: () => void;
  revert: () => void;
  action: () => Promise<ActionResult>;
  success?: string;
  errorPrefix?: string;
}): Promise<boolean> {
  opts.apply();
  try {
    const r = await opts.action();
    if (r && typeof r === "object" && "ok" in r && r.ok === false) {
      opts.revert();
      toast.error(r.error ?? "Action failed");
      return false;
    }
    if (opts.success) toast.success(opts.success);
    return true;
  } catch (e) {
    opts.revert();
    toast.error(`${opts.errorPrefix ?? "Failed"}: ${e instanceof Error ? e.message : "error"}`);
    return false;
  }
}
