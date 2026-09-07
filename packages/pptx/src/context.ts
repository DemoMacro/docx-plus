/**
 * PPTX write context — collects resources during descriptor-driven serialization.
 *
 * @module
 */

import { EmbeddingCollection, Media } from "@office-open/core";
import type { BaseMediaEntry, EmbeddingData } from "@office-open/core";
import type { HyperlinkTarget, ReadContext, WriteContext } from "@office-open/core/descriptor";
import type {
  ColorDefinitionOptions,
  LayoutDefinitionOptions,
  StyleDefinitionOptions,
} from "@office-open/core/smartart";

import type { PptxDocument } from "./parse";

// ── Parse context (moved from parse/context.ts) ──

/**
 * Parse context for PPTX documents.
 */
export class ParseContext {
  constructor(
    public pptx: PptxDocument,
    /** Slide relationship ID → path, parsed from slide's _rels file */
    public slideRels: Map<string, string>,
  ) {}
}

// ── Resource entries ──

export interface MediaEntry extends BaseMediaEntry {
  key: string;
}

export interface ChartEntry {
  key: string;
  chartSpaceXml: string;
  /** User-shapes part behind c:userShapes (body + the chart's own rels id). */
  userShapes?: {
    relationshipId: string;
    xml: string;
  };
}

export interface SmartArtEntry {
  key: string;
  dataModelXml: string;
  /** Built-in layout id or a full custom layout definition. */
  layout: string | LayoutDefinitionOptions;
  /** Built-in quick-style id or a full custom style definition. */
  style: string | StyleDefinitionOptions;
  /** Built-in color-transform id or a full custom color definition. */
  color: string | ColorDefinitionOptions;
}

export interface HyperlinkEntry {
  key: string;
  url?: string;
  slide?: number;
  tooltip?: string;
}

/** An externally linked image source (a:blip @r:link, TargetMode="External"). */
export interface ImageLinkEntry {
  key: string;
  url: string;
}

/** An externally linked OLE object source (p:oleObj @r:id, TargetMode="External"). */
export interface OleLinkEntry {
  key: string;
  url: string;
}

// ── Context ──

/**
 * PPTX-specific write context.
 *
 * Extends the core {@link WriteContext} with media, chart, SmartArt,
 * and hyperlink registration methods. Custom descriptors cast the
 * generic `WriteContext` to this type to access PPTX-specific features.
 */
export class PptxWriteContext implements WriteContext {
  private _media = new Media<MediaEntry>();
  private _embeddings = new EmbeddingCollection();
  private _charts = new Map<string, ChartEntry>();
  private _smartArts = new Map<string, SmartArtEntry>();
  private _hyperlinks = new Map<string, HyperlinkEntry>();
  private _imageLinks = new Map<string, ImageLinkEntry>();
  /** url → key side index so registration dedup is O(1), not a scan. */
  private _imageLinkKeys = new Map<string, string>();
  private _nextImageLinkId = 1;
  private _oleLinks = new Map<string, OleLinkEntry>();
  /** url → key side index for O(1) registration dedup. */
  private _oleLinkKeys = new Map<string, string>();
  private _nextOleLinkId = 1;
  private _nextRelId = 1;
  /** cNvPr name → id for the part being serialized (cleared per slide/layout/master). */
  private _shapeIds = new Map<string, number>();
  private _ambiguousShapeNames = new Set<string>();
  private _nextChartId = 1;
  private _nextSmartArtId = 1;

  /**
   * Slide width in EMU — the master's standard placeholder positions are scaled
   * to this width. Set by the compiler from the presentation size; defaults to
   * the 16:9 width (12192000 EMU) so patch/deserialize paths that never touch
   * the master still have a sane value.
   */
  public slideWidth = 12192000;

  // ── WriteContext stubs (core interface) ──

  public addRelationship(_type: string, _target: string, _mode?: string): string {
    const id = this._nextRelId++;
    return `rId${id}`;
  }

  public addMedia(data: Uint8Array, type: string): string {
    const entry = this._media.addMedia(data, type, (fileName) => ({
      key: fileName,
      fileName,
      data,
      type,
    }));
    return `{${entry.fileName}}`;
  }

  // ── PPTX-specific registration ──

  /**
   * Register an OLE embedding (ppt/embeddings/oleObjectN.bin) and return a
   * `{ole:oleObjectN.bin}` placeholder. The compiler rewrites the placeholder
   * to a real relationship id and adds the oleObject relationship per slide.
   */
  public addOle(data: Uint8Array, progId?: string): string {
    const entry = this._embeddings.addEmbedding(data, undefined, progId);
    return `{ole:${entry.fileName}}`;
  }

  public addImage(key: string, entry: MediaEntry): MediaEntry {
    return this._media.addMedia(
      entry.data,
      entry.type,
      (fileName) => ({ ...entry, fileName, key: fileName }),
      key,
    );
  }

