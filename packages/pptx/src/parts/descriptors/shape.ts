/**
 * Shape (p:sp) and Picture (p:pic) descriptors for PPTX slides.
 *
 * These CustomDescriptor implementations produce the same XML output as the
 * class-based Shape and Picture components, but through the descriptor pipeline.
 *
 * @module
 */

import {
  convertEmuToPixels,
  convertToEmu,
  parseOnOff,
  toUint8Array,
  xsdPlaceholderType,
} from "@office-open/core";
import type { NonVisualDrawingPropertiesOptions, ShapeLockingOptions } from "@office-open/core";
import type { CustomDescriptor, WriteContext, ReadContext } from "@office-open/core/descriptor";
import { parse, stringify } from "@office-open/core/descriptor";
import {
  shapeLockingDesc,
  effectListDesc,
  shapePropertiesDesc,
  scene3DDesc,
  shape3DDesc,
  textBodyDesc,
  stringifyNonVisualDrawingProperties,
  parseNonVisualDrawingProperties,
  pictureLockingDesc,
  blipDesc,
  createSourceRectangle,
  fillDesc,
  findFillChild,
  outlineDesc,
  stringifyColorChoice,
  registerHyperlink,
  buildHyperlinkElement,
  readHyperlink,
} from "@office-open/core/drawing";
import type {
  BlipCompression,
  SourceRectangleOptions,
  Transform2DOptions,
} from "@office-open/core/drawing";
import type { Element as XmlElement } from "@office-open/xml";
import { findChild, findFirst, attrNum, attr } from "@office-open/xml";
import { imageTypeFromPath } from "@shared/media/image-type";
import type { PictureOptions } from "@shared/picture";
import {
  readShapeStyle,
  type ShapeOptions,
  type ShapeStyleOptions,
  type StyleReferenceColor,
} from "@shared/shape/shape";

import type { PptxWriteContext, MediaEntry } from "../../context";
import { readNvPrPlaceholder, stringifyNvPr } from "./graphic-frame";

// ── Auto-incrementing IDs ──

let _nextShapeId = 2;
let _nextPictureId = 100;

/** Reset shape ID counter (useful for tests). */
export function resetShapeIdCounter(value = 2): void {
  _nextShapeId = value;
}

// ── Shape (p:sp) descriptor ──

export const shapeDesc: CustomDescriptor<ShapeOptions> = {
  kind: "custom",

  stringify(opts, ctx) {
    const id = opts.id ?? _nextShapeId++;
    const name = opts.name ?? `Shape ${id}`;
    (ctx as PptxWriteContext).registerShapeId(name, id);
    const parts: string[] = [];

    // ── p:nvSpPr ──
    parts.push(stringifyNvSpPr(id, name, opts, ctx));

    // ── p:spPr ──
    const spPrXml = stringifySpPr(opts, ctx);
    if (spPrXml) parts.push(spPrXml);

    // ── p:style ──
    if (opts.style) {
      const styleXml = stringifyShapeStyle(opts.style, ctx);
      if (styleXml) parts.push(styleXml);
    }

    // ── p:txBody (optional in CT_Shape; omitted when absent so txBody-less
    // shapes like the notes sldImg placeholder round-trip without a spurious
    // empty body. Parse only sets textBody when a p:txBody element exists.)
    if (opts.textBody !== undefined) {
      parts.push(`<p:txBody>${textBodyDesc.stringify(opts.textBody, ctx) ?? ""}</p:txBody>`);
    }

    // ── Root attributes ──
    const spAttrs: string[] = [];
    if (opts.useBackgroundFill) spAttrs.push(' useBgFill="1"');

    return `<p:sp${spAttrs.join("")}>${parts.join("")}</p:sp>`;
  },

  parse(el, ctx) {
    const result: ShapeOptions = {};

    // Root attributes
    if (el.attributes) {
      if (el.attributes["useBgFill"] !== undefined)
        result.useBackgroundFill = parseOnOff(el.attributes["useBgFill"]) ?? false;
    }

    // p:nvSpPr — readNvSpPr returns the full ShapeOptions shape; assign whole
    // so fields added later flow without touching this whitelist.
    const nvSpPr = findChild(el, "p:nvSpPr");
    if (nvSpPr) {
      Object.assign(result, readNvSpPr(nvSpPr, ctx));
    }

    // p:spPr — transform goes top-level, paint fields land on `properties`;
    // @bwMode is a container attribute so it stays top-level too.
    const spPr = findChild(el, "p:spPr");
    if (spPr) {
      const { properties, ...transform } = readSpPr(spPr, ctx);
      Object.assign(result, transform);
      result.properties = properties;
      const bwMode = spPr.attributes?.["bwMode"];
      if (bwMode !== undefined) {
        result.blackWhiteMode = String(bwMode) as ShapeOptions["blackWhiteMode"];
      }
    }

    // p:style
    const style = findChild(el, "p:style");
    if (style) result.style = readShapeStyle(style, ctx);

    // p:txBody
    const txBody = findChild(el, "p:txBody");
    if (txBody) result.textBody = textBodyDesc.parse(txBody, ctx);

    return result;
  },
};

