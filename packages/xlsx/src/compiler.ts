/**
 * XLSX Compiler — compiles WorkbookOptions into a Zippable structure.
 *
 * Accepts pure JSON WorkbookOptions — no intermediate File class needed.
 * Uses XlsxWriteContext for shared state (strings, styles, media, charts).
 *
 * @module
 */

import {
  RELATIONSHIP_TYPES,
  Relationships,
  TargetModeType,
  appPropertiesDesc,
  buildCorePropertiesXmlString,
  buildRootRelationships,
  compileMapping,
  dropDanglingPassthroughRels,
  finalizeContentTypes,
  type PassthroughRelationship,
  type RelationshipType,
  pickNonVisualDrawingProperties,
  resolverFromRegistry,
  XLSX_PARTS,
  customPropertiesDesc,
  toUint8Array,
  IMAGE_MEDIA_CONTENT_TYPES,
  type XmlifyedFile,
  type Zippable,
} from "@office-open/core";
import { buildUserShapesData, chartSpaceDesc } from "@office-open/core/chart";
import { buildThemeXml } from "@office-open/core/theme";
import { escapeXml, OOXML_XML_DECLARATION } from "@office-open/xml";
import type { CalcCell } from "@parts/calc-chain";
import { calcChainDesc } from "@parts/calc-chain";
import { chartsheetDesc, type ChartsheetOptions } from "@parts/chartsheet";
import { commentsDesc, vmlNotesDesc } from "@parts/comments";
import { connectionsDesc } from "@parts/connection";
import { dialogsheetDesc, type DialogsheetOptions } from "@parts/dialogsheet";
import type {
  DrawingChartOptions,
  DrawingPictureOptions,
  DrawingSmartArtOptions,
} from "@parts/drawing";
import { pickAnchorOptions } from "@parts/drawing";
import { drawingDesc } from "@parts/drawing";
import { A_NS, R_NS, XDR_NS, graphicFrameXml, wrapAnchor } from "@parts/drawing/stringify";
import { externalLinkDesc } from "@parts/external-link";
import type { WorkbookOptions } from "@parts/file";
import { metadataDesc } from "@parts/metadata";
import type { MetadataOptions } from "@parts/metadata";
import { aggregate, profilePivotFields } from "@parts/pivot";
import type { PivotSourceData, PivotTableOptions } from "@parts/pivot";
import { pivotCacheDefDesc, pivotCacheRecordsDesc } from "@parts/pivot-cache";
import { pivotTableDesc } from "@parts/pivot-table";
import { queryTableDesc } from "@parts/query-table";
import { revisionHeadersDesc, revisionLogDesc, usersDesc } from "@parts/revision-log";
import { sharedStringsDesc } from "@parts/shared-strings";
import type { SharedStrings } from "@parts/shared-strings";
import { stylesDesc } from "@parts/styles";
import { tableDesc } from "@parts/table";
import { createThemeXml } from "@parts/theme";
import { buildVolTypesXml } from "@parts/vol-types";
import type { PivotCacheReference, TablePartReference, SheetDefinition } from "@parts/workbook";
import { workbookDesc, buildTablePartsXml, buildExternalReferencesXml } from "@parts/workbook";
import {
  buildWorksheetXml,
  editSheetTailMarker,
  stripWorksheetPlaceholders,
  type WorksheetContext,
} from "@parts/worksheet";
import type { RowOptions, WorksheetOptions } from "@parts/worksheet";
import { mapInfoDesc, singleXmlCellsDesc } from "@parts/xml-mapping";
import { columnToLetter, parseA1Cell } from "@util/index";

import { XlsxWriteContext } from "./context";

const XML_DECL = OOXML_XML_DECLARATION;

const IMAGE_REL = RELATIONSHIP_TYPES.image;

/**
 * Replace `{fileName}` media placeholders in compiled part XML with
 * relationship ids. Core fill descriptors register blip-fill images through
 * `ctx.addMedia`, which returns a placeholder because the owning part's rels
 * don't exist yet; a placeholder surviving into the part makes Excel refuse
 * the package. Each distinct image registers one relationship — consuming
 * parts (theme, drawings) live one level under `xl/`, so the media target is
 * always `../media/<name>`.
 */
function bindMediaPlaceholders(
  xml: string,
  media: XlsxWriteContext["media"],
  rels: Relationships,
): string {
  const names = new Set(media.array.map((m) => m.fileName));
  let usesMedia = false;
  for (const name of names) {
    if (xml.includes(`{${name}}`)) {
      usesMedia = true;
      break;
    }
  }
  if (!usesMedia) return xml;
  const ridByName = new Map<string, string>();
  return xml.replace(/\{([^{}]+)\}/g, (whole, name: string) => {
    let rid = ridByName.get(name);
    if (rid === undefined) {
      if (!names.has(name)) return whole;
      rid = `rId${rels.add(IMAGE_REL, `../media/${name}`)}`;
      ridByName.set(name, rid);
    }
    return rid;
  });
}

/** XLSX part path → content type, derived from the part registry. Matches
 * actual file paths, so the dense/sequential xlsx part naming is handled. */
const XLSX_CONTENT_TYPE_RESOLVER = resolverFromRegistry(XLSX_PARTS);

/** Chart part → user-shapes part relationship (c:userShapes bridge). */
const CHART_USER_SHAPES_REL = RELATIONSHIP_TYPES.chartUserShapes;
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

/** Extension → MIME for image and VML Default entries. Declared only for
 * extensions actually present in the package. VML backs legacy comment
 * anchors (xl/drawings/vmlDrawing${i}.vml). */
const XLSX_MEDIA_CONTENT_TYPES: Record<string, string> = {
  ...IMAGE_MEDIA_CONTENT_TYPES,
  vml: "application/vnd.openxmlformats-officedocument.vmlDrawing",
};

/** UTF-8 encoder for serializing the derived [Content_Types].xml into the package. */
const encoder = new TextEncoder();

/**
 * Compile workbook options into a Zippable structure.
 */
