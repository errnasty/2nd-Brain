"use client";

import { useEffect } from "react";
import { applyStoredSettings } from "@/lib/settings";

/** Applies persisted UI prefs (font scale, reduce motion) to <html> on mount,
 *  before paint settles, so the whole app reflects them everywhere. */
export function SettingsEffects() {
  useEffect(() => {
    applyStoredSettings();
  }, []);
  return null;
}