// ── Picture (p:pic) descriptor ──

export const pictureDesc: CustomDescriptor<PictureOptions> = {
  kind: "custom",

  stringify(opts, ctx) {
    const pptx = ctx as PptxWriteContext;
    const id = opts.id ?? _nextPictureId++;
    const name = opts.name ?? `Picture ${id}`;
    pptx.registerShapeId(name, id);

    // Geometry: number is already EMU, string is UniversalMeasure → EMU
    const widthEmu = convertToEmu(opts.width ?? 0);
    const heightEmu = convertToEmu(opts.height ?? 0);

    // A linked-only picture (external URL, no bytes) registers no media —
    // its slide carries one External image relationship instead. A byteless
    // picture with no link either (a broken source reference) registers none
    // as well: there are no bytes to store, so the blip re-emits bare.
    let mediaFileName: string | undefined;
    if (opts.data !== undefined) {
      const fileName = opts.fileName ?? `${name.replace(/\s+/g, "_")}.${opts.type}`;
      // Register media with the PPTX context (content-deduplicated)
      const mediaEntry = pptx.addImage(fileName, {
        key: fileName,
        type: opts.type,
        fileName,
        data: toUint8Array(opts.data ?? new Uint8Array(0), { encoding: "base64" }),
        transformation: {
          pixels: {
            x: Math.round(convertEmuToPixels(widthEmu)),
            y: Math.round(convertEmuToPixels(heightEmu)),
          },
          emus: { x: widthEmu, y: heightEmu },
        },
      });
      mediaFileName = mediaEntry.fileName;
    }

    const parts: string[] = [];

    // ── p:nvPicPr ──
    parts.push(stringifyNvPicPr(id, name, opts, ctx));

    // ── p:blipFill ──
    parts.push(
      stringifyPptxBlipFill(
        { fileName: mediaFileName, sourceUrl: opts.sourceUrl, compression: opts.compression },
        opts.sourceRectangle,
        opts.blipEffects,
        ctx,
        opts.useLocalDpi,
        opts.fillRectangle,
      ),
    );

    // ── p:spPr ──
    const spPrXml = stringifyPicSpPr(opts, ctx);
    if (spPrXml) parts.push(spPrXml);

    // ── p:style ──
    if (opts.style) {
      const styleXml = stringifyShapeStyle(opts.style, ctx);
      if (styleXml) parts.push(styleXml);
    }

    return `<p:pic>${parts.join("")}</p:pic>`;
  },

  parse(el, ctx) {
    const result: Partial<PictureOptions> = {};

    // p:nvPicPr
    const nvPicPr = findChild(el, "p:nvPicPr");
    if (nvPicPr) {
      const cNvPr = findChild(nvPicPr, "p:cNvPr");
      Object.assign(result, parseNonVisualDrawingProperties(cNvPr));
      if (cNvPr?.attributes && cNvPr.attributes["id"] !== undefined) {
        result.id = Number(cNvPr.attributes["id"]);
      }
      const hlinkClick = cNvPr ? findChild(cNvPr, "a:hlinkClick") : undefined;
      if (hlinkClick) result.hyperlink = readHyperlink(hlinkClick, ctx);
      const cNvPicPr = findChild(nvPicPr, "p:cNvPicPr");
      const picLocks = cNvPicPr ? findChild(cNvPicPr, "a:picLocks") : undefined;
      if (picLocks) {
        // Element presence is the signal — a bare <a:picLocks/> round-trips
        // as an empty locking object, not as a dropped element.
        result.locking = parse(pictureLockingDesc, picLocks, ctx) ?? {};
      }
      readNvPrPlaceholder(nvPicPr, result);
    }

    // p:spPr (position/size/flip/rotation)
    const spPr = findChild(el, "p:spPr");
    if (spPr) {
      // A source picture may carry no geometry at all — keep it suppressed.
      if (!findChild(spPr, "a:prstGeom") && !findChild(spPr, "a:custGeom")) {
        result.geometry = null;
      }
      const xfrm = findChild(spPr, "a:xfrm");
      if (xfrm) {
        const off = findChild(xfrm, "a:off");
        if (off?.attributes) {
          result.x = Number(off.attributes["x"] ?? 0);
          result.y = Number(off.attributes["y"] ?? 0);
        }
        const ext = findChild(xfrm, "a:ext");
        if (ext?.attributes) {
          result.width = Number(ext.attributes["cx"] ?? 0);
          result.height = Number(ext.attributes["cy"] ?? 0);
        }
        if (xfrm.attributes) {
          const flipH = parseOnOff(xfrm.attributes["flipH"]);
          if (flipH !== undefined && flipH) result.flipHorizontal = true;
          const flipV = parseOnOff(xfrm.attributes["flipV"]);
          if (flipV !== undefined && flipV) result.flipVertical = true;
          const rot = xfrm.attributes["rot"];
          if (rot !== undefined && rot !== "") result.rotation = Number(rot) / 60000;
        }
      }

      // Fill (a:noFill on cropped/locked pictures is common)
      const fillChild = findFillChild(spPr);
      if (fillChild) result.fill = parse(fillDesc, fillChild, ctx);

      // Outline (decorated pictures carry one)
      const picLn = findChild(spPr, "a:ln");
      if (picLn) result.outline = parse(outlineDesc, picLn, ctx);

      // Effects (e.g. shadow/reflection on the picture)
      const effectLst = findChild(spPr, "a:effectLst");
      if (effectLst) {
        const effects = parse(effectListDesc, effectLst, ctx);
        if (effects) result.effects = effects;
      }

      // 3D scene / shape properties
      const scene3d = findChild(spPr, "a:scene3d");
      if (scene3d) result.scene3d = scene3DDesc.parse(scene3d, ctx);
      const sp3d = findChild(spPr, "a:sp3d");
      if (sp3d) result.shape3d = shape3DDesc.parse(sp3d, ctx);
    }

    // p:style
    const picStyle = findChild(el, "p:style");
    if (picStyle) result.style = readShapeStyle(picStyle, ctx);

    // Crop rectangle from p:blipFill → a:srcRect (‰ → percent)
    const blipFill = findChild(el, "p:blipFill");
    const srcRectEl = blipFill ? findChild(blipFill, "a:srcRect") : undefined;
    if (srcRectEl) {
      const rect: SourceRectangleOptions = {};
      const l = attrNum(srcRectEl, "l");
      if (l !== undefined) rect.left = l / 1000;
      const t = attrNum(srcRectEl, "t");
      if (t !== undefined) rect.top = t / 1000;
      const r = attrNum(srcRectEl, "r");
      if (r !== undefined) rect.right = r / 1000;
      const b = attrNum(srcRectEl, "b");
      if (b !== undefined) rect.bottom = b / 1000;
      result.sourceRectangle = rect;
    }

    // Stretch fill rectangle — a bare <a:stretch/> (no a:fillRect child) is a
    // distinct emitted form some writers produce; keep it tri-state.
    const stretch = blipFill ? findChild(blipFill, "a:stretch") : undefined;
    if (stretch) {
      const fillRectEl = findChild(stretch, "a:fillRect");
      if (!fillRectEl) {
        result.fillRectangle = false;
      } else {
        const rect: SourceRectangleOptions = {};
        const l = attrNum(fillRectEl, "l");
        if (l !== undefined) rect.left = l / 1000;
        const t = attrNum(fillRectEl, "t");
        if (t !== undefined) rect.top = t / 1000;
        const r = attrNum(fillRectEl, "r");
        if (r !== undefined) rect.right = r / 1000;
        const b = attrNum(fillRectEl, "b");
        if (b !== undefined) rect.bottom = b / 1000;
        if (Object.keys(rect).length > 0) result.fillRectangle = rect;
      }
    }

    // Image data from p:blipFill → a:blip → r:embed / r:link
    const blip = findFirst(el, "a:blip");
    if (blip) {
      const parsedBlip = parse(blipDesc, blip, ctx);
      if (parsedBlip.blipEffects) result.blipEffects = parsedBlip.blipEffects;
      if (parsedBlip.useLocalDpi !== undefined) result.useLocalDpi = parsedBlip.useLocalDpi;
      if (parsedBlip.compression !== undefined) result.compression = parsedBlip.compression;
      const rEmbed = attr(blip, "r:embed");
      if (rEmbed) {
        const imagePath = ctx.resolveRelationship(rEmbed);
        if (imagePath) {
          const imageData = ctx.getRaw(imagePath);
          if (imageData) {
            result.data = imageData;
            result.type = imageTypeFromPath(imagePath);
          }
          // Keep the source file name — re-deriving it from the shape name
          // renames the media part and forks it from its passthrough copy.
          result.fileName = imagePath.split("/").pop();
        }
      }
      const rLink = attr(blip, "r:link");
      if (rLink) {
        // External image source — the per-part rels keep External targets raw,
        // so resolveRelationship returns the URL itself.
        const url = ctx.resolveRelationship(rLink);
        if (url) {
          result.sourceUrl = url;
          if (!result.type) result.type = imageTypeFromPath(url);
        }
      }
    }

    // A picture whose rel target resolves to no part (a broken reference)
    // stays byteless: fabricating empty bytes would grow a 0-byte media part
    // the source never had. A linked-only picture is byteless by design.
    if (!result.type) result.type = "png";

    return result as PictureOptions;
  },
};