export function compileWorkbook(
  options: WorkbookOptions,
  overrides: XmlifyedFile[] = [],
  mediaLevel: number = 0,
): Zippable {
  const ctx = new XlsxWriteContext();
  const mapping: Record<string, { data: string; path: string }> = {};

  // Seed the shared string table from parsed entries so round-tripped cells
  // keep their si indices and rich-text structure (identity dedup in
  // registerRich resolves the same entry object back to its source index).
  if (options.sharedStrings) ctx.sharedStrings.loadEntries(options.sharedStrings);

  const worksheetConfigs = options.worksheets ?? [];
  const chartsheetConfigs = options.chartsheets ?? [];
  const dialogsheetConfigs = options.dialogsheets ?? [];
  const hasCustomProperties = !!options.customProperties && options.customProperties.length > 0;

  // Core properties
  mapping["Properties"] = {
    data: XML_DECL + buildCorePropertiesXmlString(options),
    path: "docProps/core.xml",
  };

  // App properties
  mapping["AppProperties"] = {
    data: XML_DECL + (appPropertiesDesc.stringify(options.appProperties ?? {}, ctx) ?? ""),
    path: "docProps/app.xml",
  };

  // Custom properties (optional part; only emitted when present)
  if (hasCustomProperties) {
    mapping["CustomProperties"] = {
      data:
        XML_DECL +
        (customPropertiesDesc.stringify({ properties: options.customProperties ?? [] }, ctx) ?? ""),
      path: "docProps/custom.xml",
    };
  }

  // File-level relationships (_rels/.rels)
  const fileRels = buildRootRelationships(
    "xl/workbook.xml",
    hasCustomProperties,
    options.passthroughRelationships,
  );
  mapping["FileRelationships"] = {
    data: XML_DECL + fileRels.serialize(),
    path: "_rels/.rels",
  };

  // Register predefined DXFs before worksheets use styles. options.dxfs === []
  // means the source declared an empty <dxfs/> container — kept as-is.
  if (options.dxfs !== undefined) ctx.styles.setDxfs(options.dxfs);

  // Adopt the parsed style table wholesale (the SDK's Stylesheet model): fonts/
  // fills/borders/cellXfs/numFmts replace the fresh-file defaults, so raw cell
  // style indices carried by parsed rows resolve exactly as in the source.
  // fonts !== undefined is the "source styles.xml was parsed" signal (parse
  // fills all table sections with [] when the part exists, even bare).
  if (options.fonts !== undefined) {
    ctx.styles.adopt({
      fonts: options.fonts,
      fills: options.fills ?? [],
      borders: options.borders ?? [],
      cellXfs: options.cellXfs ?? [],
      numFmts: options.numFmts,
    });
  }

  // Re-apply parsed style sections so a declarative round-trip preserves
  // them (colors, table/cell styles, extensions) alongside DXFs.
  if (options.colors) ctx.styles.setColors(options.colors);
  if (options.tableStyles) ctx.styles.setTableStyles(options.tableStyles);
  if (options.cellStyles !== undefined) ctx.styles.setCustomCellStyles(options.cellStyles);
  if (options.cellStyleXfs !== undefined) ctx.styles.setCellStyleXfs(options.cellStyleXfs);
  if (options.styleExtensions) ctx.styles.setExtensions(options.styleExtensions);

  // Build workbook relationships
  buildWorkbookRelationships(
    ctx.workbookRels,
    worksheetConfigs.length,
    chartsheetConfigs.length,
    dialogsheetConfigs.length,
  );

  // Build sheet definitions for workbook XML. An explicit sheetId wins; the
  // fallback counter skips past every id handed out so ids stay unique even
  // when options mix explicit and generated values.
  const sheets: SheetDefinition[] = [];
  let sheetId = 1;
  const nextSheetId = (explicit: number | undefined): number => {
    const id = explicit ?? sheetId;
    if (id >= sheetId) sheetId = id + 1;
    return id;
  };
  let rId = 1;
  for (const ws of worksheetConfigs) {
    sheets.push({
      name: ws.name ?? `Sheet${sheetId}`,
      sheetId: nextSheetId(ws.sheetId),
      state: ws.state,
      rId: `rId${rId++}`,
    });
  }
  for (const cs of chartsheetConfigs) {
    sheets.push({
      name: cs.name ?? `Chart${sheetId}`,
      sheetId: nextSheetId(cs.sheetId),
      state: cs.state,
      rId: `rId${rId++}`,
    });
  }
  for (const ds of dialogsheetConfigs) {
    sheets.push({
      name: ds.name ?? `Dialog${sheetId}`,
      sheetId: nextSheetId(ds.sheetId),
      state: ds.state,
      rId: `rId${rId++}`,
    });
  }

  const wsContext: WorksheetContext = { sharedStrings: ctx.sharedStrings, styles: ctx.styles };
  const state: WorksheetCompileState = {
    globalMediaIdx: 0,
    globalChartIdx: 0,
    globalPivotIdx: 0,
    globalPivotCacheIdx: 0,
    globalTableIdx: 0,
    globalQueryTableIdx: 0,
    globalSingleXmlCellsIdx: 0,
    pivotCacheDataMap: new Map<string, { cacheId: number; cacheIdx: number }>(),
    calcCells: [],
    allTableParts: [],
  };
  for (const [i, wsOpts] of worksheetConfigs.entries()) {
    compileWorksheetPart(
      wsOpts,
      i,
      worksheetConfigs,
      ctx,
      mapping,
      wsContext,
      state,
      options.passthroughRelationships,
    );
  }

  compileChartsheets(chartsheetConfigs, ctx, mapping, options.passthroughRelationships);
  compileDialogsheets(dialogsheetConfigs, ctx, mapping);
  // Round-trip pivotCache references: register the passthrough pivotCache
  // definition relationship here (before the workbook XML below and the
  // generic workbook-rels replay later) so the element and the rels agree on
  // the possibly renumbered id.
  let rtPivotRefs: PivotCacheReference[] | undefined;
  if (options.pivotCacheRefs && options.pivotCacheRefs.length > 0) {
    rtPivotRefs = [];
    for (const ref of options.pivotCacheRefs) {
      const rel = (options.passthroughRelationships ?? []).find(
        (r) => r.source === "xl/workbook.xml" && r.rId === ref.rId,
      );
      if (!rel) continue;
      let rid = ctx.workbookRels.idOf(rel.relationshipType, rel.target);
      if (rid === undefined) {
        ctx.workbookRels.add(rel.relationshipType as RelationshipType, rel.target);
        rid = ctx.workbookRels.idOf(rel.relationshipType, rel.target);
      }
      if (rid) rtPivotRefs.push({ cacheId: ref.cacheId, rId: rid });
    }
  }
  // Workbook XML (via descriptor)
  let wbXml =
    workbookDesc.stringify(
      {
        sheets,
        pivotCaches: ctx.pivotCacheRefs.length > 0 ? ctx.pivotCacheRefs : (rtPivotRefs ?? []),
        protection: options.workbookProtection,
        customViews: options.customWorkbookViews,
        fileRecovery: options.fileRecovery,
        functionGroups: options.functionGroups,
        webPublishing: options.webPublishing,
        fileSharing: options.fileSharing,
        webPublishObjects: options.webPublishObjects,
        definedNames: options.definedNames,
        properties: options.properties,
        calculation: options.calculation,
        oleSize: options.oleSize,
        bookView: options.bookView,
        ...(options.absPath !== undefined ? { absPath: options.absPath } : {}),
        ...(options.revisionPtr ? { revisionPtr: options.revisionPtr } : {}),
        ...(options.extensions ? { extensions: options.extensions } : {}),
      },
      ctx,
    ) ?? "";

  // Connections — xl/connections.xml (single part, workbook-level relationship)
  if (options.connections && options.connections.length > 0) {
    const cRid = ctx.workbookRels.nextRelationshipId;
    ctx.workbookRels.addRelationship(cRid, RELATIONSHIP_TYPES.connections, "connections.xml");
    mapping["Connections"] = {
      data: XML_DECL + connectionsDesc.stringify({ connections: options.connections }, ctx),
      path: "xl/connections.xml",
    };
  }

  // Metadata — xl/metadata.xml (single part, workbook-level relationship)
  if (options.metadata && hasMetadataContent(options.metadata)) {
    const mRid = ctx.workbookRels.nextRelationshipId;
    ctx.workbookRels.addRelationship(mRid, RELATIONSHIP_TYPES.sheetMetadata, "metadata.xml");
    mapping["Metadata"] = {
      data: XML_DECL + metadataDesc.stringify(options.metadata, ctx),
      path: "xl/metadata.xml",
    };
  }

  // XML mappings — xl/xmlMaps.xml (single part, workbook-level relationship)
  if (options.xmlMaps) {
    const xRid = ctx.workbookRels.nextRelationshipId;
    ctx.workbookRels.addRelationship(xRid, RELATIONSHIP_TYPES.xmlMaps, "xmlMaps.xml");
    mapping["XmlMaps"] = {
      data: XML_DECL + mapInfoDesc.stringify(options.xmlMaps, ctx),
      path: "xl/xmlMaps.xml",
    };
  }

  // Volatile function types — xl/volTypes.xml (single part, workbook-level
  // relationship; sml.xsd declares volTypes as a part root, never a workbook child)
  if (options.volTypes && options.volTypes.length > 0) {
    const vRid = ctx.workbookRels.nextRelationshipId;
    ctx.workbookRels.addRelationship(vRid, RELATIONSHIP_TYPES.volTypes, "volTypes.xml");
    mapping["VolTypes"] = {
      data: XML_DECL + buildVolTypesXml(options.volTypes),
      path: "xl/volTypes.xml",
    };
  }

  // External links — generate XML files and inject externalReferences into workbook
  const extLinks = options.externalLinks ?? [];
  if (extLinks.length > 0) {
    const extRefs: { rId: string }[] = [];
    for (let ei = 0; ei < extLinks.length; ei++) {
      const elIdx = ei + 1;
      const elRid = ctx.workbookRels.nextRelationshipId;
      ctx.workbookRels.addRelationship(
        elRid,
        RELATIONSHIP_TYPES.externalLink,
        `externalLinks/externalLink${elIdx}.xml`,
      );

      // Create the rels file for this external link
      const elOpts = extLinks[ei];
      if (!elOpts) continue;
      let bookRId: string | undefined;
      if (elOpts.externalBook?.target) {
        const elRels = new Relationships();
        elRels.addRelationship(
          1,
          RELATIONSHIP_TYPES.externalLinkPath,
          elOpts.externalBook.target,
          TargetModeType.EXTERNAL,
        );
        bookRId = "rId1";
        mapping[`ExternalLinkRels${elIdx}`] = {
          data: XML_DECL + elRels.serialize(),
          path: `xl/externalLinks/_rels/externalLink${elIdx}.xml.rels`,
        };
      }

      // Generate the external link XML
      mapping[`ExternalLink${elIdx}`] = {
        data: XML_DECL + externalLinkDesc.stringify({ ...elOpts, bookRId }, ctx),
        path: `xl/externalLinks/externalLink${elIdx}.xml`,
      };

      extRefs.push({ rId: `rId${elRid}` });
    }

    // Inject externalReferences into workbook XML
    const extRefsXml = buildExternalReferencesXml(extRefs);
    wbXml = wbXml.replace("<!--EXTERNAL_REFS-->", extRefsXml);
  } else {
    wbXml = wbXml.replace("<!--EXTERNAL_REFS-->", "");
  }

  mapping["Workbook"] = {
    data: XML_DECL + wbXml,
    path: "xl/workbook.xml",
  };

  // Shared Strings — AFTER worksheets so all strings are collected
  if (ctx.sharedStrings.count > 0) {
    ctx.workbookRels.addRelationship(
      ctx.workbookRels.nextRelationshipId,
      RELATIONSHIP_TYPES.sharedStrings,
      "sharedStrings.xml",
    );
    const ssXml = sharedStringsDesc.stringify(ctx.sharedStrings.toDescriptorOptions(), ctx);
    mapping["SharedStrings"] = {
      data: XML_DECL + ssXml,
      path: "xl/sharedStrings.xml",
    };
  }

  // Styles (via descriptor — delegates to Styles.toXml internally)
  const stylesXml = stylesDesc.stringify({ styles: ctx.styles }, ctx);
  mapping["Styles"] = {
    data: XML_DECL + stylesXml,
    path: "xl/styles.xml",
  };

  // Theme — a parsed source theme round-trips structurally; fresh output
  // keeps the Office default. Blip fills inside the format scheme register
  // media placeholders; bind them to a theme-part image relationship.
  const themeRels = new Relationships();
  const themeXml = options.theme
    ? bindMediaPlaceholders(buildThemeXml(options.theme, ctx), ctx.media, themeRels)
    : createThemeXml();
  mapping["Theme"] = {
    data: XML_DECL + themeXml,
    path: "xl/theme/theme1.xml",
  };
  if (themeRels.relationshipCount > 0) {
    mapping["ThemeRels"] = {
      data: XML_DECL + themeRels.serialize(),
      path: "xl/theme/_rels/theme1.xml.rels",
    };
  }

  // Charts — AFTER worksheets so charts are registered
  for (const [i, chartData] of ctx.charts.array.entries()) {
    mapping[`Chart${i}`] = {
      data: XML_DECL + chartData.chartSpaceXml,
      path: `xl/charts/chart${i + 1}.xml`,
    };
    // User-shapes part behind c:userShapes: the chart part's own rels entry
    // plus the body part (chartUserShapes relationship, same directory).
    if (chartData.userShapes) {
      const rid = chartData.userShapes.relationshipId;
      mapping[`ChartUserShapes${i}`] = {
        data: XML_DECL + chartData.userShapes.xml,
        path: `xl/charts/userShapes${i + 1}.xml`,
      };
      mapping[`ChartRels${i}`] = {
        data:
          XML_DECL +
          `<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="${escapeXml(rid)}" Type="${CHART_USER_SHAPES_REL}" Target="userShapes${i + 1}.xml"/></Relationships>`,
        path: `xl/charts/_rels/chart${i + 1}.xml.rels`,
      };
    }
  }

  // Calculation chain — round-trips preserve the parsed chain verbatim (the
  // chain encodes Excel's own evaluation order, not something derivable);
  // fresh authoring rebuilds one from formula cells. A source whose workbook
  // rels reference calcChain but ship no part (repair-style files) keeps the
  // part absent — Excel tolerates the dangling reference exactly as received.
  const calcChainCells = options.calcChain ?? state.calcCells;
  const srcReferencesCalcChain = (options.passthroughRelationships ?? []).some(
    (r) => r.source === "xl/workbook.xml" && r.relationshipType.endsWith("/calcChain"),
  );
  if (calcChainCells.length > 0 && !(srcReferencesCalcChain && options.calcChain === undefined)) {
    mapping["CalcChain"] = {
      data: calcChainDesc.stringify({ cells: calcChainCells }, ctx) ?? "",
      path: "xl/calcChain.xml",
    };
    const calcChainRid = ctx.workbookRels.nextRelationshipId;
    ctx.workbookRels.addRelationship(calcChainRid, RELATIONSHIP_TYPES.calcChain, "calcChain.xml");
  }

  if (options.revisionLog) {
    compileRevisionLogs(options.revisionLog, ctx, mapping);
  }

  // Workbook relationships — serialized after calcChain/revision register their
  // targets, so every workbook-level relationship lands in workbook.xml.rels.
  // Passthrough relationships (round-trip) follow: the source workbook.xml.rels
  // referenced parts the model carries verbatim (externalLinks, pivotCaches, …).
  // Re-emitted as written — targets are passthrough paths that never move.
  for (const rel of options.passthroughRelationships ?? []) {
    if (rel.source !== "xl/workbook.xml") continue;
    if (ctx.workbookRels.hasRelationship(rel.relationshipType, rel.target)) continue;
    ctx.workbookRels.add(rel.relationshipType as RelationshipType, rel.target);
  }
  mapping["WorkbookRelationships"] = {
    data: XML_DECL + ctx.workbookRels.serialize(),
    path: "xl/_rels/workbook.xml.rels",
  };

  // Convert mapping to Zippable
  const mediaFiles: Array<{ data: Uint8Array; path: string }> = [];
  for (const img of ctx.media.array) {
    mediaFiles.push({ data: img.data, path: `xl/media/${img.fileName}` });
  }

  const files = compileMapping(mapping, overrides, mediaFiles, mediaLevel);
  // Derive [Content_Types].xml from the actual parts written — the file set is
  // the single source of truth, so content-type declarations cannot drift from
  // what is written. Sparse/index-based naming is handled naturally. Raw
  // passthrough parts (drawings, VML, external links, unknown extensions, …)
  // copy in first: the compiler output above wins at the same path, so only
  // what the model missed actually passes through.
  files["[Content_Types].xml"] = encoder.encode(
    finalizeContentTypes(
      files,
      {
        resolve: XLSX_CONTENT_TYPE_RESOLVER,
        mediaContentTypes: XLSX_MEDIA_CONTENT_TYPES,
        // Round-trip: the source declaration table is the base; derived entries
        // only fill what surviving source entries leave uncovered or mistyped.
        source: options.contentTypes,
        rawParts: options.rawParts,
      },
      ctx,
    ),
  );
  // Guard: drop passthrough rels whose target part never made it into the
  // package (hand-authored input) — Office refuses to open dangling rels.
  dropDanglingPassthroughRels(files, options.passthroughRelationships);
  return files;
}

