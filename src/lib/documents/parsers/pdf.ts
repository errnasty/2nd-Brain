// Direct lib import bypasses pdf-parse's test-fixture autoload bug
// that fires on `import "pdf-parse"` and crashes serverless builds.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
  data: Buffer,
) => Promise<{ text: string; numpages: number }>;

export async function extractPdf(buffer: Buffer): Promise<{ text: string; pageCount?: number }> {
  const result = await pdfParse(buffer);
  return {
    text: result.text.replace(/\f/g, "\n\n").trim(),
    pageCount: result.numpages,
  };
}
