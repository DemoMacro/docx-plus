import { RELATIONSHIP_TYPES } from "../opc/relationships";
/**
 * Placeholder detection and replacement utilities for compiler post-processing.
 *
 * Both DOCX and PPTX compilers use placeholder tokens (e.g. `{chart:key}`)
 * in XML strings to defer relationship ID assignment. This module provides
 * fast pre-check utilities and shared replacement functions.
 */

export type IdFormat = "rId" | "plain";

export const formatId = (offset: number, index: number, style: IdFormat): string =>
  style === "rId" ? `rId${offset + index}` : `${offset + index}`;

/**
 * Find the next `{key}` placeholder at/after `from`. Returns `[open, close]`
 * brace indices, or undefined when none remain. Mirrors the semantics of
 * `/\{([^{}]+)\}/g`: empty keys and keys containing `{` are skipped (the scan
 * restarts after the nested brace), matching what the regex would accept.
 */
function nextPlaceholder(xml: string, from: number): [number, number] | undefined {
  let pos = from;
  for (;;) {
    const open = xml.indexOf("{", pos);
    if (open === -1) return undefined;
    const close = xml.indexOf("}", open + 1);
    if (close === -1) return undefined;
    const keyLen = close - open - 1;
    if (keyLen === 0) {
      pos = open + 1;
      continue;
    }
    const nextOpen = xml.indexOf("{", open + 1);
    if (nextOpen !== -1 && nextOpen < close) {
      // Nested "{" inside the candidate key — the regex would restart there.
      pos = open + 1;
      continue;
    }
    return [open, close];
  }
}

/** Replace `{name}` placeholders with the given values (missing keys stay). */
export function replacePlaceholders(xml: string, map: Map<string, string>): string {
  const parts: string[] = [];
  let last = 0;
  let pos = 0;
  for (;;) {
    const found = nextPlaceholder(xml, pos);
    if (found === undefined) break;
    const [open, close] = found;
    const replacement = map.get(xml.substring(open + 1, close));
    if (replacement !== undefined) {
      parts.push(xml.substring(last, open), replacement);
      last = close + 1;
    }
    pos = close + 1;
  }
  if (last === 0) return xml;
  parts.push(xml.substring(last));
  return parts.join("");
}

export function hasPlaceholders(xml: string): boolean {
  return xml.includes("{");
}

export function collectPlaceholderKeys(xml: string, prefix: string): string[] {
  const keys = new Set<string>();
  const search = `{${prefix}`;
  let pos = 0;

  while ((pos = xml.indexOf(search, pos)) !== -1) {
    const keyStart = pos + search.length;
    const keyEnd = xml.indexOf("}", keyStart);
    if (keyEnd === -1) break;

    const key = xml.substring(keyStart, keyEnd);
    if (key.length > 0) keys.add(key);
    pos = keyEnd + 1;
  }

  return [...keys];
}

export function replaceImagePlaceholders(
  xml: string,
  mediaData: { fileName: string }[],
  offset: number,
  idFormat: IdFormat = "rId",
): string {
  if (mediaData.length === 0) return xml;
  const map = new Map<string, string>();
  for (const [i, item] of mediaData.entries()) {
    map.set(item.fileName, formatId(offset, i, idFormat));
  }
  return replacePlaceholders(xml, map);
}

export function getReferencedMedia(
  xml: string,
  mediaArray: { fileName: string }[],
): { fileName: string }[] {
  // Substring search, not brace-pair scanning: callers pass JSON.stringify
  // output (the patch path) where nested object braces would derail a
  // brace-pair walk past the actual placeholder tokens.
  return mediaArray.filter((image) => xml.includes(`{${image.fileName}}`));
}

/**
 * Combined find + replace for image placeholders in a single pass.
 *
 * Scans XML for `{fileName}` placeholders, replaces them with formatted IDs,
 * and returns the list of referenced media items for relationship registration.
 * More efficient than calling getReferencedMedia() + replaceImagePlaceholders() separately.
 */
export function findAndReplaceImagePlaceholders(
  xml: string,
  mediaArray: { fileName: string }[],
  offset: number,
  idFormat: IdFormat = "rId",
  sourceRids?: ReadonlyMap<string, string>,
): { xml: string; referenced: { fileName: string }[] } {
  if (mediaArray.length === 0 || !hasPlaceholders(xml)) {
    return { xml, referenced: [] };
  }
  // Build fileName → mediaItem lookup
  const itemMap = new Map<string, { fileName: string }>();
  for (const item of mediaArray) {
    itemMap.set(item.fileName, item);
  }

  const referenced: { fileName: string }[] = [];
  const replaceMap = new Map<string, string>();
  const parts: string[] = [];
  let last = 0;
  let pos = 0;

  for (;;) {
    const found = nextPlaceholder(xml, pos);
    if (found === undefined) break;
    const [open, close] = found;
    const key = xml.substring(open + 1, close);
    const item = itemMap.get(key);
    if (item !== undefined) {
      let id = replaceMap.get(key);
      if (id === undefined) {
        // Source round-trip: when the source rels captured the rId for this
        // media file, the body XML must reference that exact rId — the
        // structured compiler's rels will then point to the same target. Using
        // an offset-derived id here would dangle the body's `r:embed` against
        // a rel pointing at a different media item.
        const override = sourceRids?.get(key);
        // Use the referenced-local position (not the global media index) so the
        // generated IDs align with the caller's per-part addRelationship(offset+i)
        // loop. Using the global index desyncs the body's r:embed from the part's
        // .rels when a part references only a subset of the global media array
        // (e.g. headers/footers, whose images sit at high global indices).
        id = override ?? formatId(offset, referenced.length, idFormat);
        replaceMap.set(key, id);
        referenced.push(item);
      }
      parts.push(xml.substring(last, open), id);
      last = close + 1;
    }
    pos = close + 1;
  }

  if (last === 0) return { xml, referenced: [] };
  parts.push(xml.substring(last));
  return { xml: parts.join(""), referenced };
}