// ── Shape helper: p:nvSpPr ──

function stringifyNvSpPr(id: number, name: string, opts: ShapeOptions, ctx: WriteContext): string {
  // nvPr — @isPhoto/@userDrawn are the element's own attributes, orthogonal
  // to the p:ph child (CT_ApplicationNonVisualDrawingProps), so both emit
  // together. p:ph @type is optional (XSD default "obj"), so a placeholder
  // keyed only by idx must still emit <p:ph/> without a type attribute.
  const nvPrAttrs: string[] = [];
  if (opts.isPhoto) nvPrAttrs.push('isPhoto="1"');
  if (opts.userDrawn) nvPrAttrs.push('userDrawn="1"');
  const nvPrAttrsXml = nvPrAttrs.length > 0 ? ` ${nvPrAttrs.join(" ")}` : "";
  let nvPrContent = nvPrAttrs.length > 0 ? `<p:nvPr${nvPrAttrsXml}/>` : "<p:nvPr/>";
  if (opts.placeholder || opts.placeholderIndex !== undefined) {
    const phAttrs: string[] = [];
    if (opts.placeholder) phAttrs.push(`type="${xsdPlaceholderType.to(opts.placeholder)}"`);
    if (opts.placeholderIndex !== undefined) phAttrs.push(`idx="${opts.placeholderIndex}"`);
    if (opts.placeholderSize !== undefined) phAttrs.push(`sz="${opts.placeholderSize}"`);
    if (opts.placeholderOrientation !== undefined)
      phAttrs.push(`orient="${opts.placeholderOrientation}"`);
    if (opts.hasCustomPrompt) phAttrs.push('hasCustomPrompt="1"');
    nvPrContent = `<p:nvPr${nvPrAttrsXml}><p:ph ${phAttrs.join(" ")}/></p:nvPr>`;
  }

  // cNvSpPr (with optional locking)
  let cNvSpPrContent = "<p:cNvSpPr/>";
  if (opts.locking) {
    const lockAttrs = buildLockAttrs(opts.locking);
    if (lockAttrs.length > 0) {
      cNvSpPrContent = `<p:cNvSpPr><a:spLocks ${lockAttrs.join(" ")}/></p:cNvSpPr>`;
    }
  }

  // Click hyperlink (a:hlinkClick) lives inside p:cNvPr.
  let hlinkXml: string | undefined;
  if (opts.hyperlink) {
    const key = registerHyperlink(opts.hyperlink, ctx);
    hlinkXml = buildHyperlinkElement("a:hlinkClick", opts.hyperlink, key);
  }

  const cNvPrXml = stringifyNonVisualDrawingProperties("p:cNvPr", id, opts, name, hlinkXml);
  return `<p:nvSpPr>${cNvPrXml}${cNvSpPrContent}${nvPrContent}</p:nvSpPr>`;
}

