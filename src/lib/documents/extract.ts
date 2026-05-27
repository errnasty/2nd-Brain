import type { docKindEnum } from "@/lib/db/schema";
import { extractText } from "./parsers/text";
import { extractPdf } from "./parsers/pdf";
import { extractEpub } from "./parsers/epub";
import { extractOffice } from "./parsers/office";

export type DocKind = (typeof docKindEnum.enumValues)[number];

export type Extracted = {
  text: string;
  pageCount?: number;
};

export function detectKind(filename: string, mimeType?: string): DocKind | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf") || mimeType === "application/pdf") return "pdf";
  if (
    lower.endsWith(".docx") ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return "docx";
  if (
    lower.endsWith(".pptx") ||
    mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  )
    return "pptx";
  if (lower.endsWith(".epub") || mimeType === "application/epub+zip") return "epub";
  if (lower.endsWith(".md") || lower.endsWith(".markdown") || mimeType === "text/markdown")
    return "markdown";
  if (lower.endsWith(".txt") || mimeType?.startsWith("text/")) return "text";
  return null;
}

export async function extractByKind(kind: DocKind, buffer: Buffer): Promise<Extracted> {
  switch (kind) {
    case "pdf":
      return extractPdf(buffer);
    case "epub":
      return extractEpub(buffer);
    case "docx":
    case "pptx":
      return extractOffice(buffer, kind);
    case "markdown":
    case "text":
      return extractText(buffer);
  }
}
