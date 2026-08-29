"use client";

import { Suspense, lazy } from "react";
import { Textarea } from "@/components/ui/textarea";

export type TitleSuggestion = {
  id: string;
  title: string;
  kind: "saved_article" | "uploaded_document" | "user_note";
};

export type NoteEditorProps = {
  /** The markdown itself — this exact string is what gets stored. */
  value: string;
  onChange: (next: string) => void;
  /** Character offsets, so the AI edit-assist keeps working unchanged. */
  onSelectionChange?: (range: { start: number; end: number }) => void;
  /** Backs `[[` autocomplete. Called with the text typed after the brackets. */
  searchTitles: (query: string) => Promise<TitleSuggestion[]>;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
};

// CodeMirror is ~45KB gzipped and only ever needed once someone edits a note,
// so it stays out of the /directory first-load bundle — same split as
// `ui/markdown.tsx`.
const NoteEditorImpl = lazy(() => import("./note-editor-impl"));

/**
 * Markdown note editor with live preview, formatting shortcuts and `[[`
 * autocomplete.
 *
 * While the chunk loads, a plain textarea stands in with the identical
 * value/onChange contract — you can start typing straight away and the real
 * editor takes over mid-sentence without losing a keystroke.
 */
export function NoteEditor(props: NoteEditorProps) {
  return (
    <Suspense
      fallback={
        <Textarea
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          onSelect={(e) =>
            props.onSelectionChange?.({
              start: e.currentTarget.selectionStart,
              end: e.currentTarget.selectionEnd,
            })
          }
          placeholder={props.placeholder}
          autoFocus={props.autoFocus}
          className="min-h-[60vh] resize-none border-0 px-0 text-base leading-[1.6] shadow-none focus-visible:ring-0"
        />
      }
    >
      <NoteEditorImpl {...props} />
    </Suspense>
  );
}
