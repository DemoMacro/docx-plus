import { RELATIONSHIP_TYPES, IMAGE_MEDIA_CONTENT_TYPES, TargetModeType } from "@office-open/core";
import {
  DOCX_NS,
  OoxmlMimeType,
  appendContentType,
  appendOverride,
  appendRelationship,
  applyCorePropertiesOverride,
  createReplacer,
  getNextRelationshipIndex,
  getReferencedMedia,
  nextNumericId,
  replaceImagePlaceholders,
  strFromU8,
  toJson,
  unzipSync,
  zipAndConvert,
} from "@office-open/core";
import type { BasePatchOptions, OutputByType, OutputType } from "@office-open/core";
import { toUint8Array } from "@office-open/core";
import { OOXML_XML_DECLARATION } from "@office-open/xml";
import { escapeXml, stringify, parse } from "@office-open/xml";
import type { Element } from "@office-open/xml";
import { commentsDesc } from "@parts/comments";
import { DocumentAttributeNamespaces } from "@parts/document";
import { stringifySectionProperties } from "@parts/document/body/section-properties/descriptor";
import {
  stringifyChildDispatch,
  stringifyParagraphInline,
  stringifyRunInline,
} from "@parts/inline";
import type { ParagraphChild } from "@parts/paragraph/paragraph";
import type { ParagraphOptions } from "@parts/paragraph/paragraph";
import type { CommentOptions } from "@parts/paragraph/run/comment-run";
import type { RunOptions } from "@parts/paragraph/run/run";
import { tableDesc } from "@parts/table/descriptor";
import type { TableOptions } from "@parts/table/table";
import { Media } from "@shared/media";
import type { MediaData } from "@shared/media/data";
import type { SectionChild, SectionOptions } from "@shared/section";

import type { BodyContext } from "../context";
import type { ViewWrapper } from "../context";

/** Reusable TextEncoder (stateless, safe to share). */
const encoder = new TextEncoder();

const COMMENTS_REL_TYPE = RELATIONSHIP_TYPES.comments;
const COMMENTS_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml";
const HYPERLINK_REL_TYPE = RELATIONSHIP_TYPES.hyperlink;
/**
 * Rendered hyperlink ids start here so they can never collide with the real
 * rIdN ids of the part's relationships — including the media entries the
 * flush appends before hyperlinks. Rewritten on allocation (see flush).
 */
const HYPERLINK_TEMP_ID_BASE = 9_000_000;

/** A comment injected by patch — same as CommentOptions but without an id
 *  (the patch assigns continuation ids). */
export type PatchComment = Omit<CommentOptions, "id">;

/** A comment request resolved to an id and an anchor (paragraph index or placeholder). */
interface AssignedComment {
  id: number;
  anchor: { kind: "paragraph"; index: number } | { kind: "placeholder"; key: string };
  options: PatchComment;
}

/**
 * Document patching module for modifying existing .docx files.
 *
 * Uses compile-path stringifiers (zero class instantiation) to serialize
 * patch content — no Formatter, no XmlComponent instances.
 *
 * @module
 */

// ── Patch content stringification ──

/**
 * Lightweight BodyContext adapter for patch serialization.
 * Captures hyperlink and image relationships for post-processing.
 */
function createPatchContext(
  file: { media: Media<MediaData> },
  hyperlinkSink: Array<{ id: string; link: string }>,
): BodyContext {
  return {
    fileData: file as unknown as BodyContext["fileData"],
    file: file as unknown as BodyContext["file"],
    viewWrapper: {
      relationships: {
        // Temporary ids far above any real rIdN a part can carry — the
        // rendered r:id is rewritten to the allocated id when the
        // relationships flush (media first, hyperlinks after) appends them.
        add: (_type: string, target: string) => {
          const id = HYPERLINK_TEMP_ID_BASE + hyperlinkSink.length + 1;
          hyperlinkSink.push({ id: String(id), link: target });
          return id;
        },
        // No registered relationships to share here — every patched-in
        // hyperlink allocates its own temp id via add.
        idOf: () => undefined,
        relationshipCount: 0,
      },
    } as unknown as BodyContext["viewWrapper"],
    stringifyChild: () => "",
    addRelationship: () => "",
    addMedia: () => "",
    addHyperlink: () => {},
  };
}

