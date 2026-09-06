import { unzipSync, zipSync } from "@office-open/core";
import { describe, expect, it } from "vite-plus/test";

import { generatePresentation } from "./generate";
import { parsePresentationSync } from "./parse";
import type { MasterDefinition, PresentationOptions, SlideOptions } from "./shared/file";

const decodeEntry = (buffer: Uint8Array, path: string): string => {
  const unzipped = unzipSync(buffer);
  const entry = unzipped[path];
  if (!entry) throw new Error(`missing zip entry: ${path}`);
  return new TextDecoder().decode(entry);
};

describe("parsePresentation", () => {
  it("returns PresentationOptions with slides", async () => {
    const options: PresentationOptions = {
      slides: [
        {
          children: [
            {
              shape: {
                x: 100,
                y: 100,
                width: 600,
                height: 400,
                textBody: { text: "Hello" },
                properties: { fill: "4472C4" },
              },
            },
          ],
        },
      ],
    };
    const buffer = await generatePresentation(options);
    const result = parsePresentationSync(buffer);

    expect(result.slides).to.exist;
    expect(result.slides!.length).to.equal(1);
    // Single masters survive round-trip too — the compiler only synthesizes
    // a default master when none is given.
    expect(result.masters).to.have.lengthOf(1);
  });

  it("parses single master file carrying the source master", async () => {
    const options: PresentationOptions = {
      slides: [
        { children: [{ shape: { x: 0, y: 0, width: 200, height: 100, textBody: { text: "A" } } }] },
        { children: [{ shape: { x: 0, y: 0, width: 200, height: 100, textBody: { text: "B" } } }] },
      ],
    };
    const buffer = await generatePresentation(options);
    const result = parsePresentationSync(buffer);

    expect(result.slides!.length).to.equal(2);
    expect(result.masters).to.have.lengthOf(1);
  });

  it("parses core properties and size", async () => {
    const options: PresentationOptions = {
      title: "Test Title",
      creator: "Test Creator",
      slides: [
        { children: [{ shape: { x: 0, y: 0, width: 200, height: 100, textBody: { text: "A" } } }] },
      ],
    };
    const buffer = await generatePresentation(options);
    const result = parsePresentationSync(buffer);

    expect(result.title).to.equal("Test Title");
    expect(result.creator).to.equal("Test Creator");
    expect(result.size).to.equal("16:9");
  });

  it("parses multi-master file", async () => {
    const masters: MasterDefinition[] = [
      {
        name: "light",
        theme: { name: "Light", colorScheme: { dark1: "333333" } },
      },
      {
        name: "dark",
        theme: { name: "Dark", colorScheme: { dark1: "FFFFFF" } },
      },
    ];

    const slides: SlideOptions[] = [
      {
        master: "light",
        layout: "blank",
        children: [
          { shape: { x: 100, y: 100, width: 600, height: 400, textBody: { text: "Light slide" } } },
        ],
      },
      {
        master: "dark",
        layout: "blank",
        children: [
          {
            shape: {
              x: 100,
              y: 100,
              width: 600,
              height: 400,
              textBody: {
                paragraphs: [
                  {
                    properties: { bullet: { type: "none" } },
                    children: [{ text: "Dark slide", fill: "FFFFFF" }],
                  },
                ],
              },
            },
          },
        ],
      },
    ];

    const buffer = await generatePresentation({ title: "Multi-master", masters, slides });
    const result = parsePresentationSync(buffer);

    expect(result.slides!.length).to.equal(2);
    expect(result.masters).to.exist;
    expect(result.masters!.length).to.equal(2);
    // Master name is derived from theme name
    const [slide0, slide1] = result.slides!;
    const [master0, master1] = result.masters!;
    expect(slide0?.master).to.equal("Light");
    expect(slide1?.master).to.equal("Dark");
    expect(master0?.name).to.equal("Light");
    expect(master1?.name).to.equal("Dark");
    expect(master0?.theme?.name).to.equal("Light");
    expect(master1?.theme?.name).to.equal("Dark");
  });

  it("parses table styles (default id always present)", async () => {
    const options: PresentationOptions = {
      slides: [
        { children: [{ shape: { x: 0, y: 0, width: 200, height: 100, textBody: { text: "A" } } }] },
      ],
    };
    const buffer = await generatePresentation(options);
    const result = parsePresentationSync(buffer);

    expect(result.tableStyles).to.exist;
    expect(result.tableStyles!.defaultStyleId).toBe("{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}");
  });

  it("round-trips custom table styles end-to-end", async () => {
    const defaultStyleId = "{CUSTOM-TABLE-STYLE}";
    const options: PresentationOptions = {
      tableStyles: {
        defaultStyleId,
        styles: [
          {
            styleId: defaultStyleId,
            styleName: "Custom Style",
            regions: {
              wholeTbl: { cell: { fillReference: { index: 1, color: { value: "4472C4" } } } },
            },
          },
        ],
      },
      slides: [
        { children: [{ shape: { x: 0, y: 0, width: 200, height: 100, textBody: { text: "A" } } }] },
      ],
    };
    const buffer = await generatePresentation(options);
    const parsed = parsePresentationSync(buffer);

    expect(parsed.tableStyles).to.exist;
    expect(parsed.tableStyles!.defaultStyleId).toBe(defaultStyleId);
    expect(parsed.tableStyles!.styles).toHaveLength(1);
    expect(parsed.tableStyles!.styles?.[0]?.styleId).toBe(defaultStyleId);
    expect(parsed.tableStyles!.styles?.[0]?.styleName).toBe("Custom Style");
  });

  it("round-trips multi-master structure", async () => {
    const masters: MasterDefinition[] = [
      { name: "m1", theme: { name: "Theme One" } },
      { name: "m2", theme: { name: "Theme Two" } },
    ];
    const slides: SlideOptions[] = [
      {
        master: "m1",
        children: [{ shape: { x: 50, y: 50, width: 400, height: 300, textBody: { text: "S1" } } }],
      },
      {
        master: "m2",
        children: [{ shape: { x: 50, y: 50, width: 400, height: 300, textBody: { text: "S2" } } }],
      },
    ];

    const buffer = await generatePresentation({ masters, slides });

    // First parse
    const parsed1 = parsePresentationSync(buffer);
    expect(parsed1.masters!.length).to.equal(2);

    // Re-generate from parsed data
    const buffer2 = await generatePresentation(parsed1);

    // Second parse
    const parsed2 = parsePresentationSync(buffer2);
    expect(parsed2.slides!.length).to.equal(2);
    expect(parsed2.masters!.length).to.equal(2);
    // Master name derived from theme name, not original master name
    const [p2slide0, p2slide1] = parsed2.slides!;
    expect(p2slide0?.master).to.equal("Theme One");
    expect(p2slide1?.master).to.equal("Theme Two");
  });

  it("round-trips slide sections (p14:sectionLst)", async () => {
    const options: PresentationOptions = {
      slides: [
        {
          section: "Intro",
          children: [{ shape: { x: 0, y: 0, width: 200, height: 100, textBody: { text: "A" } } }],
        },
        {
          section: "Intro",
          children: [{ shape: { x: 0, y: 0, width: 200, height: 100, textBody: { text: "B" } } }],
        },
        {
          section: "Content",
          children: [{ shape: { x: 0, y: 0, width: 200, height: 100, textBody: { text: "C" } } }],
        },
        { children: [{ shape: { x: 0, y: 0, width: 200, height: 100, textBody: { text: "D" } } }] },
      ],
    };
    const buffer = await generatePresentation(options);
    const result = parsePresentationSync(buffer);

    // Same-name slides merge into one section; the unsectioned slide stays out
    expect(result.slides!.map((s) => s.section)).to.deep.equal([
      "Intro",
      "Intro",
      "Content",
      undefined,
    ]);
  });

  it("registers internal slide-jump hyperlinks as slide relationships", async () => {
    const options: PresentationOptions = {
      slides: [
        {
          children: [
            {
              shape: {
                x: 100,
                y: 100,
                width: 600,
                height: 400,
                textBody: {
                  paragraphs: [
                    { children: [{ text: "Go", hyperlink: { slide: 3, tooltip: "Jump" } }] },
                  ],
                },
              },
            },
          ],
        },
        {
          children: [{ shape: { x: 0, y: 0, width: 200, height: 100, textBody: { text: "T2" } } }],
        },
        {
          children: [{ shape: { x: 0, y: 0, width: 200, height: 100, textBody: { text: "T3" } } }],
        },
      ],
    };
    const buffer = await generatePresentation(options);

    // Internal slide jump: a:hlinkClick carries the ppaction token, and the
    // slide rels register an internal .../relationships/slide (no TargetMode).
    const slide1Rels = decodeEntry(buffer, "ppt/slides/_rels/slide1.xml.rels");
    expect(slide1Rels).toContain("/relationships/slide");
    expect(slide1Rels).toContain('Target="slide3.xml"');
    expect(slide1Rels).not.toContain("TargetMode");
    const slide1Xml = decodeEntry(buffer, "ppt/slides/slide1.xml");
    expect(slide1Xml).toContain('action="ppaction://hlinksldjump"');
    expect(slide1Xml).toContain('tooltip="Jump"');
  });
});

