/**
 * DOCX compilation context.
 *
 * DocxWriteContext holds all mutable state needed during document compilation.
 * generateDocument() creates a DocxWriteContext internally.
 *
 * @module
 */

import {
  RELATIONSHIP_TYPES,
  Relationships,
  buildRootRelationships,
  type RelationshipType,
} from "@office-open/core";
import { ChartCollection } from "@office-open/core/chart";
import type { HyperlinkTarget, ReadContext, WriteContext } from "@office-open/core/descriptor";
import { SmartArtCollection } from "@office-open/core/smartart";
import type { Element } from "@office-open/xml";
import { AltChunkCollection } from "@parts/alt-chunk/alt-chunk-collection";
import type { DocumentOptions } from "@parts/core-properties";
import type { SectionPropertiesDescriptorOptions } from "@parts/document/body/section-properties/descriptor";
import type { EndnoteSeparator } from "@parts/endnotes/descriptor";
import { FontWrapper } from "@parts/fonts/font-wrapper";
import type { FootnoteSeparator } from "@parts/footnotes/descriptor";
import type { GlossaryDocumentOptions } from "@parts/glossary-document";
import type { HeaderFooterEntry } from "@parts/header-footer";
import type { NoteChild } from "@parts/notes/shared";
import { Numbering } from "@parts/numbering";
import type { CommentOptions } from "@parts/paragraph/run/comment-run";
import type { SettingsOptions } from "@parts/settings/settings";
import { Styles, extractStyleId } from "@parts/styles";
import { ExternalStylesFactory } from "@parts/styles/external-styles-factory";
import { DefaultStylesFactory, stringifyDocDefaults } from "@parts/styles/factory";
import { SubDocCollection } from "@parts/sub-doc/sub-doc-collection";
import type { WebSettingsOptions } from "@parts/web-settings";
import { EmbeddingCollection } from "@shared/embeddings/embeddings";
import { Media } from "@shared/media";
import type { MediaData } from "@shared/media/data";
import type { SectionOptions } from "@shared/section";
import type { SectionChild } from "@shared/section";

import type { DocxDocument } from "./parse";

/** User styles override factory defaults with the same styleId; keep the rest. */
function mergeById<T extends { id: string }>(
  factoryStyles: T[] | undefined,
  userStyles: T[] | undefined,
): T[] {
  const factory = factoryStyles ?? [];
  if (!userStyles || userStyles.length === 0) return factory;
  const userIds = new Set(userStyles.map((s) => s.id));
  return [...factory.filter((s) => !userIds.has(s.id)), ...userStyles];
}

/**
 * Highest comment id in an explicit comments list, or -1 when there are none.
 * Seeds the comment id allocator so auto-allocated ids never collide with ids
 * the caller already assigned (e.g. round-tripped from an existing document).
 */
function maxCommentId(comments: readonly CommentOptions[] | undefined): number {
  let max = -1;
  if (comments) {
    for (const c of comments) {
      if (c.id > max) max = c.id;
    }
  }
  return max;
}

/** Narrows an object to a `{ id: number }` marker without an `as` cast. */
function isNumericIdMarker(value: unknown): value is { id: number } {
  return (
    typeof value === "object" && value !== null && "id" in value && typeof value.id === "number"
  );
}

/**
 * Single preflight scan of the full Options tree. Collects everything that
 * must be known before stringify starts: the max explicit markup ids (seeding
 * the `{ bookmark }` / `{ moveFrom }` / `{ moveTo }` sugar allocators so they
 * never collide with caller-assigned ids) and whether any `{ comment }` sugar
 * appears — the document→comments relationship must exist whenever
 * comments.xml will be generated, and sugar entries are only registered
 * during stringify, after the constructor wires relationships. Every
 * `{ comment }` always stringifies, so the prediction matches the entries
 * actually registered.
 */
interface DocumentTreeScan {
  maxRangeId: number;
  maxMoveRunId: number;
  hasCommentSugar: boolean;
}

