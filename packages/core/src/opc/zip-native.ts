/**
 * Native ZIP reader/writer with automatic fallback to fflate.
 *
 * `node:zlib` resolves in Node and Bun (via its Node compat layer), giving
 * `deflateRawSync` / `inflateRawSync` for DEFLATE/INFLATE and `zlib.crc32`
 * for CRC-32 — ~2-3x faster than fflate's pure-JS implementation. Browsers
 * and Deno lack a resolvable `node:zlib`, so the dynamic import rejects and
 * packer.ts falls back to fflate. We probe via the import itself rather than
 * `process.versions.node`: core's `shims: true` swaps `process` for a browser
 * stub that drops `versions.node`, which would silently disable native zlib
 * in any package consuming core's polyfilled build.
 *
 * @module
 */

import type * as ZlibNode from "node:zlib";

import { ZipPassThrough, inflateSync } from "fflate";
import type { FlateError, Zippable, ZipOptions } from "fflate";

// ── CRC-32 lookup table ──

const CRC_TABLE = new Int32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ -306674912 : c >>> 1;
  CRC_TABLE[i] = c;
}

function computeCrc32(data: Uint8Array): number {
  let crc = -1;
  // CRC_TABLE is a fixed 256-entry lookup; the index is masked to [0,255], so the
  // access is guaranteed in-bounds — the `!` is a compile-time narrow, not a runtime check.
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return ~crc;
}

// ── Native zlib detection (Node.js ESM) ──

type DeflateFn = (data: Uint8Array, level: number) => Uint8Array;
type AsyncDeflateFn = (data: Uint8Array, level: number) => Promise<Uint8Array>;
type InflateFn = (data: Uint8Array) => Uint8Array;
type Crc32Fn = (data: Uint8Array) => number;

let _nativeDeflate: DeflateFn | undefined;
let _nativeDeflateAsync: AsyncDeflateFn | undefined;
let _nativeInflate: InflateFn | undefined;
let _nativeCrc32: Crc32Fn | undefined;
let _zlibModule: typeof ZlibNode | undefined;

// Bun-specific fast path: Bun.deflateSync/Bun.inflateSync emit/accept RAW
// deflate (bit-identical to deflateRawSync output) but skip the node:zlib
// compat wrapper — ~10x on the small parts that dominate OPC packages, ~2x
// on inflate, ~1.3x on large buffers. Probed off globalThis since core ships
// no bun-types dependency.
const bunApi = (
  globalThis as {
    Bun?: {
      deflateSync?: (data: Uint8Array, opts?: { level?: number }) => Uint8Array;
      inflateSync?: (data: Uint8Array) => Uint8Array;
    };
  }
).Bun;
if (typeof bunApi?.deflateSync === "function") {
  _nativeDeflate = (data: Uint8Array, level: number): Uint8Array =>
    bunApi.deflateSync!(data, { level });
  if (typeof bunApi.inflateSync === "function") {
    _nativeInflate = (data: Uint8Array): Uint8Array => bunApi.inflateSync!(data);
  }
}

// `node:zlib` resolves in Node and Bun (via its Node compat layer); in
// browsers and Deno the dynamic import rejects, so we fall back to fflate.
// The import itself is the probe — do NOT gate on `process.versions.node`:
// core's `shims: true` swaps `process` for a browser stub that drops
// `versions.node`, which would silently disable native zlib in any package
// that consumes core's polyfilled build.
try {
  // top-level await — ESM standard. Resolves to zlib with deflateRawSync;
  // rejects (or yields a stub without it) on incomplete polyfills.
  const zlib = await import("node:zlib");
  if (typeof zlib.deflateRawSync !== "function") throw new Error("no native deflate");
  _zlibModule = zlib;
  if (_nativeDeflate === undefined) {
    _nativeDeflate = (data: Uint8Array, level: number): Uint8Array =>
      zlib.deflateRawSync(data, { level });
  }
  _nativeDeflateAsync = (data: Uint8Array, level: number): Promise<Uint8Array> =>
    new Promise<Uint8Array>((resolve, reject) =>
      zlib.deflateRaw(data, { level }, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      }),
    );
  _nativeCrc32 =
    typeof zlib.crc32 === "function" ? (data: Uint8Array) => zlib.crc32(data) : computeCrc32;
  // Inflate is optional (deflate presence doesn't guarantee it), so probe
  // separately — inflateZipEntry only uses the native path when this resolves.
  if (typeof zlib.inflateRawSync === "function" && _nativeInflate === undefined) {
    _nativeInflate = (data: Uint8Array): Uint8Array => zlib.inflateRawSync(data);
  }
} catch {
  // Browser/Deno or Node-like runtime without usable zlib — fflate fallback
}

