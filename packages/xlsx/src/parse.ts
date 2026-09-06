/**
 * XLSX parsing — parse .xlsx files into structured data.
 *
 * @module
 */
import {
  appPropertiesDesc,
  contentTypesDesc,
  convertToEmu,
  customPropertiesDesc,
  parseArchive,
  parseCorePropsElement,
} from "@office-open/core";
import type { ParsedArchive } from "@office-open/core";
import {
  collectPassthroughParts,
  isEncryptedContainer,
  partPathToRelsPath,
  pickNonVisualDrawingProperties,
  resolveRelationshipTarget,
  toUint8Array,
  toUint8ArrayAsync,
} from "@office-open/core";
import type { DataType } from "@office-open/core";
import { chartSpaceDesc, userShapesDesc } from "@office-open/core/chart";
import type { ReadContext } from "@office-open/core/descriptor";
import { themeDesc } from "@office-open/core/theme";
import type { Element } from "@office-open/xml";
import type { ParseOptions } from "@office-open/xml";
import { attr, findChild } from "@office-open/xml";
import { calcChainDesc } from "@parts/calc-chain";
import { chartsheetDesc } from "@parts/chartsheet";
import type { ChartsheetOptions } from "@parts/chartsheet";
import { commentsDesc, mergeNoteAnchors, vmlNotesDesc } from "@parts/comments";
import { connectionsDesc } from "@parts/connection";
import { dialogsheetDesc } from "@parts/dialogsheet";
import type { DialogsheetOptions } from "@parts/dialogsheet";
import { drawingDesc, pickAnchorOptions } from "@parts/drawing";
import { externalLinkDesc } from "@parts/external-link";
import type { ExternalLinkOptions } from "@parts/external-link";
import type { SharedWorkbookOptions, WorkbookOptions } from "@parts/file";
import { metadataDesc } from "@parts/metadata";
import { pivotCacheDefDesc, pivotCacheRecordsDesc } from "@parts/pivot-cache";
import type { PivotCacheDefParseResult, PivotCacheRecordsParseResult } from "@parts/pivot-cache";
import { queryTableDesc } from "@parts/query-table";
import type { QueryTableOptions } from "@parts/query-table";
import {
  revisionHeadersDesc,
  revisionLogDesc,
  usersDesc,
  type RevisionLogOptions,
} from "@parts/revision-log";
import { sharedStringsDesc } from "@parts/shared-strings";
import { stylesDesc } from "@parts/styles";
import { tableDesc } from "@parts/table";
import type { TableOptions } from "@parts/table";
import { parseVolTypesEl } from "@parts/vol-types";
import { workbookDesc } from "@parts/workbook";
import type { PivotCacheReference } from "@parts/workbook";
import type { RichTextOptions } from "@parts/worksheet";
import { worksheetDesc } from "@parts/worksheet";
import type {
  WorksheetChartOptions,
  WorksheetSmartArtOptions,
  PictureOptions,
  WorksheetOptions,
} from "@parts/worksheet";
import { mapInfoDesc, singleXmlCellsDesc } from "@parts/xml-mapping";
import type { SingleXmlCellOptions } from "@parts/xml-mapping";

import { XlsxReadContext } from "./context";

export { parseArchive };

// ── Low-level parse result ──

export interface XlsxPartRefs {
  worksheets: string[];
  charts: string[];
  media: string[];
  drawings: string[];
}

export interface XlsxDocument {
  doc: ParsedArchive;
  /** xl/workbook.xml root element */
  workbook?: Element;
  /** Worksheet paths (xl/worksheets/sheet{n}.xml) */
  worksheets: string[];
  /** xl/styles.xml root element */
  styles?: Element;
  /** xl/sharedStrings.xml root element */
  sharedStrings?: Element;
  /** xl/theme/theme{n}.xml path (resolved from workbook rels) */
  theme?: string;
  partRefs: XlsxPartRefs;
  /** docProps/core.xml path */
  coreProps?: string;
  /** docProps/app.xml path */
  appProps?: string;
  /** docProps/custom.xml path */
  customProps?: string;
}

const LEADING_PATH_NUMBER = /(\d+)/;

function sortByNumber(paths: string[]): string[] {
  // Decorate-sort: extract each path's number once instead of per comparison.
  return paths
    .map((p) => ({ p, n: parseInt(p.match(LEADING_PATH_NUMBER)?.[1] ?? "0", 10) }))
    .sort((a, b) => a.n - b.n)
    .map(({ p }) => p);
}

/**
 * Fill a parsed chart's userShapes anchors from the companion part body —
 * chartSpaceDesc reads only the c:userShapes r:id; the body hangs off the
 * chart part's own rels (chartUserShapes relationship).
 */
function readChartUserShapes(
  chartPath: string | undefined,
  chart: { userShapes?: { relationshipId?: string; anchors: unknown[] } },
  readContext: XlsxReadContext,
  doc: XlsxDocument["doc"],
): void {
  const rid = chart.userShapes?.relationshipId;
  if (rid === undefined || chartPath === undefined) return;
  const rel = readContext
    .getWorksheetRelsByType(chartPath, "/chartUserShapes")
    .find((r) => r.rId === rid);
  const bodyEl = rel ? doc.get(rel.target) : undefined;
  if (!bodyEl) return;
  const body = userShapesDesc.parse(bodyEl, readContext);
  chart.userShapes = { ...chart.userShapes, anchors: body.anchors };
}

