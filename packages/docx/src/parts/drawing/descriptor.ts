/**
 * Drawing descriptor for DOCX documents.
 *
 * Produces `<w:drawing>` XML directly from media data and options,
 * eliminating the Drawing/Inline/Anchor/Graphic/GraphicData/Pic XmlComponent
 * class chain (~10 instances per drawing in the old path).
 *
 * Common path (inline image/chart/smartart without advanced properties):
 * zero XmlComponent instances — pure string concatenation.
 *
 * Advanced properties (outline, fill, effects on images) and floating
 * positioning use core `create*()` + `.toXml({stack:[]})` for sub-elements
 * (lightweight BuilderElement instances, not deep hierarchies).
 *
 * Reference: ISO/IEC 29500-4, wml.xsd, CT_Drawing
 *
 * @module
 */

import { RELATIONSHIP_TYPES, TargetModeType } from "@office-open/core";
import { convertToEmu, uniqueNumericIdCreator } from "@office-open/core";
import type { CustomDescriptor, WriteContext } from "@office-open/core/descriptor";
import type {
  BlipEffectsOptions,
  EffectListOptions,
  FillOptions,
  OutlineOptions,
  Scene3DOptions,
  Shape3DOptions,
  SourceRectangleOptions,
  TileOptions,
} from "@office-open/core/drawing";
import {
  calculateEffectExtent,
  connectorLockingDesc,
  createColorElement,
  groupShapePropertiesDesc,
  pictureLockingDesc,
  shapeLockingDesc,
  shapePropertiesDesc,
  stringifyBlipEffects,
  stringifyNonVisualContentPartProperties,
  stringifyNonVisualDrawingProperties,
} from "@office-open/core/drawing";
import { escapeXml } from "@office-open/xml";
import { stringifyParagraphInline } from "@parts/inline";
import type { ParagraphOptions } from "@parts/paragraph/paragraph";
import type {
  ChartMediaData,
  ContentPartMediaData,
  ExtendedMediaData,
  GroupChildMediaData,
  LinkedPictureMediaData,
  MediaData,
  MediaDataTransformation,
  SmartArtMediaData,
  GroupMediaData,
  ShapeMediaData,
} from "@shared/media";
import type { NonVisualPropertiesOptions } from "@shared/media/data";
import type { SectionChild } from "@shared/section";

import type { BodyContext, DocxReadContext } from "../../context";
import type { DocPropertiesOptions, HyperlinkOptions } from "./doc-properties/doc-properties";
// Import parse function from drawing-parse.ts (parse path)
import { parseDrawingRun } from "./drawing-parse";
import type { Floating, HorizontalPositionOptions, VerticalPositionOptions } from "./floating";
import type { Margins } from "./floating";
import { HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom } from "./floating";
// wpg/wps types only
import {
  createBodyProperties,
  type BodyPropertiesOptions,
} from "./inline/graphic/graphic-data/wps/body-properties";
import type { NonVisualShapePropertiesOptions } from "./inline/graphic/graphic-data/wps/non-visual-shape-properties";
import type {
  ShapeStyleOptions,
  ShapeStyleReferenceOptions,
  ShapeCoreOptions,
} from "./inline/graphic/graphic-data/wps/wps-shape";
import { TextWrappingSide, TextWrappingType } from "./text-wrap";
import type { TextWrapping, WrapPolygon } from "./text-wrap";

// Noop context for drawingml descriptors that don't use WriteContext
const NOOP_CTX: WriteContext = {
  addRelationship: () => "",
  addMedia: () => "",
  addHyperlink: () => {},
};

// ── Options ──

/**
 * Options for the drawing descriptor.
 *
 * Combines media data with optional visual properties.
 */

/** Locking flags for wp:cNvGraphicFramePr (CT_GraphicalObjectFrameLocking). */
export interface GraphicFrameLocksOptions {
  noGrp?: boolean;
  noDrilldown?: boolean;
  noSelect?: boolean;
  noChangeAspect?: boolean;
  noMove?: boolean;
  noResize?: boolean;
  /**
   * The source carried a bare `<a:graphicFrameLocks/>` with no attributes.
   * Round-trip marker only — re-emits the empty element (element presence is
   * part of the source's fidelity) instead of dropping it.
   */
  emptyLocks?: boolean;
}

/**
 * Group shape locks (CT_GroupLocking) carried inside wpg:cNvGrpSpPr.
 * Distinct from GraphicFrameLocksOptions: groups use noUngrp/noRot instead of noDrilldown.
 */
export interface GroupShapeLocksOptions {
  noGrp?: boolean;
  noUngrp?: boolean;
  noSelect?: boolean;
  noRot?: boolean;
  noChangeAspect?: boolean;
  noMove?: boolean;
  noResize?: boolean;
}

export interface DrawingDescriptorOptions {
  /** Media data (image, chart, smartart, wps, wpg) */
  mediaData: ExtendedMediaData;
  /** Non-visual document properties (name, description, hyperlinks) */
  docProperties?: DocPropertiesOptions;
  /** Floating/anchored positioning (omit for inline) */
  floating?: Floating;
  /** Shape outline */
  outline?: OutlineOptions;
  /** Shape fill */
  fill?: FillOptions;
  /** Shape effects (shadow, glow, etc.) */
  effects?: EffectListOptions;
  /** 3D scene (pic:spPr/a:scene3d) — camera and lighting. */
  scene3d?: Scene3DOptions;
  /** 3D shape properties (pic:spPr/a:sp3d). */
  shape3d?: Shape3DOptions;
  /** Image blip effects (brightness, contrast, etc.) */
  blipEffects?: BlipEffectsOptions;
  /** Image tile fill mode */
  tile?: TileOptions;
  /** Graphic frame locks (wp:cNvGraphicFramePr). `{}` → empty element; omit → authoring default. */
  graphicFrameLocks?: GraphicFrameLocksOptions | null;
}

// ── ID generation ──

let _docPropsIdGen = uniqueNumericIdCreator();

/** Reset the doc properties ID generator (for testing). */
export const resetDrawingIdGen = (): void => {
  _docPropsIdGen = uniqueNumericIdCreator();
};

// ── Constants ──

const GRAPHIC_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const PIC_URI = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const CHART_URI = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const DGM_URI = "http://schemas.openxmlformats.org/drawingml/2006/diagram";
const WPS_URI = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape";
const WPG_URI = "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup";
const HYPERLINK_REL = RELATIONSHIP_TYPES.hyperlink;
const IMAGE_REL = RELATIONSHIP_TYPES.image;
const TEXT_BOX_REL = RELATIONSHIP_TYPES.txbxMs;
// Blip extension URIs (a:extLst under a:blip).
const SVG_BLIP_EXT_URI = "{96DAC541-7B7A-43D3-8B79-37D633B846F1}";
const USE_LOCAL_DPI_EXT_URI = "{28A0092B-C50C-407E-A947-70E740481C1C}";
const A14_NS = "http://schemas.microsoft.com/office/drawing/2010/main";

