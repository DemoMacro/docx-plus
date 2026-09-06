import { unzipSync, zipSync } from "@office-open/core";
import type { WorkbookOptions } from "@parts/file";
import { describe, expect, it } from "vite-plus/test";

import { generateWorkbook } from "./generate";
import { parseWorkbookSync } from "./parse";

// Full-file round-trip: generateWorkbook → Buffer → parseWorkbook → WorkbookOptions.
// Proves the three previously-deferred parse gaps are resolved on the read path.

async function roundTrip(opts: WorkbookOptions): Promise<WorkbookOptions> {
  const buf = (await generateWorkbook(opts, { type: "uint8array" })) as Uint8Array;
  return parseWorkbookSync(buf);
}

describe("parseWorkbook round-trip", () => {
  it("emits the shared strings relationship only when the part exists", async () => {
    const withoutStrings = (await generateWorkbook(
      { worksheets: [{ rows: [{ cells: [{ value: 1 }] }] }] },
      { type: "uint8array" },
    )) as Uint8Array;
    const withoutArchive = unzipSync(withoutStrings);
    const withoutRels = new TextDecoder().decode(withoutArchive["xl/_rels/workbook.xml.rels"]!);
    expect(withoutArchive["xl/sharedStrings.xml"]).toBeUndefined();
    expect(withoutRels).not.toContain("/sharedStrings");

    const withStrings = (await generateWorkbook(
      { worksheets: [{ rows: [{ cells: [{ value: "text" }] }] }] },
      { type: "uint8array" },
    )) as Uint8Array;
    const withArchive = unzipSync(withStrings);
    const withRels = new TextDecoder().decode(withArchive["xl/_rels/workbook.xml.rels"]!);
    expect(withArchive["xl/sharedStrings.xml"]).toBeDefined();
    expect(withRels).toContain("/sharedStrings");
  });

  it("round-trips pivot table page filters", async () => {
    const opts: WorkbookOptions = {
      worksheets: [
        {
          name: "Data",
          rows: [
            { cells: [{ value: "City" }, { value: "Year" }, { value: "Revenue" }] },
            { cells: [{ value: "Beijing" }, { value: 2023 }, { value: 320 }] },
            { cells: [{ value: "Shanghai" }, { value: 2024 }, { value: 580 }] },
          ],
        },
        {
          name: "Pivot",
          rows: [],
          pivotTables: [
            {
              source: "A1:C3",
              sourceSheet: "Data",
              rows: ["City"],
              pages: [{ field: "Year", item: 1 }],
              data: [{ field: "Revenue", summarize: "sum", name: "Revenue total" }],
            },
          ],
        },
      ],
    };

    const buf = (await generateWorkbook(opts, { type: "uint8array" })) as Uint8Array;
    const archive = unzipSync(buf);
    // The authored pivot table survives as a verbatim passthrough part — the
    // lossy authoring projection (rows/pages) is not re-derived on parse.
    const pivotXml = new TextDecoder().decode(archive["xl/pivotTables/pivotTable1.xml"]!);
    expect(pivotXml).toContain('<pageFields count="1">');
    expect(pivotXml).toContain('<pageField fld="1" hier="0" item="1"/>');
    const reparsed = parseWorkbookSync(buf);
    expect(reparsed.worksheets).toHaveLength(2);
  });

  it("adopts the style table so cells keep raw indices and their formatting", async () => {
    // Two cells with distinct styles. Parse exposes the style table sections
    // (fonts/fills/borders/cellXfs) alongside the cells; cells carry raw
    // cellXfs indices that resolve against that table — the SDK's Stylesheet
    // model — so a re-generate keeps the source's own numbering.
    const opts: WorkbookOptions = {
      worksheets: [
        {
          name: "S",
          rows: [
            {
              cells: [
                {
                  reference: "A1",
                  value: "bold",
                  style: { font: { bold: true } },
                },
                {
                  reference: "A2",
                  value: "italic",
                  style: { font: { italic: true } },
                },
              ],
            },
          ],
        },
      ],
    };

    const parsed = await roundTrip(opts);
    const rows = parsed.worksheets![0]!.rows!;
    const a1 = rows[0]!.cells![0]!;
    const a2 = rows[0]!.cells![1]!;

    // Raw indices plus the table they resolve against.
    expect(typeof a1.style).toBe("number");
    expect(typeof a2.style).toBe("number");
    expect(parsed.cellXfs).toBeDefined();
    expect(parsed.fonts).toBeDefined();
    expect(parsed.fonts![parsed.cellXfs![a1.style as number]!.fontId!]!.bold).toBe(true);
    expect(parsed.fonts![parsed.cellXfs![a2.style as number]!.fontId!]!.italic).toBe(true);

    // And the formatting survives a second generate→parse cycle intact.
    const reparsed = await roundTrip(parsed);
    const r2 = reparsed.worksheets![0]!.rows![0]!.cells!;
    const b1 = r2[0]!;
    const b2 = r2[1]!;
    expect(typeof b1.style).toBe("number");
    expect(typeof b2.style).toBe("number");
    expect(reparsed.fonts![reparsed.cellXfs![b1.style as number]!.fontId!]!.bold).toBe(true);
    expect(reparsed.fonts![reparsed.cellXfs![b2.style as number]!.fontId!]!.italic).toBe(true);
  });

  it("round-trips dxfs from options through the workbook", async () => {
    const opts: WorkbookOptions = {
      dxfs: [{ font: { bold: true } }, { fill: { color: "FF0000", patternType: "solid" } }],
      worksheets: [{ name: "S", rows: [{ cells: [{ value: 1 }] }] }],
    };

    const parsed = await roundTrip(opts);
    expect(parsed.dxfs).toBeDefined();
    expect(parsed.dxfs).toHaveLength(2);
  });

  it("keeps built-in numFmt ids so date cells keep their format", async () => {
    // numFmt "mm-dd-yy" registers as built-in id 14 (no custom <numFmts>
    // entry). The adopted cellXfs entry carries numFmtId 14 verbatim, so the
    // round-tripped cell keeps its date format without a table rewrite.
    const opts: WorkbookOptions = {
      worksheets: [
        {
          name: "S",
          rows: [{ cells: [{ reference: "A1", value: 45658, style: { numFmt: "mm-dd-yy" } }] }],
        },
      ],
    };

    const parsed = await roundTrip(opts);
    const cell = parsed.worksheets![0]!.rows![0]!.cells![0]!;
    expect(typeof cell.style).toBe("number");
    expect(parsed.cellXfs![cell.style as number]!.numFmtId).toBe(14);
  });

  it("round-trips row outline level, collapsed flag, and row style", async () => {
    const opts: WorkbookOptions = {
      worksheets: [
        {
          name: "S",
          rows: [
            { rowNumber: 1, cells: [{ value: "group" }] },
            {
              rowNumber: 2,
              cells: [{ value: "detail" }],
              outlineLevel: 1,
              collapsed: true,
              style: { font: { bold: true } },
            },
          ],
        },
      ],
    };

    const parsed = await roundTrip(opts);
    const row = parsed.worksheets![0]!.rows![1]!;
    expect(row.outlineLevel).toBe(1);
    expect(row.collapsed).toBe(true);
    expect(typeof row.style).toBe("number");
    expect(parsed.fonts![parsed.cellXfs![row.style as number]!.fontId!]!.bold).toBe(true);
  });

  it("reads the external link target from the sibling rels file", async () => {
    const opts: WorkbookOptions = {
      externalLinks: [
        {
          externalBook: {
            target: "external/source.xlsx",
            sheetNames: ["Sheet1"],
          },
        },
      ],
      worksheets: [{ name: "S", rows: [{ cells: [{ value: 1 }] }] }],
    };

    const parsed = await roundTrip(opts);
    expect(parsed.externalLinks).toBeDefined();
    expect(parsed.externalLinks).toHaveLength(1);
    // The target lives in xl/externalLinks/_rels/externalLink1.xml.rels, not in
    // the externalLink XML body — this asserts the rels file is actually read.
    expect(parsed.externalLinks![0]?.externalBook?.target).toBe("external/source.xlsx");
  });

  it("round-trips sheet-view selection, pivotSelection, and cell smart tags", async () => {
    const opts: WorkbookOptions = {
      worksheets: [
        {
          name: "S",
          rows: [{ cells: [{ reference: "A1", value: 1 }] }],
          selection: [{ activeCell: "B2", sqref: "B2" }],
          pivotSelection: {
            axis: "axisRow",
            activeRow: 1,
            count: 1,
            pivotArea: { type: "normal", outline: true },
          },
          smartTags: [
            {
              reference: "A1",
              smartTags: [
                {
                  type: 0,
                  xmlBased: true,
                  properties: [{ key: "urn:schemas-company:stock", val: "FIN" }],
                },
              ],
            },
          ],
        },
      ],
    };

    const parsed = await roundTrip(opts);
    const sheet = parsed.worksheets![0]!;
    expect(sheet.selection?.[0]).toMatchObject({ activeCell: "B2", sqref: "B2" });
    expect(sheet.pivotSelection).toMatchObject({ axis: "axisRow", activeRow: 1, count: 1 });
    expect(sheet.pivotSelection!.pivotArea).toMatchObject({ type: "normal" });
    expect(sheet.smartTags).toHaveLength(1);
    expect(sheet.smartTags![0]).toMatchObject({ reference: "A1" });
    expect(sheet.smartTags![0]!.smartTags[0]).toMatchObject({ type: 0, xmlBased: true });
    expect(sheet.smartTags![0]!.smartTags[0]!.properties![0]).toEqual({
      key: "urn:schemas-company:stock",
      val: "FIN",
    });
  });

  it("round-trips the sheet background picture", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const opts: WorkbookOptions = {
      worksheets: [
        {
          name: "BG",
          rows: [{ cells: [{ value: "x" }] }],
          backgroundImage: { data: bytes, type: "png" },
        },
      ],
    };

    const parsed = await roundTrip(opts);
    const bg = parsed.worksheets![0]!.backgroundImage;
    expect(bg?.type).toBe("png");
    expect(new Uint8Array(bg!.data as Uint8Array)).toEqual(bytes);
  });
});

