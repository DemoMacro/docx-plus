import {
  RELATIONSHIP_TYPES,
  PPTX_NS,
  OoxmlMimeType,
  appendOverride,
  appendRelationship,
  applyCorePropertiesOverride,
  collectPlaceholderKeys,
  createReplacer,
  getNextRelationshipIndex,
  nextNumericId,
  partPathToRelsPath,
  removeOverride,
  replaceHyperlinkPlaceholders,
  strFromU8,
  toJson,
  unzipSync,
  zipAndConvert,
} from "@office-open/core";
import type { BasePatchOptions, OutputByType, OutputType } from "@office-open/core";
import { toUint8Array } from "@office-open/core";
import type { ReadContext } from "@office-open/core/descriptor";
import type { TextRunOptions } from "@office-open/core/drawing";
import { OOXML_XML_DECLARATION } from "@office-open/xml";
import { findChild, stringify, parse } from "@office-open/xml";
import type { Element } from "@office-open/xml";
import type { AuthorEntry, CommentEntry } from "@parts/comment";
import { commentAuthorsDesc, slideCommentsDesc } from "@parts/descriptors/comments";
import { textRunDesc } from "@parts/descriptors/text";
import type { SlideCommentOptions, SlideOptions } from "@shared/file";

import { buildCommentData, stringifySlide } from "./compiler";
import { PptxWriteContext } from "./context";

/** Reusable TextEncoder (stateless, safe to share). */
const encoder = new TextEncoder();

/**
 * Parts scanned for text replacement: slides, slide masters, slide layouts,
 * and notes slides. Replacing text in a master/layout propagates to every
 * dependent slide — intended for template branding.
 */
const TARGET_RE =
  /^ppt\/(?:slides\/slide\d+|slideMasters\/slideMaster\d+|slideLayouts\/slideLayout\d+|notesSlides\/notesSlide\d+)\.xml$/;
const HYPERLINK_REL_TYPE = RELATIONSHIP_TYPES.hyperlink;
const SLIDE_PART_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
const SLIDE_REL_TYPE = RELATIONSHIP_TYPES.slide;
const SLIDE_LAYOUT_REL_TYPE = RELATIONSHIP_TYPES.slideLayout;
const COMMENTS_REL_TYPE = RELATIONSHIP_TYPES.comments;
const COMMENT_AUTHORS_REL_TYPE = RELATIONSHIP_TYPES.commentAuthors;
const COMMENTS_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.comments+xml";
const COMMENT_AUTHORS_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml";

/**
 * Inline run-level patch content. Reuses the generate vocabulary: a
 * {@link TextRunOptions} (or an array of them), or a plain string shorthand
 * for `{ text: "…" }`.
 */
export type Patch = TextRunOptions | TextRunOptions[] | string;

export interface PatchPresentationOptions<
  T extends OutputType = OutputType,
> extends BasePatchOptions<T, Patch> {
  /**
   * Slide collection edits. Appended slides inherit the template's first slide
   * layout; replaced slides keep their existing identity (sldId/rId/rels).
   */
  slides?: {
    /** Replace slides keyed by 0-based index in the slide list (sldIdLst order). */
    replace?: Readonly<Record<number, SlideOptions>>;
    /** Append slides after the last existing slide. */
    append?: Readonly<SlideOptions[]>;
    /** Remove slides by 0-based index in the slide list (sldIdLst order). */
    remove?: readonly number[];
  };
  /**
   * Comments to append per slide, keyed by 0-based slide index (sldIdLst order).
   * Authors are merged into commentAuthors.xml (deduped by name, ids continued);
   * per-slide comments are merged into ppt/comments/commentN.xml.
   */
  comments?: Readonly<Record<number, SlideCommentOptions[]>>;
  keepOriginalStyles?: boolean;
}

/** Write context for the current patch operation — accumulates hyperlinks. */
let currentPatchCtx: PptxWriteContext;

/**
 * Patch replacer. Serializes each run via {@link textRunDesc} so the full
 * RunProperties vocabulary (color, fill, outline, shadow, font, hyperlinks, …)
 * is supported — no hand-rolled `<a:r>` builder.
 */
