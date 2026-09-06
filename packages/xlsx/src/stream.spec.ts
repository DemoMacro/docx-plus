import { unzipSync } from "@office-open/core";
/**
 * Streaming path tests: the constant-memory output must be a valid XLSX that
 * parses back to the same data, and the feature gate must fall back (not
 * drop) for rich workbooks.
 *
 * @module
 */
import { describe, expect, it } from "vite-plus/test";

import { generateWorkbook, generateWorkbookStream } from "./index";
import { parseWorkbookSync } from "./parse";
import type { WorkbookOptions } from "./parts/file";
import { canStreamWorkbook } from "./stream";

const PLAIN: WorkbookOptions = {
  title: "Streamed",
  worksheets: [
    {
      name: "Data",
      rows: [
        { cells: [{ value: "Name" }, { value: "Age" }, { value: "Active" }] },
        { cells: [{ value: "Alice" }, { value: 30 }, { value: true }] },
        { cells: [{ value: "Bob <&>" }, { value: 25.5 }, { value: false }] },
        {
          cells: [
            { value: new Date(Date.UTC(2024, 0, 15)) },
            { value: null },
            { value: "=SUM(B2:B3)", formula: { formula: "SUM(B2:B3)", type: "normal" } },
          ],
        },
        { cells: [{ value: "dup" }, { value: "dup" }] },
      ],
    },
    { name: "EmptySheet" },
  ],
};

async function collectStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    parts.push(chunk);
    total += chunk.byteLength;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

describe("generateWorkbookStream", () => {
  it("routes plain data through the streaming path", () => {
    expect(canStreamWorkbook(PLAIN)).toBe(true);
  });

  it("falls back for rich workbooks", () => {
    const rich: WorkbookOptions = {
      ...PLAIN,
      worksheets: [{ name: "S", rows: [], freezePanes: { row: 1 } }],
    };
    expect(canStreamWorkbook(rich)).toBe(false);
  });

  it("unknown worksheet keys fail safe (fall back, not drop)", () => {
    const future = { ...PLAIN, worksheets: [{ name: "S", rows: [], someNewFeature: 1 }] };
    expect(canStreamWorkbook(future as unknown as WorkbookOptions)).toBe(false);
  });

  it("produces a valid ZIP with the expected parts", async () => {
    const bytes = await collectStream(generateWorkbookStream(PLAIN));
    const entries = unzipSync(bytes);
    expect(Object.keys(entries).sort()).toEqual(
      [
        "[Content_Types].xml",
        "_rels/.rels",
        "docProps/app.xml",
        "docProps/core.xml",
        "xl/_rels/workbook.xml.rels",
        "xl/styles.xml",
        "xl/theme/theme1.xml",
        "xl/workbook.xml",
        "xl/worksheets/sheet1.xml",
        "xl/worksheets/sheet2.xml",
      ].sort(),
    );
  });

  it("inline strings — no sharedStrings part, strings live in cells", async () => {
    const bytes = await collectStream(generateWorkbookStream(PLAIN));
    const entries = unzipSync(bytes);
    expect(entries["xl/sharedStrings.xml"]).toBeUndefined();
    const decoder = new TextDecoder();
    const sheet = decoder.decode(entries["xl/worksheets/sheet1.xml"]!);
    expect(sheet).toContain('t="inlineStr"');
    expect(sheet).toContain("<is><t>Alice</t></is>");
    expect(sheet).toContain("<is><t>Bob &lt;&amp;&gt;</t></is>");
  });

  it("round-trips to the same parsed data as the full path", async () => {
    const streamedBytes = await collectStream(generateWorkbookStream(PLAIN));
    const fullBytes = await generateWorkbook(PLAIN, { type: "uint8array" });
    const streamed = parseWorkbookSync(streamedBytes);
    const full = parseWorkbookSync(fullBytes);
    expect(streamed.worksheets?.length).toBe(full.worksheets?.length);
    const s1 = streamed.worksheets?.[0]?.rows;
    const f1 = full.worksheets?.[0]?.rows;
    expect(s1?.length).toBe(f1?.length);
    // Cell values compare 1:1 (full path uses SST, streaming uses inline —
    // both parse to the same plain values).
    for (const [i, row] of (s1 ?? []).entries()) {
      const fullRow = f1?.[i];
      expect(row.cells?.length).toBe(fullRow?.cells?.length);
      for (const [j, cell] of (row.cells ?? []).entries()) {
        expect(cell.value).toEqual(fullRow?.cells?.[j]?.value);
      }
    }
  });

  it("falls back to the full path for rich workbooks (still a valid stream)", async () => {
    const rich: WorkbookOptions = {
      worksheets: [{ name: "S", rows: [{ cells: [{ value: "x" }] }], freezePanes: { row: 1 } }],
    };
    const bytes = await collectStream(generateWorkbookStream(rich));
    const entries = unzipSync(bytes);
    const sheet = new TextDecoder().decode(entries["xl/worksheets/sheet1.xml"]!);
    expect(sheet).toContain("<pane "); // freezePanes survived the fallback
  });
});
