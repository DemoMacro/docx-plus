/**
 * Byte-level strip of oversized `o:gfxdata` attribute values from XML parts.
 *
 * `o:gfxdata` (ISO/IEC 29500-4 §19.1.2.19) carries a base64 DrawingML
 * snapshot alongside VML fallback markup; per the spec's own rationale the
 * VML child elements handle the visual display and the attribute only
 * persists the original content for DrawingML-aware consumers. Generators
 * that copy-paste VML shapes duplicate the snapshot per copy, inflating
 * document.xml into the gigabyte range (measured corpus: 42 values,
 * 1.57 GB, 87.7% of the part) and hard-crashing XML parse at the JS string
 * length cap. The attribute is unmodeled on v:group — the model layer
 * already drops it there — so stripping oversized values loses nothing the
 * parse would have kept; the threshold spares normal shape snapshots
 * (tens of KB).
 *
 * @module
 */

/**
 * Attribute values above this size (1 MB — far above any legitimate shape
 * snapshot) are stripped before XML parse.
 */
export const GFXDATA_STRIP_THRESHOLD = 1024 * 1024;

const NEEDLE = 'o:gfxdata="';

/**
 * Remove `o:gfxdata="…"` attributes whose value exceeds `threshold` bytes.
 * Single scan to size the output (a subarray view would pin the oversized
 * source buffer), then one copy pass. Returns the input unchanged when
 * nothing oversized is present; an unterminated attribute value is left
 * verbatim.
 */
export function stripOversizedGfxdata(
  xml: Uint8Array,
  threshold: number = GFXDATA_STRIP_THRESHOLD,
): Uint8Array {
  let cursor = 0;
  let kept = 0;
  const drops: Array<[number, number]> = [];
  for (;;) {
    const hit = findNeedle(xml, cursor);
    if (hit === -1) break;
    const valueStart = hit + NEEDLE.length;
    let close = valueStart;
    while (close < xml.length && xml[close] !== 0x22 /* " */) close++;
    if (close === xml.length) break;
    if (close - valueStart > threshold) {
      drops.push([hit, close + 1]);
      kept += hit - cursor;
    } else {
      kept += close + 1 - cursor;
    }
    cursor = close + 1;
  }
  if (drops.length === 0) return xml;

  const out = new Uint8Array(kept + (xml.length - cursor));
  let write = 0;
  let source = 0;
  for (const [start, end] of drops) {
    out.set(xml.subarray(source, start), write);
    write += start - source;
    source = end;
  }
  out.set(xml.subarray(source), write);
  return out;
}

/** First index of the needle at or after `from`, byte-wise. */
function findNeedle(xml: Uint8Array, from: number): number {
  const first = NEEDLE.charCodeAt(0); // "o"
  const last = xml.length - NEEDLE.length;
  for (let i = from; i <= last; i++) {
    if (xml[i] !== first) continue;
    let m = 1;
    while (m < NEEDLE.length && xml[i + m] === NEEDLE.charCodeAt(m)) m++;
    if (m === NEEDLE.length) return i;
  }
  return -1;
}

// ── Streaming variant ──
//
// Same semantics as {@link stripOversizedGfxdata} but over a chunk stream, so
// an oversized part never materializes: inflate streams through the transform
// and only the stripped output is buffered. A value is withheld (up to
// `threshold` bytes) until its closing quote arrives; past the threshold the
// rest of the value is dropped on sight. A value still open when the stream
// ends flushes verbatim — except one that already crossed the threshold,
// whose head is already gone (a truncated package XML parse would reject
// anyway).

const QUOTE = 0x22; // "
/** Chunks can split the needle; this many tail bytes are held back between chunks. */
const NEEDLE_LEN = NEEDLE.length;

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Transform stream removing oversized `o:gfxdata="…"` attribute values on the
 * fly. Feed it inflated XML chunks; the readable side yields the XML with
 * those attributes already gone.
 */
export function gfxdataStripStream(
  threshold: number = GFXDATA_STRIP_THRESHOLD,
): TransformStream<Uint8Array, Uint8Array> {
  // Tail of the last chunk that may hold a partial needle (≤ NEEDLE_LEN - 1).
  let carry: Uint8Array = new Uint8Array(0);
  // "collecting" withholds value bytes until the closing quote; past the
  // threshold it flips to "discarding" and the rest of the value is dropped.
  let mode: "scan" | "collecting" | "discarding" = "scan";
  let collected: number[] = [];
  let valueLen = 0;

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // Assemble carry+chunk once so a split needle is found by plain search;
      // the carry is bounded by NEEDLE_LEN - 1 bytes, so the copy is trivial.
      const buf = carry.length > 0 ? concatChunks([carry, chunk]) : chunk;
      carry = new Uint8Array(0);
      let i = 0;
      const out: Uint8Array[] = [];
      const emitPending = (): void => {
        if (out.length === 1) controller.enqueue(out[0]!);
        else if (out.length > 1) controller.enqueue(concatChunks(out));
      };
      while (true) {
        if (mode === "scan") {
          if (i >= buf.length) break;
          const hit = findNeedle(buf, i);
          if (hit === -1) {
            const keepFrom = Math.max(i, buf.length - (NEEDLE_LEN - 1));
            if (keepFrom > i) out.push(buf.subarray(i, keepFrom));
            carry = buf.slice(keepFrom);
            break;
          }
          if (hit > i) out.push(buf.subarray(i, hit));
          collected = Array.from(NEEDLE, (ch) => ch.charCodeAt(0));
          valueLen = 0;
          mode = "collecting";
          i = hit + NEEDLE_LEN;
        } else {
          let q = i;
          while (q < buf.length && buf[q] !== QUOTE) {
            if (mode === "collecting") {
              collected.push(buf[q]!);
              valueLen++;
              if (valueLen > threshold) {
                mode = "discarding";
                collected = [];
              }
            }
            q++;
          }
          if (q === buf.length) break;
          // Closing quote at q: a kept value rejoins the output (quote included).
          if (mode === "collecting") out.push(new Uint8Array(collected));
          out.push(buf.subarray(q, q + 1));
          collected = [];
          mode = "scan";
          i = q + 1;
        }
      }
      emitPending();
    },
    flush(controller) {
      if (mode === "collecting") controller.enqueue(new Uint8Array(collected));
      else if (mode === "scan" && carry.length > 0) controller.enqueue(carry);
      carry = new Uint8Array(0);
      collected = [];
    },
  });
}