export const hasNativeDeflate = (): boolean => _nativeDeflate !== undefined;

// fflate's async zip entries hand every chunk to a dedicated worker via
// postMessage with a transfer list — one thread spawn per part (~5-10ms each
// on Node's worker_threads), which dominates the many-small-parts OPC shape.
// Bun additionally measured worker teardown lag on back-to-back generations
// (0.4s → 4.4s per drain on a 130-part deck) and embedded-pool crashes.
// Where a native zlib resolved (Node/Bun), deflate inline on the main thread;
// only browsers/Deno keep the workers, where spawn is cheap and off-thread
// deflate keeps the UI responsive.
/**
 * True when incremental DEFLATE should run on the main thread instead of
 * fflate's per-entry workers (Node/Bun). See {@link ZipStreamWriter} in
 * packer.ts.
 */
export const prefersMainThreadDeflate = (): boolean => _nativeDeflate !== undefined;

/**
 * True under Bun. Used to keep Bun off `nativeZipAsync`-backed paths: its
 * node:zlib compat layer schedules async calls poorly (bench: async ~1/3 of
 * its sync throughput), so fflate main-thread deflate is the better trade.
 */
export const isBunRuntime = (): boolean => typeof bunApi?.deflateSync === "function";

/**
 * Synchronous native CRC-32 (`zlib.crc32`, Node/Bun only) — undefined where no
 * native zlib resolved (browsers/Deno). Used by media dedup as a fast content
 * key; callers keep their own JS fallback. ~59× faster than a JS hash on
 * 100 MB inputs.
 */
export function nativeCrc32(data: Uint8Array): number | undefined {
  return _nativeCrc32?.(data);
}

// ── LE write helpers ──

function wU16(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >> 8) & 0xff;
}

function wU32(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >> 8) & 0xff;
  b[o + 2] = (v >> 16) & 0xff;
  b[o + 3] = (v >> 24) & 0xff;
}

// ── Per-entry metadata ──

interface Entry {
  filename: Uint8Array;
  data: Uint8Array;
  uncompressedSize: number;
  crc: number;
  method: number; // 0 = STORE, 8 = DEFLATE
  localOffset: number;
}

// ── Phase 1 helpers ──

function resolveEntryData(
  raw: Zippable[string],
  defaultLevel: number,
): { data: Uint8Array; level: number } {
  if (Array.isArray(raw)) {
    return { data: raw[0] as Uint8Array, level: (raw[1] as ZipOptions).level ?? defaultLevel };
  }
  return { data: raw as Uint8Array, level: defaultLevel };
}

function compressOne(
  data: Uint8Array,
  level: number,
  deflate: DeflateFn,
): { compressed: Uint8Array; method: number } {
  if (level === 0) return { compressed: data, method: 0 };
  const compressed = deflate(data, level);
  if (compressed.length >= data.length) return { compressed: data, method: 0 };
  return { compressed, method: 8 };
}

async function compressOneAsync(
  data: Uint8Array,
  level: number,
  deflate: AsyncDeflateFn,
): Promise<{ compressed: Uint8Array; method: number }> {
  if (level === 0) return { compressed: data, method: 0 };
  const compressed = await deflate(data, level);
  if (compressed.length >= data.length) return { compressed: data, method: 0 };
  return { compressed, method: 8 };
}

// ── Phase 2+3: calculate sizes + write ZIP buffer ──

