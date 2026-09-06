import { unzipSync } from "fflate";
import { describe, expect, it } from "vite-plus/test";

import { generateDocument } from "../generate";
import { parseDocumentSync } from "../parse";

/** Unzip a generated package and decode one part as UTF-8 text. */
function decodePart(output: Uint8Array, path: string): string {
  const unzipped = unzipSync(output);
  const entry = unzipped[path];
  expect(entry, `${path} should be zipped`).toBeDefined();
  return new TextDecoder().decode(entry);
}

describe("header/footer part naming", () => {
  const doc = {
    sections: [
      {
        children: [{ paragraph: { children: [{ text: "Body" }] } }],
        headers: {
          even: [{ paragraph: { children: [{ text: "Even header" }] } }],
          default: [{ paragraph: { children: [{ text: "Default header" }] } }],
        },
      },
    ],
  };

  it("parses back the source part name per slot (round-trip pin)", async () => {
    const output = await generateDocument(doc, { type: "uint8array" });
    const opts = parseDocumentSync(output);

    const headers = opts.sections?.[0]?.headers;
    expect(headers?.partNames).toEqual({
      default: "header1.xml",
      even: "header2.xml",
    });
  });

  it("keeps content in the same part file when round-tripped", async () => {
    const first = await generateDocument(doc, { type: "uint8array" });
    const second = await generateDocument(parseDocumentSync(first), { type: "uint8array" });

    // Content stays in its source part instead of sliding to the next file
    // when the slot iteration order differs from the numbering.
    expect(decodePart(second, "word/header1.xml")).toContain("Default header");
    expect(decodePart(second, "word/header2.xml")).toContain("Even header");
  });
});
