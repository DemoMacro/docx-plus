/**
 * Files-driven [Content_Types].xml derivation (part-centric).
 *
 * Walks the actual part paths written to the package and derives the
 * Default/Override entries from a path→contentType resolver plus an
 * extension→MIME map. The part set is the single source of truth, so the
 * content-type declarations cannot drift from what is written — the class of
 * bug that registry/facts builders exist to patch (#357). Sparse or index-based
 * part naming (e.g. pptx comments keyed by slide index rather than a dense
 * sequence) is handled naturally: every written file is declared regardless of
 * its naming scheme, because emission follows the files, not a count.
 *
 * Reference: ECMA-376 Part 2 §10; peer libraries (python-pptx, openpyxl) derive
 * [Content_Types] from the actual part set the same way.
 *
 * @module
 */

import { OOXML_XML_DECLARATION } from "@office-open/xml";

import type { CustomDescriptor, WriteContext } from "../descriptor";
import type { DataType } from "../util/data-type";
import { toUint8Array } from "../util/data-type";
import type { Zippable } from "./packer";
import type { PackagePartRegistry } from "./part-registry";

// ── Types ──

export interface ContentTypeDefault {
  extension: string;
  contentType: string;
}

export interface ContentTypeOverride {
  partName: string;
  contentType: string;
}

/**
 * [Content_Types].xml source. Usually omitted — the compiler derives it from
 * the parts actually written; supply it only to override the derivation.
 */
export interface ContentTypesInput {
  defaults: ContentTypeDefault[];
  overrides: ContentTypeOverride[];
}

// ── Serializer ──

export const contentTypesDesc: CustomDescriptor<ContentTypesInput> = {
  kind: "custom",

  stringify(opts, _ctx) {
    const p: string[] = [
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    ];
    // OPC Default Extension and Override PartName matching are case-insensitive
    // (ECMA-376-2 §10.1.2/§10.1.4): a duplicate differing only in case makes
    // Word reject the package as unreadable content. Dedup case-insensitively
    // so no input path can emit a colliding pair.
    const seenDefault = new Set<string>();
    for (const d of opts.defaults) {
      const key = d.extension.toLowerCase();
      if (seenDefault.has(key)) continue;
      seenDefault.add(key);
      p.push(`<Default Extension="${d.extension}" ContentType="${d.contentType}"/>`);
    }
    const seenOverride = new Set<string>();
    for (const o of opts.overrides) {
      const key = o.partName.toLowerCase();
      if (seenOverride.has(key)) continue;
      seenOverride.add(key);
      p.push(`<Override PartName="${o.partName}" ContentType="${o.contentType}"/>`);
    }
    p.push("</Types>");
    return p.join("");
  },

  parse(el, _ctx) {
    const defaults: ContentTypeDefault[] = [];
    const overrides: ContentTypeOverride[] = [];
    for (const child of el.elements ?? []) {
      if (child.name === "Default") {
        const ext = child.attributes?.["Extension"];
        const ct = child.attributes?.["ContentType"];
        if (ext && ct) defaults.push({ extension: String(ext), contentType: String(ct) });
      } else if (child.name === "Override") {
        const pn = child.attributes?.["PartName"];
        const ct = child.attributes?.["ContentType"];
        if (pn && ct) overrides.push({ partName: String(pn), contentType: String(ct) });
      }
    }
    return { defaults, overrides };
  },
};

// ── Path → contentType resolver ──

export type PartContentTypeResolver = (partPath: string) => string | undefined;

/** Convert a registry part path (with `${i}` placeholders) to an anchored RegExp. */
function patternToRegExp(path: string): RegExp {
  const segments = path.split("${i}");
  const escaped = segments.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp("^" + escaped.join("\\d+") + "$");
}

/**
 * Build a path→contentType resolver from a part registry. Only the path pattern
 * and contentType are consulted; the presence/flag/countFrom fields are
 * irrelevant here because emission is driven by the files actually written, not
 * by a separate facts map. Any path the resolver does not recognize falls
 * through to extension-based Default handling (media, embeddings, .rels).
 */
export function resolverFromRegistry(registry: PackagePartRegistry): PartContentTypeResolver {
  const patterns: Array<{ re: RegExp; contentType: string }> = [];
  for (const part of registry.parts) {
    if (!part.contentType) continue;
    patterns.push({ re: patternToRegExp(part.path), contentType: part.contentType });
  }
  return (partPath: string) => patterns.find((p) => p.re.test(partPath))?.contentType;
}

