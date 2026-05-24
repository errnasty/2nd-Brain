import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
});

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|h[1-6]|li|br|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Minimal ePub text extractor: unzip, read container.xml to find the OPF,
 * read the manifest + spine, concatenate text from each XHTML file in spine order.
 */
export async function extractEpub(buffer: Buffer): Promise<{ text: string; pageCount?: number }> {
  const zip = await JSZip.loadAsync(buffer);

  // 1) Find the OPF path via META-INF/container.xml
  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) throw new Error("Invalid ePub: missing META-INF/container.xml");
  const containerXml = await containerFile.async("string");
  const container = xml.parse(containerXml);
  const opfPath: string | undefined =
    container?.container?.rootfiles?.rootfile?.["@_full-path"];
  if (!opfPath) throw new Error("Invalid ePub: no rootfile path in container.xml");

  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error(`Invalid ePub: missing OPF at ${opfPath}`);
  const opfXml = await opfFile.async("string");
  const opf = xml.parse(opfXml);

  // 2) Build manifest id -> href
  const manifestItems = ([] as any[]).concat(opf?.package?.manifest?.item ?? []);
  const idToHref = new Map<string, string>();
  for (const item of manifestItems) {
    idToHref.set(item["@_id"], item["@_href"]);
  }

  // 3) Read spine order
  const spineItems = ([] as any[]).concat(opf?.package?.spine?.itemref ?? []);
  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

  const chapters: string[] = [];
  for (const item of spineItems) {
    const id = item["@_idref"];
    const href = idToHref.get(id);
    if (!href) continue;
    const file = zip.file(opfDir + href);
    if (!file) continue;
    const html = await file.async("string");
    const text = stripHtml(html);
    if (text) chapters.push(text);
  }

  return {
    text: chapters.join("\n\n"),
    pageCount: chapters.length,
  };
}