function scanDocumentTree(value: unknown, acc: DocumentTreeScan): void {
  if (value === null || value === undefined || typeof value !== "object") return;
  if (value instanceof Uint8Array || value instanceof Date) return;
  if (Array.isArray(value)) {
    for (const item of value) scanDocumentTree(item, acc);
    return;
  }
  const obj = value as Record<string, unknown>;
  const rangeMarker = obj.bookmarkStart ?? obj.moveFromRangeStart ?? obj.moveToRangeStart;
  if (isNumericIdMarker(rangeMarker) && rangeMarker.id > acc.maxRangeId)
    acc.maxRangeId = rangeMarker.id;
  const moveRun = obj.movedFrom ?? obj.movedTo;
  if (isNumericIdMarker(moveRun) && moveRun.id > acc.maxMoveRunId) acc.maxMoveRunId = moveRun.id;
  if (typeof obj.comment === "object" && obj.comment !== null) acc.hasCommentSugar = true;
  // for...in walks own enumerable keys without allocating a keys array (options
  // trees are JSON literals / class instances whose methods are non-enumerable).
  for (const key in obj) scanDocumentTree(obj[key], acc);
}

/** Interface for document view wrappers — provides relationships access. */
export interface ViewWrapper {
  relationships: Relationships;
  /** Package path of the part owning these relationships. */
  partName?: string;
}

// ── BodyContext ──

/**
 * Context for body-level stringification.
 *
 * Pure JSON pipeline context — extends WriteContext for descriptor compatibility.
 * No dependency on XmlComponent Context (compile/ uses zero toXml calls).
 */
export interface BodyContext extends WriteContext {
  /** The root write context with all mutable document state. */
  fileData: DocxWriteContext;
  /** Alias for fileData — some descriptor internals access context.file. */
  file: DocxWriteContext;
  /** Current part wrapper for relationship access and relative targets. */
  viewWrapper: ViewWrapper;
  /**
   * Stringify a body-level child element — injected to break circular imports.
   * Bound to its owning context via closure at injection time, so callers pass
   * only the child.
   */
  stringifyChild: (child: SectionChild) => string;
}

// ── DocxWriteContext ──

export class DocxWriteContext implements WriteContext {
  // --- Accessed by XmlComponent via context.file.* during toXml() ---
  declare public document: ViewWrapper;
  declare public numbering: Numbering;
  declare public media: Media<MediaData>;
  declare public charts: ChartCollection;
  declare public smartArts: SmartArtCollection;
  declare public embeddings: EmbeddingCollection;
  declare public altChunks: AltChunkCollection;
  declare public subDocs: SubDocCollection;
  declare public comments: {
    relationships: Relationships;
    /** Comment entries registered by `{ comment }` sugar children during stringify. */
    entries: CommentOptions[];
    /** Next auto-allocated comment id (seeded above any explicit comment id). */
    nextId: number;
  };
  declare public markupIds: {
    /** Next id for bookmark + move-range markers (CT_MarkupRange) — shared, like Word. */
    rangeNext: number;
    /** Next id for movedFrom/movedTo runs (CT_TrackChange). */
    moveRunNext: number;
  };
  declare public footNotes: {
    relationships: Relationships;
    notes: Map<number, NoteChild[]>;
    separator?: FootnoteSeparator | null;
    continuationSeparator?: FootnoteSeparator | null;
    continuationNotice?: FootnoteSeparator;
  };
  declare public endnotes: {
    relationships: Relationships;
    notes: Map<number, NoteChild[]>;
    separator?: EndnoteSeparator | null;
    continuationSeparator?: EndnoteSeparator | null;
    continuationNotice?: EndnoteSeparator;
  };

  // --- Additional state used by the compiler ---
  declare public fileRelationships: Relationships;
  declare public _settingsOptions: SettingsOptions;
  declare public styles: Styles;
  declare public fontTable: FontWrapper;
  declare public glossaryOptions: GlossaryDocumentOptions | undefined;
  declare public webSettings: WebSettingsOptions | undefined;

  // --- Section properties (one per section, raw options for descriptor pipeline) ---
  // An entry is undefined when the source body carried no sectPr for that
  // section — emitting a synthesized one would not round-trip.
  private _sectionProperties: (SectionPropertiesDescriptorOptions | undefined)[] = [];
  public get sectionProperties(): readonly (SectionPropertiesDescriptorOptions | undefined)[] {
    return this._sectionProperties;
  }

