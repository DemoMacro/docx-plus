# docx-plus

[![NPM version][npm-image]][npm-url]
[![Downloads per month][downloads-image]][downloads-url]
[![GitHub Action Workflow Status][github-actions-workflow-image]][github-actions-workflow-url]
[![PRs Welcome][pr-image]][pr-url]

Easily generate and modify .docx files with JS/TS. Works for Node and on the Browser.

**docx-plus** is an enhanced fork of [docx](https://github.com/dolanmiu/docx) — a TypeScript/JavaScript library for generating and modifying Word documents (.docx) programmatically with a declarative API.

## What's Different from docx?

|                     | docx                                                                       | docx-plus                                                                                                                                         |
| ------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| ZIP handling        | jszip                                                                      | **fflate** (faster, smaller)                                                                                                                      |
| Data conversion     | Manual env detection (`Buffer.from` etc.)                                  | **undio** (universal `toUint8Array`)                                                                                                              |
| `Packer.toStream()` | Removed (pseudo-streaming)                                                 | **Restored** with real streaming ZIP                                                                                                              |
| Test environment    | jsdom                                                                      | happy-dom                                                                                                                                         |
| OOXML compliance    | ECMA-376 (legacy)                                                          | **ISO/IEC 29500-4** (latest)                                                                                                                      |
| Theme support       | Partial (missing `ThemeColor`/`ThemeFont`)                                 | **Full** (`ThemeColor`, `ThemeFont` enums, theme attributes on `Color`, `Underline`, `Border`, `Shading`)                                         |
| CT_Ind              | Twips-only indent                                                          | **Character-based** (`startChars`, `endChars`, `hangingChars`, `firstLineChars`)                                                                  |
| CT_Spacing          | Missing `beforeLines`/`afterLines`                                         | **Complete** (both twips & line-unit spacing)                                                                                                     |
| CT_Border           | Missing `shadow`/`frame`/theme attrs                                       | **Complete** (`shadow`, `frame`, `themeColor`, `themeTint`, `themeShade`)                                                                         |
| CT_Shd              | Missing theme fill/color attrs                                             | **Complete** (`themeColor`, `themeFill`, `themeTint`/`themeShade`)                                                                                |
| EG_RPrBase          | Missing `outline`/`shadow`/`webHidden`/`fitText`/`cs`                      | **Complete** (all spec-defined elements)                                                                                                          |
| ST_Em               | `dot` only                                                                 | **Complete** (`none`, `comma`, `circle`, `dot`, `underDot`)                                                                                       |
| ST_TabTlc           | Missing `heavy`                                                            | **Complete** (`none`, `dot`, `hyphen`, `middleDot`, `underscore`, `heavy`)                                                                        |
| CT_PPrBase          | Missing 9 paragraph props                                                  | **Complete** (`suppressAutoHyphens`, `adjustRightInd`, `snapToGrid`, `mirrorIndents`, East Asian typography, `textAlignment`, `textboxTightWrap`) |
| CT_SectPr           | Missing `noEndnote`/`bidi`/`rtlGutter`/`paperSrc`/`footnotePr`/`endnotePr` | **Complete** (all spec-defined elements)                                                                                                          |
| EG_RPrBase          | Missing `eastAsianLayout`                                                  | **Complete** (`eastAsianLayout` with `combine`, `combineBrackets`, `vert`, `vertCompress`)                                                        |

## Installation

```terminal
npm install --save docx-plus
```

```ts
import * as docx from "docx-plus";
// or
import { Document, Packer, Paragraph, TextRun } from "docx-plus";
```

## Quick Example

```ts
import * as fs from "fs";
import { Document, Packer, Paragraph, TextRun } from "docx-plus";

const doc = new Document({
    sections: [
        {
            children: [
                new Paragraph({
                    children: [
                        new TextRun("Hello World"),
                        new TextRun({
                            text: " - Bold text",
                            bold: true,
                        }),
                    ],
                }),
            ],
        },
    ],
});

const buffer = await Packer.toBuffer(doc);
fs.writeFileSync("My Document.docx", buffer);
```

## Documentation

Please refer to the [documentation](https://github.com/DemoMacro/docx-plus#readme) for details on how to use this library, examples and much more!

## Examples

Check the [demo folder](https://github.com/DemoMacro/docx-plus/tree/master/demo) for 90+ working examples covering every feature.

## Contributing

Contributions are welcome! Please feel free to submit pull requests.

---

[npm-image]: https://badge.fury.io/js/docx-plus.svg
[npm-url]: https://npmjs.org/package/docx-plus
[downloads-image]: https://img.shields.io/npm/dm/docx-plus.svg
[downloads-url]: https://npmjs.org/package/docx-plus
[github-actions-workflow-image]: https://github.com/DemoMacro/docx-plus/workflows/Default/badge.svg?branch=main
[github-actions-workflow-url]: https://github.com/DemoMacro/docx-plus/actions
[pr-image]: https://img.shields.io/badge/PRs-welcome-brightgreen.svg
[pr-url]: http://makeapullrequest.com