function writeZipBuffer(entries: Entry[]): Uint8Array {
  let totalSize = 0;
  for (const e of entries) {
    totalSize += 30 + e.filename.length + e.data.length;
  }
  const cdOffset = totalSize;
  let cdSize = 0;
  for (const e of entries) {
    cdSize += 46 + e.filename.length;
  }
  totalSize += cdSize + 22;

  const buf = new Uint8Array(totalSize);
  let offset = 0;

  // Local file headers + data
  for (const e of entries) {
    e.localOffset = offset;
    wU32(buf, offset, 0x04034b50); // signature
    wU16(buf, offset + 4, 20); // version needed
    wU16(buf, offset + 6, 0); // flags
    wU16(buf, offset + 8, e.method); // compression method
    wU16(buf, offset + 10, 0); // mod time
    wU16(buf, offset + 12, 0); // mod date
    wU32(buf, offset + 14, e.crc);
    wU32(buf, offset + 18, e.data.length); // compressed size
    wU32(buf, offset + 22, e.uncompressedSize);
    wU16(buf, offset + 26, e.filename.length);
    wU16(buf, offset + 28, 0); // extra field length
    offset += 30;

    buf.set(e.filename, offset);
    offset += e.filename.length;

    buf.set(e.data, offset);
    offset += e.data.length;
  }

  // Central directory
  for (const e of entries) {
    wU32(buf, offset, 0x02014b50); // signature
    wU16(buf, offset + 4, 20); // version made by
    wU16(buf, offset + 6, 20); // version needed
    wU16(buf, offset + 8, 0); // flags
    wU16(buf, offset + 10, e.method);
    wU16(buf, offset + 12, 0); // mod time
    wU16(buf, offset + 14, 0); // mod date
    wU32(buf, offset + 16, e.crc);
    wU32(buf, offset + 20, e.data.length);
    wU32(buf, offset + 24, e.uncompressedSize);
    wU16(buf, offset + 28, e.filename.length);
    wU16(buf, offset + 30, 0); // extra field length
    wU16(buf, offset + 32, 0); // comment length
    wU16(buf, offset + 34, 0); // disk number start
    wU16(buf, offset + 36, 0); // internal attrs
    wU32(buf, offset + 38, 0); // external attrs
    wU32(buf, offset + 42, e.localOffset);
    offset += 46;

    buf.set(e.filename, offset);
    offset += e.filename.length;
  }

  // End of Central Directory Record
  wU32(buf, offset, 0x06054b50);
  wU16(buf, offset + 4, 0); // disk number
  wU16(buf, offset + 6, 0); // CD disk
  wU16(buf, offset + 8, entries.length);
  wU16(buf, offset + 10, entries.length);
  wU32(buf, offset + 12, cdSize);
  wU32(buf, offset + 16, cdOffset);
  wU16(buf, offset + 20, 0); // comment length

  return buf;
}

// ── Public API ──

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function nativeZip(files: Zippable, level: number = 6): Uint8Array {
  if (!_nativeDeflate) throw new Error("Native deflate not available");
  const crc = _nativeCrc32 ?? computeCrc32;
  const entries: Entry[] = [];

  for (const key of Object.keys(files)) {
    const raw = files[key];
    if (raw === undefined) continue; // Object.keys guarantees presence; guard narrows the type
    const { data, level: entryLevel } = resolveEntryData(raw, level);
    const c = crc(data);
    const { compressed, method } = compressOne(data, entryLevel, _nativeDeflate);
    entries.push({
      filename: textEncoder.encode(key),
      data: compressed,
      uncompressedSize: data.length,
      crc: c,
      method,
      localOffset: 0,
    });
  }

  return writeZipBuffer(entries);
}

