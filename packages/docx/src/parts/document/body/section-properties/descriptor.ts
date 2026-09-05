/**
 * Section properties descriptor for DOCX documents.
 *
 * Produces `<w:sectPr>` XML directly from options, eliminating all
 * intermediate XmlComponent instances (create* + toXml pattern).
 *
 * Reference: ISO/IEC 29500-4, wml.xsd, CT_SectPr
 *
 * @module
 */

import { convertToTwip } from "@office-open/core";
import type { CustomDescriptor } from "@office-open/core/descriptor";
import { attr, attrBool, attrMeasure, attrNum, escapeXml, findChild } from "@office-open/xml";
import type { Element } from "@office-open/xml";
import type { ColumnProperties } from "@parts/document/body/section-properties/properties/column";
import type { ColumnsProperties } from "@parts/document/body/section-properties/properties/columns";
import type { DocGridProperties } from "@parts/document/body/section-properties/properties/doc-grid";
import type {
  EndnotePropertiesOptions,
  FootnotePropertiesOptions,
} from "@parts/document/body/section-properties/properties/footnote-endnote-properties";
import type { LineNumberProperties } from "@parts/document/body/section-properties/properties/line-number";
import type { PageBordersOptions } from "@parts/document/body/section-properties/properties/page-borders";
import type { PageMarginProperties } from "@parts/document/body/section-properties/properties/page-margin";
import { PageNumberSeparator } from "@parts/document/body/section-properties/properties/page-number";
import type { PageNumberTypeProperties } from "@parts/document/body/section-properties/properties/page-number";
import type { PageSizeProperties } from "@parts/document/body/section-properties/properties/page-size";
import type {
  HeaderFooterGroup,
  SectionPropertiesChangeOptions,
  SectionPropertiesOptions,
} from "@parts/document/body/section-properties/section-properties";
import {
  sectionMarginDefaults,
  sectionPageSizeDefaults,
} from "@parts/document/body/section-properties/section-properties";
import type { HeaderFooterReference } from "@parts/header-footer";
import type { BorderOptions } from "@shared/border";
import { NumberFormat } from "@shared/constants";
import type { BodyContext } from "@shared/index";
import { autoRevisionId } from "@shared/track-revision/track-revision";

/** Valid page-number `@w:fmt` values (ST_NumberFormat). */
const PAGE_NUMBER_FORMATS = Object.values(NumberFormat) as readonly string[];
/** Valid page-number `@w:chapSep` values (ST_ChapterSep). */
const PAGE_NUMBER_SEPARATORS = Object.values(PageNumberSeparator) as readonly string[];

// ── Border XML helper ──

function stringifyBorderXml(tag: string, opts: BorderOptions): string {
  const attrs: string[] = [];
  if (opts.style !== undefined) attrs.push(`w:val="${opts.style}"`);
  if (opts.color !== undefined) attrs.push(`w:color="${opts.color}"`);
  if (opts.size !== undefined) attrs.push(`w:sz="${opts.size}"`);
  if (opts.space !== undefined) attrs.push(`w:space="${opts.space}"`);
  if (opts.themeColor !== undefined) attrs.push(`w:themeColor="${opts.themeColor}"`);
  if (opts.themeTint !== undefined) attrs.push(`w:themeTint="${opts.themeTint}"`);
  if (opts.themeShade !== undefined) attrs.push(`w:themeShade="${opts.themeShade}"`);
  if (opts.shadow !== undefined) attrs.push(`w:shadow="${opts.shadow ? 1 : 0}"`);
  if (opts.frame !== undefined) attrs.push(`w:frame="${opts.frame ? 1 : 0}"`);
  return `<${tag} ${attrs.join(" ")}/>`;
}

// ── Inline XML builders (replacing create* + toXml) ──

function pageSizeXml(
  w: number | string,
  h: number | string,
  orient?: string,
  code?: number,
): string {
  const attrs: string[] = [`w:w="${w}"`, `w:h="${h}"`];
  if (orient) attrs.push(`w:orient="${orient}"`);
  if (code !== undefined) attrs.push(`w:code="${code}"`);
  return `<w:pgSz ${attrs.join(" ")}/>`;
}

