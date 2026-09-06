/**
 * Streaming inflate for oversized XML parts.
 *
 * DecompressionStream ("deflate-raw") runs inside the host (Chromium threads,
 * Node's stream implementation), so a multi-hundred-MB part inflates without
 * blocking the main thread and — piped through {@link gfxdataStripStream} —
 * without ever materializing: only the stripped output is buffered. The sync
 * path (native zlib / fflate) would have to allocate the full uncompressed
 * size up front, which is exactly where gigabyte-scale document.xml dies in
 * the browser.
 *
 * @module
 */
import type { ByteSource } from "./byte-source";
import { gfxdataStripStream, stripOversizedGfxdata } from "./gfxdata";
import { inflateRawWindow, type ZipEntryMeta } from "./zip-native";

/**
 * XML parts whose uncompressed size exceeds this inflate through the
 * streaming pipeline instead of the sync path. Normal document parts are a
 * few MB; the threshold keeps the (slightly slower) streaming machinery off
 * the hot path for ordinary packages.
 */
export const STREAMING_XML_THRESHOLD = 32 * 1024 * 1024;

/**
 * Inflate a compressed zip entry from `source`, streaming when the entry is
 * an oversized XML part (the gfxdata-stripping transform rides along) and
 * reading a plain window otherwise. STORE entries skip decompression. No
 * CRC-32 is verified on the streaming path — the JS table costs more than
 * the inflate itself at these sizes, and the fflate fallback parity is
 * check-free by contract. XML parts get oversized `o:gfxdata` values
 * stripped on both paths, matching the bytes-backed archive behavior.
 */
export async function inflateEntryFrom(
  source: ByteSource,
  entry: ZipEntryMeta,
): Promise<Uint8Array> {
  const xml = entry.name.endsWith(".xml");
  const raw = await source.read(entry.dataStart, entry.compSize);
  if (entry.method === 0) return xml ? stripOversizedGfxdata(raw) : raw;
  const streaming =
    xml && entry.uncompSize > STREAMING_XML_THRESHOLD && typeof DecompressionStream !== "undefined";
  if (streaming) return inflateRawStreaming(source, entry);
  // Sync window — native zlib + CRC where available, fflate otherwise.
  const data = inflateRawWindow(raw, entry);
  return xml ? stripOversizedGfxdata(data) : data;
}

/** Stream `slice → DecompressionStream → gfxdata strip` and join the output. */
async function inflateRawStreaming(source: ByteSource, entry: ZipEntryMeta): Promise<Uint8Array> {
  const decoded = source
    .stream(entry.dataStart, entry.compSize)
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .pipeThrough(gfxdataStripStream());
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = decoded.getReader();
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
