/**
 * Recursive character text splitter (LangChain-style).
 *
 * Targets ~1000 tokens with ~200 token overlap. Tokens are approximated as
 * 4 chars each (good enough for English; we re-tokenize for cost calculations
 * in Phase 4 if needed). Splits on the largest natural boundary it can find,
 * then falls back to smaller ones (paragraphs → lines → sentences → words → chars).
 */
const DEFAULT_SEPARATORS = ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " ", ""];

export type Chunk = {
  index: number;
  text: string;
  approxTokens: number;
};

export type ChunkerOptions = {
  chunkSize?: number;   // chars
  overlap?: number;     // chars
  separators?: string[];
};

export function chunkText(input: string, opts: ChunkerOptions = {}): Chunk[] {
  const text = input.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const chunkSize = opts.chunkSize ?? 4000;   // ~1000 tokens
  const overlap = opts.overlap ?? 800;        // ~200 tokens
  const separators = opts.separators ?? DEFAULT_SEPARATORS;

  if (text.length <= chunkSize) {
    return [{ index: 0, text, approxTokens: Math.ceil(text.length / 4) }];
  }

  const pieces = splitRecursive(text, chunkSize, separators);
  const merged = mergeWithOverlap(pieces, chunkSize, overlap);
  return merged.map((t, i) => ({ index: i, text: t, approxTokens: Math.ceil(t.length / 4) }));
}

function splitRecursive(text: string, chunkSize: number, separators: string[]): string[] {
  const [sep, ...rest] = separators;
  if (sep === undefined) return [text];

  const parts = sep === "" ? Array.from(text) : text.split(sep);
  if (parts.length === 1) {
    return rest.length > 0 ? splitRecursive(text, chunkSize, rest) : [text];
  }

  const out: string[] = [];
  for (const part of parts) {
    const piece = sep === "" ? part : part + (separators[0] !== "" ? sep : "");
    if (piece.length <= chunkSize) {
      out.push(piece);
    } else if (rest.length > 0) {
      out.push(...splitRecursive(piece, chunkSize, rest));
    } else {
      // Hard chop to chunkSize as last resort.
      for (let i = 0; i < piece.length; i += chunkSize) {
        out.push(piece.slice(i, i + chunkSize));
      }
    }
  }
  return out.filter((p) => p.trim().length > 0);
}

function mergeWithOverlap(pieces: string[], chunkSize: number, overlap: number): string[] {
  const out: string[] = [];
  let current = "";

  for (const piece of pieces) {
    if ((current + piece).length <= chunkSize) {
      current += piece;
    } else {
      if (current.trim()) out.push(current.trim());
      // Start the next chunk with overlap from the tail of the previous one.
      const tail = current.slice(Math.max(0, current.length - overlap));
      current = tail + piece;
      if (current.length > chunkSize) {
        // The single piece itself is bigger than chunkSize even after recursive split;
        // emit it on its own.
        out.push(current.trim());
        current = "";
      }
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}
