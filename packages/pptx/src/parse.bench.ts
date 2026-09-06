import { bench, describe } from "vite-plus/test";

import { generatePresentationSync, parsePresentationSync } from "./index";

// Parse benchmarks — the editor's "open document" path. Fixtures are
// generated once (default compression, matching real-world DEFLATE'd files)
// and parsed back: parsePresentation → round-trip PresentationOptions (the
// editing model). PptxGenJS is write-only, so there is no JS competitor row.

// ── Image generation ──

const makeImage = (seed: number, sizeKB: number): Uint8Array => {
  const size = sizeKB * 1024;
  const buf = new Uint8Array(size);
  for (let i = 0; i < size; i++) buf[i] = (i * 7 + seed * 13 + 37) & 0xff;
  return buf;
};

const SMALL_IMAGES = Array.from({ length: 3 }, (_, i) => makeImage(i, 200));

// ── Fixtures (buffers generated once at module load) ──

const SIMPLE_BUF = generatePresentationSync({
  slides: [
    {
      children: [
        {
          shape: {
            x: 100,
            y: 100,
            width: 400,
            height: 200,
            textBody: { text: "Hello World" },
          },
        },
        {
          shape: {
            x: 200,
            y: 350,
            width: 500,
            height: 100,
            textBody: { text: "Second shape" },
          },
        },
        {
          picture: {
            x: 600,
            y: 100,
            width: 300,
            height: 200,
            data: SMALL_IMAGES[0]!,
            type: "jpg",
          },
        },
      ],
    },
  ],
});

const STYLED_BUF = generatePresentationSync({
  slides: [
    {
      children: [
        ...Array.from({ length: 20 }, (_, i) => ({
          shape: {
            x: 100,
            y: 100,
            width: 400,
            height: 200,
            fill: i % 3 === 0 ? "4472C4" : undefined,
            textBody: { text: `Shape text line ${i + 1} with some content` },
          },
        })),
        {
          picture: {
            x: 600,
            y: 100,
            width: 300,
            height: 200,
            data: SMALL_IMAGES[1]!,
            type: "jpg",
          },
        },
      ],
    },
  ],
});

const TABLE_BUF = generatePresentationSync({
  slides: [
    {
      children: [
        {
          table: {
            rows: Array.from({ length: 10 }, (_, rowIdx) => ({
              cells: Array.from({ length: 5 }, (_, colIdx) => ({
                text: `R${rowIdx + 1}C${colIdx + 1}`,
                fill: rowIdx === 0 ? "4472C4" : undefined,
              })),
            })),
          },
        },
      ],
    },
  ],
});

const MANY_SLIDES_BUF = generatePresentationSync({
  slides: Array.from({ length: 30 }, (_, si) => ({
    children: Array.from({ length: 20 }, (_, sh) => ({
      shape: {
        x: 100 + (sh % 5) * 200,
        y: 100 + Math.floor(sh / 5) * 150,
        width: 180,
        height: 130,
        textBody: { text: `Slide ${si + 1} shape ${sh + 1}` },
      },
    })),
  })),
});

// ── Benchmarks ──

describe("PPTX: Parse", () => {
  bench(
    "ours parse — simple (2 shapes + 1 img)",
    () => {
      parsePresentationSync(SIMPLE_BUF);
    },
    {
      iterations: 50,
    },
  );

  bench(
    "ours parse — styled shapes (20) + 1 img",
    () => {
      parsePresentationSync(STYLED_BUF);
    },
    {
      iterations: 50,
    },
  );

  bench(
    "ours parse — table (10x5)",
    () => {
      parsePresentationSync(TABLE_BUF);
    },
    {
      iterations: 50,
    },
  );

  bench(
    "ours parse — 30 slides × 20 shapes",
    () => {
      parsePresentationSync(MANY_SLIDES_BUF);
    },
    {
      iterations: 10,
    },
  );
});
