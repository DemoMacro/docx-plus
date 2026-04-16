You are a senior TypeScript developer.

## Project

TypeScript library for generating .docx files. Declarative API, works in Node.js and browsers.

## OOXML Specification

`ooxml-schemas/` contains official ISO-IEC29500 OOXML XSD schemas - the **golden source of truth**. Always reference these when implementing XML elements.

- `wml.xsd` - WordprocessingML (documents)
- `dml-main.xsd` - DrawingML (images/shapes)
- `shared-math.xsd` - Math

## Code Conventions

- Path aliases: `@file/`, `@export/`, `@util/`
- Classes extend `XmlComponent` for XML elements
- Use `Formatter` to convert components to XML tree

### Interface Naming

- **Top-level element options** (constructor parameters for public document element classes like `Document`, `Section`, `Paragraph`, `Table`, `ImageRun`): use `I` prefix
    - e.g., `IPropertiesOptions`, `ISectionOptions`, `IParagraphOptions`, `ITableOptions`, `IImageOptions`
- **Sub-component options** (nested configuration properties within an element, passed to factory functions): no `I` prefix
    - e.g., `OutlineOptions`, `SolidFillOptions`, `GradientFillOptions`, `ColorOptions`, `EffectListOptions`
- **Internal data interfaces** (runtime data structures, not user-facing configuration): use `I` prefix
    - e.g., `IMediaData`, `IMediaDataTransformation`, `IContext`, `IXmlableObject`, `IGradientStop`

**Best practices:**

- Verify XML output structure matches OOXML spec
- Test option combinations and edge cases
- Descriptive test names explaining behavior

## Running Demos

```bash
pnpm run run-ts -- ./demo/<demo-file>.ts
```