  // Footnotes/endnotes are optional parts. Fresh compile always emits them
  // (Word ships a separators-only file); round-trip emits them only when the
  // source package declared the part — otherwise emitting the part + document
  // relationship without a [Content_Types] Override is an OPC violation that
  // makes Word reject the package as unreadable content.
  private readonly _hasFootnotes: boolean;
  private readonly _hasEndnotes: boolean;
  private readonly _hasNumbering: boolean;
  public get hasFootnotes(): boolean {
    return this._hasFootnotes;
  }
  public get hasEndnotes(): boolean {
    return this._hasEndnotes;
  }
  public get hasNumbering(): boolean {
    return this._hasNumbering;
  }

  // --- WriteContext interface (core descriptor pipeline) ---

  public addRelationship(type: string, target: string, mode?: string): string {
    return `rId${this.document.relationships.add(type as RelationshipType, target, mode as "External" | undefined)}`;
  }

  public addMedia(data: Uint8Array, type: string): string {
    const entry = this.media.addMedia(
      data,
      type,
      (fileName) =>
        ({
          data,
          fileName,
          type,
          transformation: { pixels: { x: 0, y: 0 }, emus: { x: 0, y: 0 } },
        }) as MediaData,
    );
    return `{${entry.fileName}}`;
  }

  public addHyperlink(_key: string, _target: HyperlinkTarget): void {
    // DrawingML text hyperlinks are not emitted by DOCX; text boxes use w:hyperlink.
  }

  // --- Internal tracking ---
  private _headers: HeaderFooterEntry[] = [];
  private _footers: HeaderFooterEntry[] = [];

  // --- Original input preserved for descriptor usage ---
  declare public _options: DocumentOptions;

  /** Preflight result: does the body tree carry any `{ comment }` sugar? */
  declare private _hasCommentSugar: boolean;

