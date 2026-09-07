/**
 * DOCX document compiler — pure function entry point.
 *
 * compileDocument() accepts DocumentOptions directly,
 * creates a DocxWriteContext internally, and produces a Zippable result.
 * All XML parts are produced via descriptors or serialize() —
 * no Formatter dependency.
 *
 * The part wiring runs in phases owned by the compile/ folder: the document
 * body and its rels (compile/document), the notes parts (compile/notes),
 * headers/footers (compile/headerfooter), and the chart/SmartArt tail
 * (compile/drawings), with the placeholder bridge and embedding rel
 * resolution they share in compile/shared. This module keeps the
 * part-mapping orchestration.
 *
 * @module
 */

import {
  RELATIONSHIP_TYPES,
  addModelBinaries,
  compileMapping,
  createThemeXml,
  dropDanglingPassthroughRels,
  DOCX_PARTS,
  finalizeContentTypes,
  findAndReplaceImagePlaceholders,
  optionalRelsPart,
  Relationships,
  TargetModeType,
  replaceNumberingPlaceholders,
  IMAGE_MEDIA_CONTENT_TYPES,
  resolverFromRegistry,
} from "@office-open/core";
import type { XmlifyedFile, Zippable } from "@office-open/core";
import type { DocumentOptions } from "@parts/core-properties";
import { obfuscate } from "@parts/fonts/obfuscate-ttf-to-odttf";

import { stringifyDocumentXml, stringifyBodyChild, type BodyContext } from "./body";
import { compileDocumentEntries } from "./compile/document";
import { compileChartParts, compileSmartArtParts } from "./compile/drawings";
import { compileHeaderFooterParts } from "./compile/headerfooter";
import { compileNotesParts } from "./compile/notes";
import { XML_DECL } from "./compile/shared";
import { DocxWriteContext } from "./context";
import {
  corePropertiesDesc,
  customPropertiesDesc,
  appPropertiesDesc,
  fontTableDesc,
  webSettingsDesc,
  bibliographyDesc,
  settingsDesc,
  glossaryDesc,
  peopleDesc,
  commentsExtendedDesc,
} from "./parts";

/** Reusable TextEncoder (stateless, safe to share). */
const encoder = new TextEncoder();

/** DOCX part path → content type, derived from the part registry. */
const DOCX_CONTENT_TYPE_RESOLVER = resolverFromRegistry(DOCX_PARTS);

/** Extension → MIME for media/font/embedding Default entries. Declared only
 * for extensions actually present in the package. */
const DOCX_MEDIA_CONTENT_TYPES: Record<string, string> = {
  ...IMAGE_MEDIA_CONTENT_TYPES,
  odttf: "application/vnd.openxmlformats-officedocument.obfuscatedFont",
  bin: "application/vnd.openxmlformats-officedocument.oleObject",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  xlsb: "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
};

/** Extended context for header/footer part stringification. */
type DocxContext = BodyContext;

/** Factory the compile phases use to derive a per-part stringify context. */
export type PartCtxFactory = (viewWrapper?: BodyContext["viewWrapper"]) => BodyContext;

// ── Public API ──

/**
 * Compile document options into a flat file map suitable for fflate zipSync.
 *
 * This is the primary entry point for DOCX generation — accepts DocumentOptions
 * directly.
 */
export function compileDocument(
  options: DocumentOptions,
  overrides: XmlifyedFile[] = [],
  mediaLevel: number = 0,
): Zippable {
  const ctx = new DocxWriteContext(options);
  const xmlifiedFileMapping = xmlifyContext(ctx);
  const files = compileMapping(xmlifiedFileMapping, overrides);

  // Media + OLE embedding binaries (word/media/*, word/embeddings/*)
  addModelBinaries(files, "word", ctx.media.array, ctx.embeddings.array, mediaLevel);

  // Font files — only fonts carrying binary data produce a .odttf part.
  // Round-tripped fonts (rawOdttf) keep their original obfuscated bytes.
  for (const font of ctx.fontTable.fontOptionsWithKey) {
    if (font.data === undefined) continue;
    const [nameWithoutExtension] = font.name.split(".");
    const filePath = font.odttfPath ?? `word/fonts/${nameWithoutExtension}.odttf`;
    files[filePath] = font.rawOdttf ? font.data : obfuscate(font.data, font.fontKey);
  }

  // [Content_Types].xml is serialized last: parts register their media/fonts
  // during stringify (run by xmlifyContext above), so deriving it now sees the
  // complete set. Building it inside xmlifyContext's object literal evaluated
  // it before header/footer/font media was registered, leaving jpg/gif/odttf
  // without a covering Default.
  files["[Content_Types].xml"] = encoder.encode(
    finalizeContentTypes(
      files,
      {
        resolve: DOCX_CONTENT_TYPE_RESOLVER,
        mediaContentTypes: DOCX_MEDIA_CONTENT_TYPES,
        source: ctx._options.contentTypes,
        rawParts: ctx._options.rawParts,
        overrides: [
          ...ctx.altChunks.array.map((ac) => ({
            path: `word/${ac.path}`,
            contentType: ac.contentType ?? "application/xhtml+xml",
          })),
          ...ctx.subDocs.array.map((sd) => ({
            path: `word/${sd.path}`,
            contentType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
          })),
        ],
      },
      ctx,
    ),
  );

  // Guard: drop passthrough rels whose target part never made it into the
  // package (hand-authored input) — Office refuses to open dangling rels.
  dropDanglingPassthroughRels(files, ctx._options.passthroughRelationships);

  return files;
}

