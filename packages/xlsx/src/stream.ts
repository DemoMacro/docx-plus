/**
 * Streaming XLSX compilation — writes parts into a {@link ZipStreamWriter} as
 * they are produced instead of building the complete Zippable map first.
 *
 * The worksheet part (the only one that grows without bound) is serialized
 * row-chunk-wise through the shared `appendSheetDataRows`, so the full
 * worksheet XML string, its encoded bytes, and the archive buffer never
 * coexist. String cells use `t="inlineStr"` (sharedStrings omitted) — the
 * documented Excel feature every constant-memory writer uses — because SST
 * indices would have to be known before the first row is written.
 *
 * Non-worksheet parts are small and come from the same descriptors as the
 * regular compile path, so their XML cannot drift.
 *
 * {@link generateWorkbookStream} routes plain-data workbooks here via
 * {@link canStreamWorkbook} and falls back to the full-memory stream for
 * anything richer — the fallback loses constant memory, not content.
 *
 * @module
 */

import {
  RELATIONSHIP_TYPES,
  Relationships,
  ZipStreamWriter,
  appPropertiesDesc,
  buildCorePropertiesXmlString,
  buildRootRelationships,
  contentTypesDesc,
  customPropertiesDesc,
  deriveContentTypes,
  resolverFromRegistry,
  XLSX_PARTS,
  ZIP_DEFLATE_LEVEL,
  type CompressionOptions,
} from "@office-open/core";
import { OOXML_XML_DECLARATION } from "@office-open/xml";
import type { WorkbookOptions } from "@parts/file";
import { stylesDesc } from "@parts/styles";
import { createThemeXml } from "@parts/theme";
import { buildVolTypesXml } from "@parts/vol-types";
import { workbookDesc } from "@parts/workbook";
import type { SheetDefinition } from "@parts/workbook";
import type { RowOptions } from "@parts/worksheet";
import { appendSheetDataRows } from "@parts/worksheet/stringify";
import { columnToLetter } from "@util/index";

import { XlsxWriteContext } from "./context";

/** Rows per serialization flush — bounds the intermediate chunk size. */
const ROWS_PER_CHUNK = 5_000;

const XLSX_CONTENT_TYPE_RESOLVER = resolverFromRegistry(XLSX_PARTS);

/** Workbook keys this path serializes. Anything else falls back to full compile. */
const WORKBOOK_KEYS: ReadonlySet<string> = new Set([
  // core properties (CorePropertiesOptions)
  "title",
  "subject",
  "creator",
  "keywords",
  "description",
  "lastModifiedBy",
  "revision",
  "lastPrinted",
  "created",
  "modified",
  // workbook content this path emits
  "worksheets",
  "appProperties",
  "customProperties",
  "workbookProtection",
  "definedNames",
  "fileRecovery",
  "functionGroups",
  "webPublishing",
  "fileSharing",
  "volTypes",
]);

/** Worksheet keys this path serializes. Anything else falls back to full compile. */
const WORKSHEET_KEYS: ReadonlySet<string> = new Set(["name", "rows", "dimension"]);

/**
 * Whether {@link streamWorkbook} covers every feature this options tree uses.
 * Unknown keys (including fields added after this list was written) answer
 * `false`, so the caller falls back to the full compile path — the failure
 * mode is losing constant memory, never losing content.
 */
export function canStreamWorkbook(options: WorkbookOptions): boolean {
  for (const key of Object.keys(options)) {
    if (!WORKBOOK_KEYS.has(key)) return false;
  }
  for (const ws of options.worksheets ?? []) {
    for (const key of Object.keys(ws)) {
      if (!WORKSHEET_KEYS.has(key)) return false;
    }
  }
  return true;
}

/**
 * Compile a plain-data workbook into streaming ZIP output. Callers must gate
 * on {@link canStreamWorkbook} — this path silently omits parts for features
 * outside its subset.
 */
