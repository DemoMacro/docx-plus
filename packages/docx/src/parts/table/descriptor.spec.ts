import type { ReadContext } from "@office-open/core/descriptor";
import { parse as parseXml } from "@office-open/xml";
import { describe, expect, it } from "vite-plus/test";

import type { BodyContext } from "../../context";
import { setTableParseChild, tableDesc } from "./descriptor";
import type { TableOptions } from "./table";
import type { TableCellOptions } from "./table-cell";
import type { TableRowOptions } from "./table-row";

// Register a minimal child parser for table cells
setTableParseChild((_el, _ctx) => {
  return { paragraph: {} };
});

const writeCtx = {
  addRelationship: () => "rId1",
  addMedia: () => "",
  stringifyChild: (child: unknown) =>
    typeof child === "string" ? `<w:p><w:r><w:t>${child}</w:t></w:r></w:p>` : "<w:p/>",
  fileData: {} as never,
} as unknown as BodyContext;

const readCtx = {
  resolveRelationship: () => undefined,
  getPart: () => undefined,
  getRaw: () => undefined,
} as unknown as ReadContext;

function roundTrip(opts: TableOptions) {
  const xml = tableDesc.stringify(opts, writeCtx)!;
  const doc = parseXml(xml);
  const el = doc.elements?.[0];
  if (!el) throw new Error("parsed document has no root element");
  return tableDesc.parse(el, readCtx);
}