  constructor(options: DocumentOptions) {
    this._options = options;

    this.numbering = new Numbering(
      options.numbering ? options.numbering : { abstractNumberings: [] },
      // Fresh compile ships Word's default bullet list; a round-tripped
      // numbering part is emitted exactly as parsed (an empty shell included).
      !options.contentTypes,
    );

    this.comments = {
      relationships: new Relationships(),
      entries: [],
      nextId: maxCommentId(options.comments) + 1,
    };
    const scan: DocumentTreeScan = { maxRangeId: -1, maxMoveRunId: -1, hasCommentSugar: false };
    scanDocumentTree(options.sections, scan);
    this._hasCommentSugar = scan.hasCommentSugar;
    this.markupIds = {
      rangeNext: scan.maxRangeId + 1,
      moveRunNext: scan.maxMoveRunId + 1,
    };
    this.fileRelationships = buildRootRelationships(
      "word/document.xml",
      options.customProperties !== undefined,
      options.passthroughRelationships,
    );
    this.footNotes = { relationships: new Relationships(), notes: new Map() };
    this.endnotes = { relationships: new Relationships(), notes: new Map() };
    this.document = { relationships: new Relationships(), partName: "word/document.xml" };
    // Reserve every passthrough source id so parts the source didn't carry
    // (a fresh comment, header, …) allocate above the source id space instead
    // of taking an id a later source re-use (fontTable, theme, …) needs.
    this.document.relationships.reserveSourceRids(
      "word/document.xml",
      options.passthroughRelationships ?? [],
    );
    // Settings.xml content has a single entry point: `settings`. The
    // background fallback turns the display flag on when a background image
    // needs showing; an explicit settings value wins via the spread.
    this._settingsOptions = {
      displayBackgroundShape: options.background?.image ? true : undefined,
      ...options.settings,
    };

    this.media = new Media<MediaData>();
    this.charts = new ChartCollection();
    this.smartArts = new SmartArtCollection();
    this.embeddings = new EmbeddingCollection();
    this.altChunks = new AltChunkCollection();
    this.subDocs = new SubDocCollection();

    if (options.styles?.external !== undefined) {
      const externalStyles = new ExternalStylesFactory().newInstance(options.styles.external);
      const defaultStyles = new DefaultStylesFactory().newInstance(options.styles?.default ?? {});
      // External (user-provided full styles.xml) wins; factory builtins fill
      // any gaps. Drop factory builtins whose styleId the external XML already
      // defines (no duplicate styleId). docDefaults/latentStyles come from the
      // external XML — the factory's are not mixed in.
      const externalIds = new Set<string>();
      for (const s of externalStyles.importedStyles ?? []) {
        const id = extractStyleId(s);
        if (id) externalIds.add(id);
      }
      const notInExternal = <T extends { id: string }>(arr: T[] | undefined) =>
        (arr ?? []).filter((s) => !externalIds.has(s.id));
      this.styles = new Styles({
        importedStyles: externalStyles.importedStyles,
        initialAttributes: externalStyles.initialAttributes ?? defaultStyles.initialAttributes,
        paragraphStyles: notInExternal(defaultStyles.paragraphStyles),
        characterStyles: notInExternal(defaultStyles.characterStyles),
        tableStyles: notInExternal(defaultStyles.tableStyles),
        numberingStyles: notInExternal(defaultStyles.numberingStyles),
      });
    } else if (options.styles) {
      const s = options.styles;
      if (s.roundTripped) {
        // Round-trip origin (parseStyleDefinitions): structured default.document
        // wins so the visual editor can edit default run/paragraph properties
        // and have them take effect on generate. docDefaultsXml verbatim is only
        // a fallback for older parses without default.document or a completely
        // empty <w:docDefaults/>. No factory builtin rebuild — parsed builtins
        // already carry the source document's customizations.
        const f = new DefaultStylesFactory().newInstance({});
        const docDefaults =
          s.default?.document !== undefined
            ? stringifyDocDefaults(s.default.document, false)
            : (s.docDefaultsXml ?? f.importedStyles?.[0] ?? "");
        // A source without w:latentStyles stays without it — falling back to
        // the factory table would inject lsdException entries the source
        // never carried.
        const latentStyles = s.latentStylesXml ?? "";
        this.styles = new Styles({
          importedStyles: [docDefaults, latentStyles],
          initialAttributes: s.initialAttributes ?? f.initialAttributes,
          paragraphStyles: s.paragraphStyles,
          characterStyles: s.characterStyles,
          tableStyles: s.tableStyles,
          numberingStyles: s.numberingStyles,
        });
      } else {
        // Fresh generation: factory default builtins (structured) + user
        // overrides. User paragraphStyles/characterStyles/tableStyles/
        // numberingStyles override factory builtins with the same styleId.
        const f = new DefaultStylesFactory().newInstance(s.default);
        this.styles = new Styles({
          importedStyles: f.importedStyles,
          initialAttributes: s.initialAttributes ?? f.initialAttributes,
          paragraphStyles: mergeById(f.paragraphStyles, s.paragraphStyles),
          characterStyles: mergeById(f.characterStyles, s.characterStyles),
          tableStyles: mergeById(f.tableStyles, s.tableStyles),
          numberingStyles: mergeById(f.numberingStyles, s.numberingStyles),
        });
      }
    } else {
      const stylesFactory = new DefaultStylesFactory();
      this.styles = new Styles(stylesFactory.newInstance());
    }

    // Register numbering references from custom paragraph/character styles.
    // Style definitions may contain numbering properties whose concrete instances
    // are never created through the body paragraph processing path.
    if (options.styles?.paragraphStyles) {
      for (const style of options.styles.paragraphStyles) {
        const num = style.paragraph?.numbering;
        if (num && typeof num === "object" && "reference" in num) {
          this.numbering.createConcreteNumberingInstance(num.reference, num.instance ?? 0);
        }
      }
    }

    // Resolve footnote/endnote presence from the source [Content_Types]: a
    // round-tripped package only carries these parts when the source declared
    // them. Fresh compile (no contentTypes) always emits both.
    const sourceOverrides = options.contentTypes?.overrides ?? [];
    this._hasFootnotes =
      !options.contentTypes || sourceOverrides.some((o) => o.partName === "/word/footnotes.xml");
    this._hasEndnotes =
      !options.contentTypes || sourceOverrides.some((o) => o.partName === "/word/endnotes.xml");
    // Numbering follows the source [Content_Types] on round-trip — the part is
    // optional, and emitting it without a matching Override is an OPC violation.
    // Fresh compile always emits it (Word ships a default bullet list).
    this._hasNumbering =
      !options.contentTypes || sourceOverrides.some((o) => o.partName === "/word/numbering.xml");

    this.addDefaultRelationships();

    for (const section of options.sections) {
      this.addSection(section);
    }

    // Note ids: round-tripped entries carry theirs; fresh entries auto-assign
    // after the highest id seen (matching Word's sequential footnote ids).
    // Separators apply independently: a source file may keep the notes part
    // with only its separator entries after every user note was deleted.
    if (options.footnotes || options.footnoteSeparators) {
      let nextNoteId = 1;
      for (const note of options.footnotes ?? []) {
        const id = note.id ?? nextNoteId;
        nextNoteId = Math.max(nextNoteId, id + 1);
        this.footNotes.notes.set(id, note.children);
      }
      // A present separators object comes from parse — its missing members are
      // null (source carried none); an absent object is fresh (defaults apply).
      this.footNotes.separator = options.footnoteSeparators
        ? (options.footnoteSeparators.separator ?? null)
        : undefined;
      this.footNotes.continuationSeparator = options.footnoteSeparators
        ? (options.footnoteSeparators.continuationSeparator ?? null)
        : undefined;
      this.footNotes.continuationNotice = options.footnoteSeparators?.continuationNotice;
    }

    if (options.endnotes || options.endnoteSeparators) {
      let nextNoteId = 1;
      for (const note of options.endnotes ?? []) {
        const id = note.id ?? nextNoteId;
        nextNoteId = Math.max(nextNoteId, id + 1);
        this.endnotes.notes.set(id, note.children);
      }
      this.endnotes.separator = options.endnoteSeparators
        ? (options.endnoteSeparators.separator ?? null)
        : undefined;
      this.endnotes.continuationSeparator = options.endnoteSeparators
        ? (options.endnoteSeparators.continuationSeparator ?? null)
        : undefined;
      this.endnotes.continuationNotice = options.endnoteSeparators?.continuationNotice;
    }

    this.fontTable = new FontWrapper(options.fonts ?? []);
    this.glossaryOptions = options.glossary;
    this.webSettings = options.webSettings ?? undefined;

    if (options.glossary) {
      this.registerDocumentRel(RELATIONSHIP_TYPES.glossaryDocument, "glossary/document.xml");
    }

    if (this.webSettings) {
      this.registerDocumentRel(RELATIONSHIP_TYPES.webSettings, "webSettings.xml");
    }
  }

