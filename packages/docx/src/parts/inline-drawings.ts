/**
 * Drawing-family paragraph children: picture, chart, SmartArt, WPS shape,
 * content part, and WPG group runs.
 *
 * Each branch registers its side effects on the write context (media bytes,
 * chart and diagram parts, VML fallback media), then stringifies the
 * `<w:drawing>` run through the drawing descriptor. Shared by the paragraph
 * and body-level JSON dispatches via stringifyDrawingChild.
 *
 * @module
 */

import type { DataType } from "@office-open/core";
import { encodeBase64, imageTypeFromPath, toUint8Array } from "@office-open/core";
import { buildUserShapesData, chartSpaceDesc } from "@office-open/core/chart";
import { createDataModel, definitionId } from "@office-open/core/smartart";
import type { SmartArtRawParts } from "@office-open/core/smartart";
import type { BackgroundRawMediaOptions } from "@parts/document/document-background/document-background";
import type { ParagraphChild } from "@parts/paragraph/paragraph";
import type { RunPropertiesOptions } from "@parts/paragraph/run/properties";
import type { SmartArtOptions } from "@parts/paragraph/run/smartart-run";
import type {
  ChartMediaData,
  GroupChildMediaData,
  MediaData,
  SmartArtMediaData,
  GroupMediaData,
  ShapeMediaData,
} from "@shared/media";
import { createTransformation } from "@shared/media";

import type { BodyContext } from "../context";
import { drawingDesc } from "./drawing";
import { stringifyRunProperties } from "./paragraph/stringify";

let nextChartId = 1;

/**
 * Wrap a `<w:drawing>` run, rebuilding an mc:AlternateContent wrapper when a
 * VML fallback was carried from parse (Choice stays structured/editable,
 * Fallback round-trips as raw XML for fidelity).
 */
function wrapDrawingRun(
  drawingXml: string | undefined,
  opts: {
    vmlFallback?: string;
    mcChoiceRequires?: string;
    runProperties?: RunPropertiesOptions;
    lastRenderedPageBreak?: boolean;
  },
): string {
  const xml = drawingXml ?? "";
  const rPr = stringifyRunProperties(opts.runProperties) ?? "";
  const lrpb = opts.lastRenderedPageBreak ? "<w:lastRenderedPageBreak/>" : "";
  if (opts.vmlFallback) {
    const requires = opts.mcChoiceRequires ?? "wps";
    // opts.vmlFallback is the serialized <mc:Fallback>…</mc:Fallback> element,
    // so splice it in directly (no extra wrapper).
    return `<w:r>${rPr}${lrpb}<mc:AlternateContent><mc:Choice Requires="${requires}">${xml}</mc:Choice>${opts.vmlFallback}</mc:AlternateContent></w:r>`;
  }
  return `<w:r>${rPr}${lrpb}${xml}</w:r>`;
}

/**
 * Register media carried by a VML fallback (mc:AlternateContent Fallback) so the
 * compiler resolves the fallback's `{fileName}` placeholders into rIds.
 *
 * A VML fallback image mirrors its Choice blip (same source bytes). When the
 * blip is already registered, reuse it and remap the fallback's `{fileName}`
 * placeholder to the shared media — matching Office, which emits one
 * relationship/file per image rather than a duplicate for the VML branch.
 */
function registerVmlFallbackMedia(
  opts: { vmlFallback?: string; vmlFallbackMedia?: BackgroundRawMediaOptions[] },
  ctx: BodyContext,
): void {
  if (!opts.vmlFallbackMedia) return;
  for (const m of opts.vmlFallbackMedia) {
    const data = toUint8Array(m.data);
    const entry = ctx.file.media.addMedia(
      data,
      m.type,
      (fileName) =>
        ({
          type: m.type,
          data,
          fileName,
          transformation: { emus: { x: 0, y: 0 }, pixels: { x: 0, y: 0 } },
        }) as MediaData,
      m.fileName,
    );
    // Dedup may reuse the Choice blip's file name; remap the VML fallback
    // placeholder so both branches share one relationship/file (matches Office).
    if (entry.fileName !== m.fileName && opts.vmlFallback) {
      opts.vmlFallback = opts.vmlFallback.split(`{${m.fileName}}`).join(`{${entry.fileName}}`);
    }
  }
}

