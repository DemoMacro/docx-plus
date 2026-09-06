import type { ParsedArchive } from "@office-open/core";
import { parseArchive } from "@office-open/core";
import type { DataType } from "@office-open/core";
import {
  collectPassthroughParts,
  isEncryptedContainer,
  resolveRelationshipTarget,
  toUint8Array,
  toUint8ArrayAsync,
} from "@office-open/core";
import type { ThemeColor } from "@office-open/core";
import { contentTypesDesc } from "@office-open/core";
import { attr } from "@office-open/xml";
import type { Element } from "@office-open/xml";
import { appPropertiesDesc } from "@parts/app-properties";
import { bibliographyDesc } from "@parts/bibliography";
import { setBodyParseChild } from "@parts/bodychildren";
import { commentsDesc } from "@parts/comments";
import { commentsExtendedDesc } from "@parts/comments-extended";
import { corePropertiesDesc } from "@parts/core-properties";
import type { DocumentOptions } from "@parts/core-properties";
import { customPropertiesDesc } from "@parts/custom-properties";
import { endnotesDesc } from "@parts/endnotes/descriptor";
import { fontTableDesc } from "@parts/fonts/descriptor";
import type { EmbeddedFontOptionsWithKey } from "@parts/fonts/font-wrapper";
import { footnotesDesc } from "@parts/footnotes/descriptor";
import { glossaryDesc } from "@parts/glossary-document";
import { setNotesParseChild } from "@parts/notes/shared";
import { parseNumberingDefinitions } from "@parts/numbering/numbering";
import { peopleDesc } from "@parts/people";
import { settingsDesc } from "@parts/settings/descriptor";
import {
  buildStyleCache,
  buildNumberingCache,
  buildNumIdCache,
  parseStyleDefinitions,
} from "@parts/styles/styles";
import { setTableParseChild } from "@parts/table/descriptor";
import { webSettingsDesc } from "@parts/web-settings";

import { parseParagraphProperties } from "./body";
import { DocxReadContext } from "./context";
import { parseBody, parseSectionChild } from "./parse/body";
import { replaceRelsWithPlaceholders } from "./util/replace-media-placeholders";
import { stringifyElement } from "./util/stringify-element";

export { parseArchive };

/**
 * All part paths extracted from the DOCX package.
 * Field names correspond directly to the OOXML directory structure.
 */
export interface DocxPartRefs {
  /** word/headerN.xml keyed by rId */
  headers: Map<string, string>;
  /** word/footerN.xml keyed by rId */
  footers: Map<string, string>;
  /** word/footnotes.xml */
  footnotes?: string;
  /** word/endnotes.xml */
  endnotes?: string;
  /** word/comments.xml */
  comments?: string;
  /** word/people.xml (Word 2013+ comment authors) */
  people?: string;
  /** word/commentsExtended.xml (Word 2013+ comment metadata) */
  commentsExtended?: string;
  /** Hyperlink targets keyed by rId (external URLs) */
  hyperlinks: Map<string, string>;
  /** word/charts/chartN.xml keyed by rId */
  charts: Map<string, string>;
  /** word/diagrams/dataN.xml keyed by rId */
  diagramData: Map<string, string>;
  /** word/diagrams/layoutN.xml keyed by rId */
  diagramLayout: Map<string, string>;
  /** word/diagrams/quickStyleN.xml keyed by rId */
  diagramQuickStyle: Map<string, string>;
  /** word/diagrams/colorsN.xml keyed by rId */
  diagramColors: Map<string, string>;
  /**
   * word/diagrams/drawingN.xml keyed by rId — the pre-rendered dsp:drawing
   * snapshot. Word wires it through the data part's own rels; pandoc through
   * document.xml.rels, so both feeds land here.
   */
  diagramDrawing: Map<string, string>;
  /** word/media/* keyed by rId (from document.xml.rels) */
  media: Map<string, string>;
  /**
   * Per-part binary-part relationships (image/media/OLE embedding). Each part
   * (document, headers, footers, footnotes, …) has its own .rels with
   * independent rId numbering, so drawings and w:object runs inside a part
   * must resolve their binaries against that part's rels. Maps
   * partPath → (rId → partPath).
   */
  partMedia: Map<string, Map<string, string>>;
  /**
   * Per-part OLE embedding relationship kinds, partPath → (rId →
   * "oleObject" | "package"). A source relates an embedded workbook either as
   * an OLE compound (oleObject) or as the native OPC package (package); the
   * distinction is not derivable from the target path, so it is captured for
   * the compiler to re-emit the same relationship type.
   */
  partEmbeddingTypes: Map<string, Map<string, "oleObject" | "package">>;
  /**
   * Per-part external hyperlink targets, partPath → (rId → URL). Same
   * independent-numbering rationale as partMedia: a hyperlink inside a
   * footnote/header/comment resolves its r:id against that part's own rels,
   * not document.xml's.
   */
  partHyperlinks: Map<string, Map<string, string>>;
  /**
   * Per-part externally linked image sources (a:blip @r:link),
   * partPath → (rId → URL). External targets stay raw — path resolution
   * would splice an absolute URL into the part directory.
   */
  partExternalImages: Map<string, Map<string, string>>;
  /** Alternative format chunks (word/afchunkN.*) keyed by rId */
  afChunks: Map<string, string>;
  /** Sub-documents (word/subdocs/subdocN.docx) keyed by rId */
  subDocs: Map<string, string>;
  /** Per-part Word 2010 text-box relationships, partPath → (rId → partPath). */
  partTextBoxes: Map<string, Map<string, string>>;
  /** word/bibliography.xml */
  bibliography?: string;
  /** word/glossary/document.xml */
  glossary?: string;
}