/**
 * Build the `a14:useLocalDpi` blip extension. Returns "" when the hint is
 * absent (undefined) — Word's default. val="0" (useLocalDpi=false) is the
 * common Word emission; val="1" only when explicitly set.
 */
function buildUseLocalDpiExt(useLocalDpi?: boolean): string {
  if (useLocalDpi === undefined) return "";
  return `<a:ext uri="${USE_LOCAL_DPI_EXT_URI}"><a14:useLocalDpi xmlns:a14="${A14_NS}" val="${
    useLocalDpi ? "1" : "0"
  }"/></a:ext>`;
}

// ── Hyperlink handling ──

interface HyperlinkIds {
  clickId?: string;
  hoverId?: string;
}

function registerHyperlinks(
  hyperlink: HyperlinkOptions | undefined,
  ctx: BodyContext,
): HyperlinkIds {
  if (!hyperlink) return {};
  const result: HyperlinkIds = {};
  if (hyperlink.click) {
    result.clickId = `rId${ctx.viewWrapper.relationships.add(HYPERLINK_REL, hyperlink.click, TargetModeType.EXTERNAL)}`;
  }
  if (hyperlink.hover) {
    result.hoverId = `rId${ctx.viewWrapper.relationships.add(HYPERLINK_REL, hyperlink.hover, TargetModeType.EXTERNAL)}`;
  }
  return result;
}

function buildHyperlinkChildren(ids: HyperlinkIds): string {
  const parts: string[] = [];
  const aNs = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
  if (ids.clickId) parts.push(`<a:hlinkClick r:id="${ids.clickId}" ${aNs}/>`);
  if (ids.hoverId) parts.push(`<a:hlinkHover r:id="${ids.hoverId}" ${aNs}/>`);
  return parts.join("");
}

// ── DocPr ──

function stringifyDocPr(opts: DocPropertiesOptions | undefined, hlIds: HyperlinkIds): string {
  const id = opts?.id ?? _docPropsIdGen();
  return stringifyNonVisualDrawingProperties(
    "wp:docPr",
    id,
    opts,
    "",
    buildHyperlinkChildren(hlIds),
  );
}

// ── BlipFill (image data reference) ──

/** Build `<a:srcRect .../>` from a crop spec, or "" when there is no crop. */
function buildSrcRectXml(srcRect: SourceRectangleOptions | undefined): string {
  if (!srcRect) return "";
  const srAttrs: string[] = [];
  if (srcRect.left !== undefined) srAttrs.push(`l="${srcRect.left}"`);
  if (srcRect.top !== undefined) srAttrs.push(`t="${srcRect.top}"`);
  if (srcRect.right !== undefined) srAttrs.push(`r="${srcRect.right}"`);
  if (srcRect.bottom !== undefined) srAttrs.push(`b="${srcRect.bottom}"`);
  return srAttrs.length ? `<a:srcRect ${srAttrs.join(" ")}/>` : "<a:srcRect/>";
}

function stringifyBlipFill(
  mediaData: MediaData | LinkedPictureMediaData,
  blipEffects?: BlipEffectsOptions,
  tile?: TileOptions,
  ctx?: BodyContext,
): string {
  const fileName =
    mediaData.type === "svg" && "fallback" in mediaData
      ? mediaData.fallback.fileName
      : "fileName" in mediaData
        ? mediaData.fileName
        : undefined;

  const parts: string[] = [];

  // a:blip — cstate omitted unless set; Word's default is "none", so emitting
  // it unconditionally inflates round-trip output that originally had none.
  // A linked-only picture has no embedded copy: r:link alone.
  const blipAttrs: string[] = [];
  if (fileName !== undefined) blipAttrs.push(`r:embed="{${escapeXml(fileName)}}"`);
  if (mediaData.compression !== undefined)
    blipAttrs.push(`cstate="${escapeXml(mediaData.compression)}"`);
  // External linked source (r:link) — a direct External image relationship of
  // the owning part, the same channel docPr hyperlinks use.
  if (mediaData.sourceUrl !== undefined && ctx) {
    const linkId = ctx.viewWrapper.relationships.add(
      IMAGE_REL,
      mediaData.sourceUrl,
      TargetModeType.EXTERNAL,
    );
    blipAttrs.push(`r:link="rId${linkId}"`);
  }

  // Blip extension list: useLocalDpi (rendering hint) + SVG blip reference.
  // Both live in a single shared a:extLst; emitted only when at least one ext
  // is present so blips without extensions stay self-closing.
  const extParts: string[] = [];
  const useLocalDpiExt = buildUseLocalDpiExt(mediaData.useLocalDpi);
  if (useLocalDpiExt) extParts.push(useLocalDpiExt);
  if (mediaData.type === "svg") {
    extParts.push(
      `<a:ext uri="${SVG_BLIP_EXT_URI}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="{${escapeXml(
        mediaData.fileName,
      )}}"/></a:ext>`,
    );
  }
  const extLstXml = extParts.length > 0 ? `<a:extLst>${extParts.join("")}</a:extLst>` : "";

  // Blip effects
  const blipEffectsXml = blipEffects ? stringifyBlipEffects(blipEffects, NOOP_CTX) : "";

  // CT_Blip orders the effect choice before the trailing extLst
  const blipContent = blipEffectsXml + extLstXml;
  if (blipContent) {
    parts.push(`<a:blip ${blipAttrs.join(" ")}>${blipContent}</a:blip>`);
  } else {
    parts.push(`<a:blip ${blipAttrs.join(" ")}/>`);
  }

  // Source rectangle (blip crop)
  const srcRectXml = buildSrcRectXml(mediaData.sourceRectangle);
  if (srcRectXml) parts.push(srcRectXml);

  // Tile or stretch
  if (tile) {
    const tileAttrs: string[] = [];
    if (tile.tx !== undefined) tileAttrs.push(`tx="${tile.tx}"`);
    if (tile.ty !== undefined) tileAttrs.push(`ty="${tile.ty}"`);
    if (tile.sx !== undefined) tileAttrs.push(`sx="${tile.sx}"`);
    if (tile.sy !== undefined) tileAttrs.push(`sy="${tile.sy}"`);
    const tileAttrStr = tileAttrs.length ? " " + tileAttrs.join(" ") : "";
    parts.push(`<a:tile${tileAttrStr}/>`);
  } else {
    parts.push("<a:stretch><a:fillRect/></a:stretch>");
  }

  return `<pic:blipFill>${parts.join("")}</pic:blipFill>`;
}