  get headers(): HeaderFooterEntry[] {
    return this._headers;
  }

  get footers(): HeaderFooterEntry[] {
    return this._footers;
  }

  // --- Private helpers ---

  private addSection({ headers = {}, footers = {}, properties }: SectionOptions): void {
    // A section with no properties and no header/footer references had no
    // sectPr in the source (Word writes one whenever any of these exist) —
    // keep it absent so the body round-trips.
    const hasRefs =
      headers.default !== undefined ||
      headers.even !== undefined ||
      headers.first !== undefined ||
      footers.default !== undefined ||
      footers.even !== undefined ||
      footers.first !== undefined;
    if (properties === undefined && !hasRefs) {
      this._sectionProperties.push(undefined);
      return;
    }
    const sectPrOptions: SectionPropertiesDescriptorOptions = {
      ...properties,
      footerReferences: {
        default: footers.default
          ? this.createFooter(footers.default, footers.partNames?.default)
          : undefined,
        even: footers.even ? this.createFooter(footers.even, footers.partNames?.even) : undefined,
        first: footers.first
          ? this.createFooter(footers.first, footers.partNames?.first)
          : undefined,
      },
      headerReferences: {
        default: headers.default
          ? this.createHeader(headers.default, headers.partNames?.default)
          : undefined,
        even: headers.even ? this.createHeader(headers.even, headers.partNames?.even) : undefined,
        first: headers.first
          ? this.createHeader(headers.first, headers.partNames?.first)
          : undefined,
      },
    };
    this._sectionProperties.push(sectPrOptions);
  }