// ── Internal ──

/**
 * Complete mapping of all XML files in an OOXML document package.
 */
interface XmlifyedFileMapping {
  Document: XmlifyedFile;
  Styles: XmlifyedFile;
  Properties: XmlifyedFile;
  Numbering?: XmlifyedFile;
  NumberingRelationships?: XmlifyedFile;
  Relationships: XmlifyedFile;
  FileRelationships: XmlifyedFile;
  Headers: XmlifyedFile[];
  Footers: XmlifyedFile[];
  HeaderRelationships: XmlifyedFile[];
  FooterRelationships: XmlifyedFile[];
  CustomProperties?: XmlifyedFile;
  AppProperties: XmlifyedFile;
  FootNotes?: XmlifyedFile;
  FootNotesRelationships?: XmlifyedFile;
  Endnotes?: XmlifyedFile;
  EndnotesRelationships?: XmlifyedFile;
  Settings: XmlifyedFile;
  Comments?: XmlifyedFile;
  CommentsRelationships?: XmlifyedFile;
  People?: XmlifyedFile;
  CommentsExtended?: XmlifyedFile;
  FontTable?: XmlifyedFile;
  FontTableRelationships?: XmlifyedFile;
  Bibliography?: XmlifyedFile;
  Charts?: XmlifyedFile[];
  DiagramData?: XmlifyedFile[];
  DiagramLayout?: XmlifyedFile[];
  DiagramStyle?: XmlifyedFile[];
  DiagramColors?: XmlifyedFile[];
  DiagramDrawing?: XmlifyedFile[];
  AltChunks?: XmlifyedFile[];
  SubDocs?: XmlifyedFile[];
  Glossary?: XmlifyedFile;
  WebSettings?: XmlifyedFile;
}