// ── Shape Properties (pic:spPr) ──

function stringifyShapeProps(
  transform: MediaDataTransformation,
  outline?: OutlineOptions,
  fill?: FillOptions,
  effects?: EffectListOptions,
  scene3d?: Scene3DOptions,
  shape3d?: Shape3DOptions,
): string {
  const spPr = shapePropertiesDesc.stringify(
    {
      x: transform.offset?.emus?.x ?? 0,
      y: transform.offset?.emus?.y ?? 0,
      width: transform.emus.x,
      height: transform.emus.y,
      flipHorizontal: transform.flipHorizontal,
      flipVertical: transform.flipVertical,
      rotation: transform.rotation,
      // Pictures always use a rect preset geometry.
      geometry: "rect",
      fill,
      outline,
      effects,
      scene3d,
      shape3d,
    },
    NOOP_CTX,
  );
  return `<pic:spPr bwMode="auto">${spPr ?? ""}</pic:spPr>`;
}

// ── Non-visual picture properties (pic:nvPicPr) ──

function stringifyNvPicPr(hlIds: HyperlinkIds, cNvPr?: NonVisualPropertiesOptions): string {
  const id = cNvPr?.id ?? 0;
  const cNvPrXml = stringifyNonVisualDrawingProperties(
    "pic:cNvPr",
    id,
    cNvPr,
    "",
    buildHyperlinkChildren(hlIds),
  );
  // preferRelativeResize defaults to true; only an explicit false is written.
  const cNvPicPrAttr = cNvPr?.preferRelativeResize === false ? ' preferRelativeResize="0"' : "";
  // Picture locks are tri-state: null → source had none (bare pic:cNvPicPr),
  // omitted → authoring default (Word locks the aspect of fresh pictures).
  const locks = cNvPr?.pictureLocks;
  const picLocksXml =
    locks === null
      ? ""
      : (pictureLockingDesc.stringify(locks ?? { noChangeAspect: true }, NOOP_CTX) ?? "");
  return `<pic:nvPicPr>${cNvPrXml}<pic:cNvPicPr${cNvPicPrAttr}>${picLocksXml}</pic:cNvPicPr></pic:nvPicPr>`;
}

// ── WPS shape (pure string, no class instances) ──

/** WpsShape options for stringification (extends ShapeCoreOptions with transformation). */
interface WpsStringifyOptions extends ShapeCoreOptions {
  transformation: MediaDataTransformation;
}

const SECTION_CHILD_KEYS: ReadonlySet<string> = new Set([
  "table",
  "toc",
  "textbox",
  "sdt",
  "altChunk",
  "subDoc",
  "customXml",
  "bookmarkStart",
  "bookmarkEnd",
  "rawXml",
]);

function stringifyWpsTextBoxChild(
  child: ShapeCoreOptions["children"][number],
  ctx: BodyContext,
): string {
  if (typeof child === "string") return stringifyParagraphInline(child, ctx);
  if ("paragraph" in child) return ctx.stringifyChild(child);
  if (Object.keys(child).some((key) => SECTION_CHILD_KEYS.has(key))) {
    return ctx.stringifyChild(child as SectionChild);
  }
  return stringifyParagraphInline(child as ParagraphOptions, ctx);
}

function stringifyWpsShape(opts: WpsStringifyOptions, ctx: BodyContext): string {
  const transform = opts.transformation;
  const spPrContent =
    shapePropertiesDesc.stringify(
      {
        x: transform.offset?.emus?.x ?? 0,
        y: transform.offset?.emus?.y ?? 0,
        width: transform.emus.x,
        height: transform.emus.y,
        flipHorizontal: transform.flipHorizontal,
        flipVertical: transform.flipVertical,
        rotation: transform.rotation,
        customGeometry: opts.customGeometry,
        // WPS shapes always carry geometry — default to rect when none specified.
        geometry: opts.customGeometry ? undefined : (opts.geometry ?? "rect"),
        fill: opts.fill,
        outline: opts.outline,
        effectDag: opts.effectDag,
        effects: opts.effects,
        scene3d: opts.scene3d,
        shape3d: opts.shape3d,
        extensions: opts.extensions,
      },
      ctx,
    ) ?? "";

  // Non-visual shape properties — default txBox="1"
  const cNvSpPr = opts.nonVisualProperties
    ? stringifyNonVisualShapeProperties(opts.nonVisualProperties)
    : '<wps:cNvSpPr txBox="1"/>';

  // CT_TxbxContent contains the full Word block-level group, not only
  // paragraphs: SDTs, tables, custom XML, and unknown raw children all survive.
  const childXml =
    opts.children?.map((child) => stringifyWpsTextBoxChild(child, ctx)).join("") ?? "";

  // Shape style (wps:style) — theme references, emitted after spPr (XSD order)
  const styleXml = opts.style ? stringifyShapeStyle(opts.style) : "";
  // wps:txbx — inline block content or a relationship to a passthrough
  // w14:txbx part. The relationship belongs to the current owner part, not
  // necessarily document.xml (the same shape can live in a header/footer).
  let txbxXml = childXml ? `<wps:txbx><w:txbxContent>${childXml}</w:txbxContent></wps:txbx>` : "";
  if (!childXml && opts.textBoxPart) {
    const target = textBoxRelationshipTarget(opts.textBoxPart.path, ctx);
    const existingId = ctx.viewWrapper.relationships.idOf(TEXT_BOX_REL, target);
    const relationshipId =
      existingId ?? `rId${ctx.viewWrapper.relationships.add(TEXT_BOX_REL, target)}`;
    txbxXml = `<wps:txbx r:txbx="${relationshipId}" txbxSeq="${opts.textBoxPart.sequence}"/>`;
  }
  // wps:linkedTxbx — XSD choice partner of txbx: the text lives in the linked
  // part, so the shape carries the chain reference instead of inline content.
  const linkedTxbxXml =
    !txbxXml && opts.linkedTextBox
      ? `<wps:linkedTxbx id="${opts.linkedTextBox.id}" seq="${opts.linkedTextBox.sequence}"/>`
      : "";
  // East-Asian vertical flow attribute (default false — emit only when set)
  const neafAttr = opts.normalEastAsianFlow ? ' normalEastAsianFlow="1"' : "";

  return (
    `<wps:wsp${neafAttr}>` +
    cNvSpPr +
    `<wps:spPr bwMode="auto">${spPrContent}</wps:spPr>` +
    styleXml +
    txbxXml +
    linkedTxbxXml +
    stringifyBodyPr(opts.bodyProperties) +
    "</wps:wsp>"
  );
}

