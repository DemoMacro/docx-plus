/**
 * Shared compiler utilities for OOXML document generation.
 *
 * @module
 */

import { levelForMediaName } from "../opc/packer";
import type { XmlifyedFile, ZipOptions, Zippable } from "../opc/packer";

/** Reusable TextEncoder instance (stateless, safe to share). */
const encoder = new TextEncoder();

export type XmlifyedFileEntry = XmlifyedFile | readonly XmlifyedFile[] | undefined;

/** Add one binary ZIP entry using the shared media compression policy. */
export function addBinaryFile(
  files: Zippable,
  path: string,
  data: Uint8Array,
  mediaLevel: number,
): void {
  files[path] = [data, { level: levelForMediaName(path, mediaLevel) as ZipOptions["level"] }];
}

/** Media entry with an SVG fallback raster twin (`type: "svg"` only). */
export interface MediaBinary {
  fileName: string;
  data: Uint8Array;
  type: string;
  fallback?: { fileName: string; data: Uint8Array };
}

/** OLE embedding binary (oleObjectN.bin / native package). */
export interface EmbeddingBinary {
  fileName: string;
  data: Uint8Array;
}

/**
 * Write the media and embedding binaries a package compiler collected into
 * the model back out as ZIP entries under `<packageDir>/media` and
 * `<packageDir>/embeddings`. An svg media entry also writes its fallback
 * raster twin (the mc:AlternateContent image browsers render).
 */
export function addModelBinaries(
  files: Zippable,
  packageDir: string,
  media: readonly MediaBinary[],
  embeddings: readonly EmbeddingBinary[],
  mediaLevel: number,
): void {
  for (const m of media) {
    addBinaryFile(files, `${packageDir}/media/${m.fileName}`, m.data, mediaLevel);
    if (m.type === "svg" && m.fallback) {
      addBinaryFile(
        files,
        `${packageDir}/media/${m.fallback.fileName}`,
        m.fallback.data,
        mediaLevel,
      );
    }
  }
  for (const e of embeddings) {
    addBinaryFile(files, `${packageDir}/embeddings/${e.fileName}`, e.data, mediaLevel);
  }
}

/**
 * Convert XML files, overrides, and media into a Zippable structure.
 *
 * Mapping values may be optional arrays so package compilers can pass their
 * natural part mappings without reimplementing flattening and byte encoding.
 */
export function compileMapping<T extends object>(
  mapping: T & { [K in keyof T]: XmlifyedFileEntry },
  overrides?: readonly XmlifyedFile[],
  media?: readonly { data: Uint8Array; path: string }[],
  mediaLevel: number = 0,
): Zippable {
  const files: Zippable = {};
  for (const entry of Object.values(mapping) as XmlifyedFileEntry[]) {
    if (entry === undefined) continue;
    const entries = Array.isArray(entry) ? entry : [entry];
    for (const file of entries) {
      files[file.path] = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    }
  }
  for (const override of overrides ?? []) {
    files[override.path] =
      typeof override.data === "string" ? encoder.encode(override.data) : override.data;
  }
  for (const file of media ?? []) {
    addBinaryFile(files, file.path, file.data, mediaLevel);
  }
  return files;
}