export async function nativeZipAsync(files: Zippable, level: number = 6): Promise<Uint8Array> {
  const deflateAsync = _nativeDeflateAsync;
  if (!deflateAsync) throw new Error("Native async deflate not available");
  const crc = _nativeCrc32 ?? computeCrc32;

  // All entries deflate in parallel — node:zlib async calls run on the libuv
  // thread pool, so a multi-part package compresses in roughly one-deflate
  // wall clock instead of the sum (pool size caps true parallelism; task
  // queueing is cheap relative to the deflate work itself). CRC runs inline
  // on the main thread before each entry's first await.
  const entries = (
    await Promise.all(
      Object.keys(files).map(async (key): Promise<Entry | null> => {
        const raw = files[key];
        if (raw === undefined) return null; // Object.keys guarantees presence; guard narrows the type
        const { data, level: entryLevel } = resolveEntryData(raw, level);
        const c = crc(data);
        const { compressed, method } = await compressOneAsync(data, entryLevel, deflateAsync);
        return {
          filename: textEncoder.encode(key),
          data: compressed,
          uncompressedSize: data.length,
          crc: c,
          method,
          localOffset: 0,
        };
      }),
    )
  ).filter((e): e is Entry => e !== null);

  return writeZipBuffer(entries);
}

// Fixed-size chunks fed to the ReadableStream — large enough to amortize the
// per-enqueue cost, small enough to keep an interactive consumer's first read.
const STREAM_CHUNK_SIZE = 1 << 16;

/**
 * Streaming counterpart of {@link nativeZipAsync}: compresses on the libuv
 * thread pool, then emits the finished archive through a `ReadableStream` in
 * fixed-size chunks. Node only — Bun and browsers keep fflate's incremental
 * path (see {@link prefersMainThreadDeflate}). The memory shape matches the
 * fflate stream (entries are fully resident post-compile either way); the win
 * is dropping fflate's per-entry worker spawn, which costs milliseconds per
 * part on Node's worker_threads and dominates small-package streams.
 */
export function nativeZipStream(files: Zippable, level: number = 6): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const buf = await nativeZipAsync(files, level);
        for (let o = 0; o < buf.length; o += STREAM_CHUNK_SIZE) {
          controller.enqueue(buf.subarray(o, Math.min(o + STREAM_CHUNK_SIZE, buf.length)));
        }
        controller.close();
      } catch (err) {
        controller.error(err instanceof Error ? err : new Error(String(err)));
      }
    },
  });
}

// ── LE read helpers (ZIP parsing) ──

function rU16(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8);
}

function rU32(b: Uint8Array, o: number): number {
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}

// ── ZIP central-directory parsing ──

const EOCD_MAGIC = 0x06054b50;
const CD_MAGIC = 0x02014b50;

/** One archive entry as resolved from the central directory. */
export interface ZipEntryMeta {
  name: string;
  method: number;
  compSize: number;
  crc: number;
  dataStart: number;
}

/** Locate the End-of-Central-Directory record (within a 64 KB comment window). */
function findEocd(b: Uint8Array): number {
  const min = Math.max(0, b.length - 65557); // 22-byte EOCD + up to 65535-byte comment
  for (let i = b.length - 22; i >= min; i--) {
    if (rU32(b, i) === EOCD_MAGIC) return i;
  }
  throw new Error("ZIP EOCD record not found");
}