export interface DocxDocument {
  doc: ParsedArchive;
  /** word/document.xml → root w:document element */
  documentRoot: Element;
  /** word/document.xml → w:body element */
  body: Element;
  /** word/document.xml → w:background element */
  background?: Element;
  /** word/styles.xml */
  styles?: Element;
  /** word/numbering.xml */
  numbering?: Element;
  /** word/settings.xml */
  settings?: Element;
  /** word/fontTable.xml */
  fontTable?: Element;
  /** word/webSettings.xml */
  webSettings?: Element;
  partRefs: DocxPartRefs;
  /** docProps/core.xml */
  coreProps?: string;
  /** docProps/app.xml */
  appProps?: string;
  /** docProps/custom.xml */
  customProps?: string;
  /** [Content_Types].xml */
  contentTypes?: Element;
}

/**
 * Resolve each embedded font's .odttf bytes through fontTable.xml.rels.
 * Reads the binary verbatim and flags it raw so the compiler copies it as-is
 * instead of re-obfuscating (the fontKey already matches the bytes).
 */
function resolveEmbeddedFontData(fonts: EmbeddedFontOptionsWithKey[], doc: ParsedArchive): void {
  const relsEl = doc.get("word/_rels/fontTable.xml.rels");
  if (!relsEl) return;
  const ridToPath = new Map<string, string>();
  for (const child of relsEl.elements ?? []) {
    if (child.name !== "Relationship") continue;
    const type = attr(child, "Type") ?? "";
    if (!type.includes("/font")) continue;
    const id = attr(child, "Id") ?? "";
    const target = attr(child, "Target") ?? "";
    if (id && target) ridToPath.set(id, resolveRelationshipTarget("word/fontTable.xml", target));
  }
  for (const font of fonts) {
    if (!font.embedRid) continue;
    const odttfPath = ridToPath.get(font.embedRid);
    if (!odttfPath) continue;
    const bytes = doc.getRaw(odttfPath);
    if (bytes) {
      font.data = Buffer.from(bytes);
      font.rawOdttf = true;
      font.odttfPath = odttfPath;
    }
  }
}

