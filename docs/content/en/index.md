---
prose: true
seo:
    title: Generate Office Open XML documents with JavaScript/TypeScript
    description: Generate, parse, and patch .docx, .pptx, and .xlsx files with JSON or TypeScript — AI-native, fully typed, 100% OOXML coverage. Runs in Node.js, browsers, Deno, and Bun.
---

::u-page-hero
---
orientation: horizontal
---

:::api-example{type="docx"}

```json [JSON]
{
    "sections": [
        {
            "children": [
                { "paragraph": { "children": [{ "text": "Hello, World!", "bold": true }] } }
            ]
        }
    ]
}
```

```bash [pnpm]
pnpm add office-open
```

```bash [npm]
npm install office-open
```

```bash [yarn]
yarn add office-open
```

```bash [bun]
bun add office-open
```

:::

#title
Generate Office Open XML documents.

#description
Create `.docx`, `.pptx`, and `.xlsx` files from plain JSON or fully typed TypeScript — a natural fit for AI agents and hand-written code alike.

#links
:::u-button
---
label: Get Started
size: lg
to: /en/getting-started/installation
trailingIcon: i-lucide-arrow-right
---
:::

:::u-button
---
label: GitHub
icon: i-simple-icons-github
size: lg
target: _blank
to: https://github.com/DemoMacro/office-open
variant: outline
---
:::
::

::u-page-section
---
features:
  - icon: i-lucide-braces
    title: JSON & TypeScript
    description: Define documents as plain data — zero classes, zero boilerplate — with frozen JSON Schemas for tool-calling.
  - icon: i-lucide-layers
    title: Rich Content
    description: Paragraphs, tables, charts, images, SmartArt, math equations, headers, footers, and more.
  - icon: i-simple-icons-typescript
    title: Type-safe
    description: Comprehensive TypeScript definitions power autocomplete and catch errors as you type.
  - icon: i-lucide-monitor
    title: Cross-platform
    description: Runs in Node.js, browsers, Deno, and Bun; export to Buffer, Blob, Base64, stream, or string.
  - icon: i-lucide-shield-check
    title: OOXML Complete
    description: Every OOXML Transitional element and attribute, both generating and parsing — output opens in every major office suite.
  - icon: i-lucide-package
    title: Modular Packages
    description: Install just the format you need, or the unified package with CLI and AI SDK tools on top.
---
::

::u-page-section
---
orientation: horizontal
features:
  - icon: i-lucide-file-text
    title: Create Word documents with paragraphs, tables, images, and charts
  - icon: i-lucide-presentation
    title: Create PowerPoint presentations with shapes, animations, and transitions
  - icon: i-lucide-table-2
    title: Create Excel spreadsheets with styles, charts, and data validation
  - icon: i-lucide-zap
    title: High Performance with native zlib compression and streaming output
---

:::api-example

```json [DOCX]
{
    "sections": [
        {
            "children": [
                {
                    "table": {
                        "rows": [
                            { "cells": [{ "children": [{ "paragraph": "Name" }] }, { "children": [{ "paragraph": "Role" }] }] },
                            { "cells": [{ "children": [{ "paragraph": "Alice" }] }, { "children": [{ "paragraph": "Engineer" }] }] },
                            { "cells": [{ "children": [{ "paragraph": "Bob" }] }, { "children": [{ "paragraph": "Designer" }] }] }
                        ]
                    }
                }
            ]
        }
    ]
}
```

```json [PPTX]
{
    "slides": [
        {
            "children": [
                {
                    "shape": {
                        "x": 100, "y": 100, "width": 760, "height": 340,
                        "textBody": { "paragraphs": [{ "children": [{ "text": "Hello, World!", "size": 32 }] }] }
                    }
                }
            ]
        }
    ]
}
```

```json [XLSX]
{
    "worksheets": [
        {
            "name": "Sheet1",
            "rows": [
                { "cells": [{ "value": "Name" }, { "value": "Score" }] },
                { "cells": [{ "value": "Alice" }, { "value": 95 }] },
                { "cells": [{ "value": "Bob" }, { "value": 88 }] }
            ]
        }
    ]
}
```

:::

#title
Build documents with [JSON]{.text-(--ui-primary)} or [TypeScript]{.text-(--ui-primary)}

#description
Define documents as plain JSON objects, or reach for the TypeScript API for a full IDE experience. Both produce the same valid OOXML markup.

#links
:::u-button
---
color: neutral
label: Explore Word docs
to: /en/docx/quickstart
trailingIcon: i-lucide-arrow-right
variant: subtle
---
:::

:::u-button
---
color: neutral
label: Explore PowerPoint
to: /en/pptx/quickstart
trailingIcon: i-lucide-arrow-right
variant: subtle
---
:::

:::u-button
---
color: neutral
label: Explore Excel
to: /en/xlsx/quickstart
trailingIcon: i-lucide-arrow-right
variant: subtle
---
:::
::

::u-page-section
---
orientation: horizontal
reverse: true
features:
  - icon: i-lucide-search
    title: Read document structure, styles, and content
  - icon: i-lucide-wrench
    title: Patch template placeholders with new content
  - icon: i-lucide-arrow-right-left
    title: Parse, modify, and re-export in a pipeline
---

:::code-group

```ts [DOCX]
import { parseDocument, patchDocument } from "@office-open/docx";

// Parse existing file
const opts = await parseDocument(buffer);
// opts.sections — document sections
// opts.title, opts.creator — core properties

// Patch template placeholders
const result = await patchDocument({
  outputType: "nodebuffer",
  data: buffer,
  placeholders: {
    name: { type: "paragraph", children: [{ text: "John" }] },
  },
});
```

```ts [PPTX]
import { parsePresentation, patchPresentation } from "@office-open/pptx";

// Parse existing file
const opts = await parsePresentation(buffer);
// opts.slides — slide array
// opts.size, opts.title — presentation properties

// Patch template placeholders
const result = await patchPresentation({
  outputType: "nodebuffer",
  data: buffer,
  placeholders: {
    title: [{ text: "Updated", bold: true }],
  },
});
```

```ts [XLSX]
import { parseWorkbook, patchWorkbook } from "@office-open/xlsx";

// Parse existing file
const opts = await parseWorkbook(buffer);
// opts.worksheets — worksheet array
// opts.styles — style definitions

// Patch template placeholders
const result = await patchWorkbook({
  outputType: "nodebuffer",
  data: buffer,
  placeholders: {
    name: "John Doe",
  },
});
```

:::

#title
Read and [modify]{.text-(--ui-primary)} existing files

#description
Parse `.docx`, `.pptx`, and `.xlsx` files into structured objects, or patch templates by replacing `{{placeholder}}` tokens with new content.

#links
:::u-button
---
color: neutral
label: Parse documents
to: /en/docx/parsing
trailingIcon: i-lucide-arrow-right
variant: subtle
---
:::

:::u-button
---
color: neutral
label: Patch templates
to: /en/docx/patch
trailingIcon: i-lucide-arrow-right
variant: subtle
---
:::
::

::u-page-section
#title
Add document generation to your project.

#links
:u-button{label="Get Started" to="/en/getting-started/installation" trailing-icon="i-lucide-arrow-right"}
::
