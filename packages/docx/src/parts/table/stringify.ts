/**
 * Direct XML string builders for table properties.
 *
 * Replaces `buildTableProperties() + xml()`, `buildTableRowProperties() + xml()`,
 * `buildTableCellProperties() + xml()`, and `new TablePropertyExceptions().toXml()`
 * with direct string concatenation — no intermediate object tree.
 *
 * @module
 */

import { convertToTwip, mapOptional, xsdVerticalMergeRev } from "@office-open/core";
import { xsdJcAlignment } from "@office-open/core";
import { xsdTableWidthType } from "@office-open/core";
import type { UniversalMeasure } from "@office-open/core";
import { attrsRaw, escapeXml } from "@office-open/xml";
import type { TableCellSpacingProperties } from "@parts/table/table-cell-spacing";
import type { TableCellBordersOptions } from "@parts/table/table-cell/table-cell-components";
import { VerticalMergeType } from "@parts/table/table-cell/table-cell-components";
import type {
  TableCellPropertiesChangeOptions,
  TableCellPropertiesOptions,
} from "@parts/table/table-cell/table-cell-properties";
import type { TableBordersOptions } from "@parts/table/table-properties/table-borders";
import type { TableCellMarginOptions } from "@parts/table/table-properties/table-cell-margin";
import type { TableFloatOptions } from "@parts/table/table-properties/table-float-properties";
import type { TableLookOptions } from "@parts/table/table-properties/table-look";
import type {
  TablePropertiesChangeOptions,
  TablePropertiesOptions,
} from "@parts/table/table-properties/table-properties";
import type { TablePropertyExOptions } from "@parts/table/table-properties/table-property-exceptions";
import type {
  CnfStyleOptions,
  TableRowPropertiesChangeOptions,
  TableRowPropertiesOptions,
} from "@parts/table/table-row/table-row-properties";
import type { TableWidthProperties } from "@parts/table/table-width";
import { WidthType, widthPctToFiftieths } from "@parts/table/table-width";
import type { CellMergeAttributes } from "@shared/track-revision";
import { autoRevisionId } from "@shared/track-revision/track-revision";
import type { ChangedProperties } from "@shared/track-revision/track-revision";

import { borderStr, onOff, shadingStr } from "../paragraph/stringify";

// ── Table width string ──

// Normalize a CT_TblWidth @w value to a bare integer: pct percentage (50 / "50%") →
// fiftieths, dxa length (twip number | UniversalMeasure) → twips. The emitted @w is
// always an integer — never "N%" or a measure string, which are different XSD branches
// (ST_Percentage / ST_UniversalMeasure) that Word treats as auto on tblW. A stray "%"
// under dxa is a meaningless cross-branch value, passed through verbatim for parity.
function tableWidthValue(
  size: TableWidthProperties["size"],
  type: string | undefined,
): number | string {
  if (type === WidthType.PERCENTAGE) return widthPctToFiftieths(size);
  if (typeof size === "number") return size;
  if (size.endsWith("%")) return size;
  return convertToTwip(size as UniversalMeasure);
}

function tableWidthStr(name: string, opts: TableWidthProperties): string {
  const type = opts.type ?? WidthType.AUTO;
  const a = attrsRaw({
    "w:w": tableWidthValue(opts.size, type),
    "w:type": xsdTableWidthType.to(type),
  });
  return `<${name}${a}/>`;
}

// ── Cell margin string ──

function cellMarginChildrenStr(opts: TableCellMarginOptions): string {
  // CT_TblCellMar sequence order: top, start, left, bottom, end, right.
  // Each side is an independent CT_TblWidth; margins default to DXA.
  const parts: string[] = [];
  const side = (name: string, w: TableWidthProperties | undefined): void => {
    if (w === undefined) return;
    parts.push(tableWidthStr(name, { size: w.size, type: w.type ?? WidthType.DXA }));
  };
  side("w:top", opts.top);
  side("w:start", opts.start);
  side("w:left", opts.left);
  side("w:bottom", opts.bottom);
  side("w:end", opts.end);
  side("w:right", opts.right);
  return parts.join("");
}

