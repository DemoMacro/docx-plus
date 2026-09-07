# Contributing to office-open

Thank you for your interest in contributing! This document describes the coding standards and conventions.

## Development Setup

```bash
pnpm install          # Install dependencies
pnpm build            # Build all packages
cd packages/<pkg> && pnpm build   # Build one package
cd packages/<pkg> && vp test run  # Run tests for one package
pnpm check            # Lint all packages
```

## Project Structure

```
packages/
  core/   — @office-open/core (descriptor runtime, DrawingML, chart/smartart, OPC)
  xml/    — @office-open/xml (XML parsing/serialization)
  docx/   — @office-open/docx (DOCX)
  pptx/   — @office-open/pptx (PPTX)
  xlsx/   — @office-open/xlsx (XLSX)
ooxml-schemas/  — OOXML XSD schemas (golden source of truth)
```

Every format package (docx, pptx, xlsx) follows the same layout:

```
src/
  parts/    — One module per OOXML XML part (types + descriptor co-located)
  shared/   — Types used by 2+ parts
  compiler.ts    — compileDocument/Presentation/Workbook()
  compile/       — Compile phases extracted from compiler.ts (one concern per
                   file: notes, headers/footers, drawings…); files import
                   siblings as `./x`, everything else as `../`
  context.ts     — XxxWriteContext + XxxReadContext
  generate.ts    — generateDocument/Presentation/Workbook() entry
  parse.ts       — parseDocument/Presentation/Workbook() entry
  patch.ts       — patchDocument/Presentation/Workbook() entry
                   (single file when simple; use patch/ directory if complex)
  util/          — Helpers
  index.ts       — Public API
```

## OOXML Schemas

`ooxml-schemas/` contains XSD schemas — the golden source of truth. Always reference these when implementing XML elements.

- `transitional/` — Used by all major software (primary reference)
- `strict/` — ISO/IEC 29500 standard
- `microsoft/` — Microsoft extensions

Key files: `wml.xsd` (DOCX), `pml.xsd` (PPTX), `sml.xsd` (XLSX), `dml-main.xsd` (DrawingML).

## Naming Conventions

### Files and Directories

Use **kebab-case** for all file and directory names.

```
parts/settings.ts           — simple part (single file)
parts/document/body.ts      — complex part (subdirectory)
shared/shape/shape.ts       — graphic-object types AND descriptor, co-located
```

Two co-location patterns: **docx/xlsx** put each part's types and `<part>Desc` descriptor together in `parts/<part>/` (complex) or `parts/<part>.ts` (simple); **pptx** keeps descriptors in a dedicated `parts/descriptors/` layer with public types in `shared/<domain>/`. Both are acceptable — pick one per package and stay consistent within it. Complex parts are subdirectories: xlsx `worksheet`/`workbook`/`styles`/`pivot-table`/`revision-log`/`drawing` are large enough to warrant subdirectories, matching the docx baseline.

### Descriptors

Each OOXML part has a `<part>Desc` descriptor with `stringify()` and `parse()`:

```typescript
export const settingsDesc: CustomDescriptor<SettingsOptions> = {
  kind: "custom",
  stringify(opts, ctx) {
    return xml;
  },
  parse(el, ctx) {
    return opts;
  },
};
```

### Interfaces

**PascalCase** without `I` prefix. Configuration interfaces use `Options` suffix. Do **not** mark properties `readonly` — the parse path assigns into these objects.

```typescript
export interface ParagraphOptions {
  alignment?: string;
  children?: (RunOptions | string)[];
}
```

### Functions

Use **camelCase**. Follow the appropriate prefix convention:

| Prefix       | Purpose                              | Example                                            |
| ------------ | ------------------------------------ | -------------------------------------------------- |
| `stringify*` | Generate XML from Options            | `stringifyRunProperties()`, `stringifyParagraph()` |
| `parse*`     | Parse XML into Options               | `parseBody()`, `parseRun()`                        |
| `create*`    | Factory functions for XML elements   | `createOutline()`, `createBevel()`                 |
| `build*`     | Build lookup tables or composite XML | `buildContentTypes()`, `buildTransition()`         |
| `compile*`   | Top-level compilation entry          | `compileDocument()`, `compilePresentation()`       |