function textBoxRelationshipTarget(partPath: string, ctx: BodyContext): string {
  if (!partPath.startsWith("word/")) return partPath;
  const ownerPart = ctx.viewWrapper.partName;
  if (!ownerPart?.startsWith("word/")) return partPath.slice("word/".length);
  const ownerSlash = ownerPart.lastIndexOf("/");
  const ownerDirectory = ownerSlash < 0 ? "" : ownerPart.slice(0, ownerSlash + 1);
  return partPath.startsWith(ownerDirectory)
    ? partPath.slice(ownerDirectory.length)
    : partPath.slice("word/".length);
}

function stringifyNonVisualShapeProperties(opts: NonVisualShapePropertiesOptions): string {
  let xml = "";
  // wps:cNvPr — id/name/descr/title (XSD CT_NonVisualDrawingProps)
  if (opts.id !== undefined || opts.name !== undefined) {
    const attrs: string[] = [];
    if (opts.id !== undefined) attrs.push(`id="${opts.id}"`);
    if (opts.name !== undefined) attrs.push(`name="${escapeXml(opts.name)}"`);
    if (opts.description !== undefined) attrs.push(`descr="${escapeXml(opts.description)}"`);
    if (opts.title !== undefined) attrs.push(`title="${escapeXml(opts.title)}"`);
    xml += `<wps:cNvPr ${attrs.join(" ")}/>`;
  }
  // CT_WordprocessingShape choice: wps:cNvSpPr (text box/autoshape) or
  // wps:cNvCnPr (connector). Each carries its optional locks element.
  if (opts.connector) {
    xml += opts.connectorLocking
      ? `<wps:cNvCnPr>${connectorLockingDesc.stringify(opts.connectorLocking, NOOP_CTX)}</wps:cNvCnPr>`
      : "<wps:cNvCnPr/>";
  } else {
    const locks = opts.locking ? (shapeLockingDesc.stringify(opts.locking, NOOP_CTX) ?? "") : "";
    const txBox = opts.textBox !== undefined ? ` txBox="${opts.textBox}"` : "";
    xml += locks ? `<wps:cNvSpPr${txBox}>${locks}</wps:cNvSpPr>` : `<wps:cNvSpPr${txBox}/>`;
  }
  return xml;
}

/** Stringify a single style-matrix reference (a:lnRef/a:fillRef/...). */
function stringifyStyleRef(name: string, ref: ShapeStyleReferenceOptions | undefined): string {
  if (!ref) return "";
  const colorXml = ref.color ? createColorElement(ref.color) : "";
  if (colorXml) return `<${name} idx="${ref.index}">${colorXml}</${name}>`;
  return `<${name} idx="${ref.index}"/>`;
}

/** Stringify a:fontRef — @idx is ST_FontCollectionIndex, not a number. */
function stringifyFontRef(ref: ShapeStyleOptions["fontReference"] | undefined): string {
  if (!ref) return "";
  const colorXml = ref.color ? createColorElement(ref.color) : "";
  if (colorXml) return `<a:fontRef idx="${escapeXml(ref.collection)}">${colorXml}</a:fontRef>`;
  return `<a:fontRef idx="${escapeXml(ref.collection)}"/>`;
}

/** Stringify a wps:style (CT_ShapeStyle): lnRef/fillRef/effectRef/fontRef. */
function stringifyShapeStyle(opts: ShapeStyleOptions): string {
  const inner =
    stringifyStyleRef("a:lnRef", opts.lineReference) +
    stringifyStyleRef("a:fillRef", opts.fillReference) +
    stringifyStyleRef("a:effectRef", opts.effectReference) +
    stringifyFontRef(opts.fontReference);
  return inner ? `<wps:style>${inner}</wps:style>` : "";
}

function stringifyBodyPr(opts?: BodyPropertiesOptions): string {
  // Delegate to the shared createBodyProperties so attributes + EG_TextAutofit
  // (noAutofit/normAutofit/spAutoFit) + prstTxWarp/3D all round-trip. The old
  // inline copy dropped noAutoFit/spAutoFit and most CT_TextBodyProperties attrs.
  return createBodyProperties(opts ?? {});
}

// ── WPG group (pure string, no class instances) ──

function stringifyWpgGroup(
  opts: {
    children: readonly GroupChildMediaData[];
    transformation: MediaDataTransformation;
    childOffsetX?: number;
    childOffsetY?: number;
    childExtentWidth?: number;
    childExtentHeight?: number;
    fill?: FillOptions;
    effects?: EffectListOptions;
    groupShapeLocks?: GroupShapeLocksOptions | null;
  },
  ctx: BodyContext,
): string {
  const transform = opts.transformation;
  const grpSpPrContent =
    groupShapePropertiesDesc.stringify(
      {
        x: transform.offset?.emus?.x ?? 0,
        y: transform.offset?.emus?.y ?? 0,
        width: transform.emus.x,
        height: transform.emus.y,
        flipHorizontal: transform.flipHorizontal,
        flipVertical: transform.flipVertical,
        rotation: transform.rotation,
        childOffsetX: opts.childOffsetX,
        childOffsetY: opts.childOffsetY,
        childExtentWidth: opts.childExtentWidth,
        childExtentHeight: opts.childExtentHeight,
        fill: opts.fill,
        effects: opts.effects,
      },
      ctx,
    ) ?? "";

  // Children — wps shapes, nested wpg groups, or pic elements
  const childXml = opts.children.map((child) => stringifyGroupChild(child, ctx)).join("");

  return (
    "<wpg:wgp>" +
    stringifyCnvGrpSpPr(opts.groupShapeLocks) +
    `<wpg:grpSpPr>${grpSpPrContent}</wpg:grpSpPr>` +
    childXml +
    "</wpg:wgp>"
  );
}

/**
 * Stringify one group child: a wps shape, a nested wpg group, or a picture.
 * Shared by the top-level wpg:wgp and nested wpg:grpSp.
 */