describe("metadata round-trip", () => {
  it("round-trips the metadata part and cell cm/vm references", async () => {
    const opts: WorkbookOptions = {
      worksheets: [
        {
          name: "S",
          rows: [
            {
              cells: [{ reference: "A1", value: "x", cellMetadataId: 1, valueMetadataId: 1 }],
            },
          ],
        },
      ],
      metadata: {
        types: [{ name: "XLDAPROPERTY", minSupportedVersion: 1 }],
        strings: [{ value: "s1" }],
        futureMetadata: [{ name: "XLDAPROPERTY", blocks: [{}] }],
        cellMetadata: [{ records: [{ typeIndex: 0, valueIndex: 0 }] }],
        valueMetadata: [{ records: [{ typeIndex: 0, valueIndex: 0 }] }],
      },
    };

    const parsed = await roundTrip(opts);
    expect(parsed.metadata?.types![0]).toMatchObject({
      name: "XLDAPROPERTY",
      minSupportedVersion: 1,
    });
    expect(parsed.metadata?.futureMetadata![0]).toMatchObject({ name: "XLDAPROPERTY" });
    expect(parsed.metadata?.cellMetadata![0]!.records).toEqual([{ typeIndex: 0, valueIndex: 0 }]);
    const cell = parsed.worksheets![0]!.rows![0]!.cells![0]!;
    expect(cell.cellMetadataId).toBe(1);
    expect(cell.valueMetadataId).toBe(1);
  });
});