### Enumerated Types

Prefer **string literal unions** for enumerated option types. They are pure types (no runtime object), keep the call site self-documenting (`position: "bottom"`), and have no runtime cost. Enum **values** are full words a caller can read out loud — OOXML token jargon (`midCat`, `inBase`, `b`, `cust`, `stdErr`, `minMax`) is spelled out (`middleOfCategory`, `insideBase`, `bottom`, `custom`, `standardError`, `ascending`) behind an `xsd*` mapping table in `core/util/mappings.ts` that owns the token translation in both directions (`.to()` for stringify, `.from()` for parse). Values that are already common English (`single`, `between`, `min`, `none`) or established domain terms (`kashida`, `aiueo`, `twips`) stay verbatim.

```typescript
// Preferred: string literal union of full words, translated at the XML boundary
export type AxisPosition = "bottom" | "left" | "right" | "top";

/** XSD ST_TickMark: cross / in / none / out */
export type AxisTickMark = "cross" | "in" | "none" | "out";
```

Use an `as const` object **only when the values are referenced at runtime** — iteration, `Record<Enum, T>` lookup keys, or `Enum.KEY` access in demos/tests. The runtime object must justify itself; a pure option-field type stays a string union. Keys then use **SCREAMING_SNAKE_CASE**, values **lowercase full English words**.

```typescript
// Justified: consumed as Record keys / iterated at runtime
const CHART_TYPE_TAGS: Record<ChartType, string> = { column: "c:barChart", ... };
```

Do **not** use TypeScript `enum`. Historical `as const` enumerated option types in docx/pptx/xlsx are migrated to string unions opportunistically when touched; the chart module is fully migrated.

### Property Naming

Whether a property is spelled out or abbreviated is decided by **domain precedent**, not by length. Three rules, in priority order:

1. **Established short forms stay short.** If a term is the standard notation in its domain and its meaning is unambiguous to a web search, keep it — even though it is technically an abbreviation. CSS keeps `align`/`color`/`font`, HTML keeps `id`/`src`/`href`/`alt`, color channels keep `r`/`g`/`b`/`h`/`s`/`l`, math keeps `sin`. OOXML standard attribute tokens fall here — `id`, `idx`, `numFmt`, `numId`, `fontId`, `fillId`, `borderId`, `clrIdx`, `lastIdx` map 1:1 to the XSD attribute name, and `num` (number) and `toc` (the Word `TOC` field) likewise stay.

2. **Invented abbreviations spell out.** If the short form is an ad-hoc truncation with no domain precedent and a web search cannot pin it down, use the full word: `level` not `lvl`, `field` not `fld`, `vertical` not `vert`, `target` not `tgt`, `position` not `pos`, `background` not `bg`, `complement` not `comp`, `inverse` not `inv`. When in doubt, write the full word — brevity is a side-effect of precedent, never a goal in itself.

3. **Compound abbreviations always spell out.** Two words each truncated and concatenated cannot be searched and are never a domain standard: `lineReferenceIndex` never `lnIdx`, `buildLevel` never `bldLvl`, `animateBackground` never `animBg`, `followedHyperlink` never `folHlink`.

**Meta-rule — consistency overrides everything.** The same concept uses the same name everywhere: across the write `Options` and the parse output (`fontId` on both `CellXfEntry` and `IndexedXfEntry`, never `fontId` on one and `fontIdx` on the other), across packages (see Cross-Package Naming), and within one type — a concept already spelled out in its sibling field is spelled out too (`complexScript` full-word means `cstheme` becomes `complexScriptTheme`, not a lone abbreviation).

