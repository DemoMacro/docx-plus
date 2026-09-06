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