function cellMarginStr(tag: string, opts: TableCellMarginOptions): string | undefined {
  const inner = cellMarginChildrenStr(opts);
  return inner ? `<${tag}>${inner}</${tag}>` : undefined;
}

// ── Table borders string ──

// CT_TblBorders — all 8 sides are optional (minOccurs=0); emit only those set.
// Sequence order: top, start, left, bottom, end, right, insideH, insideV.
function tableBordersStr(opts: TableBordersOptions): string | undefined {
  const parts: string[] = [];
  if (opts.top) parts.push(borderStr("w:top", opts.top));
  if (opts.start) parts.push(borderStr("w:start", opts.start));
  if (opts.left) parts.push(borderStr("w:left", opts.left));
  if (opts.bottom) parts.push(borderStr("w:bottom", opts.bottom));
  if (opts.end) parts.push(borderStr("w:end", opts.end));
  if (opts.right) parts.push(borderStr("w:right", opts.right));
  if (opts.insideHorizontal) parts.push(borderStr("w:insideH", opts.insideHorizontal));
  if (opts.insideVertical) parts.push(borderStr("w:insideV", opts.insideVertical));
  return parts.length > 0 ? `<w:tblBorders>${parts.join("")}</w:tblBorders>` : undefined;
}

// ── Cell borders string ──

function cellBordersStr(opts: TableCellBordersOptions): string | undefined {
  // CT_TcBorders sequence: top, start, left, bottom, end, right, insideH, insideV, tl2br, tr2bl.
  const parts: string[] = [];
  if (opts.top) parts.push(borderStr("w:top", opts.top));
  if (opts.start) parts.push(borderStr("w:start", opts.start));
  if (opts.left) parts.push(borderStr("w:left", opts.left));
  if (opts.bottom) parts.push(borderStr("w:bottom", opts.bottom));
  if (opts.end) parts.push(borderStr("w:end", opts.end));
  if (opts.right) parts.push(borderStr("w:right", opts.right));
  if (opts.insideHorizontal) parts.push(borderStr("w:insideH", opts.insideHorizontal));
  if (opts.insideVertical) parts.push(borderStr("w:insideV", opts.insideVertical));
  if (opts.topLeftToBottomRight) parts.push(borderStr("w:tl2br", opts.topLeftToBottomRight));
  if (opts.topRightToBottomLeft) parts.push(borderStr("w:tr2bl", opts.topRightToBottomLeft));
  return parts.length > 0 ? `<w:tcBorders>${parts.join("")}</w:tcBorders>` : undefined;
}

// ── Float properties string ──

function floatPropertiesStr(opts: TableFloatOptions): string {
  const a = attrsRaw({
    "w:horzAnchor": opts.horizontalAnchor,
    "w:vertAnchor": opts.verticalAnchor,
    "w:tblpX":
      opts.absoluteHorizontalPosition !== undefined
        ? convertToTwip(opts.absoluteHorizontalPosition)
        : undefined,
    "w:tblpXSpec": opts.relativeHorizontalPosition,
    "w:tblpY":
      opts.absoluteVerticalPosition !== undefined
        ? convertToTwip(opts.absoluteVerticalPosition)
        : undefined,
    "w:tblpYSpec": opts.relativeVerticalPosition,
    "w:bottomFromText":
      opts.bottomFromText !== undefined ? convertToTwip(opts.bottomFromText) : undefined,
    "w:topFromText": opts.topFromText !== undefined ? convertToTwip(opts.topFromText) : undefined,
    "w:leftFromText":
      opts.leftFromText !== undefined ? convertToTwip(opts.leftFromText) : undefined,
    "w:rightFromText":
      opts.rightFromText !== undefined ? convertToTwip(opts.rightFromText) : undefined,
  });
  return `<w:tblpPr${a}/>`;
}

// ── Table look string ──

