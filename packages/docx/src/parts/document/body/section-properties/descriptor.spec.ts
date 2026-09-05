import type { ReadContext } from "@office-open/core/descriptor";
import { parse as parseXml } from "@office-open/xml";
import { describe, expect, it } from "vite-plus/test";

import type { BodyContext } from "../../../../context";
import { sectionPropertiesDesc } from "./descriptor";
import type { DocGridProperties } from "./properties/doc-grid";
import type { PageMarginProperties } from "./properties/page-margin";
import type { PageSizeProperties } from "./properties/page-size";
import type {
  SectionPropertiesChangeOptions,
  SectionPropertiesOptions,
} from "./section-properties";

const writeCtx = {
  addRelationship: () => "rId1",
  addMedia: () => "",
  stringifyChild: (child: unknown) => String(child),
  fileData: {} as never,
} as unknown as BodyContext;

const readCtx = {} as unknown as ReadContext;

// Narrow the pageSize/pageMargin three-state unions (object | false | absent)
// to the object branch these assertions inspect.
const pageSize = (r: SectionPropertiesOptions) => r.pageSize as PageSizeProperties;
const pageMargin = (r: SectionPropertiesOptions) => r.pageMargin as PageMarginProperties;

function roundTrip(opts: SectionPropertiesOptions) {
  const xml = sectionPropertiesDesc.stringify(opts, writeCtx)!;
  const doc = parseXml(xml);
  const el = doc.elements?.[0];
  if (!el) throw new Error("parsed document has no root element");
  return sectionPropertiesDesc.parse(el, readCtx);
}