function buildLockAttrs(opts: ShapeLockingOptions): string[] {
  const attrs: string[] = [];
  const keys = [
    "noGrp",
    "noSelect",
    "noRot",
    "noChangeAspect",
    "noMove",
    "noResize",
    "noEditPoints",
    "noAdjustHandles",
    "noChangeArrowheads",
    "noChangeShapeType",
    "noTextEdit",
  ] as const;
  for (const key of keys) {
    const val = opts[key];
    if (val !== undefined) attrs.push(`${key}="${val ? 1 : 0}"`);
  }
  return attrs;
}

// ── Shape helper: p:spPr ──

function stringifySpPr(opts: ShapeOptions, ctx: WriteContext): string {
  const pptx = ctx as PptxWriteContext;
  const sp = opts.properties ?? {};

  // Blip fill: pre-register via addImage so the deduped canonical keeps the
  // pinned source name on round-trip (imageType normalization like jpeg→jpg
  // would otherwise fork a second media part); fresh fills get the
  // pptx-local image_blip.<type>. shapePropertiesDesc's fillDesc re-registers
  // via addMedia, deduped to the same canonical.
  if (sp.fill && typeof sp.fill !== "string" && sp.fill.type === "blip" && sp.fill.data) {
    const blipFill = sp.fill;
    const raw = toUint8Array(blipFill.data!, { encoding: "base64" });
    const fileName = blipFill.fileName ?? `image_blip.${blipFill.imageType ?? "png"}`;
    pptx.addImage(fileName, {
      key: fileName,
      data: raw,
      fileName,
      type: (blipFill.imageType ?? "png") as MediaEntry["type"],
      transformation: { pixels: { x: 0, y: 0 }, emus: { x: 0, y: 0 } },
    });
  }

  // Placeholder shapes inherit geometry/fill from layout/master; only emit
  // them when explicitly set. Non-placeholder shapes default to rect geometry
  // and noFill. A p:ph with no @type (idx-only) is still a placeholder —
  // placeholderIndex alone carries its identity.
  const isPlaceholder = !!opts.placeholder || opts.placeholderIndex !== undefined;
  const geometry = sp.customGeometry
    ? undefined
    : isPlaceholder
      ? sp.geometry
      : (sp.geometry ?? "rect");
  // A shape whose p:style carries a fillRef inherits its fill from the style
  // matrix — an explicit noFill would override that, so leave the spPr fill
  // unset unless the source (or the fresh caller) says otherwise. `fill: null`
  // marks a parsed source with no fill child — emit nothing there too.
  const styleOwnsFill = opts.style?.fillReference !== undefined;
  const fill =
    sp.fill === null
      ? undefined
      : isPlaceholder || styleOwnsFill
        ? sp.fill
        : (sp.fill ?? ({ type: "none" } as const));

  const spPrContent = shapePropertiesDesc.stringify(
    {
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height: opts.height,
      flipHorizontal: opts.flipHorizontal,
      flipVertical: opts.flipVertical,
      rotation: opts.rotation,
      ...sp,
      geometry,
      fill,
    },
    ctx,
  );

  // @bwMode is a CT_ShapeProperties container attribute (CT_Shape itself only
  // has @useBgFill).
  const bwAttr = opts.blackWhiteMode ? ` bwMode="${opts.blackWhiteMode}"` : "";
  if (!spPrContent) return bwAttr ? `<p:spPr${bwAttr}/>` : "<p:spPr/>";
  return `<p:spPr${bwAttr}>${spPrContent}</p:spPr>`;
}