/** Cross-worksheet compile state threaded through compileWorksheetPart. */
interface WorksheetCompileState {
  globalMediaIdx: number;
  globalChartIdx: number;
  globalPivotIdx: number;
  globalPivotCacheIdx: number;
  globalTableIdx: number;
  globalQueryTableIdx: number;
  globalSingleXmlCellsIdx: number;
  pivotCacheDataMap: Map<string, { cacheId: number; cacheIdx: number }>;
  calcCells: CalcCell[];
  allTableParts: TablePartReference[];
}

/**
 * Compile one worksheet: sheet XML, calcChain cells, drawing/media,
 * comments + VML, background, pivots, tables, query tables and
 * single-cell XML tables, with their worksheet-level relationships.
 * Rel registration order is significant (rIds are assigned sequentially).
 */
function compileWorksheetPart(
  wsOpts: WorksheetOptions,
  i: number,
  worksheetConfigs: WorksheetOptions[],
  ctx: XlsxWriteContext,
  mapping: Record<string, { data: string; path: string }>,
  wsContext: WorksheetContext,
  state: WorksheetCompileState,
  passthroughRelationships?: readonly PassthroughRelationship[],
): void {
  const imgOpts = wsOpts.images ?? [];
  const chartOpts = wsOpts.charts ?? [];
  const smartArtOpts = wsOpts.smartArts ?? [];
  const shapeOpts = wsOpts.shapes ?? [];
  const connectorOpts = wsOpts.connectors ?? [];
  const groupOpts = wsOpts.groups ?? [];
  const hlOpts = wsOpts.hyperlinks ?? [];
  const sheetName = wsOpts.name ?? `Sheet${i + 1}`;

  // Collect formula cells for calcChain. calcChain's i attribute is the
  // workbook sheetId (CT_Sheet @sheetId), not the sheet's position — the
  // fallback matches the all-generated case where both coincide.
  const sheetIdx = wsOpts.sheetId ?? i + 1;
  const wsRows = wsOpts.rows ?? [];
  for (let ri = 0; ri < wsRows.length; ri++) {
    const rowOpts = wsRows[ri]!;
    const rowNumber = rowOpts.rowNumber ?? ri + 1;
    const cells = rowOpts.cells;
    if (!cells) continue;
    for (let ci = 0; ci < cells.length; ci++) {
      const cell = cells[ci]!;
      if (!cell.formula) continue;
      const ref = cell.reference ?? columnToLetter(ci + 1) + rowNumber;
      state.calcCells.push({
        reference: ref,
        sheetIndex: sheetIdx,
        array: typeof cell.formula === "object" && cell.formula.type === "array",
      });
    }
  }

  const hasMedia =
    imgOpts.length > 0 ||
    chartOpts.length > 0 ||
    smartArtOpts.length > 0 ||
    shapeOpts.length > 0 ||
    connectorOpts.length > 0 ||
    groupOpts.length > 0;
  const hasExternalHyperlinks = hlOpts.some((h) => h.url !== undefined);
  const commentOpts = wsOpts.comments ?? [];
  const hasComments = commentOpts.length > 0;
  const pivotOpts = wsOpts.pivotTables ?? [];
  const hasPivots = pivotOpts.length > 0;
  const tableOpts = wsOpts.tables ?? [];
  const hasTables = tableOpts.length > 0;
  const queryTableOpts = wsOpts.queryTables ?? [];
  const hasQueryTables = queryTableOpts.length > 0;
  const singleXmlCellOpts = wsOpts.singleXmlCells ?? [];
  const bgImg = wsOpts.backgroundImage;

  // Worksheet-level relationships
  const wsPath = `xl/worksheets/sheet${i + 1}.xml`;
  let wsRels: Relationships | undefined;

  if (
    hasMedia ||
    hasExternalHyperlinks ||
    hasComments ||
    hasPivots ||
    hasTables ||
    hasQueryTables ||
    singleXmlCellOpts.length > 0 ||
    bgImg
  ) {
    wsRels = new Relationships();
    // Source ids first: every allocation below goes through add(), whose
    // watermark the reserve lifts, so a rebuilt rels table can't hand a
    // source id to a different part type — resolvePassthroughRid keeps its
    // source ids, and the printed-page/pivotSelection references stay valid.
    wsRels.reserveSourceRids(wsPath, passthroughRelationships ?? []);
  }

  // Round-trip drawing/legacyDrawing references. The referenced part passes
  // through verbatim when its anchors do not map onto options (e.g. OLE
  // object shape representations). With untouched (passthrough) worksheet
  // rels the original id stays valid; when the rels were rebuilt because the
  // same sheet carries comments/tables/…, re-register the passthrough
  // relationship — keeping the source id when it is free — so the reference
  // stays resolvable instead of dangling.
  const resolvePassthroughRid = (typeFragment: string, originalRid: string): string => {
    if (!wsRels) return originalRid;
    const rel = (passthroughRelationships ?? []).find(
      (r) =>
        r.source === wsPath && r.rId === originalRid && r.relationshipType.endsWith(typeFragment),
    );
    if (!rel) return originalRid;
    const existing = wsRels.idOf(rel.relationshipType, rel.target);
    if (existing) return existing;
    if (wsRels.hasId(originalRid)) {
      const n = wsRels.add(rel.relationshipType as RelationshipType, rel.target);
      return `rId${n}`;
    }
    wsRels.addRelationship(originalRid, rel.relationshipType as RelationshipType, rel.target);
    return originalRid;
  };
  // An OLE embedding's relationship is either the classic oleObject type or
  // the native-package type; the r:id is the same either way.
  const resolveEmbeddingRid = (originalRid: string): string => {
    const rid = resolvePassthroughRid("/oleObject", originalRid);
    return rid === originalRid ? resolvePassthroughRid("/package", originalRid) : rid;
  };

  // Every source r:id the sheet XML emits verbatim (OLE objects, controls,
  // printer settings, header/footer VML, custom parts) resolves here — before
  // stringify, so the emitted id is final and no post-stringify patching is
  // needed. The shallow copies keep the caller's options tree untouched.
  let xmlOpts = wsOpts;
  if (wsRels && (passthroughRelationships?.length ?? 0) > 0) {
    const oleObjects = wsOpts.oleObjects?.map((ole) => ({
      ...ole,
      rId: ole.rId ? resolveEmbeddingRid(ole.rId) : ole.rId,
      properties:
        ole.properties?.iconRid !== undefined
          ? {
              ...ole.properties,
              iconRid: resolvePassthroughRid("/image", ole.properties.iconRid),
            }
          : ole.properties,
    }));
    const controls = wsOpts.controls?.map((c) => ({
      ...c,
      rId: resolvePassthroughRid("/controls", c.rId),
      iconRid: c.iconRid !== undefined ? resolvePassthroughRid("/image", c.iconRid) : c.iconRid,
    }));
    const pageSetup = wsOpts.pageSetup?.printerSettingsRId
      ? {
          ...wsOpts.pageSetup,
          printerSettingsRId: resolvePassthroughRid(
            "/printerSettings",
            wsOpts.pageSetup.printerSettingsRId,
          ),
        }
      : wsOpts.pageSetup;
    const pivotSelection = wsOpts.pivotSelection?.rId
      ? {
          ...wsOpts.pivotSelection,
          rId: resolvePassthroughRid("/pivotTable", wsOpts.pivotSelection.rId),
        }
      : wsOpts.pivotSelection;
    const legacyDrawingHF = wsOpts.legacyDrawingHF
      ? resolvePassthroughRid("/vmlDrawing", wsOpts.legacyDrawingHF)
      : wsOpts.legacyDrawingHF;
    const customProperties = wsOpts.customProperties?.map((cp) => ({
      ...cp,
      rId: resolvePassthroughRid("/customXml", cp.rId),
    }));
    xmlOpts = {
      ...wsOpts,
      ...(oleObjects ? { oleObjects } : {}),
      ...(controls ? { controls } : {}),
      ...(pageSetup !== wsOpts.pageSetup ? { pageSetup } : {}),
      ...(pivotSelection !== wsOpts.pivotSelection ? { pivotSelection } : {}),
      ...(legacyDrawingHF !== wsOpts.legacyDrawingHF ? { legacyDrawingHF } : {}),
      ...(customProperties ? { customProperties } : {}),
    };
  }

  // Worksheet uses buildWorksheetXml fast path (zero-allocation string concat)
  let sheetXml = buildWorksheetXml(xmlOpts, wsContext);

  if (hasExternalHyperlinks) {
    for (const hl of hlOpts) {
      if (hl.url === undefined) continue;
      wsRels!.add(RELATIONSHIP_TYPES.hyperlink, hl.url, "External");
    }
  }

  if (hasMedia) {
    const drawingImages: DrawingPictureOptions[] = [];
    const drawingCharts: DrawingChartOptions[] = [];
    const drawingSmartArts: DrawingSmartArtOptions[] = [];
    const drawingRels = new Relationships();
    let rid = 1;

    // Process images
    for (const img of imgOpts) {
      let embedRid: string | undefined;
      let linkRid: string | undefined;

      if (img.data !== undefined) {
        // Media-store extension (jpg → jpeg); vector formats pass through.
        const ext = img.type === "jpg" ? "jpeg" : img.type;
        const rawBytes = toUint8Array(img.data, { encoding: "base64" });
        const entry = ctx.media.addMedia(rawBytes, ext, (fileName) => ({
          fileName,
          type: ext,
          data: rawBytes,
          width: 0,
          height: 0,
        }));

        // Anchors sharing one picture share the relationship too — the source
        // writes a single image rel that every a:blip references.
        const target = `../media/${entry.fileName}`;
        embedRid = drawingRels.idOf(IMAGE_REL, target);
        if (embedRid === undefined) {
          drawingRels.addRelationship(rid, IMAGE_REL, target);
          embedRid = `rId${rid}`;
          rid++;
        }
        state.globalMediaIdx++;
      }

      // Linked source (a:blip @r:link): one External image relationship per
      // URL — no media part, no bytes.
      if (img.sourceUrl !== undefined) {
        drawingRels.addRelationship(rid, IMAGE_REL, img.sourceUrl, "External");
        linkRid = `rId${rid}`;
        rid++;
      }

      drawingImages.push({
        ...pickAnchorOptions(img),
        rId: embedRid ?? "",
        ...(linkRid ? { linkRId: linkRid } : {}),
        ...pickNonVisualDrawingProperties(img),
        ...(img.properties ? { properties: img.properties } : {}),
        ...(img.blackWhiteMode ? { blackWhiteMode: img.blackWhiteMode } : {}),
        ...(img.sourceRectangle ? { sourceRectangle: img.sourceRectangle } : {}),
        ...(img.preferRelativeResize !== undefined
          ? { preferRelativeResize: img.preferRelativeResize }
          : {}),
        ...(img.blipEffects ? { blipEffects: img.blipEffects } : {}),
        ...(img.useLocalDpi !== undefined ? { useLocalDpi: img.useLocalDpi } : {}),
        ...(img.blipExt !== undefined ? { blipExt: img.blipExt } : {}),
        ...(img.locking ? { locking: img.locking } : {}),
        ...(img.hyperlink ? { hyperlink: img.hyperlink } : {}),
        ...(img.zOrder !== undefined ? { zOrder: img.zOrder } : {}),
        ...(img.shapeId !== undefined ? { shapeId: img.shapeId } : {}),
      });
    }

    // Process charts
    for (const chart of chartOpts) {
      const chartKey = `chart_${state.globalChartIdx}`;
      const userShapes = chart.userShapes ? buildUserShapesData(chart.userShapes) : undefined;
      ctx.charts.addChart(chartKey, {
        key: chartKey,
        chartSpaceXml: chartSpaceDesc.stringify(chart, ctx) ?? "",
        ...(userShapes ? { userShapes } : {}),
      });

      drawingRels.addRelationship(
        rid,
        RELATIONSHIP_TYPES.chart,
        `../charts/chart${state.globalChartIdx + 1}.xml`,
      );

      // cNvPr @title/@ext stay unbridged: WorksheetChartOptions.title is the
      // chart title (c:title) and its ext is the chart-space c:extLst —
      // neither belongs on the graphicFrame's cNvPr.
      const chartCnvPr = pickNonVisualDrawingProperties({
        ...chart,
        title: undefined,
        ext: undefined,
      });
      drawingCharts.push({
        ...pickAnchorOptions(chart),
        ...chartCnvPr,
        rId: `rId${rid}`,
        ...(chart.frameLocks ? { frameLocks: chart.frameLocks } : {}),
        ...(chart.macro !== undefined ? { macro: chart.macro } : {}),
        ...(chart.hyperlink ? { hyperlink: chart.hyperlink } : {}),
        ...(chart.zOrder !== undefined ? { zOrder: chart.zOrder } : {}),
        ...(chart.shapeId !== undefined ? { shapeId: chart.shapeId } : {}),
      });
      rid++;
      state.globalChartIdx++;
    }

    // Process SmartArt — the diagram parts themselves are passthrough, so the
    // relationship targets stay exactly the source-relative form; only the
    // rIds are renumbered into the rebuilt drawing rels.
    for (const sa of smartArtOpts) {
      const relTarget = (path: string): string =>
        path.startsWith("xl/") ? `../${path.slice(3)}` : path;
      // One relationship per (kind, target) — anchors sharing a diagram set
      // share its relationships too.
      const addDiagRel = (relType: RelationshipType, path: string): string => {
        const target = relTarget(path);
        const existing = drawingRels.idOf(relType, target);
        if (existing !== undefined) return existing;
        drawingRels.addRelationship(rid, relType, target);
        return `rId${rid++}`;
      };
      const relBase = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
      drawingSmartArts.push({
        ...pickAnchorOptions(sa),
        ...pickNonVisualDrawingProperties(sa),
        dataRId: addDiagRel(`${relBase}/diagramData`, sa.dataPath),
        layoutRId: addDiagRel(`${relBase}/diagramLayout`, sa.layoutPath),
        quickStyleRId: addDiagRel(`${relBase}/diagramQuickStyle`, sa.quickStylePath),
        colorsRId: addDiagRel(`${relBase}/diagramColors`, sa.colorsPath),
        ...(sa.frameLocks ? { frameLocks: sa.frameLocks } : {}),
        ...(sa.macro !== undefined ? { macro: sa.macro } : {}),
        ...(sa.zOrder !== undefined ? { zOrder: sa.zOrder } : {}),
        ...(sa.shapeId !== undefined ? { shapeId: sa.shapeId } : {}),
      });
    }

    // Generate drawing XML (via descriptor). Snapshot the hyperlink registry
    // first so only runs stringified for this sheet's drawing resolve here.
    const hyperlinkBase = ctx.hyperlinks.length;
    const drawingXml = drawingDesc.stringify(
      {
        images: drawingImages,
        charts: drawingCharts,
        smartArts: drawingSmartArts,
        shapes: shapeOpts,
        connectors: connectorOpts,
        groups: groupOpts,
      },
      ctx,
    );
    // Resolve drawing shape text-hyperlink placeholders ({hlink:key} → real
    // rId) and register each as an External hyperlink relationship.
    let resolvedDrawingXml = drawingXml!;
    // One External relationship per distinct URL — several objects/runs
    // pointing at the same target share it (matches how Excel writes rels).
    const hlinkRidByUrl = new Map<string, number>();
    for (const h of ctx.hyperlinks.slice(hyperlinkBase)) {
      let hlinkRid = hlinkRidByUrl.get(h.url);
      if (hlinkRid === undefined) {
        drawingRels.addRelationship(rid, RELATIONSHIP_TYPES.hyperlink, h.url, "External");
        hlinkRid = rid;
        hlinkRidByUrl.set(h.url, hlinkRid);
        rid++;
      }
      resolvedDrawingXml = resolvedDrawingXml
        .split(`r:id="{hlink:${h.key}}"`)
        .join(`r:id="rId${hlinkRid}"`);
    }
    // Shape blip fills inside the drawing register `{fileName}` media
    // placeholders — bind them the same way the theme does.
    resolvedDrawingXml = bindMediaPlaceholders(resolvedDrawingXml, ctx.media, drawingRels);
    const drawingIdx = i + 1;
    mapping[`Drawing${i}`] = {
      data: XML_DECL + resolvedDrawingXml,
      path: `xl/drawings/drawing${drawingIdx}.xml`,
    };

    // Drawing relationships
    mapping[`DrawingRels${i}`] = {
      data: XML_DECL + drawingRels.serialize(),
      path: `xl/drawings/_rels/drawing${drawingIdx}.xml.rels`,
    };

    // Insert drawing reference at its CT_Worksheet sequence position.
    const drawingRid = wsRels!.add(
      RELATIONSHIP_TYPES.drawing,
      `../drawings/drawing${drawingIdx}.xml`,
    );
    sheetXml = editSheetTailMarker(
      sheetXml,
      "<!--DRAWING-->",
      `<drawing r:id="rId${drawingRid}"/>`,
    );
  }

  // Comments
  if (hasComments) {
    const commentsIdx = i + 1;

    // Comments XML (via descriptor)
    const commentsXml = commentsDesc.stringify({ comments: commentOpts }, ctx);
    mapping[`Comments${i}`] = {
      data: XML_DECL + commentsXml,
      path: `xl/comments${commentsIdx}.xml`,
    };

    // VML drawing (via descriptor)
    const vmlXml = vmlNotesDesc.stringify({ comments: commentOpts }, ctx);
    mapping[`VmlDrawing${i}`] = {
      data: XML_DECL + vmlXml,
      path: `xl/drawings/vmlDrawing${commentsIdx}.vml`,
    };

    // Worksheet rels: comments → comments XML, legacyDrawing → VML file
    wsRels!.add(RELATIONSHIP_TYPES.comments, `../comments${commentsIdx}.xml`);

    const vmlRid = wsRels!.add(
      RELATIONSHIP_TYPES.vmlDrawing,
      `../drawings/vmlDrawing${commentsIdx}.vml`,
    );

    // Insert legacyDrawing reference at its CT_Worksheet sequence position.
    sheetXml = editSheetTailMarker(
      sheetXml,
      "<!--LEGACY_DRAWING-->",
      `<legacyDrawing r:id="rId${vmlRid}"/>`,
    );
  }

  // Background picture
  if (bgImg) {
    const ext = bgImg.type === "jpg" ? "jpeg" : bgImg.type;
    const rawBytes = toUint8Array(bgImg.data, { encoding: "base64" });
    const entry = ctx.media.addMedia(rawBytes, ext, (fileName) => ({
      fileName,
      type: ext,
      data: rawBytes,
      width: 0,
      height: 0,
    }));
    state.globalMediaIdx++;
    const bgRid = wsRels!.add(IMAGE_REL, `../media/${entry.fileName}`);
    sheetXml = editSheetTailMarker(
      sheetXml,
      "<!--BACKGROUND_PICTURE-->",
      `<picture r:id="rId${bgRid}"/>`,
    );
  }

  if (wsOpts.drawingRid) {
    const rid = escapeXml(resolvePassthroughRid("/drawing", wsOpts.drawingRid));
    sheetXml = editSheetTailMarker(sheetXml, "<!--DRAWING-->", `<drawing r:id="${rid}"/>`);
  }
  if (wsOpts.legacyDrawingRid) {
    const rid = escapeXml(resolvePassthroughRid("/vmlDrawing", wsOpts.legacyDrawingRid));
    sheetXml = editSheetTailMarker(
      sheetXml,
      "<!--LEGACY_DRAWING-->",
      `<legacyDrawing r:id="${rid}"/>`,
    );
  }

  // Pivot tables
  if (hasPivots) {
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
      wsRels!.add(RELATIONSHIP_TYPES.pivotTable, `../pivotTables/pivotTable${pivotIdx}.xml`);
    }
  }

  // Tables (list objects)
  const wsTableParts: TablePartReference[] = [];
  if (hasTables) {
    for (const tbl of tableOpts) {
      state.globalTableIdx++;
      const tableIdx = state.globalTableIdx;

      // A table without columns cannot form valid tableColumns XML — skip
      // instead of emitting a broken part (defensive; parse filters these).
      if (!tbl.columns?.length) continue;

      // Generate table XML
      const tableXmlStr = XML_DECL + tableDesc.stringify({ ...tbl, id: tbl.id ?? tableIdx }, ctx);
      mapping[`Table${tableIdx}`] = {
        data: tableXmlStr,
        path: `xl/tables/table${tableIdx}.xml`,
      };

      // Worksheet rels → table
      const tblRid = wsRels!.add(RELATIONSHIP_TYPES.table, `../tables/table${tableIdx}.xml`);

      wsTableParts.push({ rId: `rId${tblRid}` });
      state.allTableParts.push({ rId: `rId${tblRid}` });
    }
  }

  // Query tables
  if (hasQueryTables) {
    for (const qt of queryTableOpts) {
      state.globalQueryTableIdx++;
      mapping[`QueryTable${state.globalQueryTableIdx}`] = {
        data: XML_DECL + queryTableDesc.stringify(qt, ctx),
        path: `xl/queryTables/queryTable${state.globalQueryTableIdx}.xml`,
      };
      wsRels!.add(
        RELATIONSHIP_TYPES.queryTable,
        `../queryTables/queryTable${state.globalQueryTableIdx}.xml`,
      );
    }
  }

  // Single-cell XML tables
  if (singleXmlCellOpts.length > 0) {
    state.globalSingleXmlCellsIdx++;
    mapping[`TableSingleCells${state.globalSingleXmlCellsIdx}`] = {
      data: XML_DECL + singleXmlCellsDesc.stringify({ cells: singleXmlCellOpts }, ctx),
      path: `xl/tables/tableSingleCells${state.globalSingleXmlCellsIdx}.xml`,
    };
    wsRels!.add(
      RELATIONSHIP_TYPES.tableSingleCells,
      `../tables/tableSingleCells${state.globalSingleXmlCellsIdx}.xml`,
    );
  }

  // Pre-render pivot table data into sheetData
  if (hasPivots) {
    const rendered = renderPivotSheetData(
      pivotOpts,
      worksheetConfigs,
      ctx.sharedStrings,
      sheetName,
    );
    if (rendered.sheetData.length > 0) {
      // Replace empty <sheetData/> or <sheetData></sheetData> with rendered data
      sheetXml = sheetXml.replace(/<sheetData\/>|<sheetData><\/sheetData>/, rendered.sheetData);
      // Inject <dimension> before <sheetViews> (XSD sequence order: dimension before sheetViews)
      if (!sheetXml.includes("<dimension")) {
        sheetXml = sheetXml.replace(
          "<sheetViews",
          `<dimension ref="${rendered.dimensionRef}"/><sheetViews`,
        );
      }
    }
  }

  // Insert tableParts at their CT_Worksheet sequence position
  if (wsTableParts.length > 0) {
    sheetXml = editSheetTailMarker(
      sheetXml,
      "<!--TABLE_PARTS-->",
      buildTablePartsXml(wsTableParts),
    );
  }
  // Strip placeholders the compiler did not replace (drawing, legacyDrawing,
  // tableParts) — their existence depends on relationships owned here.
  sheetXml = stripWorksheetPlaceholders(sheetXml);

  // Round-trip: re-emit sheet relationships the model did not absorb
  // (printerSettings above all). Rebuilding the rels for tables/comments/…
  // must not drop part associations the worksheet XML never references by
  // r:id. Targets are passthrough paths that never move, so kind+target
  // identifies an instance the model already registered (drawing above).
  if (wsRels) {
    // Model-unabsorbed worksheet rels — claim semantics keep the source id
    // (reserved up front, so it is free unless the model genuinely took it)
    // instead of renumbering onto an id the sheet XML still references.
    for (const rel of passthroughRelationships ?? []) {
      if (rel.source !== wsPath) continue;
      wsRels.claimSourceRel(rel);
    }
  }

  // Write worksheet rels if needed
  if (wsRels) {
    mapping[`WorksheetRels${i}`] = {
      data: XML_DECL + wsRels.serialize(),
      path: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
    };
  }

  mapping[`Worksheet${i}`] = {
    data: sheetXml,
    path: `xl/worksheets/sheet${i + 1}.xml`,
  };
}

