# office-open

[English](./README.md) | 简体中文

[![npm downloads](https://img.shields.io/npm/dm/office-open)](https://www.npmjs.com/package/office-open)
[![GitHub Stars](https://img.shields.io/github/stars/DemoMacro/office-open)](https://github.com/DemoMacro/office-open/stargazers)
[![CI](https://github.com/DemoMacro/office-open/actions/workflows/default.yml/badge.svg)](https://github.com/DemoMacro/office-open/actions/workflows/default.yml)
![GitHub License](https://img.shields.io/github/license/DemoMacro/office-open)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](https://www.contributor-covenant.org/version/2/1/code_of_conduct/)

> AI 原生的 Office 文档库，面向 TypeScript 和 JavaScript。
> 用纯 JSON 或全类型 API 创建 Word、Excel、PowerPoint 文件（.docx、.xlsx、.pptx）——生成、解析、补丁三合一。为 AI 智能体、LLM 工具调用与手写代码而生；无需 Microsoft Office，生成的文件在主流办公套件中均可打开。

[文档](https://www.office-open.com) · [AI 集成](https://www.office-open.com/en/getting-started/ai-integration) · [性能基准](#性能基准) · [npm](https://www.npmjs.com/package/office-open)

⭐ **如果 office-open 为你节省了时间，一个 star 能帮更多开发者发现它。**

## 特性

- 📄 **三格式一体** — Word (.docx)、Excel (.xlsx)、PowerPoint (.pptx) 共用一套连贯 API——无需服务器，离线可用
- 🤖 **AI 工具链** — 由 TypeScript API 冻结的 Draft-07 JSON Schema、按需切片适配 LLM 上下文预算（CLI + SDK 工具）、Vercel AI SDK 工具定义、可安装的 Agent Skill
- 🧭 **100% OOXML 覆盖** — 18 个 OOXML Transitional schema（WordprocessingML、PresentationML、SpreadsheetML、DrawingML、共享 math 与 VML）的全部 2,191 个元素与 1,923 个属性均已实现生成与解析——由自动化 XSD 覆盖率工具持续追踪
- 📐 **符合规范** — 输出通过 OOXML Transitional XSD schema（ISO/IEC 29500）校验，并经实测可在 Microsoft Office、WPS Office、LibreOffice、Google Workspace 中打开
- 🔒 **全量类型** — 每个 API 都有完整 TypeScript 定义，自动补全与类型安全全覆盖
- 🔄 **解析与补丁** — 读回现有 .docx、.pptx、.xlsx 文件做往返（round-trip）工作流，或按占位符替换补丁模板
- 🎨 **富内容** — 段落、表格、图片、图表、SmartArt、数学公式、效果、动画等
- 🔀 **跨格式复制** — 图片、形状、表格、文本可跨格式转换；各格式保留原生类型，转换复用 `core` 共享域——无统一文档模型层
- ⚡ **高性能** — 纯字符串拼接生成 XML，无中间 AST，原生 zlib 压缩——见[性能基准](#性能基准)
- 🌐 **跨平台** — Node.js、浏览器、Deno、Bun。导出 Buffer、Blob、Base64、流或字符串

## 性能基准

各包基准测试摘选（ops/s，越高越好；Windows 11、Node 24——相同场景在 Bun 1.4 上还能再快约 2×）。压缩率与 MS Office 默认值持平；完整方法论、压缩模式与全量数据见各包 README：

| 包                                                       | 场景                            | @office-open | 竞品                   | 快       |
| -------------------------------------------------------- | ------------------------------- | ------------ | ---------------------- | -------- |
| [@office-open/docx](./packages/docx/README.md#benchmark) | 全功能文档 + 2 张图片           | 763 ops/s    | docx 9.6 — 54.2 ops/s  | **14×**  |
|                                                          | 2,000 段落 + 20 张图片          | 104 ops/s    | docx 9.6 — 2.85 ops/s  | **37×**  |
| [@office-open/pptx](./packages/pptx/README.md#benchmark) | 50 页全样式幻灯片               | 73.8 ops/s   | PptxGenJS — 0.91 ops/s | **81×**  |
| [@office-open/xlsx](./packages/xlsx/README.md#benchmark) | 100k 行 × 20 列（200 万单元格） | 0.89 ops/s   | hucre — 0.46 ops/s     | **1.9×** |
| [@office-open/xml](./packages/xml/README.md#benchmark)   | 解析复杂 OOXML                  | 424k ops/s   | txml — 389k ops/s      | **1.1×** |

## 包

| 包                                              | 版本                                                   | 说明                                |
| ----------------------------------------------- | ------------------------------------------------------ | ----------------------------------- |
| [office-open](./packages/office-open/README.md) | ![npm](https://img.shields.io/npm/v/office-open)       | 全家桶：全部包 + CLI + AI SDK 工具  |
| [@office-open/docx](./packages/docx/README.md)  | ![npm](https://img.shields.io/npm/v/@office-open/docx) | Word 文档生成、解析与补丁           |
| [@office-open/pptx](./packages/pptx/README.md)  | ![npm](https://img.shields.io/npm/v/@office-open/pptx) | PowerPoint 生成、解析与补丁         |
| [@office-open/xlsx](./packages/xlsx/README.md)  | ![npm](https://img.shields.io/npm/v/@office-open/xlsx) | 电子表格生成、解析与补丁            |
| [@office-open/core](./packages/core/README.md)  | ![npm](https://img.shields.io/npm/v/@office-open/core) | 共享 OOXML 基础设施、图表、单位换算 |
| [@office-open/xml](./packages/xml/README.md)    | ![npm](https://img.shields.io/npm/v/@office-open/xml)  | 底层 XML 解析与序列化               |

## 快速开始

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

`office-open` 打包了三个格式包以及 CLI、JSON Schema 和 AI SDK 工具。想要更小的体积？见[包](#包)一节按格式选用 `@office-open/*` 包。

```typescript
import { generateDocumentSync } from "office-open/docx";
import { writeFileSync } from "node:fs";

// Options 是纯 JSON 对象——零类实例化
const buffer = generateDocumentSync({
  sections: [
    {
      children: [
        { paragraph: { heading: "Heading1", children: ["文档标题"] } },
        { paragraph: { children: [{ text: "正文内容", italic: true }] } },
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

PowerPoint 与 Excel 结构相同——`generatePresentationSync({ slides: [...] })` 与 `generateWorkbookSync({ worksheets: [...] })`；见上方各包 README。另有按类型分发的 `generate()` 助手与 CLI：

```bash
npx office-open xlsx input.json "output.xlsx"
```

## 解析现有文件

把现有文件读回同一套结构化 options，用于检查或往返编辑——pptx 的 `parsePresentation` 与 xlsx 的 `parseWorkbook` 与之同构：

```typescript
import { parseDocument } from "office-open/docx";

const opts = await parseDocument(buffer);
// opts.sections — 文档节与内容
// opts.title, opts.creator — 核心属性
```

## AI 集成

给 AI 智能体一等公民的 Office 文档能力——四种方式，零胶水代码：

**Vercel AI SDK 工具** — 让 Claude、GPT 等模型生成经过 schema 校验重试的合法文档：

```typescript
import { generateText } from "ai";
import { officeOpenTools } from "office-open/ai";

const result = await generateText({
  model,
  prompt: "创建一份季度报告文档",
  tools: officeOpenTools, // generate-docx / generate-pptx / generate-xlsx + schema 查询
});
```

**MCP server** — 将文档接入 Claude Code、Cursor 或任何 MCP 客户端：

```bash
claude mcp add --transport http office-open https://www.office-open.com/mcp
```

**Agent Skill** — 可安装技能，内附 docx、pptx、xlsx 精选 API 参考：

```bash
npx skills add https://www.office-open.com
```

**JSON Schema** — 供自有工具调用使用的冻结 draft-07 schema，按需切片适配 LLM 上下文预算：

```bash
npx office-open schema index docx
npx office-open schema slice docx ParagraphOptions
```

详见 [AI 集成指南](https://www.office-open.com/en/getting-started/ai-integration)。

## 版本策略

本项目遵循[语义化版本](https://semver.org/)。主版本号为 `0`（pre-1.0）期间，破坏性 API 变更以 **minor** 版本（`0.x.0`）而非 patch 发布——公开 API 预计持续演进至 `1.0.0` 稳定版。若需要在 minor 更新之间保持稳定，下游项目请锁定精确版本。

## 开发

需要 Node.js 18+ 与 pnpm 9+。

```bash
git clone https://github.com/DemoMacro/office-open.git
cd office-open
pnpm install

pnpm dev            # 监听模式的开发构建
pnpm build          # 构建全部包
pnpm test           # 运行测试
pnpm check          # Lint 与格式化
```

## 参与贡献

欢迎贡献！[Fork 仓库](https://github.com/DemoMacro/office-open/fork)，克隆你的 fork，并添加 upstream 远端：

```bash
git clone https://github.com/YOUR_USERNAME/office-open.git
cd office-open
git remote add upstream https://github.com/DemoMacro/office-open.git
pnpm install
```

然后按工作流推进：按项目标准编码，运行 `pnpm build && pnpm test`，使用[约定式提交](https://www.conventionalcommits.org/)（`feat:`、`fix:`、`docs:`、`refactor:` 等）提交，推送到你的 fork，并向 upstream 发起 Pull Request。

## 支持与社区

- [文档](https://www.office-open.com) — 指南、API 参考与 AI 集成文档
- [讨论区](https://github.com/DemoMacro/office-open/discussions) — 提问、想法与作品展示
- [更新日志](https://github.com/DemoMacro/office-open/releases) — 发布说明
- [报告问题](https://github.com/DemoMacro/office-open/issues) — 缺陷报告与功能建议

如果 office-open 对你有用，一个 [⭐ star](https://github.com/DemoMacro/office-open/stargazers) 能帮更多开发者发现它。

## 赞助

office-open 由 [Wiseair-srl](https://github.com/Wiseair-srl) 支持——他们的 [json-to-office](https://json-to-office.com/) 选择 `@office-open/docx` 作为质量优先的 DOCX 渲染引擎，在线 playground 见 [docx.json-to-office.com](https://docx.json-to-office.com/)。感谢！也想支持本项目？[GitHub Sponsors](https://github.com/sponsors/DemoMacro)。

## 致谢

本项目的 git 历史始于 [dolanmiu/docx](https://github.com/dolanmiu/docx) 的 fork。实现此后已完全重写，但 API 形态——sections、paragraphs、tables、runs——仍沿用该项目确立的模型，其设计塑造了我们的早期方向。感谢 [Dolan Miu](https://github.com/dolanmiu) 与 `docx` 的贡献者给我们的起点与启发。

## 许可证

本项目基于 MIT 许可证开源——详见 [LICENSE](./LICENSE)。

---

Built with ❤️ by [Demo Macro](https://www.demomacro.com/)