// ── Shape helper: p:style ──

/**
 * Serialize p:style (CT_ShapeStyle). Every ref carries a bare EG_ColorChoice
 * child (any of the six color kinds; fontRef included — @idx is
 * ST_FontCollectionIndex, not numeric). Shared by the shape descriptor and
 * the master placeholder emitter.
 */
export function stringifyShapeStyle(style: ShapeStyleOptions, ctx: WriteContext): string {
  const ref = (
    name: string,
    { index, color }: { index: number | string; color?: StyleReferenceColor },
  ): string => {
    if (color === undefined) return `<${name} idx="${index}"/>`;
    const choice = typeof color === "string" ? { value: color } : color;
    return `<${name} idx="${index}">${stringifyColorChoice(choice, ctx)}</${name}>`;
  };

  const parts: string[] = [];
  if (style.lineReference) parts.push(ref("a:lnRef", style.lineReference));
  if (style.fillReference) parts.push(ref("a:fillRef", style.fillReference));
  if (style.effectReference) parts.push(ref("a:effectRef", style.effectReference));
  if (style.fontReference)
    parts.push(
      ref("a:fontRef", {
        index: style.fontReference.collection,
        color: style.fontReference.color,
      }),
    );
  return parts.length > 0 ? `<p:style>${parts.join("")}</p:style>` : "";
}

