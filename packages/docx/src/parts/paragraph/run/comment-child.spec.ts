import { unzipSync } from "fflate";
import { describe, expect, it } from "vite-plus/test";

import { generateDocument } from "../../../generate";
import { parseDocumentSync } from "../../../parse";

/** Unzip a generated package and decode one part as UTF-8 text. */
function decodePart(output: Uint8Array, path: string): string {
  const unzipped = unzipSync(output);
  const entry = unzipped[path];
  expect(entry, `${path} should be zipped`).toBeDefined();
  return new TextDecoder().decode(entry);
}

describe("{ comment } child — library allocates id, pairs markers, registers entry", () => {
  it("emits paired range markers + reference with one id, and a comments part", async () => {
    const output = await generateDocument(
      {
        sections: [
          {
            children: [
              {
                paragraph: {
                  children: [
                    {
                      comment: {
                        author: "Steve",
                        initials: "SC",
                        children: ["I have this to say"],
                        wrap: [{ text: "Anchored text" }],
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      { type: "uint8array" },
    );

    const xml = decodePart(output, "word/document.xml");
    // All three markers share the auto-allocated id 0.
    expect(xml).toContain('<w:commentRangeStart w:id="0"/>');
    expect(xml).toContain('<w:commentRangeEnd w:id="0"/>');
    expect(xml).toContain('<w:commentReference w:id="0"/>');
    // Wrapped content sits between the range markers.
    const start = xml.indexOf('<w:commentRangeStart w:id="0"/>');
    const anchored = xml.indexOf("Anchored text");
    const end = xml.indexOf('<w:commentRangeEnd w:id="0"/>');
    expect(start).toBeLessThan(anchored);
    expect(anchored).toBeLessThan(end);

    // The comment reply + author land in word/comments.xml.
    const commentsXml = decodePart(output, "word/comments.xml");
    expect(commentsXml).toContain('w:author="Steve"');
    expect(commentsXml).toContain("I have this to say");

    // OPC consistency: the part has a relationship + a content-type Override.
    expect(decodePart(output, "word/_rels/document.xml.rels")).toContain("comments.xml");
    expect(decodePart(output, "[Content_Types].xml")).toContain("/word/comments.xml");
  });

  it("allocates incrementing ids across multiple sugars", async () => {
    const output = await generateDocument(
      {
        sections: [
          {
            children: [
              {
                paragraph: {
                  children: [
                    {
                      comment: {
                        author: "A",
                        children: ["first"],
                        wrap: ["one"],
                      },
                    },
                    {
                      comment: {
                        author: "B",
                        children: ["second"],
                        wrap: ["two"],
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      { type: "uint8array" },
    );

    const xml = decodePart(output, "word/document.xml");
    expect(xml).toContain('<w:commentRangeStart w:id="0"/>');
    expect(xml).toContain('<w:commentRangeStart w:id="1"/>');

    const commentsXml = decodePart(output, "word/comments.xml");
    expect(commentsXml).toContain('w:author="A"');
    expect(commentsXml).toContain('w:author="B"');
  });

  it("continues ids above explicit comments and merges both into comments.xml", async () => {
    const output = await generateDocument(
      {
        comments: [{ id: 5, author: "Explicit", date: "2024-01-01T00:00:00Z", children: [] }],
        sections: [
          {
            children: [
              {
                paragraph: {
                  children: [
                    {
                      comment: {
                        author: "Sugared",
                        children: ["from sugar"],
                        wrap: ["anchored"],
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      { type: "uint8array" },
    );

    // Sugar id continues at 6 (after the explicit max 5) — no collision.
    const xml = decodePart(output, "word/document.xml");
    expect(xml).toContain('<w:commentRangeStart w:id="6"/>');

    // Both the explicit entry and the sugar entry are present.
    const commentsXml = decodePart(output, "word/comments.xml");
    expect(commentsXml).toContain('w:author="Explicit"');
    expect(commentsXml).toContain('w:author="Sugared"');

    // Single content-type Override (no duplicate from merging).
    const types = decodePart(output, "[Content_Types].xml");
    expect((types.match(/\/word\/comments\.xml/g) ?? []).length).toBe(1);
  });

  it("round-trips: a sugar-generated document parses back into comments", async () => {
    const output = await generateDocument(
      {
        sections: [
          {
            children: [
              {
                paragraph: {
                  children: [
                    {
                      comment: {
                        author: "Roundtrip",
                        children: ["note body"],
                        wrap: ["target text"],
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      { type: "uint8array" },
    );

    const parsed = parseDocumentSync(output);
    expect(parsed.comments).toHaveLength(1);
    expect(parsed.comments?.[0]?.author).toBe("Roundtrip");
    expect(parsed.comments?.[0]?.id).toBe(0);
  });
});
