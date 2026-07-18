"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Standard pending/error handling for calling a server action from a client
 * component — replaces the ad-hoc `const [saving, setSaving] = useState(false)`
 * pattern. Guards double-submit (calls while pending are dropped) and turns
 * unexpected rejections into an error toast; actions that resolve to
 * `{ ok, error }` keep their own success/error handling at the call site.
 *
 *   const { run, pending } = useAsyncAction(createNoteAction);
 *   <LoadingButton loading={pending} onClick={() => run(title, body)} />
 */
export function useAsyncAction<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  opts?: { errorPrefix?: string },
) {
  const [pending, setPending] = useState(false);
  // Ref (not state) so a double-click in the same tick is still dropped.
  const inFlight = useRef(false);

  const run = useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      if (inFlight.current) return undefined;
      inFlight.current = true;
      setPending(true);
      try {
        return await fn(...args);
      } catch (e) {
        toast.error(
          `${opts?.errorPrefix ?? "Something went wrong"}: ${e instanceof Error ? e.message : "error"}`,
        );
        return undefined;
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [fn, opts?.errorPrefix],
  );

  return { run, pending };
}