function pageMarginXml(
  top: number | string,
  right: number | string,
  bottom: number | string,
  left: number | string,
  header: number | string,
  footer: number | string,
  gutter: number | string,
): string {
  return `<w:pgMar w:top="${top}" w:right="${right}" w:bottom="${bottom}" w:left="${left}" w:header="${header}" w:footer="${footer}" w:gutter="${gutter}"/>`;
}

function headerFooterRefXml(tag: string, id: number, type: string): string {
  return `<${tag} r:id="rId${id}" w:type="${type}"/>`;
}

function sectionTypeXml(val: string): string {
  return `<w:type w:val="${val}"/>`;
}

function verticalAlignXml(val: string): string {
  return `<w:vAlign w:val="${val}"/>`;
}

function lineNumberXml(opts: NonNullable<SectionPropertiesOptions["lineNumberType"]>): string {
  const attrs: string[] = [];
  if (opts.countBy !== undefined) attrs.push(`w:countBy="${opts.countBy}"`);
  if (opts.start !== undefined) attrs.push(`w:start="${opts.start}"`);
  if (opts.restart !== undefined) attrs.push(`w:restart="${opts.restart}"`);
  if (opts.distance !== undefined) attrs.push(`w:distance="${opts.distance}"`);
  return attrs.length ? `<w:lnNumType ${attrs.join(" ")}/>` : "<w:lnNumType/>";
}

function pageNumberXml(opts: NonNullable<PageNumberTypeProperties>): string {
  const attrs: string[] = [];
  if (opts.start !== undefined) attrs.push(`w:start="${opts.start}"`);
  if (opts.format !== undefined) attrs.push(`w:fmt="${opts.format}"`);
  if (opts.separator !== undefined) attrs.push(`w:chapSep="${opts.separator}"`);
  if (opts.chapterStyle !== undefined) attrs.push(`w:chapStyle="${opts.chapterStyle}"`);
  // No attributes → omit pgNumType (never fabricate an empty element).
  return attrs.length ? `<w:pgNumType ${attrs.join(" ")}/>` : "";
}

function docGridXml(linePitch: number, charSpace?: number, type?: string): string {
  const attrs: string[] = [`w:linePitch="${linePitch}"`];
  if (charSpace !== undefined) attrs.push(`w:charSpace="${charSpace}"`);
  if (type !== undefined) attrs.push(`w:type="${type}"`);
  return `<w:docGrid ${attrs.join(" ")}/>`;
}

function columnsXml(opts: NonNullable<SectionPropertiesOptions["columns"]>): string {
  const attrs: string[] = [];
  if (opts.space !== undefined) attrs.push(`w:space="${convertToTwip(opts.space)}"`);
  if (opts.count !== undefined) attrs.push(`w:num="${opts.count}"`);
  if (opts.separate !== undefined) attrs.push(`w:sep="${opts.separate ? 1 : 0}"`);
  if (opts.equalWidth !== undefined) attrs.push(`w:equalWidth="${opts.equalWidth ? 1 : 0}"`);

  const attrStr = attrs.join(" ");

  // Custom width columns — children are ColumnProperties (Column class implements this interface)
  if (!opts.equalWidth && opts.children) {
    const colParts: string[] = [];
    for (const col of opts.children as readonly ColumnProperties[]) {
      const colAttrs: string[] = [`w:w="${convertToTwip(col.width)}"`];
      if (col.space !== undefined) colAttrs.push(`w:space="${convertToTwip(col.space)}"`);
      colParts.push(`<w:col ${colAttrs.join(" ")}/>`);
    }
    return `<w:cols ${attrStr}>${colParts.join("")}</w:cols>`;
  }
  return `<w:cols ${attrStr}/>`;
}