/** Full-page default frame for a fresh chartsheet chart (≈9.70×6.35 in). */
const CHARTSHEET_DEFAULT_CX = 9308969;
const CHARTSHEET_DEFAULT_CY = 6096000;

/** Compile all chartsheets: chart part, chartsheet/drawing XML and rels. */
function compileChartsheets(
  chartsheetConfigs: ChartsheetOptions[],
  ctx: XlsxWriteContext,
  mapping: Record<string, { data: string; path: string }>,
  passthroughRelationships?: readonly PassthroughRelationship[],
): void {
  // Chartsheets — chart-only sheets
  for (const [i, csOpts] of chartsheetConfigs.entries()) {
    // Register chart in the charts collection. Skip a chartsheet whose chart
    // could not be resolved (missing drawing/chart part in a broken source) —
    // safer than crashing the whole workbook compile.
    const chartDef = csOpts.chart;
    if (!chartDef) continue;
    const csChartGlobalIdx = ctx.charts.array.length;
    const csChartKey = `cs_chart_${csChartGlobalIdx}`;
    const csUserShapes = chartDef.userShapes ? buildUserShapesData(chartDef.userShapes) : undefined;
    ctx.charts.addChart(csChartKey, {
      key: csChartKey,
      chartSpaceXml: chartSpaceDesc.stringify(chartDef, ctx) ?? "",
      ...(csUserShapes ? { userShapes: csUserShapes } : {}),
    });

    // Chartsheet relationships: drawing (required)
    const csRels = new Relationships();
    const csDrawingIdx = i + 1;
    csRels.addRelationship(1, RELATIONSHIP_TYPES.drawing, `../drawings/drawing${csDrawingIdx}.xml`);

    // Round-trip: re-emit chartsheet relationships the model did not absorb
    // (printerSettings above all) — same contract as worksheet rels.
    let csNextRid = 2;
    for (const rel of passthroughRelationships ?? []) {
      if (rel.source !== `xl/chartsheets/sheet${i + 1}.xml`) continue;
      if (csRels.hasRelationship(rel.relationshipType, rel.target)) continue;
      csRels.addRelationship(csNextRid++, rel.relationshipType as RelationshipType, rel.target);
    }

    // Drawing rels: chart reference
    const csDrawingRels = new Relationships();
    csDrawingRels.addRelationship(
      1,
      RELATIONSHIP_TYPES.chart,
      `../charts/chart${csChartGlobalIdx + 1}.xml`,
    );

    // Drawing XML with chart anchor — reuses the parts/drawing anchor and
    // graphicFrame builders (no hand-rolled xdr emitter). Round-tripped
    // sheets keep the source anchor geometry (the rendered chart size —
    // Excel writes it back verbatim on save); fresh sheets anchor at origin
    // with the full-page frame. The graphicFrame xfrm stays 0×0, Excel's own
    // chartsheet form: it sizes from the anchor ext and zeroes xfrm on save.
    const frame = graphicFrameXml(
      csOpts.shapeId ?? 1,
      undefined,
      `Chart ${i + 1}`,
      "rId1",
      0,
      0,
      ctx,
      {
        frameLocks: csOpts.frameLocks,
        macro: csOpts.macro,
      },
    );
    const anchor = wrapAnchor(
      {
        anchorType: "absolute",
        col: 1,
        row: 1,
        absoluteX: csOpts.absoluteX ?? 0,
        absoluteY: csOpts.absoluteY ?? 0,
        extentCx: csOpts.extentCx ?? CHARTSHEET_DEFAULT_CX,
        extentCy: csOpts.extentCy ?? CHARTSHEET_DEFAULT_CY,
      },
      `${frame}<xdr:clientData/>`,
    );
    const csDrawingXml = `<xdr:wsDr xmlns:xdr="${XDR_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}">${anchor}</xdr:wsDr>`;

    mapping[`ChartsheetDrawing${i}`] = {
      data: csDrawingXml,
      path: `xl/drawings/drawing${csDrawingIdx}.xml`,
    };
    mapping[`ChartsheetDrawingRels${i}`] = {
      data: XML_DECL + csDrawingRels.serialize(),
      path: `xl/drawings/_rels/drawing${csDrawingIdx}.xml.rels`,
    };

    mapping[`ChartsheetRels${i}`] = {
      data: XML_DECL + csRels.serialize(),
      path: `xl/chartsheets/_rels/sheet${i + 1}.xml.rels`,
    };

    // pageSetup r:id → printerSettings: the rebuilt rels renumber every id
    // (drawing holds rId1), so remap the source id onto the re-emitted
    // relationship — otherwise the passthrough .bin stays orphaned and Excel
    // discards it on the next save.
    let csPageSetup = csOpts.pageSetup;
    if (csPageSetup?.printerSettingsRId) {
      const srcRid = csPageSetup.printerSettingsRId;
      const rel = (passthroughRelationships ?? []).find(
        (r) =>
          r.source === `xl/chartsheets/sheet${i + 1}.xml` &&
          r.rId === srcRid &&
          r.relationshipType.endsWith("/printerSettings"),
      );
      const rid = rel ? (csRels.idOf(rel.relationshipType, rel.target) ?? srcRid) : srcRid;
      if (rid !== srcRid) csPageSetup = { ...csPageSetup, printerSettingsRId: rid };
    }
    mapping[`Chartsheet${i}`] = {
      data:
        XML_DECL +
        chartsheetDesc.stringify({ ...csOpts, drawingRId: "rId1", pageSetup: csPageSetup }, ctx),
      path: `xl/chartsheets/sheet${i + 1}.xml`,
    };
  }
}