// ── Picture helpers ──

function stringifyNvPicPr(
  id: number,
  name: string,
  opts: PictureOptions | undefined,
  ctx: WriteContext,
): string {
  // Click hyperlink (a:hlinkClick) lives inside p:cNvPr.
  let hlinkXml: string | undefined;
  if (opts?.hyperlink) {
    const key = registerHyperlink(opts.hyperlink, ctx);
    hlinkXml = buildHyperlinkElement("a:hlinkClick", opts.hyperlink, key);
  }
  const cNvPrXml = stringifyNonVisualDrawingProperties("p:cNvPr", id, opts, name, hlinkXml);
  const locks = opts?.locking ? (pictureLockingDesc.stringify(opts.locking, ctx) ?? "") : "";
  const cNvPicPr = locks ? `<p:cNvPicPr>${locks}</p:cNvPicPr>` : "<p:cNvPicPr/>";
  return `<p:nvPicPr>${cNvPrXml}${cNvPicPr}${stringifyNvPr(opts ?? {})}</p:nvPicPr>`;
}

/** PPTX uses p:blipFill (not pic:blipFill). */
function stringifyPptxBlipFill(
  blip: {
    /** Embedded media file name; undefined on a linked-only picture. */
    fileName?: string;
    /** External image source URL (a:blip @r:link). */
    sourceUrl?: string;
    /** Compression state (a:blip @cstate); absent = attribute omitted. */
    compression?: BlipCompression;
  },
  sourceRectangle?: SourceRectangleOptions,
  blipEffects?: PictureOptions["blipEffects"],
  ctx?: WriteContext,
  useLocalDpi?: boolean,
  fillRectangle?: SourceRectangleOptions | false,
): string {
  // The linked source registers an {img-link:key} placeholder the compiler
  // rewrites per slide/layout while adding the External image relationship.
  // The placeholder body carries the "img-link:" prefix (hlink convention).
  const linkKey =
    blip.sourceUrl !== undefined && ctx
      ? `img-link:${(ctx as PptxWriteContext).addImageLink(blip.sourceUrl)}`
      : undefined;
  const blipXml = stringify(
    blipDesc,
    {
      referenceId: blip.fileName,
      linkReferenceId: linkKey,
      compression: blip.compression,
      blipEffects,
      useLocalDpi,
    },
    ctx,
  );
  const srcRect = sourceRectangle ? createSourceRectangle(sourceRectangle) : "";
  const fillRect =
    fillRectangle === false
      ? "<a:stretch/>"
      : `<a:stretch>${createSourceRectangle(fillRectangle ?? {}, "a:fillRect")}</a:stretch>`;
  return `<p:blipFill>${blipXml}${srcRect}${fillRect}</p:blipFill>`;
}

