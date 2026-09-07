# office-open

English | [简体中文](./README.zh-CN.md)

[![npm downloads](https://img.shields.io/npm/dm/office-open)](https://www.npmjs.com/package/office-open)
[![GitHub Stars](https://img.shields.io/github/stars/DemoMacro/office-open)](https://github.com/DemoMacro/office-open/stargazers)
[![CI](https://github.com/DemoMacro/office-open/actions/workflows/default.yml/badge.svg)](https://github.com/DemoMacro/office-open/actions/workflows/default.yml)
![GitHub License](https://img.shields.io/github/license/DemoMacro/office-open)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](https://www.contributor-covenant.org/version/2/1/code_of_conduct/)

> AI-native Office documents for TypeScript and JavaScript.
> Create Word, Excel, and PowerPoint files (.docx, .xlsx, .pptx) from plain JSON or fully typed APIs — generate, parse, and patch. Built for AI agents, LLM tool-calling, and hand-written code alike; no Microsoft Office required, opens in every major office suite.

[Documentation](https://www.office-open.com) · [AI Integration](https://www.office-open.com/en/getting-started/ai-integration) · [Benchmarks](#performance) · [npm](https://www.npmjs.com/package/office-open)

⭐ **If office-open speeds up your work, a star helps other developers find it.**

## Features

- 📄 **All-in-One** — Word (.docx), Excel (.xlsx), and PowerPoint (.pptx) in one cohesive API — no server required, works offline
- 🤖 **AI Tooling** — Draft-07 JSON Schemas frozen from the TypeScript API, on-demand schema slicing for LLM context budgets (CLI + SDK tool), Vercel AI SDK tool definitions, and an installable Agent Skill
- 🧭 **100% OOXML Coverage** — All 2,191 elements and 1,923 attributes across the 18 OOXML Transitional schemas (WordprocessingML, PresentationML, SpreadsheetML, DrawingML, shared math, and VML) are implemented for both generation and parsing — tracked by automated XSD coverage tooling
- 📐 **Spec-Compliant** — Output validates against the OOXML Transitional XSD schemas (ISO/IEC 29500) and is verified to open in Microsoft Office, WPS Office, LibreOffice, and Google Workspace
- 🔒 **Fully Typed** — Comprehensive TypeScript definitions for autocomplete and type safety across every API
- 🔄 **Parse & Patch** — Read existing .docx, .pptx, .xlsx files for round-trip workflows, or patch templates by placeholder replacement
- 🎨 **Rich Content** — Paragraphs, tables, images, charts, SmartArt, math equations, effects, animations, and more
- 🔀 **Cross-Format Copy** — Convert pictures, shapes, tables, and text between formats; each format keeps its native types, conversions reuse shared `core` domains — no unified model layer
- ⚡ **High Performance** — Pure string concatenation for XML generation, no intermediate AST, native zlib compression — see the [benchmarks](#performance)
- 🌐 **Cross-Platform** — Node.js, browsers, Deno, Bun. Export to Buffer, Blob, Base64, stream, or string

## Performance

Highlights from the per-package benchmarks (ops/s, higher is better; Windows 11, Node 24 — the same scenarios run up to ~2× faster again on Bun 1.4). Compression matches MS Office defaults; full methodology, compression modes, and complete tables live in each package's README:

| Package                                                  | Scenario                        | @office-open | Competitor             | Faster   |
| -------------------------------------------------------- | ------------------------------- | ------------ | ---------------------- | -------- |
| [@office-open/docx](./packages/docx/README.md#benchmark) | Full-featured document + 2 imgs | 763 ops/s    | docx 9.6 — 54.2 ops/s  | **14×**  |
|                                                          | 2,000 paragraphs + 20 images    | 104 ops/s    | docx 9.6 — 2.85 ops/s  | **37×**  |
| [@office-open/pptx](./packages/pptx/README.md#benchmark) | 50 fully-styled slides          | 73.8 ops/s   | PptxGenJS — 0.91 ops/s | **81×**  |
| [@office-open/xlsx](./packages/xlsx/README.md#benchmark) | 100k rows × 20 cols (2M cells)  | 0.89 ops/s   | hucre — 0.46 ops/s     | **1.9×** |
| [@office-open/xml](./packages/xml/README.md#benchmark)   | Parse complex OOXML             | 424k ops/s   | txml — 389k ops/s      | **1.1×** |

## Packages

| Package                                         | Version                                                | Description                                          |
| ----------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| [office-open](./packages/office-open/README.md) | ![npm](https://img.shields.io/npm/v/office-open)       | Umbrella: all packages + CLI + AI SDK tools          |
| [@office-open/docx](./packages/docx/README.md)  | ![npm](https://img.shields.io/npm/v/@office-open/docx) | Word document generation, parsing, and patching      |
| [@office-open/pptx](./packages/pptx/README.md)  | ![npm](https://img.shields.io/npm/v/@office-open/pptx) | PowerPoint generation, parsing, and patching         |
| [@office-open/xlsx](./packages/xlsx/README.md)  | ![npm](https://img.shields.io/npm/v/@office-open/xlsx) | Spreadsheet generation, parsing, and patching        |
| [@office-open/core](./packages/core/README.md)  | ![npm](https://img.shields.io/npm/v/@office-open/core) | Shared OOXML infrastructure, charts, unit converters |
| [@office-open/xml](./packages/xml/README.md)    | ![npm](https://img.shields.io/npm/v/@office-open/xml)  | Low-level XML parsing and serialization              |

## Quick Start

```bash
# pnpm
pnpm add office-open

# npm
npm install office-open

# yarn
yarn add office-open

# bun
bun add office-open
```

The `office-open` package bundles all three format packages plus the CLI, JSON Schemas, and AI SDK tools. Prefer a smaller footprint? See [Packages](#packages) for the per-format `@office-open/*` packages.

```typescript
import { generateDocumentSync } from "office-open/docx";
import { writeFileSync } from "node:fs";

// Options are plain JSON objects — zero class instantiation
const buffer = generateDocumentSync({
  sections: [
    {
      children: [
        { paragraph: { heading: "Heading1", children: ["Document Title"] } },
        { paragraph: { children: [{ text: "Body text", italic: true }] } },
        {
          table: {
            rows: [
              { cells: [{ children: [{ paragraph: "A1" }] }, { children: [{ paragraph: "B1" }] }] },
              { cells: [{ children: [{ paragraph: "A2" }] }, { children: [{ paragraph: "B2" }] }] },
            ],
          },
        },
      ],
    },
  ],
});
writeFileSync("document.docx", buffer);
```

PowerPoint and Excel follow the same shape — `generatePresentationSync({ slides: [...] })` and `generateWorkbookSync({ worksheets: [...] })`; see the per-package READMEs linked above. There is also a type-dispatched `generate()` helper and a CLI:

```bash
npx office-open xlsx input.json "output.xlsx"
```

## Parse Existing Files

Read existing files back into the same structured options for inspection or round-trip editing — `parsePresentation` (pptx) and `parseWorkbook` (xlsx) mirror it:

```typescript
import { parseDocument } from "office-open/docx";

const opts = await parseDocument(buffer);
// opts.sections — document sections and content
// opts.title, opts.creator — core properties
```

## AI Integration

Give AI agents first-class Office document abilities — four ways, no glue code:

**Vercel AI SDK tools** — let Claude, GPT, and other models generate valid documents with schema-validated retries:

```typescript
import { generateText } from "ai";
import { officeOpenTools } from "office-open/ai";

const result = await generateText({
  model,
  prompt: "Create a quarterly report document",
  tools: officeOpenTools, // generate-docx / generate-pptx / generate-xlsx + schema lookup
});
```

**MCP server** — connect the documentation to Claude Code, Cursor, or any MCP client:

```bash
claude mcp add --transport http office-open https://www.office-open.com/mcp
```

**Agent Skill** — installable skill with curated API references for docx, pptx, and xlsx:

```bash
npx skills add https://www.office-open.com
```

**JSON Schemas** — frozen draft-07 schemas for your own tool-calling, sliced on demand to fit LLM context budgets:

```bash
npx office-open schema index docx
npx office-open schema slice docx ParagraphOptions
```

See the [AI integration guide](https://www.office-open.com/en/getting-started/ai-integration) for details.

## Versioning

This project follows [Semantic Versioning](https://semver.org/). While the major version is `0` (pre-1.0), breaking API changes are released as **minor** version bumps (`0.x.0`) rather than patch releases — the public API is expected to keep evolving until the `1.0.0` stabilization release. Pin exact versions in downstream projects if you require stability between minor updates.

## Development

Requires Node.js 18+ and pnpm 9+.

```bash
git clone https://github.com/DemoMacro/office-open.git
cd office-open
pnpm install

pnpm dev            # Development mode with watch
pnpm build          # Build all packages
pnpm test           # Run tests
pnpm check          # Lint & format
```

## Contributing

We welcome contributions! [Fork the repository](https://github.com/DemoMacro/office-open/fork), clone your fork, and add the upstream remote:

```bash
git clone https://github.com/YOUR_USERNAME/office-open.git
cd office-open
git remote add upstream https://github.com/DemoMacro/office-open.git
pnpm install
```

Then follow the workflow: code to the project standards, run `pnpm build && pnpm test`, commit with [conventional commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `refactor:`, …), push to your fork, and open a Pull Request against upstream.

## Support & Community

- [Documentation](https://www.office-open.com) — guides, API reference, and AI integration docs
- [Discussions](https://github.com/DemoMacro/office-open/discussions) — questions, ideas, and show-and-tell
- [Changelog](https://github.com/DemoMacro/office-open/releases) — release notes
- [Report Issues](https://github.com/DemoMacro/office-open/issues) — bug reports and feature requests

If office-open is useful to you, a [⭐ star](https://github.com/DemoMacro/office-open/stargazers) helps other developers find it.

## Sponsors

office-open is supported by [Wiseair-srl](https://github.com/Wiseair-srl) — their [json-to-office](https://json-to-office.com/) picks `@office-open/docx` as its quality-first DOCX renderer, with a live playground at [docx.json-to-office.com](https://docx.json-to-office.com/). Thank you! Want to support the project too? [GitHub Sponsors](https://github.com/sponsors/DemoMacro).

## Acknowledgements

This project's git history began as a fork of [dolanmiu/docx](https://github.com/dolanmiu/docx). The implementation has since been fully rewritten, but the API shape — sections, paragraphs, tables, runs — still follows the model that project established, and its design shaped our early direction. Thank you, [Dolan Miu](https://github.com/dolanmiu) and `docx` contributors, for the head start and the inspiration.

## License

This project is licensed under the MIT License — see the [LICENSE](./LICENSE) file for details.

---

Built with ❤️ by [Demo Macro](https://www.demomacro.com/)
