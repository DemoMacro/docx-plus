import { parse as parseXml } from "@office-open/xml";
import { AlignmentType } from "@parts/paragraph";
import { describe, expect, it } from "vite-plus/test";

import { parseParagraphProperties } from "../../body";
import type { DocxReadContext } from "../../context";
import { generateDocumentSync } from "../../generate";
import { parseDocumentSync } from "../../parse";
import { DefaultStylesFactory, stringifyDocDefaults } from "./factory";
import { parseStyleDefinitions, Styles } from "./styles";

// Style pPr and docDefaults pPr carry no numPr, so an empty read context
// suffices for parseParagraphProperties.
const ctx = {} as unknown as DocxReadContext;

describe("parseStyleDefinitions (round-trip)", () => {
  it("reads back custom paragraph style fields", () => {
    const styles = new Styles({
      paragraphStyles: [
        {
          id: "MyPara",
          name: "My Para",
          basedOn: "Normal",
          next: "Normal",
          link: "MyParaChar",
          quickFormat: true,
          semiHidden: true,
          unhideWhenUsed: true,
          uiPriority: 10,
          paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 120 } },
          run: { bold: true },
        },
      ],
    });

    const xml = styles.serialize();
    const el = parseXml(xml).elements?.[0];
    if (!el) throw new Error("parsed document has no root element");
    const opts = parseStyleDefinitions(el, parseParagraphProperties, ctx);

    const para = opts?.paragraphStyles?.[0];
    expect(para).toBeDefined();
    expect(para!.id).toBe("MyPara");
    expect(para!.name).toBe("My Para");
    expect(para!.basedOn).toBe("Normal");
    expect(para!.next).toBe("Normal");
    expect(para!.link).toBe("MyParaChar");
    expect(para!.quickFormat).toBe(true);
    expect(para!.semiHidden).toBe(true);
    expect(para!.unhideWhenUsed).toBe(true);
    expect(para!.uiPriority).toBe(10);
    expect(para!.paragraph?.alignment).toBe(AlignmentType.CENTER);
    expect(para!.paragraph?.spacing?.after).toBe(120);
    expect(para!.run?.bold).toBe(true);
  });

  it("reads back custom character style", () => {
    const styles = new Styles({
      characterStyles: [
        {
          id: "MyChar",
          name: "My Char",
          basedOn: "DefaultParagraphFont",
          link: "MyPara",
          run: { bold: true },
        },
      ],
    });

    const xml = styles.serialize();
    const el = parseXml(xml).elements?.[0];
    if (!el) throw new Error("parsed document has no root element");
    const opts = parseStyleDefinitions(el, parseParagraphProperties, ctx);

    const char = opts?.characterStyles?.[0];
    expect(char).toBeDefined();
    expect(char!.id).toBe("MyChar");
    expect(char!.name).toBe("My Char");
    expect(char!.basedOn).toBe("DefaultParagraphFont");
    expect(char!.link).toBe("MyPara");
    expect(char!.run?.bold).toBe(true);
  });

  it("reads back custom table style with conditional formats (fully structured)", () => {
    const styles = new Styles({
      tableStyles: [
        {
          id: "MyTable",
          name: "My Table",
          uiPriority: 59,
          rsid: "00112233",
          table: { alignment: AlignmentType.CENTER },
          conditionalFormats: [{ type: "firstRow", run: { bold: true } }, { type: "band1Horz" }],
        },
      ],
    });

    const xml = styles.serialize();
    const el = parseXml(xml).elements?.[0];
    if (!el) throw new Error("parsed document has no root element");
    const opts = parseStyleDefinitions(el, parseParagraphProperties, ctx);

    const table = opts?.tableStyles?.[0];
    expect(table).toBeDefined();
    expect(table!.id).toBe("MyTable");
    expect(table!.name).toBe("My Table");
    expect(table!.uiPriority).toBe(59);
    expect(table!.rsid).toBe("00112233");
    expect(table!.table?.alignment).toBe(AlignmentType.CENTER);
    const cf1 = table!.conditionalFormats?.find((c) => c.type === "firstRow");
    expect(cf1).toBeDefined();
    expect(cf1!.run?.bold).toBe(true);
    expect(table!.conditionalFormats?.find((c) => c.type === "band1Horz")).toBeDefined();
    // Table styles are fully structured — NOT captured as verbatim _raw.
    expect(opts?.importedStyles ?? []).toEqual([]);
  });

  it("round-trips an empty tblPr placeholder inside tblStylePr", () => {
    // Word's table-style generator emits <w:tblPr/> placeholders in
    // conditional formats — presence itself is the content.
    const xml =
      `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:style w:type="table" w:styleId="T1"><w:name w:val="T1"/>` +
      `<w:tblStylePr w:type="firstRow"><w:tblPr/></w:tblStylePr>` +
      `</w:style></w:styles>`;
    const el = parseXml(xml).elements?.[0];
    if (!el) throw new Error("parsed document has no root element");
    const opts = parseStyleDefinitions(el, parseParagraphProperties, ctx);

    const cf = opts?.tableStyles?.[0]?.conditionalFormats?.[0];
    expect(cf).toBeDefined();
    expect(cf!.table).toEqual({});

    const roundXml = new Styles({ tableStyles: opts!.tableStyles! }).serialize();
    expect(roundXml).toContain("<w:tblStylePr");
    expect(roundXml).toContain("<w:tblPr");
  });

  it("round-trips default/customStyle/hidden/rsid on a custom paragraph style", () => {
    const styles = new Styles({
      paragraphStyles: [
        {
          id: "MyDefault",
          name: "My Default",
          default: true,
          customStyle: true,
          hidden: true,
          rsid: "00992297",
          run: { bold: true },
        },
      ],
    });

    const xml = styles.serialize();
    // w:default/w:customStyle are <w:style> element attributes; hidden/rsid are children.
    expect(xml).toContain('w:default="1"');
    expect(xml).toContain('w:customStyle="1"');
    expect(xml).toContain("<w:hidden/>");
    expect(xml).toContain('w:rsid w:val="00992297"');

    const el = parseXml(xml).elements?.[0];
    if (!el) throw new Error("parsed document has no root element");
    const opts = parseStyleDefinitions(el, parseParagraphProperties, ctx);
    const para = opts?.paragraphStyles?.[0];
    expect(para).toBeDefined();
    expect(para!.default).toBe(true);
    expect(para!.customStyle).toBe(true);
    expect(para!.hidden).toBe(true);
    expect(para!.rsid).toBe("00992297"); // leading zero preserved verbatim
  });

  it("round-trips default/customStyle/hidden/rsid on a custom character style", () => {
    const styles = new Styles({
      characterStyles: [
        {
          id: "MyCharDefault",
          name: "My Char",
          default: true,
          customStyle: true,
          hidden: true,
          rsid: "00ABCDEF",
          run: { italic: true },
        },
      ],
    });

    const xml = styles.serialize();
    expect(xml).toContain('w:default="1"');
    expect(xml).toContain('w:customStyle="1"');

    const el = parseXml(xml).elements?.[0];
    if (!el) throw new Error("parsed document has no root element");
    const opts = parseStyleDefinitions(el, parseParagraphProperties, ctx);
    const char = opts?.characterStyles?.[0];
    expect(char).toBeDefined();
    expect(char!.default).toBe(true);
    expect(char!.customStyle).toBe(true);
    expect(char!.hidden).toBe(true);
    expect(char!.rsid).toBe("00ABCDEF");
  });

  it("captures builtin and custom styles structured (no verbatim _raw)", () => {
    const xml =
      '<?xml version="1.0"?><w:styles>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Custom1"><w:name w:val="Custom1"/></w:style>' +
      "</w:styles>";
    const el = parseXml(xml).elements?.[0];
    if (!el) throw new Error("parsed document has no root element");
    const opts = parseStyleDefinitions(el, parseParagraphProperties, ctx);
    // All styles (builtin + custom) round-trip structured so HTML renderers
    // can consume attributes directly — no verbatim _raw for builtins anymore.
    expect(opts?.paragraphStyles?.map((s) => s.id)).toEqual(["Heading1", "Custom1"]);
    expect(opts?.importedStyles ?? []).toEqual([]);
    expect(opts?.roundTripped).toBe(true);
  });

  it("round-trips a numbering style (NoList no longer lost)", () => {
    const xml =
      '<?xml version="1.0"?><w:styles>' +
      '<w:style w:type="numbering" w:default="1" w:styleId="NoList">' +
      '<w:name w:val="No List"/><w:uiPriority w:val="99"/>' +
      "</w:style></w:styles>";
    const el = parseXml(xml).elements?.[0];
    if (!el) throw new Error("parsed document has no root element");
    const opts = parseStyleDefinitions(el, parseParagraphProperties, ctx);
    const num = opts?.numberingStyles?.[0];
    expect(num).toBeDefined();
    expect(num!.id).toBe("NoList");
    expect(num!.name).toBe("No List");
    expect(num!.uiPriority).toBe(99);
    expect(num!.default).toBe(true);
  });

  it("reads document defaults with full paragraph properties (not just spacing)", () => {
    // Previously parseDocDefaults only read w:spacing; it now reuses
    // parseParagraphProperties so jc/ind round-trip too.
    const xml =
      '<?xml version="1.0"?><w:styles><w:docDefaults>' +
      "<w:rPrDefault><w:rPr><w:b/></w:rPr></w:rPrDefault>" +
      '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="278"/><w:jc w:val="center"/></w:pPr></w:pPrDefault>' +
      "</w:docDefaults></w:styles>";
    const el = parseXml(xml).elements?.[0];
    if (!el) throw new Error("parsed document has no root element");
    const opts = parseStyleDefinitions(el, parseParagraphProperties, ctx);
    const doc = opts?.default?.document;
    expect(doc?.run?.bold).toBe(true);
    expect(doc?.paragraph?.spacing?.after).toBe(160);
    expect(doc?.paragraph?.spacing?.line).toBe(278);
    expect(doc?.paragraph?.alignment).toBe(AlignmentType.CENTER);
  });
});

