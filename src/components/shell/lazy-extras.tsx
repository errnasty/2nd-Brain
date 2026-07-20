"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// Onboarding + What's New together are ~600 lines of dialog code that most
// sessions never open. Loading them through next/dynamic keeps them out of
// the shared layout chunk every page pays for; the chunks are only fetched
// when a panel is actually needed.
const Onboarding = dynamic(() => import("./onboarding").then((m) => m.Onboarding));
const WhatsNew = dynamic(() => import("./whats-new").then((m) => m.WhatsNew));

/**
 * Mounts the heavy shell dialogs only when they're needed: on first visit /
 * unseen-changelog (decided server-side, passed as props) or when their
 * open events fire (command palette, settings). A panel mounted because of an
 * event gets `initialOpen` — the event predates the lazy chunk's own listener,
 * so the mount itself is the "open" signal.
 */
export function LazyShellExtras({
  needsOnboarding,
  hasUnseenChangelog,
  lastSeenChangelog,
  onboardingDone,
  displayName,
  interests,
}: {
  needsOnboarding: boolean;
  hasUnseenChangelog: boolean;
  lastSeenChangelog: string | null;
  onboardingDone: boolean;
  displayName: string | null;
  interests: string[];
}) {
  const [onboarding, setOnboarding] = useState<"off" | "auto" | "manual">(
    needsOnboarding ? "auto" : "off",
  );
  const [whatsNew, setWhatsNew] = useState<"off" | "auto" | "manual">(
    hasUnseenChangelog ? "auto" : "off",
  );

  useEffect(() => {
    // Once a panel is mounted its own listener takes over; these only handle
    // the first open, when the chunk isn't loaded yet.
    function onOnboarding() {
      setOnboarding((s) => (s === "off" ? "manual" : s));
    }
    function onWhatsNew() {
      setWhatsNew((s) => (s === "off" ? "manual" : s));
    }
    window.addEventListener("open-onboarding", onOnboarding);
    window.addEventListener("open-whats-new", onWhatsNew);
    return () => {
      window.removeEventListener("open-onboarding", onOnboarding);
      window.removeEventListener("open-whats-new", onWhatsNew);
    };
  }, []);

  return (
    <>
      {onboarding !== "off" && (
        <Onboarding
          initialDone={onboardingDone}
          initialName={displayName}
          initialInterests={interests}
          initialOpen={onboarding === "manual"}
        />
      )}
      {whatsNew !== "off" && (
        <WhatsNew
          lastSeen={lastSeenChangelog}
          onboardingDone={onboardingDone}
          initialOpen={whatsNew === "manual"}
        />
      )}
    </>
  );
}