describe("sectionPropertiesDesc round-trip", () => {
  it("fresh section emits Word's CJK default line grid", () => {
    // opts.grid undefined → stringify emits the default (linePitch 312, type
    // "lines"); parse reads it back as a grid object.
    const result = roundTrip({});
    expect(result.grid).toBeDefined();
    expect((result.grid as DocGridProperties).linePitch).toBe(312);
  });

  it("parses source without w:docGrid as explicit off (preserve fidelity)", () => {
    // A parsed source that has no w:docGrid must round-trip as grid=false so
    // stringify omits the element instead of injecting a default CJK grid.
    const xml = `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="720"/></w:sectPr>`;
    const el = parseXml(xml).elements?.[0];
    if (!el) throw new Error("parsed document has no root element");
    const result = sectionPropertiesDesc.parse(el, readCtx);
    expect(result.grid).toBe(false);
  });

  it("round-trips page size", () => {
    const result = roundTrip({
      pageSize: { width: 12240, height: 15840 },
    });
    expect(pageSize(result).width).toBe(12240);
    expect(pageSize(result).height).toBe(15840);
  });

  it("round-trips landscape orientation (swaps w/h and swaps back)", () => {
    const result = roundTrip({
      pageSize: { width: 12240, height: 15840, orientation: "landscape" },
    });
    // Logical width/height (portrait perspective) must survive the stringify
    // swap (w:w=height, w:h=width) and the parse swap-back.
    expect(pageSize(result).orientation).toBe("landscape");
    expect(pageSize(result).width).toBe(12240);
    expect(pageSize(result).height).toBe(15840);
  });

  it("parses a Word-emitted landscape page size (physical w > h)", () => {
    // Word stores landscape with the long edge in w:w (physical), e.g. Letter
    // landscape: w:w=15840 w:h=12240 orient=landscape. Parse must swap back to
    // logical width=12240 (short) height=15840 (long).
    const xml =
      '<w:sectPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/></w:sectPr>';
    const el = parseXml(xml).elements?.[0];
    if (!el) throw new Error("parsed document has no root element");
    const result = sectionPropertiesDesc.parse(el, readCtx);
    expect(pageSize(result).orientation).toBe("landscape");
    expect(pageSize(result).width).toBe(12240);
    expect(pageSize(result).height).toBe(15840);
  });

  it("parses portrait page size without swapping (w = logical width)", () => {
    const xml =
      '<w:sectPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';
    const el = parseXml(xml).elements?.[0];
    if (!el) throw new Error("parsed document has no root element");
    const result = sectionPropertiesDesc.parse(el, readCtx);
    expect(pageSize(result).width).toBe(12240);
    expect(pageSize(result).height).toBe(15840);
    expect(pageSize(result).orientation).toBeUndefined();
  });

  it("round-trips portrait page size with UniversalMeasure (mm → twips)", () => {
    // UniversalMeasure on width/height is normalized to twips on stringify (so
    // the attrNum-based parse reads it back). 210/297mm floor to 11905/16837
    // twips (convertMillimetersToTwip uses Math.floor).
    const result = roundTrip({
      pageSize: { width: "210mm", height: "297mm" },
    });
    expect(pageSize(result).width).toBe(11905);
    expect(pageSize(result).height).toBe(16837);
    // orientation defaults to portrait when omitted.
    expect(pageSize(result).orientation).toBe("portrait");
  });

  it("round-trips page size code (printer paper code)", () => {
    const result = roundTrip({
      pageSize: { width: 12240, height: 15840, code: 1 },
    });
    expect(pageSize(result).code).toBe(1);
  });

  it("round-trips page margins", () => {
    const result = roundTrip({
      pageMargin: {
        top: 1440,
        right: 1440,
        bottom: 1440,
        left: 1440,
        header: 720,
        footer: 720,
        gutter: 0,
      },
    });
    const margin = pageMargin(result);
    expect(margin.top).toBe(1440);
    expect(margin.right).toBe(1440);
    expect(margin.bottom).toBe(1440);
    expect(margin.left).toBe(1440);
    expect(margin.header).toBe(720);
    expect(margin.footer).toBe(720);
    expect(margin.gutter).toBe(0);
  });

  it("round-trips section type", () => {
    const result = roundTrip({ type: "nextPage" });
    expect(result.type).toBe("nextPage");
  });

  it("round-trips titlePage", () => {
    const result = roundTrip({ titlePage: true });
    expect(result.titlePage).toBe(true);
  });

  it("round-trips noEndnote", () => {
    const result = roundTrip({ noEndnote: true });
    expect(result.noEndnote).toBe(true);
  });

  it("round-trips formProtection", () => {
    const result = roundTrip({ formProtection: true });
    expect(result.formProtection).toBe(true);
  });

  it("round-trips bidi", () => {
    const result = roundTrip({ bidi: true });
    expect(result.bidi).toBe(true);
  });

  it("round-trips rtlGutter", () => {
    const result = roundTrip({ rtlGutter: true });
    expect(result.rtlGutter).toBe(true);
  });

  it("round-trips verticalAlign", () => {
    const result = roundTrip({ verticalAlign: "center" });
    expect(result.verticalAlign).toBe("center");
  });

  it("round-trips column properties", () => {
    const result = roundTrip({
      columns: { count: 3, space: 720 },
    });
    expect(result.columns).toBeDefined();
    expect(result.columns!.count).toBe(3);
    expect(result.columns!.space).toBe(720);
  });

  it("normalizes column space UniversalMeasure (mm) to twips", () => {
    const result = roundTrip({
      columns: { count: 2, space: "5mm" },
    });
    expect(result.columns!.space).toBe(283);
  });

  it("normalizes custom column width/space UniversalMeasure (mm) to twips", () => {
    const result = roundTrip({
      columns: {
        children: [{ width: "30mm", space: "2.5mm" }, { width: "40mm" }],
      },
    });
    const children = result.columns!.children!;
    expect(children[0]?.width).toBe(1700);
    expect(children[0]?.space).toBe(141);
    expect(children[1]?.width).toBe(2267);
  });

  it("round-trips line numbers", () => {
    const result = roundTrip({
      lineNumberType: { countBy: 5, start: 1, restart: "continuous", distance: 360 },
    });
    expect(result.lineNumberType).toBeDefined();
    expect(result.lineNumberType!.countBy).toBe(5);
    expect(result.lineNumberType!.start).toBe(1);
  });

  it("round-trips docGrid", () => {
    const result = roundTrip({
      grid: { linePitch: 240, charSpace: 100, type: "lines" },
    });
    expect(result.grid).toBeDefined();
    const grid = result.grid as DocGridProperties;
    expect(grid.linePitch).toBe(240);
    expect(grid.charSpace).toBe(100);
    expect(grid.type).toBe("lines");
  });

  it("round-trips page numbers", () => {
    const result = roundTrip({
      pageNumberType: { start: 10, format: "decimal" },
    });
    expect(result.pageNumberType).toBeDefined();
    expect(result.pageNumberType!.start).toBe(10);
    expect(result.pageNumberType!.format).toBe("decimal");
  });

  it("round-trips paperSrc", () => {
    const result = roundTrip({
      paperSrc: { first: 1, other: 2 },
    });
    expect(result.paperSrc).toBeDefined();
    expect(result.paperSrc!.first).toBe(1);
    expect(result.paperSrc!.other).toBe(2);
  });

  it("round-trips rsid attributes", () => {
    const result = roundTrip({
      additionRsid: "00112233",
      runPropertiesRsid: "AABBCCDD",
      sectionRsid: "11223344",
    });
    expect(result.additionRsid).toBe("00112233");
    expect(result.runPropertiesRsid).toBe("AABBCCDD");
    expect(result.sectionRsid).toBe("11223344");
  });

  it("round-trips the revision snapshot's rsids inside w:sectPrChange", () => {
    // The inner w:sectPr of CT_SectPrChange carries the same rsid set as the
    // top-level element — the snapshot must round-trip them too.
    const result = roundTrip({
      sectionRsid: "00AA11BB",
      revision: {
        author: "A",
        date: "2024-01-01T00:00:00Z",
        pageSize: { width: 12240, height: 15840 },
        sectionRsid: "11223344",
        additionRsid: "00112233",
        runPropertiesRsid: "AABBCCDD",
        deletionRsid: "55667788",
      },
    });
    const rev = result.revision as SectionPropertiesChangeOptions;
    expect(rev.author).toBe("A");
    expect(rev.sectionRsid).toBe("11223344");
    expect(rev.additionRsid).toBe("00112233");
    expect(rev.runPropertiesRsid).toBe("AABBCCDD");
    expect(rev.deletionRsid).toBe("55667788");
    expect(pageSize(rev).width).toBe(12240);
  });

  it("round-trips combined options", () => {
    const result = roundTrip({
      type: "continuous",
      titlePage: true,
      verticalAlign: "both",
      pageSize: { width: 11906, height: 16838 },
      pageMargin: {
        top: 1440,
        right: 1800,
        bottom: 1440,
        left: 1800,
        header: 720,
        footer: 720,
        gutter: 0,
      },
    });
    expect(result.type).toBe("continuous");
    expect(result.titlePage).toBe(true);
    expect(result.verticalAlign).toBe("both");
  });
});