/** Compile all dialog sheets (legacy Excel 5.0 dialog sheets). */
function compileDialogsheets(
  dialogsheetConfigs: DialogsheetOptions[],
  ctx: XlsxWriteContext,
  mapping: Record<string, { data: string; path: string }>,
): void {
  // Dialogsheets — legacy Excel 5.0 dialog sheets
  for (const [i, dsOpts] of dialogsheetConfigs.entries()) {
    mapping[`Dialogsheet${i}`] = {
      data: XML_DECL + dialogsheetDesc.stringify(dsOpts, ctx),
      path: `xl/dialogSheets/sheet${i + 1}.xml`,
    };
  }
}

/**
 * Compile shared-workbook revisions (xl/revisionHeaders.xml +
 * xl/revisions/revisionN.xml + xl/users.xml). CT_Workbook has no revision
 * element — parts are discovered via workbook.xml.rels + [Content_Types].
 */
function compileRevisionLogs(
  rl: NonNullable<WorkbookOptions["revisionLog"]>,
  ctx: XlsxWriteContext,
  mapping: Record<string, { data: string; path: string }>,
): void {
  const REV_HEADERS_REL = RELATIONSHIP_TYPES.revisionHeaders;
  const REV_LOG_REL = RELATIONSHIP_TYPES.revisionLog;
  const USERS_REL = RELATIONSHIP_TYPES.users;

  // xl/revisionHeaders.xml — target of an implicit relationship from the workbook.
  mapping["RevisionHeaders"] = {
    data: XML_DECL + (revisionHeadersDesc.stringify(rl.headers, ctx) ?? ""),
    path: "xl/revisionHeaders.xml",
  };
  ctx.workbookRels.addRelationship(
    ctx.workbookRels.nextRelationshipId,
    REV_HEADERS_REL,
    "revisionHeaders.xml",
  );

  // One revision log per header entry, plus revisionHeaders.xml.rels pointing to each.
  const revHeadersRels = new Relationships();
  for (const [i, log] of rl.logs.entries()) {
    mapping[`RevisionLog${i}`] = {
      data: XML_DECL + (revisionLogDesc.stringify(log, ctx) ?? ""),
      path: `xl/revisions/revision${i + 1}.xml`,
    };
    revHeadersRels.addRelationship(i + 1, REV_LOG_REL, `revisions/revision${i + 1}.xml`);
  }
  mapping["RevisionHeadersRels"] = {
    data: XML_DECL + revHeadersRels.serialize(),
    path: "xl/_rels/revisionHeaders.xml.rels",
  };

  // xl/users.xml (optional)
  if (rl.users) {
    const usersXml = usersDesc.stringify(rl.users, ctx);
    if (usersXml) {
      mapping["Users"] = { data: XML_DECL + usersXml, path: "xl/users.xml" };
      ctx.workbookRels.addRelationship(ctx.workbookRels.nextRelationshipId, USERS_REL, "users.xml");
    }
  }
}

