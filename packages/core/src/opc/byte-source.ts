/**
 * Random-access binary source abstraction.
 *
 * A `File`/`Blob` input has random access through `slice()` — and that is
 * the whole point: an archive opened through a Blob source never
 * materializes its bytes as one contiguous buffer, so a multi-GB package
 * costs only the entry windows actually read (central directory, per-entry
 * payloads) instead of the whole file.
 *
 * @module
 */

/** Random-access reader over bytes living outside the JS heap. */
export interface ByteSource {
  readonly byteLength: number;
  /** Read `length` bytes at `offset`. The returned buffer is owned by the caller. */
  read(offset: number, length: number): Promise<Uint8Array>;
  /** Stream `length` bytes at `offset` — feeds decompression without a full read. */
  stream(offset: number, length: number): ReadableStream<Uint8Array<ArrayBuffer>>;
}

/** Blob/File source — every read is a `slice()` window, the package never materializes. */
export function blobSource(blob: Blob): ByteSource {
  return {
    byteLength: blob.size,
    async read(offset, length) {
      const buf = await blob.slice(offset, offset + length).arrayBuffer();
      return new Uint8Array(buf);
    },
    stream(offset, length) {
      return blob.slice(offset, offset + length).stream();
    },
  };
}