// ── Derive ──

const BASE_DEFAULTS: ContentTypeDefault[] = [
  { extension: "rels", contentType: "application/vnd.openxmlformats-package.relationships+xml" },
  { extension: "xml", contentType: "application/xml" },
];

export interface DeriveContentTypesOptions {
  /** Resolve an OOXML part path to its Override content type. Return undefined
   * for non-part files (media/embeddings/.rels) resolved via Default. */
  resolve: PartContentTypeResolver;
  /** Lowercase extension → MIME for media/embedding Default entries. */
  mediaContentTypes: Readonly<Record<string, string>>;
  /** Always-present Default entries. Defaults to rels + xml. */
  baseDefaults?: ContentTypeDefault[];
  /** Per-file Overrides for parts whose content type is data-driven and not
   * path-determinable — docx altChunks carry a caller-supplied MIME, and
   * sub-documents live at an arbitrary path. Each path is normalized to a
   * leading slash and takes precedence over a resolver match for the same
   * path. */
  overrides?: ReadonlyArray<{ path: string; contentType: string }>;
  /**
   * The source package's [Content_Types].xml (round-trip). Present, the
   * derived table is merged onto it: every source Default survives verbatim,
   * source Overrides survive for parts that still exist at the same path,
   * and derived entries only fill what the surviving source table leaves
   * uncovered or mistyped (renamed media, synthesized parts, a Default whose
   * type disagrees with a surviving part). Fresh generation (no source) is
   * unaffected.
   */
  source?: ContentTypesInput;
  /**
   * Paths whose bytes are carried verbatim from the source package (same form
   * as `filePaths` entries). With a source table present, derivation never
   * types these parts — whatever the surviving source table says about them
   * is their type, exactly as it was in the source. Only parts the compiler
   * (re)writes get derived declarations.
   */
  verbatimPaths?: ReadonlySet<string>;
}

function extensionOf(path: string): string | undefined {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dot = path.slice(slash + 1).lastIndexOf(".");
  return dot > 0 ? path.slice(slash + 1 + dot + 1) : undefined;
}

