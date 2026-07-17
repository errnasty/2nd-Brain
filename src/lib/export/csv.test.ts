import { describe, expect, it } from "vitest";
import { csvField, csvRow, toCsv } from "./csv";

describe("csvField", () => {
  it("passes plain text through unchanged", () => {
    expect(csvField("hello")).toBe("hello");
  });

  it("quotes a field containing a comma", () => {
    expect(csvField("a,b")).toBe('"a,b"');
  });

  it("quotes and doubles embedded quotes", () => {
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes a field containing a newline", () => {
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("csvRow / toCsv", () => {
  it("joins fields with commas", () => {
    expect(csvRow(["a", "b", "c"])).toBe("a,b,c");
  });

  it("joins rows with CRLF", () => {
    expect(toCsv([["a", "b"], ["c", "d"]])).toBe("a,b\r\nc,d");
  });

  it("round-trips a field with a comma inside a full row", () => {
    expect(csvRow(["What is 1,000?", "One thousand"])).toBe('"What is 1,000?",One thousand');
  });
});