function xmlifyContext(ctx: DocxWriteContext): XmlifyedFileMapping {
  const mkCtx = (viewWrapper: DocxContext["viewWrapper"] = ctx.document): DocxContext => {
    const bodyCtx: DocxContext = {
      fileData: ctx,
      file: ctx,
      viewWrapper,
      addRelationship: (type: string, target: string, mode?: string) =>
        ctx.addRelationship(type, target, mode),
      addMedia: (data: Uint8Array, type: string) => ctx.addMedia(data, type),
      addHyperlink: (key, target) => ctx.addHyperlink(key, target),
      // Assigned after the literal: stringifyBodyChild needs this context, which
      // is only bound once the literal finishes initializing.
      stringifyChild: undefined as unknown as DocxContext["stringifyChild"],
    };
    bodyCtx.stringifyChild = (child) => stringifyBodyChild(child, bodyCtx);
    return bodyCtx;
  };

  const docCtx = mkCtx(ctx.document);
  const documentXmlData = XML_DECL + stringifyDocumentXml(ctx, docCtx);
  // Sampled after stringify: hyperlinks/altChunks registered during body
  // stringification take sequential ids here, and the media/embedding offsets
  // below must skip them (same ordering as the footnote part).
  const documentRelationshipCount = ctx.document.relationships.nextRelationshipId;

  // Phases owned by the compile/ folder, invoked in the order their parts
  // stringified before (document body → notes → headers/footers → the
  // document rels), so per-part media registration keeps its sequencing.
  const notesParts = compileNotesParts(ctx, mkCtx);
  const headerFooterParts = compileHeaderFooterParts(ctx, mkCtx);
  const documentEntries = compileDocumentEntries(ctx, documentXmlData, documentRelationshipCount);

  return {
    AppProperties: {
      data: XML_DECL + (appPropertiesDesc.stringify(ctx._options.appProperties ?? {}, ctx) ?? ""),
      path: "docProps/app.xml",
    },
    ...notesParts,
    // docProps/custom.xml — emitted only when custom properties exist (parsed
    // presence or fresh authoring); Word omits the part otherwise.
    ...(ctx._options.customProperties !== undefined
      ? {
          CustomProperties: {
            data:
              XML_DECL +
              (customPropertiesDesc.stringify({ properties: ctx._options.customProperties }, ctx) ??
                ""),
            path: "docProps/custom.xml",
          },
        }
      : {}),
    // Word 2013+ comment infrastructure — emitted only when populated, same
    // conditional rule as comments.xml (an empty part with a relationship is
    // an OPC violation Word rejects).
    ...(ctx._options.people?.length
      ? {
          People: {
            data: XML_DECL + (peopleDesc.stringify(ctx._options.people, ctx) ?? ""),
            path: "word/people.xml",
          },
        }
      : {}),
    ...(ctx._options.commentsExtended?.length
      ? {
          CommentsExtended: {
            data:
              XML_DECL + (commentsExtendedDesc.stringify(ctx._options.commentsExtended, ctx) ?? ""),
            path: "word/commentsExtended.xml",
          },
        }
      : {}),
    ...documentEntries,
    // Theme — fresh-compile emits a language-neutral default theme
    // (createThemeXml). Round-trip carries the source theme in rawParts,
    // already copied verbatim above, so skip emitting here to avoid a duplicate.
    ...(ctx._options.rawParts?.some((part) => part.path.startsWith("word/theme/"))
      ? {}
      : {
          Theme: {
            data: XML_DECL + createThemeXml(),
            path: "word/theme/theme1.xml",
          },
        }),
    FileRelationships: {
      data: XML_DECL + ctx.fileRelationships.serialize(),
      path: "_rels/.rels",
    },
    FontTable: {
      data:
        XML_DECL +
        (fontTableDesc.stringify({ fonts: ctx.fontTable.fontOptionsWithKey }, ctx) ?? ""),
      path: "word/fontTable.xml",
    },
    FontTableRelationships: optionalRelsPart(
      ctx.fontTable.relationships,
      XML_DECL,
      "word/_rels/fontTable.xml.rels",
    ),
    ...headerFooterParts,
    ...(ctx.hasNumbering
      ? (() => {
          // Picture-bullet media resolves through numbering.xml's own rels —
          // same placeholder bridge as headers/footers, ids local to the part
          // (numbering.xml carries no other relationships).
          const numberingXml = ctx.numbering.serialize(ctx);
          const numberingMedia = findAndReplaceImagePlaceholders(numberingXml, ctx.media.array, 1);
          const numberingRels = new Relationships();
          for (const [i, ref] of numberingMedia.referenced.entries()) {
            numberingRels.addRelationship(1 + i, RELATIONSHIP_TYPES.image, `media/${ref.fileName}`);
          }
          return {
            Numbering: { data: numberingMedia.xml, path: "word/numbering.xml" },
            NumberingRelationships: optionalRelsPart(
              numberingRels,
              XML_DECL,
              "word/_rels/numbering.xml.rels",
            ),
          };
        })()
      : {}),
    Properties: {
      data: XML_DECL + (corePropertiesDesc.stringify(ctx._options, ctx) ?? ""),
      path: "docProps/core.xml",
    },
    Settings: {
      data: XML_DECL + (settingsDesc.stringify(ctx._settingsOptions, ctx) ?? ""),
      path: "word/settings.xml",
    },
    ...(ctx._settingsOptions.attachedTemplate !== undefined
      ? (() => {
          const rels = new Relationships();
          rels.addRelationship(
            1,
            RELATIONSHIP_TYPES.attachedTemplate,
            ctx._settingsOptions.attachedTemplate,
            TargetModeType.EXTERNAL,
          );
          return {
            SettingsRelationships: {
              data: XML_DECL + rels.serialize(),
              path: "word/_rels/settings.xml.rels",
            },
          };
        })()
      : {}),
    Styles: {
      data: (() => {
        const xmlStyles = ctx.styles.serialize();
        return replaceNumberingPlaceholders(xmlStyles, ctx.numbering.concreteNumbering);
      })(),
      path: "word/styles.xml",
    },
    ...(ctx._options.bibliography
      ? {
          Bibliography: {
            data: XML_DECL + (bibliographyDesc.stringify(ctx._options.bibliography, ctx) ?? ""),
            path: "word/bibliography.xml",
          },
        }
      : {}),
    ...compileChartParts(ctx),
    ...compileSmartArtParts(ctx),
    ...(ctx.altChunks.array.length > 0
      ? {
          AltChunks: ctx.altChunks.array.map((altChunkData) => ({
            data: altChunkData.data,
            path: `word/${altChunkData.path}`,
          })),
        }
      : {}),
    ...(ctx.subDocs.array.length > 0
      ? {
          SubDocs: ctx.subDocs.array.map((subDocData) => ({
            data: subDocData.data,
            path: `word/${subDocData.path}`,
          })),
        }
      : {}),
    ...(ctx.glossaryOptions
      ? {
          Glossary: {
            data: (() => {
              const glossaryCtx = mkCtx(undefined);
              return XML_DECL + (glossaryDesc.stringify(ctx.glossaryOptions!, glossaryCtx) ?? "");
            })(),
            path: "word/glossary/document.xml",
          },
        }
      : {}),
    ...(ctx.webSettings
      ? {
          WebSettings: {
            data: XML_DECL + (webSettingsDesc.stringify(ctx._options.webSettings ?? {}, ctx) ?? ""),
            path: "word/webSettings.xml",
          },
        }
      : {}),
  };
}