describe("xml mapping round-trip", () => {
  it("round-trips xmlMaps and per-sheet single-cell XML tables", async () => {
    const opts: WorkbookOptions = {
      worksheets: [
        {
          name: "S",
          rows: [{ cells: [{ reference: "A1", value: "x" }] }],
          singleXmlCells: [
            {
              id: 1,
              reference: "B2",
              connectionId: 1,
              properties: {
                id: 1,
                mapping: { mapId: 1, xpath: "/root/name", xmlDataType: "string" },
              },
            },
          ],
        },
      ],
      xmlMaps: {
        selectionNamespaces: 'xmlns:m="http://example.com"',
        schemas: [{ id: "S1", namespace: "http://example.com" }],
        maps: [{ id: 1, name: "M1", rootElement: "root", schemaId: "S1" }],
      },
    };

    const parsed = await roundTrip(opts);
    expect(parsed.xmlMaps?.selectionNamespaces).toBe('xmlns:m="http://example.com"');
    expect(parsed.xmlMaps?.schemas![0]).toMatchObject({ id: "S1" });
    expect(parsed.xmlMaps?.maps![0]).toMatchObject({ id: 1, name: "M1", rootElement: "root" });
    const cell = parsed.worksheets![0]!.singleXmlCells![0]!;
    expect(cell).toMatchObject({ id: 1, reference: "B2", connectionId: 1 });
    expect(cell.properties.mapping).toMatchObject({ mapId: 1, xpath: "/root/name" });
  });
});