function footnotePrXml(
  tag: string,
  opts: FootnotePropertiesOptions | EndnotePropertiesOptions,
): string {
  const parts: string[] = [];
  if (opts.pos !== undefined) parts.push(`<w:pos w:val="${opts.pos}"/>`);
  if (opts.formatType !== undefined || opts.format !== undefined) {
    const fmtAttrs: string[] = [];
    // CT_NumFmt uses w:val (required) for the format type; w:fmt belongs to
    // CT_PageNumber (pgNumType). w:format is the optional free-form override.
    if (opts.formatType !== undefined) fmtAttrs.push(`w:val="${opts.formatType}"`);
    if (opts.format !== undefined) fmtAttrs.push(`w:format="${opts.format}"`);
    parts.push(`<w:numFmt ${fmtAttrs.join(" ")}/>`);
  }
  if (opts.numStart !== undefined) parts.push(`<w:numStart w:val="${opts.numStart}"/>`);
  if (opts.numRestart !== undefined) parts.push(`<w:numRestart w:val="${opts.numRestart}"/>`);
  const body = parts.join("");
  return body ? `<${tag}>${body}</${tag}>` : `<${tag}/>`;
}

function pageBordersXml(opts: NonNullable<PageBordersOptions>): string {
  const attrs: string[] = [];
  if (opts.display !== undefined) attrs.push(`w:display="${opts.display}"`);
  if (opts.offsetFrom !== undefined) attrs.push(`w:offsetFrom="${opts.offsetFrom}"`);
  if (opts.zOrder !== undefined) attrs.push(`w:zOrder="${opts.zOrder}"`);

  const parts: string[] = [];
  if (opts.top) parts.push(stringifyBorderXml("w:top", opts.top));
  if (opts.left) parts.push(stringifyBorderXml("w:left", opts.left));
  if (opts.bottom) parts.push(stringifyBorderXml("w:bottom", opts.bottom));
  if (opts.right) parts.push(stringifyBorderXml("w:right", opts.right));

  const attrStr = attrs.join(" ");
  const body = parts.join("");
  if (!body && !attrStr) return "<w:pgBorders/>";
  return body ? `<w:pgBorders ${attrStr}>${body}</w:pgBorders>` : `<w:pgBorders ${attrStr}/>`;
}

// ── Header/footer references ──

/**
 * Descriptor input for section properties: the public options plus the
 * header/footer part wiring owned by {@link BodyContext} (users author
 * headers/footers on the section, not reference ids). Parse never emits
 * the reference fields — round-trip re-creates them from the parsed
 * header/footer parts.
 */
export interface SectionPropertiesDescriptorOptions extends SectionPropertiesOptions {
  headerReferences?: HeaderFooterGroup<HeaderFooterReference>;
  footerReferences?: HeaderFooterGroup<HeaderFooterReference>;
  /**
   * printerSettings relationship id (w:printerSettings `@r:id`) — compiler wiring
   * that only the descriptor consumes. Dropped on parse: the printerSettings
   * binary part is not round-tripped, so a carried-over id would dangle.
   */
  printerSettingsId?: string;
}

function appendHeaderFooterRefs(
  parts: string[],
  type: "w:headerReference" | "w:footerReference",
  group?: HeaderFooterGroup<HeaderFooterReference>,
): void {
  if (!group) return;
  if (group.default) parts.push(headerFooterRefXml(type, group.default.referenceId, "default"));
  if (group.first) parts.push(headerFooterRefXml(type, group.first.referenceId, "first"));
  if (group.even) parts.push(headerFooterRefXml(type, group.even.referenceId, "even"));
}

// ── sectPrChange (recursive) ──

function stringifySectionPropertiesChange(opts: SectionPropertiesChangeOptions): string {
  const { author, date, id, ...inner } = opts;
  // The inner w:sectPr is a snapshot of the PREVIOUS properties — emit only
  // what the source carried. Injecting the fresh-document defaults (pgSz,
  // pgMar, docGrid) would fabricate elements the revision never had.
  const innerXml = stringifySectionPropertiesInner(inner, true);
  // The snapshot's own rsid attributes round-trip too (CT_SectPrChange's
  // inner CT_SectPr carries them just like the top-level element).
  return `<w:sectPrChange w:author="${escapeXml(author)}" w:date="${escapeXml(date)}" w:id="${id ?? autoRevisionId()}"><w:sectPr${sectPrRsidAttrs(inner)}>${innerXml}</w:sectPr></w:sectPrChange>`;
}

