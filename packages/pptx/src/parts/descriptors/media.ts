/**
 * Video and Audio frame descriptors for PPTX.
 *
 * Both produce p:pic elements with media placeholders that are
 * resolved during compilation.
 *
 * Reference: OOXML transitional, dml-main.xsd EG_Media
 * (audioCd / wavAudioFile / audioFile / videoFile / quickTimeFile).
 *
 * @module
 */

import { toUint8Array } from "@office-open/core";
import type { DataType } from "@office-open/core";
import type { CustomDescriptor, ReadContext } from "@office-open/core/descriptor";
import {
  shapePropertiesDesc,
  stringifyNonVisualDrawingProperties,
} from "@office-open/core/drawing";
import { attr, attrNum, escapeXml, findChild, findFirst, stringify } from "@office-open/xml";
import type { Element } from "@office-open/xml";
import type { AudioCdOptions, AudioFrameOptions, AudioType } from "@shared/media/audio-frame";
import { imageTypeFromPath } from "@shared/media/image-type";
import type { MediaFrameBaseOptions, MediaTrimOptions } from "@shared/media/media-frame-base";
import type { VideoFrameOptions, VideoType } from "@shared/media/video-frame";

import type { MediaEntry, PptxWriteContext } from "../../context";
import { readCnvPr, readPositionFromXfrm } from "./shape";

// ── ID counters ──

let _nextVideoId = 100;
let _nextAudioId = 200;

// ── Extension URIs ──

// The p14:media extension uri is shared by audio and video frames (the
// documented media extension; PptxGenJS/python-pptx emit the same uri for both).
export const MEDIA_EXT_URI = "{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}";

// ── Shared media element builders (EG_Media) ──

/** a:audioCd — CD track playback, no media file. */
function stringifyAudioCd(cd: AudioCdOptions): string {
  const ext = cd.ext !== undefined ? `<a:extLst>${cd.ext}</a:extLst>` : "";
  return (
    `<a:audioCd><a:st${stringifyAudioCdTime(cd.start)}/>` +
    `<a:end${stringifyAudioCdTime(cd.end)}/>${ext}</a:audioCd>`
  );
}

function stringifyAudioCdTime(t: AudioCdOptions["start"]): string {
  let s = ` track="${t.track}"`;
  if (t.time !== undefined) s += ` time="${t.time}"`;
  return s;
}

/** p14:media extension body — embed reference plus optional trim child. */
function stringifyP14Media(mediaFileName: string, trim?: MediaTrimOptions): string {
  const trimXml = trim
    ? `<p14:trim${trim.start !== undefined ? ` st="${trim.start}"` : ""}${trim.end !== undefined ? ` end="${trim.end}"` : ""}/>`
    : "";
  return (
    `<p:extLst><p:ext uri="${MEDIA_EXT_URI}">` +
    `<p14:media r:embed="{media:${mediaFileName}}" xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"` +
    (trimXml ? `>${trimXml}</p14:media>` : "/>") +
    `</p:ext></p:extLst>`
  );
}

/** Read p14:trim (play window) off a p14:media element. */
function readMediaTrim(p14media: Element): MediaTrimOptions | undefined {
  const trimEl = (p14media.elements ?? []).find((c) => c.name === "p14:trim");
  if (!trimEl) return undefined;
  const trim: MediaTrimOptions = {};
  const st = attrNum(trimEl, "st");
  if (st !== undefined) trim.start = st;
  const end = attrNum(trimEl, "end");
  if (end !== undefined) trim.end = end;
  return Object.keys(trim).length > 0 ? trim : {};
}

/** a:audioFile / a:wavAudioFile — linked/embedded audio file. */
function stringifyAudioFile(
  mediaFileName: string,
  type: AudioType,
  opts: AudioFrameOptions,
): string {
  const contentType = opts.contentType ? ` contentType="${escapeXml(opts.contentType)}"` : "";
  if (type === "wav") {
    // Embedded WAV: r:embed + optional original file name.
    const name = opts.audioFileName ? ` name="${escapeXml(opts.audioFileName)}"` : "";
    return `<a:wavAudioFile r:embed="{audio:${mediaFileName}}"${name}/>`;
  }
  return `<a:audioFile r:link="{audio:${mediaFileName}}"${contentType}/>`;
}

// ── Video descriptor ──

