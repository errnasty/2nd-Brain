"use client";

import { useEffect } from "react";
import { applyStoredSettings, setActiveUser } from "@/lib/settings";

/** Applies persisted UI prefs (font scale, reduce motion) to <html> on mount,
 *  before paint settles, so the whole app reflects them everywhere.
 *
 *  With a `userId` (the authed app shell), it first marks that account active
 *  so prefs resolve from the account's own scoped keys — including sessions
 *  that signed in before per-user scoping existed. */
export function SettingsEffects({ userId }: { userId?: string }) {
  useEffect(() => {
    if (userId) setActiveUser(userId);
    applyStoredSettings();
  }, [userId]);
  return null;
}