function stringifyPicSpPr(opts: PictureOptions, ctx: WriteContext): string {
  const spPrContent = shapePropertiesDesc.stringify(
    {
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height: opts.height,
      flipHorizontal: opts.flipHorizontal,
      flipVertical: opts.flipVertical,
      rotation: opts.rotation,
      // Pictures always use a rect preset geometry unless the source omitted it.
      geometry: opts.geometry === null ? undefined : "rect",
      fill: opts.fill,
      outline: opts.outline,
      effects: opts.effects,
      scene3d: opts.scene3d,
      shape3d: opts.shape3d,
    },
    ctx,
  );
  if (!spPrContent) return "<p:spPr/>";
  return `<p:spPr>${spPrContent}</p:spPr>`;
}

// ── Read helpers ──

/**
 * Read the non-visual drawing properties (id/name/description/title/hidden…)
 * from the first parent tag that holds a p:cNvPr (a:cNvPr tolerated); with no
 * parent tags, el itself is the non-visual properties container. Shared
 * probe+parse by every slide-child descriptor.
 */
export function readCnvPr(
  el: XmlElement,
  ...parentTags: string[]
): NonVisualDrawingPropertiesOptions & { id?: number } {
  const parents = parentTags.length ? parentTags.map((tag) => findChild(el, tag)) : [el];
  for (const parent of parents) {
    if (!parent) continue;
    const cNvPr = findChild(parent, "p:cNvPr") ?? findChild(parent, "a:cNvPr");
    if (!cNvPr) continue;
    const result: NonVisualDrawingPropertiesOptions & { id?: number } = {
      ...parseNonVisualDrawingProperties(cNvPr),
    };
    const id = attrNum(cNvPr, "id");
    if (id !== undefined) result.id = id;
    return result;
  }
  return {};
}