/** Rewrite ../media targets inside verbatim data rels after the media
 *  collection re-allocated pinned names. All renames apply in one pass over
 *  the original text, each match bounded by its closing quote, so a name
 *  that prefixes another cannot collide and chained renames cannot re-hit
 *  an already-rewritten target. Preserves the input form (string stays
 *  string, bytes stay bytes). */
function remapDataRelsTargets(rels: DataType, renames: Map<string, string>): DataType {
  const isText = typeof rels === "string";
  const text = isText ? rels : new TextDecoder().decode(toUint8Array(rels));
  let out = "";
  let last = 0;
  for (const m of text.matchAll(/\.\.\/media\/([^"']*)["']/g)) {
    const name = m[1] ?? "";
    const to = renames.get(name);
    if (to === undefined) continue;
    const start = (m.index ?? 0) + "../media/".length;
    out += text.slice(last, start) + to;
    last = start + name.length;
  }
  out += text.slice(last);
  return isText ? out : new TextEncoder().encode(out);
}

/** Content fingerprint of the raw source parts: every field participates so
 *  two instances that differ in any raw part (or in their companion rels or
 *  media names) never merge into one diagram part set. */
function rawSmartArtFingerprint(raw: SmartArtRawParts | undefined): string | undefined {
  if (!raw) return undefined;
  const b64 = (v: DataType | undefined) =>
    v === undefined ? undefined : encodeBase64(toUint8Array(v));
  return JSON.stringify({
    data: b64(raw.data),
    layout: b64(raw.layout),
    style: b64(raw.style),
    color: b64(raw.color),
    dataRels: b64(raw.dataRels),
    media: raw.media?.map((m) => m.fileName),
  });
}

/** Hash SmartArt data for unique key generation (duplicated from SmartArtRun). */
function hashSmartArtData(options: SmartArtOptions): number {
  // Layout/style/color participate: two diagrams with the same nodes but
  // different definitions are distinct parts. Raw source bytes too: a
  // round-tripped document keeps one part set per source instance even when
  // two instances fold to identical structured options.
  const data = JSON.stringify({
    nodes: options.nodes,
    layout: options.layout,
    style: options.style,
    color: options.color,
    raw: rawSmartArtFingerprint(options.raw),
  });
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash);
}

// ── Drawing-family dispatch ──

/**
 * Stringify the drawing-family children of the JSON dispatch: picture, chart,
 * SmartArt, WPS shape, content part, and WPG group. Each registers its media
 * or part side effects, then emits the `<w:drawing>` run.
 *
 * Returns `undefined` when the child is not a drawing-family wrapper.
 */
export function stringifyDrawingChild(child: ParagraphChild, ctx: BodyContext): string | undefined {
  // Picture — side effect: media registration (content-deduplicated via core Media)
  if ("picture" in child) {
    const opts = child.picture;

    // Linked-only picture (external URL, no bytes) — no media registration;
    // the blip carries r:link alone and the owning part gets one External
    // image relationship.
    if (opts.type !== "svg" && opts.data === undefined && opts.sourceUrl !== undefined) {
      const drawingXml = drawingDesc.stringify(
        {
          mediaData: {
            type: opts.type,
            sourceUrl: opts.sourceUrl,
            transformation: createTransformation(opts.transformation),
            sourceRectangle: opts.sourceRectangle,
            nonVisualProperties: opts.nonVisualProperties,
            useLocalDpi: opts.useLocalDpi,
            compression: opts.compression,
          },
          docProperties: opts.altText,
          floating: opts.floating,
          outline: opts.outline,
          fill: opts.fill,
          effects: opts.effects,
          scene3d: opts.scene3d,
          shape3d: opts.shape3d,
          blipEffects: opts.blipEffects,
          tile: opts.tile,
          graphicFrameLocks: opts.graphicFrameLocks,
        },
        ctx,
      );
      return wrapDrawingRun(drawingXml, opts);
    }

    // Data is required past this point: linked-only pictures returned above,
    // and toUint8Array(undefined) throws the clear TypeError for degenerate
    // authoring input (neither bytes nor a linked source).
    const rawData = toUint8Array(opts.data!, { encoding: "base64" }) as Uint8Array;

    // The dedup entry carries media identity only — a byte-identical image
    // reuses the first registrant's entry object, so per-reference placement
    // fields (size, crop, cNvPr, blip hints) are re-applied onto the returned
    // entry instead of baked into the `build` callback.
    let mediaData: MediaData;
    if (opts.type === "svg") {
      const fallbackData = toUint8Array(opts.fallback.data, { encoding: "base64" }) as Uint8Array;
      const fallbackType = opts.fallback.type;
      // Register the raster fallback first so its file name is allocated, then
      // build the svg entry referencing it. Dedup applies to both independently.
      const fallback = ctx.file.media.addMedia(
        fallbackData,
        fallbackType,
        (fileName) =>
          ({
            type: fallbackType,
            data: fallbackData,
            fileName,
            transformation: { emus: { x: 0, y: 0 }, pixels: { x: 0, y: 0 } },
          }) as MediaData,
        opts.fallback.fileName,
      );
      mediaData = {
        ...ctx.file.media.addMedia(
          rawData,
          "svg",
          (fileName) =>
            ({
              type: "svg" as const,
              data: rawData,
              fileName,
              fallback,
              transformation: { emus: { x: 0, y: 0 }, pixels: { x: 0, y: 0 } },
            }) as MediaData,
          opts.fileName,
        ),
        transformation: createTransformation(opts.transformation),
        sourceRectangle: opts.sourceRectangle,
        nonVisualProperties: opts.nonVisualProperties,
        useLocalDpi: opts.useLocalDpi,
        compression: opts.compression,
      };
    } else {
      const type = opts.type;
      mediaData = {
        ...ctx.file.media.addMedia(
          rawData,
          type,
          (fileName) =>
            ({
              type,
              data: rawData,
              fileName,
              transformation: { emus: { x: 0, y: 0 }, pixels: { x: 0, y: 0 } },
            }) as MediaData,
          opts.fileName,
        ),
        transformation: createTransformation(opts.transformation),
        sourceRectangle: opts.sourceRectangle,
        nonVisualProperties: opts.nonVisualProperties,
        useLocalDpi: opts.useLocalDpi,
        compression: opts.compression,
        sourceUrl: opts.sourceUrl,
      };
    }

    // Build drawing XML via descriptor (zero XmlComponent instances)
    const drawingXml = drawingDesc.stringify(
      {
        mediaData,
        docProperties: opts.altText,
        floating: opts.floating,
        outline: opts.outline,
        fill: opts.fill,
        effects: opts.effects,
        scene3d: opts.scene3d,
        shape3d: opts.shape3d,
        blipEffects: opts.blipEffects,
        tile: opts.tile,
        graphicFrameLocks: opts.graphicFrameLocks,
      },
      ctx,
    );
    return wrapDrawingRun(drawingXml, opts);
  }

  // Chart — side effect: chart registration
  if ("chart" in child) {
    const opts = child.chart;
    const chartKey = `chart_${nextChartId++}`;
    const mediaData: ChartMediaData = {
      chartKey,
      transformation: createTransformation(opts.transformation),
      type: "chart",
    };

    // Register chart — strip the DOCX anchor-wrapper fields and pass every
    // ChartSpaceOptions field through so round-tripped charts keep their
    // axes, spPr, dLbls, externalData, …
    const {
      transformation: _t,
      floating: _f,
      altText: _a,
      graphicFrameLocks: _g,
      runProperties: _r,
      lastRenderedPageBreak: _l,
      ...chartSpace
    } = opts;
    const chartXml = chartSpaceDesc.stringify(chartSpace, ctx.file);
    const externalData = chartSpace.externalData;
    ctx.file.charts.addChart(chartKey, {
      key: chartKey,
      chartSpaceXml: chartXml ?? "",
      ...(externalData?.data !== undefined && externalData.fileName
        ? {
            embedding: {
              relationshipId: externalData.relationshipId,
              fileName: externalData.fileName,
              data: externalData.data,
            },
          }
        : {}),
      ...(chartSpace.userShapes ? { userShapes: buildUserShapesData(chartSpace.userShapes) } : {}),
    });

    const drawingXml = drawingDesc.stringify(
      {
        mediaData,
        docProperties: opts.altText,
        floating: opts.floating,
        graphicFrameLocks: opts.graphicFrameLocks,
      },
      ctx,
    );
    return wrapDrawingRun(drawingXml, opts);
  }

  // SmartArt — side effect: smartArt registration
  if ("smartArt" in child) {
    const opts = child.smartArt;
    const hash = hashSmartArtData(opts);
    const smartArtKey = `smartart_${hash}`;
    const mediaData: SmartArtMediaData = {
      smartArtKey,
      transformation: createTransformation(opts.transformation),
      type: "smartart",
    };

    // Register SmartArt — custom definitions embed their own id in the doc
    // point's type ids.
    const layoutId =
      typeof opts.layout === "object" ? definitionId(opts.layout) : (opts.layout ?? "default");
    const styleId =
      typeof opts.style === "object" ? definitionId(opts.style) : (opts.style ?? "simple1");
    const colorId =
      typeof opts.color === "object" ? definitionId(opts.color) : (opts.color ?? "accent1_2");
    const dataModelXml = createDataModel(opts.nodes, layoutId, styleId, colorId);

    // Data-part companion images (dgm:pt blipFill art): register through the
    // media collection so name pinning and dedup match the picture path. A
    // pinned name taken by different bytes re-allocates — remap the verbatim
    // data rels target to follow, or the rels would point at the wrong bytes.
    let remappedDataRels = opts.raw?.dataRels;
    if (opts.raw?.media) {
      const renames = new Map<string, string>();
      for (const m of opts.raw.media) {
        const data = toUint8Array(m.data);
        const type = imageTypeFromPath(m.fileName);
        const entry = ctx.file.media.addMedia(
          data,
          type,
          (fileName) =>
            ({
              type,
              data,
              fileName,
              transformation: { emus: { x: 0, y: 0 }, pixels: { x: 0, y: 0 } },
            }) as MediaData,
          m.fileName,
        );
        if (entry.fileName !== m.fileName) renames.set(m.fileName, entry.fileName);
      }
      if (renames.size > 0 && remappedDataRels !== undefined) {
        remappedDataRels = remapDataRelsTargets(remappedDataRels, renames);
      }
    }

    ctx.file.smartArts.addSmartArt(smartArtKey, {
      dataModelXml,
      key: smartArtKey,
      layout: opts.layout ?? "default",
      style: opts.style ?? "simple1",
      color: opts.color ?? "accent1_2",
      // Store a shallow copy with the remapped rels — never mutate the
      // caller's Options object.
      ...(opts.raw || remappedDataRels !== undefined
        ? { raw: { ...opts.raw, dataRels: remappedDataRels } }
        : {}),
    });

    const drawingXml = drawingDesc.stringify(
      {
        mediaData,
        docProperties: opts.altText,
        floating: opts.floating,
        graphicFrameLocks: opts.graphicFrameLocks,
      },
      ctx,
    );
    return wrapDrawingRun(drawingXml, {
      runProperties: opts.runProperties,
      lastRenderedPageBreak: opts.lastRenderedPageBreak,
    });
  }

  // WPS Shape (WordProcessing Shape) — side effect: blip fill media registration
  if ("wpsShape" in child) {
    const opts = child.wpsShape;
    const mediaData: ShapeMediaData = {
      data: opts,
      transformation: createTransformation(opts.transformation),
      type: "wps",
    };

    const drawingXml = drawingDesc.stringify(
      {
        mediaData,
        docProperties: opts.altText,
        floating: opts.floating,
        outline: opts.outline,
        fill: opts.fill,
        graphicFrameLocks: opts.graphicFrameLocks,
      },
      ctx,
    );
    registerVmlFallbackMedia(opts, ctx);
    return wrapDrawingRun(drawingXml, opts);
  }

  // Content part (w:contentPart) — run-level EG_RunInnerContent element (CT_Rel).
  // Word references ink and other opaque parts this way; the richer placement
  // fields of ContentPartOptions only apply inside a wpg group child.
  if ("contentPart" in child) {
    return `<w:r><w:contentPart r:id="${child.contentPart.referenceId}"/></w:r>`;
  }

  // WPG Group (WordProcessing Group) — group of shapes/pictures
  if ("wpgGroup" in child) {
    const opts = child.wpgGroup;
    const mediaData: GroupMediaData = {
      children: opts.children,
      transformation: createTransformation(opts.transformation),
      childOffsetX: opts.childOffsetX,
      childOffsetY: opts.childOffsetY,
      childExtentWidth: opts.childExtentWidth,
      childExtentHeight: opts.childExtentHeight,
      fill: opts.fill,
      effects: opts.effects,
      groupShapeLocks: opts.groupShapeLocks,
      type: "wpg",
    };

    // Register pic children media so {fileName} placeholders resolve, recursing
    // into nested wpg groups. wps children carry shape data, not media.
    const registerMedia = (children: readonly GroupChildMediaData[]): void => {
      for (const c of children) {
        if (c.type === "wps") continue;
        if (c.type === "wpg") {
          registerMedia(c.children);
          continue;
        }
        if (c.type === "chart") {
          // Group-nested charts register their chart part from the parsed or
          // fresh chartOptions; the {chart:key} placeholder resolves in the
          // compiler like a top-level chart run.
          if (c.chartOptions && !c.chartKey) {
            c.chartKey = `chart_${nextChartId++}`;
            const externalData = c.chartOptions.externalData;
            ctx.file.charts.addChart(c.chartKey, {
              key: c.chartKey,
              chartSpaceXml: chartSpaceDesc.stringify(c.chartOptions, ctx.file) ?? "",
              ...(externalData?.data !== undefined && externalData.fileName
                ? {
                    embedding: {
                      relationshipId: externalData.relationshipId,
                      fileName: externalData.fileName,
                      data: externalData.data,
                    },
                  }
                : {}),
              ...(c.chartOptions.userShapes
                ? { userShapes: buildUserShapesData(c.chartOptions.userShapes) }
                : {}),
            });
          }
          continue;
        }
        if (c.type === "contentPart") continue;
        if (c.type === "svg") {
          // Register the raster fallback first so its file name is allocated,
          // then the SVG entry referencing it. Dedup applies to each independently.
          const fb = c.fallback;
          const fbEntry = ctx.file.media.addMedia(
            fb.data,
            fb.type,
            () => fb as MediaData,
            fb.fileName,
          );
          fb.fileName = fbEntry.fileName;
          const svgEntry = ctx.file.media.addMedia(c.data, "svg", () => c as MediaData, c.fileName);
          c.fileName = svgEntry.fileName;
          continue;
        }
        const entry = ctx.file.media.addMedia(c.data, c.type, () => c as MediaData, c.fileName);
        // Sync to the canonical entry: when these bytes dedupe against an earlier
        // image, addMedia returns that entry without invoking the build callback,
        // leaving c.fileName at the source basename — the {fileName} placeholder
        // then fails to resolve. entry.fileName is always the registered name.
        c.fileName = entry.fileName;
      }
    };
    registerMedia(opts.children);

    const drawingXml = drawingDesc.stringify(
      {
        mediaData,
        docProperties: opts.altText,
        floating: opts.floating,
        graphicFrameLocks: opts.graphicFrameLocks,
      },
      ctx,
    );
    registerVmlFallbackMedia(opts, ctx);
    return wrapDrawingRun(drawingXml, opts);
  }

  return undefined;
}
