/** Markdown / plain text — keep as-is. The chunker handles the rest. */
export async function extractText(buffer: Buffer): Promise<{ text: string; pageCount?: number }> {
  const text = buffer.toString("utf-8");
  return { text };
}