function parseDocPartRefs(doc: ParsedArchive): DocxPartRefs {
  const refs: DocxPartRefs = {
    headers: new Map(),
    footers: new Map(),
    hyperlinks: new Map(),
    charts: new Map(),
    diagramData: new Map(),
    diagramLayout: new Map(),
    diagramQuickStyle: new Map(),
    diagramColors: new Map(),
    diagramDrawing: new Map(),
    media: new Map(),
    partMedia: new Map(),
    partEmbeddingTypes: new Map(),
    partExternalImages: new Map(),
    afChunks: new Map(),
    subDocs: new Map(),
    partTextBoxes: new Map(),
    partHyperlinks: new Map(),
  };

  const relsEl = doc.get("word/_rels/document.xml.rels");
  if (!relsEl) return refs;

  for (const child of relsEl.elements ?? []) {
    if (child.name !== "Relationship") continue;
    const type = attr(child, "Type") ?? "";
    const target = attr(child, "Target") ?? "";
    const id = attr(child, "Id") ?? "";
    if (!target) continue;

    const path = resolveRelationshipTarget("word/document.xml", target);

    if (type.includes("/header")) {
      refs.headers.set(id, path);
    } else if (type.includes("/footer")) {
      refs.footers.set(id, path);
    } else if (type.includes("/footnotes")) {
      refs.footnotes = path;
    } else if (type.includes("/endnotes")) {
      refs.endnotes = path;
    } else if (type.includes("/commentsExtended")) {
      refs.commentsExtended = path;
    } else if (type.includes("/comments")) {
      refs.comments = path;
    } else if (type.includes("/people")) {
      refs.people = path;
    } else if (type.includes("/chart")) {
      refs.charts.set(id, path);
    } else if (type.includes("/diagramData")) {
      refs.diagramData.set(id, path);
    } else if (type.includes("/diagramLayout")) {
      refs.diagramLayout.set(id, path);
    } else if (type.includes("/diagramQuickStyle")) {
      refs.diagramQuickStyle.set(id, path);
    } else if (type.includes("/diagramColors")) {
      refs.diagramColors.set(id, path);
    } else if (type.includes("/diagramDrawing")) {
      refs.diagramDrawing.set(id, path);
    } else if (type.includes("/image") || type.includes("/media")) {
      refs.media.set(id, path);
    } else if (type.includes("/aFChunk")) {
      refs.afChunks.set(id, path);
    } else if (type.includes("/subDocument")) {
      refs.subDocs.set(id, path);
    } else if (type.includes("/bibliography")) {
      refs.bibliography = path;
    } else if (type.includes("/glossaryDocument")) {
      refs.glossary = path;
    } else if (type.includes("/hyperlink")) {
      refs.hyperlinks.set(id, target);
    }
  }

  // Per-part binary-part relationships (images, media, OLE embeddings). Each
  // part carries its own .rels with independent rId numbering (document rId1 ≠
  // header rId1), so collect them keyed by part path; drawings and w:object
  // runs inside a part resolve their binaries through its own rels. Covers
  // document, headers, footers, footnotes, endnotes, comments.
  for (const relsPath of doc.keys("word/_rels/")) {
    if (!relsPath.endsWith(".rels")) continue;
    const relsEl = doc.get(relsPath);
    if (!relsEl) continue;
    const partPath = "word/" + relsPath.slice("word/_rels/".length, -".rels".length);
    for (const rel of relsEl.elements ?? []) {
      if (rel.name !== "Relationship") continue;
      const type = attr(rel, "Type") ?? "";
      const id = attr(rel, "Id") ?? "";
      const target = attr(rel, "Target") ?? "";
      if (!id || !target) continue;
      const isBinaryPart =
        type.includes("/image") ||
        type.includes("/media") ||
        type.includes("/oleObject") ||
        // /package = embedded OPC workbook (xlsx/xlsb behind OLE objects)
        type.includes("/package");
      if (isBinaryPart) {
        // External image links (a:blip @r:link) keep the raw URL target —
        // path resolution would splice the URL into the part directory.
        if (attr(rel, "TargetMode") === "External") {
          let extMap = refs.partExternalImages.get(partPath);
          if (!extMap) {
            extMap = new Map();
            refs.partExternalImages.set(partPath, extMap);
          }
          extMap.set(id, target);
          continue;
        }
        let partMap = refs.partMedia.get(partPath);
        if (!partMap) {
          partMap = new Map();
          refs.partMedia.set(partPath, partMap);
        }
        partMap.set(id, resolveRelationshipTarget(partPath, target));
        if (type.includes("/oleObject") || type.includes("/package")) {
          let typeMap = refs.partEmbeddingTypes.get(partPath);
          if (!typeMap) {
            typeMap = new Map();
            refs.partEmbeddingTypes.set(partPath, typeMap);
          }
          typeMap.set(id, type.includes("/package") ? "package" : "oleObject");
        }
      } else if (type.includes("/hyperlink")) {
        // External URL — keep the raw target (no path resolution).
        let partMap = refs.partHyperlinks.get(partPath);
        if (!partMap) {
          partMap = new Map();
          refs.partHyperlinks.set(partPath, partMap);
        }
        partMap.set(id, target);
      } else if (type.endsWith("/txbx")) {
        let partMap = refs.partTextBoxes.get(partPath);
        if (!partMap) {
          partMap = new Map();
          refs.partTextBoxes.set(partPath, partMap);
        }
        partMap.set(id, resolveRelationshipTarget(partPath, target));
      }
    }
  }

  return refs;
}

