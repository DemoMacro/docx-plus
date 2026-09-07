/**
 * Worksheet pivot compile phase: pivot cache definitions/records, pivot
 * table parts with their relationships, and the rendered pivot grid
 * spliced into the sheet's sheetData.
 *
 * @module
 */

import { RELATIONSHIP_TYPES, Relationships } from "@office-open/core";
import { OOXML_XML_DECLARATION } from "@office-open/xml";
import type { PivotSourceData, PivotTableOptions } from "@parts/pivot";
import { aggregate, profilePivotFields } from "@parts/pivot";
import { pivotCacheDefDesc, pivotCacheRecordsDesc } from "@parts/pivot-cache";
import { pivotTableDesc } from "@parts/pivot-table";
import type { SharedStrings } from "@parts/shared-strings";
import type { RowOptions, WorksheetOptions } from "@parts/worksheet";
import { columnToLetter, parseA1Cell } from "@util/index";

import type { WorksheetCompileState } from "../compiler";
import { XlsxWriteContext } from "../context";

const XML_DECL = OOXML_XML_DECLARATION;

/** Compile a sheet's pivot tables: cache parts (deduped by source reference),
 * pivot table parts with their rels, workbook-level cache registration, and
 * the worksheet rel entry. Rendering the grid into sheetData happens later
 * via renderPivotSheetData (it must run after the sheet XML is built). */
export function compileSheetPivots(
  wsOpts: WorksheetOptions,
  worksheetConfigs: WorksheetOptions[],
  ctx: XlsxWriteContext,
  mapping: Record<string, { data: string; path: string }>,
  state: WorksheetCompileState,
  wsRels: Relationships,
  sheetName: string,
): void {
  const pivotOpts = wsOpts.pivotTables ?? [];
  for (const pt of pivotOpts) {
    state.globalPivotIdx++;
    const pivotIdx = state.globalPivotIdx;

    // Extract source data from source sheet
    const sourceSheet = pt.sourceSheet ?? sheetName;
    const sourceWsIdx = findWorksheetIndex(worksheetConfigs, sourceSheet);
    if (sourceWsIdx === -1) continue;
    const sourceWs = worksheetConfigs[sourceWsIdx];
    if (!sourceWs) continue;

    const sourceRows = sourceWs.rows ?? [];
    const sourceData = extractPivotSourceData(sourceRows, pt.source);

    // Deduplicate pivot caches by source reference
    const cacheKey = `${sourceSheet}:${pt.source}`;
    let cacheId: number;
    let cacheIdx: number;
    const existing = state.pivotCacheDataMap.get(cacheKey);
    if (existing) {
      cacheId = existing.cacheId;
      cacheIdx = existing.cacheIdx;
    } else {
      state.globalPivotCacheIdx++;
      cacheIdx = state.globalPivotCacheIdx;
      cacheId = cacheIdx;
      state.pivotCacheDataMap.set(cacheKey, { cacheId, cacheIdx });

      // Generate pivotCacheDefinition
      const cacheDefRels = new Relationships();
      cacheDefRels.addRelationship(
        1,
        RELATIONSHIP_TYPES.pivotCacheRecords,
        "pivotCacheRecords1.xml",
      );

      const cacheDefXml =
        XML_DECL +
        pivotCacheDefDesc.stringify(
          {
            sourceRef: pt.source.split(":")[0] ? pt.source : "A1",
            sourceSheet,
            sourceData,
            recordsRid: "rId1",
          },
          ctx,
        );

      mapping[`PivotCacheDef${cacheIdx}`] = {
        data: cacheDefXml,
        path: `xl/pivotCache/pivotCacheDefinition${cacheIdx}.xml`,
      };
      mapping[`PivotCacheDefRels${cacheIdx}`] = {
        data: XML_DECL + cacheDefRels.serialize(),
        path: `xl/pivotCache/_rels/pivotCacheDefinition${cacheIdx}.xml.rels`,
      };

      // Generate pivotCacheRecords
      const cacheRecordsXml = XML_DECL + pivotCacheRecordsDesc.stringify({ sourceData }, ctx);
      mapping[`PivotCacheRecords${cacheIdx}`] = {
        data: cacheRecordsXml,
        path: `xl/pivotCache/pivotCacheRecords${cacheIdx}.xml`,
      };

      // Register in workbook
      const wbPivotRid = ctx.workbookRels.nextRelationshipId;
      ctx.workbookRels.addRelationship(
        wbPivotRid,
        RELATIONSHIP_TYPES.pivotCacheDefinition,
        `pivotCache/pivotCacheDefinition${cacheIdx}.xml`,
      );
      ctx.pivotCacheRefs.push({ cacheId, rId: `rId${wbPivotRid}` });
    }

    // Generate pivotTable
    const pivotTableXml =
      XML_DECL + pivotTableDesc.stringify({ options: pt, sourceData, cacheId }, ctx);
    mapping[`PivotTable${pivotIdx}`] = {
      data: pivotTableXml,
      path: `xl/pivotTables/pivotTable${pivotIdx}.xml`,
    };

    // pivotTable rels → cacheDefinition
    const ptRels = new Relationships();
    ptRels.addRelationship(
      1,
      RELATIONSHIP_TYPES.pivotCacheDefinition,
      `../pivotCache/pivotCacheDefinition${cacheIdx}.xml`,
    );
    mapping[`PivotTableRels${pivotIdx}`] = {
      data: XML_DECL + ptRels.serialize(),
      path: `xl/pivotTables/_rels/pivotTable${pivotIdx}.xml.rels`,
    };

    // Worksheet rels → pivotTable
    wsRels.add(RELATIONSHIP_TYPES.pivotTable, `../pivotTables/pivotTable${pivotIdx}.xml`);
  }
}