/**
 * Replace all placeholder types in a single pass.
 *
 * Combines image, chart, smartart, and arbitrary key-value replacements
 * into one regex scan of the XML string. Used by compilers to avoid
 * multiple full-string passes on large documents.
 */
export function replaceAllPlaceholders(
  xml: string,
  entries: Array<{ prefix?: string; key: string; value: string }>,
): string {
  if (entries.length === 0 || !hasPlaceholders(xml)) return xml;
  const map = new Map<string, string>();
  for (const { prefix, key, value } of entries) {
    map.set(prefix ? `${prefix}${key}` : key, value);
  }
  return replacePlaceholders(xml, map);
}

export function replaceChartPlaceholders(
  xml: string,
  chartKeys: string[],
  offset: number,
  idFormat: IdFormat = "rId",
): string {
  if (chartKeys.length === 0) return xml;
  const map = new Map<string, string>();
  for (let i = 0; i < chartKeys.length; i++) {
    map.set(`chart:${chartKeys[i]}`, formatId(offset, i, idFormat));
  }
  return replacePlaceholders(xml, map);
}

import type { RelationshipType } from "../opc/relationships";

export interface SmartArtRelOptions {
  pathPrefix: string;
  styleRelType: RelationshipType;
  /**
   * Whether a SmartArt carries the optional diagramDrawing part (the Office
   * render cache). Unset means every SmartArt does — a fresh authoring
   * package never carries it, so round-trip callers pass the source fact.
   */
  hasDrawing?: (key: string) => boolean;
}

export function replaceSmartArtPlaceholders(
  xml: string,
  keys: string[],
  dataOffset: number,
  idFormat: IdFormat = "rId",
): string {
  if (keys.length === 0) return xml;
  const count = keys.length;
  const loOffset = dataOffset + count;
  const qsOffset = loOffset + count;
  const csOffset = qsOffset + count;

  const map = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    map.set(`smartart:${keys[i]}`, formatId(dataOffset, i, idFormat));
    map.set(`smartart-lo:${keys[i]}`, formatId(loOffset, i, idFormat));
    map.set(`smartart-qs:${keys[i]}`, formatId(qsOffset, i, idFormat));
    map.set(`smartart-cs:${keys[i]}`, formatId(csOffset, i, idFormat));
  }
  return replacePlaceholders(xml, map);
}

export function addSmartArtRelationships(
  keys: string[],
  addRel: (id: number, type: RelationshipType, target: string, targetMode?: string) => void,
  baseOffset: number,
  globalStartIndex: number,
  options: SmartArtRelOptions,
): void {
  const { pathPrefix, styleRelType, hasDrawing } = options;
  const count = keys.length;
  const loOffset = baseOffset + count;
  const qsOffset = loOffset + count;
  const csOffset = qsOffset + count;

  for (let i = 0; i < keys.length; i++) {
    const gi = globalStartIndex + i;
    addRel(
      baseOffset + i,
      RELATIONSHIP_TYPES.diagramData,
      `${pathPrefix}diagrams/data${gi + 1}.xml`,
    );
    addRel(
      loOffset + i,
      RELATIONSHIP_TYPES.diagramLayout,
      `${pathPrefix}diagrams/layout${gi + 1}.xml`,
    );
    addRel(qsOffset + i, styleRelType, `${pathPrefix}diagrams/quickStyle${gi + 1}.xml`);
    addRel(
      csOffset + i,
      RELATIONSHIP_TYPES.diagramColors,
      `${pathPrefix}diagrams/colors${gi + 1}.xml`,
    );
    if (hasDrawing === undefined || hasDrawing(keys[i]!)) {
      const drOffset = csOffset + count;
      addRel(
        drOffset + i,
        RELATIONSHIP_TYPES.diagramDrawingMs,
        `${pathPrefix}diagrams/drawing${gi + 1}.xml`,
      );
    }
  }
}

// ── Numbering placeholders (DOCX) ──

