import type { ReadContext } from "@office-open/core/descriptor";
import { parse as parseXml } from "@office-open/xml";
import { describe, expect, it } from "vite-plus/test";

import type { BodyContext } from "../context";
import { commentsDesc } from "./comments";
import type { CommentOptions } from "./paragraph/run/comment-run";

const writeCtx = {
  addRelationship: () => "rId1",
  addMedia: () => "",
  stringifyChild: (child: unknown) => String(child),
  fileData: {} as never,
} as unknown as BodyContext;

const readCtx = {
  resolveRelationship: () => undefined,
  getPart: () => undefined,
  getRaw: () => undefined,
} as unknown as ReadContext;

function roundTrip(opts: CommentOptions[]): CommentOptions[] {
  const xml = commentsDesc.stringify(opts, writeCtx)!;
  const doc = parseXml(xml);
  const el = doc.elements?.[0];
  if (!el) throw new Error("parsed document has no root element");
  return commentsDesc.parse(el, readCtx);
}

describe("commentsDesc round-trip", () => {
  it("round-trips comment with author and date", () => {
    const result = roundTrip([
      { id: 1, author: "John", date: "2024-01-15T10:30:00Z", children: [] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(1);
    expect(result[0]?.author).toBe("John");
    expect(result[0]?.date).toBe("2024-01-15T10:30:00Z");
  });

  it("round-trips comment with initials", () => {
    const result = roundTrip([
      { id: 2, author: "Jane", initials: "JD", date: "2024-02-01T12:00:00Z", children: [] },
    ]);
    expect(result[0]?.initials).toBe("JD");
  });

  it("round-trips multiple comments", () => {
    const result = roundTrip([
      { id: 1, author: "A", date: "2024-01-01T00:00:00Z", children: [] },
      { id: 2, author: "B", date: "2024-02-01T00:00:00Z", children: [] },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]?.author).toBe("A");
    expect(result[1]?.author).toBe("B");
  });

  it("round-trips empty comments", () => {
    const result = roundTrip([]);
    expect(result).toHaveLength(0);
  });

  it("round-trips a table inside a comment", () => {
    const xml =
      `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:comment w:id="1" w:author="A" w:date="2024-01-01T00:00:00Z">` +
      `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
      `<w:p><w:r><w:t>after</w:t></w:r></w:p>` +
      `</w:comment></w:comments>`;
    const doc = parseXml(xml);
    const result = commentsDesc.parse(doc.elements![0]!, readCtx);
    const table = result[0]?.children.find(
      (c) => c !== null && typeof c === "object" && "table" in c,
    ) as { table: { rows: unknown[] } } | undefined;
    expect(table).toBeDefined();
    expect(table!.table.rows).toHaveLength(1);
    // stringify re-emits the table between the paragraphs
    const out = commentsDesc.stringify(result, writeCtx)!;
    expect(out).toContain("<w:tbl>");
    expect(out).toContain("after");
  });

  it("round-trips paragraph paraId inside a comment (w15:commentEx reply link)", () => {
    // Word threads replies through w14:paraId on the comment's first w:p —
    // dropping it orphans the w15:commentEx entry and flattens the thread.
    const result = roundTrip([
      {
        id: 1,
        author: "A",
        date: "2024-01-01T00:00:00Z",
        children: [{ children: ["hello"], paraId: "1A2B3C4D" }],
      },
    ]);
    const first = result[0]?.children[0] as { paraId?: string };
    expect(first?.paraId).toBe("1A2B3C4D");
  });

  it("round-trips comment-level bookmark markers outside paragraphs", () => {
    // Word anchors _GoBack's end marker directly under w:comment, outside any
    // paragraph — kept as a comment child so presence round-trips.
    const xml =
      `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:comment w:id="1" w:author="A" w:date="2024-01-01T00:00:00Z">` +
      `<w:p><w:bookmarkStart w:id="2" w:name="_GoBack"/><w:r><w:t>x</w:t></w:r></w:p>` +
      `<w:bookmarkEnd w:id="2"/>` +
      `</w:comment></w:comments>`;
    const doc = parseXml(xml);
    const result = commentsDesc.parse(doc.elements![0]!, readCtx);
    const children = result[0]?.children ?? [];
    expect(
      children.some(
        (c) =>
          typeof c === "object" &&
          c !== null &&
          "bookmarkEnd" in c &&
          (c as { bookmarkEnd: { id: number } }).bookmarkEnd.id === 2,
      ),
    ).toBe(true);
    const out = commentsDesc.stringify(result, writeCtx)!;
    expect(out).toContain('<w:bookmarkEnd w:id="2"/>');
  });
});