/**
 * Serialize a patch child (SectionChild / ParagraphChild / string) into XML
 * elements via the compile-path stringifiers. Shared by the placeholder
 * replacer and body-level `append`. Relies on the module-level
 * {@link currentPatchCtx} for relationship/media sinks.
 */
const formatChildElement = (child: unknown): Element[] => {
  let xmlStr: string;

  if (typeof child === "string") {
    // Plain string → simple run
    xmlStr = `<w:r><w:t xml:space="preserve">${escapeXml(child)}</w:t></w:r>`;
  } else if (typeof child === "object" && child !== null) {
    const obj = child as Record<string, unknown>;
    // SectionChild level (paragraph / table) — for DOCUMENT patches and append
    if ("paragraph" in obj) {
      xmlStr = stringifyParagraphInline(obj.paragraph as ParagraphOptions, currentPatchCtx);
    } else if ("table" in obj) {
      xmlStr = tableDesc.stringify(obj.table as TableOptions, currentPatchCtx) ?? "";
    } else {
      // ParagraphChild level — for PARAGRAPH patches
      // Try compile-path JSON child dispatch first
      const jr = stringifyChildDispatch(child as ParagraphChild, currentPatchCtx);
      if (jr !== undefined) {
        xmlStr = Array.isArray(jr) ? jr.join("") : jr;
      } else {
        // RunOptions (plain objects with text/children/bold/etc.)
        xmlStr = stringifyRunInline(child as RunOptions, currentPatchCtx);
      }
    }
  } else {
    xmlStr = "<w:r/>";
  }

  const jsonObj = parse(xmlStr, { captureSpacesBetweenElements: true });
  const rootEl = jsonObj.elements?.[0];
  // parse yields a single root element for a well-formed fragment
  return rootEl ? [rootEl] : [];
};

const docxReplacer = createReplacer({
  ns: DOCX_NS,
  formatChild: formatChildElement,
});

/** Locate the `<w:body>` element of a parsed word/document.xml part. */
const bodyElementOf = (root: Element): Element | undefined =>
  root.elements?.find((e) => e.name === "w:document")?.elements?.find((e) => e.name === "w:body");

/**
 * Splice block-level children into `<w:body>` before the trailing `<w:sectPr>`
 * (the final section properties). If the body has no trailing sectPr, append at
 * the end. Reuses {@link formatChildElement} so the same serialization and
 * relationship/media sinks apply as placeholder patches.
 */
const appendToBody = (root: Element, children: SectionChild[]): void => {
  const body = bodyElementOf(root);
  if (!body) return;
  const els = body.elements ?? (body.elements = []);
  const newEls: Element[] = [];
  for (const child of children) {
    newEls.push(...formatChildElement(child));
  }
  // Insert before the trailing <w:sectPr>; otherwise at the end.
  let insertAt = els.length;
  for (let i = els.length - 1; i >= 0; i--) {
    const el = els[i];
    if (el && el.name === "w:sectPr") {
      insertAt = i;
      break;
    }
  }
  els.splice(insertAt, 0, ...newEls);
};

/** Current patch context — set per file in the main loop. */
let currentPatchCtx: BodyContext;

// ── Section collection edits (replace / append) ──

/** A detected section: body children [start, end) plus its sectPr element. */
interface BodySectionSpan {
  start: number;
  /** Exclusive; for a non-final section this includes its break paragraph. */
  end: number;
  /** From the break paragraph's pPr, or body-level for the final section. */
  sectPr: Element | undefined;
  /** True when this is the final section (sectPr at body level). */
  final: boolean;
}

/**
 * Scan body children into section spans. A non-final section ends at the
 * paragraph whose pPr carries a sectPr (the section-break paragraph); the
 * trailing body-level sectPr closes the final section.
 */
const scanBodySections = (body: Element): BodySectionSpan[] => {
  const els = body.elements ?? [];
  const spans: BodySectionSpan[] = [];
  let start = 0;
  for (const [i, el] of els.entries()) {
    if (el.name !== "w:p") continue;
    const pPr = el.elements?.find((c) => c.name === "w:pPr");
    const sectPr = pPr?.elements?.find((c) => c.name === "w:sectPr");
    if (sectPr) {
      spans.push({ start, end: i + 1, sectPr, final: false });
      start = i + 1;
    }
  }
  const bodySectPrIndex = els.findIndex((e) => e.name === "w:sectPr");
  spans.push({
    start,
    end: bodySectPrIndex >= 0 ? bodySectPrIndex : els.length,
    sectPr: bodySectPrIndex >= 0 ? els[bodySectPrIndex] : undefined,
    final: true,
  });
  return spans;
};