function stringifyGroupChild(child: GroupChildMediaData, ctx: BodyContext): string {
  if (child.type === "wps") {
    const wpsData = child as ShapeMediaData & { outline?: OutlineOptions; fill?: FillOptions };
    return stringifyWpsShape(
      {
        ...wpsData.data,
        outline: wpsData.outline ?? wpsData.data.outline,
        fill: wpsData.fill ?? wpsData.data.fill,
        transformation: wpsData.transformation,
      },
      ctx,
    );
  }
  if (child.type === "wpg") {
    return stringifyNestedGroup(child as GroupMediaData, ctx);
  }
  if (child.type === "chart") {
    return stringifyGroupGraphicFrame(child as ChartMediaData);
  }
  if (child.type === "contentPart") {
    return stringifyContentPart("wpg", child as ContentPartMediaData);
  }
  // pic child (MediaData) — fill/outline ride on the group-child extension
  // (GroupCommonMediaData) so a grouped picture's spPr round-trips verbatim.
  const picData = child as MediaData & { outline?: OutlineOptions; fill?: FillOptions };
  const isSvg = picData.type === "svg";
  // a:blip r:embed targets the raster fallback for SVG pictures (what legacy
  // viewers render); the vector SVG lives in the svgBlip extension below.
  const blipTarget = isSvg && "fallback" in picData ? picData.fallback.fileName : picData.fileName;
  const picParts: string[] = [];
  picParts.push(stringifyNvPicPr({}, picData.nonVisualProperties));
  const groupBlipParts: string[] = [];
  const extParts: string[] = [];
  const useLocalDpiExt = buildUseLocalDpiExt(picData.useLocalDpi);
  if (useLocalDpiExt) extParts.push(useLocalDpiExt);
  if (isSvg) {
    extParts.push(
      `<a:ext uri="${SVG_BLIP_EXT_URI}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="{${escapeXml(
        picData.fileName,
      )}}"/></a:ext>`,
    );
  }
  const extLst = extParts.length > 0 ? `<a:extLst>${extParts.join("")}</a:extLst>` : "";
  groupBlipParts.push(
    extLst
      ? `<a:blip r:embed="{${escapeXml(blipTarget)}}">${extLst}</a:blip>`
      : `<a:blip r:embed="{${escapeXml(blipTarget)}}"/>`,
  );
  const groupSrcRectXml = buildSrcRectXml(picData.sourceRectangle);
  if (groupSrcRectXml) groupBlipParts.push(groupSrcRectXml);
  groupBlipParts.push("<a:stretch><a:fillRect/></a:stretch>");
  picParts.push(`<pic:blipFill>${groupBlipParts.join("")}</pic:blipFill>`);
  picParts.push(stringifyShapeProps(picData.transformation, picData.outline, picData.fill));
  return `<pic:pic xmlns:pic="${PIC_URI}">${picParts.join("")}</pic:pic>`;
}

/**
 * Stringify a wpg:graphicFrame group child (CT_GraphicFrame): cNvPr +
 * cNvFrPr + a:xfrm + a:graphic. Charts are the graphic payload Word produces
 * inside groups; the chart part is registered by the group dispatch.
 */
function stringifyGroupGraphicFrame(md: ChartMediaData): string {
  const nvp = md.nonVisualProperties;
  const cNvPrXml = stringifyNonVisualDrawingProperties("wpg:cNvPr", nvp?.id ?? 0, nvp, "Chart");
  const cNvFrPrXml = stringifyCnvFrPr(md.graphicFrameLocks);
  const xfrmXml = stringifyChildXfrm("wpg", md.transformation);
  return (
    "<wpg:graphicFrame>" +
    cNvPrXml +
    cNvFrPrXml +
    xfrmXml +
    `<a:graphic ${GRAPHIC_NS}>` +
    `<a:graphicData uri="${CHART_URI}">` +
    `<c:chart xmlns:c="${CHART_URI}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="{chart:${md.chartKey}}"/>` +
    `</a:graphicData>` +
    `</a:graphic>` +
    "</wpg:graphicFrame>"
  );
}

/** Render wpg:cNvFrPr (CT_NonVisualGraphicFrameProperties — a:graphicFrameLocks). */
function stringifyCnvFrPr(locks?: GraphicFrameLocksOptions | null): string {
  if (!locks) return "<wpg:cNvFrPr/>";
  const attrParts: string[] = [];
  if (locks.noGrp) attrParts.push('noGrp="1"');
  if (locks.noDrilldown) attrParts.push('noDrilldown="1"');
  if (locks.noSelect) attrParts.push('noSelect="1"');
  if (locks.noChangeAspect) attrParts.push('noChangeAspect="1"');
  if (locks.noMove) attrParts.push('noMove="1"');
  if (locks.noResize) attrParts.push('noResize="1"');
  if (attrParts.length === 0) return "<wpg:cNvFrPr/>";
  const attrStr = " " + attrParts.join(" ");
  return `<wpg:cNvFrPr><a:graphicFrameLocks${attrStr} xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/></wpg:cNvFrPr>`;
}

/**
 * Build the xfrm (off/ext) of a nested drawing from its transformation. The
 * root tag is host-namespaced (local element of CT_GraphicFrame /
 * CT_WordprocessingContentPart); the off/ext children belong to a:.
 */
function stringifyChildXfrm(prefix: "wp" | "wpg", t: MediaDataTransformation): string {
  const x = t.offset?.emus?.x ?? 0;
  const y = t.offset?.emus?.y ?? 0;
  const flipAttrs = (t.flipHorizontal ? ' flipH="1"' : "") + (t.flipVertical ? ' flipV="1"' : "");
  const rotAttr = t.rotation !== undefined ? ` rot="${t.rotation}"` : "";
  return `<${prefix}:xfrm${flipAttrs}${rotAttr}><a:off x="${x}" y="${y}"/><a:ext cx="${t.emus.x}" cy="${t.emus.y}"/></${prefix}:xfrm>`;
}

/**
 * Stringify a wpg:contentPart child (CT_WordprocessingContentPart) inside a
 * group: nvContentPartPr (cNvPr + cNvContentPartPr) + a:xfrm + `@bwMode`/`@r:id`.
 * A content part never appears at the wp:inline/wp:anchor root (CT_Inline and
 * CT_Anchor take a:graphic only) — the run-level form is w:contentPart.
 */
function stringifyContentPart(prefix: "wpg", md: ContentPartMediaData): string {
  const nvp = md.nonVisualProperties;
  const attrParts = [`r:id="${escapeXml(md.referenceId)}"`];
  if (md.blackWhiteMode) attrParts.push(`bwMode="${escapeXml(md.blackWhiteMode)}"`);
  const nvInner =
    stringifyNonVisualDrawingProperties(`${prefix}:cNvPr`, nvp?.id ?? 0, nvp, "Content Part") +
    stringifyNonVisualContentPartProperties(`${prefix}:cNvContentPartPr`, nvp?.contentPart);
  const nvXml = nvInner ? `<${prefix}:nvContentPartPr>${nvInner}</${prefix}:nvContentPartPr>` : "";
  return (
    `<${prefix}:contentPart ${attrParts.join(" ")}>` +
    nvXml +
    stringifyChildXfrm(prefix, md.transformation) +
    `</${prefix}:contentPart>`
  );
}

