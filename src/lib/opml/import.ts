import { XMLParser } from "fast-xml-parser";

export type OpmlFeed = { title: string; url: string; siteUrl?: string };
export type OpmlFolder = { name: string; feeds: OpmlFeed[] };
export type OpmlImport = {
  rootFeeds: OpmlFeed[];
  folders: OpmlFolder[];
};

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
});

function asArray<T>(v: T | T[] | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function readFeed(node: any): OpmlFeed | null {
  const url = node["@_xmlUrl"];
  if (!url) return null;
  const title = node["@_title"] || node["@_text"] || url;
  const siteUrl = node["@_htmlUrl"] || undefined;
  return { title, url, siteUrl };
}

/**
 * Parses an OPML 2.0 document (the format Inoreader, Feedly, NetNewsWire, etc. all export).
 *
 * Inoreader exports look like:
 *   <body>
 *     <outline text="Tech" title="Tech">
 *       <outline type="rss" text="Hacker News" xmlUrl="..." htmlUrl="..." />
 *     </outline>
 *     <outline type="rss" text="Untagged feed" xmlUrl="..." />
 *   </body>
 *
 * We flatten one level of nesting (top-level outline without xmlUrl = folder).
 */
export function parseOpml(content: string): OpmlImport {
  const doc = xml.parse(content);
  const bodyOutlines = asArray(doc?.opml?.body?.outline);

  const rootFeeds: OpmlFeed[] = [];
  const folders: OpmlFolder[] = [];

  for (const node of bodyOutlines) {
    if (node["@_xmlUrl"]) {
      const feed = readFeed(node);
      if (feed) rootFeeds.push(feed);
    } else {
      const name = (node["@_title"] || node["@_text"] || "Imported").trim();
      const children = asArray(node.outline);
      const feeds: OpmlFeed[] = [];
      for (const child of children) {
        const feed = readFeed(child);
        if (feed) feeds.push(feed);
      }
      if (feeds.length > 0) folders.push({ name, feeds });
    }
  }

  return { rootFeeds, folders };
}