/** A paragraph whose only role is hosting a section break: `<w:p><w:pPr><sectPr/></w:pPr></w:p>`. */
const makeBreakParagraph = (sectPr: Element): Element => ({
  type: "element",
  name: "w:p",
  elements: [{ type: "element", name: "w:pPr", elements: [sectPr] }],
});

/** Serialize section properties into a sectPr element (or undefined when absent). */
const sectPrElement = (opts: SectionOptions): Element | undefined => {
  if (!opts.properties) return undefined;
  const xml = stringifySectionProperties(opts.properties);
  return parse(xml, { captureSpacesBetweenElements: true }).elements?.[0];
};

const assertPatchableSection = (opts: SectionOptions): void => {
  if (opts.headers || opts.footers) {
    throw new Error(
      "patchDocument: patch sections do not support headers/footers — generate the document instead",
    );
  }
};

/** Serialize section children through the patch pipeline (shared with append/placeholder paths). */
const sectionChildrenElements = (opts: SectionOptions): Element[] => {
  const out: Element[] = [];
  for (const child of opts.children ?? []) {
    out.push(...formatChildElement(child));
  }
  return out;
};

/**
 * Replace one section by index. Without `properties` the section keeps its
 * existing sectPr (page setup); with `properties` the new one takes over.
 * Non-final sections end in a dedicated break paragraph — the same shape the
 * generate path falls back to when a section does not end in a paragraph.
 */
const replaceBodySection = (body: Element, index: number, opts: SectionOptions): void => {
  const spans = scanBodySections(body);
  const span = spans[index];
  if (!span) {
    throw new Error(`patchDocument: no section at index ${index}`);
  }
  assertPatchableSection(opts);

  const newSectPr = sectPrElement(opts);
  const sectPr = newSectPr ?? (span.sectPr ? structuredClone(span.sectPr) : undefined);
  const els = body.elements ?? (body.elements = []);
  const replacement = sectionChildrenElements(opts);

  if (span.final) {
    // Keep the body-level sectPr in place; swap it only when properties were given.
    els.splice(span.start, span.end - span.start, ...replacement);
    if (newSectPr && span.sectPr) {
      els[els.indexOf(span.sectPr)] = newSectPr;
    } else if (newSectPr) {
      els.push(newSectPr);
    }
  } else {
    if (sectPr) replacement.push(makeBreakParagraph(sectPr));
    els.splice(span.start, span.end - span.start, ...replacement);
  }
};

/**
 * Append sections after the last existing one, each closed by its own break
 * paragraph, inserted before the final body-level sectPr. Sections without
 * `properties` inherit the final section's page setup.
 */
const appendBodySections = (body: Element, sections: readonly SectionOptions[]): void => {
  const els = body.elements ?? (body.elements = []);
  // Insert before the trailing body-level <w:sectPr>; otherwise at the end.
  let insertAt = els.length;
  for (let i = els.length - 1; i >= 0; i--) {
    if (els[i] && els[i]!.name === "w:sectPr") {
      insertAt = i;
      break;
    }
  }
  const bodySectPr = insertAt < els.length ? els[insertAt] : undefined;

  const additions: Element[] = [];
  for (const opts of sections) {
    assertPatchableSection(opts);
    additions.push(...sectionChildrenElements(opts));
    const sectPr =
      sectPrElement(opts) ??
      (bodySectPr
        ? structuredClone(bodySectPr)
        : { type: "element", name: "w:sectPr", elements: [] });
    additions.push(makeBreakParagraph(sectPr));
  }
  els.splice(insertAt, 0, ...additions);
};

/**
 * A patch operation: replace a placeholder with either inline run-level
 * content (`type: "paragraph"`) or block-level content (`type: "document"`).
 *
 * The `type` is a bare string literal (no PatchType enum) — the core
 * replacer already discriminates on `patch.type`.
 */
export type Patch =
  | { type: "paragraph"; children: (string | RunOptions | ParagraphChild)[] }
  | { type: "document"; children: SectionChild[] };

interface ImageRelationshipAddition {
  key: string;
  mediaDatas: { fileName: string }[];
  /** Serialized part snapshot from the first pass — reused by the media pass. */
  xml: string;
}