/**
 * Worksheet parts read with sheetData deferred — the XML parser captures the
 * container's inner XML verbatim and `parseSheetDataRows` walks it directly.
 */
const WORKSHEET_PARSE_OPTIONS: ParseOptions = { deferElements: ["sheetData"] };

/**
 * Parse raw .xlsx data into a low-level XlsxDocument.
 */
export function parseXlsx(data: DataType): XlsxDocument {
  const uint8 = toUint8Array(data);
  const doc = parseArchive(uint8);

  const workbook = doc.get("xl/workbook.xml");
  const styles = doc.get("xl/styles.xml");
  const sharedStrings = doc.get("xl/sharedStrings.xml");

  // Resolve worksheet paths from workbook rels
  const worksheets: string[] = [];
  const charts: string[] = [];
  const drawings: string[] = [];
  const media: string[] = [];
  let theme: string | undefined;

  const wbRels = doc.get("xl/_rels/workbook.xml.rels");
  if (wbRels) {
    for (const child of wbRels.elements ?? []) {
      if (child.name !== "Relationship") continue;
      const type = attr(child, "Type") ?? "";
      const target = attr(child, "Target") ?? "";
      if (!target) continue;

      if (type.includes("/worksheet")) {
        worksheets.push(target.startsWith("/") ? target.slice(1) : `xl/${target}`);
      } else if (type.includes("/theme")) {
        theme = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
      }
    }
  }
  sortByNumber(worksheets);

  // Scan for drawings, charts, media
  drawings.push(...doc.keys("xl/drawings/").filter((k) => k.endsWith(".xml")));
  // userShapes companions of chart parts are not chart parts themselves
  charts.push(
    ...doc.keys("xl/charts/").filter((k) => k.endsWith(".xml") && !/userShapes\d+\.xml$/.test(k)),
  );
  media.push(...doc.keys("xl/media/"));
  sortByNumber(drawings);
  sortByNumber(charts);

  // Root rels → core/app props
  let coreProps: string | undefined;
  let appProps: string | undefined;
  let customProps: string | undefined;
  const rootRels = doc.get("_rels/.rels");
  if (rootRels) {
    for (const child of rootRels.elements ?? []) {
      if (child.name !== "Relationship") continue;
      const type = attr(child, "Type") ?? "";
      const target = attr(child, "Target") ?? "";
      // Transitional packages use the oclc URI form with camelCase segments
      // (…/extendedProperties); normalize case and hyphens so both resolve.
      const relType = type.toLowerCase().replaceAll("-", "");
      if (relType.includes("/coreproperties")) coreProps = target;
      else if (relType.includes("/extendedproperties")) appProps = target;
      else if (relType.includes("/customproperties")) customProps = target;
    }
  }

  return {
    doc,
    workbook,
    worksheets,
    styles,
    sharedStrings,
    theme,
    partRefs: { worksheets, charts, media, drawings },
    coreProps,
    appProps,
    customProps,
  };
}

// ── Shared strings helper ──

/**
 * Parse a .xlsx file and convert it into WorkbookOptions.
 *
 * Async so that `Blob` (including `File`) and `ReadableStream` inputs are
 * accepted alongside raw bytes — parts are indexed and decompressed on
 * demand. The returned options can be passed to `new Workbook(parsed)`.
 */
export async function parseWorkbook(data: DataType): Promise<WorkbookOptions> {
  return parseWorkbookFromBytes(await toUint8ArrayAsync(data));
}

/**
 * Synchronous counterpart of {@link parseWorkbook}: same result, but `Blob`
 * and `ReadableStream` inputs throw (normalize them to bytes first, or use
 * the async entry).
 */
export function parseWorkbookSync(data: DataType): WorkbookOptions {
  return parseWorkbookFromBytes(toUint8Array(data));
}