export const videoDesc: CustomDescriptor<VideoFrameOptions> = {
  kind: "custom",

  stringify(opts, ctx) {
    const id = opts.id ?? _nextVideoId++;
    const name = opts.name ?? `Video ${id}`;
    const pptx = ctx as PptxWriteContext;
    pptx.registerShapeId(name, id);
    const mediaFileName = registerMediaFile(
      pptx,
      opts.data,
      opts.type ?? "mp4",
      opts.fileName ?? `${name.replace(/\s+/g, "_")}.${opts.type ?? "mp4"}`,
    );

    const parts: string[] = [];

    // p:nvPicPr
    const contentType = opts.contentType ? ` contentType="${escapeXml(opts.contentType)}"` : "";
    const mediaEl = mediaFileName
      ? `<a:videoFile r:link="{video:${mediaFileName}}"${contentType}/>`
      : "";
    const hlinkXml = opts.mediaAction ? '<a:hlinkClick r:id="" action="ppaction://media"/>' : "";
    parts.push(
      `<p:nvPicPr>${stringifyNonVisualDrawingProperties("p:cNvPr", id, opts, name, hlinkXml)}` +
        `<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>` +
        `<p:nvPr>${mediaEl}` +
        (mediaFileName ? stringifyP14Media(mediaFileName, opts.trim) : "") +
        `</p:nvPr></p:nvPicPr>`,
    );

    // p:blipFill (poster image)
    let posterAttr = "";
    if (opts.poster) {
      const posterFileName = registerMediaFile(
        pptx,
        opts.poster,
        opts.posterType ?? "png",
        `${name.replace(/\s+/g, "_")}_poster.${opts.posterType ?? "png"}`,
      );
      if (posterFileName) posterAttr = `<a:blip r:embed="{${posterFileName}}"/>`;
    }
    parts.push(`<p:blipFill>${posterAttr}<a:stretch><a:fillRect/></a:stretch></p:blipFill>`);

    // p:spPr
    parts.push(stringifyMediaSpPr(opts, ctx));

    return `<p:pic>${parts.join("")}</p:pic>`;
  },

  parse(el, _ctx) {
    const result: Partial<VideoFrameOptions> = {};

    // Position from p:spPr
    const spPr = findChild(el, "p:spPr");
    if (spPr) {
      const xfrm = findChild(spPr, "a:xfrm");
      if (xfrm) Object.assign(result, readPositionFromXfrm(xfrm));
    }

    // id + name from p:nvPicPr → a:cNvPr or p:cNvPr
    Object.assign(result, readCnvPr(el, "p:nvPicPr"));
    readMediaAction(el, result);

    // Media data from a:videoFile (r:link) or p14:media (r:embed)
    const quickTimeEl = findFirst(el, "a:quickTimeFile");
    const videoFileEl = findFirst(el, "a:videoFile") ?? quickTimeEl;
    const rLink = videoFileEl ? attr(videoFileEl, "r:link") : undefined;
    // The p14:media extension copy coexists with the EG_Media element — a
    // source whose r:link is a broken external target still carries the real
    // bytes under r:embed here, so it is always read.
    const p14media = findFirst(el, "p14:media");
    const rEmbed = p14media ? attr(p14media, "r:embed") : undefined;
    if (p14media) {
      const trim = readMediaTrim(p14media);
      if (trim) result.trim = trim;
    }
    const mediaRef = rLink ?? rEmbed;
    if (mediaRef) {
      const mediaPath = _ctx.resolveRelationship(mediaRef);
      let data: Uint8Array | undefined;
      let resolvedPath = mediaPath;
      if (mediaPath) data = _ctx.getRaw(mediaPath);
      if (!data && rEmbed && rEmbed !== mediaRef) {
        // The link target is unreadable (broken or external) — fall back to
        // the embedded p14:media copy.
        resolvedPath = _ctx.resolveRelationship(rEmbed);
        data = resolvedPath ? _ctx.getRaw(resolvedPath) : undefined;
      }
      if (resolvedPath) {
        if (data) result.data = data;
        // Keep the source file name — re-deriving it from the frame name
        // renames the media part (a name that already carries the extension
        // would even double it).
        result.fileName = resolvedPath.split("/").pop();
      }
      // Fall back to the placeholder reference (e.g. "{media:foo.mp4}") when the
      // relationship isn't registered, so the type survives a round-trip.
      result.type = mediaTypeFromPath(resolvedPath ?? mediaRef, "video");
    }
    if (quickTimeEl) result.type = "mov";
    if (videoFileEl) {
      const contentType = attr(videoFileEl, "contentType");
      if (contentType) result.contentType = contentType;
    }

    // Poster from blipFill
    readPoster(el, result, _ctx);

    return result as VideoFrameOptions;
  },
};

// ── Audio descriptor ──

