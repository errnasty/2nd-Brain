import { parseOffice } from "officeparser";
import type { Extracted } from "../extract";

/**
 * Extract plain text from .docx or .pptx via officeparser.
 *
 * officeparser walks the embedded XML parts (paragraphs for Word, slides +
 * speaker notes for PowerPoint) and returns a structured AST. We flatten it
 * to plain text via the synchronous `toText()` convenience.
 */
export async function extractOffice(buffer: Buffer, _kind: "docx" | "pptx"): Promise<Extracted> {
  const ast = await parseOffice(buffer);
  const text = ast.toText().trim();
  return { text };
}