describe("raw fidelity fallbacks", () => {
  const rezip = async (
    buffer: Uint8Array,
    path: string,
    mutate: (xml: string) => string,
  ): Promise<Uint8Array> => {
    const unzipped = unzipSync(buffer);
    const entry = unzipped[path];
    if (!entry) throw new Error(`missing zip entry: ${path}`);
    unzipped[path] = new TextEncoder().encode(mutate(new TextDecoder().decode(entry)));
    return zipSync(unzipped);
  };

  const minimalOptions: PresentationOptions = {
    slides: [
      { children: [{ shape: { x: 0, y: 0, width: 200, height: 100, textBody: { text: "A" } } }] },
    ],
  };

  it("preserves unrecognized spTree children verbatim", async () => {
    const buffer = await generatePresentation(minimalOptions);
    const unknown =
      '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Fallback/></mc:AlternateContent>';
    const mutated = await rezip(buffer, "ppt/slides/slide1.xml", (xml) =>
      xml.replace("</p:spTree>", `${unknown}</p:spTree>`),
    );
    const parsed = parsePresentationSync(mutated);
    const child = parsed.slides![0]?.children?.find((c) => "rawXml" in c);
    expect(child).to.exist;
    expect((child as { rawXml: string }).rawXml).toContain("mc:AlternateContent");

    // Re-compilation emits the verbatim payload back into the slide.
    const regenerated = await generatePresentation(parsed);
    const slideXml = decodeEntry(regenerated, "ppt/slides/slide1.xml");
    expect(slideXml).toContain("mc:AlternateContent");
  });

  it("preserves slide extLst verbatim", async () => {
    const buffer = await generatePresentation(minimalOptions);
    const ext =
      '<p:extLst><p:ext uri="{TEST-URI}"><test:data xmlns:test="urn:test"/></p:ext></p:extLst>';
    const mutated = await rezip(buffer, "ppt/slides/slide1.xml", (xml) =>
      xml.replace("</p:sld>", `${ext}</p:sld>`),
    );
    const parsed = parsePresentationSync(mutated);
    expect(parsed.slides![0]?.ext).to.contain("{TEST-URI}");

    const regenerated = await generatePresentation(parsed);
    const slideXml = decodeEntry(regenerated, "ppt/slides/slide1.xml");
    expect(slideXml).toContain("{TEST-URI}");
    expect(slideXml.indexOf("<p:extLst>")).toBeLessThan(slideXml.indexOf("</p:sld>"));
  });

  it("preserves spPr extLst verbatim", async () => {
    const buffer = await generatePresentation(minimalOptions);
    const ext =
      '<a:extLst><a:ext uri="{SP-TEST}"><test:x xmlns:test="urn:test"/></a:ext></a:extLst>';
    const mutated = await rezip(buffer, "ppt/slides/slide1.xml", (xml) =>
      xml.replace(/<p:spPr>/, (m) => `${m}${ext}`),
    );
    const parsed = parsePresentationSync(mutated);
    const shape = parsed.slides![0]?.children?.[0] as {
      shape?: { properties?: { ext?: string } };
    };
    expect(shape.shape?.properties?.ext).to.contain("{SP-TEST}");

    const regenerated = await generatePresentation(parsed);
    const slideXml = decodeEntry(regenerated, "ppt/slides/slide1.xml");
    expect(slideXml).toContain("{SP-TEST}");
  });
});