  public addChart(key: string, entry: ChartEntry): void {
    this._charts.set(key, entry);
  }

  public addSmartArt(key: string, entry: SmartArtEntry): void {
    this._smartArts.set(key, entry);
  }

  public addHyperlink(key: string, target: HyperlinkTarget): void {
    this._hyperlinks.set(key, {
      key,
      url: target.url,
      slide: target.slide,
      tooltip: target.tooltip,
    });
  }

  /**
   * Register an externally linked image source and return its `{img-link:key}`
   * placeholder. The compiler rewrites the placeholder to a relationship id
   * and adds the External image relationship per slide/layout.
   */
  public addImageLink(url: string): string {
    const existingKey = this._imageLinkKeys.get(url);
    if (existingKey !== undefined) return existingKey;
    const key = `img-link_${this._nextImageLinkId++}`;
    this._imageLinks.set(key, { key, url });
    this._imageLinkKeys.set(url, key);
    return key;
  }

  /**
   * Register an externally linked OLE object source and return its
   * `{ole-link:key}` placeholder. The compiler rewrites the placeholder to a
   * relationship id and adds the External oleObject relationship per
   * slide/layout.
   */
  public addOleLink(url: string): string {
    const existingKey = this._oleLinkKeys.get(url);
    if (existingKey !== undefined) return existingKey;
    const key = `ole-link_${this._nextOleLinkId++}`;
    this._oleLinks.set(key, { key, url });
    this._oleLinkKeys.set(url, key);
    return key;
  }

  public nextChartKey(): string {
    return `chart_${this._nextChartId++}`;
  }

  // ── Shape-name symbol table ──

  /**
   * Clear the shape-name symbol table. spTgt @spid resolves within one part's
   * spTree, so slide/layout/master serialization each starts a fresh scope.
   */
  public beginShapeScope(): void {
    this._shapeIds.clear();
    this._ambiguousShapeNames.clear();
  }

  /**
   * Record a drawing's (cNvPr name, id) — the table animation `shapeName`
   * references resolve against. A name carried by two different ids becomes
   * ambiguous and stays unresolvable.
   */
  public registerShapeId(name: string, id: number): void {
    const first = this._shapeIds.get(name);
    if (first === undefined) this._shapeIds.set(name, id);
    else if (first !== id) this._ambiguousShapeNames.add(name);
  }

  /**
   * Resolve a shapeName reference to its cNvPr id. Throws when the name is
   * unknown or ambiguous — a dangling spid would produce a file Office
   * rejects, so the failure surfaces at compile time instead.
   */
  public resolveShapeName(name: string): number {
    if (this._ambiguousShapeNames.has(name)) {
      throw new Error(
        `Shape name "${name}" is used by multiple shapes in this part — reference it by shapeId instead.`,
      );
    }
    const id = this._shapeIds.get(name);
    if (id === undefined) {
      const names = [...this._shapeIds.keys()];
      const available =
        names.length === 0
          ? "this part has no shapes"
          : `shapes in this part are named: ${names
              .slice(0, 8)
              .map((n) => `"${n}"`)
              .join(", ")}${names.length > 8 ? `, … (${names.length} total)` : ""}`;
      throw new Error(`No shape named "${name}" in this part — ${available}.`);
    }
    return id;
  }

  public nextSmartArtKey(): string {
    return `smartart_${this._nextSmartArtId++}`;
  }

  // ── Getters ──

  public get media(): MediaEntry[] {
    return this._media.array;
  }

  /** Underlying deduplicated collection — used by the compiler for media output. */
  public get mediaCollection(): Media<MediaEntry> {
    return this._media;
  }

  /** Registered OLE embeddings — output as ppt/embeddings/*.bin by the compiler. */
  public get embeddings(): EmbeddingData[] {
    return this._embeddings.array;
  }

  public get charts(): ChartEntry[] {
    return [...this._charts.values()];
  }

  public get smartArts(): SmartArtEntry[] {
    return [...this._smartArts.values()];
  }

  public get hyperlinks(): HyperlinkEntry[] {
    return [...this._hyperlinks.values()];
  }

  public get imageLinks(): ImageLinkEntry[] {
    return [...this._imageLinks.values()];
  }

  public get oleLinks(): OleLinkEntry[] {
    return [...this._oleLinks.values()];
  }
}

// ── Read context ──

/**
 * PPTX-specific read context.
 *
 * Adapts the existing {@link ParseContext} to the core {@link ReadContext}
 * interface used by the descriptor parse pipeline.
 */
export class PptxReadContext implements ReadContext {
  constructor(private _parseCtx: ParseContext) {}

  public resolveRelationship(rId: string): string | undefined {
    return this._parseCtx.slideRels.get(rId);
  }

  public getPart(path: string) {
    return this._parseCtx.pptx.doc.get(path);
  }

  public getRaw(path: string): Uint8Array | undefined {
    return this._parseCtx.pptx.doc.getRaw(path);
  }
}
