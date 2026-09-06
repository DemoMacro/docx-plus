# @office-open/xlsx

![npm version](https://img.shields.io/npm/v/@office-open/xlsx)
![npm downloads](https://img.shields.io/npm/dw/@office-open/xlsx)
![npm license](https://img.shields.io/npm/l/@office-open/xlsx)

> Create Excel spreadsheets (.xlsx) in TypeScript and JavaScript — generate, parse, and patch from plain JSON, no Microsoft Office required. Built for AI agents and hand-written code alike; runs in Node.js, browsers, Deno, and Bun.

## Features

- 📗 **Workbook Generation** — Create spreadsheets with multiple worksheets
- 📊 **Cell Data** — Strings, numbers, booleans, dates, and inline strings
- 🎨 **Styles** — Fonts, fills, borders, alignment, and number formats via index-based style system
- 🔀 **Merged Cells** — Merge cell ranges across rows and columns
- 📏 **Column Width & Row Height** — Custom column widths and row heights with hiding support
- ❄️ **Freeze Panes** — Freeze rows and/or columns for scrollable headers
- 🔽 **Auto Filter** — Add auto-filter dropdowns to column headers
- 🖼️ **Images** — Embed PNG and JPEG images anchored to cells
- 📈 **Charts** — Bar, line, pie, area, and scatter charts with customization
- ✅ **Data Validation** — List, whole number, decimal, date, and custom validations
- 🎯 **Conditional Formatting** — Cell value-based rules with formatting
- 📊 **Pivot Tables** — Create pivot tables with various aggregation functions
- 💬 **Comments** — Cell comments with author tracking and rich text support
- 🔒 **Sheet & Workbook Protection** — Password-protect worksheets and workbook structure
- 📖 **Parsing** — Parse existing .xlsx files with `parseWorkbook` for round-trip workflows
- 🔧 **Template Patching** — Patch existing XLSX templates via placeholder replacement

## Installation

```bash
# pnpm
pnpm add @office-open/xlsx

# npm
npm install @office-open/xlsx

# yarn
yarn add @office-open/xlsx

# bun
bun add @office-open/xlsx
```

## Quick Start

```typescript
import { generateWorkbook } from "@office-open/xlsx";
import { writeFileSync } from "node:fs";

const buffer = await generateWorkbook({
  worksheets: [
    {
      name: "Sheet1",
      rows: [
        { cells: [{ value: "Name" }, { value: "Score" }] },
        { cells: [{ value: "Alice" }, { value: 95 }] },
        { cells: [{ value: "Bob" }, { value: 87 }] },
      ],
    },
  ],
});

writeFileSync("workbook.xlsx", buffer);
```

## API

- `generateWorkbook(options)` — generate a `.xlsx` file; `generateWorkbookSync` and `generateWorkbookStream` cover sync and streaming output
- `parseWorkbook(data)` — read a `.xlsx` back into `WorkbookOptions` from bytes, `Blob`, or `ReadableStream`; `parseWorkbookSync` covers synchronous parsing
- `patchWorkbook(input)` — patch an existing `.xlsx` template by placeholder replacement

Every input is a plain JSON object (`WorkbookOptions` and its option types). The full typed API reference lives in the [documentation](https://www.office-open.com/en/xlsx/); the same types are also frozen as JSON Schemas — `npx office-open schema slice xlsx WorkbookOptions`.

## Parsing

Read existing `.xlsx` files and re-create them as `WorkbookOptions`:

```typescript
import { parseWorkbook, generateWorkbook } from "@office-open/xlsx";
import { readFileSync, writeFileSync } from "node:fs";

const opts = await parseWorkbook(new Uint8Array(readFileSync("input.xlsx")));

// Modify parsed data, then re-generate
const buffer = await generateWorkbook(opts);
writeFileSync("output.xlsx", buffer);
```

## Examples

Check the [demo folder](https://github.com/DemoMacro/office-open/tree/main/packages/xlsx/demo) for working examples covering every feature.

## Benchmark

Performance vs [hucre](https://github.com/productdevbook/hucre) (higher ops/s is better, Windows 11; each scenario runs under both Node 24 and Bun 1.4).

**Default** = XML DEFLATE level 1; media matches MS Office Excel — already-compressed formats (PNG/JPEG/GIF) are STOREd, the rest (EMF/WMF/BMP/TIFF/…) use DEFLATE level 6. **All STORE** = no compression (`{ compression: { xml: 0, media: 0 } }`). hucre (async only) uses `CompressionStream("deflate-raw")` when available, falling back to STORE per entry.

```typescript
// Default (matches MS Office)
await generateWorkbook(options);
// All STORE (no compression)
await generateWorkbook(options, { compression: { xml: 0, media: 0 } });
// Stream as ReadableStream<Uint8Array> (pipe to a file / HTTP response)
generateWorkbookStream(options);
```

**Create + toBuffer / toStream**

| Scenario         | Runtime | Default sync | Default async | All STORE sync | All STORE async | Default stream | hucre       |
| ---------------- | ------- | ------------ | ------------- | -------------- | --------------- | -------------- | ----------- |
| Simple (3 rows)  | Node 24 | 1,992 ops/s  | 1,821 ops/s   | 16,644 ops/s   | 18,069 ops/s    | 781 ops/s      | 826 ops/s   |
|                  | Bun 1.4 | 9,862 ops/s  | 993 ops/s     | 32,644 ops/s   | 31,071 ops/s    | 1,005 ops/s    | 1,128 ops/s |
| Styled rows (20) | Node 24 | 1,819 ops/s  | 1,859 ops/s   | 16,499 ops/s   | 13,662 ops/s    | 834 ops/s      | 842 ops/s   |
|                  | Bun 1.4 | 9,072 ops/s  | 916 ops/s     | 23,892 ops/s   | 22,729 ops/s    | 1,092 ops/s    | 835 ops/s   |
| Table (10x5)     | Node 24 | 1,812 ops/s  | 2,084 ops/s   | 16,471 ops/s   | 13,092 ops/s    | 842 ops/s      | 766 ops/s   |
|                  | Bun 1.4 | 8,891 ops/s  | 935 ops/s     | 23,550 ops/s   | 21,559 ops/s    | 1,164 ops/s    | 806 ops/s   |

**Large Files — Create + toBuffer / toStream**

| Scenario                      | Runtime | Default sync | Default async | All STORE sync | All STORE async | Default stream | hucre      |
| ----------------------------- | ------- | ------------ | ------------- | -------------- | --------------- | -------------- | ---------- |
| 2000 rows + 10 images         | Node 24 | 117 ops/s    | 116 ops/s     | 142 ops/s      | 139 ops/s       | 125 ops/s      | 41.4 ops/s |
|                               | Bun 1.4 | 213 ops/s    | 192 ops/s     | 260 ops/s      | 243 ops/s       | 50.1 ops/s     | 44.0 ops/s |
| 200x10 table                  | Node 24 | 838 ops/s    | 985 ops/s     | 1,374 ops/s    | 1,129 ops/s     | 470 ops/s      | 263 ops/s  |
|                               | Bun 1.4 | 1,157 ops/s  | 609 ops/s     | 1,636 ops/s    | 1,549 ops/s     | 373 ops/s      | 270 ops/s  |
| 20 sheets × 100 rows + 20 img | Node 24 | 73.3 ops/s   | 70.0 ops/s    | 97.5 ops/s     | 97.1 ops/s      | 72.7 ops/s     | 23.5 ops/s |
|                               | Bun 1.4 | 158 ops/s    | 74.0 ops/s    | 160 ops/s      | 166 ops/s       | 28.2 ops/s     | 24.3 ops/s |

**Large Data — 100,000 rows × 20 columns (2M cells)**

| Scenario  | Runtime | Default sync | Default async | All STORE sync | All STORE async | Default stream | hucre      |
| --------- | ------- | ------------ | ------------- | -------------- | --------------- | -------------- | ---------- |
| 100k × 20 | Node 24 | 0.89 ops/s   | 0.90 ops/s    | 1.10 ops/s     | 1.10 ops/s      | 0.98 ops/s     | 0.46 ops/s |
|           | Bun 1.4 | 1.35 ops/s   | 1.12 ops/s    | 1.57 ops/s     | 1.84 ops/s      | 0.76 ops/s     | 0.56 ops/s |

**Stream** = `generateWorkbookStream` (default compression, fully drained). Plain-data workbooks stream through a constant-memory path — at 1M rows × 3 cols, peak RSS is +177 MB streamed vs +810 MB buffered. Scenarios with images fall back to the full-memory stream.

## Documentation

- [Documentation](https://www.office-open.com/en/xlsx/) — guides, API reference, and examples
- [Changelog](https://github.com/DemoMacro/office-open/releases) — release notes
- [Report Issues](https://github.com/DemoMacro/office-open/issues) — bug reports and feature requests

## Related Packages

- [office-open](https://www.npmjs.com/package/office-open) — all formats + CLI + AI SDK tools in one install
- [@office-open/docx](https://www.npmjs.com/package/@office-open/docx) — Word (.docx)
- [@office-open/pptx](https://www.npmjs.com/package/@office-open/pptx) — PowerPoint (.pptx)
- [@office-open/core](https://www.npmjs.com/package/@office-open/core) — shared OOXML infrastructure
- [@office-open/xml](https://www.npmjs.com/package/@office-open/xml) — XML parsing and serialization

## License

- [MIT](https://github.com/DemoMacro/office-open/blob/main/LICENSE) &copy; [Demo Macro](https://www.demomacro.com/)