  private createHeader(header: SectionChild[], partName?: string): HeaderFooterEntry {
    const referenceId = this.document.relationships.nextRelationshipId;
    const entry: HeaderFooterEntry = {
      children: header,
      relationships: new Relationships(),
      referenceId,
    };
    this.addHeaderToDocument(entry, partName);
    return entry;
  }

  private createFooter(footer: SectionChild[], partName?: string): HeaderFooterEntry {
    const referenceId = this.document.relationships.nextRelationshipId;
    const entry: HeaderFooterEntry = {
      children: footer,
      relationships: new Relationships(),
      referenceId,
    };
    this.addFooterToDocument(entry, partName);
    return entry;
  }

  private addHeaderToDocument(header: HeaderFooterEntry, partName?: string): void {
    this._headers.push(header);
    header.partName = this.nextPartName(this._headers, partName, "header");
    this.document.relationships.addRelationship(
      header.referenceId,
      RELATIONSHIP_TYPES.header,
      header.partName,
    );
  }

  private addFooterToDocument(footer: HeaderFooterEntry, partName?: string): void {
    this._footers.push(footer);
    footer.partName = this.nextPartName(this._footers, partName, "footer");
    this.document.relationships.addRelationship(
      footer.referenceId,
      RELATIONSHIP_TYPES.footer,
      footer.partName,
    );
  }

  /** Resolve the part file name: the round-tripped source name when given,
   *  else the next free <kind>N.xml slot (pinned names never collide). */
  private nextPartName(
    entries: HeaderFooterEntry[],
    partName: string | undefined,
    kind: "header" | "footer",
  ): string {
    if (partName) return partName;
    const used = new Set(
      entries.map((e) => e.partName).filter((n): n is string => n !== undefined),
    );
    let n = entries.length;
    let name = `${kind}${n}.xml`;
    while (used.has(name)) {
      n++;
      name = `${kind}${n}.xml`;
    }
    return name;
  }

  private addDefaultRelationships(): void {
    this.registerDocumentRel(RELATIONSHIP_TYPES.styles, "styles.xml");
    if (this._hasNumbering) {
      this.registerDocumentRel(RELATIONSHIP_TYPES.numbering, "numbering.xml");
    }
    if (this._hasFootnotes) {
      this.registerDocumentRel(RELATIONSHIP_TYPES.footnotes, "footnotes.xml");
    }
    if (this._hasEndnotes) {
      this.registerDocumentRel(RELATIONSHIP_TYPES.endnotes, "endnotes.xml");
    }
    this.registerDocumentRel(RELATIONSHIP_TYPES.settings, "settings.xml");
    // Comments is an optional part — only wire the document→comments relationship
    // when the document actually carries comments. Emitting it unconditionally
    // produces an orphan comments.xml that Word rejects as an OPC violation
    // (empty part with no [Content_Types] Override when content types are
    // passed through from the source on round-trip).
    if (this._options.comments?.length || this._hasCommentSugar) {
      this.registerDocumentRel(RELATIONSHIP_TYPES.comments, "comments.xml");
    }
    // Word 2013+ comment infrastructure — same conditional rule as comments:
    // emit the part and its relationship only when the document carries them.
    if (this._options.people?.length) {
      this.registerDocumentRel(RELATIONSHIP_TYPES.peopleMs, "people.xml");
    }
    if (this._options.commentsExtended?.length) {
      this.registerDocumentRel(RELATIONSHIP_TYPES.commentsExtendedMs, "commentsExtended.xml");
    }
    if (this._options.bibliography) {
      this.registerDocumentRel(RELATIONSHIP_TYPES.bibliography, "bibliography.xml");
    }

    // Theme — always present: fresh-compile generates a default theme, round-trip
    // passes the source theme through rawParts. Word needs the document→theme
    // relationship to resolve theme colors/fonts.
    const themeRel = (this._options.passthroughRelationships ?? []).find(
      (r) => r.source === "word/document.xml" && r.relationshipType.endsWith("/theme"),
    );
    this.registerDocumentRel(
      RELATIONSHIP_TYPES.theme,
      themeRel ? themeRel.target : "theme/theme1.xml",
    );
  }

