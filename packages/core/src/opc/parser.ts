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

import { toUint8ArrayAsync } from "../util/data-type";
import { blobSource, type ByteSource } from "./byte-source";
import { stripOversizedGfxdata } from "./gfxdata";
import { OOXML_CANONICAL_PREFIXES } from "./namespaces";
import { levelForMediaName, ZIP_MEDIA_LEVEL } from "./packer";
import { inflateEntryFrom } from "./stream-inflate";
import {
  inflateZipEntry,
  readCentralDirectory,
  readCentralDirectoryAsync,
  type ZipEntryMeta,
} from "./zip-native";

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
  private readonly source: Uint8Array | ByteSource;
  /** Compressed entries not yet inflated (empty on the eager fallback path). */
  private readonly index: Map<string, ZipEntryMeta>;
  /** Inflated parts, populated on demand (and wholesale on the eager fallback). */
  private readonly parts = new Map<string, Uint8Array>();
  private readonly modified = new Map<string, Uint8Array>();
  private readonly wrapperCache = new Map<string, Element>();
  /**
   * Central-directory order of every entry. keys() is ordered by this so a
   * bytes-backed archive (entries migrate index→parts as they are read) and
   * a Blob-backed one (hydrated wholesale) list parts identically — callers
   * compare parsed documents, and part order leaks into them.
   */
  private readonly order: string[];

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
      this.order = Object.keys(eager);
      return;
    }
    this.index = new Map(entries.map((e) => [e.name, e]));
    this.order = entries.map((e) => e.name);
  }

  /**
   * Open an archive from bytes or a `Blob`/`File`. Bytes take the synchronous
   * constructor path; a Blob is read through {@link blobSource} random-access
   * windows — the package never materializes as one contiguous buffer — and
   * every entry is decompressed up front (oversized XML through the streaming
   * pipeline), so the returned archive serves the same synchronous
   * `get`/`getRaw` API as a bytes-backed one.
   */
  public static async open(data: Uint8Array | Blob): Promise<ParsedArchive> {
    if (!(data instanceof Blob)) return new ParsedArchive(data);
    const source = blobSource(data);
    let entries: ZipEntryMeta[];
    try {
      entries = await readCentralDirectoryAsync(source);
    } catch {
      // zip64 or an exotic layout — the eager full read is the reference
      // behavior (it throws on unreadable input, as before).
      return new ParsedArchive(await toUint8ArrayAsync(data));
    }
    // Object.create skips the constructor (a Blob-backed archive holds a
    // ByteSource, not bytes), so the private state is assigned here — inside
    // the class — and hydrated immediately: the index drains into `parts`,
    // keeping get/getRaw/save synchronous from this point on. Both casts go
    // through `unknown`: crossing the class's private fields with a public
    // shape of the same names would intersect them down to `never`.
    const archive = Object.create(ParsedArchive.prototype) as unknown as HydratedArchive;
    archive.source = source;
    archive.index = new Map(entries.map((e) => [e.name, e]));
    archive.parts = new Map();
    archive.modified = new Map();
    archive.wrapperCache = new Map();
    archive.order = entries.map((e) => e.name);
    await hydrateArchive(archive);
    return archive as unknown as ParsedArchive;
  }

  /** Inflate and cache the compressed entry for `path`, if still compressed. */
  private inflate(path: string): Uint8Array | undefined {
    const entry = this.index.get(path);
    if (entry === undefined) return undefined;
    // Bytes-backed archives only — a Blob-backed one drains its index during
    // open(), so this never sees a ByteSource.
    const bytes = this.source as Uint8Array;
    let data: Uint8Array;
    try {
      data = inflateZipEntry(bytes, entry);
    } catch {
      // The native path verifies CRC-32; a mismatch was previously tolerated
      // by falling back to fflate's check-free unzipSync — keep that parity
      // per entry before giving up.
      const raw = bytes.subarray(entry.dataStart, entry.dataStart + entry.compSize);
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

  /** List all paths matching an optional prefix, in central-directory order. */
  public keys(prefix?: string): string[] {
    const seen = new Set<string>();
    const collect = (key: string): void => {
      if (!prefix || key.startsWith(prefix)) seen.add(key);
    };
    // New parts (set/setRaw on a fresh path) trail the directory order.
    for (const key of this.order) collect(key);
    for (const key of this.parts.keys()) collect(key);
    for (const key of this.modified.keys()) collect(key);
    return [...seen];
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
    for (const path of this.keys()) {
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

/** Writable view of a Blob-backed archive's private state, for open()/hydrate. */
interface HydratedArchive {
  source: Uint8Array | ByteSource;
  index: Map<string, ZipEntryMeta>;
  parts: Map<string, Uint8Array>;
  modified: Map<string, Uint8Array>;
  wrapperCache: Map<string, Element>;
  order: string[];
}

/** Decompress every indexed entry (Blob-backed open — after this, sync reads). */
async function hydrateArchive(archive: HydratedArchive): Promise<void> {
  const source = archive.source as ByteSource;
  // Deleting the just-consumed entry while iterating a Map is defined
  // behavior — the iterator only visits what the map still holds.
  for (const entry of archive.index.values()) {
    const data = await inflateEntryFrom(source, entry).catch(async () => {
      // inflateEntryFrom verifies CRC-32 on the native path; tolerate a
      // mismatch the way the fflate fallback always has — retry check-free.
      const raw = await source.read(entry.dataStart, entry.compSize);
      return entry.method === 0 ? raw.slice() : inflateSync(raw);
    });
    archive.index.delete(entry.name);
    archive.parts.set(entry.name, data);
  }
}