function withLeadingSlash(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

/**
 * Derive [Content_Types].xml entries from the actual part paths in the package.
 * Each path that the resolver maps to a content type becomes an Override; every
 * other file contributes a Default keyed by its extension (declared once).
 */
export function deriveContentTypes(
  filePaths: Iterable<string>,
  options: DeriveContentTypesOptions,
): ContentTypesInput {
  const files = [...filePaths].filter((p) => p !== "[Content_Types].xml");
  const defaults: ContentTypeDefault[] = [...(options.baseDefaults ?? BASE_DEFAULTS)];
  const seenExt = new Set(defaults.map((d) => d.extension.toLowerCase()));
  // Keyed by lowercased PartName so explicit `overrides` entries (altChunks,
  // sub-documents) take precedence over a resolver match for the same path.
  const overrideMap = new Map<string, ContentTypeOverride>();
  // Per-part derived types (resolver match or extension MIME) — the merge with
  // a source table compares part types against surviving source Defaults.
  const partTypes: Array<{ partName: string; contentType: string }> = [];

  for (const path of files) {
    const partType = options.resolve(path);
    if (partType) {
      const partName = withLeadingSlash(path);
      overrideMap.set(partName.toLowerCase(), { partName, contentType: partType });
      partTypes.push({ partName, contentType: partType });
      continue;
    }
    const ext = extensionOf(path);
    if (!ext) continue;
    const key = ext.toLowerCase();
    const mime = options.mediaContentTypes[key];
    if (!seenExt.has(key) && mime) {
      defaults.push({ extension: ext, contentType: mime });
      seenExt.add(key);
    }
    if (mime) partTypes.push({ partName: withLeadingSlash(path), contentType: mime });
  }
  for (const extra of options.overrides ?? []) {
    const partName = withLeadingSlash(extra.path);
    overrideMap.set(partName.toLowerCase(), { partName, contentType: extra.contentType });
  }
  if (!options.source) return { defaults, overrides: [...overrideMap.values()] };
  return mergeSourceContentTypes(options.source, files, defaults, overrideMap, partTypes, {
    verbatim: options.verbatimPaths,
  });
}

/**
 * Merge derived declarations onto the source package's table (round-trip).
 *
 * - Source Defaults survive verbatim — extension-level entries are harmless
 *   when unused, and dropping them (or retyping the shared .bin extension)
 *   is what a purely derived table gets wrong.
 * - Source Overrides survive for parts that still exist at the same path;
 *   media the pipeline renamed drops out.
 * - Derived Overrides fill only what the surviving source table leaves
 *   uncovered: parts with no source Override whose covering source Default
 *   disagrees with (or omits) their derived type. A part the compiler
 *   rebuilds from its parsed source stays the same part kind, so a surviving
 *   source Override (macro-enabled variants included) keeps the source type —
 *   the static registry cannot know the package variant the source declared.
 * - A derived Default joins only when an output part of that extension is
 *   still uncovered after Overrides — a source table that declares its .jpg
 *   parts via per-part Overrides stays as-is.
 */
function mergeSourceContentTypes(
  source: ContentTypesInput,
  files: string[],
  derivedDefaults: ContentTypeDefault[],
  derivedOverrides: Map<string, ContentTypeOverride>,
  partTypes: Array<{ partName: string; contentType: string }>,
  mergeOpts: { verbatim?: ReadonlySet<string> },
): ContentTypesInput {
  const filePaths = new Set(files.map((p) => withLeadingSlash(p).toLowerCase()));
  // OPC part-name matching is case-insensitive (ECMA-376-2 §10.1.2.1), so the
  // verbatim lookup lowercases both sides.
  const verbatimLower = new Set([...(mergeOpts.verbatim ?? [])].map((p) => p.toLowerCase()));
  const isVerbatim = (partName: string) => verbatimLower.has(partName.slice(1).toLowerCase());
  const partExt = (partName: string) => {
    const dot = partName.lastIndexOf(".");
    return dot > partName.lastIndexOf("/") ? partName.slice(dot + 1) : "";
  };
  // Candidate Default types (source wins per extension, derived fills the
  // rest) — membership in the emitted table is decided after Overrides.
  const defaultTypeByExt = new Map<string, string>();
  const derivedDefaultByExt = new Map<string, ContentTypeDefault>();
  for (const d of source.defaults) {
    const key = d.extension.toLowerCase();
    if (!defaultTypeByExt.has(key)) defaultTypeByExt.set(key, d.contentType);
  }
  for (const d of derivedDefaults) {
    const key = d.extension.toLowerCase();
    if (defaultTypeByExt.has(key)) continue;
    defaultTypeByExt.set(key, d.contentType);
    derivedDefaultByExt.set(key, d);
  }
  const overrides: ContentTypeOverride[] = [];
  const seenOverride = new Set<string>();
  const keptSourceTypeByPath = new Map<string, string>();
  for (const o of source.overrides) {
    const key = o.partName.toLowerCase();
    if (!filePaths.has(key)) continue; // renamed media or dropped part
    if (seenOverride.has(key)) continue;
    seenOverride.add(key);
    overrides.push(o);
    keptSourceTypeByPath.set(key, o.contentType);
  }
  for (const o of derivedOverrides.values()) {
    const key = o.partName.toLowerCase();
    if (isVerbatim(key)) continue; // source bytes, source declaration
    if (keptSourceTypeByPath.has(key)) continue; // rebuilt, same part kind — keep source type
    const ext = partExt(key);
    const coveringDefault = ext ? defaultTypeByExt.get(ext) : undefined;
    if (coveringDefault === o.contentType) continue; // covered by a Default
    seenOverride.add(key);
    overrides.push(o);
  }
  // Extension-typed parts (media, embeddings) whose surviving source Default
  // disagrees with the derived type need a per-part Override — e.g. a package
  // whose Default .bin types printer settings while an OLE .bin survives.
  for (const { partName, contentType } of partTypes) {
    const key = partName.toLowerCase();
    if (derivedOverrides.has(key) || keptSourceTypeByPath.has(key)) continue;
    if (isVerbatim(key)) continue; // source bytes, source declaration
    const ext = partExt(key);
    const coveringDefault = ext ? defaultTypeByExt.get(ext) : undefined;
    if (coveringDefault === undefined || coveringDefault === contentType) continue;
    if (seenOverride.has(key)) continue;
    seenOverride.add(key);
    overrides.push({ partName, contentType });
  }
  const defaults: ContentTypeDefault[] = [];
  const seenDefault = new Set<string>();
  for (const d of source.defaults) {
    const key = d.extension.toLowerCase();
    if (seenDefault.has(key)) continue;
    seenDefault.add(key);
    defaults.push(d);
  }
  for (const [key, d] of derivedDefaultByExt) {
    // A part of this extension with no Override is what makes the Default
    // load-bearing; extensions fully covered by Overrides stay undeclared,
    // matching a source table that never had them.
    const needed = files.some(
      (f) =>
        extensionOf(f)?.toLowerCase() === key &&
        !seenOverride.has(withLeadingSlash(f).toLowerCase()),
    );
    if (needed) defaults.push(d);
  }
  return { defaults, overrides };
}

/**
 * Extension → MIME for image media, shared by every format package.
 *
 * The three format compilers each declare a package-scoped media table made
 * of this image block plus format-specific extras (docx: odttf/bin fonts and
 * OLE; pptx: video/audio; xlsx: vml). Keeping the image half in one place
 * means a new image format lands everywhere at once.
 */
export const IMAGE_MEDIA_CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  bmp: "image/bmp",
  gif: "image/gif",
  tif: "image/tiff",
  tiff: "image/tiff",
  emf: "image/x-emf",
  wmf: "image/x-wmf",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};