describe("DefaultStylesFactory overrides (user definitions win)", () => {
  it("applies user heading1 override and syncs Heading1Char + outlineLevel", () => {
    const result = new DefaultStylesFactory().newInstance({
      heading1: { run: { color: "FF0000" } },
    });
    const h1 = result.paragraphStyles!.find((s) => s.id === "Heading1")!;
    expect(h1.run?.color).toBe("FF0000");
    expect(h1.paragraph?.outlineLevel).toBe(0);
    const h1Char = result.characterStyles!.find((s) => s.id === "Heading1Char")!;
    expect(h1Char.run?.color).toBe("FF0000");
  });

  it("emits Strong/Emphasis only when the user defines them", () => {
    const custom = new DefaultStylesFactory().newInstance({
      strong: { run: { bold: true } },
      emphasis: { run: { italic: true } },
    });
    expect(custom.paragraphStyles!.some((s) => s.id === "Strong")).toBe(true);
    expect(custom.paragraphStyles!.some((s) => s.id === "Emphasis")).toBe(true);

    const defaults = new DefaultStylesFactory().newInstance({});
    expect(defaults.paragraphStyles!.some((s) => s.id === "Strong")).toBe(false);
    expect(defaults.paragraphStyles!.some((s) => s.id === "Emphasis")).toBe(false);
  });

  it("keeps the built-in heading default when no override (zero regression)", () => {
    const { paragraphStyles } = new DefaultStylesFactory().newInstance({});
    const h1 = paragraphStyles!.find((s) => s.id === "Heading1")!;
    expect(h1.run?.color).toEqual({ val: "0F4761", themeColor: "accent1", themeShade: "BF" });
  });
});