// ── Core XML builder ──

function stringifySectionPropertiesInner(
  opts: SectionPropertiesDescriptorOptions,
  omitDefaults = false,
): string {
  const parts: string[] = [];

  // Header/footer references
  appendHeaderFooterRefs(parts, "w:headerReference", opts.headerReferences);
  appendHeaderFooterRefs(parts, "w:footerReference", opts.footerReferences);

  // Page options with defaults (false = parsed source omitted the element —
  // keep the fresh defaults out of the emission decision below)
  const {
    width = sectionPageSizeDefaults.WIDTH,
    height = sectionPageSizeDefaults.HEIGHT,
    orientation = sectionPageSizeDefaults.ORIENTATION,
    code,
  } = typeof opts.pageSize === "object" ? opts.pageSize : {};
  const {
    top = sectionMarginDefaults.TOP,
    right = sectionMarginDefaults.RIGHT,
    bottom = sectionMarginDefaults.BOTTOM,
    left = sectionMarginDefaults.LEFT,
    header = sectionMarginDefaults.HEADER,
    footer = sectionMarginDefaults.FOOTER,
    gutter = sectionMarginDefaults.GUTTER,
  } = typeof opts.pageMargin === "object" ? opts.pageMargin : {};
  const { pageNumberType = {}, pageBorders: borders, textDirection } = opts;

  const {
    linePitch = 312,
    charSpace = 0,
    type: gridType = "lines",
  } = typeof opts.grid === "object" ? opts.grid : {};

  // Footnote/endnote properties
  if (opts.footnoteProperties) {
    parts.push(footnotePrXml("w:footnotePr", opts.footnoteProperties));
  }
  if (opts.endnoteProperties) {
    parts.push(footnotePrXml("w:endnotePr", opts.endnoteProperties));
  }

  // Section type
  if (opts.type) parts.push(sectionTypeXml(opts.type));

  // Page size — normalize both logical dimensions to twips, then swap w/h when
  // landscape. UniversalMeasure ("210mm") is converted so the emitted w:w/w:h is
  // always a plain twip number that the attrNum-based parse reads back exactly.
  const wTwips = convertToTwip(width);
  const hTwips = convertToTwip(height);
  const pgW = orientation === "landscape" ? hTwips : wTwips;
  const pgH = orientation === "landscape" ? wTwips : hTwips;
  // Page size — fresh sections get the default; a parsed source without
  // w:pgSz (false) stays absent (the XSD leaves it optional).
  if (opts.pageSize !== false && (!omitDefaults || opts.pageSize !== undefined)) {
    parts.push(pageSizeXml(pgW, pgH, orientation, code));
  }

  // Page margin — same three states as the page size. UniversalMeasure
  // ("2.5cm") normalizes to plain twip numbers, matching w:pgSz above (the
  // destructured defaults above keep every argument non-undefined).
  if (opts.pageMargin !== false && (!omitDefaults || opts.pageMargin !== undefined)) {
    parts.push(
      pageMarginXml(
        convertToTwip(top),
        convertToTwip(right),
        convertToTwip(bottom),
        convertToTwip(left),
        convertToTwip(header),
        convertToTwip(footer),
        convertToTwip(gutter),
      ),
    );
  }

  // Paper source — EG_SectPrContents order: … pgMar, paperSrc, pgBorders …
  if (opts.paperSrc) {
    const psAttr: string[] = [];
    if (opts.paperSrc.first !== undefined) psAttr.push(`w:first="${opts.paperSrc.first}"`);
    if (opts.paperSrc.other !== undefined) psAttr.push(`w:other="${opts.paperSrc.other}"`);
    parts.push(`<w:paperSrc ${psAttr.join(" ")}/>`);
  }

  // Page borders
  if (borders) parts.push(pageBordersXml(borders));

  // Line numbers
  if (opts.lineNumberType) parts.push(lineNumberXml(opts.lineNumberType));

  // Page numbers
  parts.push(pageNumberXml(pageNumberType));

  // Columns
  if (opts.columns) parts.push(columnsXml(opts.columns));

  // Element order follows EG_SectPrContents in wml.xsd: formProt, vAlign,
  // noEndnote, titlePg, textDirection, bidi, rtlGutter, docGrid.
  if (opts.formProtection !== undefined)
    parts.push(opts.formProtection ? "<w:formProt/>" : '<w:formProt w:val="0"/>');
  if (opts.verticalAlign) parts.push(verticalAlignXml(opts.verticalAlign));
  if (opts.noEndnote !== undefined)
    parts.push(opts.noEndnote ? "<w:noEndnote/>" : '<w:noEndnote w:val="0"/>');
  if (opts.titlePage !== undefined)
    parts.push(opts.titlePage ? "<w:titlePg/>" : '<w:titlePg w:val="0"/>');
  if (textDirection) parts.push(`<w:textDirection w:val="${textDirection}"/>`);
  if (opts.bidi !== undefined) parts.push(opts.bidi ? "<w:bidi/>" : '<w:bidi w:val="0"/>');
  if (opts.rtlGutter !== undefined)
    parts.push(opts.rtlGutter ? "<w:rtlGutter/>" : '<w:rtlGutter w:val="0"/>');

  // Document grid — three states:
  //  - undefined (fresh, unset): emit Word's CJK default line grid (linePitch
  //    312, type "lines") so generated docs match East Asian line-snapping.
  //  - object: emit provided values (round-trip fidelity).
  //  - false (explicit off, e.g. parsed source had no w:docGrid): omit.
  if (omitDefaults ? typeof opts.grid === "object" : opts.grid !== false) {
    parts.push(docGridXml(linePitch, charSpace, gridType));
  }

  // Printer settings
  if (opts.printerSettingsId !== undefined) {
    parts.push(`<w:printerSettings r:id="${opts.printerSettingsId}"/>`);
  }

  // Revision (sectPrChange)
  if (opts.revision) {
    parts.push(stringifySectionPropertiesChange(opts.revision));
  }

  return parts.join("");
}