/** Replace `{reference-instance}` placeholders with numId values. */
export function replaceNumberingPlaceholders(
  xml: string,
  concreteNumberings: readonly { reference: string; instance: number; numId: number }[],
): string {
  if (concreteNumberings.length === 0) return xml;
  const map = new Map<string, string>();
  for (const { reference, instance, numId } of concreteNumberings) {
    map.set(`${reference}-${instance}`, numId.toString());
  }
  return replacePlaceholders(xml, map);
}

// ── Media/Video placeholders (PPTX) ──

/** Replace `{media:fileName}` placeholders with relationship IDs. */
export function replaceMediaPlaceholders(
  xml: string,
  mediaData: { fileName: string }[],
  offset: number,
): string {
  return replacePrefixedPlaceholders(xml, mediaData, offset, "media:");
}

/** Replace `{video:fileName}` placeholders with relationship IDs. */
export function replaceVideoPlaceholders(
  xml: string,
  mediaData: { fileName: string }[],
  offset: number,
): string {
  return replacePrefixedPlaceholders(xml, mediaData, offset, "video:");
}

/** Replace `{audio:fileName}` placeholders with relationship IDs. */
export function replaceAudioPlaceholders(
  xml: string,
  mediaData: { fileName: string }[],
  offset: number,
): string {
  return replacePrefixedPlaceholders(xml, mediaData, offset, "audio:");
}

/** Replace `{ole:fileName}` placeholders with relationship IDs. */
export function replaceOlePlaceholders(
  xml: string,
  embeddings: { fileName: string }[],
  offset: number,
): string {
  return replacePrefixedPlaceholders(xml, embeddings, offset, "ole:");
}

function replacePrefixedPlaceholders(
  xml: string,
  mediaData: { fileName: string }[],
  offset: number,
  prefix: string,
): string {
  if (mediaData.length === 0) return xml;
  const map = new Map<string, string>();
  for (const [i, item] of mediaData.entries()) {
    map.set(`${prefix}${item.fileName}`, formatId(offset, i, "rId"));
  }
  return replacePlaceholders(xml, map);
}

/** Collect media items referenced by `{media:...}` placeholders in XML. */
export function getMediaRefs(
  xml: string,
  mediaArray: { fileName: string }[],
): { fileName: string }[] {
  return collectPrefixedRefs(xml, "media:", mediaArray);
}

/** Collect media items referenced by `{video:...}` placeholders in XML. */
export function getVideoRefs(
  xml: string,
  mediaArray: { fileName: string }[],
): { fileName: string }[] {
  return collectPrefixedRefs(xml, "video:", mediaArray);
}

/** Collect media items referenced by `{audio:...}` placeholders in XML. */
export function getAudioRefs(
  xml: string,
  mediaArray: { fileName: string }[],
): { fileName: string }[] {
  return collectPrefixedRefs(xml, "audio:", mediaArray);
}

/** Collect OLE embeddings referenced by `{ole:...}` placeholders in XML. */
export function getOleRefs(
  xml: string,
  embeddings: { fileName: string }[],
): { fileName: string }[] {
  return collectPrefixedRefs(xml, "ole:", embeddings);
}

function collectPrefixedRefs(
  xml: string,
  prefix: string,
  mediaArray: { fileName: string }[],
): { fileName: string }[] {
  const keys = new Set<string>();
  const search = `{${prefix}`;
  let pos = 0;
  while ((pos = xml.indexOf(search, pos)) !== -1) {
    const keyStart = pos + search.length;
    const keyEnd = xml.indexOf("}", keyStart);
    if (keyEnd === -1) break;
    keys.add(xml.substring(keyStart, keyEnd));
    pos = keyEnd + 1;
  }
  return mediaArray.filter((m) => keys.has(m.fileName));
}

// ── Hyperlink placeholders (PPTX) ──

/** Replace `{prefix:key}` placeholders with relationship IDs. */
function replaceKeyedPlaceholders(
  xml: string,
  items: { key: string }[],
  offset: number,
  prefix: string,
): string {
  if (items.length === 0) return xml;
  const map = new Map<string, string>();
  for (const [i, item] of items.entries()) {
    map.set(`${prefix}${item.key}`, formatId(offset, i, "rId"));
  }
  return replacePlaceholders(xml, map);
}

/** Replace `{hlink:key}` placeholders with relationship IDs. */
export function replaceHyperlinkPlaceholders(
  xml: string,
  hyperlinks: { key: string }[],
  offset: number,
): string {
  return replaceKeyedPlaceholders(xml, hyperlinks, offset, "hlink:");
}

/** Replace `{img-link:key}` placeholders with relationship IDs. */
export function replaceImageLinkPlaceholders(
  xml: string,
  links: { key: string }[],
  offset: number,
): string {
  return replaceKeyedPlaceholders(xml, links, offset, "img-link:");
}

/** Replace `{ole-link:key}` placeholders with relationship IDs. */
export function replaceOleLinkPlaceholders(
  xml: string,
  links: { key: string }[],
  offset: number,
): string {
  return replaceKeyedPlaceholders(xml, links, offset, "ole-link:");
}