/**
 * Stringify a nested wpg:grpSp (CT_WordprocessingGroup) group child. Same
 * structure as the top-level group, wrapped in wpg:grpSp with a cNvPr id/name.
 */
function stringifyNestedGroup(grp: GroupMediaData, ctx: BodyContext): string {
  const grpSpPrContent =
    groupShapePropertiesDesc.stringify(
      {
        x: grp.transformation.offset?.emus?.x ?? 0,
        y: grp.transformation.offset?.emus?.y ?? 0,
        width: grp.transformation.emus.x,
        height: grp.transformation.emus.y,
        flipHorizontal: grp.transformation.flipHorizontal,
        flipVertical: grp.transformation.flipVertical,
        rotation: grp.transformation.rotation,
        childOffsetX: grp.childOffsetX,
        childOffsetY: grp.childOffsetY,
        childExtentWidth: grp.childExtentWidth,
        childExtentHeight: grp.childExtentHeight,
        fill: grp.fill,
        effects: grp.effects,
      },
      ctx,
    ) ?? "";
  return (
    "<wpg:grpSp>" +
    '<wpg:cNvPr id="0" name=""/>' +
    stringifyCnvGrpSpPr(grp.groupShapeLocks) +
    `<wpg:grpSpPr>${grpSpPrContent}</wpg:grpSpPr>` +
    grp.children.map((c) => stringifyGroupChild(c, ctx)).join("") +
    "</wpg:grpSp>"
  );
}

// ── Graphic data content ──

function stringifyGraphicDataContent(
  mediaData: ExtendedMediaData,
  opts: DrawingDescriptorOptions,
  hlIds: HyperlinkIds,
  ctx: BodyContext,
): string {
  const { outline, fill, effects, scene3d, shape3d, blipEffects, tile } = opts;
  const transform = mediaData.transformation;

  if (mediaData.type === "chart") {
    const md = mediaData as ChartMediaData;
    return (
      `<a:graphicData uri="${CHART_URI}">` +
      `<c:chart xmlns:c="${CHART_URI}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="{chart:${md.chartKey}}"/>` +
      `</a:graphicData>`
    );
  }

  if (mediaData.type === "smartart") {
    const md = mediaData as SmartArtMediaData;
    return (
      `<a:graphicData uri="${DGM_URI}">` +
      `<dgm:relIds xmlns:dgm="${DGM_URI}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:dm="{smartart:${md.smartArtKey}}" r:lo="{smartart-lo:${md.smartArtKey}}" r:qs="{smartart-qs:${md.smartArtKey}}" r:cs="{smartart-cs:${md.smartArtKey}}"/>` +
      `</a:graphicData>`
    );
  }

  if (mediaData.type === "wps") {
    const md = mediaData as ShapeMediaData;
    const wpsXml = stringifyWpsShape(
      {
        ...md.data,
        outline: outline ?? md.data.outline,
        fill: fill ?? md.data.fill,
        transformation: transform,
      },
      ctx,
    );
    return `<a:graphicData uri="${WPS_URI}">${wpsXml}</a:graphicData>`;
  }

  if (mediaData.type === "wpg") {
    const md = mediaData as GroupMediaData;
    const wpgXml = stringifyWpgGroup(
      {
        children: md.children,
        transformation: transform,
        childOffsetX: md.childOffsetX,
        childOffsetY: md.childOffsetY,
        childExtentWidth: md.childExtentWidth,
        childExtentHeight: md.childExtentHeight,
        fill: md.fill,
        effects: md.effects,
        groupShapeLocks: md.groupShapeLocks,
      },
      ctx,
    );
    return `<a:graphicData uri="${WPG_URI}">${wpgXml}</a:graphicData>`;
  }

  // Default: image (pic:pic)
  const md = mediaData as MediaData | LinkedPictureMediaData;
  return (
    `<a:graphicData uri="${PIC_URI}">` +
    `<pic:pic xmlns:pic="${PIC_URI}">` +
    stringifyNvPicPr(hlIds, md.nonVisualProperties) +
    stringifyBlipFill(md, blipEffects, tile, ctx) +
    stringifyShapeProps(transform, outline, fill, effects, scene3d, shape3d) +
    `</pic:pic></a:graphicData>`
  );
}

// ── Position helpers (for anchor) ──

function wrapPercentagePosition(
  tag: "wp14:pctPosHOffset" | "wp14:pctPosVOffset",
  positionTag: "wp:positionH" | "wp:positionV",
  relative: string,
  percentOffset: number,
  fallbackOffset: HorizontalPositionOptions["offset"],
): string {
  const choice = `<${positionTag} relativeFrom="${relative}"><${tag}>${Math.round(percentOffset * 1000)}</${tag}></${positionTag}>`;
  if (fallbackOffset === undefined) return choice;
  return (
    '<mc:AlternateContent><mc:Choice Requires="wp14">' +
    choice +
    `</mc:Choice><mc:Fallback><${positionTag} relativeFrom="${relative}"><wp:posOffset>${convertToEmu(fallbackOffset)}</wp:posOffset></${positionTag}></mc:Fallback></mc:AlternateContent>`
  );
}

function stringifyPositionH(opts: HorizontalPositionOptions): string {
  const rel = opts.relative ?? HorizontalPositionRelativeFrom.PAGE;
  if (opts.percentOffset !== undefined) {
    return wrapPercentagePosition(
      "wp14:pctPosHOffset",
      "wp:positionH",
      rel,
      opts.percentOffset,
      opts.offset,
    );
  }
  const child = opts.align
    ? `<wp:align>${opts.align}</wp:align>`
    : opts.offset !== undefined
      ? `<wp:posOffset>${convertToEmu(opts.offset)}</wp:posOffset>`
      : "<wp:align>left</wp:align>";
  return `<wp:positionH relativeFrom="${rel}">${child}</wp:positionH>`;
}

function stringifyPositionV(opts: VerticalPositionOptions): string {
  const rel = opts.relative ?? VerticalPositionRelativeFrom.PAGE;
  if (opts.percentOffset !== undefined) {
    return wrapPercentagePosition(
      "wp14:pctPosVOffset",
      "wp:positionV",
      rel,
      opts.percentOffset,
      opts.offset,
    );
  }
  const child = opts.align
    ? `<wp:align>${opts.align}</wp:align>`
    : opts.offset !== undefined
      ? `<wp:posOffset>${convertToEmu(opts.offset)}</wp:posOffset>`
      : "<wp:align>top</wp:align>";
  return `<wp:positionV relativeFrom="${rel}">${child}</wp:positionV>`;
}