interface HyperlinkRelationshipAddition {
  key: string;
  hyperlink: { id: string; link: string };
}

export interface PatchDocumentOptions<T extends OutputType = OutputType> extends BasePatchOptions<
  T,
  Patch
> {
  keepOriginalStyles?: boolean;
  /** Block-level content appended to the document body, before the final section break. */
  append?: SectionChild[];
  /**
   * Section collection edits. Children serialize through the same pipeline as
   * placeholder patches, so they may carry images, hyperlinks, and the full
   * paragraph/table vocabulary. `headers`/`footers` are not supported here —
   * they need new parts, which patching cannot create; generate instead.
   */
  sections?: {
    /** Replace a section by 0-based index (0 = from the document start). */
    replace?: Readonly<{ index: number; section: SectionOptions }[]>;
    /** Append sections after the last existing one, before the final body sectPr. */
    append?: Readonly<SectionOptions[]>;
  };
  /**
   * Comments to inject. `paragraphs` anchors a comment to the Nth body paragraph
   * (0-based, wraps the whole paragraph); `placeholders` anchors to the run
   * containing a {{key}} (wrapped before placeholder substitution). Ids are
   * continued from any existing word/comments.xml; entries are merged in.
   */
  comments?: {
    /** Comments anchored to a 0-based body paragraph (wraps the whole paragraph). */
    paragraphs?: Readonly<{ index: number; comments: PatchComment[] }[]>;
    placeholders?: Readonly<Record<string, PatchComment[]>>;
  };
}

const UTF16LE = new Uint8Array([0xff, 0xfe]);
const UTF16BE = new Uint8Array([0xfe, 0xff]);

const compareByteArrays = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
};

/**
 * Patches an existing .docx document by replacing placeholders with new content.
 *
 * @publicApi
 */