  /**
   * Register a default document relationship. On round-trip, reuse the source
   * rId when the source captured the same kind+target — that keeps body XML
   * `r:id` references pointing at the same number after parse→generate, so
   * verbatim hyperlinks/altChunks/embedded objects stay valid. On fresh
   * compile (no passthrough rels) this allocates sequentially from 1.
   */
  private registerDocumentRel(type: RelationshipType, target: string): void {
    if (this.document.relationships.hasRelationship(type, target)) return;
    const preclaimed = (this._options.passthroughRelationships ?? []).find(
      (r) => r.source === "word/document.xml" && r.relationshipType === type && r.target === target,
    );
    const m = preclaimed ? /^rId(\d+)$/.exec(preclaimed.rId) : undefined;
    const id =
      m && !this.document.relationships.hasId(m[0])
        ? Number(m[1])
        : this.document.relationships.nextRelationshipId;
    this.document.relationships.addRelationship(id, type, target);
  }

  /**
   * Re-register source relationships whose targets remain opaque passthrough
   * parts. This runs after document stringification and compiler-owned drawing,
   * media, chart, and SmartArt wiring, so kind+target is a reliable ownership
   * test instead of guessing from conventional target-directory prefixes.
   */
  public addPassthroughDocumentRelationships(): void {
    for (const rel of this._options.passthroughRelationships ?? []) {
      if (rel.source !== "word/document.xml" || rel.relationshipType.endsWith("/theme")) continue;
      this.document.relationships.claimSourceRel(rel);
    }
  }
}

// ── DocxReadContext ──

/**
 * DOCX-specific read context.
 *
 * Holds references to the parsed DocxDocument and cached style/numbering data
 * used throughout the DOCX parsing pipeline. Implements ReadContext for
 * descriptor pipeline compatibility.
 */
export class DocxReadContext implements ReadContext {
  /**
   * Path of the part currently being parsed. Each part carries its own .rels
   * with independent rId numbering, so drawings inside a part must resolve
   * image relationships against that part's rels. Defaults to the document body.
   */
  public currentPart = "word/document.xml";

  constructor(
    public docx: DocxDocument,
    public styleCache: Map<string, Element>,
    public numberingCache: Map<string, Element>,
    /** numId → abstractNumId ("" when the w:num lacks the child). */
    public numIdCache: Map<string, string>,
  ) {}

  resolveRelationship(rId: string): string | undefined {
    const partMedia = this.docx.partRefs.partMedia.get(this.currentPart);
    if (partMedia) {
      const media = partMedia.get(rId);
      if (media) return media;
    }
    return (
      this.docx.partRefs.headers.get(rId) ??
      this.docx.partRefs.footers.get(rId) ??
      this.docx.partRefs.media.get(rId) ??
      this.docx.partRefs.charts.get(rId) ??
      this.docx.partRefs.diagramData.get(rId) ??
      this.docx.partRefs.afChunks.get(rId) ??
      this.docx.partRefs.subDocs.get(rId) ??
      this.docx.partRefs.hyperlinks.get(rId)
    );
  }

  /** Relationship kind of an OLE embedding rId in the current part
   *  ("oleObject" | "package"; undefined when unknown). */
  resolveEmbeddingType(rId: string): "oleObject" | "package" | undefined {
    return this.docx.partRefs.partEmbeddingTypes.get(this.currentPart)?.get(rId);
  }

  /** External image source URL of an a:blip @r:link rId in the current part. */
  resolveExternalImage(rId: string): string | undefined {
    return this.docx.partRefs.partExternalImages.get(this.currentPart)?.get(rId);
  }

  /**
   * Run `fn` with `currentPart` temporarily set to `partPath`, restoring the
   * previous value afterwards. Use when parsing a sub-document part (header,
   * footer, footnotes, …) so its drawings resolve images from its own rels.
   */
  withPart<T>(partPath: string, fn: () => T): T {
    const prev = this.currentPart;
    this.currentPart = partPath;
    try {
      return fn();
    } finally {
      this.currentPart = prev;
    }
  }

  getPart(path: string): Element | undefined {
    return this.docx.doc.get(path);
  }

  getRaw(path: string): Uint8Array | undefined {
    return this.docx.doc.getRaw(path);
  }
}
