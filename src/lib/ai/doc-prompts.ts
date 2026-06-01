// Saved prompt presets for the per-document "Ask about this" panel.
// Inoreader-style: a set of reusable prompts the user picks from, plus their
// own custom ones. Pure / db-free so client components and tests can import it.

export type DocPrompt = {
  id: string;
  label: string;
  /** The instruction sent to the model, scoped to the open document. */
  prompt: string;
};

const STORAGE_KEY = "docquery.prompts.v1";

export const DEFAULT_DOC_PROMPTS: DocPrompt[] = [
  { id: "summary", label: "Summarize", prompt: "Summarize this document in a few tight paragraphs." },
  { id: "takeaways", label: "Key takeaways", prompt: "List the key takeaways as concise bullet points." },
  { id: "eli5", label: "Explain simply", prompt: "Explain the main ideas of this document in plain, simple language." },
  { id: "critique", label: "Counterpoints", prompt: "What are the strongest counterarguments or weaknesses in this document?" },
  { id: "actions", label: "Action items", prompt: "Extract any action items, next steps, or decisions implied by this document." },
  { id: "terms", label: "Define terms", prompt: "Define the key terms and jargon used in this document." },
];

function isValid(p: unknown): p is DocPrompt {
  return (
    !!p &&
    typeof p === "object" &&
    typeof (p as DocPrompt).id === "string" &&
    typeof (p as DocPrompt).label === "string" &&
    typeof (p as DocPrompt).prompt === "string"
  );
}

/** Read the user's saved prompts from localStorage, seeded with defaults. */
export function loadDocPrompts(): DocPrompt[] {
  if (typeof window === "undefined") return DEFAULT_DOC_PROMPTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DOC_PROMPTS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every(isValid) && parsed.length > 0) {
      return parsed as DocPrompt[];
    }
  } catch {
    // Corrupt/blocked storage — fall back to defaults.
  }
  return DEFAULT_DOC_PROMPTS;
}

export function saveDocPrompts(prompts: DocPrompt[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
  } catch {
    // Ignore quota/availability errors.
  }
}

export function newPromptId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