describe("dialogsheet round-trip", () => {
  it("round-trips a legacy dialog sheet with protection and page setup", async () => {
    const opts: WorkbookOptions = {
      worksheets: [{ name: "S", rows: [{ cells: [{ value: 1 }] }] }],
      dialogsheets: [
        {
          name: "Dialog1",
          tabColor: "FF404040",
          codeName: "Dialog1",
          sheetProtection: { objects: true },
          pageMargins: { left: 0.5 },
          pageSetup: { paperSize: 9, orientation: "portrait" },
        },
      ],
    };

    const parsed = await roundTrip(opts);
    const ds = parsed.dialogsheets![0]!;
    expect(ds.tabColor).toBe("FF404040");
    expect(ds.codeName).toBe("Dialog1");
    expect(ds.sheetProtection).toEqual({ objects: true });
    expect(ds.pageMargins?.left).toBe(0.5);
    expect(ds.pageSetup).toMatchObject({ paperSize: 9, orientation: "portrait" });
  });
});

describe("scattered attribute round-trip", () => {
  it("round-trips book-view visibility and conditional-format rule flags", async () => {
    const opts: WorkbookOptions = {
      worksheets: [
        {
          name: "S",
          rows: [{ cells: [{ reference: "A1", value: 5 }] }],
          conditionalFormats: [
            {
              sqref: "A1:A5",
              rules: [
                { type: "aboveAverage", aboveAverage: false, stdDev: 2, dxfId: 0 },
                { type: "top10", rank: 5 },
              ],
            },
          ],
          protectedRanges: [{ sqref: "A1:A5", name: "Guarded", securityDescriptor: "O=ORG" }],
        },
      ],
    };

    const parsed = await roundTrip(opts);
    const sheet = parsed.worksheets![0]!;
    expect(sheet.conditionalFormats![0]!.rules[0]).toMatchObject({
      type: "aboveAverage",
      aboveAverage: false,
      stdDev: 2,
    });
    expect(sheet.protectedRanges![0]).toMatchObject({
      name: "Guarded",
      securityDescriptor: "O=ORG",
    });
  });
});

describe("theme round-trip", () => {
  it("preserves a custom source theme instead of replacing it with the default", async () => {
    const opts: WorkbookOptions = {
      worksheets: [{ name: "S", rows: [{ cells: [{ reference: "A1", value: 1 }] }] }],
    };
    const buffer = (await generateWorkbook(opts, { type: "uint8array" })) as Uint8Array;

    // Inject a custom theme color (accent1 = FF00FF) into the generated package.
    const unzipped = unzipSync(buffer);
    const themeEntry = unzipped["xl/theme/theme1.xml"];
    if (!themeEntry) throw new Error("missing xl/theme/theme1.xml");
    const themeXml = new TextDecoder().decode(themeEntry);
    const mutated = themeXml.replace(/(<a:accent1>\s*<a:srgbClr val=")[0-9A-Fa-f]{6}/, "$1FF00FF");
    if (mutated === themeXml) throw new Error("accent1 srgbClr not found in theme");
    unzipped["xl/theme/theme1.xml"] = new TextEncoder().encode(mutated);
    const reborn = zipSync(unzipped);

    const parsed = parseWorkbookSync(reborn);
    expect(parsed.theme?.colorScheme?.accent1).to.exist;

    const regenerated = (await generateWorkbook(parsed, { type: "uint8array" })) as Uint8Array;
    const regTheme = new TextDecoder().decode(unzipSync(regenerated)["xl/theme/theme1.xml"]!);
    expect(regTheme.toLowerCase()).to.contain('val="ff00ff"');
  });
});