const pptxReplacer = createReplacer({
  ns: PPTX_NS,
  formatChild: (child: unknown): Element[] => {
    const runOpts = (typeof child === "string" ? { text: child } : child) as TextRunOptions;
    const xmlStr = textRunDesc.stringify(runOpts, currentPatchCtx) ?? "<a:r/>";
    const root = parse(xmlStr, { captureSpacesBetweenElements: true }).elements?.[0];
    return root ? [root] : [];
  },
  preserveSpace: false,
});

/**
 * Normalize a user patch value into the replacer's `{ type, children }`
 * envelope. PPTX patches are always inline run-level (`type: "paragraph"`).
 */
const toReplacerPatch = (patch: Patch): { type: "paragraph"; children: TextRunOptions[] } =>
  typeof patch === "string"
    ? { type: "paragraph", children: [{ text: patch }] }
    : { type: "paragraph", children: Array.isArray(patch) ? patch : [patch] };

const createRelationshipFile = (): Element => ({
  declaration: {
    attributes: { encoding: "UTF-8", standalone: "yes", version: "1.0" },
  },
  elements: [
    {
      attributes: { xmlns: "http://schemas.openxmlformats.org/package/2006/relationships" },
      elements: [],
      name: "Relationships",
      type: "element",
    },
  ],
});

/** Build a bare OOXML element node. */
const makeElement = (name: string, attributes: Record<string, string> = {}): Element => ({
  type: "element",
  name,
  attributes,
  elements: [],
});

/**
 * Locate the document root element by tag. A parsed XML part is wrapped as
 * `{ declaration, elements: [<root>] }`, so named children live one level down.
 */
const rootElement = (doc: Element | undefined, name: string): Element | undefined =>
  doc?.elements?.find((e) => e.name === name);

/** Next 1-based slide file number given the existing slide parts. */
const nextSlideNumber = (xmlMap: Map<string, Element>): number => {
  let maxN = 0;
  for (const key of xmlMap.keys()) {
    const m = key.match(/^ppt\/slides\/slide(\d+)\.xml$/);
    if (m) maxN = Math.max(maxN, Number(m[1]));
  }
  return maxN + 1;
};

/** Next id for an appended `<p:sldId>` (255 floor → ≥256). */
const nextSldId = (sldIdLst: Element | undefined): number =>
  nextNumericId(sldIdLst, "p:sldId", "id", 255);

/** Resolve a relationship `r:id` to its Target via a rels part. */
const resolveRelTarget = (
  rels: Element | undefined,
  rId: string | number | undefined,
): string | undefined => {
  if (rId === undefined) return undefined;
  const needle = String(rId);
  const relationshipsRoot = rootElement(rels, "Relationships");
  for (const child of relationshipsRoot?.elements ?? []) {
    if (child.name === "Relationship" && String(child.attributes?.["Id"]) === needle) {
      const target = child.attributes?.["Target"];
      return target !== undefined ? String(target) : undefined;
    }
  }
  return undefined;
};

/**
 * Append a slide: serialize it, then wire sldIdLst + presentation rels +
 * content types + a slide rels pointing at the first slide layout (which must
 * already exist in the template). The appended slide inherits the template's
 * layout/master; it cannot reference styles or media not already present.
 */