function parseWorkbookFromBytes(uint8: Uint8Array): WorkbookOptions {
  // Encrypted package (OLE2/CFB container): the plaintext needs the password,
  // so carry the source bytes verbatim for generate() to re-emit.
  if (isEncryptedContainer(uint8)) {
    return { encrypted: { data: uint8 } };
  }

  const xlsx = parseXlsx(uint8);

  const opts: Partial<WorkbookOptions> = {};

  // Core properties
  if (xlsx.coreProps) {
    const corePropsEl = xlsx.doc.get(xlsx.coreProps);
    if (corePropsEl) {
      const cp = parseCorePropsElement(corePropsEl);
      // Empty strings are meaningful (element present, text empty) — assign
      // the whole shape so they survive round-trip.
      Object.assign(opts, cp);
    }
  }

  // Extended (app) properties
  if (xlsx.appProps) {
    const appPropsEl = xlsx.doc.get(xlsx.appProps);
    if (appPropsEl) {
      const ap = appPropertiesDesc.parse(appPropsEl, {} as ReadContext);
      if (ap && Object.keys(ap).length > 0) opts.appProperties = ap;
    }
  }

  // Custom properties
  if (xlsx.customProps) {
    const customPropsEl = xlsx.doc.get(xlsx.customProps);
    if (customPropsEl) {
      const cp = customPropertiesDesc.parse(customPropsEl, {} as ReadContext);
      if (cp.properties?.length) opts.customProperties = cp.properties;
    }
  }

  // Shared strings — rich-text entries flow through as objects so both the
  // cell lookup and the rebuilt table keep their structure; generate() seeds
  // the write context from opts.sharedStrings to preserve si indices.
  let sstEntries: (string | RichTextOptions)[] = [];
  if (xlsx.sharedStrings) {
    sstEntries = sharedStringsDesc.parse(xlsx.sharedStrings, {} as never).entries;
  }
  if (sstEntries.length > 0) opts.sharedStrings = sstEntries;

  // Create read context for descriptor pipeline
  const readContext = new XlsxReadContext(xlsx, sstEntries);

  // Pivot cache definitions, keyed by part path — surfaced on
  // WorkbookOptions.pivotCaches for the model layer.
  const pivotCacheByPath = new Map<string, PivotCacheDefParseResult>();
  for (const key of xlsx.doc.keys("xl/pivotCache/")) {
    if (!key.includes("pivotCacheDefinition")) continue;
    const pcdEl = xlsx.doc.get(key);
    if (!pcdEl) continue;
    pivotCacheByPath.set(key, pivotCacheDefDesc.parse(pcdEl, readContext));
  }
  // workbook.xml pivotCaches: cacheId → rId reference chain.
  const pivotCacheRefs: PivotCacheReference[] = [];
  const wbPivotCaches = xlsx.workbook ? findChild(xlsx.workbook, "pivotCaches") : undefined;
  for (const pc of wbPivotCaches?.elements ?? []) {
    if (pc.name !== "pivotCache") continue;
    const cacheId = attr(pc, "cacheId");
    const rId = attr(pc, "r:id");
    if (cacheId === undefined || rId === undefined) continue;
    pivotCacheRefs.push({ cacheId: Number(cacheId), rId });
  }
  if (pivotCacheRefs.length > 0) opts.pivotCacheRefs = pivotCacheRefs;

  // Parse styles (fonts, fills, borders, cellXfs)
  if (xlsx.styles) {
    const parsedStyles = stylesDesc.parse(xlsx.styles, readContext);

    // Expose styles sections onto the returned opts for round-trip. The six
    // table sections fall back to [] so `undefined` keeps meaning "fresh
    // document" — an adopted table (even empty, e.g. a bare <styleSheet/>) is
    // distinct from the compiler's fresh-file defaults. fonts/fills/borders/
    // cellXfs/numFmts adopt the parsed table wholesale: cells then keep raw
    // style indices (the source's own numbering) instead of resolved
    // definitions — the SDK's Stylesheet model.
    if (parsedStyles.dxfs) opts.dxfs = parsedStyles.dxfs;
    opts.fonts = parsedStyles.fonts ?? [];
    opts.fills = parsedStyles.fills ?? [];
    opts.borders = parsedStyles.borders ?? [];
    opts.cellXfs = parsedStyles.cellXfs ?? [];
    if (parsedStyles.numFmts) opts.numFmts = parsedStyles.numFmts;
    if (parsedStyles.colors) opts.colors = parsedStyles.colors;
    // Optional sections: undefined (absent) stays absent; a present-but-empty
    // section round-trips as an empty container.
    if (parsedStyles.customCellStyles !== undefined)
      opts.cellStyles = parsedStyles.customCellStyles;
    if (parsedStyles.cellStyleXfs !== undefined) opts.cellStyleXfs = parsedStyles.cellStyleXfs;
    if (parsedStyles.styleExtensions) opts.styleExtensions = parsedStyles.styleExtensions;
    if (parsedStyles.tableStylesInfo)
      opts.tableStyles = parsedStyles.tableStylesInfo.tableStyles ?? [];
  }

  // Theme — structured round-trip so a custom source theme survives instead of
  // being replaced by the compiler's fresh default. Parsed under the theme
  // part's own rels scope so a blip fill's r:embed resolves to the theme's
  // image, not to whatever the workbook rels hide under the same rId.
  if (xlsx.theme) {
    const themeEl = xlsx.doc.get(xlsx.theme);
    if (themeEl) {
      const themeOptions = readContext.withPart(xlsx.theme, () =>
        themeDesc.parse(themeEl, readContext),
      );
      if (themeOptions) opts.theme = themeOptions;
    }
  }

  // Parse workbook via descriptor for richer data
  let sheetNames: string[] = [];
  let sheetIds: number[] = [];
  let sheetStates: Array<"visible" | "hidden" | "veryHidden" | undefined> = [];
  if (xlsx.workbook) {
    const wbData = workbookDesc.parse(xlsx.workbook, readContext);
    if (wbData.sheets) {
      sheetNames = wbData.sheets.map((s) => s.name);
      sheetIds = wbData.sheets.map((s) => s.sheetId);
      sheetStates = wbData.sheets.map((s) => s.state);
    }

    // Workbook-level properties
    if (wbData.protection) opts.workbookProtection = wbData.protection;
    if (wbData.bookView) opts.bookView = wbData.bookView;
    if (wbData.calculation) opts.calculation = wbData.calculation;
    if (wbData.oleSize) opts.oleSize = wbData.oleSize;
    if (wbData.customViews) opts.customWorkbookViews = wbData.customViews;
    if (wbData.fileRecovery) opts.fileRecovery = wbData.fileRecovery;
    if (wbData.functionGroups) opts.functionGroups = wbData.functionGroups;
    if (wbData.webPublishing) opts.webPublishing = wbData.webPublishing;
    if (wbData.fileSharing) opts.fileSharing = wbData.fileSharing;
    if (wbData.properties) opts.properties = wbData.properties;
    if (wbData.webPublishObjects) opts.webPublishObjects = wbData.webPublishObjects;
    if (wbData.definedNames) opts.definedNames = wbData.definedNames;
    if (wbData.absPath !== undefined) opts.absPath = wbData.absPath;
    if (wbData.revisionPtr) opts.revisionPtr = wbData.revisionPtr;
    if (wbData.extensions) opts.extensions = wbData.extensions;
  }

  // Parse worksheets using descriptor pipeline. Worksheet parts defer
  // sheetData — the row scanner walks the captured inner XML, skipping the
  // per-cell Element tree (the dominant allocation cost on large sheets).
  const worksheets: WorksheetOptions[] = [];
  for (const [i, wsPath] of xlsx.worksheets.entries()) {
    const wsEl = xlsx.doc.get(wsPath, WORKSHEET_PARSE_OPTIONS);
    if (!wsEl) continue;

    const wsOpts = worksheetDesc.parse(wsEl, readContext);
    if (sheetNames[i]) wsOpts.name = sheetNames[i];
    if (sheetIds[i] !== undefined) wsOpts.sheetId = sheetIds[i];
    if (sheetStates[i]) wsOpts.state = sheetStates[i];

    // ── Resolve sub-parts via worksheet relationships ──

    // Comments
    const commentRels = readContext.getWorksheetRelsByType(wsPath, "/comments");
    for (const cr of commentRels) {
      const commentEl = xlsx.doc.get(cr.target);
      if (!commentEl) continue;
      const commentData = commentsDesc.parse(commentEl, readContext);
      if (commentData.comments) {
        wsOpts.comments = commentData.comments;
        break; // one comments file per worksheet
      }
    }

    // Note anchors (vmlDrawing) — merge per-note placement into the comments
    // so custom position/size/visibility survive the round-trip.
    const vmlRels = readContext.getWorksheetRelsByType(wsPath, "/vmlDrawing");
    for (const vr of vmlRels) {
      const vmlEl = xlsx.doc.get(vr.target);
      if (!vmlEl) continue;
      mergeNoteAnchors(wsOpts.comments, vmlNotesDesc.parse(vmlEl, readContext));
      break; // one vmlDrawing per worksheet
    }

    // Drawings (images + charts)
    const drawingRels = readContext.getWorksheetRelsByType(wsPath, "/drawing");
    for (const dr of drawingRels) {
      const drawingEl = xlsx.doc.get(dr.target);
      if (!drawingEl) continue;
      // cNvPr hyperlinks (a:hlinkClick) resolve through the drawing part's own
      // rels: internal targets resolve against the part path, External ones
      // (absolute URLs) stay verbatim. Fall back to the workbook context.
      const drawingRelById = new Map<string, { target: string; mode?: string }>();
      const drawingRelsEl = xlsx.doc.get(partPathToRelsPath(dr.target));
      for (const rel of drawingRelsEl?.elements ?? []) {
        if (rel.name !== "Relationship") continue;
        const id = rel.attributes?.["Id"];
        const target = rel.attributes?.["Target"];
        if (id === undefined || target === undefined) continue;
        const mode =
          rel.attributes?.["TargetMode"] !== undefined
            ? String(rel.attributes["TargetMode"])
            : undefined;
        drawingRelById.set(String(id), { target: String(target), mode });
      }
      const drawingCtx: ReadContext = {
        resolveRelationship: (rid) => {
          const rel = drawingRelById.get(rid);
          if (!rel) return readContext.resolveRelationship(rid);
          return rel.mode === "External"
            ? rel.target
            : resolveRelationshipTarget(dr.target, rel.target);
        },
        getPart: (path) => readContext.getPart(path),
        getRaw: (path) => readContext.getRaw(path),
      };
      const drawingData = drawingDesc.parse(drawingEl, drawingCtx);
      // drawingDesc.parse yields CT-layer anchors (rId-anchored DrawingImage/
      // DrawingChart); bridge them to the user-layer shapes the compiler
      // consumes: image bytes are read back through the drawing's image
      // relationships, chart parts through the core chartSpace descriptor.
      if (drawingData.images) {
        const images: PictureOptions[] = [];
        for (const image of drawingData.images) {
          // Linked source (a:blip @r:link): only an External relationship
          // carries a usable URL; internal link targets have no media part.
          const linkRel = image.linkRId ? drawingRelById.get(image.linkRId) : undefined;
          const sourceUrl = linkRel?.mode === "External" ? linkRel.target : undefined;
          const mediaPath = image.rId
            ? readContext.resolveWorksheetRel(dr.target, image.rId)
            : undefined;
          const raw = mediaPath ? xlsx.doc.getRaw(mediaPath) : undefined;
          const ext = mediaPath?.split(".").pop();
          if (
            !raw ||
            (ext !== "png" && ext !== "jpeg" && ext !== "jpg" && ext !== "wmf" && ext !== "emf")
          ) {
            // Linked-only picture (no bytes in the package): keep the URL,
            // derive the type token from it (png fallback for extension-less).
            if (sourceUrl !== undefined) {
              const linkExt = sourceUrl.split(".").pop()?.toLowerCase() ?? "";
              images.push({
                type:
                  linkExt === "wmf"
                    ? "wmf"
                    : linkExt === "emf"
                      ? "emf"
                      : linkExt === "jpg" || linkExt === "jpeg"
                        ? "jpg"
                        : "png",
                sourceUrl,
                ...pickAnchorOptions(image),
                name: image.name,
                description: image.description,
                title: image.title,
                hidden: image.hidden,
                ...(image.properties ? { properties: image.properties } : {}),
                ...(image.blackWhiteMode ? { blackWhiteMode: image.blackWhiteMode } : {}),
                ...(image.sourceRectangle ? { sourceRectangle: image.sourceRectangle } : {}),
                ...(image.preferRelativeResize !== undefined
                  ? { preferRelativeResize: image.preferRelativeResize }
                  : {}),
                ...(image.blipEffects ? { blipEffects: image.blipEffects } : {}),
                ...(image.useLocalDpi !== undefined ? { useLocalDpi: image.useLocalDpi } : {}),
                ...(image.blipExt !== undefined ? { blipExt: image.blipExt } : {}),
                ...(image.locking ? { locking: image.locking } : {}),
                ...(image.hyperlink ? { hyperlink: image.hyperlink } : {}),
                ...(image.zOrder !== undefined ? { zOrder: image.zOrder } : {}),
                ...(image.shapeId !== undefined ? { shapeId: image.shapeId } : {}),
              });
            }
            continue;
          }
          // WMF/EMF clip-art images round-trip like raster ones (the media
          // store keeps their bytes and extension verbatim).
          const type =
            ext === "png" ? "png" : ext === "wmf" ? "wmf" : ext === "emf" ? "emf" : "jpg";
          images.push({
            data: raw,
            type,
            ...(sourceUrl !== undefined ? { sourceUrl } : {}),
            ...pickAnchorOptions(image),
            name: image.name,
            description: image.description,
            title: image.title,
            hidden: image.hidden,
            ...(image.properties ? { properties: image.properties } : {}),
            ...(image.blackWhiteMode ? { blackWhiteMode: image.blackWhiteMode } : {}),
            ...(image.sourceRectangle ? { sourceRectangle: image.sourceRectangle } : {}),
            ...(image.preferRelativeResize !== undefined
              ? { preferRelativeResize: image.preferRelativeResize }
              : {}),
            ...(image.blipEffects ? { blipEffects: image.blipEffects } : {}),
            ...(image.useLocalDpi !== undefined ? { useLocalDpi: image.useLocalDpi } : {}),
            ...(image.blipExt !== undefined ? { blipExt: image.blipExt } : {}),
            ...(image.locking ? { locking: image.locking } : {}),
            ...(image.hyperlink ? { hyperlink: image.hyperlink } : {}),
            ...(image.zOrder !== undefined ? { zOrder: image.zOrder } : {}),
            ...(image.shapeId !== undefined ? { shapeId: image.shapeId } : {}),
          });
        }
        if (images.length > 0) wsOpts.images = images;
      }
      if (drawingData.charts) {
        const charts: WorksheetChartOptions[] = [];
        for (const anchor of drawingData.charts) {
          const chartPath = readContext.resolveWorksheetRel(dr.target, anchor.rId);
          const chartEl = chartPath ? xlsx.doc.get(chartPath) : undefined;
          if (!chartEl) continue;
          const chartSpace = chartSpaceDesc.parse(chartEl, readContext);
          readChartUserShapes(chartPath, chartSpace, readContext, xlsx.doc);
          // cNvPr @title stays unbridged (same rule as the compiler leg):
          // WorksheetChartOptions.title is the chart title, not the frame's.
          const chartCnvPr = pickNonVisualDrawingProperties(anchor);
          delete chartCnvPr.title;
          charts.push({
            ...chartSpace,
            ...pickAnchorOptions(anchor),
            ...chartCnvPr,
            ...(anchor.frameLocks ? { frameLocks: anchor.frameLocks } : {}),
            ...(anchor.macro !== undefined ? { macro: anchor.macro } : {}),
            ...(anchor.hyperlink ? { hyperlink: anchor.hyperlink } : {}),
            ...(anchor.zOrder !== undefined ? { zOrder: anchor.zOrder } : {}),
            ...(anchor.shapeId !== undefined ? { shapeId: anchor.shapeId } : {}),
          });
        }
        if (charts.length > 0) wsOpts.charts = charts;
      }
      if (drawingData.smartArts) {
        const smartArts: WorksheetSmartArtOptions[] = [];
        for (const anchor of drawingData.smartArts) {
          // The diagram parts themselves pass through verbatim; carry their
          // package-absolute paths so the compiler can re-wire the drawing rels.
          const dataPath = readContext.resolveWorksheetRel(dr.target, anchor.dataRId);
          const layoutPath = readContext.resolveWorksheetRel(dr.target, anchor.layoutRId);
          const quickStylePath = readContext.resolveWorksheetRel(dr.target, anchor.quickStyleRId);
          const colorsPath = readContext.resolveWorksheetRel(dr.target, anchor.colorsRId);
          if (!dataPath || !layoutPath || !quickStylePath || !colorsPath) continue;
          smartArts.push({
            ...pickAnchorOptions(anchor),
            ...pickNonVisualDrawingProperties(anchor),
            dataPath,
            layoutPath,
            quickStylePath,
            colorsPath,
            ...(anchor.frameLocks ? { frameLocks: anchor.frameLocks } : {}),
            ...(anchor.macro !== undefined ? { macro: anchor.macro } : {}),
            ...(anchor.zOrder !== undefined ? { zOrder: anchor.zOrder } : {}),
            ...(anchor.shapeId !== undefined ? { shapeId: anchor.shapeId } : {}),
          });
        }
        if (smartArts.length > 0) wsOpts.smartArts = smartArts;
      }
      // Shapes/connectors/groups pass through unchanged (no media bridge).
      if (drawingData.shapes) wsOpts.shapes = drawingData.shapes;
      if (drawingData.connectors) wsOpts.connectors = drawingData.connectors;
      if (drawingData.groups) wsOpts.groups = drawingData.groups;
      break;
    }

    // Background picture — the worksheet-level image relationship backs the
    // <picture r:id/> element (drawing images live in the drawing part's own
    // rels, so worksheet-level image rels are backgrounds only).
    const bgRels = readContext.getWorksheetRelsByType(wsPath, "/image");
    for (const bg of bgRels) {
      const raw = xlsx.doc.getRaw(bg.target);
      const ext = bg.target.split(".").pop();
      if (!raw || (ext !== "png" && ext !== "jpeg" && ext !== "jpg")) continue;
      wsOpts.backgroundImage = { data: raw, type: ext === "png" ? "png" : "jpg" };
      break; // one background picture per worksheet
    }

    // Tables
    const tableRels = readContext.getWorksheetRelsByType(wsPath, "/table");
    if (tableRels.length > 0) {
      const tables: TableOptions[] = [];
      for (const tr of tableRels) {
        const tableEl = xlsx.doc.get(tr.target);
        if (!tableEl) continue;
        // The /table relationship also targets XML Map parts (singleXmlCells)
        // whose root is not a table — skip anything else instead of feeding
        // an unmodeled part through the table descriptor.
        if (tableEl.name !== "table") continue;
        const tableData = tableDesc.parse(tableEl, readContext);
        tables.push(tableData);
      }
      if (tables.length > 0) wsOpts.tables = tables;
    }

    // Query tables
    const queryTableRels = readContext.getWorksheetRelsByType(wsPath, "/queryTable");
    if (queryTableRels.length > 0) {
      const queryTables: QueryTableOptions[] = [];
      for (const qtr of queryTableRels) {
        const qtEl = xlsx.doc.get(qtr.target);
        if (!qtEl) continue;
        queryTables.push(queryTableDesc.parse(qtEl, readContext));
      }
      if (queryTables.length > 0) wsOpts.queryTables = queryTables;
    }

    // Single-cell XML tables
    const singleXmlCellRels = readContext.getWorksheetRelsByType(wsPath, "/tableSingleCells");
    if (singleXmlCellRels.length > 0) {
      const singleXmlCells: SingleXmlCellOptions[] = [];
      for (const sxr of singleXmlCellRels) {
        const sxEl = xlsx.doc.get(sxr.target);
        if (!sxEl) continue;
        singleXmlCells.push(...singleXmlCellsDesc.parse(sxEl, readContext).cells);
      }
      if (singleXmlCells.length > 0) wsOpts.singleXmlCells = singleXmlCells;
    }

    // Pivot tables — rebuild the user-layer shape from the CT-layer parse
    // result: field indices resolve against the cache definition's field
    // names, the data range against its worksheetSource.
    // PivotTable parts are NOT absorbed into the model here: the authoring
    // model (source ref + field-name rows/columns/data) is a lossy projection
    // that the compiler would rebuild from, reinterpreting the source. A
    // round-tripped pivot table stays in the verbatim passthrough set —
    // sheet-level pivotTable relationships re-attach via passthrough rels.

    // Resolve external hyperlink URLs
    const hyperlinks = wsOpts.hyperlinks;
    if (hyperlinks) {
      for (const hl of hyperlinks) {
        if (hl.url !== undefined) {
          const resolved = readContext.resolveWorksheetRel(wsPath, hl.url);
          if (resolved) hl.url = resolved;
        }
      }
    }

    worksheets.push(wsOpts as WorksheetOptions);
  }

  opts.worksheets = worksheets;

  // Chartsheets — parse chartsheet parts. Sort numerically: doc.keys() yields
  // ZIP entry order, while sheetNames indexes rely on sheetN.xml numbering.
  const chartsheetPaths = sortByNumber(
    xlsx.doc.keys("xl/chartsheets/").filter((k) => k.endsWith(".xml")),
  );
  if (chartsheetPaths.length > 0) {
    const chartsheets: ChartsheetOptions[] = [];
    for (const [i, csPath] of chartsheetPaths.entries()) {
      const csEl = xlsx.doc.get(csPath);
      if (!csEl) continue;
      const csData = chartsheetDesc.parse(csEl, readContext);
      if (sheetNames[worksheets.length + i]) csData.name = sheetNames[worksheets.length + i];
      if (sheetIds[worksheets.length + i] !== undefined)
        csData.sheetId = sheetIds[worksheets.length + i]!;
      if (sheetStates[worksheets.length + i]) csData.state = sheetStates[worksheets.length + i];
      // The chart itself lives in a drawing part — bridge it back through the
      // core chartSpace descriptor into the simplified chartsheet chart shape.
      const csDrawingRels = readContext.getWorksheetRelsByType(csPath, "/drawing");
      outer: for (const dr of csDrawingRels) {
        const drawingEl = xlsx.doc.get(dr.target);
        if (!drawingEl) continue;
        const drawingData = drawingDesc.parse(drawingEl, readContext);
        for (const anchor of drawingData.charts ?? []) {
          const chartPath = readContext.resolveWorksheetRel(dr.target, anchor.rId);
          const chartEl = chartPath ? xlsx.doc.get(chartPath) : undefined;
          if (!chartEl) continue;
          // Full chartSpace passthrough — the simplified type/title/series
          // projection dropped chartSpace-level fidelity (c:lang, c:date1904,
          // axis/plot formatting, …) on round-trip.
          csData.chart = chartSpaceDesc.parse(chartEl, readContext);
          readChartUserShapes(chartPath, csData.chart, readContext, xlsx.doc);
          if (anchor.macro !== undefined) csData.macro = anchor.macro;
          if (anchor.frameLocks) csData.frameLocks = anchor.frameLocks;
          // Anchor geometry is the rendered chart size on the sheet — Excel
          // keeps it verbatim on save, so round-trip must not fall back to the
          // full-page default. The drawing fields accept UniversalMeasure;
          // chartsheet anchors are plain EMU numbers.
          if (anchor.absoluteX !== undefined) csData.absoluteX = convertToEmu(anchor.absoluteX);
          if (anchor.absoluteY !== undefined) csData.absoluteY = convertToEmu(anchor.absoluteY);
          if (anchor.extentCx !== undefined) csData.extentCx = convertToEmu(anchor.extentCx);
          if (anchor.extentCy !== undefined) csData.extentCy = convertToEmu(anchor.extentCy);
          if (anchor.shapeId !== undefined) csData.shapeId = anchor.shapeId;
          break outer;
        }
      }
      chartsheets.push(csData);
    }
    if (chartsheets.length > 0) opts.chartsheets = chartsheets;
  }

  // Dialogsheets — parse legacy dialog sheet parts
  const dialogsheetPaths = xlsx.doc.keys("xl/dialogSheets/").filter((k) => k.endsWith(".xml"));
  if (dialogsheetPaths.length > 0) {
    const dialogsheets: DialogsheetOptions[] = [];
    for (const dsPath of dialogsheetPaths) {
      const dsEl = xlsx.doc.get(dsPath);
      if (!dsEl) continue;
      const dsData = dialogsheetDesc.parse(dsEl, readContext);
      dialogsheets.push(dsData);
    }
    if (dialogsheets.length > 0) opts.dialogsheets = dialogsheets;
  }

  // Pivot cache definitions (parsed into pivotCacheByPath above) and records
  if (pivotCacheByPath.size > 0) {
    opts.pivotCaches = [...pivotCacheByPath.values()];
  }

  const pivotCacheRecPaths = xlsx.doc
    .keys("xl/pivotCache/")
    .filter((k) => k.includes("pivotCacheRecords"));
  if (pivotCacheRecPaths.length > 0) {
    const pivotCacheRecords: PivotCacheRecordsParseResult[] = [];
    for (const pcrPath of pivotCacheRecPaths) {
      const pcrEl = xlsx.doc.get(pcrPath);
      if (!pcrEl) continue;
      const pcrData = pivotCacheRecordsDesc.parse(pcrEl, readContext);
      pivotCacheRecords.push(pcrData);
    }
    if (pivotCacheRecords.length > 0) opts.pivotCacheRecords = pivotCacheRecords;
  }

  // Calculation chain
  const calcChainEl = xlsx.doc.get("xl/calcChain.xml");
  if (calcChainEl) {
    const calcData = calcChainDesc.parse(calcChainEl, readContext);
    if (calcData.cells) opts.calcChain = calcData.cells;
  }

  // Connections (xl/connections.xml)
  const connectionsEl = xlsx.doc.get("xl/connections.xml");
  if (connectionsEl) {
    const connData = connectionsDesc.parse(connectionsEl, readContext);
    if (connData.connections.length > 0) opts.connections = connData.connections;
  }

  // Rich metadata (xl/metadata.xml)
  const metadataEl = xlsx.doc.get("xl/metadata.xml");
  if (metadataEl) {
    const metadataData = metadataDesc.parse(metadataEl, readContext);
    opts.metadata = metadataData;
  }

  // XML mappings (xl/xmlMaps.xml)
  const xmlMapsEl = xlsx.doc.get("xl/xmlMaps.xml");
  if (xmlMapsEl) {
    opts.xmlMaps = mapInfoDesc.parse(xmlMapsEl, readContext);
  }

  // Volatile function types (xl/volTypes.xml)
  const volTypesEl = xlsx.doc.get("xl/volTypes.xml");
  if (volTypesEl) {
    const volTypes = parseVolTypesEl(volTypesEl);
    if (volTypes.length > 0) opts.volTypes = volTypes;
  }

  // External links
  const extLinkPaths = xlsx.doc.keys("xl/externalLinks/").filter((k) => k.endsWith(".xml"));
  if (extLinkPaths.length > 0) {
    const externalLinks: ExternalLinkOptions[] = [];
    for (const elPath of extLinkPaths) {
      const elEl = xlsx.doc.get(elPath);
      if (!elEl) continue;
      const elData = externalLinkDesc.parse(elEl, readContext);

      // Resolve the external book target from the sibling rels file
      // (xl/externalLinks/_rels/externalLinkN.xml.rels), which compiler.ts writes.
      if (elData.externalBook) {
        const relsPath = partPathToRelsPath(elPath);
        const relsEl = xlsx.doc.get(relsPath);
        if (relsEl) {
          for (const child of relsEl.elements ?? []) {
            if (child.name !== "Relationship") continue;
            const type = attr(child, "Type") ?? "";
            if (!type.includes("/externalLinkPath")) continue;
            const target = attr(child, "Target");
            if (target) {
              elData.externalBook.target = target;
              break;
            }
          }
        }
      }

      externalLinks.push(elData);
    }
    if (externalLinks.length > 0) opts.externalLinks = externalLinks;
  }

  // Shared-workbook revisions: workbook.xml.rels → revisionHeaders/users;
  // revisionHeaders.xml.rels → per-header revision logs.
  const wbRelsEl2 = xlsx.doc.get("xl/_rels/workbook.xml.rels");
  let revHeadersTarget: string | undefined;
  let usersTarget: string | undefined;
  if (wbRelsEl2) {
    for (const child of wbRelsEl2.elements ?? []) {
      if (child.name !== "Relationship") continue;
      const type = attr(child, "Type") ?? "";
      const target = attr(child, "Target") ?? "";
      if (type.includes("/revisionHeaders")) revHeadersTarget = target;
      else if (type.includes("/users")) usersTarget = target;
    }
  }
  if (revHeadersTarget) {
    const headersPath = revHeadersTarget.startsWith("/")
      ? revHeadersTarget.slice(1)
      : `xl/${revHeadersTarget}`;
    const headersEl = xlsx.doc.get(headersPath);
    if (headersEl) {
      const headers = revisionHeadersDesc.parse(headersEl, readContext);
      const logs: RevisionLogOptions[] = [];
      const revHeadersRelsEl = xlsx.doc.get(partPathToRelsPath(headersPath));
      if (revHeadersRelsEl) {
        for (const child of revHeadersRelsEl.elements ?? []) {
          if (child.name !== "Relationship") continue;
          if (!(attr(child, "Type") ?? "").includes("/revisionLog")) continue;
          const t = attr(child, "Target");
          if (!t) continue;
          const logEl = xlsx.doc.get(t.startsWith("/") ? t.slice(1) : `xl/${t}`);
          if (logEl) logs.push(revisionLogDesc.parse(logEl, readContext));
        }
      }
      const revisionLog: SharedWorkbookOptions = { headers, logs };
      if (usersTarget) {
        const usersEl = xlsx.doc.get(
          usersTarget.startsWith("/") ? usersTarget.slice(1) : `xl/${usersTarget}`,
        );
        if (usersEl) {
          const users = usersDesc.parse(usersEl, readContext);
          if (users.users) revisionLog.users = users;
        }
      }
      opts.revisionLog = revisionLog;
    }
  }

  // Package-wide passthrough (SDK ExtendedPart analogue): every part the model
  // did NOT absorb is carried verbatim instead of dropped. Only parts the
  // compiler always re-emits are excluded — model-driven parts (themes,
  // sharedStrings, drawings, VML, external links) pass through and yield to
  // the compiler's own output at the same path by assembly order.
  const rebuilt: string[] = [
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    ...(xlsx.styles ? ["xl/styles.xml"] : []),
    ...(xlsx.coreProps ? [xlsx.coreProps] : []),
    ...(xlsx.appProps ? [xlsx.appProps] : []),
    ...(xlsx.customProps ? [xlsx.customProps] : []),
    ...xlsx.worksheets,
    ...chartsheetPaths,
    ...dialogsheetPaths,
  ];
  const { parts: passthroughParts, relationships: passthroughRels } = collectPassthroughParts(
    xlsx.doc,
    rebuilt,
  );
  if (passthroughParts.length > 0) opts.rawParts = passthroughParts;
  if (passthroughRels.length > 0) opts.passthroughRelationships = passthroughRels;

  // Source content-type declarations — the compiler keeps them as the base
  // table so round-trip preserves the Default/Override split as written.
  const sourceContentTypes = xlsx.doc.get("[Content_Types].xml");
  if (sourceContentTypes) {
    const ct = contentTypesDesc.parse(sourceContentTypes, {} as ReadContext);
    if (ct) opts.contentTypes = ct;
  }

  return opts as WorkbookOptions;
}