// ── Text wrapping string builders ──

function wrapPolygonStr(cx: number, cy: number, polygon?: WrapPolygon): string {
  // Preserve the source contour verbatim when round-tripped.
  if (polygon?.points.length) {
    // Emit `edited` only when the source had it — keeps the polygon byte-faithful on round-trip.
    const editedAttr = polygon.edited !== undefined ? ` edited="${polygon.edited ? 1 : 0}"` : "";
    const [start, ...rest] = polygon.points;
    // length guard above guarantees `start` exists
    const startStr = `<wp:start x="${start!.x}" y="${start!.y}"/>`;
    const lineToStr = rest.map((p) => `<wp:lineTo x="${p.x}" y="${p.y}"/>`).join("");
    return `<wp:wrapPolygon${editedAttr}>${startStr}${lineToStr}</wp:wrapPolygon>`;
  }
  // Default contour: extent rectangle (origin at top-left, y negated).
  return (
    `<wp:wrapPolygon edited="0">` +
    `<wp:start x="0" y="0"/>` +
    `<wp:lineTo x="0" y="${-cy}"/>` +
    `<wp:lineTo x="${cx}" y="${-cy}"/>` +
    `<wp:lineTo x="${cx}" y="0"/>` +
    `<wp:lineTo x="0" y="0"/>` +
    `</wp:wrapPolygon>`
  );
}

function wrapSquareStr(textWrapping: TextWrapping, margins?: Margins): string {
  const side = textWrapping.side ?? TextWrappingSide.BOTH_SIDES;
  const m = margins ?? {};
  const a = [
    `wrapText="${side}"`,
    ...(m.top != null ? [`distT="${convertToEmu(m.top)}"`] : []),
    ...(m.bottom != null ? [`distB="${convertToEmu(m.bottom)}"`] : []),
    ...(m.left != null ? [`distL="${convertToEmu(m.left)}"`] : []),
    ...(m.right != null ? [`distR="${convertToEmu(m.right)}"`] : []),
  ].join(" ");
  return `<wp:wrapSquare ${a}/>`;
}

function wrapTightStr(
  textWrapping: TextWrapping,
  margins: Margins,
  cx: number,
  cy: number,
): string {
  const side = textWrapping.side ?? TextWrappingSide.BOTH_SIDES;
  const a = [`wrapText="${side}"`];
  if (margins.left != null) a.push(`distL="${convertToEmu(margins.left)}"`);
  if (margins.right != null) a.push(`distR="${convertToEmu(margins.right)}"`);
  return `<wp:wrapTight ${a.join(" ")}>${wrapPolygonStr(cx, cy, textWrapping.polygon)}</wp:wrapTight>`;
}

function wrapThroughStr(
  textWrapping: TextWrapping,
  margins: Margins,
  cx: number,
  cy: number,
): string {
  const side = textWrapping.side ?? TextWrappingSide.BOTH_SIDES;
  const a = [`wrapText="${side}"`];
  if (margins.left != null) a.push(`distL="${convertToEmu(margins.left)}"`);
  if (margins.right != null) a.push(`distR="${convertToEmu(margins.right)}"`);
  return `<wp:wrapThrough ${a.join(" ")}>${wrapPolygonStr(cx, cy, textWrapping.polygon)}</wp:wrapThrough>`;
}

function wrapTopAndBottomStr(margins?: Margins): string {
  const m = margins ?? {};
  const a = [
    ...(m.top != null ? [`distT="${convertToEmu(m.top)}"`] : []),
    ...(m.bottom != null ? [`distB="${convertToEmu(m.bottom)}"`] : []),
  ].join(" ");
  return a ? `<wp:wrapTopAndBottom ${a}/>` : "<wp:wrapTopAndBottom/>";
}

// ── Inline wrapper ──

/** Render wp:cNvGraphicFramePr. Null → source had none, omit the element;
 *  undefined → authoring default (noChangeAspect=1); `{}` → source had the
 *  frame without a locks child; `emptyLocks` → bare `<a:graphicFrameLocks/>`;
 *  otherwise the given lock flags. */
function stringifyCnvGraphicFramePr(locks?: GraphicFrameLocksOptions | null): string {
  if (locks === null) return "";
  const resolved = locks ?? { noChangeAspect: true };
  if (resolved.emptyLocks) {
    return '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/></wp:cNvGraphicFramePr>';
  }
  const attrParts: string[] = [];
  if (resolved.noGrp) attrParts.push('noGrp="1"');
  if (resolved.noDrilldown) attrParts.push('noDrilldown="1"');
  if (resolved.noSelect) attrParts.push('noSelect="1"');
  if (resolved.noChangeAspect) attrParts.push('noChangeAspect="1"');
  if (resolved.noMove) attrParts.push('noMove="1"');
  if (resolved.noResize) attrParts.push('noResize="1"');
  if (attrParts.length === 0) return "<wp:cNvGraphicFramePr/>";
  const attrStr = " " + attrParts.join(" ");
  return `<wp:cNvGraphicFramePr><a:graphicFrameLocks${attrStr} xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/></wp:cNvGraphicFramePr>`;
}

/**
 * Stringify wpg:cNvGrpSpPr (CT_NonVisualGroupShapeDrawingProperties): contains
 * an optional a:grpSpLocks (CT_GroupLocking). When no locks are present (the
 * Word default for groups) the element stays empty — groups do NOT inject a
 * default lock, unlike wp:cNvGraphicFramePr.
 */
function stringifyCnvGrpSpPr(locks?: GroupShapeLocksOptions | null): string {
  if (!locks) return "<wpg:cNvGrpSpPr/>";
  const attrParts: string[] = [];
  if (locks.noGrp) attrParts.push('noGrp="1"');
  if (locks.noUngrp) attrParts.push('noUngrp="1"');
  if (locks.noSelect) attrParts.push('noSelect="1"');
  if (locks.noRot) attrParts.push('noRot="1"');
  if (locks.noChangeAspect) attrParts.push('noChangeAspect="1"');
  if (locks.noMove) attrParts.push('noMove="1"');
  if (locks.noResize) attrParts.push('noResize="1"');
  if (attrParts.length === 0) return "<wpg:cNvGrpSpPr/>";
  const attrStr = " " + attrParts.join(" ");
  return `<wpg:cNvGrpSpPr><a:grpSpLocks${attrStr} xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/></wpg:cNvGrpSpPr>`;
}