function tableLookStr(opts: TableLookOptions): string {
  // XML polarity inverts banding: w:noHBand="1" disables row banding.
  // ST_OnOff emits as 1/0 to match every other on/off attribute in the package.
  const onOffAttr = (v: boolean | undefined) => mapOptional(v, (b) => (b ? 1 : 0));
  const a = attrsRaw({
    "w:val": opts.val,
    "w:firstRow": onOffAttr(opts.firstRow),
    "w:lastRow": onOffAttr(opts.lastRow),
    "w:firstColumn": onOffAttr(opts.firstCol),
    "w:lastColumn": onOffAttr(opts.lastCol),
    "w:noHBand": onOffAttr(mapOptional(opts.bandRow, (b) => !b)),
    "w:noVBand": onOffAttr(mapOptional(opts.bandCol, (b) => !b)),
  });
  return `<w:tblLook${a}/>`;
}

// ── Conditional format style string (CT_Cnf) ──

function cnfStyleStr(opts: CnfStyleOptions): string {
  const a = attrsRaw({
    "w:val": opts.val,
    "w:firstRow": opts.firstRow,
    "w:lastRow": opts.lastRow,
    "w:firstColumn": opts.firstColumn,
    "w:lastColumn": opts.lastColumn,
    "w:oddVBand": opts.oddVBand,
    "w:evenVBand": opts.evenVBand,
    "w:oddHBand": opts.oddHBand,
    "w:evenHBand": opts.evenHBand,
    "w:firstRowFirstColumn": opts.firstRowFirstColumn,
    "w:firstRowLastColumn": opts.firstRowLastColumn,
    "w:lastRowFirstColumn": opts.lastRowFirstColumn,
    "w:lastRowLastColumn": opts.lastRowLastColumn,
  });
  return `<w:cnfStyle${a}/>`;
}

// ── Change/revision attribute string ──

function changeAttrStr(tag: string, opts: ChangedProperties): string {
  const a = attrsRaw({
    "w:author": escapeXml(opts.author),
    "w:date": escapeXml(opts.date),
    "w:id": opts.id ?? autoRevisionId(),
  });
  return `<${tag}${a}/>`;
}

// ── Cell merge revision string ──

function cellMergeStr(opts: CellMergeAttributes): string {
  const attrs: Record<string, string | number | boolean | undefined> = {
    "w:author": escapeXml(opts.author),
    "w:date": escapeXml(opts.date),
    "w:id": opts.id ?? autoRevisionId(),
  };
  if (opts.verticalMerge !== undefined) {
    attrs["w:vMerge"] = xsdVerticalMergeRev.to(opts.verticalMerge);
  }
  if (opts.verticalMergeOriginal !== undefined) {
    attrs["w:vMergeOrig"] = xsdVerticalMergeRev.to(opts.verticalMergeOriginal);
  }
  const a = attrsRaw(attrs);
  return `<w:cellMerge${a}/>`;
}

// ── Cell spacing string ──

function cellSpacingStr(opts: TableCellSpacingProperties): string {
  const a = attrsRaw({
    "w:w": tableWidthValue(opts.size, opts.type),
    "w:type": opts.type !== undefined ? xsdTableWidthType.to(opts.type) : undefined,
  });
  return `<w:tblCellSpacing${a}/>`;
}

// ── Table properties change (w:tblPrChange) ──

function stringifyTablePropertiesChangeInner(options: TablePropertiesChangeOptions): string {
  // The embedded w:tblPr is CT_TblPrBase — no nested tblPrChange.
  const { revision: _rev, ...innerOptions } = options;
  const inner = stringifyTablePropertiesInner({ ...innerOptions, includeIfEmpty: true });
  const a = attrsRaw({
    "w:author": escapeXml(options.author),
    "w:date": escapeXml(options.date),
    "w:id": options.id ?? autoRevisionId(),
  });
  return `<w:tblPrChange ${a}><w:tblPr>${inner}</w:tblPr></w:tblPrChange>`;
}

// ── Table properties (w:tblPr) ──

