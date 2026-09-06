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

describe("{ bookmark } child — library allocates id and pairs start/end", () => {
  it("emits paired bookmarkStart/bookmarkEnd with one id and the name", async () => {
    const output = await generateDocument(
      {
        sections: [
          {
            children: [
              {
                paragraph: {
                  children: [
                    {
                      bookmark: {
                        name: "myAnchor",
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
    // Both markers share the auto-allocated id 0; the name lands on the start.
    expect(xml).toContain('<w:bookmarkStart w:id="0" w:name="myAnchor"/>');
    expect(xml).toContain('<w:bookmarkEnd w:id="0"/>');
    // Wrapped content sits between the markers.
    const start = xml.indexOf('<w:bookmarkStart w:id="0"');
    const anchored = xml.indexOf("Anchored text");
    const end = xml.indexOf('<w:bookmarkEnd w:id="0"/>');
    expect(start).toBeLessThan(anchored);
    expect(anchored).toBeLessThan(end);
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
                    { bookmark: { name: "first", wrap: ["one"] } },
                    { bookmark: { name: "second", wrap: ["two"] } },
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
    expect(xml).toContain('<w:bookmarkStart w:id="0" w:name="first"/>');
    expect(xml).toContain('<w:bookmarkStart w:id="1" w:name="second"/>');
  });

  it("continues ids above an explicit bookmarkStart — no collision", async () => {
    const output = await generateDocument(
      {
        sections: [
          {
            children: [
              {
                paragraph: {
                  children: [
                    { bookmarkStart: { id: 5, name: "explicit" } },
                    { bookmarkEnd: { id: 5 } },
                    { bookmark: { name: "sugared", wrap: ["anchored"] } },
                  ],
                },
              },
            ],
          },
        ],
      },
      { type: "uint8array" },
    );

    // Sugar id continues at 6 (after the explicit max 5).
    const xml = decodePart(output, "word/document.xml");
    expect(xml).toContain('<w:bookmarkStart w:id="6" w:name="sugared"/>');
  });

  it("round-trips: a sugar-generated document parses back into bookmark markers", async () => {
    const output = await generateDocument(
      {
        sections: [
          {
            children: [
              {
                paragraph: {
                  children: [{ bookmark: { name: "rt", wrap: ["target"] } }],
                },
              },
            ],
          },
        ],
      },
      { type: "uint8array" },
    );

    const parsed = parseDocumentSync(output);
    const first = parsed.sections?.[0]?.children?.[0];
    expect(first && "paragraph" in first).toBe(true);
    const kids = (first as { paragraph: { children?: unknown[] } }).paragraph.children ?? [];
    expect(kids.some((k) => typeof k === "object" && k !== null && "bookmarkStart" in k)).toBe(
      true,
    );
    expect(kids.some((k) => typeof k === "object" && k !== null && "bookmarkEnd" in k)).toBe(true);
  });
});