// ── Package finalization ──

/** Raw passthrough part carried verbatim from the source package. */
export interface RawPackagePart {
  path: string;
  data: DataType;
  contentType?: string;
}

export interface FinalizeContentTypesOptions {
  /** Resolve an OOXML part path to its Override content type. */
  resolve: PartContentTypeResolver;
  /** Lowercase extension → MIME for media/embedding Default entries. */
  mediaContentTypes: Readonly<Record<string, string>>;
  /** The source package's [Content_Types].xml (round-trip). */
  source?: ContentTypesInput;
  /** Raw passthrough parts, copied into the package before derivation — the
   * compiler output wins at the same path, so only what the model missed
   * passes through. */
  rawParts?: readonly RawPackagePart[];
  /** Data-driven Overrides whose content type is not path-determinable —
   * docx altChunks carry a caller-supplied MIME, sub-documents are always
   * main-document parts. */
  overrides?: ReadonlyArray<{ path: string; contentType: string }>;
}

/**
 * Shared closing step of the three format compilers: copy raw passthrough
 * parts into the package (compiler output wins at the same path), derive
 * [Content_Types].xml from the final file set, and return the XML document
 * (declaration included) for the caller to store at
 * files["[Content_Types].xml"]. Deriving after the copy is what keeps the
 * declarations and the parts in sync — passthrough parts whose extension has
 * no covering Default borrow their source content type as a per-part Override
 * (an undeclared part makes Office refuse to open the package).
 */
export function finalizeContentTypes(
  files: Zippable,
  options: FinalizeContentTypesOptions,
  ctx: WriteContext,
): string {
  const rawParts = options.rawParts ?? [];
  const passthroughSkipped = new Set<string>();
  for (const part of rawParts) {
    if (files[part.path] !== undefined) {
      passthroughSkipped.add(part.path);
      continue;
    }
    files[part.path] = toUint8Array(part.data);
  }

  const input = deriveContentTypes(Object.keys(files), {
    resolve: options.resolve,
    mediaContentTypes: options.mediaContentTypes,
    overrides: options.overrides,
    source: options.source,
    verbatimPaths: new Set(rawParts.map((p) => p.path)),
  });
  const coveredExt = new Set(input.defaults.map((d) => d.extension.toLowerCase()));
  for (const part of rawParts) {
    if (part.contentType === undefined || passthroughSkipped.has(part.path)) continue;
    const dot = part.path.lastIndexOf(".");
    const slash = part.path.lastIndexOf("/");
    const ext = dot > slash ? part.path.slice(dot + 1).toLowerCase() : undefined;
    if (ext && coveredExt.has(ext)) continue;
    input.overrides.push({ partName: `/${part.path}`, contentType: part.contentType });
  }
  return OOXML_XML_DECLARATION + (contentTypesDesc.stringify(input, ctx) ?? "");
}