/** Walk the central directory and resolve each entry's payload offset. */
export function readCentralDirectory(buf: Uint8Array): ZipEntryMeta[] {
  const eocd = findEocd(buf);
  const count = rU16(buf, eocd + 10);
  const cdOffset = rU32(buf, eocd + 16);
  const entries: ZipEntryMeta[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (rU32(buf, p) !== CD_MAGIC) throw new Error(`ZIP central directory corrupt at offset ${p}`);
    const method = rU16(buf, p + 10);
    const crc = rU32(buf, p + 16);
    const compSize = rU32(buf, p + 20);
    const nameLen = rU16(buf, p + 28);
    const extraLen = rU16(buf, p + 30);
    const cmtLen = rU16(buf, p + 32);
    const localOff = rU32(buf, p + 42);
    // Uint8Array.toString() yields "120,46,..." (comma-joined bytes), not the
    // UTF-8 string — decode explicitly so entry names are real paths.
    const name = textDecoder.decode(buf.subarray(p + 46, p + 46 + nameLen));
    // The local header carries its own name/extra lengths, which can differ
    // from the CD's; read them to locate the entry's payload precisely.
    const lNameLen = rU16(buf, localOff + 26);
    const lExtraLen = rU16(buf, localOff + 28);
    entries.push({
      name,
      method,
      compSize,
      crc,
      dataStart: localOff + 30 + lNameLen + lExtraLen,
    });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return entries;
}

/**
 * Inflate a single entry resolved by {@link readCentralDirectory}, without
 * materializing the rest of the archive. Mirrors the per-entry work of the
 * former eager `nativeUnzip`: native zlib inflate + CRC-32 where available
 * (Node/Bun), fflate `inflateSync` elsewhere (no CRC check — fflate parity).
 * STORE entries are copied out of the source buffer.
 */
export function inflateZipEntry(buf: Uint8Array, entry: ZipEntryMeta): Uint8Array {
  const raw = buf.subarray(entry.dataStart, entry.dataStart + entry.compSize);
  if (entry.method === 0) return raw.slice();
  if (_nativeInflate) {
    const dec = _nativeInflate(raw);
    // >>> 0 normalizes the signed CRC_TABLE accumulation against zlib's unsigned crc32.
    if ((_nativeCrc32 ?? computeCrc32)(dec) >>> 0 !== entry.crc)
      throw new Error(`ZIP CRC-32 mismatch: ${entry.name}`);
    return dec;
  }
  return inflateSync(raw);
}

// ── Native streaming DEFLATE entry ──

/**
 * Streaming DEFLATE ZIP entry backed by `zlib.createDeflateRaw` instead of
 * fflate's JS engine or per-entry worker — Node only (constructor throws when
 * no native zlib resolved; callers pick the fflate entries elsewhere).
 *
 * Implements fflate's Zip entry contract by subclassing `ZipPassThrough` and
 * overriding `process` — fflate's documented subclassing point — to feed a
 * libuv-pool deflate stream: zero thread spawn (AsyncZipDeflate costs ~5-10ms
 * per part on worker_threads, dominating the many-small-parts OPC shape) while
 * compression still runs off the main thread, so chunked generation overlaps
 * with deflate. `compression`/`flag` mirror what ZipDeflate sets (flag = the
 * same deflate-level hint bits fflate computes), which Zip reads for the
 * local header.
 */
export class NativeZipDeflate extends ZipPassThrough {
  /** General-purpose flag bits, mirroring ZipDeflate's level hint. */
  readonly flag: 0 | 1 | 2 | 3;
  private readonly z: ZlibNode.DeflateRaw;

  constructor(filename: string, opts?: { level?: ZipOptions["level"] }) {
    super(filename);
    if (_zlibModule === undefined) throw new Error("Native deflate not available");
    const level = opts?.level;
    this.flag = level === 1 ? 3 : level !== undefined && level < 6 ? 2 : level === 9 ? 1 : 0;
    this.compression = 8;
    this.z = _zlibModule.createDeflateRaw({ level });
    // 'data' arrives on the microtask queue after each libuv-pool flush; Zip
    // buffers entry output until its own ordering pass, so async ondata is
    // contract-legal (AsyncZipDeflate delivers the same way). 'end' fires
    // after the final 'data', closing the entry with an empty final chunk.
    // zlib chunks are never shared-memory buffers; the cast only widens the
    // declared ArrayBufferLike to fflate's ArrayBuffer parameter type.
    this.z.on("data", (dat: Uint8Array) =>
      this.ondata(null, dat as Uint8Array<ArrayBuffer>, false),
    );
    this.z.on("error", (err: Error) => this.ondata(err as FlateError, new Uint8Array(0), true));
    this.z.on("end", () => this.ondata(null, new Uint8Array(0), true));
  }

  /** Feed a source chunk; `final` ends the deflate stream. */
  protected process(chunk: Uint8Array<ArrayBuffer>, final: boolean): void {
    // write() backpressure is ignored on purpose: the producer is a
    // synchronous serialize loop, and zlib's internal buffer is bounded by
    // how fast the pool drains — the same regime the worker path had.
    this.z.write(chunk);
    if (final) this.z.end();
    else this.z.flush(); // Z_SYNC_FLUSH — emit each chunk's bytes promptly
  }
}