describe("tableDesc round-trip", () => {
  it("round-trips a simple table", () => {
    const result = roundTrip({
      rows: [{ cells: [{ children: [{ paragraph: "cell1" }] }] }],
    });
    expect(result.rows).toHaveLength(1);
    expect((result.rows[0] as TableRowOptions).cells).toHaveLength(1);
  });

  it("preserves bare row and cell cnfStyle elements", () => {
    const result = roundTrip({
      rows: [
        {
          cnfStyle: {},
          cells: [{ cnfStyle: {}, children: [] }],
        },
      ],
    });
    const row = result.rows[0] as TableRowOptions;
    expect(row.cnfStyle).toEqual({});
    expect((row.cells[0] as TableCellOptions).cnfStyle).toEqual({});
  });

  it("round-trips table style", () => {
    const result = roundTrip({
      style: "TableGrid",
      rows: [{ cells: [{ children: [] }] }],
    });
    expect(result.style).toBe("TableGrid");
  });

  it("round-trips table alignment", () => {
    const result = roundTrip({
      alignment: "center",
      rows: [{ cells: [{ children: [] }] }],
    });
    expect(result.alignment).toBe("center");
  });

  it("round-trips table width", () => {
    const result = roundTrip({
      width: { size: 5000, type: "twips" },
      rows: [{ cells: [{ children: [] }] }],
    });
    expect(result.width).toBeDefined();
    expect(result.width!.size).toBe(5000);
  });

  it("round-trips table borders", () => {
    const result = roundTrip({
      borders: {
        top: { style: "single", color: "FF0000", size: 4 },
        bottom: { style: "single", color: "00FF00", size: 4 },
      },
      rows: [{ cells: [{ children: [] }] }],
    });
    expect(result.borders).toBeDefined();
    expect(result.borders!.top!.style).toBe("single");
    expect(result.borders!.top!.color).toBe("FF0000");
    expect(result.borders!.top!.size).toBe(4);
  });

  it("does not inflate unspecified border sides", () => {
    // CT_TblBorders sides are all optional — setting only top must not invent
    // the other five sides (faithful round-trip: no inflation).
    const result = roundTrip({
      borders: { top: { style: "single" } },
      rows: [{ cells: [{ children: [] }] }],
    });
    expect(result.borders!.top).toBeDefined();
    expect(result.borders!.bottom).toBeUndefined();
    expect(result.borders!.left).toBeUndefined();
    expect(result.borders!.insideHorizontal).toBeUndefined();
    expect(result.borders!.insideVertical).toBeUndefined();
  });

  it("round-trips inside borders", () => {
    // insideH/insideV XML names must map to insideHorizontal/insideVertical keys.
    const result = roundTrip({
      borders: {
        insideHorizontal: { style: "single", color: "0000FF" },
        insideVertical: { style: "single", color: "00FF00" },
      },
      rows: [
        { cells: [{ children: [] }, { children: [] }] },
        { cells: [{ children: [] }, { children: [] }] },
      ],
    });
    expect(result.borders!.insideHorizontal).toBeDefined();
    expect(result.borders!.insideHorizontal!.color).toBe("0000FF");
    expect(result.borders!.insideVertical).toBeDefined();
    expect(result.borders!.insideVertical!.color).toBe("00FF00");
  });

  it("round-trips border themeColor and shadow", () => {
    const result = roundTrip({
      borders: { top: { style: "single", themeColor: "text1", shadow: true } },
      rows: [{ cells: [{ children: [] }] }],
    });
    expect(result.borders!.top!.themeColor).toBe("text1");
    expect(result.borders!.top!.shadow).toBe(true);
  });

  it("round-trips artistic ST_Border tokens verbatim", () => {
    // Artistic borders (ST_Border's full 193-token set) survive parse and
    // re-emit with the same @w:val — no whitelist in between.
    const result = roundTrip({
      borders: {
        top: { style: "weavingBraid", color: "FF0000", size: 4 },
        bottom: { style: "apples", color: "00FF00", size: 4 },
      },
      rows: [{ cells: [{ children: [] }] }],
    });
    expect(result.borders!.top!.style).toBe("weavingBraid");
    expect(result.borders!.bottom!.style).toBe("apples");
    const xml = tableDesc.stringify(
      {
        borders: { top: { style: "weavingBraid" } },
        rows: [{ cells: [{ children: [] }] }],
      },
      writeCtx,
    )!;
    expect(xml).toContain('w:val="weavingBraid"');
  });

  it("drops border sides without a w:val", () => {
    const xml =
      '<w:tbl><w:tblPr><w:tblBorders><w:top w:sz="4"/></w:tblBorders></w:tblPr>' +
      "<w:tblGrid/><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>";
    const el = parseXml(xml).elements?.[0];
    if (!el) throw new Error("parsed document has no root element");
    const result = tableDesc.parse(el, readCtx);
    expect(result.borders).toBeUndefined();
  });

  it("round-trips table layout", () => {
    const result = roundTrip({
      layout: "fixed",
      rows: [{ cells: [{ children: [] }] }],
    });
    expect(result.layout).toBe("fixed");
  });

  it("round-trips column widths", () => {
    const result = roundTrip({
      columnWidths: [3000, 3000],
      rows: [{ cells: [{ children: [] }, { children: [] }] }],
    });
    expect(result.columnWidths).toEqual([3000, 3000]);
  });

  it("normalizes table width UniversalMeasure (mm) to twips", () => {
    const result = roundTrip({
      width: { size: "50mm", type: "twips" },
      rows: [{ cells: [{ children: [] }] }],
    });
    expect(result.width?.size).toBe(2834);
    expect(result.width?.type).toBe("twips");
  });

  it("normalizes row height UniversalMeasure (cm) to twips", () => {
    const result = roundTrip({
      rows: [{ height: { value: "1cm" }, cells: [{ children: [] }] }],
    });
    const row = result.rows[0] as TableRowOptions;
    expect(row.height?.value).toBe(566);
  });

  it("normalizes column widths UniversalMeasure to twips", () => {
    const result = roundTrip({
      columnWidths: ["25mm", "25mm"],
      rows: [{ cells: [{ children: [] }, { children: [] }] }],
    });
    expect(result.columnWidths).toEqual([1417, 1417]);
  });

  it('parses pct fiftieths as percentage (w:w="5000" w:type="pct" → 100)', () => {
    // Word writes 100% width as w:w="5000" w:type="pct" (fiftieths-of-percent).
    // Parse converts to the user-facing percentage (5000 / 50 = 100); stringify
    // multiplies back (100 * 50 = 5000), keeping round-trip byte-stable.
    const xml =
      '<w:tbl xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="500"/></w:tblGrid>' +
      "<w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>";
    const el176 = parseXml(xml).elements?.[0];
    if (!el176) throw new Error("parsed document has no root element");
    const result = tableDesc.parse(el176, readCtx);
    expect(result.width?.size).toBe(100);
    expect(result.width?.type).toBe("percent");
  });

  it('round-trips pct width (size:100 → w:w="5000" → size:100)', () => {
    const xml = tableDesc.stringify(
      { width: { size: 100, type: "percent" }, rows: [{ cells: [{ children: [] }] }] },
      writeCtx,
    )!;
    // Stringify emits the fiftieths integer (5000 = 100%), never "100%".
    expect(xml).toContain('w:tblW w:w="5000" w:type="pct"');
    expect(xml).not.toContain('w:w="100%"');
    // Parse converts back to the user-facing percentage.
    const parsedEl = parseXml(xml).elements?.[0];
    if (!parsedEl) throw new Error("parsed document has no root element");
    const result = tableDesc.parse(parsedEl, readCtx);
    expect(result.width).toEqual({ size: 100, type: "percent" });
  });

  it('round-trips cellSpacing pct (size:100 → w:w="5000" → size:100)', () => {
    const xml = tableDesc.stringify(
      { cellSpacing: { size: 100, type: "percent" }, rows: [{ cells: [{ children: [] }] }] },
      writeCtx,
    )!;
    expect(xml).toContain('w:tblCellSpacing w:w="5000" w:type="pct"');
    const parsedEl = parseXml(xml).elements?.[0];
    if (!parsedEl) throw new Error("parsed document has no root element");
    const result = tableDesc.parse(parsedEl, readCtx);
    expect(result.cellSpacing).toEqual({ size: 100, type: "percent" });
  });

  it('round-trips indent pct (size:50 → w:w="2500" → size:50)', () => {
    const xml = tableDesc.stringify(
      { indent: { size: 50, type: "percent" }, rows: [{ cells: [{ children: [] }] }] },
      writeCtx,
    )!;
    expect(xml).toContain('w:tblInd w:w="2500" w:type="pct"');
    const parsedEl = parseXml(xml).elements?.[0];
    if (!parsedEl) throw new Error("parsed document has no root element");
    const result = tableDesc.parse(parsedEl, readCtx);
    expect(result.indent).toEqual({ size: 50, type: "percent" });
  });

  it("round-trips description", () => {
    const result = roundTrip({
      description: "Test table description",
      rows: [{ cells: [{ children: [] }] }],
    });
    expect(result.description).toBe("Test table description");
  });

  it("round-trips multiple rows", () => {
    const result = roundTrip({
      rows: [
        { cells: [{ children: [{ paragraph: "r1c1" }] }] },
        { cells: [{ children: [{ paragraph: "r2c1" }] }] },
        { cells: [{ children: [{ paragraph: "r3c1" }] }] },
      ],
    });
    expect(result.rows).toHaveLength(3);
  });

  it("round-trips row with height", () => {
    const result = roundTrip({
      rows: [
        {
          cells: [{ children: [] }],
          height: { value: 500, rule: "atLeast" },
        },
      ],
    });
    const row = result.rows[0] as TableRowOptions;
    expect(row.height).toBeDefined();
    expect(row.height!.value).toBe(500);
  });

  it("round-trips cell with column span", () => {
    const result = roundTrip({
      rows: [
        {
          cells: [{ children: [], columnSpan: 2 }, { children: [] }],
        },
      ],
    });
    expect(((result.rows[0] as TableRowOptions).cells[0] as TableCellOptions).columnSpan).toBe(2);
  });

  it("round-trips cell shading", () => {
    const result = roundTrip({
      rows: [
        {
          cells: [
            {
              children: [],
              shading: { fill: "FFFF00", type: "clear" },
            },
          ],
        },
      ],
    });
    const cell = (result.rows[0] as TableRowOptions).cells[0] as TableCellOptions;
    expect(cell.shading).toBeDefined();
    expect(cell.shading!.fill).toBe("FFFF00");
  });

  it("round-trips multiple cells in a row", () => {
    const result = roundTrip({
      rows: [
        {
          cells: [
            { children: [{ paragraph: "a" }] },
            { children: [{ paragraph: "b" }] },
            { children: [{ paragraph: "c" }] },
          ],
        },
      ],
    });
    expect((result.rows[0] as TableRowOptions).cells).toHaveLength(3);
  });

  it("round-trips visuallyRightToLeft (bidiVisual)", () => {
    const result = roundTrip({
      visuallyRightToLeft: true,
      rows: [{ cells: [{ children: [] }] }],
    });
    expect(result.visuallyRightToLeft).toBe(true);
  });

  it("round-trips styleRowBandSize / styleColBandSize", () => {
    const result = roundTrip({
      styleRowBandSize: 2,
      styleColBandSize: 3,
      rows: [{ cells: [{ children: [] }] }],
    });
    expect(result.styleRowBandSize).toBe(2);
    expect(result.styleColBandSize).toBe(3);
  });

  it("round-trips caption (tblCaption)", () => {
    const result = roundTrip({
      caption: "My Caption",
      rows: [{ cells: [{ children: [] }] }],
    });
    expect(result.caption).toBe("My Caption");
  });

  it("round-trips cellSpacing (tblCellSpacing)", () => {
    const result = roundTrip({
      cellSpacing: { size: 108, type: "twips" },
      rows: [{ cells: [{ children: [] }] }],
    });
    expect(result.cellSpacing).toBeDefined();
    expect(result.cellSpacing!.size).toBe(108);
  });

  it("round-trips tblPrChange revision", () => {
    const result = roundTrip({
      revision: { id: 1, author: "A", date: "2024-01-01T00:00:00Z", style: "TableGrid" },
      rows: [{ cells: [{ children: [] }] }],
    });
    expect(result.revision).toBeDefined();
    expect(result.revision!.id).toBe(1);
    expect(result.revision!.author).toBe("A");
  });

  it("round-trips row rsid attributes", () => {
    const result = roundTrip({
      rows: [
        {
          runPropertiesRsid: "00112233",
          additionRsid: "00AABBCC",
          deletionRsid: "00DDEEFF",
          tableRowRsid: "00445566",
          cells: [{ children: [] }],
        },
      ],
    });
    const row = result.rows[0] as TableRowOptions;
    expect(row.runPropertiesRsid).toBe("00112233");
    expect(row.additionRsid).toBe("00AABBCC");
    expect(row.deletionRsid).toBe("00DDEEFF");
    expect(row.tableRowRsid).toBe("00445566");
  });

  it("round-trips row trPr fields (cnfStyle/divId/grid/gridBefore/gridAfter/wBefore/wAfter/jc/hidden)", () => {
    const result = roundTrip({
      rows: [
        {
          cnfStyle: { val: "000000010000" },
          divId: 5,
          gridBefore: 1,
          gridAfter: 2,
          widthBefore: { size: 100, type: "twips" },
          widthAfter: { size: 200, type: "twips" },
          rowAlignment: "center",
          hidden: true,
          cells: [{ children: [] }],
        },
      ],
    });
    const row = result.rows[0] as TableRowOptions;
    expect(row.cnfStyle?.val).toBe("000000010000");
    expect(row.divId).toBe(5);
    expect(row.gridBefore).toBe(1);
    expect(row.gridAfter).toBe(2);
    expect(row.widthBefore?.size).toBe(100);
    expect(row.widthAfter?.size).toBe(200);
    expect(row.rowAlignment).toBe("center");
    expect(row.hidden).toBe(true);
  });

  it("round-trips row trPrChange revision", () => {
    const result = roundTrip({
      rows: [
        {
          revision: { id: 2, author: "B", date: "2024-02-02T00:00:00Z", hidden: true },
          cells: [{ children: [] }],
        },
      ],
    });
    const row = result.rows[0] as TableRowOptions;
    expect(row.revision).toBeDefined();
    expect(row.revision!.id).toBe(2);
    expect(row.revision!.hidden).toBe(true);
  });

  it("round-trips cell diagonal borders (tl2br/tr2bl) and start/end", () => {
    const result = roundTrip({
      rows: [
        {
          cells: [
            {
              children: [],
              borders: {
                start: { style: "single", color: "FF0000" },
                end: { style: "single", color: "00FF00" },
                topLeftToBottomRight: { style: "single", color: "0000FF" },
                topRightToBottomLeft: { style: "single", color: "FFFF00" },
              },
            },
          ],
        },
      ],
    });
    const cell = (result.rows[0] as TableRowOptions).cells[0] as TableCellOptions;
    expect(cell.borders!.start!.color).toBe("FF0000");
    expect(cell.borders!.end!.color).toBe("00FF00");
    expect(cell.borders!.topLeftToBottomRight!.color).toBe("0000FF");
    expect(cell.borders!.topRightToBottomLeft!.color).toBe("FFFF00");
  });

  it("round-trips cell hMerge/tcFitText/hideMark/headers", () => {
    const result = roundTrip({
      rows: [
        {
          cells: [
            {
              children: [],
              horizontalMerge: "restart",
              fitText: true,
              hideMark: true,
              headers: ["h1", "h2"],
            },
          ],
        },
      ],
    });
    const cell = (result.rows[0] as TableRowOptions).cells[0] as TableCellOptions;
    expect(cell.horizontalMerge).toBe("restart");
    expect(cell.fitText).toBe(true);
    expect(cell.hideMark).toBe(true);
    expect(cell.headers).toEqual(["h1", "h2"]);
  });

  it("round-trips cell cellIns/cellDel and tcPrChange revision", () => {
    const result = roundTrip({
      rows: [
        {
          cells: [
            {
              children: [],
              insertion: { id: 1, author: "A", date: "2024-01-01T00:00:00Z" },
              deletion: { id: 2, author: "B", date: "2024-02-02T00:00:00Z" },
              revision: {
                id: 3,
                author: "C",
                date: "2024-03-03T00:00:00Z",
                hideMark: true,
                // CT_TcPrInner (the snapshot's content model) includes
                // EG_CellMarkupElements — the markers survive in the snapshot.
                insertion: { id: 5, author: "E", date: "2024-05-05T00:00:00Z" },
              },
            },
          ],
        },
      ],
    });
    const cell = (result.rows[0] as TableRowOptions).cells[0] as TableCellOptions;
    expect(cell.insertion?.id).toBe(1);
    expect(cell.insertion?.author).toBe("A");
    expect(cell.deletion?.id).toBe(2);
    expect(cell.revision?.id).toBe(3);
    expect(cell.revision?.hideMark).toBe(true);
    expect(cell.revision?.insertion?.id).toBe(5);
    expect(cell.revision?.insertion?.author).toBe("E");
  });

  it("round-trips cell cellMerge (vMerge/vMergeOrig)", () => {
    const result = roundTrip({
      rows: [
        {
          cells: [
            {
              children: [],
              cellMerge: {
                id: 4,
                author: "D",
                date: "2024-04-04T00:00:00Z",
                verticalMerge: "restart",
                verticalMergeOriginal: "continue",
              },
            },
          ],
        },
      ],
    });
    const cell = (result.rows[0] as TableRowOptions).cells[0] as TableCellOptions;
    expect(cell.cellMerge?.id).toBe(4);
    expect(cell.cellMerge?.verticalMerge).toBe("restart");
    expect(cell.cellMerge?.verticalMergeOriginal).toBe("continue");
  });

  it("round-trips a cell-level SDT (CT_SdtCell wrapping a cell)", () => {
    const result = roundTrip({
      rows: [
        {
          cells: [
            { children: [{ paragraph: "normal" }] },
            {
              sdt: {
                properties: { alias: "CellCtrl", tag: "cell-ctrl", text: {} },
                cells: [{ children: [{ paragraph: "controlled" }] }],
              },
            },
          ],
        },
      ],
    });
    const cells = (result.rows[0] as TableRowOptions).cells;
    expect(cells).toHaveLength(2);
    const cellEntry = cells[1];
    expect(cellEntry && "sdt" in cellEntry).toBe(true);
    if (cellEntry && "sdt" in cellEntry) {
      expect(cellEntry.sdt.properties).toMatchObject({ alias: "CellCtrl", tag: "cell-ctrl" });
      expect(cellEntry.sdt.cells).toHaveLength(1);
    }
  });

  it("round-trips a row-level SDT (CT_SdtRow wrapping a row)", () => {
    const result = roundTrip({
      rows: [
        { cells: [{ children: [{ paragraph: "header" }] }] },
        {
          sdt: {
            properties: { alias: "RowCtrl", tag: "row-ctrl", richText: true },
            rows: [{ cells: [{ children: [{ paragraph: "controlled row" }] }] }],
          },
        },
      ],
    });
    expect(result.rows).toHaveLength(2);
    const rowEntry = result.rows[1];
    expect(rowEntry && "sdt" in rowEntry).toBe(true);
    if (rowEntry && "sdt" in rowEntry) {
      expect(rowEntry.sdt.properties).toMatchObject({ alias: "RowCtrl", tag: "row-ctrl" });
      expect(rowEntry.sdt.rows).toHaveLength(1);
    }
  });

  it("round-trips a cell-level customXml (CT_CustomXmlCell wrapping a cell)", () => {
    const result = roundTrip({
      rows: [
        {
          cells: [
            { children: [{ paragraph: "normal" }] },
            {
              customXml: {
                element: "taggedCell",
                uri: "http://ns",
                properties: { attributes: [{ name: "k", val: "v" }] },
                children: [{ children: [{ paragraph: "wrapped" }] }],
              },
            },
          ],
        },
      ],
    });
    const cells = (result.rows[0] as TableRowOptions).cells;
    expect(cells).toHaveLength(2);
    const cellEntry = cells[1];
    expect(cellEntry && "customXml" in cellEntry).toBe(true);
    if (cellEntry && "customXml" in cellEntry) {
      expect(cellEntry.customXml.element).toBe("taggedCell");
      expect(cellEntry.customXml.uri).toBe("http://ns");
      expect(cellEntry.customXml.properties?.attributes).toEqual([{ name: "k", val: "v" }]);
      expect(cellEntry.customXml.children).toHaveLength(1);
    }
  });

  it("round-trips a row-level customXml (CT_CustomXmlRow wrapping a row)", () => {
    const result = roundTrip({
      rows: [
        { cells: [{ children: [{ paragraph: "header" }] }] },
        {
          customXml: {
            element: "taggedRow",
            children: [{ cells: [{ children: [{ paragraph: "wrapped row" }] }] }],
          },
        },
      ],
    });
    expect(result.rows).toHaveLength(2);
    const rowEntry = result.rows[1];
    expect(rowEntry && "customXml" in rowEntry).toBe(true);
    if (rowEntry && "customXml" in rowEntry) {
      expect(rowEntry.customXml.element).toBe("taggedRow");
      expect(rowEntry.customXml.children).toHaveLength(1);
    }
  });

  it("round-trips table cell margins (w:tblCellMar) as per-side TableWidthProperties", () => {
    const result = roundTrip({
      margins: {
        top: { size: 100, type: "twips" },
        left: { size: 50, type: "nil" },
      },
      rows: [{ cells: [{ children: [] }] }],
    });
    expect(result.margins).toBeDefined();
    expect(result.margins!.top).toEqual({ size: 100, type: "twips" });
    expect(result.margins!.left).toEqual({ size: 50, type: "nil" });
  });

  it("round-trips cell-level margins (w:tcMar), defaulting omitted type to DXA", () => {
    const result = roundTrip({
      rows: [
        {
          cells: [
            {
              children: [],
              margins: {
                top: { size: 80, type: "twips" },
                left: { size: 40 },
              },
            },
          ],
        },
      ],
    });
    const cell = (result.rows[0] as TableRowOptions).cells[0] as TableCellOptions;
    expect(cell.margins).toBeDefined();
    expect(cell.margins!.top).toEqual({ size: 80, type: "twips" });
    expect(cell.margins!.left).toEqual({ size: 40, type: "twips" });
  });

  it("round-trips cell borders with full CT_Border attributes", () => {
    const result = roundTrip({
      rows: [
        {
          cells: [
            {
              children: [],
              borders: {
                top: {
                  style: "single",
                  color: "FF0000",
                  size: 4,
                  space: 8,
                  themeColor: "text1",
                  themeTint: "99",
                  themeShade: "80",
                  shadow: true,
                  frame: true,
                },
              },
            },
          ],
        },
      ],
    });
    const cell = (result.rows[0] as TableRowOptions).cells[0] as TableCellOptions;
    expect(cell.borders!.top).toMatchObject({
      style: "single",
      color: "FF0000",
      size: 4,
      space: 8,
      themeColor: "text1",
      themeTint: "99",
      themeShade: "80",
      shadow: true,
      frame: true,
    });
  });

  it("round-trips table shading with theme fill attributes", () => {
    const result = roundTrip({
      shading: { type: "solid", fill: "FF0000", themeFill: "accent1", themeFillShade: "80" },
      rows: [{ cells: [{ children: [] }] }],
    });
    expect(result.shading).toMatchObject({
      type: "solid",
      fill: "FF0000",
      themeFill: "accent1",
      themeFillShade: "80",
    });
  });

  it("round-trips cell shading with theme color attributes", () => {
    const result = roundTrip({
      rows: [
        {
          cells: [
            {
              children: [],
              shading: { type: "clear", color: "000000", themeColor: "text1", themeTint: "99" },
            },
          ],
        },
      ],
    });
    const cell = (result.rows[0] as TableRowOptions).cells[0] as TableCellOptions;
    expect(cell.shading).toMatchObject({
      type: "clear",
      color: "000000",
      themeColor: "text1",
      themeTint: "99",
    });
  });

  it("round-trips float.overlap (w:tblOverlap)", () => {
    const result = roundTrip({
      float: { horizontalAnchor: "margin", overlap: "never" },
      rows: [{ cells: [{ children: [] }] }],
    });
    expect(result.float).toBeDefined();
    expect(result.float!.overlap).toBe("never");
  });

  it("round-trips the 6 special-row flags via w:tblLook (CT_TblLook)", () => {
    const result = roundTrip({
      firstRow: true,
      lastCol: true,
      bandRow: true,
      rows: [{ cells: [{ children: [] }] }],
    });
    expect(result.firstRow).toBe(true);
    expect(result.lastCol).toBe(true);
    expect(result.bandRow).toBe(true);
  });

  it("emits w:tblLook with inverted banding polarity (noHBand = !bandRow)", () => {
    const xml = tableDesc.stringify(
      { bandRow: true, bandCol: false, rows: [{ cells: [{ children: [] }] }] },
      writeCtx,
    )!;
    expect(xml).toContain('w:noHBand="0"');
    expect(xml).toContain('w:noVBand="1"');
  });

  it("round-trips the legacy w:tblLook/@w:val hex bitmask alone (Word 2007)", () => {
    const xml =
      `<w:tbl xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:tblPr><w:tblLook w:val="04A0"/></w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="100"/></w:tblGrid>` +
      `<w:tr><w:tc><w:tcPr/><w:p/></w:tc></w:tr></w:tbl>`;
    const opts = tableDesc.parse(parseXml(xml).elements![0]!, readCtx) as TableOptions;
    expect(opts.tableLook).toEqual({ val: "04A0" });
    const out = tableDesc.stringify(opts, writeCtx)!;
    expect(out).toContain('<w:tblLook w:val="04A0"/>');
  });

  it("round-trips w:val alongside explicit tblLook booleans", () => {
    const result = roundTrip({
      firstRow: true,
      rows: [{ cells: [{ children: [] }] }],
      tableLook: { val: "04A0" },
    });
    expect(result.firstRow).toBe(true);
    expect(result.tableLook).toEqual({ val: "04A0" });
  });

  it("round-trips columnWidthsRevision (w:tblGridChange)", () => {
    const result = roundTrip({
      columnWidths: [1000, 2000],
      columnWidthsRevision: { id: 7, columnWidths: [500, 600] },
      rows: [{ cells: [{ children: [] }, { children: [] }] }],
    });
    expect(result.columnWidths).toEqual([1000, 2000]);
    expect(result.columnWidthsRevision).toBeDefined();
    expect(result.columnWidthsRevision!.id).toBe(7);
    expect(result.columnWidthsRevision!.columnWidths).toEqual([500, 600]);
  });

  it("round-trips row propertyExceptions (w:tblPrEx) with nested tblPrExChange", () => {
    const result = roundTrip({
      rows: [
        {
          propertyExceptions: {
            width: { size: 100, type: "twips" },
            alignment: "center",
            cellSpacing: { size: 20, type: "twips" },
            tblPrExChange: {
              id: 3,
              author: "E",
              date: "2024-05-05T00:00:00Z",
              width: { size: 50, type: "twips" },
            },
          },
          cells: [{ children: [] }],
        },
      ],
    });
    const row = result.rows[0] as TableRowOptions;
    expect(row.propertyExceptions).toBeDefined();
    expect(row.propertyExceptions!.width).toEqual({ size: 100, type: "twips" });
    expect(row.propertyExceptions!.alignment).toBe("center");
    expect(row.propertyExceptions!.tblPrExChange).toBeDefined();
    expect(row.propertyExceptions!.tblPrExChange!.id).toBe(3);
    expect(row.propertyExceptions!.tblPrExChange!.author).toBe("E");
    expect(row.propertyExceptions!.tblPrExChange!.width).toEqual({ size: 50, type: "twips" });
  });

  it("round-trips tcPr with co-occurring hMerge/noWrap/fitText/verticalAlign (CT_TcPrBase order)", () => {
    const result = roundTrip({
      rows: [
        {
          cells: [
            {
              children: [],
              horizontalMerge: "restart",
              noWrap: true,
              fitText: true,
              verticalAlign: "center",
              borders: { top: { style: "single" } },
            },
          ],
        },
      ],
    });
    const cell = (result.rows[0] as TableRowOptions).cells[0] as TableCellOptions;
    expect(cell.horizontalMerge).toBe("restart");
    expect(cell.noWrap).toBe(true);
    expect(cell.fitText).toBe(true);
    expect(cell.verticalAlign).toBe("center");
    expect(cell.borders!.top!.style).toBe("single");
  });

  it("round-trips tblPr with cellSpacing between jc and tblInd (CT_TblPrBase order)", () => {
    const result = roundTrip({
      width: { size: 5000, type: "twips" },
      alignment: "center",
      cellSpacing: { size: 30, type: "twips" },
      indent: { size: 200, type: "twips" },
      rows: [{ cells: [{ children: [] }] }],
    });
    expect(result.alignment).toBe("center");
    expect(result.cellSpacing).toEqual({ size: 30, type: "twips" });
    expect(result.indent).toEqual({ size: 200, type: "twips" });
  });

  it("round-trips cell insideH/insideV borders (CT_TcBorders)", () => {
    const result = roundTrip({
      rows: [
        {
          cells: [
            {
              children: [],
              borders: {
                insideHorizontal: { style: "single", color: "0000FF" },
                insideVertical: { style: "single", color: "00FF00" },
              },
            },
          ],
        },
      ],
    });
    const cell = (result.rows[0] as TableRowOptions).cells[0] as TableCellOptions;
    expect(cell.borders!.insideHorizontal).toBeDefined();
    expect(cell.borders!.insideHorizontal!.color).toBe("0000FF");
    expect(cell.borders!.insideVertical).toBeDefined();
    expect(cell.borders!.insideVertical!.color).toBe("00FF00");
  });

  it("round-trips row cnfStyle with full CT_Cnf position attrs (no invented 'changed')", () => {
    const result = roundTrip({
      rows: [
        {
          cnfStyle: {
            val: "100000000000",
            firstRow: true,
            firstColumn: true,
            evenHBand: true,
            firstRowLastColumn: true,
          },
          cells: [{ children: [] }],
        },
      ],
    });
    const row = result.rows[0] as TableRowOptions;
    expect(row.cnfStyle).toBeDefined();
    expect(row.cnfStyle!.val).toBe("100000000000");
    expect(row.cnfStyle!.firstRow).toBe(true);
    expect(row.cnfStyle!.firstColumn).toBe(true);
    expect(row.cnfStyle!.evenHBand).toBe(true);
    expect(row.cnfStyle!.firstRowLastColumn).toBe(true);
    expect(row.cnfStyle).not.toHaveProperty("changed");
  });

  it("round-trips cell-level cnfStyle (CT_TcPr/cnfStyle)", () => {
    const result = roundTrip({
      rows: [
        {
          cells: [{ children: [], cnfStyle: { val: "000000000001", lastColumn: true } }],
        },
      ],
    });
    const cell = (result.rows[0] as TableRowOptions).cells[0] as TableCellOptions;
    expect(cell.cnfStyle).toBeDefined();
    expect(cell.cnfStyle!.val).toBe("000000000001");
    expect(cell.cnfStyle!.lastColumn).toBe(true);
  });

  it("does not inflate trHeight hRule when not specified", () => {
    const result = roundTrip({
      rows: [{ height: { value: 400 }, cells: [{ children: [] }] }],
    });
    const row = result.rows[0] as TableRowOptions;
    expect(row.height).toBeDefined();
    expect(row.height!.value).toBe(400);
    expect(row.height!.rule).toBeUndefined();
  });

  it("echoes stringify default tcW type rather than inflating to dxa", () => {
    const result = roundTrip({
      rows: [{ cells: [{ children: [], width: { size: 1000 } }] }],
    });
    const cell = (result.rows[0] as TableRowOptions).cells[0] as TableCellOptions;
    // stringify injects type=auto (ST_TblWidthType default); parse echoes it,
    // not the old hard-coded "dxa".
    expect(cell.width).toEqual({ size: 1000, type: "auto" });
  });
});

