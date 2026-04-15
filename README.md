<p align="center">
    <img src="./logo/logo-animate.svg" width="100%" height="300" alt="docx-plus">
</p>

<p align="center">
    Easily generate and modify .docx files with JS/TS. Works for Node and on the Browser.
</p>

---

[![NPM version][npm-image]][npm-url]
[![Downloads per month][downloads-image]][downloads-url]
[![GitHub Action Workflow Status][github-actions-workflow-image]][github-actions-workflow-url]
[![Known Vulnerabilities][snky-image]][snky-url]
[![PRs Welcome][pr-image]][pr-url]
[codecov][codecov-image][codecov-url]

# docx-plus

**docx-plus** is an enhanced fork of [docx](https://github.com/dolanmiu/docx) — a TypeScript/JavaScript library for generating and modifying Word documents (.docx) programmatically with a declarative API.

## What's Different from docx?

|                     | docx                                      | docx-plus                            |
| ------------------- | ----------------------------------------- | ------------------------------------ |
| ZIP handling        | jszip                                     | **fflate** (faster, smaller)         |
| Data conversion     | Manual env detection (`Buffer.from` etc.) | **undio** (universal `toUint8Array`) |
| `Packer.toStream()` | Removed (pseudo-streaming)                | **Restored** with real streaming ZIP |
| Test environment    | jsdom                                     | happy-dom                            |

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
[snky-image]: https://snyk.io/test/github/DemoMacro/docx-plus/badge.svg
[snky-url]: https://snyk.io/test/github/DemoMacro/docx-plus
[pr-image]: https://img.shields.io/badge/PRs-welcome-brightgreen.svg
[pr-url]: http://makeapullrequest.com
[codecov-image]: https://codecov.io/gh/DemoMacro/docx-plus/branch/main/graph/badge.svg
[codecov-url]: https://codecov.io/gh/DemoMacro/docx-plus