describe("Styles dedup (user definitions override builtins)", () => {
  it("paragraphStyles override importedStyles with the same styleId", () => {
    const styles = new Styles({
      importedStyles: [
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>',
      ],
      paragraphStyles: [{ id: "Heading1", name: "My Heading 1", run: { color: "FF0000" } }],
    });
    const xml = styles.serialize();
    expect((xml.match(/styleId="Heading1"/g) ?? []).length).toBe(1);
    expect(xml).toContain("My Heading 1");
  });
});

describe("styles round-trip (generate → parse → generate)", () => {
  it("keeps table + custom paragraph styles across a full round-trip", () => {
    const buffer = generateDocumentSync({
      sections: [{ children: [{ paragraph: { children: [{ text: "x" }] } }] }],
      styles: {
        paragraphStyles: [{ id: "MyPara", name: "My Para", run: { bold: true } }],
        tableStyles: [
          {
            id: "MyTable",
            name: "My Table",
            conditionalFormats: [{ type: "firstRow", run: { bold: true } }],
          },
        ],
      },
    });

    // First parse: custom + table styles are structured (table not lost).
    const parsed = parseDocumentSync(buffer);
    expect(parsed.styles?.paragraphStyles?.map((s) => s.id)).toContain("MyPara");
    expect(parsed.styles?.tableStyles?.map((s) => s.id)).toContain("MyTable");

    // Round-trip through context.ts again — table styles must survive (the
    // previous round-trip branch dropped tableStyles, losing every table style).
    const reparsed = parseDocumentSync(generateDocumentSync(parsed));
    expect(reparsed.styles?.tableStyles?.map((s) => s.id)).toContain("MyTable");
    expect(reparsed.styles?.paragraphStyles?.map((s) => s.id)).toContain("MyPara");
  });

  it("exposes builtin styles as structured paragraphStyles for HTML rendering", () => {
    const buffer = generateDocumentSync({
      sections: [{ children: [{ paragraph: { children: [{ text: "x" }] } }] }],
      styles: { default: { heading1: { run: { color: "FF0000" } } } },
    });
    const parsed = parseDocumentSync(buffer);
    // Builtins (Heading1, Normal) round-trip structured so an HTML renderer can
    // read their run/paragraph attributes directly — no XML string parsing.
    const h1 = parsed.styles?.paragraphStyles?.find((s) => s.id === "Heading1");
    expect(h1).toBeDefined();
    expect(JSON.stringify(h1!.run?.color)).toContain("FF0000");
    expect(parsed.styles?.paragraphStyles?.some((s) => s.id === "Normal")).toBe(true);
  });

  it("preserves a customized builtin across serialize → parse (no _raw)", () => {
    const xml =
      '<?xml version="1.0"?><w:styles>' +
      "<w:docDefaults><w:rPrDefault><w:rPr/></w:rPrDefault><w:pPrDefault><w:pPr/></w:pPrDefault></w:docDefaults>" +
      '<w:latentStyles w:defLockedState="0" w:count="1"/>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
      '<w:rPr><w:color w:val="00AA00"/></w:rPr></w:style>' +
      "</w:styles>";
    const root = parseXml(xml).elements?.[0];
    if (!root) throw new Error("parsed document has no root element");
    const parsed = parseStyleDefinitions(root, parseParagraphProperties, ctx);
    expect(
      JSON.stringify(parsed?.paragraphStyles?.find((s) => s.id === "Heading1")?.run?.color),
    ).toContain("00AA00");

    const styles = new Styles({
      importedStyles: [parsed!.docDefaultsXml!, parsed!.latentStylesXml!],
      paragraphStyles: parsed!.paragraphStyles,
    });
    const reRoot = parseXml(styles.serialize()).elements?.[0];
    if (!reRoot) throw new Error("parsed document has no root element");
    const reParsed = parseStyleDefinitions(reRoot, parseParagraphProperties, ctx);
    expect(
      JSON.stringify(reParsed?.paragraphStyles?.find((s) => s.id === "Heading1")?.run?.color),
    ).toContain("00AA00");
  });

  it("treats an empty <w:pPrDefault/> as explicit null (no spacing injection)", () => {
    // ECMA-376: an empty pPrDefault suppresses Word's default spacing, whereas a
    // missing pPrDefault is application-defined. parse must distinguish them, and
    // stringify must round-trip the empty tag without injecting after=160.
    const xml =
      '<?xml version="1.0"?><w:styles>' +
      "<w:docDefaults><w:rPrDefault><w:rPr/></w:rPrDefault><w:pPrDefault/></w:docDefaults>" +
      '<w:latentStyles w:defLockedState="0" w:count="1"/>' +
      "</w:styles>";
    const root = parseXml(xml).elements?.[0];
    if (!root) throw new Error("parsed document has no root element");
    const parsed = parseStyleDefinitions(root, parseParagraphProperties, ctx);
    expect(parsed?.default?.document?.paragraph).toBeNull();
    const rexml = stringifyDocDefaults(parsed!.default!.document!, false);
    expect(rexml).toContain("<w:pPrDefault/>");
    expect(rexml).not.toContain('after="160"');
  });

  it("omits pPrDefault when the source has none (round-trip)", () => {
    const xml =
      '<?xml version="1.0"?><w:styles>' +
      "<w:docDefaults><w:rPrDefault><w:rPr><w:b/></w:rPr></w:rPrDefault></w:docDefaults>" +
      '<w:latentStyles w:defLockedState="0" w:count="1"/>' +
      "</w:styles>";
    const root = parseXml(xml).elements?.[0];
    if (!root) throw new Error("parsed document has no root element");
    const parsed = parseStyleDefinitions(root, parseParagraphProperties, ctx);
    expect(parsed?.default?.document?.paragraph).toBeUndefined();
    // injectDefaults=false → the absent element is not emitted on round-trip
    const rexml = stringifyDocDefaults(parsed!.default!.document!, false);
    expect(rexml).not.toContain("pPrDefault");
  });

  it("injects en-US docDefaults lang by default and honors the language option", () => {
    // Fresh generation mirrors an en-US Word install (`<w:lang w:val="en-US"/>`,
    // no eastAsia/bidi). A zh-CN install sets defaultStyles.language instead.
    const fresh = stringifyDocDefaults({}, true);
    expect(fresh).toContain('<w:lang w:val="en-US"/>');
    expect(fresh.match(/<w:lang[^>]*>/)?.[0]).toBe('<w:lang w:val="en-US"/>');
    const zh = stringifyDocDefaults({}, true, {
      value: "en-US",
      eastAsia: "zh-CN",
      bidirectional: "ar-SA",
    });
    expect(zh).toContain('<w:lang w:val="en-US" w:eastAsia="zh-CN" w:bidi="ar-SA"/>');
  });

  it("reflects visual-editor edits to default.document on generate", () => {
    // Fresh doc → parse → editor overrides default paragraph spacing → generate
    // must reflect the edit (not the original verbatim docDefaults).
    const fresh = generateDocumentSync({
      sections: [{ children: [{ paragraph: { children: [{ text: "x" }] } }] }],
    });
    const parsed = parseDocumentSync(fresh);
    parsed.styles!.default!.document!.paragraph = { spacing: { after: 0 } };
    const regenerated = parseDocumentSync(generateDocumentSync(parsed));
    const docDefaultsXml = regenerated.styles!.docDefaultsXml!;
    expect(docDefaultsXml).toContain('w:after="0"');
    expect(docDefaultsXml).not.toContain('w:after="160"');
  });
});