function parseRootRels(doc: ParsedArchive): {
  coreProps?: string;
  appProps?: string;
  customProps?: string;
} {
  const relsEl = doc.get("_rels/.rels");
  if (!relsEl) return {};

  let coreProps: string | undefined;
  let appProps: string | undefined;
  let customProps: string | undefined;

  for (const child of relsEl.elements ?? []) {
    if (child.name !== "Relationship") continue;
    const type = attr(child, "Type") ?? "";
    const target = attr(child, "Target") ?? "";
    if (!target) continue;

    const path = target.startsWith("/") ? target.slice(1) : target;

    // Transitional packages use the oclc URI form with camelCase segments
    // (…/extendedProperties); normalize case and hyphens so both resolve.
    const relType = type.toLowerCase().replaceAll("-", "");
    if (relType.includes("/coreproperties")) {
      coreProps = path;
    } else if (relType.includes("/extendedproperties")) {
      appProps = path;
    } else if (relType.includes("/customproperties")) {
      customProps = path;
    }
  }

  return { coreProps, appProps, customProps };
}

/**
 * Parse a .docx file and convert it into DocumentOptions.
 *
 * This is the main public API for parsing DOCX files. Async so that `Blob`
 * (including `File`) and `ReadableStream` inputs are accepted alongside raw
 * bytes — parts are indexed and decompressed on demand.
 * The returned options can be passed directly to `new Document(parsed)`
 * to recreate the document.
 *
 * @param data - .docx file content — raw bytes, base64 string, Blob, or ReadableStream
 * @returns Document options including sections and metadata
 */
export async function parseDocument(data: DataType): Promise<DocumentOptions> {
  return parseDocumentFromBytes(await toUint8ArrayAsync(data));
}

/**
 * Synchronous counterpart of {@link parseDocument}: same result, but `Blob`
 * and `ReadableStream` inputs throw (normalize them to bytes first, or use
 * the async entry).
 */
export function parseDocumentSync(data: DataType): DocumentOptions {
  return parseDocumentFromBytes(toUint8Array(data));
}