function stringifyInline(
  opts: DrawingDescriptorOptions,
  hlIds: HyperlinkIds,
  ctx: BodyContext,
): string {
  const { mediaData, effects, docProperties } = opts;
  const cx = mediaData.transformation.emus.x;
  const cy = mediaData.transformation.emus.y;

  // Prefer the verbatim source effectExtent (round-trip); fall back to
  // computing it from the shape's effects on the generation path.
  const effectExtent = mediaData.transformation.effectExtent ?? calculateEffectExtent(effects);
  // CT_Inline's choice is a:graphic — a content part only nests inside a wpg
  // group or canvas, never directly under wp:inline.
  const choiceXml = `<a:graphic ${GRAPHIC_NS}>${stringifyGraphicDataContent(mediaData, opts, hlIds, ctx)}</a:graphic>`;

  return (
    `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:effectExtent l="${effectExtent.l}" t="${effectExtent.t}" r="${effectExtent.r}" b="${effectExtent.b}"/>` +
    stringifyDocPr(docProperties, hlIds) +
    stringifyCnvGraphicFramePr(opts.graphicFrameLocks) +
    choiceXml +
    `</wp:inline></w:drawing>`
  );
}

// ── Anchor (floating) wrapper ──

function stringifyAnchor(
  opts: DrawingDescriptorOptions,
  hlIds: HyperlinkIds,
  ctx: BodyContext,
): string {
  const { mediaData, floating: rawFloating, docProperties } = opts;
  const cx = mediaData.transformation.emus.x;
  const cy = mediaData.transformation.emus.y;

  const floating: Floating = {
    allowOverlap: true,
    behindDocument: false,
    horizontalPosition: {},
    layoutInCell: true,
    lockAnchor: false,
    verticalPosition: {},
    zIndex: mediaData.transformation.emus.y,
    margins: {},
    wrap: { type: TextWrappingType.NONE },
    ...rawFloating,
  };

  const attrParts = [
    `distT="${convertToEmu(floating.margins?.top ?? 0)}"`,
    `distB="${convertToEmu(floating.margins?.bottom ?? 0)}"`,
    `distL="${convertToEmu(floating.margins?.left ?? 0)}"`,
    `distR="${convertToEmu(floating.margins?.right ?? 0)}"`,
    'simplePos="0"',
    `allowOverlap="${floating.allowOverlap ? 1 : 0}"`,
    `behindDoc="${floating.behindDocument ? 1 : 0}"`,
    `locked="${floating.lockAnchor ? 1 : 0}"`,
    `layoutInCell="${floating.layoutInCell ? 1 : 0}"`,
    `relativeHeight="${floating.zIndex}"`,
  ];

  // Wrap
  let wrapXml: string;
  const rawWrap = rawFloating?.wrap;
  if (rawWrap?.type === TextWrappingType.SQUARE) {
    wrapXml = wrapSquareStr(rawWrap, floating.margins);
  } else if (rawWrap?.type === TextWrappingType.TIGHT) {
    wrapXml = wrapTightStr(rawWrap, floating.margins ?? {}, cx, cy);
  } else if (rawWrap?.type === TextWrappingType.THROUGH) {
    wrapXml = wrapThroughStr(rawWrap, floating.margins ?? {}, cx, cy);
  } else if (rawWrap?.type === TextWrappingType.TOP_AND_BOTTOM) {
    wrapXml = wrapTopAndBottomStr(floating.margins);
  } else {
    wrapXml = "<wp:wrapNone/>";
  }

  // CT_Anchor's choice is a:graphic — a content part only nests inside a wpg
  // group or canvas, never directly under wp:anchor.
  const choiceXml = `<a:graphic ${GRAPHIC_NS}>${stringifyGraphicDataContent(mediaData, opts, hlIds, ctx)}</a:graphic>`;

  // Prefer the verbatim source effectExtent (round-trip); default to zero.
  const ee = mediaData.transformation.effectExtent;
  const effectExtentXml = ee
    ? `<wp:effectExtent l="${ee.l}" t="${ee.t}" r="${ee.r}" b="${ee.b}"/>`
    : '<wp:effectExtent l="0" t="0" r="0" b="0"/>';

  // wp14:sizeRelH/V trail a:graphic in CT_Anchor (Word 2010+); percent is a
  // whole-number percentage in the API, pctWidth/pctHeight carry 1/1000 %.
  const sizeRelH = rawFloating?.horizontalSize;
  const sizeRelV = rawFloating?.verticalSize;
  const sizeRelXml =
    (sizeRelH
      ? `<wp14:sizeRelH${sizeRelH.relative ? ` relativeFrom="${sizeRelH.relative}"` : ""}>` +
        `<wp14:pctWidth>${Math.round((sizeRelH.percent ?? 0) * 1000)}</wp14:pctWidth></wp14:sizeRelH>`
      : "") +
    (sizeRelV
      ? `<wp14:sizeRelV${sizeRelV.relative ? ` relativeFrom="${sizeRelV.relative}"` : ""}>` +
        `<wp14:pctHeight>${Math.round((sizeRelV.percent ?? 0) * 1000)}</wp14:pctHeight></wp14:sizeRelV>`
      : "");

  return (
    `<w:drawing><wp:anchor ${attrParts.join(" ")}>` +
    '<wp:simplePos x="0" y="0"/>' +
    stringifyPositionH(floating.horizontalPosition) +
    stringifyPositionV(floating.verticalPosition) +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    effectExtentXml +
    wrapXml +
    stringifyDocPr(docProperties, hlIds) +
    stringifyCnvGraphicFramePr(opts.graphicFrameLocks) +
    choiceXml +
    sizeRelXml +
    `</wp:anchor></w:drawing>`
  );
}

// ── Descriptor ──

/**
 * Drawing descriptor for DOCX `<w:drawing>` elements.
 *
 * Eliminates the Drawing/Inline/Anchor/Graphic/GraphicData/Pic XmlComponent
 * class chain. Inline images, charts, and smartarts produce XML via pure
 * string concatenation — zero XmlComponent instances.
 *
 * @example
 * ```typescript
 * const xml = drawingDesc.stringify({ mediaData, docProperties: opts.altText, floating: opts.floating }, ctx);
 * ```
 */
export const drawingDesc: CustomDescriptor<DrawingDescriptorOptions, BodyContext> = {
  kind: "custom",

  stringify(opts, ctx) {
    // Register hyperlink relationships
    const hlIds = registerHyperlinks(opts.docProperties?.hyperlink, ctx);

    if (opts.floating) {
      return stringifyAnchor(opts, hlIds, ctx);
    }
    return stringifyInline(opts, hlIds, ctx);
  },

  parse(el, ctx) {
    const result = parseDrawingRun(el, ctx as DocxReadContext);
    return (result ?? {}) as unknown as DrawingDescriptorOptions;
  },
};