// ── Pure helper functions ──

function buildWorkbookRelationships(
  rels: Relationships,
  wsCount: number,
  csCount: number,
  dsCount: number = 0,
): void {
  let rid = 1;
  for (let i = 0; i < wsCount; i++) {
    rels.addRelationship(rid++, RELATIONSHIP_TYPES.worksheet, `worksheets/sheet${i + 1}.xml`);
  }
  for (let i = 0; i < csCount; i++) {
    rels.addRelationship(rid++, RELATIONSHIP_TYPES.chartsheet, `chartsheets/sheet${i + 1}.xml`);
  }
  for (let i = 0; i < dsCount; i++) {
    rels.addRelationship(rid++, RELATIONSHIP_TYPES.dialogsheet, `dialogSheets/sheet${i + 1}.xml`);
  }
  rels.addRelationship(rid++, RELATIONSHIP_TYPES.styles, "styles.xml");
  rels.addRelationship(rid++, RELATIONSHIP_TYPES.theme, "theme/theme1.xml");
}

function hasMetadataContent(metadata: MetadataOptions): boolean {
  return (
    (metadata.types?.length ?? 0) > 0 ||
    (metadata.strings?.length ?? 0) > 0 ||
    (metadata.mdx?.length ?? 0) > 0 ||
    (metadata.futureMetadata?.length ?? 0) > 0 ||
    (metadata.cellMetadata?.length ?? 0) > 0 ||
    (metadata.valueMetadata?.length ?? 0) > 0
  );
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

function renderPivotSheetData(
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