function parseDocumentFromBytes(uint8: Uint8Array): DocumentOptions {
  // Encrypted package (OLE2/CFB container): the plaintext needs the password,
  // so carry the source bytes verbatim for generate() to re-emit.
  if (isEncryptedContainer(uint8)) {
    return { sections: [], encrypted: { data: uint8 } };
  }

  const docx = parseDocx(uint8);
  const ctx = new DocxReadContext(
    docx,
    buildStyleCache(docx.styles),
    buildNumberingCache(docx.numbering),
    buildNumIdCache(docx.numbering),
  );

  // Register the child parser for table and body child descriptors
  setTableParseChild(parseSectionChild);
  setBodyParseChild(parseSectionChild);
  setNotesParseChild(parseSectionChild);

  const sections = parseBody(docx.body, ctx);

  const opts: Partial<DocumentOptions> = { sections };

  // Document conformance class (w:document/@w:conformance)
  const conformance = attr(docx.documentRoot, "w:conformance");
  if (conformance === "strict" || conformance === "transitional") opts.conformance = conformance;

  // Background (w:background in document.xml)
  if (docx.background) {
    const hasChildren = (docx.background.elements ?? []).some((e) => e.type === "element");
    if (hasChildren) {
      // VML/structured background (e.g. v:background/v:fill pattern with a
      // texture image) that doesn't fit the color/theme model: carry the
      // element verbatim, rewriting relationship refs to {fileName} placeholders
      // so the media round-trips via the compiler's placeholder pass.
      const { rawXml, rawMedia } = replaceRelsWithPlaceholders(
        stringifyElement(docx.background),
        ctx,
      );
      opts.background = rawMedia.length > 0 ? { rawXml, rawMedia } : { rawXml };
    } else {
      const bg: NonNullable<DocumentOptions["background"]> = {};
      const color = attr(docx.background, "w:color");
      if (color) bg.color = color;
      const themeColor = attr(docx.background, "w:themeColor");
      if (themeColor) bg.themeColor = themeColor as ThemeColor;
      const themeShade = attr(docx.background, "w:themeShade");
      if (themeShade) bg.themeShade = themeShade;
      const themeTint = attr(docx.background, "w:themeTint");
      if (themeTint) bg.themeTint = themeTint;
      if (Object.keys(bg).length > 0) opts.background = bg;
    }
  }

  // Core properties
  if (docx.coreProps) {
    const corePropsEl = docx.doc.get(docx.coreProps);
    if (corePropsEl) {
      const cp = corePropertiesDesc.parse(corePropsEl, ctx);
      // Empty strings are meaningful (element present, text empty) — assign
      // the whole shape so they survive round-trip.
      Object.assign(opts, cp);
    }
  }

  // App (extended) properties
  if (docx.appProps) {
    const appPropsEl = docx.doc.get(docx.appProps);
    if (appPropsEl) {
      const ap = appPropertiesDesc.parse(appPropsEl, ctx);
      if (Object.keys(ap).length > 0) opts.appProperties = ap;
    }
  }

  // Settings — parse produces a structured SettingsOptions aligned with
  // generate (no verbatim rawXml fallback). Assign wholesale so context.ts
  // spreads it into _settingsOptions for the descriptor's stringify input.
  if (docx.settings) {
    opts.settings = settingsDesc.parse(docx.settings, ctx);
    // Bridge w:attachedTemplate's r:id to its target URL through the settings
    // part's own rels — the Options field carries the URL (the rId never
    // survives regeneration; the compiler assigns a fresh one).
    const rid = opts.settings.attachedTemplate;
    if (rid) {
      const relsEl = docx.doc.get("word/_rels/settings.xml.rels");
      const rel = relsEl?.elements?.find((e) => e.name === "Relationship" && attr(e, "Id") === rid);
      const target = rel ? attr(rel, "Target") : undefined;
      if (target) opts.settings.attachedTemplate = target;
      else delete opts.settings.attachedTemplate;
    }
  }

  // Web settings — preserve the part on round-trip even when it has no
  // children. Dropping it leaves an orphaned Override in the passthrough
  // [Content_Types].xml (the part is gone but its Override remains), which is
  // an OPC violation; keeping presence keeps part + rel + Override in sync.
  if (docx.webSettings) {
    opts.webSettings = webSettingsDesc.parse(docx.webSettings, ctx);
  }

  // Custom properties — presence-based: an empty docProps/custom.xml
  // round-trips as an empty part instead of being dropped.
  if (docx.customProps) {
    const customPropsEl = docx.doc.get(docx.customProps);
    if (customPropsEl) {
      const cpResult = customPropertiesDesc.parse(customPropsEl, ctx);
      opts.customProperties = cpResult.properties ?? [];
    }
  }

  // Comments content
  if (docx.partRefs.comments) {
    const commentsEl = docx.doc.get(docx.partRefs.comments);
    if (commentsEl) {
      const commentsResult = ctx.withPart(docx.partRefs.comments, () =>
        commentsDesc.parse(commentsEl, ctx),
      );
      if (commentsResult.length > 0) {
        opts.comments = commentsResult;
      }
    }
  }

  // Word 2013+ comment infrastructure
  if (docx.partRefs.people) {
    const peopleEl = docx.doc.get(docx.partRefs.people);
    if (peopleEl) {
      const people = peopleDesc.parse(peopleEl, ctx);
      if (people.length > 0) opts.people = people;
    }
  }
  if (docx.partRefs.commentsExtended) {
    const commentsExEl = docx.doc.get(docx.partRefs.commentsExtended);
    if (commentsExEl) {
      const extended = commentsExtendedDesc.parse(commentsExEl, ctx);
      if (extended.length > 0) opts.commentsExtended = extended;
    }
  }

  // Footnotes content
  if (docx.partRefs.footnotes) {
    const footnotesEl = docx.doc.get(docx.partRefs.footnotes);
    if (footnotesEl) {
      const fnResult = ctx.withPart(docx.partRefs.footnotes, () =>
        footnotesDesc.parse(footnotesEl, ctx),
      );
      const footnotes: NonNullable<DocumentOptions["footnotes"]> = [];
      for (const [id, paragraphs] of fnResult.notes) {
        footnotes.push({ id, children: paragraphs });
      }
      if (footnotes.length > 0) opts.footnotes = footnotes;
      // Preserve the parsed separator state so the generated ids stay consistent
      // with settings.footnoteProperties (which references them). null marks a
      // part that carried no such system note — stringify must not fall back to
      // the spec default (the source part stays without it).
      opts.footnoteSeparators = {
        separator: fnResult.separator ?? null,
        continuationSeparator: fnResult.continuationSeparator ?? null,
      };
      if (fnResult.continuationNotice) {
        opts.footnoteSeparators.continuationNotice = fnResult.continuationNotice;
      }
    }
  }

  // Endnotes content
  if (docx.partRefs.endnotes) {
    const endnotesEl = docx.doc.get(docx.partRefs.endnotes);
    if (endnotesEl) {
      const enResult = ctx.withPart(docx.partRefs.endnotes, () =>
        endnotesDesc.parse(endnotesEl, ctx),
      );
      const endnotes: NonNullable<DocumentOptions["endnotes"]> = [];
      for (const [id, paragraphs] of enResult.notes) {
        endnotes.push({ id, children: paragraphs });
      }
      if (endnotes.length > 0) opts.endnotes = endnotes;
      // Same null-for-absence contract as the footnote separators.
      opts.endnoteSeparators = {
        separator: enResult.separator ?? null,
        continuationSeparator: enResult.continuationSeparator ?? null,
      };
      if (enResult.continuationNotice) {
        opts.endnoteSeparators.continuationNotice = enResult.continuationNotice;
      }
    }
  }

  // Styles definitions
  if (docx.styles) {
    const styleOpts = parseStyleDefinitions(docx.styles, parseParagraphProperties, ctx);
    if (styleOpts) opts.styles = styleOpts;
  }

  // Numbering definitions
  if (docx.numbering) {
    // withPart so picture bullets resolve their imagedata r:id against
    // numbering.xml's own rels, not the document's.
    // An existing part always yields options — even an empty shell must
    // round-trip as-is instead of falling back to the fresh default list.
    const numOpts = ctx.withPart("word/numbering.xml", () =>
      parseNumberingDefinitions(docx.numbering!, parseParagraphProperties, ctx),
    );
    opts.numbering = numOpts ?? { abstractNumberings: [] };
  }

  // Font table
  if (docx.fontTable) {
    const ftResult = fontTableDesc.parse(docx.fontTable, ctx);
    if (ftResult.fonts && ftResult.fonts.length > 0) {
      resolveEmbeddedFontData(ftResult.fonts, docx.doc);
      // embedRid is a resolve-time lookup key — the FontWrapper reassigns it
      // on generate, so it must not leak into the public options JSON.
      opts.fonts = ftResult.fonts.map(({ embedRid: _embedRid, ...font }) => font);
    }
  }

  // Bibliography
  if (docx.partRefs.bibliography) {
    const bibEl = docx.doc.get(docx.partRefs.bibliography);
    if (bibEl) {
      const bibResult = bibliographyDesc.parse(bibEl, ctx);
      if (bibResult.sources && bibResult.sources.length > 0) opts.bibliography = bibResult;
    }
  }

  // Glossary document
  if (docx.partRefs.glossary) {
    const glossaryEl = docx.doc.get(docx.partRefs.glossary);
    if (glossaryEl) {
      const glossaryResult = ctx.withPart(docx.partRefs.glossary, () =>
        glossaryDesc.parse(glossaryEl, ctx),
      );
      if (glossaryResult.parts && glossaryResult.parts.length > 0) opts.glossary = glossaryResult;
    }
  }

  // Content types
  if (docx.contentTypes) {
    const ctResult = contentTypesDesc.parse(docx.contentTypes, ctx);
    if (ctResult) opts.contentTypes = ctResult;
  }

  // Raw passthrough: parts generate() doesn't rebuild (word/theme/*, customXml/*,
  // Package-wide passthrough (SDK ExtendedPart analogue): every part the
  // model did NOT absorb is carried verbatim instead of dropped. The list
  // below names the parts whose XML content the compiler rebuilds from the
  // model — their .rels must be rebuilt together (a passthrough .rels would
  // carry source rIds that no longer match the renumbered content).
  // Media/embeddings/fonts are deliberately NOT listed: the compiler writes
  // them under pinned source paths and its output wins over the passthrough
  // copy by assembly order, while anything the model missed survives here.
  const rebuilt: string[] = ["word/document.xml", "word/_rels/document.xml.rels"];
  if (docx.coreProps) rebuilt.push(docx.coreProps);
  if (docx.appProps) rebuilt.push(docx.appProps);
  if (docx.customProps) rebuilt.push(docx.customProps);
  if (docx.settings) rebuilt.push("word/settings.xml");
  if (docx.styles) rebuilt.push("word/styles.xml");
  if (docx.numbering) rebuilt.push("word/numbering.xml");
  if (docx.fontTable) rebuilt.push("word/fontTable.xml");
  if (docx.webSettings) rebuilt.push("word/webSettings.xml");
  for (const section of opts.sections ?? []) {
    for (const slot of Object.values(section.headers?.partNames ?? {})) {
      if (!slot) continue;
      rebuilt.push(`word/${slot}`);
      rebuilt.push(`word/_rels/${slot}.rels`);
    }
    for (const slot of Object.values(section.footers?.partNames ?? {})) {
      if (!slot) continue;
      rebuilt.push(`word/${slot}`);
      rebuilt.push(`word/_rels/${slot}.rels`);
    }
  }
  if (opts.comments) {
    rebuilt.push(docx.partRefs.comments!, "word/_rels/comments.xml.rels");
  }
  if (opts.people) rebuilt.push(docx.partRefs.people!);
  if (opts.commentsExtended) rebuilt.push(docx.partRefs.commentsExtended!);
  if (opts.footnotes) {
    rebuilt.push(docx.partRefs.footnotes!, "word/_rels/footnotes.xml.rels");
  }
  if (opts.endnotes) {
    rebuilt.push(docx.partRefs.endnotes!, "word/_rels/endnotes.xml.rels");
  }
  if (opts.bibliography) rebuilt.push(docx.partRefs.bibliography!);
  if (opts.glossary) rebuilt.push(docx.partRefs.glossary!);
  // Charts/diagrams/afChunks/subDocs are model-driven (emitted only when the
  // model carries them) — not listed: they pass through and the compiler's
  // output at the same path wins by assembly order.
  const { parts: passthroughParts, relationships: passthroughRels } = collectPassthroughParts(
    docx.doc,
    rebuilt,
  );
  if (passthroughParts.length > 0) opts.rawParts = passthroughParts;
  if (passthroughRels.length > 0) opts.passthroughRelationships = passthroughRels;

  return opts as DocumentOptions;
}

export function parseDocx(data: DataType): DocxDocument {
  const uint8 = toUint8Array(data);
  const doc = parseArchive(uint8);

  const documentEl = doc.get("word/document.xml");
  if (!documentEl) throw new Error("word/document.xml not found");
  const body = documentEl.elements?.find((e) => e.name === "w:body");
  if (!body) throw new Error("w:body not found in word/document.xml");
  const background = documentEl.elements?.find((e) => e.name === "w:background");

  const styles = doc.get("word/styles.xml");
  const numbering = doc.get("word/numbering.xml");
  const settings = doc.get("word/settings.xml");
  const fontTable = doc.get("word/fontTable.xml");
  const webSettings = doc.get("word/webSettings.xml");

  const partRefs = parseDocPartRefs(doc);
  const { coreProps, appProps, customProps } = parseRootRels(doc);

  const contentTypes = doc.get("[Content_Types].xml");

  return {
    doc,
    documentRoot: documentEl,
    body,
    background,
    styles,
    numbering,
    settings,
    fontTable,
    webSettings,
    partRefs,
    coreProps,
    appProps,
    customProps,
    contentTypes,
  };
}
