/**
 * Binary input normalization.
 *
 * Accepts the full range of binary inputs (Buffer/Uint8Array/ArrayBuffer/
 * DataView/number[]/string/base64 data URL/…) and normalizes to `Uint8Array`.
 * Centralized here so every entry point (packer, patch, descriptor helpers)
 * shares one definition instead of re-declaring per module.
 *
 * @module
 */
import { decodeBase64 } from "./base64";

/** Supported binary input shapes. */
export type DataType =
  | ArrayBufferLike
  | Blob
  | DataView
  | number[]
  | ReadableStream
  | string
  | Uint8Array;

// Matches data:[<mediatype>][;base64],<data> — a base64 data URL. Mirrors the
// `isBase64DataURL` check in unjs/undio so plain strings stay UTF-8 text.
const DATA_URL_RE = /^data:([\w.+-]+\/[\w.+-]+)?;base64,/;

/** Test whether a string is a base64 data URL (`data:[mime];base64,...`). */
export function isBase64DataURL(input: string): boolean {
  return DATA_URL_RE.test(input);
}

/** Options for {@link toUint8Array}. */
export interface ToUint8ArrayOptions {
  /**
   * How to interpret a plain (non-data-URL) string input. Data URLs
   * (`data:...;base64,...`) and binary inputs (Buffer/Uint8Array/ArrayBuffer/
   * DataView/number[]) are auto-detected and ignore this hint.
   *
   * - `"utf8"` (default): UTF-8 text.
   * - `"base64"`: base64-encoded binary — e.g. an image supplied via
   *   `readFileSync(...).toString("base64")`.
   */
  encoding?: "utf8" | "base64";
}

/** Normalize any supported binary input to a `Uint8Array`. */
export function toUint8Array(data: DataType, options?: ToUint8ArrayOptions): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof DataView)
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === "string") {
    const match = data.match(DATA_URL_RE);
    if (match) return decodeBase64(data.slice(match[0].length));
    if (options?.encoding === "base64") return decodeBase64(data);
    return new TextEncoder().encode(data);
  }
  if (Array.isArray(data)) return new Uint8Array(data);
  if (data instanceof Blob) throw new TypeError("Blob input requires async processing");
  if (data instanceof ReadableStream)
    throw new TypeError("ReadableStream input requires async processing");
  throw new TypeError(`Unsupported data type: ${typeof data}`);
}

/**
 * Async counterpart of {@link toUint8Array}: additionally accepts `Blob`
 * (including `File`) and `ReadableStream` inputs, which the sync variant
 * rejects. Everything else delegates to the sync normalization.
 */
export async function toUint8ArrayAsync(
  data: DataType,
  options?: ToUint8ArrayOptions,
): Promise<Uint8Array> {
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (data instanceof ReadableStream) {
    const reader = data.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
  return toUint8Array(data, options);
}