**Root vs derived noun.** Some concepts have both a verb root and a derived noun, each with strong precedent — `align` (CSS `text-align`/`align-items`) vs `alignment` (Open XML SDK/exceljs/openpyxl), `rotate` (CSS/SVG) vs `rotation` (OOXML SDK), `indent` vs `indentation`. Rule 1 does not decide these because both forms are established; the meta-rule does: use the form already taken by the concept's **type name** and sibling fields, and by the package mainstream. As an object-model library this codebase trends to the noun (`alignment`, `rotation`, `orientation`); the verb root survives only where OOXML keeps the literal short attribute (`@orient`, `@rot`, `@scale`) or a type/field pair is already self-consistent on the root (`wp:positionH/@align` → `HorizontalPositionAlign` + `align`). A field that contradicts its own type name (`PenAlignment` + `align`) is the inconsistency to fix.

Reference elements map to `*Reference`, matching the Open XML SDK (`LineReference`, `FillReference`, …):

```typescript
// Element names → semantic full words (rule 2)
outline         → a:ln         gradientFill  → a:gradFill
outerShadow     → a:outerShdw  solidFill     → a:solidFill

// Reference elements → *Reference (Open XML SDK alignment)
lineReference   → a:lnRef      fillReference    → a:fillRef
effectReference → a:effectRef  fontReference    → a:fontRef
```

**How to decide:** take the candidate name and search the web. If a developer lands on its meaning instantly and it is the field's standard notation, keep it (rule 1). If they hesitate or find nothing, spell it out (rule 2). If it concatenates two truncations, spell it out (rule 3).

### Cross-Package Naming

The same concept uses the **same name in every package** — picture/shape/connector/group share one `*Options` name across docx/pptx/xlsx (`PictureOptions` everywhere, not per-package `DrawingDescriptorOptions`/`PictureDescriptorOptions`/`DrawingImageOptions`).

- **No grouping prefixes** (`Model`/`Content`/`Element`/`Universal`). `UniversalMeasure` is the XSD `ST_UniversalMeasure` type, kept as-is — not a precedent.
- **Tables are the exception**: each package's `TableOptions` models a genuinely different thing (`w:tbl` flow / `a:tbl` graphic / xlsx cell-range), so the name stays but each carries a JSDoc boundary note; docx/pptx `extends` the shared `core/table/` `BaseTableOptions` (rows/cells/span/6-flags/columnWidths/vertical-align) and add domain-specific style/position, xlsx is independent ([Cross-Format Conversion](#cross-format-conversion)).
- **Renames**: pre-1.0, rename in place (no `@deprecated` aliases — `GroupOptions`/`ConnectorOptions`/`ShapeOptions` replaced `WpgGroupRunOptions`/`ConnectorShapeOptions`/`WpsShapeRunOptions` directly); post-1.0, keep the old name as a `@deprecated` alias until the next major release.

## Options Interface Design

The `*Options` JSON is the document's data model, consumed three ways: humans writing TypeScript, AI agents generating JSON against the published schemas (`packages/office-open/schemas/`), and the docen editor persisting documents through it. Structural rules below serve all three; when a rule and taste disagree, the XSD content model decides.

### Part-Mirrored Roots

A root field on `DocumentOptions`/`WorkbookOptions`/`PresentationOptions` maps to a package part (`styles`, `numbering`, `settings`, `footnotes`, `comments`, `webSettings`, `glossary`) or to document-body-level XML (`sections`, `background`, `conformance`). Nothing else gets a root field.

settings.xml content is reachable only through the `settings` entry — mirroring the Open XML SDK, where settings live on `MainDocumentPart.DocumentSettingsPart` and the document classes carry no settings sugar (CT_Document has only `w:background` + `w:body`; none of view/zoom/mailMerge exists in document.xml).

### Single Source of Truth, No Sugar

One configuration, one writable location. Convenience mirrors create three failures:

- **Silent override** — merge order (`{ ...defaults, ...options.settings }`) lets one entry quietly win
- **Name drift** — `evenAndOddHeaderAndFooters` at the root vs `evenAndOddHeaders` (the SDK name) in settings
- **Two right answers** — schema-driven generation becomes nondeterministic

Wiring that only the compiler can produce (header/footer reference ids, relationship ids) lives on descriptor-input types (`SectionPropertiesDescriptorOptions`), never on the public Options.

### Flat vs Nested