// ── Descriptor ──

/**
 * Section properties descriptor for DOCX `<w:sectPr>` elements.
 *
 * Produces complete XML directly from options — zero XmlComponent instances
 * in the hot path. All `create*()` + `.toXml()` calls eliminated in favor
 * of direct string concatenation.
 *
 * @example
 * ```typescript
 * const xml = sectionPropertiesDesc.stringify(sectPrOpts, ctx);
 * ```
 */
export const sectionPropertiesDesc: CustomDescriptor<
  SectionPropertiesDescriptorOptions,
  BodyContext,
  SectionPropertiesOptions
> = {
  kind: "custom",

  stringify(opts, _ctx) {
    return stringifySectionProperties(opts);
  },

  parse(el, _ctx) {
    return parseSectionPropertiesEl(el);
  },
};

/** The w:sectPr rsid attributes — identical set on the top-level element and
 *  on the revision snapshot inside w:sectPrChange. */
function sectPrRsidAttrs(opts: SectionPropertiesDescriptorOptions): string {
  const attrs: string[] = [];
  if (opts.runPropertiesRsid !== undefined) attrs.push(`w:rsidRPr="${opts.runPropertiesRsid}"`);
  if (opts.deletionRsid !== undefined) attrs.push(`w:rsidDel="${opts.deletionRsid}"`);
  if (opts.additionRsid !== undefined) attrs.push(`w:rsidR="${opts.additionRsid}"`);
  if (opts.sectionRsid !== undefined) attrs.push(`w:rsidSect="${opts.sectionRsid}"`);
  return attrs.length ? " " + attrs.join(" ") : "";
}

/** Standalone stringify — no context needed, pure options → XML. */
export function stringifySectionProperties(opts: SectionPropertiesDescriptorOptions): string {
  const inner = stringifySectionPropertiesInner(opts);
  return `<w:sectPr${sectPrRsidAttrs(opts)}>${inner}</w:sectPr>`;
}

