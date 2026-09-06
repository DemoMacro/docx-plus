import { parse, stringify } from "@office-open/xml";
import type { Element, ParseOptions } from "@office-open/xml";
import {
  unzipSync,
  zipSync,
  strFromU8,
  strToU8,
  inflateSync,
  type ZipOptions,
  type Zippable,
} from "fflate";

import { stripOversizedGfxdata } from "./gfxdata";
import { OOXML_CANONICAL_PREFIXES } from "./namespaces";
import { levelForMediaName, ZIP_MEDIA_LEVEL } from "./packer";
import { inflateZipEntry, readCentralDirectory, type ZipEntryMeta } from "./zip-native";

const XML_PARSE_OPTIONS = {
  nativeTypeAttributes: true,
  captureSpacesBetweenElements: true,
  // Normalize namespace prefixes to the canonical ones the library itself
  // emits — sources binding the Word namespace to ns0: or the spreadsheet
  // namespace to x: parse into canonical names, so descriptor matching and
  // registry paths see the elements they address.
  normalizeNamespaces: OOXML_CANONICAL_PREFIXES,
};

/**
 * Parsed OOXML archive backed by a lazily-inflated ZIP.
 *
 * The constructor walks the central directory only — no entry is decompressed
 * until first read — so opening a package costs an index build (milliseconds
 * even on multi-hundred-part archives) instead of a full inflate. Parts are
 * inflated on demand and cached; XML parts additionally have oversized
 * `o:gfxdata` attribute values stripped before parse (see
 * {@link stripOversizedGfxdata}).
 *
 * Provides unstorage-style API (get/set/getRaw/setRaw/remove/has/keys)
 * for reading and modifying individual parts, then serializing back to a ZIP buffer.
 */
export class ParsedArchive {
  private readonly source: Uint8Array;
  /** Compressed entries not yet inflated (empty on the eager fallback path). */
  private readonly index: Map<string, ZipEntryMeta>;
  /** Inflated parts, populated on demand (and wholesale on the eager fallback). */
  private readonly parts = new Map<string, Uint8Array>();
  private readonly modified = new Map<string, Uint8Array>();
  private readonly wrapperCache = new Map<string, Element>();

  public constructor(data: Uint8Array) {
    this.source = data;
    let entries: ZipEntryMeta[];
    try {
      entries = readCentralDirectory(data);
    } catch {
      // Non-classic ZIP variant (zip64, exotic layouts) or not an archive at
      // all: fall back to fflate's eager full read, the reference
      // implementation — it throws on unreadable input, as before.
      const eager = unzipSync(data);
      for (const [name, bytes] of Object.entries(eager)) this.parts.set(name, bytes);
      this.index = new Map();
      return;
    }
    this.index = new Map(entries.map((e) => [e.name, e]));
  }

  /** Inflate and cache the compressed entry for `path`, if still compressed. */
  private inflate(path: string): Uint8Array | undefined {
    const entry = this.index.get(path);
    if (entry === undefined) return undefined;
    let data: Uint8Array;
    try {
      data = inflateZipEntry(this.source, entry);
    } catch {
      // The native path verifies CRC-32; a mismatch was previously tolerated
      // by falling back to fflate's check-free unzipSync — keep that parity
      // per entry before giving up.
      const raw = this.source.subarray(entry.dataStart, entry.dataStart + entry.compSize);
      data = entry.method === 0 ? raw.slice() : inflateSync(raw);
    }
    if (path.endsWith(".xml")) data = stripOversizedGfxdata(data);
    this.index.delete(path);
    this.parts.set(path, data);
    return data;
  }

  /**
   * Read an XML part as an Element tree. `parseOptions` extends the default
   * XML parse options for this part (e.g. `deferElements` to capture a hot
   * container's inner XML verbatim). Callers must use consistent options per
   * path — the wrapper cache is keyed by path only.
   */
  public get(path: string, parseOptions?: ParseOptions): Element | undefined {
    const opts = parseOptions ? { ...XML_PARSE_OPTIONS, ...parseOptions } : XML_PARSE_OPTIONS;
    // Check modified first
    const modData = this.modified.get(path);
    if (modData) {
      const wrapper = parse(strFromU8(modData), opts) as Element;
      this.wrapperCache.set(path, wrapper);
      return wrapper.elements?.find((e) => e.type === "element");
    }

    const data = this.parts.get(path) ?? this.inflate(path);
    if (data === undefined) return undefined;

    // Try cache
    const cached = this.wrapperCache.get(path);
    if (cached) return cached.elements?.find((e) => e.type === "element");

    // Parse and cache
    const wrapper = parse(strFromU8(data), opts) as Element;
    this.wrapperCache.set(path, wrapper);
    return wrapper.elements?.find((e) => e.type === "element");
  }

  /** Write an XML part (Element → XML string). */
  public set(path: string, element: Element): void {
    const wrapper = this.wrapperCache.get(path);
    const doc: Element = wrapper
      ? { ...wrapper, elements: [{ ...element, type: "element" as const }] }
      : { elements: [{ ...element, type: "element" as const }] };
    const xml = stringify(doc);
    this.modified.set(path, strToU8(xml));
  }

  /** Read raw binary data (images, media, etc.). */
  public getRaw(path: string): Uint8Array | undefined {
    return this.modified.get(path) ?? this.parts.get(path) ?? this.inflate(path);
  }

  /** Write raw binary data. */
  public setRaw(path: string, data: Uint8Array): void {
    this.modified.set(path, data);
    this.wrapperCache.delete(path);
  }

  /** Remove a part. Returns true if it existed. */
  public remove(path: string): boolean {
    this.wrapperCache.delete(path);
    return this.modified.delete(path) || this.parts.delete(path) || this.index.delete(path);
  }

  /** Check if a part exists. */
  public has(path: string): boolean {
    return this.modified.has(path) || this.parts.has(path) || this.index.has(path);
  }

  /** List all paths matching an optional prefix. */
  public keys(prefix?: string): string[] {
    const all = new Set<string>();
    for (const key of this.index.keys()) {
      if (!prefix || key.startsWith(prefix)) all.add(key);
    }
    for (const key of this.parts.keys()) {
      if (!prefix || key.startsWith(prefix)) all.add(key);
    }
    for (const key of this.modified.keys()) {
      if (!prefix || key.startsWith(prefix)) all.add(key);
    }
    return [...all];
  }

  /** Serialize back to a ZIP buffer, inflating any untouched compressed entries. */
  public save(): Uint8Array {
    const files: Zippable = {};
    const collect = (path: string, data: Uint8Array): void => {
      files[path] = [
        data,
        { level: levelForMediaName(path, ZIP_MEDIA_LEVEL) as ZipOptions["level"] },
      ];
    };
    for (const path of new Set([...this.index.keys(), ...this.parts.keys()])) {
      if (this.modified.has(path)) continue;
      const data = this.parts.get(path) ?? this.inflate(path);
      if (data !== undefined) collect(path, data);
    }
    for (const [path, data] of this.modified) {
      collect(path, data);
    }
    return zipSync(files);
  }
}

/** Parse an OOXML archive (.docx, .pptx, .xlsx) into a ParsedArchive. */
export function parseArchive(data: Uint8Array): ParsedArchive {
  return new ParsedArchive(data);
}
