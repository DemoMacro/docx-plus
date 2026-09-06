import { mkdirSync, writeFileSync } from "node:fs";

import { parseArchive } from "@office-open/core";
import { generateWorkbook, parseWorkbook, parseXlsx } from "@office-open/xlsx";
import type { WorksheetOptions } from "@office-open/xlsx";
import { parse, stringify } from "@office-open/xml";
import { strFromU8 } from "fflate";

// ── helpers ────────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
const assert = (label: string, condition: boolean) => {
  if (condition) {
    pass++;
    console.log(`  PASS: ${label}`);
  } else {
    fail++;
    console.log(`  FAIL: ${label}`);
  }
};

function normalizeXml(raw: Uint8Array): string {
  const parsed = parse(strFromU8(raw), {
    nativeTypeAttributes: true,
    captureSpacesBetweenElements: true,
  });
  return stringify(parsed);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

interface Diff {
  path: string;
  kind: "missing-left" | "missing-right" | "content";
}

function compareZips(buf1: Uint8Array, buf2: Uint8Array, ignorePaths?: Set<string>): Diff[] {
  const zip1 = parseArchive(buf1);
  const zip2 = parseArchive(buf2);
  const diffs: Diff[] = [];

  const allPaths = new Set([...zip1.keys(), ...zip2.keys()]);

  for (const path of allPaths) {
    if (ignorePaths?.has(path)) continue;

    const raw1 = zip1.getRaw(path);
    const raw2 = zip2.getRaw(path);

    if (!raw1) {
      diffs.push({ path, kind: "missing-left" });
      continue;
    }
    if (!raw2) {
      diffs.push({ path, kind: "missing-right" });
      continue;
    }

    if (path.endsWith(".xml") || path.endsWith(".rels")) {
      const s1 = normalizeXml(raw1);
      const s2 = normalizeXml(raw2);
      if (s1 !== s2) {
        diffs.push({ path, kind: "content" });
      }
    } else {
      if (!bytesEqual(raw1, raw2)) {
        diffs.push({ path, kind: "content" });
      }
    }
  }

  return diffs;
}

function printDiffs(diffs: Diff[]): void {
  if (diffs.length === 0) {
    console.log("  No differences found!");
    return;
  }
  for (const d of diffs) {
    const label =
      d.kind === "missing-left"
        ? "only in buffer2"
        : d.kind === "missing-right"
          ? "only in buffer1"
          : "content differs";
    console.log(`  DIFF: ${d.path} (${label})`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Generate a workbook using the JSON-friendly API
// ══════════════════════════════════════════════════════════════════════════════

const sheets: WorksheetOptions[] = [
  {
    name: "Data",
    rows: [
      { cells: [{ value: "Name" }, { value: "Score" }, { value: "Pass" }] },
      { cells: [{ value: "Alice" }, { value: 95 }, { value: true }] },
      { cells: [{ value: "Bob" }, { value: 87 }, { value: true }] },
      { cells: [{ value: "Charlie" }, { value: 42 }, { value: false }] },
    ],
    columns: [{ min: 1, max: 1, width: 15 }],
    mergeCells: [{ ref: "A1:B1" }],
    freezePanes: { row: 1 },
    autoFilter: "A1:C4",
  },
  {
    name: "Numbers",
    rows: [
      { cells: [{ value: 100 }, { value: 200 }, { value: 300 }] },
      { cells: [{ value: 400 }, { value: 500 }, { value: 600 }] },
    ],
  },
];

const originalOpts = {
  title: "Round Trip Test",
  creator: "XLSX Parser",
  worksheets: sheets,
};

const buffer = await generateWorkbook(originalOpts);
console.log(`Generated XLSX: ${buffer.length} bytes`);

// ══════════════════════════════════════════════════════════════════════════════
// 2. Low-level parseXlsx verification (ParsedArchive API)
// ══════════════════════════════════════════════════════════════════════════════

console.log("\n--- parseXlsx (low-level) ---");
const { doc: xlsxDoc, workbook: wbEl, worksheets: wsPaths } = parseXlsx(buffer);

assert("2 worksheet paths", wsPaths.length === 2);
assert("sheet 1 path", wsPaths[0] === "xl/worksheets/sheet1.xml");
assert("has workbook element", !!wbEl);
assert("has xl/workbook.xml", xlsxDoc.has("xl/workbook.xml"));
assert("has xl/theme/theme1.xml", xlsxDoc.has("xl/theme/theme1.xml"));
assert("has xl/styles.xml", xlsxDoc.has("xl/styles.xml"));

// ══════════════════════════════════════════════════════════════════════════════
// 3. High-level parseWorkbook verification (WorkbookOptions API)
// ══════════════════════════════════════════════════════════════════════════════

console.log("\n--- parseWorkbook (high-level) ---");
const parsed = await parseWorkbook(buffer);

assert("2 worksheets parsed", parsed.worksheets!.length === 2);
assert("sheet 1 name", parsed.worksheets![0]?.name === "Data");
assert("sheet 2 name", parsed.worksheets![1]?.name === "Numbers");
assert("title preserved", parsed.title === "Round Trip Test");
assert("creator preserved", parsed.creator === "XLSX Parser");

const sheet1 = parsed.worksheets![0];
if (!sheet1) throw new Error("expected sheet 1 to be parsed");
assert("sheet 1 has 4 rows", sheet1.rows!.length === 4);
assert("sheet 1 has columns", sheet1.columns!.length === 1);
assert("sheet 1 has mergeCells", sheet1.mergeCells!.length === 1);
assert("sheet 1 has freezePanes", !!sheet1.freezePanes);
assert("sheet 1 has autoFilter", sheet1.autoFilter === "A1:C4");

// ══════════════════════════════════════════════════════════════════════════════
// 4. Round-trip: re-generate from parsed data → compare ZIPs
// ══════════════════════════════════════════════════════════════════════════════

console.log("\n--- Round-trip ZIP comparison ---");

const roundTripped = await generateWorkbook(parsed);
const buffer2 = roundTripped;
console.log(`Re-generated XLSX: ${buffer2.length} bytes`);

const ignorePaths = new Set(["docProps/core.xml"]);
const diffs = compareZips(buffer, buffer2, ignorePaths);
printDiffs(diffs);
assert("round-trip ZIPs match", diffs.length === 0);

// ══════════════════════════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════════════════════════

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);

mkdirSync(".temp", { recursive: true });
writeFileSync(".temp/8-round-trip.xlsx", buffer);
mkdirSync(".temp", { recursive: true });
writeFileSync(".temp/8-round-trip (round-trip).xlsx", buffer2);

if (fail > 0) process.exit(1);