export function readNvSpPr(nvSpPr: XmlElement, ctx: ReadContext): ShapeOptions {
  const result: ShapeOptions = {};

  Object.assign(result, readCnvPr(nvSpPr));

  // Click hyperlink inside p:cNvPr (a:hlinkClick)
  const cNvPr = findChild(nvSpPr, "p:cNvPr") ?? findChild(nvSpPr, "a:cNvPr");
  const hlinkClick = cNvPr ? findChild(cNvPr, "a:hlinkClick") : undefined;
  if (hlinkClick) {
    result.hyperlink = readHyperlink(hlinkClick, ctx);
  }

  const nvPr = findChild(nvSpPr, "p:nvPr");
  if (nvPr) {
    if (nvPr.attributes) {
      if (nvPr.attributes["isPhoto"] !== undefined)
        result.isPhoto = parseOnOff(nvPr.attributes["isPhoto"]) ?? false;
      if (nvPr.attributes["userDrawn"] !== undefined)
        result.userDrawn = parseOnOff(nvPr.attributes["userDrawn"]) ?? false;
    }
    const ph = findChild(nvPr, "p:ph");
    if (ph?.attributes) {
      if (ph.attributes["type"] !== undefined)
        result.placeholder = xsdPlaceholderType.from(
          String(ph.attributes["type"]),
        ) as ShapeOptions["placeholder"];
      if (ph.attributes["idx"] !== undefined)
        result.placeholderIndex = Number(ph.attributes["idx"]);
      if (ph.attributes["sz"] !== undefined)
        result.placeholderSize = ph.attributes["sz"] as ShapeOptions["placeholderSize"];
      if (ph.attributes["orient"] !== undefined)
        result.placeholderOrientation = ph.attributes[
          "orient"
        ] as ShapeOptions["placeholderOrientation"];
      if (ph.attributes["hasCustomPrompt"] !== undefined)
        result.hasCustomPrompt = parseOnOff(ph.attributes["hasCustomPrompt"]) ?? false;
    }
  }

  const cNvSpPr = findChild(nvSpPr, "p:cNvSpPr");
  if (cNvSpPr) {
    const spLocks = findChild(cNvSpPr, "a:spLocks");
    if (spLocks) {
      result.locking = shapeLockingDesc.parse(spLocks, {} as ReadContext) as ShapeLockingOptions;
    }
  }

  return result;
}

/** Parse p:spPr via the shared core descriptor: transform top-level, paint into
 * `properties` (fill absence marked null so stringify skips the fresh default). */
function readSpPr(
  spPr: XmlElement,
  ctx: ReadContext,
): Transform2DOptions & { properties: NonNullable<ShapeOptions["properties"]> } {
  const parsed = parse(shapePropertiesDesc, spPr, ctx);
  const { x, y, width, height, flipHorizontal, flipVertical, rotation, ...paint } = parsed;

  // A source spPr with no fill child inherits its fill — mark the absence so
  // stringify does not apply the fresh-authoring noFill default.
  if (paint.fill === undefined) paint.fill = null;

  // Collapse a preset geometry without adjustment values to the bare string
  // shorthand the public options accept.
  const geometry = paint.geometry;
  if (
    typeof geometry === "object" &&
    (!geometry.adjustmentValues || geometry.adjustmentValues.length === 0) &&
    geometry.preset
  ) {
    paint.geometry = geometry.preset;
  }

  return {
    x,
    y,
    width,
    height,
    flipHorizontal,
    flipVertical,
    rotation,
    properties: paint,
  };
}

/** Read x/y/width/height (in EMU) from an a:xfrm element. */
export function readPositionFromXfrm(xfrm: XmlElement): Record<string, number> {
  const result: Record<string, number> = {};
  const off = findChild(xfrm, "a:off");
  if (off) {
    const x = attrNum(off, "x");
    if (x !== undefined) result.x = x;
    const y = attrNum(off, "y");
    if (y !== undefined) result.y = y;
  }
  const ext = findChild(xfrm, "a:ext");
  if (ext) {
    const cx = attrNum(ext, "cx");
    if (cx !== undefined) result.width = cx;
    const cy = attrNum(ext, "cy");
    if (cy !== undefined) result.height = cy;
  }
  return result;
}

// ── Image type helper ──
