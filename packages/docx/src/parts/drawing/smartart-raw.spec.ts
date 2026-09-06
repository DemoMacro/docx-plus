import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { generateDocument } from "../../generate";
import { parseDocumentSync } from "../../parse";

const RAW_DATA = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram">',
  '<dgm:ptLst><dgm:pt modelId="raw0" type="doc"/></dgm:ptLst>',
  "</dgm:dataModel>",
].join("");

const RAW_LAYOUT = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<dgm:layoutDef xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" uniqueId="urn:microsoft.com/office/officeart/2005/8/layout/raw">',
  "<dgm:layoutNode/>",
  "</dgm:layoutDef>",
].join("");

const RAW_MEDIA = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const RAW_RELS = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>',
  "</Relationships>",
].join("");

/** Unzip a generated package and decode one part as UTF-8 text. */
function decodePart(output: Uint8Array, path: string): string {
  const entry = unzipSync(output)[path];
  expect(entry, `${path} should be zipped`).toBeDefined();
  return new TextDecoder().decode(entry);
}

function docWithRawSmartArt() {
  return {
    sections: [
      {
        children: [
          {
            paragraph: {
              children: [
                {
                  smartArt: {
                    nodes: [{ text: "Item" }],
                    transformation: { width: 100, height: 100 },
                    raw: {
                      data: RAW_DATA,
                      layout: RAW_LAYOUT,
                      media: [{ fileName: "image1.png", data: RAW_MEDIA }],
                      dataRels: RAW_RELS,
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe("SmartArt raw round-trip", () => {
  it("emits the raw part bytes verbatim under the diagrams part names", async () => {
    const out = await generateDocument(docWithRawSmartArt(), { type: "uint8array" });

    expect(decodePart(out, "word/diagrams/data1.xml")).toBe(RAW_DATA);
    expect(decodePart(out, "word/diagrams/layout1.xml")).toBe(RAW_LAYOUT);
    expect(decodePart(out, "word/diagrams/_rels/data1.xml.rels")).toBe(RAW_RELS);
    const media = unzipSync(out)["word/media/image1.png"];
    expect(media, "media should be zipped").toBeDefined();
    expect(Array.from(media!)).toEqual(Array.from(RAW_MEDIA));
  });

  it("parses the raw parts back alongside the structured fold", async () => {
    const out = await generateDocument(docWithRawSmartArt(), { type: "uint8array" });
    const opts = parseDocumentSync(out);

    const para = opts.sections?.[0]?.children?.[0] as unknown as {
      paragraph: { children: { smartArt: Record<string, unknown> }[] };
    };
    const smartArt = para.paragraph.children[0]!.smartArt;
    const raw = smartArt.raw as {
      data: Uint8Array;
      layout: Uint8Array;
      dataRels: Uint8Array;
      media: { fileName: string; data: Uint8Array }[];
    };

    expect(new TextDecoder().decode(raw.data)).toBe(RAW_DATA);
    expect(new TextDecoder().decode(raw.layout)).toBe(RAW_LAYOUT);
    expect(new TextDecoder().decode(raw.dataRels)).toBe(RAW_RELS);
    expect(raw.media.map((m) => m.fileName)).toEqual(["image1.png"]);
    // The structured fold stays populated for readability.
    expect(Array.isArray(smartArt.nodes)).toBe(true);
  });

  it("re-emits byte-identical parts on a second round-trip", async () => {
    const first = await generateDocument(docWithRawSmartArt(), { type: "uint8array" });
    const second = await generateDocument(parseDocumentSync(first), { type: "uint8array" });

    expect(decodePart(second, "word/diagrams/data1.xml")).toBe(RAW_DATA);
    const mediaA = unzipSync(first)["word/media/image1.png"];
    const mediaB = unzipSync(second)["word/media/image1.png"];
    expect(Array.from(mediaB!)).toEqual(Array.from(mediaA!));
  });
});
