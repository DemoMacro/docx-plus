import { bench, describe } from "vite-plus/test";

import { generateDocumentSync, parseDocumentSync } from "./index";

// Parse benchmarks — the editor's "open document" path. Fixtures are
// generated once (default compression, matching real-world DEFLATE'd files)
// and parsed back: parseDocument → round-trip DocumentOptions (the editing
// model). dolanmiu/docx has no parse API, so there is no JS competitor row.

// ── Image generation ──

const makeImage = (seed: number, sizeKB: number): Uint8Array => {
  const size = sizeKB * 1024;
  const buf = new Uint8Array(size);
  for (let i = 0; i < size; i++) buf[i] = (i * 7 + seed * 13 + 37) & 0xff;
  return buf;
};

const SMALL_IMAGES = Array.from({ length: 3 }, (_, i) => makeImage(i, 200));
const LARGE_IMAGES = Array.from({ length: 20 }, (_, i) => makeImage(i, 500));

// ── Fixtures (buffers generated once at module load) ──

const SIMPLE_BUF = generateDocumentSync({
  sections: [
    {
      children: [
        { paragraph: "Hello World" },
        { paragraph: "Second paragraph" },
        {
          paragraph: {
            children: [
              {
                picture: {
                  data: SMALL_IMAGES[0]!,
                  transformation: { width: 400, height: 300 },
                  type: "jpg",
                },
              },
            ],
          },
        },
      ],
    },
  ],
});

const STYLED_BUF = generateDocumentSync({
  sections: [
    {
      children: [
        ...Array.from({ length: 20 }, (_, i) => ({
          paragraph: {
            children: [
              {
                text: `Paragraph text line ${i + 1} with some content`,
                bold: i % 3 === 0,
                italic: i % 5 === 0,
              },
            ],
          },
        })),
        {
          paragraph: {
            children: [
              {
                picture: {
                  data: SMALL_IMAGES[1]!,
                  transformation: { width: 400, height: 300 },
                  type: "jpg",
                },
              },
            ],
          },
        },
      ],
    },
  ],
});

const TABLE_BUF = generateDocumentSync({
  sections: [
    {
      children: [
        {
          table: {
            rows: Array.from({ length: 10 }, (_, rowIdx) => ({
              cells: Array.from({ length: 5 }, (_, colIdx) => ({
                children: [{ paragraph: `R${rowIdx + 1}C${colIdx + 1}` }],
              })),
            })),
          },
        },
      ],
    },
  ],
});

const LARGE_PARAGRAPHS_BUF = generateDocumentSync({
  sections: [
    {
      children: Array.from({ length: 2000 }, (_, i) =>
        // Every 100th paragraph carries an image (20 images total).
        // LARGE_IMAGES has 20 entries; (i / 100 | 0) % 20 is always in range.
        i % 100 === 0
          ? {
              paragraph: {
                children: [
                  {
                    picture: {
                      data: LARGE_IMAGES[Math.floor(i / 100) % LARGE_IMAGES.length]!,
                      transformation: { width: 400, height: 300 },
                      type: "jpg" as const,
                    },
                  },
                ],
              },
            }
          : { paragraph: `Paragraph ${i + 1} with some benchmark content` },
      ),
    },
  ],
});

const LARGE_TABLE_BUF = generateDocumentSync({
  sections: [
    {
      children: [
        {
          table: {
            rows: Array.from({ length: 200 }, (_, rowIdx) => ({
              cells: Array.from({ length: 10 }, (_, colIdx) => ({
                children: [{ paragraph: `R${rowIdx + 1}C${colIdx + 1} data content` }],
              })),
            })),
          },
        },
      ],
    },
  ],
});

// ── Benchmarks ──

describe("DOCX: Parse", () => {
  bench(
    "ours parse — simple (2p + 1 img)",
    () => {
      parseDocumentSync(SIMPLE_BUF);
    },
    {
      iterations: 50,
    },
  );

  bench(
    "ours parse — styled paragraphs (20) + 1 img",
    () => {
      parseDocumentSync(STYLED_BUF);
    },
    {
      iterations: 50,
    },
  );

  bench(
    "ours parse — table (10x5)",
    () => {
      parseDocumentSync(TABLE_BUF);
    },
    {
      iterations: 50,
    },
  );

  bench(
    "ours parse — 2000p + 20 img",
    () => {
      parseDocumentSync(LARGE_PARAGRAPHS_BUF);
    },
    {
      iterations: 10,
    },
  );

  bench(
    "ours parse — 200x10 table",
    () => {
      parseDocumentSync(LARGE_TABLE_BUF);
    },
    {
      iterations: 10,
    },
  );
});