describe("table cell block-level children (EG_BlockLevelElts)", () => {
  it("parses a block sdt inside a cell (cover-page dataBinding form)", () => {
    // Real shape from the SDK corpus: w:tc > w:sdt > w:sdtContent > w:p. The
    // cell parser must hand every non-tcPr child to the section-child parser
    // and keep the result in order — the stub marks what it received.
    const seen: string[] = [];
    setTableParseChild((el) => {
      const name = el.name ?? "unknown";
      seen.push(name);
      if (name === "w:sdt") return { sdt: { properties: { alias: "stub" } } };
      return { paragraph: {} };
    });
    const xml =
      `<w:tbl xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:tr><w:tc><w:p/><w:sdt><w:sdtPr><w:alias w:val="Company"/></w:sdtPr>` +
      `<w:sdtContent><w:p><w:r><w:t>Microsoft</w:t></w:r></w:p></w:sdtContent></w:sdt></w:tc></w:tr></w:tbl>`;
    const opts = tableDesc.parse(parseXml(xml).elements![0]!, readCtx) as TableOptions;
    expect(seen).toEqual(["w:p", "w:sdt"]);
    const cell = (opts.rows[0] as TableRowOptions).cells[0] as TableCellOptions;
    expect(cell.children).toHaveLength(2);
    expect(cell.children[1]).toEqual({ sdt: { properties: { alias: "stub" } } });
    // restore the suite-wide stub
    setTableParseChild(() => ({ paragraph: {} }));
  });

  it("emits non-paragraph cell children via the context's child dispatcher", () => {
    const writeCtxWithMarker = {
      ...writeCtx,
      stringifyChild: (child: unknown) =>
        "sdt" in (child as Record<string, unknown>) ? "<w:sdt-mark/>" : "<w:p/>",
    } as unknown as BodyContext;
    const xml = tableDesc.stringify(
      {
        rows: [
          {
            cells: [
              {
                children: [
                  { paragraph: "lead" },
                  { sdt: { properties: { alias: "Company" }, children: [] } },
                ],
              },
            ],
          },
        ],
      } as TableOptions,
      writeCtxWithMarker,
    )!;
    expect(xml).toContain("<w:sdt-mark/>");
    // A cell ending in a block container does not get an injected <w:p/>
    expect(xml).not.toMatch(/<w:sdt-mark\/><w:p\/>/);
  });
});