const appendSlideToMap = (
  xmlMap: Map<string, Element>,
  slideOpts: SlideOptions,
  ctx: PptxWriteContext,
): void => {
  const newN = nextSlideNumber(xmlMap);
  const slidePath = `ppt/slides/slide${newN}.xml`;

  // Slide part — no XML declaration, matching generated slide parts.
  xmlMap.set(slidePath, toJson(stringifySlide(slideOpts, ctx)));

  // presentation.xml sldIdLst + presentation.xml.rels (the new rId ties them)
  const presRoot = rootElement(xmlMap.get("ppt/presentation.xml"), "p:presentation");
  const presRels = xmlMap.get("ppt/_rels/presentation.xml.rels") ?? createRelationshipFile();
  xmlMap.set("ppt/_rels/presentation.xml.rels", presRels);
  const newRId = getNextRelationshipIndex(presRels);

  const sldIdLst = findChild(presRoot, "p:sldIdLst");
  if (sldIdLst) {
    const els = sldIdLst.elements ?? (sldIdLst.elements = []);
    els.push(makeElement("p:sldId", { id: String(nextSldId(sldIdLst)), "r:id": `rId${newRId}` }));
  }
  appendRelationship(presRels, newRId, SLIDE_REL_TYPE, `slides/slide${newN}.xml`);

  // [Content_Types].xml Override
  const contentTypes = xmlMap.get("[Content_Types].xml");
  if (contentTypes) {
    appendOverride(contentTypes, `/${slidePath}`, SLIDE_PART_CONTENT_TYPE);
  }

  // Slide rels → first slide layout (template must already provide it)
  const slideRels = createRelationshipFile();
  appendRelationship(slideRels, 1, SLIDE_LAYOUT_REL_TYPE, "../slideLayouts/slideLayout1.xml");
  xmlMap.set(`ppt/slides/_rels/slide${newN}.xml.rels`, slideRels);
};

/** Resolve a 0-based sldIdLst index to its slide part path (ppt/slides/slideN.xml). */
const resolveSlidePath = (xmlMap: Map<string, Element>, index: number): string => {
  const presRoot = rootElement(xmlMap.get("ppt/presentation.xml"), "p:presentation");
  const sldIdLst = findChild(presRoot, "p:sldIdLst");
  const sldIds = (sldIdLst?.elements ?? []).filter((e) => e.name === "p:sldId");
  const entry = sldIds[index];
  if (!entry?.attributes?.["r:id"]) {
    throw new Error(`patchPresentation: no slide at index ${index}`);
  }
  const target = resolveRelTarget(
    xmlMap.get("ppt/_rels/presentation.xml.rels"),
    entry.attributes["r:id"],
  );
  if (!target) {
    throw new Error(`patchPresentation: slide ${index} relationship target not found`);
  }
  return `ppt/${target}`;
};

/**
 * Replace a slide in place by sldIdLst index: resolve the index to its slide
 * path via presentation rels, then rewrite only that part's content. sldId,
 * rId, content types, and slide rels are left untouched.
 */
const replaceSlideInMap = (
  xmlMap: Map<string, Element>,
  index: number,
  slideOpts: SlideOptions,
  ctx: PptxWriteContext,
): void => {
  const slidePath = resolveSlidePath(xmlMap, index);
  xmlMap.set(slidePath, toJson(stringifySlide(slideOpts, ctx)));
};

/** Resolve a relationship Target against the directory of its source part. */
const resolveTargetPath = (sourceDir: string, target: string): string => {
  if (target.startsWith("/")) return target.slice(1);
  const base = sourceDir.split("/").filter(Boolean);
  for (const seg of target.split("/")) {
    if (seg === "..") base.pop();
    else if (seg !== ".") base.push(seg);
  }
  return base.join("/");
};

/**
 * Remove a part from the package: the part itself, its rels, and its
 * `[Content_Types].xml` Override. Parts the rels point at are NOT touched —
 * layouts, media, and charts are shared across slides; they simply lose one
 * referencing slide, and unreferenced leftovers are inert in OPC packages.
 */
const removePart = (xmlMap: Map<string, Element>, partPath: string): void => {
  xmlMap.delete(partPath);
  xmlMap.delete(partPathToRelsPath(partPath));
  const contentTypes = xmlMap.get("[Content_Types].xml");
  if (contentTypes) removeOverride(contentTypes, `/${partPath}`);
};

const NOTES_SLIDE_REL_TYPE = RELATIONSHIP_TYPES.notesSlide;

/**
 * Remove slides by 0-based index (positions in the deck as it entered the
 * patch). Drops each sldIdLst entry, the presentation relationship, and the
 * slide part with its rels. The slide's notesSlide — which no other slide
 * references — is removed with it; shared parts (layouts, media, …) stay.
 * Run after replace/append — those operate on the same original indices,
 * which the trailing slide removals do not disturb.
 */
