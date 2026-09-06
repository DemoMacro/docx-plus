import { describe, expect, it } from "vitest";

import { GFXDATA_STRIP_THRESHOLD, stripOversizedGfxdata } from "./gfxdata";
import { zipSync } from "./packer";
import { parseArchive } from "./parser";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

describe("stripOversizedGfxdata", () => {
  it("returns the input unchanged when no gfxdata attribute is present", () => {
    const xml = enc('<v:group id="g1"><v:shape/></v:group>');
    expect(stripOversizedGfxdata(xml)).toBe(xml);
  });

  it("keeps attribute values at or below the threshold", () => {
    const value = "A".repeat(64);
    const xml = enc(`<v:shape o:gfxdata="${value}" id="s1"/>`);
    expect(dec(stripOversizedGfxdata(xml))).toBe(dec(xml));
  });

  it("strips oversized values while keeping surrounding markup (byte-exact span)", () => {
    const value = "B".repeat(GFXDATA_STRIP_THRESHOLD + 1);
    const xml = enc(
      `<w:p><v:group id="g1" o:spid="_x0000_s1026" o:gfxdata="${value}" style="w:10"><v:shape/></v:group></w:p>`,
    );
    const out = stripOversizedGfxdata(xml);
    // Whitespace on either side of the dropped span stays — legal between
    // attributes and irrelevant to XML parse.
    expect(dec(out)).toBe(
      '<w:p><v:group id="g1" o:spid="_x0000_s1026"  style="w:10"><v:shape/></v:group></w:p>',
    );
  });

  it("strips several oversized values in one pass and keeps small ones between them", () => {
    const big1 = "C".repeat(GFXDATA_STRIP_THRESHOLD + 1);
    const big2 = "D".repeat(GFXDATA_STRIP_THRESHOLD + 2);
    const small = "E".repeat(32);
    const xml = enc(
      `<r a="1" o:gfxdata="${big1}" o:gfxdata="${small}" o:gfxdata="${big2}" b="2"/>`,
    );
    expect(dec(stripOversizedGfxdata(xml))).toBe(`<r a="1"  o:gfxdata="${small}"  b="2"/>`);
  });

  it("leaves an unterminated attribute value verbatim", () => {
    const value = "F".repeat(GFXDATA_STRIP_THRESHOLD + 1);
    const xml = enc(`<r o:gfxdata="${value}`);
    expect(dec(stripOversizedGfxdata(xml))).toBe(dec(xml));
  });

  it("honours a custom threshold", () => {
    const xml = enc(`<r o:gfxdata="${"G".repeat(16)}"/>`);
    expect(dec(stripOversizedGfxdata(xml, 8))).toBe("<r />");
  });
});

describe("ParsedArchive gfxdata defence", () => {
  it("strips oversized gfxdata from XML parts on read, leaves other parts intact", () => {
    const big = "H".repeat(GFXDATA_STRIP_THRESHOLD + 1);
    const documentXml = `<w:document><v:group o:gfxdata="${big}" id="g"/></w:document>`;
    const archive = parseArchive(
      zipSync({
        "word/document.xml": enc(documentXml),
        "word/media/k.pc": new Uint8Array([1, 2, 3]),
      } as never),
    );
    const el = archive.get("word/document.xml");
    // The attribute is gone from the element entirely.
    expect(el?.elements?.[0]?.attributes).toEqual({ id: "g" });
    // Binary parts are never scanned (native zlib inflate returns Buffer —
    // compare bytes, not prototypes).
    expect(Array.from(archive.getRaw("word/media/k.pc") ?? [])).toEqual([1, 2, 3]);
  });
});