export const audioDesc: CustomDescriptor<AudioFrameOptions> = {
  kind: "custom",

  stringify(opts, ctx) {
    const id = opts.id ?? _nextAudioId++;
    const name = opts.name ?? `Audio ${id}`;
    const pptx = ctx as PptxWriteContext;
    pptx.registerShapeId(name, id);
    const mediaFileName =
      opts.data !== undefined
        ? registerMediaFile(
            pptx,
            opts.data,
            opts.type ?? "mp3",
            opts.fileName ?? `${name.replace(/\s+/g, "_")}.${opts.type ?? "mp3"}`,
          )
        : undefined;

    const parts: string[] = [];

    // p:nvPicPr — EG_Media choice, then the p14:media extension. Embedded WAV
    // carries no media extension (pre-2010 form); linked audio does.
    let mediaEl: string;
    if (opts.audioCd) {
      mediaEl = stringifyAudioCd(opts.audioCd);
    } else if (mediaFileName) {
      mediaEl = stringifyAudioFile(mediaFileName, opts.type ?? "mp3", opts);
    } else {
      mediaEl = "";
    }
    const emitExt = mediaFileName !== undefined && (opts.type ?? "mp3") !== "wav";
    const hlinkXml = opts.mediaAction ? '<a:hlinkClick r:id="" action="ppaction://media"/>' : "";
    parts.push(
      `<p:nvPicPr>${stringifyNonVisualDrawingProperties("p:cNvPr", id, opts, name, hlinkXml)}` +
        `<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>` +
        `<p:nvPr>${mediaEl}` +
        (emitExt ? stringifyP14Media(mediaFileName!, opts.trim) : "") +
        `</p:nvPr></p:nvPicPr>`,
    );

    // p:blipFill (speaker art poster when present)
    let posterAttr = "";
    if (opts.poster) {
      const posterFileName = registerMediaFile(
        pptx,
        opts.poster,
        opts.posterType ?? "png",
        `${name.replace(/\s+/g, "_")}_poster.${opts.posterType ?? "png"}`,
      );
      if (posterFileName) posterAttr = `<a:blip r:embed="{${posterFileName}}"/>`;
    }
    parts.push(`<p:blipFill>${posterAttr}<a:stretch><a:fillRect/></a:stretch></p:blipFill>`);

    // p:spPr
    parts.push(stringifyMediaSpPr(opts, ctx));

    return `<p:pic>${parts.join("")}</p:pic>`;
  },

  parse(el, _ctx) {
    const result: Partial<AudioFrameOptions> = {};

    // Position from p:spPr
    const spPr = findChild(el, "p:spPr");
    if (spPr) {
      const xfrm = findChild(spPr, "a:xfrm");
      if (xfrm) Object.assign(result, readPositionFromXfrm(xfrm));
    }

    // id + name from p:nvPicPr
    Object.assign(result, readCnvPr(el, "p:nvPicPr"));
    readMediaAction(el, result);

    // CD audio (a:audioCd) — track/time, no media file
    const audioCdEl = findFirst(el, "a:audioCd");
    if (audioCdEl) {
      const stEl = findChild(audioCdEl, "a:st");
      const endEl = findChild(audioCdEl, "a:end");
      if (stEl && endEl) {
        const cd: AudioCdOptions = {
          start: readAudioCdTime(stEl),
          end: readAudioCdTime(endEl),
        };
        const extLst = findChild(audioCdEl, "a:extLst");
        if (extLst) cd.ext = stringify(extLst);
        result.audioCd = cd;
      }
      readPoster(el, result, _ctx);
      return result as AudioFrameOptions;
    }

    // Media data from a:audioFile / a:wavAudioFile (r:link/r:embed) or p14:media
    const wavFileEl = findFirst(el, "a:wavAudioFile");
    const audioFileEl = findFirst(el, "a:audioFile") ?? wavFileEl;
    const rLink = audioFileEl ? attr(audioFileEl, "r:link") : undefined;
    const rEmbedAttr = audioFileEl ? attr(audioFileEl, "r:embed") : undefined;
    // The p14:media extension copy coexists with the EG_Media element — a
    // source whose r:link is a broken external target still carries the real
    // bytes under r:embed here, so it is always read.
    const p14media = findFirst(el, "p14:media");
    const rEmbedExt = p14media ? attr(p14media, "r:embed") : undefined;
    if (p14media) {
      const trim = readMediaTrim(p14media);
      if (trim) result.trim = trim;
    }
    const mediaRef = rLink ?? rEmbedAttr ?? rEmbedExt;
    if (mediaRef) {
      const mediaPath = _ctx.resolveRelationship(mediaRef);
      let data: Uint8Array | undefined;
      let resolvedPath = mediaPath;
      if (mediaPath) data = _ctx.getRaw(mediaPath);
      if (!data && rEmbedExt && rEmbedExt !== mediaRef) {
        // The link target is unreadable (broken or external) — fall back to
        // the embedded p14:media copy.
        resolvedPath = _ctx.resolveRelationship(rEmbedExt);
        data = resolvedPath ? _ctx.getRaw(resolvedPath) : undefined;
      }
      if (resolvedPath) {
        if (data) result.data = data;
        // Keep the source file name — re-deriving it from the frame name
        // renames the media part.
        result.fileName = resolvedPath.split("/").pop();
      }
      // Fall back to the placeholder reference (e.g. "{media:foo.wav}") when the
      // relationship isn't registered, so the type survives a round-trip.
      result.type = mediaTypeFromPath(resolvedPath ?? mediaRef, "audio");
    }
    if (wavFileEl) result.type = "wav";
    if (audioFileEl) {
      const contentType = attr(audioFileEl, "contentType");
      if (contentType) result.contentType = contentType;
      const audioFileName = attr(audioFileEl, "name");
      if (audioFileName) result.audioFileName = audioFileName;
    }

    readPoster(el, result, _ctx);

    return result as AudioFrameOptions;
  },
};

