import { readXlsx as hucreReadXlsx } from "hucre";
import { bench, describe } from "vite-plus/test";

import { generateWorkbookSync, parseWorkbookSync } from "./index";

// Parse benchmarks — the editor's "open document" path. Fixtures are
// generated once (default compression, matching real-world DEFLATE'd files)
// and parsed back: parseWorkbook → round-trip WorkbookOptions (the editing
// model), hucre readXlsx → its sheet-array workbook.

// ── Image generation ──

const makeImage = (seed: number, sizeKB: number): Uint8Array => {
  const size = sizeKB * 1024;
  const buf = new Uint8Array(size);
  for (let i = 0; i < size; i++) buf[i] = (i * 7 + seed * 13 + 37) & 0xff;
  return buf;
};

const LARGE_IMAGES = Array.from({ length: 20 }, (_, i) => makeImage(i, 500));

// ── Fixtures (buffers generated once at module load) ──

const SIMPLE_ROWS = [
  ["Name", "Age", "City"],
  ["Alice", 30, "New York"],
  ["Bob", 25, "London"],
];

const STYLED_ROWS = Array.from({ length: 20 }, (_, i) => ({
  name: `Person ${i + 1}`,
  score: Math.round(Math.random() * 100),
  active: i % 2 === 0,
}));

const TABLE_ROWS = Array.from({ length: 10 }, (_, rowIdx) =>
  Array.from({ length: 5 }, (_, colIdx) => `R${rowIdx + 1}C${colIdx + 1}`),
);

const toWorksheet = (rows: (string | number | boolean)[][]) => ({
  rows: rows.map((row) => ({ cells: row.map((value) => ({ value })) })),
});

const SIMPLE_BUF = generateWorkbookSync({ worksheets: [toWorksheet(SIMPLE_ROWS)] });
const STYLED_BUF = generateWorkbookSync({
  worksheets: [toWorksheet(STYLED_ROWS.map((r) => [r.name, r.score, r.active]))],
});
const TABLE_BUF = generateWorkbookSync({ worksheets: [toWorksheet(TABLE_ROWS)] });

const LARGE_ROWS_BUF = generateWorkbookSync({
  worksheets: [
    {
      ...toWorksheet(
        Array.from({ length: 2000 }, (_, i) => [
          `Row ${i + 1}`,
          Math.round(Math.random() * 1000),
          i % 2 === 0,
          `Data ${i + 1} content for realistic spreadsheet simulation`,
        ]),
      ),
      images: Array.from({ length: 10 }, (_, i) => ({
        // LARGE_IMAGES has 20 entries; i < 10, so the index is always in range.
        data: LARGE_IMAGES[i]!,
        type: "jpg" as const,
        col: 5,
        row: i * 200,
      })),
    },
  ],
});

const LARGE_TABLE_BUF = generateWorkbookSync({
  worksheets: [
    toWorksheet(
      Array.from({ length: 200 }, (_, rowIdx) =>
        Array.from({ length: 10 }, (_, colIdx) => `R${rowIdx + 1}C${colIdx + 1} data content`),
      ),
    ),
  ],
});

const DATA_100K_BUF = generateWorkbookSync({
  worksheets: [
    toWorksheet(
      Array.from({ length: 100_000 }, (_, i) => [
        i + 1,
        `Employee ${i + 1}`,
        `Dept ${(i % 12) + 1}`,
        Math.round(30000 + Math.random() * 120000),
        `City ${(i % 50) + 1}`,
        i % 2 === 0,
        `2024-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
        22 + (i % 40),
        Math.round(Math.random() * 100),
        `Region ${String.fromCharCode(65 + (i % 26))}`,
        `user${i + 1}@example.com`,
        `(${String(100 + (i % 900))}) ${String(100 + (i % 900))}-${String(1000 + (i % 9000))}`,
        `${(i % 200) + 1} Main St, City ${(i % 50) + 1}`,
        `Title ${(i % 15) + 1}`,
        (i % 5) + 1,
        (Math.random() * 5).toFixed(1),
        Math.round(Math.random() * 20000),
        Math.round(Math.random() * 30000),
        Math.round(Math.random() * 80000),
        `Memo for employee ${i + 1} with additional notes`,
      ]),
    ),
  ],
});

// ── Benchmarks ──

describe("XLSX: Parse", () => {
  bench(
    "ours parse — simple (3 rows)",
    () => {
      parseWorkbookSync(SIMPLE_BUF);
    },
    {
      iterations: 50,
    },
  );

  bench(
    "hucre parse — simple (3 rows)",
    async () => {
      await hucreReadXlsx(SIMPLE_BUF);
    },
    {
      iterations: 50,
    },
  );

  bench(
    "ours parse — styled rows (20)",
    () => {
      parseWorkbookSync(STYLED_BUF);
    },
    {
      iterations: 50,
    },
  );

  bench(
    "hucre parse — styled rows (20)",
    async () => {
      await hucreReadXlsx(STYLED_BUF);
    },
    {
      iterations: 50,
    },
  );

  bench(
    "ours parse — table (10x5)",
    () => {
      parseWorkbookSync(TABLE_BUF);
    },
    {
      iterations: 50,
    },
  );

  bench(
    "hucre parse — table (10x5)",
    async () => {
      await hucreReadXlsx(TABLE_BUF);
    },
    {
      iterations: 50,
    },
  );

  bench(
    "ours parse — 2000 rows + 10 img",
    () => {
      parseWorkbookSync(LARGE_ROWS_BUF);
    },
    {
      iterations: 10,
    },
  );

  bench(
    "hucre parse — 2000 rows + 10 img",
    async () => {
      await hucreReadXlsx(LARGE_ROWS_BUF);
    },
    {
      iterations: 10,
    },
  );

  bench(
    "ours parse — 200x10 table",
    () => {
      parseWorkbookSync(LARGE_TABLE_BUF);
    },
    {
      iterations: 10,
    },
  );

  bench(
    "hucre parse — 200x10 table",
    async () => {
      await hucreReadXlsx(LARGE_TABLE_BUF);
    },
    {
      iterations: 10,
    },
  );

  bench(
    "ours parse — 100k×20 data",
    () => {
      parseWorkbookSync(DATA_100K_BUF);
    },
    {
      iterations: 3,
    },
  );

  bench(
    "hucre parse — 100k×20 data",
    async () => {
      await hucreReadXlsx(DATA_100K_BUF);
    },
    {
      iterations: 3,
    },
  );
});
