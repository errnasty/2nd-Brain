import { describe, expect, it } from "vitest";
import { dirOf, isExternalHref, normalizeZipPath, resolveHref, splitFragment } from "./paths";

describe("dirOf", () => {
  it("keeps the trailing slash and returns empty at the root", () => {
    expect(dirOf("OEBPS/text/ch1.xhtml")).toBe("OEBPS/text/");
    expect(dirOf("content.opf")).toBe("");
  });
});

describe("splitFragment", () => {
  it("splits on the first hash", () => {
    expect(splitFragment("ch1.xhtml#note-3")).toEqual({ path: "ch1.xhtml", fragment: "note-3" });
    expect(splitFragment("ch1.xhtml")).toEqual({ path: "ch1.xhtml", fragment: null });
  });

  it("treats an empty fragment as none", () => {
    expect(splitFragment("ch1.xhtml#")).toEqual({ path: "ch1.xhtml", fragment: null });
  });

  it("handles a bare fragment", () => {
    expect(splitFragment("#top")).toEqual({ path: "", fragment: "top" });
  });
});

describe("isExternalHref", () => {
  it("recognises schemes and protocol-relative urls", () => {
    expect(isExternalHref("https://example.com")).toBe(true);
    expect(isExternalHref("mailto:a@b.c")).toBe(true);
    expect(isExternalHref("//cdn.example.com/x.png")).toBe(true);
  });

  it("does not mistake a relative path for one", () => {
    expect(isExternalHref("../images/a.png")).toBe(false);
    expect(isExternalHref("ch1.xhtml")).toBe(false);
  });
});

describe("normalizeZipPath", () => {
  it("collapses . and .. segments", () => {
    expect(normalizeZipPath("OEBPS/text/../images/a.png")).toBe("OEBPS/images/a.png");
    expect(normalizeZipPath("OEBPS/./a.png")).toBe("OEBPS/a.png");
    expect(normalizeZipPath("a//b")).toBe("a/b");
  });

  it("refuses to climb above the zip root", () => {
    expect(normalizeZipPath("../../etc/passwd")).toBeNull();
    expect(normalizeZipPath("OEBPS/../../secret")).toBeNull();
  });

  it("returns null for an empty path", () => {
    expect(normalizeZipPath("")).toBeNull();
    expect(normalizeZipPath("/")).toBeNull();
  });
});

describe("resolveHref", () => {
  const base = "OEBPS/text/ch1.xhtml";

  it("resolves relative to the containing file", () => {
    expect(resolveHref(base, "ch2.xhtml")).toBe("OEBPS/text/ch2.xhtml");
    expect(resolveHref(base, "../images/a.png")).toBe("OEBPS/images/a.png");
  });

  it("treats a leading slash as the zip root, not the filesystem root", () => {
    expect(resolveHref(base, "/OEBPS/images/a.png")).toBe("OEBPS/images/a.png");
  });

  it("drops the fragment", () => {
    expect(resolveHref(base, "ch2.xhtml#note-3")).toBe("OEBPS/text/ch2.xhtml");
  });

  it("decodes percent-encoded names", () => {
    expect(resolveHref(base, "Chapter%201.xhtml")).toBe("OEBPS/text/Chapter 1.xhtml");
  });

  it("survives malformed percent-encoding", () => {
    expect(resolveHref(base, "100%.xhtml")).toBe("OEBPS/text/100%.xhtml");
  });

  it("returns null for external, bare-fragment and escaping hrefs", () => {
    expect(resolveHref(base, "https://example.com/x")).toBeNull();
    expect(resolveHref(base, "#note-3")).toBeNull();
    expect(resolveHref(base, "")).toBeNull();
    expect(resolveHref(base, "../../../../etc/passwd")).toBeNull();
  });

  it("resolves from an OPF sitting at the zip root", () => {
    expect(resolveHref("content.opf", "text/ch1.xhtml")).toBe("text/ch1.xhtml");
  });
});