export const patchDocument = async <T extends OutputType = OutputType>({
  outputType,
  data,
  placeholders,
  findReplace,
  coreProperties,
  append,
  sections,
  comments,
  keepOriginalStyles = true,
  placeholderDelimiters = { end: "}}", start: "{{" } as const,
}: PatchDocumentOptions<T>): Promise<OutputByType[T]> => {
  const zipContent = unzipSync(toUint8Array(data));
  const contexts = new Map<string, BodyContext>();
  const media = new Media<MediaData>();
  const file = { media } as BodyContext["file"];

  // Resolve comment ids by continuation from any existing word/comments.xml.
  const assignedComments = buildAssignedComments(zipContent, comments);

  const map = new Map<string, Element>();

  const imageRelationshipAdditions: ImageRelationshipAddition[] = [];
  const hyperlinkRelationshipAdditions: HyperlinkRelationshipAddition[] = [];
  let hasMedia = false;

  const binaryContentMap = new Map<string, Uint8Array>();

  for (const [key, value] of Object.entries(zipContent)) {
    const startBytes = value.slice(0, 2);
    if (compareByteArrays(startBytes, UTF16LE) || compareByteArrays(startBytes, UTF16BE)) {
      binaryContentMap.set(key, value);
      continue;
    }

    if (!key.endsWith(".xml") && !key.endsWith(".rels")) {
      binaryContentMap.set(key, value);
      continue;
    }

    const json = toJson(strFromU8(value));

    if (key === "word/document.xml") {
      const document = json.elements?.find((i) => i.name === "w:document");
      if (document && document.attributes) {
        for (const ns of ["mc", "wp", "r", "w15", "m"] as const) {
          document.attributes[`xmlns:${ns}`] = DocumentAttributeNamespaces[ns];
        }
        document.attributes["mc:Ignorable"] =
          `${document.attributes["mc:Ignorable"] || ""} w15`.trim();
      }
    }

    if (key.startsWith("word/") && !key.endsWith(".xml.rels")) {
      const hyperlinkSink: Array<{ id: string; link: string }> = [];

      const context: BodyContext = {
        fileData: file,
        file,
        viewWrapper: {
          relationships: {
            // Sequential ids, mirroring Relationships.add. The bare number is
            // stored — appendRelationship adds the rId prefix when flushing.
            add: (_: string, target: string) => {
              hyperlinkRelationshipAdditions.push({
                hyperlink: {
                  id: String(hyperlinkRelationshipAdditions.length + 1),
                  link: target,
                },
                key,
              });
            },
          },
        } as unknown as ViewWrapper,
        stringifyChild: () => "",
        addRelationship: () => "",
        addMedia: () => "",
        addHyperlink: () => {},
      };
      contexts.set(key, context);

      if (!placeholderDelimiters?.start.trim() || !placeholderDelimiters?.end.trim()) {
        throw new Error("Both start and end delimiters must be non-empty strings.");
      }

      const { start, end } = placeholderDelimiters;

      // Create compile-path context for stringifying patch children
      const patchCtx = createPatchContext(file, hyperlinkSink);
      currentPatchCtx = patchCtx;

      // Anchor placeholder comments BEFORE substitution, wrapping the {{key}} run.
      if (key === "word/document.xml") {
        for (const ac of assignedComments) {
          if (ac.anchor.kind === "placeholder") {
            wrapPlaceholderComment(json, `${start}${ac.anchor.key}${end}`, ac.id);
          }
        }
      }

      // Build (find-text → patch) entries. Placeholders wrap the key in
      // delimiters; findReplace uses the literal key. Both share one engine.
      const entries: Array<{ find: string; patch: Patch }> = [];
      if (placeholders) {
        for (const [key, value] of Object.entries(placeholders)) {
          entries.push({ find: `${start}${key}${end}`, patch: value });
        }
      }
      if (findReplace) {
        for (const [key, value] of Object.entries(findReplace)) {
          entries.push({ find: key, patch: value });
        }
      }

      for (const { find: patchText, patch: patchValue } of entries) {
        while (true) {
          const { didFindOccurrence } = docxReplacer({
            context,
            json,
            keepOriginalStyles,
            patch: patchValue,
            patchText,
          });
          if (!didFindOccurrence) {
            break;
          }
        }
      }

      // Append block-level children to the document body before the final sectPr.
      if (append && append.length > 0 && key === "word/document.xml") {
        appendToBody(json, append);
      }

      // Anchor paragraph comments AFTER body edits, wrapping the Nth paragraph.
      if (key === "word/document.xml") {
        for (const ac of assignedComments) {
          if (ac.anchor.kind === "paragraph") {
            wrapParagraphComment(json, ac.anchor.index, ac.id);
          }
        }
      }

      // Section edits run last — comment anchors wrap the input paragraph
      // positions before sections reshape the body.
      if (sections && key === "word/document.xml") {
        const body = bodyElementOf(json);
        if (body) {
          if (sections.replace) {
            for (const { index, section } of sections.replace) {
              replaceBodySection(body, index, section);
            }
          }
          if (sections.append) {
            appendBodySections(body, sections.append);
          }
        }
      }

      // Flush hyperlink relationships captured by the compile-path context
      for (const hl of hyperlinkSink) {
        hyperlinkRelationshipAdditions.push({
          hyperlink: { id: hl.id, link: hl.link },
          key,
        });
      }

      const jsonStr = JSON.stringify(json);
      const mediaDatas = getReferencedMedia(jsonStr, media.array);
      if (mediaDatas.length > 0) {
        hasMedia = true;
        imageRelationshipAdditions.push({
          key,
          mediaDatas,
          xml: jsonStr,
        });
      }
    }

    map.set(key, json);
  }

  // Merge injected comments into word/comments.xml + wire rels + content types.
  if (assignedComments.length > 0) {
    mergeCommentsPart(map, assignedComments, file);
  }

  for (const { key, mediaDatas, xml } of imageRelationshipAdditions) {
    const relationshipKey = `word/_rels/${key.split("/").pop()}.rels`;
    const relationshipsJson = map.get(relationshipKey) ?? createRelationshipFile();
    map.set(relationshipKey, relationshipsJson);

    const index = getNextRelationshipIndex(relationshipsJson);
    // The cached snapshot predates the comments merge — re-serialize that one
    // part so the merge survives the placeholder rewrite.
    const sourceXml = key === "word/comments.xml" ? JSON.stringify(map.get(key)) : xml;
    // "rId" format — appendRelationship writes Id="rIdN", and the rendered
    // r:embed must match it verbatim ("plain" left a dangling bare-number id).
    const newJson = replaceImagePlaceholders(sourceXml, mediaDatas, index, "rId");
    map.set(key, JSON.parse(newJson) as Element);

    for (const [i, media] of mediaDatas.entries()) {
      const { fileName } = media;
      appendRelationship(
        relationshipsJson,
        index + i,
        RELATIONSHIP_TYPES.image,
        `media/${fileName}`,
      );
    }
  }

  // Hyperlink relationships append after media (which already claimed ids via
  // getNextRelationshipIndex above), so allocate the same way — then rewrite
  // the rendered temporary rId9000001-style ids to the allocated ones.
  const hyperlinksByPart = new Map<string, HyperlinkRelationshipAddition[]>();
  for (const addition of hyperlinkRelationshipAdditions) {
    const relationshipKey = `word/_rels/${addition.key.split("/").pop()}.rels`;
    const group = hyperlinksByPart.get(relationshipKey);
    if (group) group.push(addition);
    else hyperlinksByPart.set(relationshipKey, [addition]);
  }

  for (const [relationshipKey, additions] of hyperlinksByPart) {
    const relationshipsJson = map.get(relationshipKey) ?? createRelationshipFile();
    map.set(relationshipKey, relationshipsJson);

    // Part path ↔ its rels path differ only in the _rels/ + .rels suffix;
    // the addition group shares the key, so rewrite once per part.
    const partKey = additions[0]!.key;
    let partJson = JSON.stringify(map.get(partKey) as Element);
    for (const { hyperlink } of additions) {
      const id = getNextRelationshipIndex(relationshipsJson);
      appendRelationship(
        relationshipsJson,
        id,
        HYPERLINK_REL_TYPE,
        hyperlink.link,
        TargetModeType.EXTERNAL,
      );
      partJson = partJson.replaceAll(`"r:id":"rId${hyperlink.id}"`, `"r:id":"rId${id}"`);
    }
    map.set(partKey, JSON.parse(partJson) as Element);
  }

  if (hasMedia) {
    const contentTypesJson = map.get("[Content_Types].xml");

    if (!contentTypesJson) {
      throw new Error("Could not find content types file");
    }

    // Cover every media extension the patch path can register (RegularMediaData
    // includes emf/wmf/tif/ico), not just a hand-picked subset — a patched-in
    // image needs its <Default> even when the source package lacks one.
    for (const [ext, mime] of Object.entries(IMAGE_MEDIA_CONTENT_TYPES)) {
      appendContentType(contentTypesJson, mime, ext);
    }
  }

  const files: Record<string, Uint8Array> = {};

  for (const [key, value] of map) {
    files[key] =
      key === "docProps/core.xml" && coreProperties
        ? encoder.encode(OOXML_XML_DECLARATION + applyCorePropertiesOverride(value, coreProperties))
        : encoder.encode(stringify(value));
  }

  for (const [key, value] of binaryContentMap) {
    files[key] = value;
  }

  for (const { data: mediaData, fileName } of media.array) {
    files[`word/media/${fileName}`] =
      mediaData instanceof Uint8Array ? mediaData : new Uint8Array(mediaData);
  }

  return await zipAndConvert(files, outputType, OoxmlMimeType.DOCX);
};