// ── Helpers ──

function readAudioCdTime(el: Element): AudioCdOptions["start"] {
  const time = attrNum(el, "time");
  return { track: attrNum(el, "track") ?? 0, ...(time !== undefined ? { time } : {}) };
}

/** Read the click-to-play hyperlink (a:hlinkClick action="ppaction://media"). */
function readMediaAction(el: Element, result: { mediaAction?: boolean }): void {
  const hlinkClick = findFirst(el, "a:hlinkClick");
  if (hlinkClick && attr(hlinkClick, "action") === "ppaction://media") {
    result.mediaAction = true;
  }
}

/** Read the poster image from p:blipFill → a:blip r:embed. */
function readPoster(
  el: Element,
  result: { poster?: DataType; posterType?: "png" | "jpg" },
  ctx: ReadContext,
): void {
  const blipFill = findChild(el, "p:blipFill");
  if (!blipFill) return;
  const blip = findChild(blipFill, "a:blip");
  if (!blip) return;
  const rEmbedPoster = attr(blip, "r:embed");
  if (!rEmbedPoster) return;
  const posterPath = ctx.resolveRelationship(rEmbedPoster);
  if (posterPath) {
    const data = ctx.getRaw(posterPath);
    if (data) result.poster = data;
    // PosterType only allows png/jpg — other extensions fall back to png.
    const posterType = imageTypeFromPath(posterPath);
    result.posterType = posterType === "jpg" ? "jpg" : "png";
  }
}

/**
 * Register media bytes under a deterministic file name and return the canonical
 * name (which may differ when the requested name is taken by other bytes).
 * Returns undefined when data is undefined.
 */
function registerMediaFile(
  pptx: PptxWriteContext,
  data: MediaFrameBaseOptions["data"] | undefined,
  type: string,
  fileName: string,
): string | undefined {
  if (data === undefined) return undefined;
  const raw = toUint8Array(data, { encoding: "base64" });
  const entry: MediaEntry = {
    key: fileName,
    data: raw,
    fileName,
    type,
  };
  return pptx.addImage(fileName, entry).fileName;
}

/** p:spPr for a media frame: position/size + rect geometry (picture precedent). */
function stringifyMediaSpPr(
  opts: Pick<MediaFrameBaseOptions, "x" | "y" | "width" | "height">,
  ctx: Parameters<typeof shapePropertiesDesc.stringify>[1],
): string {
  const content = shapePropertiesDesc.stringify(
    {
      x: opts.x ?? 0,
      y: opts.y ?? 0,
      width: opts.width ?? 0,
      height: opts.height ?? 0,
      geometry: "rect",
    },
    ctx,
  );
  return `<p:spPr>${content ?? ""}</p:spPr>`;
}

function mediaTypeFromPath(path: string, kind: "video"): VideoType;
function mediaTypeFromPath(path: string, kind: "audio"): AudioType;
function mediaTypeFromPath(path: string, kind: "video" | "audio"): VideoType | AudioType {
  // Tolerate placeholder wrappers like "{media:foo.wav}" — extract the last
  // alphanumeric extension token rather than a trailing fragment with "}".
  const ext = path.match(/\.([a-z0-9]+)\b/i)?.[1]?.toLowerCase() ?? "";
  if (kind === "video") {
    if (["mp4", "mov", "wmv", "avi"].includes(ext)) return ext as VideoType;
    return "mp4";
  }
  if (["mp3", "wav", "wma", "aac"].includes(ext)) return ext as AudioType;
  return "mp3";
}