| Pattern    | When to use                                    | Example                                                                   |
| ---------- | ---------------------------------------------- | ------------------------------------------------------------------------- |
| **Flat**   | No XSD container groups the properties         | `{ pageSize, pageMargin, pageNumbers }` (CT_SectPr children are siblings) |
| **Nested** | The XSD has a real container element/CT for it | `{ pageBorders: { top, left, bottom, right } }` (CT_PageBorders)          |

**Rule: nesting requires an XSD container.** Every nested Options object corresponds to one XSD complex type. A grouping with no backing element is an invented shell and gets flattened:

```typescript
// ✗ invented shells — no such container in CT_SectPr / CT_Lvl
page: {
  (size, margin, pageNumbers, borders, textDirection);
}
style: {
  (run, paragraph);
}

// ✓ flattened to siblings, matching the XSD content model
{
  (pageSize, pageMargin, pageNumbers, pageBorders, textDirection);
}
{
  (run, paragraph);
}
```

A shared name prefix (3+ properties starting with `page…`) is a smell that prompts a check, never the justification for nesting.

### Container Field Naming

| Pattern       | Field Name  | When to use         | Example                   |
| ------------- | ----------- | ------------------- | ------------------------- |
| Heterogeneous | `children`  | Mixed element types | `SectionOptions.children` |
| Homogeneous   | Domain name | Single element type | `TableOptions.rows`       |

Domain names follow the XSD element: `rows` for `w:tr`/`x:row`, `cells` for `w:tc`/`x:c`.

### Collections: Arrays with Explicit Ids

An element's identity is a field on the item, not a Record key:

```typescript
// ✓ identity is a field (w:footnote/@w:id), order is the array's
footnotes: [{ id: 1, children: ["…"] }]

// ✗ number-keyed Record + mixed key space — hostile to diff/patch/schema
footnotes: { "1": { children: [...] }, separator: {...} }
```

Number-keyed Records and mixed key spaces (numeric ids alongside named entries like `separator`) are anti-patterns for diffing, JSON Patch, and schema generation. Unordered lookup maps are internal-only; public collections are arrays. Separator/continuation entries that round-trip verbatim become sibling top-level fields, not Record keys.

### Humans, AI Agents, and Editors

Three consumers shape the same JSON:

- **Humans** — names and units a person would say out loud (see [Measurement Units](#measurement-units)); nesting depth spent on real structure, not wrapper layers.
- **AI agents** — variant shapes carry a discriminant field (`type`-style); LLM structured output degrades on deep nesting plus wide unions, so wrappers with no XML counterpart actively hurt generation accuracy.
- **Editors** — options are plain serializable data (no class instances, functions, or context-dependent fields), field names are stable addresses (JSON Patch targets), and every subtree (a section, a cell, a run) is valid in isolation so partial updates can be persisted.

## Measurement Units

**Every numeric field uses the unit a human would say out loud.** The library owns the OOXML encoding (the 1/1000th, 1/60000th, half-point scale factors) — the caller never does. This single rule governs all field types below.

| Quantity                         | Caller writes                                           | Library converts (stringify / parse)              | XSD type                           |
| -------------------------------- | ------------------------------------------------------- | ------------------------------------------------- | ---------------------------------- |
| Percent                          | integer percent (`50` = 50%, `150` = 150%)              | × 1000 / ÷ 1000                                   | `ST_Percentage` family             |
| Angle                            | degrees (`45` = 45°)                                    | × 60000 / ÷ 60000                                 | `ST_Angle` family                  |
| Font size / text spacing         | points (`12` = 12 pt)                                   | × 100 / ÷ 100 (DrawingML), × 2 (Word half-points) | `ST_TextFontSize` / `ST_TextPoint` |
| Duration (animation, transition) | milliseconds (`2000` = 2 s)                             | passed through                                    | `ST_TLTime`                        |
| Geometric length                 | `number` (native unit) **or** `UniversalMeasure` string | via the converter below                           | `ST_Coordinate` family             |

**No field exposes the raw OOXML scale to the caller.** A color tint is `tint: 40` (40%), not `40000`. A shape rotation is `rotation: 45` (45°), not `2700000`. The XSD integer lives only inside the emitted XML. **Stringify and parse are always changed together** so the scale factor cancels out — round-trip stays lossless.

### Geometric lengths: `number` (native unit) or `UniversalMeasure`

Geometry and sizing fields accept **`number`** (the format's native unit) or a **`UniversalMeasure` string** (mm/cm/in/pt/pc/pi; px at 96 DPI on DrawingML fields). The native unit follows the domain:

| Domain                                              | `number` means    | Convert with    |
| --------------------------------------------------- | ----------------- | --------------- |
| DrawingML geometry (shapes, images, charts, tables) | EMU               | `convertToEmu`  |
| Word spacing / indent / font size                   | twip / half-point | `convertToTwip` |
| xlsx row height                                     | points            | `convertToPt`   |
| xlsx page margins                                   | inches            | `convertToInch` |

The converters are **polymorphic** — a `number` passes through unchanged, a string is parsed — so a single field accepts both forms.

**Round-trip is lossless.** Parse returns the native unit verbatim (e.g. EMU), and stringify converts any string back to that unit. Never round-trip through pixels: it quantizes to the grid and is irreversible.

### Input convenience, XSD-valid output

`UniversalMeasure` exists for input ergonomics only — the XML we emit must still satisfy its XSD type, so stringify always converts to the integer/unit the schema requires, never writing a raw UM string where a number is mandated.

A geometric-length field stays plain `number` (no `UniversalMeasure`) only when its XSD type is integer-only and the field is not a real-world length — bevel size, 3D extrusion depth, xlsx column width (character units). Angles, percents, and durations are **never** given `UniversalMeasure`; they use the ×1000 / ×60000 / pass-through rules above.

## Descriptor Pattern

All XML serialization uses the descriptor pattern from `@office-open/core/descriptor`:

- **`CustomDescriptor<T>`** — every descriptor is custom: hand-written `stringify()` + `parse()` for the part

Each descriptor is **bidirectional**: has both `stringify()` and `parse()`.

## Cross-Format Conversion

Cross-format copy works at the `Options` layer — **no unified document model**.

- **Similar structures** (picture/connector/group): each concept has a core base the format `Options` extend — `core/picture/` `BasePictureOptions`, `core/connector/` `BaseConnectorOptions`, `core/group/` `BaseGroupOptions` (all `extends NonVisualDrawingPropertiesOptions`, the shared `a:CT_NonVisualDrawingProps` cNvPr/docPr type from `core/drawing/non-visual/`); docx picture/group stay a discriminated union bridged through `altText`. `convert/*.ts` passes the base through directly (cNvPr name/description/title/hidden threads every leg) and maps only container/positioning (`wps:`/`a:sp`/`xdr:sp`; inline vs x/y vs cell anchor) plus format-specific spPr convenience. Shape has no base (YAGNI — cNvPr already unified, spPr/textBody already in core, no shape-specific field worth lifting).
- **Tables**: three packages model tables fundamentally differently, but they share a structural core (rows/cells/span/6-flags/columnWidths/vertical-align) in `core/table/` (`BaseTableOptions`/`BaseTableRowOptions`/`BaseTableCellOptions`). docx/pptx `TableOptions extends Base*` and add domain-specific style/position; xlsx is independent (sml Table is a data range). `convert/table.ts` passes the base through directly and translates only cell content (w:p↔a:p via `convert/text`), units (twip↔EMU via `core/util/converters`), and pptx fill/scheme-color → docx shading/themeColor.
- **Text**: `a:p` is shared in `core/drawing/text/`; docx bridges `a:p ↔ w:p` (font ×100↔×2 half-points, `srgbClr`↔`w:color`, typeface↔`rFonts`, hyperlinks).
- **Charts**: unified via `core/chart/`; cross-format is only packaging.

Conversion functions are per-package pure functions (`to*`/`convert*`/`from*`), exported from `@office-open/<pkg>` — never core, to keep `format → core` one-directional. **Fidelity** matches MS Office paste: shapes (spPr/fill/outline/effects/textBody) translate near-losslessly across pptx/xlsx/docx; positioning is heuristic (xlsx cell-anchor ↔ absolute EMU), lossy on xlsx hops; connectors skip docx (no standalone connector element); table structure/merge/border/font/alignment high-fidelity; multi-paragraph text ↔ single cell, and formulas/validation, lossy.

## XML Generation

XML is generated via **string concatenation** (template literals), not intermediate object trees. For complex dynamic XML, use `buildXml()` (re-export of `element()` from `@office-open/xml`).

```typescript
// Simple — inline template
const xml = `<a:noFill/>`;
const xml = `<a:off x="${x}" y="${y}/>`;

// Dynamic — array push + join
const parts: string[] = [];
if (opts.fill) parts.push(stringifyFill(opts.fill));
return `<p:spPr>${parts.join("")}</p:spPr>`;
```

## Loop Patterns

| Scenario                            | Use                 | Reason                            |
| ----------------------------------- | ------------------- | --------------------------------- |
| Transform into new array            | `.map()`            | Expresses "transform" intent      |
| Filter elements                     | `.filter()`         | Expresses "filter" intent         |
| Side-effect iteration, async, break | `for...of`          | Full control, supports early exit |
| Performance-sensitive hot paths     | `for...of` or `for` | ~3x faster than `.forEach()`      |

**Avoid `.forEach()`** — `for...of` is strictly superior.

## XSD Value Mapping

When XSD uses abbreviations, mapping is centralized in `packages/core/src/util/mappings.ts`. Each mapping is a `bidi()` helper exposing `.to()` (user value → XSD value) and `.from()` (XSD value → user value). The mapping is bidirectional:

- **Generation** (Options → XML): user-friendly → XSD abbreviated
- **Parsing** (XML → Options): XSD abbreviated → user-friendly

When XSD uses full words (e.g. `"center"`), no mapping needed.

## JSDoc Density

Public-type JSDoc is the single source of the schema `description`s that AI tools read: it is extracted verbatim into `schemas/*.schema.json`, and every on-demand slice multiplies those bytes into the model's context. Information density is a correctness requirement, not a style preference — the bar is OpenAI's "intern test": a reader with nothing but the description can fill the field correctly.

**One-line summary first.** The first sentence states what the field does plus its unit/format, with a value example inlined: `/** Page width in twips (15840 = 11"). */`. Details that earn their tokens follow on separate lines.

**Keep** — what the reader cannot guess:

- Unit and scale with a concrete example (`twips (15840 = 11")`, `×4096 (40960 = +10 pt)`)
- Defaults, value ranges, mutual exclusion (`slide` and `url` are mutually exclusive)
- Behavior contracts (`round-trip only — do not hand-author`, `parsed but never re-emitted`, `auto-generated when omitted`)
- Cross-package facts that steer lookup (`core shared model`)

**Never copy from the OOXML spec verbatim.** Spec-legalese and scaffolding multiply tokens without adding fill-value information:

- "shall be specified by…", "The possible values … are defined by the … simple type (§…)"
- `## Heading` / `### Example` sections and XML example blocks
- c-rex.net / officeopenxml.com URLs, `xsd:complexType` blocks
- `{@link X }` syntax (dead text in JSON — write the plain name `X`)
- Library-internal architecture notes ("the single source of truth for both the entry and the descriptor")

**Budget:** aim for ≤200 characters per description. Above 250, the description must be carrying several distinct contracts — or it is carrying prose that belongs in this documentation instead.

## Running Demos

```bash
cd packages/docx && pnpm tsx demo/<demo-file>.ts
cd packages/pptx && pnpm tsx demo/<demo-file>.ts
cd packages/xlsx && pnpm tsx demo/<demo-file>.ts
```

## Validation

```bash
pnpm tsx scripts/validate.ts                # All demos
pnpm tsx scripts/validate.ts pptx           # One package
pnpm tsx scripts/validate.ts docx "path.docx"  # Specific file
```

## Pull Request Process

1. `pnpm check` passes with no errors
2. Run relevant demos and tests to verify changes
3. For new XML elements, validate output against XSD schemas
4. Follow naming conventions described above
5. Keep changes minimal and focused — match existing style