const createRelationshipFile = (): Element => ({
  declaration: {
    attributes: {
      encoding: "UTF-8",
      standalone: "yes",
      version: "1.0",
    },
  },
  elements: [
    {
      attributes: {
        xmlns: "http://schemas.openxmlformats.org/package/2006/relationships",
      },
      elements: [],
      name: "Relationships",
      type: "element",
    },
  ],
});

/** Build a bare OOXML element node with attributes and no children. */
function makeElement(name: string, attributes: Record<string, string> = {}): Element {
  return { type: "element", name, attributes, elements: [] };
}

/** A `<w:r>` carrying a `<w:commentReference>` (CommentReference run style). */
function commentReferenceRun(id: number): Element {
  // parse yields a single root <w:r> for this well-formed fragment
  return parse(
    `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${id}"/></w:r>`,
  ).elements![0]!;
}

/** Next continuation id for an appended `<w:comment>` (-1 seed → 0 when none). */
function nextCommentId(commentsPart: Element | undefined): number {
  const root = commentsPart?.elements?.find((e) => e.name === "w:comments");
  return nextNumericId(root, "w:comment", "w:id", -1);
}

/** Assign continuation ids to every requested comment anchor. */
function buildAssignedComments(
  zipContent: Record<string, Uint8Array>,
  comments: PatchDocumentOptions["comments"],
): AssignedComment[] {
  if (!comments) return [];
  const raw = zipContent["word/comments.xml"];
  let nextId = raw ? nextCommentId(toJson(strFromU8(raw))) : 0;
  const assigned: AssignedComment[] = [];
  if (comments.placeholders) {
    for (const [key, list] of Object.entries(comments.placeholders)) {
      for (const options of list) {
        assigned.push({ id: nextId++, anchor: { kind: "placeholder", key }, options });
      }
    }
  }
  if (comments.paragraphs) {
    for (const { index, comments: list } of comments.paragraphs) {
      for (const options of list) {
        assigned.push({ id: nextId++, anchor: { kind: "paragraph", index }, options });
      }
    }
  }
  return assigned;
}

