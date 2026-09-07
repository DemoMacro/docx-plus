import { describe, expect, it } from "vite-plus/test";

import { compileDocument } from "./compiler";
import { generateDocument } from "./generate";

describe("generateDocument entry guards", () => {
  it("names the missing sections array instead of dying in the compiler", () => {
    expect(() => generateDocument({} as never)).toThrow(/sections is required/);
  });
});

describe("chart embedding rels", () => {
  it("emits the c:externalData rel with a quoted package relationship type", () => {
    const files = compileDocument({
      sections: [
        {
          children: [
            {
              paragraph: {
                children: [
                  {
                    chart: {
                      type: "column",
                      series: [{ values: [1, 2, 3] }],
                      transformation: { width: 5486400, height: 3200400 },
                      externalData: {
                        relationshipId: "rId1",
                        fileName: "Chart.xlsx",
                        data: new Uint8Array([1, 2, 3]),
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const rels = files["word/charts/_rels/chart1.xml.rels"];
    expect(rels).toBeDefined();
    const xml = new TextDecoder().decode(rels as Uint8Array);
    expect(xml).toContain(
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package"',
    );
    expect(xml).toContain('Target="../embeddings/Chart.xlsx"');
  });
});

describe("picture media dedup", () => {
  it("keeps per-reference extent for byte-identical images", () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const emu = (px: number) => px * 9525;
    const files = compileDocument({
      sections: [
        {
          children: [
            {
              paragraph: {
                children: [
                  {
                    picture: {
                      type: "png",
                      data: bytes,
                      transformation: { width: emu(166), height: emu(150) },
                    },
                  },
                  {
                    picture: {
                      type: "png",
                      data: bytes,
                      transformation: { width: emu(140), height: emu(93) },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const xml = new TextDecoder().decode(files["word/document.xml"] as Uint8Array);
    const extents = [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)].map(
      (m) => `${m[1]}x${m[2]}`,
    );
    expect(extents).toEqual([`${emu(166)}x${emu(150)}`, `${emu(140)}x${emu(93)}`]);
  });
});
