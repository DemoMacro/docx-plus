---
prose: true
seo:
    title: 使用 JavaScript/TypeScript 生成 Office Open XML 文档
    description: 用 JSON 或 TypeScript 生成、解析和修补 .docx、.pptx 和 .xlsx 文件——AI 原生、全类型、100% OOXML 覆盖。支持 Node.js、浏览器、Deno 和 Bun。
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
生成 Office Open XML 文档。

#description
用纯 JSON 或全类型 TypeScript 创建 `.docx`、`.pptx` 和 `.xlsx` 文件——AI 代理与手写代码同样顺手。

#links
:::u-button
---
label: 快速开始
size: lg
to: /zh/getting-started/installation
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
    title: JSON 与 TypeScript
    description: 把文档定义为纯数据——零类、零样板——冻结 JSON Schema 直接支撑工具调用。
  - icon: i-lucide-layers
    title: 丰富内容
    description: 段落、表格、图表、图片、SmartArt、数学公式、页眉、页脚等。
  - icon: i-simple-icons-typescript
    title: 类型安全
    description: 全面的 TypeScript 类型定义，边写边补全、边写边报错。
  - icon: i-lucide-monitor
    title: 跨平台
    description: 支持 Node.js、浏览器、Deno 和 Bun，可导出 Buffer、Blob、Base64、流或字符串。
  - icon: i-lucide-shield-check
    title: OOXML 完整实现
    description: 完整覆盖 OOXML Transitional 全部元素与属性，生成解析双向——主流办公套件全部直接打开。
  - icon: i-lucide-package
    title: 模块化包
    description: 按格式按需安装，统一包另附 CLI 与 AI SDK 工具。
---
::

::u-page-section
---
orientation: horizontal
features:
  - icon: i-lucide-file-text
    title: 创建 Word 文档，支持段落、表格、图片和图表
  - icon: i-lucide-presentation
    title: 创建 PowerPoint 演示文稿，支持形状、动画和切换效果
  - icon: i-lucide-table-2
    title: 创建 Excel 电子表格，支持样式、图表和数据验证
  - icon: i-lucide-zap
    title: 高性能，原生 zlib 压缩与流式输出
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
使用 [JSON]{.text-(--ui-primary)} 或 TypeScript 构建文档

#description
把文档定义为纯 JSON 对象，或使用 TypeScript API 获得完整的 IDE 体验——两者生成同样有效的 OOXML 标记。

#links
:::u-button
---
color: neutral
label: 了解 Word 文档
to: /zh/docx/quickstart
trailingIcon: i-lucide-arrow-right
variant: subtle
---
:::

:::u-button
---
color: neutral
label: 了解 PowerPoint
to: /zh/pptx/quickstart
trailingIcon: i-lucide-arrow-right
variant: subtle
---
:::

:::u-button
---
color: neutral
label: 了解 Excel
to: /zh/xlsx/quickstart
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
    title: 读取文档结构、样式和内容
  - icon: i-lucide-wrench
    title: 替换模板占位符为新内容
  - icon: i-lucide-arrow-right-left
    title: 解析、修改、重新导出一站式流水线
---

:::code-group

```ts [DOCX]
import { parseDocument, patchDocument } from "@office-open/docx";

// 解析现有文件
const opts = await parseDocument(buffer);
// opts.sections — 文档节
// opts.title, opts.creator — 核心属性

// 修补模板占位符
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

// 解析现有文件
const opts = await parsePresentation(buffer);
// opts.slides — 幻灯片数组
// opts.size, opts.title — 演示文稿属性

// 修补模板占位符
const result = await patchPresentation({
  outputType: "nodebuffer",
  data: buffer,
  placeholders: {
    title: [{ text: "已更新", bold: true }],
  },
});
```

```ts [XLSX]
import { parseWorkbook, patchWorkbook } from "@office-open/xlsx";

// 解析现有文件
const opts = await parseWorkbook(buffer);
// opts.worksheets — 工作表数组
// opts.styles — 样式定义

// 修补模板占位符
const result = await patchWorkbook({
  outputType: "nodebuffer",
  data: buffer,
  placeholders: {
    name: "张三",
  },
});
```

:::

#title
读取和[修改]{.text-(--ui-primary)}现有文件

#description
将 `.docx`、`.pptx` 和 `.xlsx` 文件解析为结构化对象，或替换 `{{占位符}}` 标记修补模板。

#links
:::u-button
---
color: neutral
label: 解析文档
to: /zh/docx/parsing
trailingIcon: i-lucide-arrow-right
variant: subtle
---
:::

:::u-button
---
color: neutral
label: 修补模板
to: /zh/docx/patch
trailingIcon: i-lucide-arrow-right
variant: subtle
---
:::
::

::u-page-section
#title
为你的项目添加文档生成能力。

#links
:u-button{label="快速开始" to="/zh/getting-started/installation" trailing-icon="i-lucide-arrow-right"}
::