// ── Parse (Element → SectionPropertiesOptions) ──

/** Parse a w:sectPr element into SectionPropertiesOptions. */
export function parseSectionPropertiesEl(el: Element): SectionPropertiesOptions {
  const opts: Partial<SectionPropertiesOptions> = {};

  // rsid attributes on w:sectPr element
  for (const [attrName, optKey] of [
    ["w:rsidR", "additionRsid"],
    ["w:rsidRPr", "runPropertiesRsid"],
    ["w:rsidDel", "deletionRsid"],
    ["w:rsidSect", "sectionRsid"],
  ] as const) {
    const val = attr(el, attrName);
    if (val) opts[optKey] = val;
  }

  // Page properties — pgSz, pgMar, pgNumType are independent per CT_SectPr
  // (each minOccurs=0). Do not gate pgMar/pgNumType on pgSz: a sectPr that
  // omits <w:pgSz> must still round-trip its margins and page-number type.

  // Page size — three states: object (source had w:pgSz → preserve),
  // false (parsed source had none → stringify omits), undefined (fresh →
  // the stringify-side default page size).
  const pgSz = findChild(el, "w:pgSz");
  if (pgSz) {
    const size: PageSizeProperties = {};
    const w = attrNum(pgSz, "w:w");
    const h = attrNum(pgSz, "w:h");
    const orient = attr(pgSz, "w:orient");
    if (orient === "landscape" && w !== undefined && h !== undefined) {
      size.width = h;
      size.height = w;
    } else {
      if (w !== undefined) size.width = w;
      if (h !== undefined) size.height = h;
    }
    if (orient) size.orientation = orient as PageSizeProperties["orientation"];
    const code = attrNum(pgSz, "w:code");
    if (code !== undefined) size.code = code;
    opts.pageSize = Object.keys(size).length > 0 ? size : false;
  } else {
    opts.pageSize = false;
  }

  // Page margins
  const pgMar = findChild(el, "w:pgMar");
  if (pgMar) {
    const margin: PageMarginProperties = {};
    for (const [a, o] of [
      ["w:top", "top"],
      ["w:right", "right"],
      ["w:bottom", "bottom"],
      ["w:left", "left"],
      ["w:header", "header"],
      ["w:footer", "footer"],
      ["w:gutter", "gutter"],
    ] as const) {
      const val = attrNum(pgMar, a);
      if (val !== undefined) margin[o] = val;
    }
    // Same three states as pageSize (object / false / undefined-fresh).
    opts.pageMargin = Object.keys(margin).length > 0 ? margin : false;
  } else {
    opts.pageMargin = false;
  }

  // Page number type
  const pgNumType = findChild(el, "w:pgNumType");
  if (pgNumType) {
    const pageNumberType: PageNumberTypeProperties = {};
    const start = attrNum(pgNumType, "w:start");
    if (start !== undefined) pageNumberType.start = start;
    const fmt = attr(pgNumType, "w:fmt");
    if (fmt && PAGE_NUMBER_FORMATS.includes(fmt)) {
      pageNumberType.format = fmt as PageNumberTypeProperties["format"];
    }
    const chapSep = attr(pgNumType, "w:chapSep");
    if (chapSep && PAGE_NUMBER_SEPARATORS.includes(chapSep)) {
      pageNumberType.separator = chapSep as PageNumberTypeProperties["separator"];
    }
    const chapStyle = attrNum(pgNumType, "w:chapStyle");
    if (chapStyle !== undefined) pageNumberType.chapterStyle = chapStyle;
    if (Object.keys(pageNumberType).length > 0) opts.pageNumberType = pageNumberType;
  }

  // Columns
  const cols = findChild(el, "w:cols");
  if (cols) {
    const column: ColumnsProperties = {};
    const count = attrNum(cols, "w:num");
    if (count !== undefined) column.count = count;
    const space = attrMeasure(cols, "w:space");
    if (space !== undefined) column.space = space as ColumnsProperties["space"];
    const separate = attrBool(cols, "w:sep");
    if (separate !== undefined) column.separate = separate;
    const equalWidth = attrBool(cols, "w:equalWidth");
    if (equalWidth !== undefined) column.equalWidth = equalWidth;
    const colChildren: ColumnProperties[] = [];
    for (const colEl of cols.elements ?? []) {
      if (colEl.name !== "w:col") continue;
      const width = attrMeasure(colEl, "w:w");
      if (width === undefined) continue;
      const colAttr: ColumnProperties = { width: width as ColumnProperties["width"] };
      const colSpace = attrMeasure(colEl, "w:space");
      if (colSpace !== undefined) colAttr.space = colSpace as ColumnProperties["space"];
      colChildren.push(colAttr);
    }
    if (colChildren.length > 0) column.children = colChildren;
    if (Object.keys(column).length > 0) opts.columns = column;
  }

  // Section type
  const type = findChild(el, "w:type");
  if (type) {
    const val = attr(type, "w:val");
    if (val) opts.type = val as SectionPropertiesOptions["type"];
  }

  // Title page
  const titlePg = findChild(el, "w:titlePg");
  if (titlePg) opts.titlePage = attrBool(titlePg, "w:val") ?? true;

  // On/off properties
  for (const [name, optKey] of [
    ["w:noEndnote", "noEndnote"],
    ["w:formProt", "formProtection"],
    ["w:bidi", "bidi"],
    ["w:rtlGutter", "rtlGutter"],
  ] as const) {
    const child = findChild(el, name);
    if (child) opts[optKey] = attrBool(child, "w:val") ?? true;
  }

  // Document grid — three-state: object (source had w:docGrid → preserve),
  // false (source had none → explicit off so stringify omits it), undefined
  // (fresh generation, stringify emits the CJK default line grid).
  const docGrid = findChild(el, "w:docGrid");
  if (docGrid) {
    const grid: Partial<DocGridProperties> = {};
    const type = attr(docGrid, "w:type");
    if (type) grid.type = type as DocGridProperties["type"];
    const linePitch = attrNum(docGrid, "w:linePitch");
    if (linePitch !== undefined) grid.linePitch = linePitch;
    const charSpace = attrNum(docGrid, "w:charSpace");
    if (charSpace !== undefined) grid.charSpace = charSpace;
    opts.grid = grid as DocGridProperties;
  } else {
    opts.grid = false;
  }

  // Line numbers
  const lnNumType = findChild(el, "w:lnNumType");
  if (lnNumType) {
    const lineNumberType: LineNumberProperties = {};
    const countBy = attrNum(lnNumType, "w:countBy");
    if (countBy !== undefined) lineNumberType.countBy = countBy;
    const start = attrNum(lnNumType, "w:start");
    if (start !== undefined) lineNumberType.start = start;
    const restart = attr(lnNumType, "w:restart");
    if (restart) lineNumberType.restart = restart as LineNumberProperties["restart"];
    const distance = attrNum(lnNumType, "w:distance");
    if (distance !== undefined) lineNumberType.distance = distance;
    if (Object.keys(lineNumberType).length > 0) opts.lineNumberType = lineNumberType;
  }

  // Page borders
  const pgBorders = findChild(el, "w:pgBorders");
  if (pgBorders) {
    const borders: Partial<PageBordersOptions> = {};
    for (const side of ["top", "left", "bottom", "right"] as const) {
      const sideEl = findChild(pgBorders, `w:${side}`);
      if (!sideEl) continue;
      const val = attr(sideEl, "w:val");
      if (!val) continue; // CT_Border/@val is XSD-required
      const b: BorderOptions = { style: val as BorderOptions["style"] };
      const color = attr(sideEl, "w:color");
      if (color) b.color = color;
      const sz = attrNum(sideEl, "w:sz");
      if (sz !== undefined) b.size = sz;
      const space = attrNum(sideEl, "w:space");
      if (space !== undefined) b.space = space;
      borders[side] = b;
    }
    const display = attr(pgBorders, "w:display");
    if (display) borders.display = display as PageBordersOptions["display"];
    const offsetFrom = attr(pgBorders, "w:offsetFrom");
    if (offsetFrom) borders.offsetFrom = offsetFrom as PageBordersOptions["offsetFrom"];
    const zOrder = attr(pgBorders, "w:zOrder");
    if (zOrder) borders.zOrder = zOrder as PageBordersOptions["zOrder"];
    if (Object.keys(borders).length > 0) opts.pageBorders = borders as PageBordersOptions;
  }

  // Vertical align
  const vAlign = findChild(el, "w:vAlign");
  if (vAlign) {
    const val = attr(vAlign, "w:val");
    if (val) opts.verticalAlign = val as SectionPropertiesOptions["verticalAlign"];
  }

  // Text direction
  const textDirection = findChild(el, "w:textDirection");
  if (textDirection) {
    const val = attr(textDirection, "w:val");
    if (val) opts.textDirection = val as SectionPropertiesOptions["textDirection"];
  }

  // Footnote properties
  const footnotePr = findChild(el, "w:footnotePr");
  if (footnotePr) {
    opts.footnoteProperties = parseNotePropertiesEl(footnotePr);
  }

  // Endnote properties
  const endnotePr = findChild(el, "w:endnotePr");
  if (endnotePr) {
    opts.endnoteProperties = parseNotePropertiesEl(endnotePr) as EndnotePropertiesOptions;
  }

  // Paper source
  const paperSrc = findChild(el, "w:paperSrc");
  if (paperSrc) {
    const ps: NonNullable<SectionPropertiesOptions["paperSrc"]> = {};
    const first = attrNum(paperSrc, "w:first");
    if (first !== undefined) ps.first = first;
    const other = attrNum(paperSrc, "w:other");
    if (other !== undefined) ps.other = other;
    if (Object.keys(ps).length > 0) opts.paperSrc = ps;
  }

  // Printer settings (w:printerSettings) is not round-tripped: the binary
  // part behind the r:id is not carried over, so keeping the reference would
  // emit a dangling id.

  // Header/footer references are not emitted: users author headers/footers
  // on the section (SectionOptions.headers/footers), and the round-trip path
  // re-creates the wiring from the parsed header/footer parts (parse/body.ts).

  // Revision (w:sectPrChange) — symmetric with stringifySectionPropertiesChange
  const sectPrChange = findChild(el, "w:sectPrChange");
  if (sectPrChange) {
    const rev: Partial<SectionPropertiesChangeOptions> = {};
    const author = attr(sectPrChange, "w:author");
    if (author) rev.author = author;
    const revDate = attr(sectPrChange, "w:date");
    if (revDate) rev.date = revDate;
    const revId = attrNum(sectPrChange, "w:id");
    if (revId !== undefined) rev.id = revId;
    const innerSectPr = findChild(sectPrChange, "w:sectPr");
    if (innerSectPr) Object.assign(rev, parseSectionPropertiesEl(innerSectPr));
    if (Object.keys(rev).length > 0) opts.revision = rev as SectionPropertiesChangeOptions;
  }

  return opts;
}

function parseNotePropertiesEl(el: Element): FootnotePropertiesOptions {
  const opts: FootnotePropertiesOptions = {};

  const posEl = findChild(el, "w:pos");
  if (posEl) {
    const val = attr(posEl, "w:val");
    if (val) opts.pos = val as FootnotePropertiesOptions["pos"];
  }

  const numFmt = findChild(el, "w:numFmt");
  if (numFmt) {
    // CT_NumFmt: w:val (format type) + w:format (optional override).
    const fmt = attr(numFmt, "w:val");
    if (fmt) opts.formatType = fmt as FootnotePropertiesOptions["formatType"];
    const format = attr(numFmt, "w:format");
    if (format) opts.format = format;
  }

  const numStart = findChild(el, "w:numStart");
  if (numStart) {
    const val = attrNum(numStart, "w:val");
    if (val !== undefined) opts.numStart = val;
  }

  const numRestart = findChild(el, "w:numRestart");
  if (numRestart) {
    const val = attr(numRestart, "w:val");
    if (val) opts.numRestart = val as FootnotePropertiesOptions["numRestart"];
  }

  return opts;
}