function extractPivotSourceData(rows: RowOptions[], sourceRef: string): PivotSourceData {
  const parts = sourceRef.split(":");
  const start = parseA1Cell(parts[0] ?? "");
  if (!start) {
    return { fieldNames: [], records: [] };
  }
  const end = parts[1] !== undefined ? parseA1Cell(parts[1]) : undefined;

  const startRow = start.row - 1;
  const endRow = (end?.row ?? start.row) - 1;
  const startCol = start.col - 1;
  const endCol = (end?.col ?? start.col) - 1;
  const colCount = endCol - startCol + 1;

  // First row is headers
  const headerRow = rows[startRow];
  const fieldNames: string[] = [];
  if (headerRow?.cells) {
    for (let c = startCol; c <= endCol && c < headerRow.cells.length; c++) {
      const hv = headerRow.cells[c]?.value;
      fieldNames.push(
        typeof hv === "string"
          ? hv
          : typeof hv === "number" || typeof hv === "boolean"
            ? String(hv)
            : `Col${c}`,
      );
    }
  }

  // Remaining rows are data
  const records: (string | number)[][] = [];
  for (let r = startRow + 1; r <= endRow; r++) {
    const row = rows[r];
    if (!row?.cells) continue;
    const record: (string | number)[] = [];
    for (let c = startCol; c <= endCol; c++) {
      const val = row.cells[c]?.value;
      if (typeof val === "number") {
        record.push(val);
      } else if (val instanceof Date) {
        record.push(val.getTime());
      } else {
        record.push(typeof val === "string" ? val : typeof val === "boolean" ? String(val) : "");
      }
    }
    if (record.length === colCount) {
      records.push(record);
    }
  }

  return { fieldNames, records };
}

/** Find a worksheet config by name, honoring the `Sheet${i+1}` default naming. */
function findWorksheetIndex(configs: WorksheetOptions[], name: string): number {
  for (let i = 0; i < configs.length; i++) {
    const ws = configs[i]!;
    if ((ws.name ?? `Sheet${i + 1}`) === name) return i;
  }
  return -1;
}