const removeSlidesFromMap = (xmlMap: Map<string, Element>, indices: readonly number[]): void => {
  // Resolve every index before touching sldIdLst — removing entries mid-loop
  // would shift the positions of later ones.
  const presRoot = rootElement(xmlMap.get("ppt/presentation.xml"), "p:presentation");
  const sldIdLst = findChild(presRoot, "p:sldIdLst");
  const sldIds = (sldIdLst?.elements ?? []).filter((e) => e.name === "p:sldId");
  const presRelsKey = "ppt/_rels/presentation.xml.rels";

  const doomedEntries = new Set<Element>();
  const doomedRIds = new Set<string>();
  const slidePaths: string[] = [];
  for (const index of indices) {
    const entry = sldIds[index];
    const rId = entry?.attributes?.["r:id"];
    if (!rId) {
      throw new Error(`patchPresentation: no slide at index ${index}`);
    }
    const target = resolveRelTarget(xmlMap.get(presRelsKey), rId);
    if (!target) {
      throw new Error(`patchPresentation: slide ${index} relationship target not found`);
    }
    doomedEntries.add(entry);
    doomedRIds.add(String(rId));
    slidePaths.push(resolveTargetPath("ppt", target));
  }

  if (sldIdLst?.elements) {
    sldIdLst.elements = sldIdLst.elements.filter((e) => !doomedEntries.has(e));
  }
  const presRelsRoot = rootElement(xmlMap.get(presRelsKey), "Relationships");
  if (presRelsRoot?.elements) {
    presRelsRoot.elements = presRelsRoot.elements.filter(
      (e) => !(e.name === "Relationship" && doomedRIds.has(String(e.attributes?.["Id"]))),
    );
  }
  for (const slidePath of slidePaths) {
    // The notesSlide is owned by exactly this slide — take it with us.
    const slideRelsRoot = rootElement(xmlMap.get(partPathToRelsPath(slidePath)), "Relationships");
    const notesTarget = findRelByType(slideRelsRoot, NOTES_SLIDE_REL_TYPE)?.target;
    if (notesTarget) {
      removePart(xmlMap, resolveTargetPath("ppt/slides", notesTarget));
    }
    removePart(xmlMap, slidePath);
  }
};

/** Find an existing relationship of a type in a Relationships root. */
const findRelByType = (
  rels: Element | undefined,
  type: string,
): { id: string; target: string } | undefined => {
  const relationshipsRoot = rootElement(rels, "Relationships");
  for (const child of relationshipsRoot?.elements ?? []) {
    if (child.name === "Relationship" && String(child.attributes?.["Type"]) === type) {
      const target = child.attributes?.["Target"];
      if (target !== undefined) {
        return { id: String(child.attributes?.["Id"]), target: String(target) };
      }
    }
  }
  return undefined;
};

/** Noop ReadContext: comment-author/comment-list parse touches no relationships/parts/raw media. */
const STUB_READ_CTX: ReadContext = {
  resolveRelationship: () => undefined,
  getPart: () => undefined,
  getRaw: () => undefined,
};

/**
 * Append comments to a slide, merging authors into commentAuthors.xml and the
 * per-slide list into ppt/comments/commentN.xml. Wires presentation rels
 * (commentAuthors) + slide rels (comments) + content types when newly introduced.
 */