export function streamWorkbook(
  options: WorkbookOptions,
  ondata: (err: Error | null, chunk: Uint8Array, final: boolean) => void,
  compression: CompressionOptions = {},
): void {
  const xmlLevel = compression.xml ?? ZIP_DEFLATE_LEVEL;
  const ctx = new XlsxWriteContext();
  const encoder = new TextEncoder();
  const writer = new ZipStreamWriter(ondata, xmlLevel);

  const worksheets = options.worksheets ?? [];
  const sheetPaths = worksheets.map((_, i) => `xl/worksheets/sheet${i + 1}.xml`);
  const hasCustomProperties = !!options.customProperties?.length;
  const hasVolTypes = !!(options.volTypes && options.volTypes.length > 0);

  // [Content_Types].xml leads per OPC; its part list is deterministic from
  // the options (this path emits a fixed part set).
  const partPaths = [
    "[Content_Types].xml",
    "_rels/.rels",
    "docProps/core.xml",
    "docProps/app.xml",
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "xl/styles.xml",
    "xl/theme/theme1.xml",
    ...sheetPaths,
  ];
  if (hasCustomProperties) partPaths.push("docProps/custom.xml");
  if (hasVolTypes) partPaths.push("xl/volTypes.xml");

  const writeString = (path: string, xml: string): void => {
    const sink = writer.addPart(path, xmlLevel);
    sink.push(encoder.encode(xml));
    sink.end();
  };

  writeString(
    "[Content_Types].xml",
    OOXML_XML_DECLARATION +
      (contentTypesDesc.stringify(
        deriveContentTypes(partPaths, {
          resolve: XLSX_CONTENT_TYPE_RESOLVER,
          // This path emits no media parts, so there is nothing to resolve.
          mediaContentTypes: {},
        }),
        ctx,
      ) ?? ""),
  );
  writeString(
    "_rels/.rels",
    OOXML_XML_DECLARATION +
      buildRootRelationships(
        "xl/workbook.xml",
        hasCustomProperties,
        options.passthroughRelationships,
      ).serialize(),
  );
  writeString("docProps/core.xml", OOXML_XML_DECLARATION + buildCorePropertiesXmlString(options));
  writeString(
    "docProps/app.xml",
    OOXML_XML_DECLARATION + (appPropertiesDesc.stringify(options.appProperties ?? {}, ctx) ?? ""),
  );
  if (hasCustomProperties) {
    writeString(
      "docProps/custom.xml",
      OOXML_XML_DECLARATION +
        (customPropertiesDesc.stringify({ properties: options.customProperties ?? [] }, ctx) ?? ""),
    );
  }

  // Workbook + its rels — the sheet list is known up front.
  const sheets: SheetDefinition[] = worksheets.map((ws, i) => ({
    name: ws.name ?? `Sheet${i + 1}`,
    sheetId: ws.sheetId ?? i + 1,
    state: ws.state,
    rId: `rId${i + 1}`,
  }));
  writeString(
    "xl/workbook.xml",
    OOXML_XML_DECLARATION +
      (workbookDesc.stringify(
        {
          sheets,
          protection: options.workbookProtection,
          definedNames: options.definedNames,
          fileRecovery: options.fileRecovery,
          functionGroups: options.functionGroups,
          webPublishing: options.webPublishing,
          fileSharing: options.fileSharing,
        },
        ctx,
      ) ?? ""),
  );
  // Volatile function types live in their own part (never a workbook child)
  if (hasVolTypes) {
    writeString(
      "xl/volTypes.xml",
      OOXML_XML_DECLARATION + buildVolTypesXml(options.volTypes ?? []),
    );
  }
  const wbRels = new Relationships();
  let rid = 1;
  for (let i = 0; i < sheets.length; i++) {
    wbRels.addRelationship(rid++, RELATIONSHIP_TYPES.worksheet, `worksheets/sheet${i + 1}.xml`);
  }
  wbRels.addRelationship(rid++, RELATIONSHIP_TYPES.styles, "styles.xml");
  wbRels.addRelationship(rid++, RELATIONSHIP_TYPES.theme, "theme/theme1.xml");
  if (hasVolTypes) {
    wbRels.addRelationship(rid++, RELATIONSHIP_TYPES.volTypes, "volTypes.xml");
  }
  writeString("xl/_rels/workbook.xml.rels", OOXML_XML_DECLARATION + wbRels.serialize());

  // Worksheets — the streaming core. Cells serialize with sharedStrings
  // undefined, so string cells emit t="inlineStr" and no SST part is written.
  for (const [i, ws] of worksheets.entries()) {
    const rows = ws.rows ?? [];
    const sink = writer.addPart(sheetPaths[i]!, xmlLevel);
    sink.push(
      encoder.encode(
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
          ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      ),
    );
    const dimRef = ws.dimension ?? sheetDimension(rows);
    if (dimRef) sink.push(encoder.encode(`<dimension ref="${dimRef}"/>`));
    sink.push(encoder.encode("<sheetData>"));

    const buf: string[] = [];
    for (let start = 0; start < rows.length; start += ROWS_PER_CHUNK) {
      appendSheetDataRows(
        rows.slice(start, start + ROWS_PER_CHUNK),
        buf,
        undefined,
        ctx.styles,
        start + 1,
      );
      sink.push(encoder.encode(buf.join("")));
      buf.length = 0;
    }
    sink.push(encoder.encode("</sheetData></worksheet>"));
    sink.end();
  }

  // Styles last per sheet order — cell.style registrations are complete.
  writeString(
    "xl/styles.xml",
    OOXML_XML_DECLARATION + (stylesDesc.stringify({ styles: ctx.styles }, ctx) ?? ""),
  );
  writeString("xl/theme/theme1.xml", OOXML_XML_DECLARATION + createThemeXml());

  writer.end();
}

/** Used-range ref (`A1:xxN`) from the row list; empty when there are no cells. */
function sheetDimension(rows: RowOptions[]): string | undefined {
  const maxRow = rows.length;
  let maxCol = 0;
  for (const row of rows) {
    if (row.cells && row.cells.length > maxCol) maxCol = row.cells.length;
  }
  return maxRow > 0 && maxCol > 0 ? `A1:${columnToLetter(maxCol)}${maxRow}` : undefined;
}