export function renderPivotSheetData(
  pivotOpts: PivotTableOptions[],
  worksheetConfigs: WorksheetOptions[],
  sharedStrings: SharedStrings,
  currentSheetName: string,
): { sheetData: string; dimensionRef: string } {
  const rowCells = new Map<number, string[]>();
  let maxRow = 0;
  let maxCol = 0;
  let minRow = Infinity;
  let minCol = Infinity;

  for (const pt of pivotOpts) {
    const location = pt.location ?? "A3";
    const loc = parseA1Cell(location);
    if (!loc) continue;

    const startCol = loc.col - 1;
    const startRow = loc.row;
    const rowFieldNames = pt.rows;
    const dataFields = pt.data;

    const sourceSheetName = pt.sourceSheet ?? currentSheetName;
    const sourceWsIdx = findWorksheetIndex(worksheetConfigs, sourceSheetName);
    if (sourceWsIdx === -1) continue;

    const sourceRows = worksheetConfigs[sourceWsIdx]?.rows ?? [];
    const sourceData = extractPivotSourceData(sourceRows, pt.source);
    if (sourceData.fieldNames.length === 0) continue;

    const fields = sourceData.fieldNames;
    const rowFieldIndices = rowFieldNames.map((n) => fields.indexOf(n));
    const dataFieldIndices = dataFields.map((df) => fields.indexOf(df.field));

    if (rowFieldIndices.some((idx) => idx === -1)) continue;
    if (dataFieldIndices.some((idx) => idx === -1)) continue;

    // Group records by row field values
    const groupMap = new Map<string, { keys: (string | number)[]; values: number[][] }>();
    for (const record of sourceData.records) {
      const groupKey = rowFieldIndices.map((fi) => String(record[fi])).join("|");
      let group = groupMap.get(groupKey);
      if (!group) {
        group = {
          keys: rowFieldIndices.map((fi) => {
            const v = record[fi];
            return typeof v === "string" || typeof v === "number" ? v : String(v ?? "");
          }),
          values: dataFieldIndices.map(() => []),
        };
        groupMap.set(groupKey, group);
      }
      for (const [di, fi] of dataFieldIndices.entries()) {
        const val = record[fi];
        if (typeof val === "number") {
          group.values[di]?.push(val);
        }
      }
    }

    // Column field info for cross-tab layout
    const colFieldNames = pt.columns ?? [];
    const colFieldIndices = colFieldNames.map((n) => fields.indexOf(n));

    const addCells = (rowIdx: number, cells: string[]) => {
      let arr = rowCells.get(rowIdx);
      if (!arr) {
        arr = [];
        rowCells.set(rowIdx, arr);
      }
      for (const c of cells) arr.push(c);
      minRow = Math.min(minRow, rowIdx);
      maxRow = Math.max(maxRow, rowIdx);
    };

    if (colFieldIndices.length > 0 && !colFieldIndices.some((idx) => idx === -1)) {
      // --- Cross-tab layout (with column fields) ---
      // Unique column values for the first column field
      const colUniqueVals = profilePivotFields(sourceData)[colFieldIndices[0] ?? 0]!.unique.map(
        (v) => (typeof v === "string" || typeof v === "number" ? String(v) : String(v ?? "")),
      );

      // Build cross-tab map: rowKey → colKey → aggregated values per data field
      const crossTabMap = new Map<
        string,
        { rowKeys: (string | number)[]; colData: Map<string, number[][]>; rowTotals: number[][] }
      >();
      for (const record of sourceData.records) {
        const rowKey = rowFieldIndices.map((fi) => String(record[fi])).join("|");
        const colKey = colFieldIndices.map((fi) => String(record[fi])).join("|");
        let entry = crossTabMap.get(rowKey);
        if (!entry) {
          entry = {
            rowKeys: rowFieldIndices.map((fi) => {
              const v = record[fi];
              return typeof v === "string" || typeof v === "number" ? v : String(v ?? "");
            }),
            colData: new Map(),
            rowTotals: dataFieldIndices.map(() => []),
          };
          crossTabMap.set(rowKey, entry);
        }
        let colValues = entry.colData.get(colKey);
        if (!colValues) {
          colValues = dataFieldIndices.map(() => []);
          entry.colData.set(colKey, colValues);
        }
        for (const [di, fi] of dataFieldIndices.entries()) {
          const val = record[fi];
          if (typeof val === "number") {
            colValues[di]?.push(val);
            entry.rowTotals[di]?.push(val);
          }
        }
      }

      // Column count: row fields + column unique values + 1 (grand total column)
      const numColVals = colUniqueVals.length;
      const totalCols = rowFieldNames.length + numColVals + 1;
      const endCol = startCol + totalCols - 1;
      minCol = Math.min(minCol, startCol);
      maxCol = Math.max(maxCol, endCol);

      // Header row: [rowFieldName(s), ...colUniqueVals, dataFieldName or "Grand Total"]
      const headerCells: string[] = [];
      for (const rfName of rowFieldNames) {
        const cellRef = colIndexToLetter(startCol + headerCells.length) + startRow;
        const strIdx = sharedStrings.register(rfName);
        headerCells.push(`<c r="${cellRef}" t="s"><v>${strIdx}</v></c>`);
      }
      for (const cv of colUniqueVals) {
        const cellRef = colIndexToLetter(startCol + headerCells.length) + startRow;
        const strIdx = sharedStrings.register(cv);
        headerCells.push(`<c r="${cellRef}" t="s"><v>${strIdx}</v></c>`);
      }
      // Last header cell: data field name (e.g., "Total Revenue")
      {
        const cellRef = colIndexToLetter(startCol + headerCells.length) + startRow;
        // Pivot layout requires at least one data field, so index 0 always exists.
        const df0 = dataFields[0]!;
        const subtotal = df0.summarize ?? "sum";
        const dfName = df0.name ?? `${subtotal === "sum" ? "Sum" : subtotal} of ${df0.field}`;
        const strIdx = sharedStrings.register(dfName);
        headerCells.push(`<c r="${cellRef}" t="s"><v>${strIdx}</v></c>`);
      }
      addCells(startRow, headerCells);

      // Data rows
      let currentRow = startRow + 1;
      for (const [, entry] of crossTabMap) {
        const cells: string[] = [];
        // Row label
        for (const [ri, rowKey] of entry.rowKeys.entries()) {
          const cellRef = colIndexToLetter(startCol + ri) + currentRow;
          const strIdx = sharedStrings.register(String(rowKey));
          cells.push(`<c r="${cellRef}" t="s"><v>${strIdx}</v></c>`);
        }
        // Column values for each unique column value
        for (const [ci, colKey] of colUniqueVals.entries()) {
          const colValues = entry.colData.get(colKey);
          const colOffset = rowFieldNames.length + ci;
          const cellRef = colIndexToLetter(startCol + colOffset) + currentRow;
          const subtotal = dataFields[0]!.summarize ?? "sum";
          const result = colValues ? aggregate(colValues[0] ?? [], subtotal) : 0;
          cells.push(`<c r="${cellRef}"><v>${result}</v></c>`);
        }
        // Row total (last column)
        {
          const colOffset = rowFieldNames.length + numColVals;
          const cellRef = colIndexToLetter(startCol + colOffset) + currentRow;
          const subtotal = dataFields[0]!.summarize ?? "sum";
          const result = aggregate(entry.rowTotals[0] ?? [], subtotal);
          cells.push(`<c r="${cellRef}"><v>${result}</v></c>`);
        }
        addCells(currentRow, cells);
        currentRow++;
      }

      // Grand total row
      const gtCells: string[] = [];
      const gtStrIdx = sharedStrings.register("Grand Total");
      gtCells.push(
        `<c r="${colIndexToLetter(startCol)}${currentRow}" t="s"><v>${gtStrIdx}</v></c>`,
      );
      for (const [ci, colKey] of colUniqueVals.entries()) {
        const subtotal = dataFields[0]!.summarize ?? "sum";
        const colAllValues: number[] = [];
        const dfIdx0 = dataFieldIndices[0];
        for (const record of sourceData.records) {
          const recColKey = colFieldIndices.map((fi) => String(record[fi])).join("|");
          if (recColKey === colKey && dfIdx0 !== undefined) {
            const val = record[dfIdx0];
            if (typeof val === "number") colAllValues.push(val);
          }
        }
        const colOffset = rowFieldNames.length + ci;
        const cellRef = colIndexToLetter(startCol + colOffset) + currentRow;
        const result = aggregate(colAllValues, subtotal);
        gtCells.push(`<c r="${cellRef}"><v>${result}</v></c>`);
      }
      // Grand total (bottom-right)
      {
        const subtotal = dataFields[0]!.summarize ?? "sum";
        const dfIdx0 = dataFieldIndices[0];
        const allValues = sourceData.records
          .map((r) => (dfIdx0 !== undefined ? r[dfIdx0] : undefined))
          .filter((v): v is number => typeof v === "number");
        const colOffset = rowFieldNames.length + numColVals;
        const cellRef = colIndexToLetter(startCol + colOffset) + currentRow;
        const result = aggregate(allValues, subtotal);
        gtCells.push(`<c r="${cellRef}"><v>${result}</v></c>`);
      }
      addCells(currentRow, gtCells);
    } else {
      // --- Simple layout (no column fields) ---
      const endCol = startCol + rowFieldNames.length + dataFields.length - 1;
      minCol = Math.min(minCol, startCol);
      maxCol = Math.max(maxCol, endCol);

      // Header row
      const headerCells: string[] = [];
      for (const rfName of rowFieldNames) {
        const cellRef = colIndexToLetter(startCol + headerCells.length) + startRow;
        const strIdx = sharedStrings.register(rfName);
        headerCells.push(`<c r="${cellRef}" t="s"><v>${strIdx}</v></c>`);
      }
      for (const df of dataFields) {
        const cellRef = colIndexToLetter(startCol + headerCells.length) + startRow;
        const subtotal = df.summarize ?? "sum";
        const dfName = df.name ?? `${subtotal === "sum" ? "Sum" : subtotal} of ${df.field}`;
        const strIdx = sharedStrings.register(dfName);
        headerCells.push(`<c r="${cellRef}" t="s"><v>${strIdx}</v></c>`);
      }
      addCells(startRow, headerCells);

      // Data rows
      let currentRow = startRow + 1;
      for (const [, group] of groupMap) {
        const cells: string[] = [];
        for (const [ri, key] of group.keys.entries()) {
          const cellRef = colIndexToLetter(startCol + ri) + currentRow;
          const strIdx = sharedStrings.register(String(key));
          cells.push(`<c r="${cellRef}" t="s"><v>${strIdx}</v></c>`);
        }
        for (const [di, df] of dataFields.entries()) {
          const colOffset = rowFieldNames.length + di;
          const cellRef = colIndexToLetter(startCol + colOffset) + currentRow;
          const subtotal = df.summarize ?? "sum";
          const result = aggregate(group.values[di] ?? [], subtotal);
          cells.push(`<c r="${cellRef}"><v>${result}</v></c>`);
        }
        addCells(currentRow, cells);
        currentRow++;
      }

      // Grand total row
      const gtCells: string[] = [];
      const gtStrIdx = sharedStrings.register("Grand Total");
      gtCells.push(
        `<c r="${colIndexToLetter(startCol)}${currentRow}" t="s"><v>${gtStrIdx}</v></c>`,
      );
      for (const [di, df] of dataFields.entries()) {
        const colOffset = rowFieldNames.length + di;
        const cellRef = colIndexToLetter(startCol + colOffset) + currentRow;
        const subtotal = df.summarize ?? "sum";
        const dfIdx = dataFieldIndices[di];
        const allValues = sourceData.records
          .map((r) => (dfIdx !== undefined ? r[dfIdx] : undefined))
          .filter((v): v is number => typeof v === "number");
        const result = aggregate(allValues, subtotal);
        gtCells.push(`<c r="${cellRef}"><v>${result}</v></c>`);
      }
      addCells(currentRow, gtCells);
    }
  }

  if (rowCells.size === 0) return { sheetData: "", dimensionRef: "" };

  // Build sheetData
  const parts: string[] = ["<sheetData>"];
  const sortedRows = [...rowCells.entries()].sort((a, b) => a[0] - b[0]);
  for (const [rowIdx, cells] of sortedRows) {
    parts.push(`<row r="${rowIdx}" x14ac:dyDescent="0.25">`);
    for (const c of cells) parts.push(c);
    parts.push("</row>");
  }
  parts.push("</sheetData>");

  const dimStartCol = colIndexToLetter(minCol === Infinity ? 0 : minCol);
  const dimStartRow = minRow === Infinity ? 1 : minRow;
  const dimensionRef = `${dimStartCol}${dimStartRow}:${colIndexToLetter(maxCol)}${maxRow}`;
  return { sheetData: parts.join(""), dimensionRef };
}

/** 0-based column index → Excel letter(s); delegates to the 1-based util helper. */
function colIndexToLetter(col: number): string {
  return columnToLetter(col + 1);
}
