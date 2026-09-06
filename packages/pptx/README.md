# @office-open/pptx

![npm version](https://img.shields.io/npm/v/@office-open/pptx)
![npm downloads](https://img.shields.io/npm/dw/@office-open/pptx)
![npm license](https://img.shields.io/npm/l/@office-open/pptx)

> Create PowerPoint presentations (.pptx) in TypeScript and JavaScript — generate, parse, and patch from plain JSON, no Microsoft Office required. Built for AI agents and hand-written code alike; runs in Node.js, browsers, Deno, and Bun.

## Features

- 🖥️ **Slide Management** — Create presentations with multiple slides, slide masters, and slide layouts
- 🔷 **Shapes** — Rectangles, ellipses, lines, connectors, and custom geometry shapes
- ✍️ **Text & Rich Formatting** — Paragraphs, runs, fonts, colors, alignment, and spacing
- 📊 **Tables** — Full table support with rows, cells, borders, and cell properties
- 📈 **Charts** — Bar, line, pie, area, and scatter charts with customization
- 🧩 **SmartArt** — Built-in SmartArt graphic generation with multiple layouts and styles
- 🖼️ **Images** — Inline pictures with fills, transformations, and effects
- 🎨 **Backgrounds** — Solid color, gradient, and picture backgrounds
- 🔄 **Transitions** — Slide transitions with various types and durations
- ✨ **Animations** — Entrance, emphasis, exit, and motion path animations
- 🎬 **Media** — Video and audio embedding
- 🔗 **Hyperlinks** — Clickable hyperlinks on shapes and text
- 📑 **Headers & Footers** — Slide header/footer with date, slide number
- 📝 **Notes** — Speaker notes for each slide
- 👥 **Group Shapes** — Group multiple shapes together
- 🖌️ **DrawingML** — Shapes with fills, outlines, shadows, glow, reflection, and 3D effects
- 📖 **Parsing** — Parse existing .pptx files with `parsePresentation` for round-trip workflows
- 🔧 **Template Patching** — Patch existing PPTX templates via placeholder replacement

## Installation

```bash
# pnpm
pnpm add @office-open/pptx

# npm
npm install @office-open/pptx

# yarn
yarn add @office-open/pptx

# bun
bun add @office-open/pptx
```

## Quick Start

```typescript
import { generatePresentation } from "@office-open/pptx";
import { writeFileSync } from "node:fs";

const buffer = await generatePresentation({
  slides: [
    {
      children: [
        {
          shape: {
            textBody: { text: "Hello World" },
            fill: "4472C4",
            x: 100,
            y: 100,
            width: 600,
            height: 400,
          },
        },
      ],
    },
  ],
});

writeFileSync("presentation.pptx", buffer);
```

## API

- `generatePresentation(options)` — generate a `.pptx` file; `generatePresentationSync` and `generatePresentationStream` cover sync and streaming output
- `parsePresentation(data)` — read a `.pptx` back into `PresentationOptions` from bytes, `Blob`, or `ReadableStream`; `parsePresentationSync` covers synchronous parsing
- `patchPresentation(input)` — patch an existing `.pptx` template by placeholder replacement

Every input is a plain JSON object (`PresentationOptions` and its option types). The full typed API reference lives in the [documentation](https://www.office-open.com/en/pptx/); the same types are also frozen as JSON Schemas — `npx office-open schema slice pptx PresentationOptions`.

## Parsing

Read existing `.pptx` files and re-create them as `PresentationOptions`:

```typescript
import { parsePresentation, generatePresentation } from "@office-open/pptx";
import { readFileSync, writeFileSync } from "node:fs";

const opts = await parsePresentation(new Uint8Array(readFileSync("input.pptx")));

// Modify parsed data, then re-generate
const buffer = await generatePresentation(opts);
writeFileSync("output.pptx", buffer);
```

## Benchmark

Performance vs [PptxGenJS](https://github.com/gitbrent/PptxGenJS) (higher ops/s is better, Windows 11; each scenario runs under both Node 24 and Bun 1.4).

**Default** = XML DEFLATE level 1; media matches MS Office PowerPoint — already-compressed formats (PNG/JPEG/GIF) are STOREd, the rest (EMF/WMF/BMP/TIFF/…) use DEFLATE level 6. **All STORE** = no compression (`{ compression: { xml: 0, media: 0 } }`). PptxGenJS (async only) defaults to STORE (JSZip) and applies DEFLATE to every entry with `compression: true`.

```typescript
// Default (matches MS Office)
await generatePresentation(options);
// All STORE (no compression)
await generatePresentation(options, { compression: { xml: 0, media: 0 } });
// Stream as ReadableStream<Uint8Array> (pipe to a file / HTTP response)
generatePresentationStream(options);
```

**Create + toBuffer / toStream**

| Scenario           | Runtime | Default sync | Default async | All STORE sync | All STORE async | Default stream | PptxGenJS DEFLATE | PptxGenJS STORE |
| ------------------ | ------- | ------------ | ------------- | -------------- | --------------- | -------------- | ----------------- | --------------- |
| Simple (2 shapes)  | Node 24 | 862 ops/s    | 1,150 ops/s   | 2,535 ops/s    | 2,878 ops/s     | 1,466 ops/s    | 177 ops/s         | 177 ops/s       |
|                    | Bun 1.4 | 2,016 ops/s  | 563 ops/s     | 4,327 ops/s    | 4,573 ops/s     | 326 ops/s      | 133 ops/s         | 133 ops/s       |
| Styled shapes (20) | Node 24 | 997 ops/s    | 1,161 ops/s   | 2,573 ops/s    | 2,355 ops/s     | 1,299 ops/s    | 165 ops/s         | 173 ops/s       |
|                    | Bun 1.4 | 2,367 ops/s  | 510 ops/s     | 3,992 ops/s    | 3,920 ops/s     | 390 ops/s      | 131 ops/s         | 145 ops/s       |
| Table (10x5)       | Node 24 | 1,149 ops/s  | 1,210 ops/s   | 2,940 ops/s    | 2,953 ops/s     | 1,403 ops/s    | 821 ops/s         | 885 ops/s       |
|                    | Bun 1.4 | 2,233 ops/s  | 508 ops/s     | 4,707 ops/s    | 4,101 ops/s     | 504 ops/s      | 842 ops/s         | 1,093 ops/s     |
| Full featured      | Node 24 | 789 ops/s    | 951 ops/s     | 1,760 ops/s    | 1,600 ops/s     | 1,063 ops/s    | 85.1 ops/s        | 89.8 ops/s      |
|                    | Bun 1.4 | 1,686 ops/s  | 499 ops/s     | 2,198 ops/s    | 2,396 ops/s     | 339 ops/s      | 71.4 ops/s        | 72.2 ops/s      |

**Large Files — Create + toBuffer / toStream**

| Scenario              | Runtime | Default sync | Default async | All STORE sync | All STORE async | Default stream | PptxGenJS DEFLATE | PptxGenJS STORE |
| --------------------- | ------- | ------------ | ------------- | -------------- | --------------- | -------------- | ----------------- | --------------- |
| 30 slides x 20 shapes | Node 24 | 197 ops/s    | 200 ops/s     | 345 ops/s      | 347 ops/s       | 233 ops/s      | 112 ops/s         | 120 ops/s       |
|                       | Bun 1.4 | 327 ops/s    | 89.0 ops/s    | 499 ops/s      | 458 ops/s       | 98.3 ops/s     | 125 ops/s         | 161 ops/s       |
| 30 slides x 10 images | Node 24 | 112 ops/s    | 112 ops/s     | 144 ops/s      | 144 ops/s       | 117 ops/s      | 0.298 ops/s       | 0.304 ops/s     |
|                       | Bun 1.4 | 204 ops/s    | 87.9 ops/s    | 224 ops/s      | 213 ops/s       | 32.9 ops/s     | 0.233 ops/s       | 0.232 ops/s     |
| 100x10 table          | Node 24 | 303 ops/s    | 327 ops/s     | 342 ops/s      | 401 ops/s       | 323 ops/s      | 117 ops/s         | 117 ops/s       |
|                       | Bun 1.4 | 395 ops/s    | 292 ops/s     | 530 ops/s      | 429 ops/s       | 209 ops/s      | 139 ops/s         | 150 ops/s       |
| 50 slides full        | Node 24 | 73.8 ops/s   | 71.5 ops/s    | 100 ops/s      | 92.5 ops/s      | 77.5 ops/s     | 0.906 ops/s       | 0.893 ops/s     |
|                       | Bun 1.4 | 124 ops/s    | 60.7 ops/s    | 143 ops/s      | 134 ops/s       | 25.8 ops/s     | 0.687 ops/s       | 0.686 ops/s     |

**Large File (~100MB) — Mixed Content**

40 slides x (2 shapes + 2 mixed-size images + 3x3 table).

| Scenario        | Runtime | Default sync | Default async | All STORE sync | All STORE async | Default stream | PptxGenJS DEFLATE | PptxGenJS STORE |
| --------------- | ------- | ------------ | ------------- | -------------- | --------------- | -------------- | ----------------- | --------------- |
| 40 slides mixed | Node 24 | 22.8 ops/s   | 20.9 ops/s    | 23.9 ops/s     | 23.5 ops/s      | 19.7 ops/s     | 0.214 ops/s       | 0.216 ops/s     |
|                 | Bun 1.4 | 34.8 ops/s   | 24.4 ops/s    | 28.9 ops/s     | 39.9 ops/s      | 4.80 ops/s     | 0.165 ops/s       | 0.165 ops/s     |

**Stream** = `generatePresentationStream` (default compression, fully drained). Under Node the archive is deflated in parallel on the libuv thread pool; under Bun and browsers it deflates inline / off-thread via fflate.

## Examples

Check the [demo folder](https://github.com/DemoMacro/office-open/tree/main/packages/pptx/demo) for working examples covering every feature.

## Documentation

- [Documentation](https://www.office-open.com/en/pptx/) — guides, API reference, and examples
- [Changelog](https://github.com/DemoMacro/office-open/releases) — release notes
- [Report Issues](https://github.com/DemoMacro/office-open/issues) — bug reports and feature requests

## Related Packages

- [office-open](https://www.npmjs.com/package/office-open) — all formats + CLI + AI SDK tools in one install
- [@office-open/docx](https://www.npmjs.com/package/@office-open/docx) — Word (.docx)
- [@office-open/xlsx](https://www.npmjs.com/package/@office-open/xlsx) — Excel (.xlsx)
- [@office-open/core](https://www.npmjs.com/package/@office-open/core) — shared OOXML infrastructure
- [@office-open/xml](https://www.npmjs.com/package/@office-open/xml) — XML parsing and serialization

## License

- [MIT](https://github.com/DemoMacro/office-open/blob/main/LICENSE) &copy; [Demo Macro](https://www.demomacro.com/)