function stringifyTablePropertiesInner(
  options: TablePropertiesOptions & { includeIfEmpty?: boolean },
): string {
  const parts: string[] = [];

  if (options.style) {
    parts.push(`<w:tblStyle w:val="${options.style}"/>`);
  }

  if (options.float) {
    parts.push(floatPropertiesStr(options.float));
    if (options.float.overlap) {
      parts.push(`<w:tblOverlap w:val="${options.float.overlap}"/>`);
    }
  }

  if (options.visuallyRightToLeft !== undefined) {
    parts.push(onOff("w:bidiVisual", options.visuallyRightToLeft));
  }

  if (options.styleRowBandSize !== undefined) {
    parts.push(`<w:tblStyleRowBandSize w:val="${options.styleRowBandSize}"/>`);
  }

  if (options.styleColBandSize !== undefined) {
    parts.push(`<w:tblStyleColBandSize w:val="${options.styleColBandSize}"/>`);
  }

  if (options.width) {
    parts.push(tableWidthStr("w:tblW", options.width));
  }

  if (options.alignment) {
    parts.push(`<w:jc w:val="${xsdJcAlignment.to(options.alignment)}"/>`);
  }

  if (options.cellSpacing) {
    parts.push(cellSpacingStr(options.cellSpacing));
  }

  if (options.indent) {
    parts.push(tableWidthStr("w:tblInd", options.indent));
  }

  if (options.borders) {
    const bs = tableBordersStr(options.borders);
    if (bs) parts.push(bs);
  }

  if (options.shading) {
    parts.push(shadingStr(options.shading));
  }

  if (options.layout) {
    parts.push(`<w:tblLayout w:type="${options.layout}"/>`);
  }

  if (options.margins) {
    const cm = cellMarginStr("w:tblCellMar", options.margins);
    if (cm) parts.push(cm);
  }

  if (options.tableLook) {
    parts.push(tableLookStr(options.tableLook));
  }

  if (options.caption !== undefined) {
    parts.push(`<w:tblCaption w:val="${options.caption}"/>`);
  }

  if (options.description !== undefined) {
    parts.push(`<w:tblDescription w:val="${options.description}"/>`);
  }

  if (options.revision) {
    parts.push(stringifyTablePropertiesChangeInner(options.revision));
  }

  return parts.join("");
}

export function stringifyTableProperties(
  options: TablePropertiesOptions & { includeIfEmpty?: boolean },
): string | undefined {
  const inner = stringifyTablePropertiesInner(options);
  if (options.includeIfEmpty || inner) {
    return `<w:tblPr>${inner}</w:tblPr>`;
  }
  return undefined;
}

// ── Row properties change (w:trPrChange) ──

function stringifyTableRowPropertiesChangeInner(options: TableRowPropertiesChangeOptions): string {
  // TableRowPropertiesChangeOptions already narrows to CT_TrPrBase fields —
  // ins/del/trPrChange live only on the full TableRowPropertiesOptions.
  const inner = stringifyTableRowPropertiesInner({ ...options, includeIfEmpty: true });
  const a = attrsRaw({
    "w:author": escapeXml(options.author),
    "w:date": escapeXml(options.date),
    "w:id": options.id ?? autoRevisionId(),
  });
  return `<w:trPrChange ${a}><w:trPr>${inner}</w:trPr></w:trPrChange>`;
}

// ── Row properties (w:trPr) ──

