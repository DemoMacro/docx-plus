/**
 * Worksheet drawing compile phase: images, charts, SmartArt, shapes,
 * connectors, and groups on a sheet — the drawing part, its relationships,
 * and the `<drawing>` reference inserted into the sheet XML.
 *
 * @module
 */

import {
  RELATIONSHIP_TYPES,
  Relationships,
  type RelationshipType,
  pickNonVisualDrawingProperties,
  toUint8Array,
} from "@office-open/core";
import { buildUserShapesData, chartSpaceDesc } from "@office-open/core/chart";
import { OOXML_XML_DECLARATION } from "@office-open/xml";
import type {
  DrawingChartOptions,
  DrawingPictureOptions,
  DrawingSmartArtOptions,
} from "@parts/drawing";
import { pickAnchorOptions, drawingDesc } from "@parts/drawing";
import { editSheetTailMarker, type WorksheetOptions } from "@parts/worksheet";

import type { WorksheetCompileState } from "../compiler";
import { XlsxWriteContext } from "../context";

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
export function bindMediaPlaceholders(
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

/** Compile a sheet's drawing: register image/chart/SmartArt media and
 * relationships, serialize the drawing part via the descriptor, bind media
 * and text-hyperlink placeholders, and splice the `<drawing r:id>` element
 * into the sheet XML at its CT_Worksheet position. Returns the updated XML. */
export function compileSheetDrawing(
  wsOpts: WorksheetOptions,
  i: number,
  sheetXml: string,
  ctx: XlsxWriteContext,
  mapping: Record<string, { data: string; path: string }>,
  state: WorksheetCompileState,
  wsRels: Relationships,
): string {
  const imgOpts = wsOpts.images ?? [];
  const chartOpts = wsOpts.charts ?? [];
  const smartArtOpts = wsOpts.smartArts ?? [];
  const shapeOpts = wsOpts.shapes ?? [];
  const connectorOpts = wsOpts.connectors ?? [];
  const groupOpts = wsOpts.groups ?? [];

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
  const drawingRid = wsRels.add(RELATIONSHIP_TYPES.drawing, `../drawings/drawing${drawingIdx}.xml`);
  return editSheetTailMarker(sheetXml, "<!--DRAWING-->", `<drawing r:id="rId${drawingRid}"/>`);
}