const appendCommentsToMap = (
  xmlMap: Map<string, Element>,
  index: number,
  slideComments: SlideCommentOptions[],
  ctx: PptxWriteContext,
): void => {
  const slidePath = resolveSlidePath(xmlMap, index);
  const slideNMatch = slidePath.match(/slide(\d+)\.xml$/);
  const slideN = slideNMatch ? Number(slideNMatch[1]) : index + 1;
  const commentPath = `ppt/comments/comment${slideN}.xml`;

  // Parse existing authors + per-slide comments (merge targets).
  const existingAuthorsRoot = rootElement(xmlMap.get("ppt/commentAuthors.xml"), "p:cmAuthorLst");
  const existingAuthors: AuthorEntry[] = existingAuthorsRoot
    ? commentAuthorsDesc.parse(existingAuthorsRoot, STUB_READ_CTX)
    : [];
  const existingEntriesRoot = rootElement(xmlMap.get(commentPath), "p:cmLst");
  const existingEntries: CommentEntry[] = existingEntriesRoot
    ? slideCommentsDesc.parse(existingEntriesRoot, STUB_READ_CTX)
    : [];

  // buildCommentData continues author ids + per-author idx from existing authors.
  const { authors, perSlide } = buildCommentData(
    [{ comments: slideComments }] as unknown as SlideOptions[],
    existingAuthors,
  );
  const mergedEntries = [...existingEntries, ...(perSlide[0] ?? [])];
  const mergedAuthors = authors ?? existingAuthors;

  // commentAuthors.xml (global) — written when any authors exist.
  if (mergedAuthors.length > 0) {
    xmlMap.set(
      "ppt/commentAuthors.xml",
      toJson(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${commentAuthorsDesc.stringify(mergedAuthors, ctx)}`,
      ),
    );
    const presRels = xmlMap.get("ppt/_rels/presentation.xml.rels") ?? createRelationshipFile();
    xmlMap.set("ppt/_rels/presentation.xml.rels", presRels);
    if (!findRelByType(presRels, COMMENT_AUTHORS_REL_TYPE)) {
      const n = getNextRelationshipIndex(presRels);
      appendRelationship(presRels, n, COMMENT_AUTHORS_REL_TYPE, "commentAuthors.xml");
    }
  }

  // commentN.xml (per slide).
  xmlMap.set(
    commentPath,
    toJson(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${slideCommentsDesc.stringify(mergedEntries, ctx)}`,
    ),
  );
  const slideRelsKey = partPathToRelsPath(slidePath);
  const slideRels = xmlMap.get(slideRelsKey) ?? createRelationshipFile();
  xmlMap.set(slideRelsKey, slideRels);
  if (!findRelByType(slideRels, COMMENTS_REL_TYPE)) {
    const n = getNextRelationshipIndex(slideRels);
    appendRelationship(slideRels, n, COMMENTS_REL_TYPE, `../comments/comment${slideN}.xml`);
  }

  // Content types — commentAuthors + commentN Overrides (deduped).
  const contentTypes = xmlMap.get("[Content_Types].xml");
  if (contentTypes) {
    if (mergedAuthors.length > 0) {
      appendOverride(contentTypes, "/ppt/commentAuthors.xml", COMMENT_AUTHORS_CONTENT_TYPE);
    }
    appendOverride(contentTypes, `/${commentPath}`, COMMENTS_CONTENT_TYPE);
  }
};

/**
 * Patches an existing .pptx presentation by replacing placeholders with run content.
 *
 * Patch content reuses the generate {@link TextRunOptions} vocabulary (serialized
 * via the same descriptor), so color, fonts, fills, and hyperlinks are all
 * supported. Hyperlinks introduced by patch runs are registered into each
 * slide's relationship part.
 *
 * @publicApi
 */
export const patchPresentation = async <T extends OutputType = OutputType>({
  outputType,
  data,
  placeholders,
  findReplace,
  coreProperties,
  slides,
  comments,
  keepOriginalStyles = true,
  placeholderDelimiters = { end: "}}", start: "{{" } as const,
}: PatchPresentationOptions<T>): Promise<OutputByType[T]> => {
  const { start, end } = placeholderDelimiters;
  if (!start.trim() || !end.trim()) {
    throw new Error("Both start and end delimiters must be non-empty strings.");
  }

  const zipContent = unzipSync(toUint8Array(data));

  const xmlMap = new Map<string, Element>();
  const binaryMap = new Map<string, Uint8Array>();

  // Separate XML files from binary files
  for (const [key, value] of Object.entries(zipContent)) {
    if (key.endsWith(".xml") || key.endsWith(".rels")) {
      xmlMap.set(key, toJson(strFromU8(value)));
    } else {
      binaryMap.set(key, value);
    }
  }

  // Build (find-text → patch envelope) entries. Placeholders wrap the key in
  // delimiters; findReplace uses the literal key. Both share the same engine.
  const entries: Array<{
    find: string;
    patch: { type: "paragraph"; children: TextRunOptions[] };
  }> = [];
  if (placeholders) {
    for (const [key, value] of Object.entries(placeholders)) {
      entries.push({ find: `${start}${key}${end}`, patch: toReplacerPatch(value) });
    }
  }
  if (findReplace) {
    for (const [key, value] of Object.entries(findReplace)) {
      entries.push({ find: key, patch: toReplacerPatch(value) });
    }
  }

  // Target parts: slides + masters + layouts + notes (deterministic order)
  const targetPaths = Object.keys(zipContent)
    .filter((k) => TARGET_RE.test(k))
    .sort();

  currentPatchCtx = new PptxWriteContext();
  const context = {};

  // Process text replacement on each target part
  for (const targetPath of targetPaths) {
    const json = xmlMap.get(targetPath);
    if (!json) continue;

    for (const { find, patch } of entries) {
      // Replace every occurrence — loop until the replacer finds no more.
      while (true) {
        const { didFindOccurrence } = pptxReplacer({
          context,
          json,
          keepOriginalStyles,
          patch,
          patchText: find,
        });
        if (!didFindOccurrence) break;
      }
    }
  }

  // Resolve hyperlink placeholders registered by patch runs into each part's rels
  const hlinkByKey = new Map(currentPatchCtx.hyperlinks.map((h) => [h.key, h]));
  for (const targetPath of targetPaths) {
    const targetEl = xmlMap.get(targetPath);
    if (!targetEl) continue;

    const targetXml = stringify(targetEl);
    const hlinkKeys = collectPlaceholderKeys(targetXml, "hlink:");
    if (hlinkKeys.length === 0) continue;

    const targetHlinks = hlinkKeys
      .map((k) => hlinkByKey.get(k))
      .filter((h): h is NonNullable<typeof h> => h !== undefined);
    if (targetHlinks.length === 0) continue;

    // Generalized rels path: ppt/<dir>/_rels/<file>.rels
    const relsKey = partPathToRelsPath(targetPath);
    const relsJson = xmlMap.get(relsKey) ?? createRelationshipFile();
    xmlMap.set(relsKey, relsJson);
    const offset = getNextRelationshipIndex(relsJson);

    const resolved = replaceHyperlinkPlaceholders(targetXml, targetHlinks, offset);
    xmlMap.set(targetPath, toJson(resolved));

    for (const [i, hlink] of targetHlinks.entries()) {
      // External URL hyperlinks only; internal slide jumps carry no url and are
      // tokenized by the stringifier rather than registered as External rels.
      if (hlink.url !== undefined) {
        appendRelationship(relsJson, offset + i, HYPERLINK_REL_TYPE, hlink.url, "External");
      }
    }
  }

  // Slide collection edits — reuse the slide stringifier (no compiler re-run).
  // Removal runs last: replace/append address the original slide indices,
  // which the removals (dropping entries) would otherwise shift.
  if (slides) {
    if (slides.replace) {
      for (const [index, slideOpts] of Object.entries(slides.replace)) {
        replaceSlideInMap(xmlMap, Number(index), slideOpts, currentPatchCtx);
      }
    }
    if (slides.append) {
      for (const slideOpts of slides.append) {
        appendSlideToMap(xmlMap, slideOpts, currentPatchCtx);
      }
    }
    if (slides.remove) {
      removeSlidesFromMap(xmlMap, slides.remove);
    }
  }

  // Slide comments — append per slide, merging authors + per-slide comment lists.
  if (comments) {
    for (const [indexStr, slideComments] of Object.entries(comments)) {
      appendCommentsToMap(xmlMap, Number(indexStr), slideComments, currentPatchCtx);
    }
  }

  // Rebuild ZIP
  const files: Record<string, Uint8Array> = {};

  for (const [key, value] of xmlMap) {
    files[key] =
      key === "docProps/core.xml" && coreProperties
        ? encoder.encode(OOXML_XML_DECLARATION + applyCorePropertiesOverride(value, coreProperties))
        : encoder.encode(stringify(value));
  }

  for (const [key, value] of binaryMap) {
    files[key] = value;
  }

  return await zipAndConvert(files, outputType, OoxmlMimeType.PPTX);
};