function stringifyTableRowPropertiesInner(
  options: TableRowPropertiesOptions & { includeIfEmpty?: boolean },
): string {
  const parts: string[] = [];

  if (options.cnfStyle !== undefined) {
    parts.push(cnfStyleStr(options.cnfStyle));
  }

  if (options.divId !== undefined) {
    parts.push(`<w:divId w:val="${options.divId}"/>`);
  }

  if (options.gridBefore !== undefined) {
    parts.push(`<w:gridBefore w:val="${options.gridBefore}"/>`);
  }

  if (options.gridAfter !== undefined) {
    parts.push(`<w:gridAfter w:val="${options.gridAfter}"/>`);
  }

  if (options.widthBefore) {
    parts.push(tableWidthStr("w:wBefore", options.widthBefore));
  }

  if (options.widthAfter) {
    parts.push(tableWidthStr("w:wAfter", options.widthAfter));
  }

  if (options.cantSplit !== undefined) {
    parts.push(onOff("w:cantSplit", options.cantSplit));
  }

  if (options.tableHeader !== undefined) {
    parts.push(onOff("w:tblHeader", options.tableHeader));
  }

  if (options.height) {
    const a = attrsRaw({
      "w:val": convertToTwip(options.height.value),
      "w:hRule": options.height.rule,
    });
    parts.push(`<w:trHeight${a}/>`);
  }

  if (options.cellSpacing) {
    parts.push(cellSpacingStr(options.cellSpacing));
  }

  if (options.rowAlignment) {
    parts.push(`<w:jc w:val="${xsdJcAlignment.to(options.rowAlignment)}"/>`);
  }

  if (options.hidden !== undefined) {
    parts.push(onOff("w:hidden", options.hidden));
  }

  if (options.insertion) {
    parts.push(changeAttrStr("w:ins", options.insertion));
  }

  if (options.deletion) {
    parts.push(changeAttrStr("w:del", options.deletion));
  }

  if (options.revision) {
    parts.push(stringifyTableRowPropertiesChangeInner(options.revision));
  }

  return parts.join("");
}

export function stringifyTableRowProperties(
  options: TableRowPropertiesOptions & { includeIfEmpty?: boolean },
): string | undefined {
  const inner = stringifyTableRowPropertiesInner(options);
  if (options.includeIfEmpty || inner) {
    return `<w:trPr>${inner}</w:trPr>`;
  }
  return undefined;
}

// ── Cell properties change (w:tcPrChange) ──

function stringifyTableCellPropertiesChangeInner(
  options: TableCellPropertiesChangeOptions,
): string {
  // The embedded w:tcPr is CT_TcPrInner, which includes EG_CellMarkupElements
  // (cellIns/cellDel/cellMerge) — the snapshot's own revision markers
  // round-trip, same as every other property in the snapshot.
  const inner = stringifyTableCellPropertiesInner({ ...options, includeIfEmpty: true });
  const a = attrsRaw({
    "w:author": escapeXml(options.author),
    "w:date": escapeXml(options.date),
    "w:id": options.id ?? autoRevisionId(),
  });
  return `<w:tcPrChange ${a}><w:tcPr>${inner}</w:tcPr></w:tcPrChange>`;
}

// ── Cell properties (w:tcPr) ──

