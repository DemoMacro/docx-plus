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

const AUTHOR = "Author";
const DATE = "2026-05-02T10:00:00Z";

describe("{ moveFrom } / { moveTo } child — library allocates range + run ids", () => {
  it("emits a paired moveFrom range + moved run with shared author/date/name", async () => {
    const output = await generateDocument(
      {
        sections: [
          {
            children: [
              {
                paragraph: {
                  children: [
                    {
                      moveFrom: {
                        name: "move1",
                        author: AUTHOR,
                        date: DATE,
                        wrap: [{ text: "moved away" }],
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
    // Range start carries name/author/date; the moved run carries the wrapped content.
    expect(xml).toContain(
      `<w:moveFromRangeStart w:id="0" w:name="move1" w:author="${AUTHOR}" w:date="${DATE}"/>`,
    );
    expect(xml).toContain(`<w:moveFrom w:id="0" w:author="${AUTHOR}" w:date="${DATE}">`);
    expect(xml).toContain('<w:moveFromRangeEnd w:id="0"/>');
    // Wrapped content sits inside the move run, between the range markers.
    const start = xml.indexOf("<w:moveFromRangeStart");
    const moved = xml.indexOf("moved away");
    const end = xml.indexOf('<w:moveFromRangeEnd w:id="0"/>');
    expect(start).toBeLessThan(moved);
    expect(moved).toBeLessThan(end);
  });

  it("emits the moveTo (destination) form the same way", async () => {
    const output = await generateDocument(
      {
        sections: [
          {
            children: [
              {
                paragraph: {
                  children: [
                    {
                      moveTo: {
                        name: "move2",
                        author: AUTHOR,
                        date: DATE,
                        wrap: ["arrived here"],
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
    expect(xml).toContain(
      `<w:moveToRangeStart w:id="0" w:name="move2" w:author="${AUTHOR}" w:date="${DATE}"/>`,
    );
    expect(xml).toContain(`<w:moveTo w:id="0" w:author="${AUTHOR}" w:date="${DATE}">`);
    expect(xml).toContain('<w:moveToRangeEnd w:id="0"/>');
    expect(xml).toContain("arrived here");
  });

  it("allocates distinct range and run ids for a full move sharing one name", async () => {
    const output = await generateDocument(
      {
        sections: [
          {
            children: [
              {
                paragraph: {
                  children: [
                    {
                      moveFrom: {
                        name: "full-move",
                        author: AUTHOR,
                        date: DATE,
                        wrap: ["payload"],
                      },
                    },
                  ],
                },
              },
              {
                paragraph: {
                  children: [
                    {
                      moveTo: { name: "full-move", author: AUTHOR, date: DATE, wrap: ["payload"] },
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
    // moveFrom: range 0 / run 0; moveTo: range 1 / run 1 — all distinct.
    expect(xml).toContain('<w:moveFromRangeStart w:id="0"');
    expect(xml).toContain('<w:moveFrom w:id="0"');
    expect(xml).toContain('<w:moveToRangeStart w:id="1"');
    expect(xml).toContain('<w:moveTo w:id="1"');
  });

  it("continues run ids above an explicit movedFrom, range ids stay independent", async () => {
    const output = await generateDocument(
      {
        sections: [
          {
            children: [
              {
                paragraph: {
                  children: [
                    {
                      movedFrom: {
                        id: 3,
                        author: AUTHOR,
                        date: DATE,
                        children: ["explicit run"],
                      },
                    },
                    {
                      moveFrom: {
                        name: "sugared",
                        author: AUTHOR,
                        date: DATE,
                        wrap: ["sugared run"],
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
    // Explicit run id 3 seeds the run counter → sugar run continues at 4.
    expect(xml).toContain('<w:moveFrom w:id="4"');
    // No explicit range marker → sugar range starts at 0.
    expect(xml).toContain('<w:moveFromRangeStart w:id="0"');
  });

  it("round-trips: a sugar-generated document parses back into move markers", async () => {
    const output = await generateDocument(
      {
        sections: [
          {
            children: [
              {
                paragraph: {
                  children: [
                    {
                      moveFrom: { name: "rt-move", author: AUTHOR, date: DATE, wrap: ["payload"] },
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
    const first = parsed.sections?.[0]?.children?.[0];
    expect(first && "paragraph" in first).toBe(true);
    const kids = (first as { paragraph: { children?: unknown[] } }).paragraph.children ?? [];
    expect(kids.some((k) => typeof k === "object" && k !== null && "moveFromRangeStart" in k)).toBe(
      true,
    );
  });
});
