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

  it("keeps per-reference svg fallback for byte-identical svg data", () => {
    const svgBytes = new Uint8Array([60, 115, 118, 103, 62]);
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
                      type: "svg",
                      data: svgBytes,
                      fallback: {
                        type: "png",
                        data: new Uint8Array([10, 11, 12]),
                        fileName: "small.png",
                      },
                      transformation: { width: emu(50), height: emu(50) },
                    },
                  },
                  {
                    picture: {
                      type: "svg",
                      data: svgBytes,
                      fallback: {
                        type: "png",
                        data: new Uint8Array([20, 21, 22, 23]),
                        fileName: "large.png",
                      },
                      transformation: { width: emu(80), height: emu(80) },
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
    const relsXml = new TextDecoder().decode(files["word/_rels/document.xml.rels"] as Uint8Array);
    const targetOf = new Map(
      [...relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1]!, m[2]!]),
    );
    const fallbackTargets = [...xml.matchAll(/<a:blip r:embed="([^"]+)"/g)].map(
      (m) => targetOf.get(m[1]!) ?? "",
    );
    // Each svg reference resolves its OWN raster fallback — the second
    // reference must not inherit the first registrant's entry.
    expect(fallbackTargets.some((t) => t.endsWith("small.png"))).toBe(true);
    expect(fallbackTargets.some((t) => t.endsWith("large.png"))).toBe(true);
  });

  it("keeps background rawXml pristine across generate runs", () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const options = {
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
                      transformation: { width: 9525, height: 9525 },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
      background: {
        rawXml:
          '<w:background><v:background><v:fill r:id="{bg.png}"/></v:background></w:background>',
        rawMedia: [{ fileName: "bg.png", type: "png", data: bytes }],
      },
    } as Parameters<typeof compileDocument>[0];
    compileDocument(options);
    // The first run dedups bg.png against the body picture — the rename must
    // stay inside that run, never land on the caller's options object.
    expect(options.background?.rawXml).toContain("{bg.png}");
    expect(options.background?.rawXml).not.toContain("image");
    const second = compileDocument(options);
    const xml = new TextDecoder().decode(second["word/document.xml"] as Uint8Array);
    expect(xml).not.toMatch(/\{[a-zA-Z0-9_.]+\}/);
  });

  it("re-registers group chart children on a reused options object", () => {
    const mediaTransformation = {
      emus: { x: 952500, y: 952500 },
      pixels: { x: 100, y: 100 },
      offset: { emus: { x: 0, y: 0 }, pixels: { x: 0, y: 0 } },
    };
    const options = {
      sections: [
        {
          children: [
            {
              paragraph: {
                children: [
                  {
                    wpgGroup: {
                      children: [
                        {
                          type: "chart",
                          transformation: mediaTransformation,
                          chartOptions: { type: "column", series: [{ values: [1, 2, 3] }] },
                        },
                      ],
                      transformation: { width: 1905000, height: 1905000 },
                      childExtentWidth: 952500,
                      childExtentHeight: 952500,
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    } as Parameters<typeof compileDocument>[0];
    compileDocument(options);
    const second = compileDocument(options);
    const xml = new TextDecoder().decode(second["word/document.xml"] as Uint8Array);
    // A persisted chart key from the first run must not skip the second run's
    // chart registration — the placeholder has to resolve to a real part.
    expect(xml).not.toMatch(/\{chart:/);
    expect(Object.keys(second).some((f) => f.startsWith("word/charts/"))).toBe(true);
  });
});