function stringifyTableCellPropertiesInner(
  options: TableCellPropertiesOptions & { includeIfEmpty?: boolean },
): string {
  // CT_TcPrBase sequence: cnfStyle, tcW, gridSpan, hMerge, vMerge, tcBorders, shd,
  // noWrap, tcMar, textDirection, tcFitText, vAlign, hideMark, headers;
  // then EG_CellMarkupElements (cellIns/cellDel/cellMerge), then tcPrChange.
  const parts: string[] = [];

  if (options.cnfStyle !== undefined) {
    parts.push(cnfStyleStr(options.cnfStyle));
  }

  if (options.width) {
    parts.push(tableWidthStr("w:tcW", options.width));
  }

  if (options.columnSpan) {
    parts.push(`<w:gridSpan w:val="${options.columnSpan}"/>`);
  }

  if (options.horizontalMerge !== undefined) {
    if (options.horizontalMerge === "restart") {
      parts.push(`<w:hMerge w:val="restart"/>`);
    } else {
      parts.push(`<w:hMerge/>`);
    }
  }

  if (options.verticalMerge) {
    parts.push(`<w:vMerge w:val="${options.verticalMerge}"/>`);
  } else if (options.rowSpan && options.rowSpan > 1) {
    parts.push(`<w:vMerge w:val="${VerticalMergeType.RESTART}"/>`);
  }

  if (options.borders) {
    const bs = cellBordersStr(options.borders);
    if (bs) parts.push(bs);
  }

  if (options.shading) {
    parts.push(shadingStr(options.shading));
  }

  if (options.noWrap !== undefined) {
    parts.push(onOff("w:noWrap", options.noWrap));
  }

  if (options.margins) {
    const cm = cellMarginStr("w:tcMar", options.margins);
    if (cm) parts.push(cm);
  }

  if (options.textDirection) {
    parts.push(`<w:textDirection w:val="${options.textDirection}"/>`);
  }

  if (options.fitText !== undefined) {
    parts.push(onOff("w:tcFitText", options.fitText));
  }

  if (options.verticalAlign) {
    parts.push(`<w:vAlign w:val="${options.verticalAlign}"/>`);
  }

  if (options.hideMark !== undefined) {
    parts.push(onOff("w:hideMark", options.hideMark));
  }

  if (options.headers !== undefined) {
    const headerParts = options.headers.map((h) => `<w:header w:val="${h}"/>`).join("");
    parts.push(`<w:headers>${headerParts}</w:headers>`);
  }

  if (options.insertion) {
    parts.push(changeAttrStr("w:cellIns", options.insertion));
  }

  if (options.deletion) {
    parts.push(changeAttrStr("w:cellDel", options.deletion));
  }

  if (options.cellMerge) {
    parts.push(cellMergeStr(options.cellMerge));
  }

  if (options.revision) {
    parts.push(stringifyTableCellPropertiesChangeInner(options.revision));
  }

  return parts.join("");
}

export function stringifyTableCellProperties(
  options: TableCellPropertiesOptions & { includeIfEmpty?: boolean; cellProperties?: boolean },
): string | undefined {
  const inner = stringifyTableCellPropertiesInner(options);
  // cellProperties marks a parsed bare <w:tcPr/> — round-trip as the empty element.
  if (options.includeIfEmpty || options.cellProperties === true || inner) {
    return `<w:tcPr>${inner}</w:tcPr>`;
  }
  return undefined;
}

// ── Table property exceptions (w:tblPrEx) ──

function stringifyTablePropertyExceptionsInner(options: TablePropertyExOptions): string {
  const parts: string[] = [];

  if (options.width) {
    parts.push(tableWidthStr("w:tblW", options.width));
  }

  if (options.alignment) {
    parts.push(`<w:jc w:val="${xsdJcAlignment.to(options.alignment)}"/>`);
  }

  if (options.cellSpacing) {
    parts.push(cellSpacingStr(options.cellSpacing));
  }

  if (options.indent) {
    parts.push(tableWidthStr("w:tblInd", options.indent));
  }

  if (options.borders) {
    const bs = tableBordersStr(options.borders);
    if (bs) parts.push(bs);
  }

  if (options.shading) {
    parts.push(shadingStr(options.shading));
  }

  if (options.layout) {
    parts.push(`<w:tblLayout w:type="${options.layout}"/>`);
  }

  if (options.margins) {
    const cm = cellMarginStr("w:tblCellMar", options.margins);
    if (cm) parts.push(cm);
  }

  if (options.tableLook) {
    parts.push(tableLookStr(options.tableLook));
  }

  if (options.tblPrExChange) {
    const change = options.tblPrExChange;
    const a = attrsRaw({
      "w:author": escapeXml(change.author),
      "w:date": escapeXml(change.date),
      "w:id": change.id ?? autoRevisionId(),
    });
    // CT_TblPrExChange requires a tblPrEx child holding the previous (pre-change) values.
    const revInner = stringifyTablePropertyExceptionsInner(change);
    parts.push(`<w:tblPrExChange ${a}><w:tblPrEx>${revInner}</w:tblPrEx></w:tblPrExChange>`);
  }

  return parts.join("");
}

export function stringifyTablePropertyExceptions(options: TablePropertyExOptions): string {
  return `<w:tblPrEx>${stringifyTablePropertyExceptionsInner(options)}</w:tblPrEx>`;
}