/** Wrap the Nth body paragraph with comment range markers + a reference run. */
function wrapParagraphComment(json: Element, index: number, commentId: number): void {
  const body = json.elements
    ?.find((e) => e.name === "w:document")
    ?.elements?.find((e) => e.name === "w:body");
  if (!body) return;
  const paragraphs = (body.elements ?? []).filter((e) => e.name === "w:p");
  const target = paragraphs[index];
  if (!target) {
    throw new Error(`patchDocument: no paragraph at index ${index} to comment`);
  }
  const els = target.elements ?? (target.elements = []);
  const start = makeElement("w:commentRangeStart", { "w:id": String(commentId) });
  const end = makeElement("w:commentRangeEnd", { "w:id": String(commentId) });
  // Insert start after a leading <w:pPr> (or at the head); end + ref at the tail.
  const first = els[0];
  const insertAt = first && first.name === "w:pPr" ? 1 : 0;
  els.splice(insertAt, 0, start);
  els.push(end, commentReferenceRun(commentId));
}

/** Wrap the first run whose `<w:t>` contains the placeholder with comment markers. */
function wrapPlaceholderComment(json: Element, placeholder: string, commentId: number): void {
  const body = json.elements
    ?.find((e) => e.name === "w:document")
    ?.elements?.find((e) => e.name === "w:body");
  if (!body) return;
  for (const p of body.elements ?? []) {
    if (p.name !== "w:p") continue;
    const els = p.elements ?? [];
    for (const [i, el] of els.entries()) {
      if (el.name !== "w:r") continue;
      const t = (el.elements ?? []).find((e) => e.name === "w:t");
      const text = t?.elements?.[0]?.text;
      if (typeof text === "string" && text.includes(placeholder)) {
        els.splice(i, 0, makeElement("w:commentRangeStart", { "w:id": String(commentId) }));
        els.splice(
          i + 2,
          0,
          makeElement("w:commentRangeEnd", { "w:id": String(commentId) }),
          commentReferenceRun(commentId),
        );
        return; // only the first occurrence
      }
    }
  }
}

/**
 * Merge assigned comments into word/comments.xml (appending to an existing part
 * or creating one) and wire document.xml.rels + content types when newly added.
 */
function mergeCommentsPart(
  map: Map<string, Element>,
  assigned: AssignedComment[],
  file: { media: Media<MediaData> },
): void {
  const newOpts: CommentOptions[] = assigned.map((ac) => ({ id: ac.id, ...ac.options }));
  const ctx = createPatchContext(file, []);
  const newXml = commentsDesc.stringify(newOpts, ctx) ?? "";
  const existingEl = map.get("word/comments.xml");
  const wasNew = !existingEl;

  if (existingEl) {
    // Append new <w:comment> elements to the existing <w:comments> root.
    const existingRoot = existingEl.elements?.find((e) => e.name === "w:comments");
    const newRoot = parse(newXml).elements?.find((e) => e.name === "w:comments");
    existingRoot?.elements?.push(...(newRoot?.elements ?? []));
  } else {
    map.set(
      "word/comments.xml",
      toJson(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${newXml}`),
    );
  }

  if (wasNew) {
    const relsKey = "word/_rels/document.xml.rels";
    const relsJson = map.get(relsKey) ?? createRelationshipFile();
    map.set(relsKey, relsJson);
    appendRelationship(
      relsJson,
      getNextRelationshipIndex(relsJson),
      COMMENTS_REL_TYPE,
      "comments.xml",
    );
  }

  // Content types — ensure the comments Override exists (deduped). An existing
  // comments part normally already declares it, but defend against incomplete templates.
  const contentTypes = map.get("[Content_Types].xml");
  if (contentTypes) {
    appendOverride(contentTypes, "/word/comments.xml", COMMENTS_CONTENT_TYPE);
  }
}
