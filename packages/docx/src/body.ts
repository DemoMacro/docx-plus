/**
 * Body-level stringification for DOCX documents.
 *
 * Converts pure JSON options to XML strings for document body content.
 * Pure string concatenation — no intermediate object tree.
 *
 * @module
 */

import type { UniversalMeasure } from "@office-open/core";
import { xsdJcAlignment } from "@office-open/core";
import { toUint8Array } from "@office-open/core";
import { hexColorValue, uCharHexNumber } from "@office-open/core";
import { stringifyVmlShape } from "@office-open/core";
import { stringifyVmlBackground } from "@office-open/core";
import { nextVmlShapeId } from "@office-open/core";
import type { VmlShapeStyle } from "@office-open/core";
import {
  attr,
  attrBool,
  attrMeasure,
  attrNum,
  escapeXml,
  findChild,
  textOf,
} from "@office-open/xml";
import type { Element } from "@office-open/xml";
import { sectionPropertiesDesc } from "@parts/document/body/section-properties/descriptor";
import { documentNamespaceAttributes } from "@parts/document/document-attributes";
import type {
  BackgroundRawMediaOptions,
  DocumentBackgroundOptions,
} from "@parts/document/document-background";
import { parseDrawingRun } from "@parts/drawing/drawing-parse";
import { FontWrapper } from "@parts/fonts/font-wrapper";
import type { BordersOptions } from "@parts/paragraph/formatting/border";
import type { IndentProperties } from "@parts/paragraph/formatting/indent";
import { LineRuleType } from "@parts/paragraph/formatting/spacing";
import type { SpacingProperties } from "@parts/paragraph/formatting/spacing";
import { HeadingLevel } from "@parts/paragraph/formatting/style";
import type { TabStopDefinition } from "@parts/paragraph/formatting/tab-stop";
import type { FrameOptions } from "@parts/paragraph/frame/frame-properties";
import type {
  MarkupRangeOptions,
  BookmarkStartOptions,
  MoveRangeStartOptions,
} from "@parts/paragraph/links/bookmark";
import type { DisplacedByCustomXml } from "@parts/paragraph/links/bookmark";
import type { ParagraphOptions } from "@parts/paragraph/paragraph";
import type {
  NumberingInsertionOptions,
  ParagraphPropertiesOptions,
  ParagraphPropertiesChangeOptions,
} from "@parts/paragraph/properties";
import { parseFormFieldData } from "@parts/paragraph/run/form-field";
import type { FormFieldOptions } from "@parts/paragraph/run/form-field";
import type { PositionalTabOptions } from "@parts/paragraph/run/positional-tab";
import type {
  ParagraphRunPropertiesOptions,
  RunPropertiesOptions,
} from "@parts/paragraph/run/properties";
import type { RunOptions } from "@parts/paragraph/run/run";
import { parseRun, parseRunProperties, parsedRunToOptions } from "@parts/paragraph/run/run-parse";
import { parseSdtProperties } from "@parts/sdt/sdt-parse";
import { parseSubDoc } from "@parts/sub-doc/sub-doc-parse";
import { stringifyTableOfContents } from "@parts/table-of-contents/descriptor";
import { parseBorderSide } from "@shared/border";
import type { MediaData } from "@shared/media/data";
import type { SectionChild } from "@shared/section";
import { parseShading } from "@shared/shading";

import type { DocxReadContext, DocxWriteContext, BodyContext } from "./context";
import { tableDesc, altChunkDesc, sdtBlockDesc, customXmlBlockDesc } from "./parts";
import { parseCustomXmlProperties } from "./parts/bodychildren";
import { stringifyChildDispatch, stringifyRunInline } from "./parts/inline";
import { parseMathChildren } from "./parts/paragraph/math/stringify";
import type {
  ComplexFieldOptions,
  ParagraphChild,
  SdtRunOptions,
  TrackChangeChild,
} from "./parts/paragraph/paragraph";
import {
  EMPTY_PPR_RESULT,
  paragraphIdentityAttrs,
  stringifyParagraphProperties,
} from "./parts/paragraph/stringify";
import { replaceRelsWithPlaceholders } from "./util/replace-media-placeholders";
import { stringifyElement } from "./util/stringify-element";

export type { BodyContext } from "./context";

// ── Run ──

/**
 * Stringify a run (w:r) from pure JSON options.
 *
 * Handles text, children, breaks, and run properties.
 */
export function stringifyRun(opts: RunOptions, ctx: BodyContext): string {
  return stringifyRunInline(opts, ctx);
}

// ── Paragraph ──

/**
 * Stringify a paragraph (w:p) from pure JSON options or string.
 *
 * Handles paragraph properties, numbering registration, and run children.
 */
export function stringifyParagraph(
  opts: string | ParagraphOptions,
  ctx: BodyContext,
  sectionPropertiesXml?: string,
): string {
  const isPlainText = typeof opts === "string";
  const resolved: ParagraphOptions = isPlainText ? { text: opts } : opts;
  let body = "";

  // Build paragraph properties — direct string output, no intermediate object tree.
  // A string paragraph is `{ text }` by construction: no pPr fields, no numbering.
  const props = isPlainText ? EMPTY_PPR_RESULT : stringifyParagraphProperties(resolved);

  // Register numbering references (length check skips the iterator allocation
  // on the common no-numbering path)
  const numberingRefs = props.numberingReferences;
  if (numberingRefs.length > 0 && !(ctx.viewWrapper instanceof FontWrapper)) {
    for (const ref of numberingRefs) {
      ctx.file.numbering.createConcreteNumberingInstance(ref.reference, ref.instance);
    }
  }

  // Paragraph properties XML
  if (props.xml) {
    if (sectionPropertiesXml) {
      // Insert sectPr before closing </w:pPr>; a self-closed empty pPr
      // (emptyProperties round-trip marker) expands to host the section break.
      body += props.xml.includes("</w:pPr>")
        ? props.xml.replace("</w:pPr>", sectionPropertiesXml + "</w:pPr>")
        : props.xml.replace(/\/>$/, `>${sectionPropertiesXml}</w:pPr>`);
    } else {
      body += props.xml;
    }
  } else if (sectionPropertiesXml) {
    // No pPr but we need sectPr — wrap in pPr
    body += `<w:pPr>${sectionPropertiesXml}</w:pPr>`;
  }

  // Text shorthand — the run is `{ text }` by construction (no rPr/break/children/rsid),
  // so build the bare <w:r> directly instead of walking stringifyRun's full dispatch.
  if (resolved.text !== undefined) {
    body += `<w:r><w:t xml:space="preserve">${escapeXml(String(resolved.text))}</w:t></w:r>`;
  }

  // Children
  if (resolved.children) {
    for (const child of resolved.children) {
      if (typeof child === "string") {
        body += `<w:r><w:t xml:space="preserve">${escapeXml(child)}</w:t></w:r>`;
      } else if (typeof child === "object" && child !== null) {
        // Try JSON child dispatch first (image, chart, pageBreak, etc.)
        const jsonResult = stringifyChildDispatch(child as ParagraphChild, ctx);
        if (jsonResult !== undefined) {
          body += Array.isArray(jsonResult) ? jsonResult.join("") : jsonResult;
        } else {
          // RunOptions-like plain object — may be an empty run carrying only
          // run properties (round-tripped from <w:r><w:rPr>…</w:rPr></w:r>).
          body += stringifyRun(child as RunOptions, ctx);
        }
      }
    }
  }

  const attr = paragraphIdentityAttrs(resolved);
  return body ? `<w:p${attr}>${body}</w:p>` : `<w:p${attr}/>`;
}

// ── Body child dispatch ──

/**
 * Stringify a body-level child element.
 *
 * Dispatches to the appropriate stringifier based on the child type.
 * Pure JSON API — no class instance support.
 */
export function stringifyBodyChild(
  child: SectionChild,
  ctx: BodyContext,
  sectionPropertiesXml?: string,
): string {
  // Plain object dispatch — all via descriptors
  if ("paragraph" in child) {
    return stringifyParagraph(child.paragraph, ctx, sectionPropertiesXml);
  }
  if ("table" in child) {
    return tableDesc.stringify(child.table, ctx) ?? "";
  }
  if ("toc" in child) {
    const { alias, leading, trailing, ...options } = child.toc;
    const entries = options.entries ?? [];
    // A non-final section may host its sectPr in the TOC's closing entry
    // paragraph (the section-break paragraph the field end shares).
    const entriesXml = entries
      .map((entry, i) =>
        i === entries.length - 1
          ? stringifyBodyChild(entry, ctx, sectionPropertiesXml)
          : stringifyBodyChild(entry, ctx),
      )
      .join("");
    const contentAround = (nodes: SectionChild[] | undefined): string =>
      (nodes ?? []).map((node) => stringifyBodyChild(node, ctx)).join("");
    // A freshly generated TOC (no entries) gets the conventional alias; a
    // round-tripped one emits alias only when the source carried it.
    const isFresh = entries.length === 0 && leading === undefined && trailing === undefined;
    return stringifyTableOfContents(
      alias ?? (isFresh ? "Table of Contents" : undefined),
      options,
      entriesXml,
      contentAround(leading),
      contentAround(trailing),
    );
  }
  if ("textbox" in child) {
    return stringifyTextbox(child.textbox, ctx);
  }
  if ("sdt" in child) {
    return sdtBlockDesc.stringify(child.sdt, ctx) ?? "";
  }
  if ("altChunk" in child) {
    return altChunkDesc.stringify(child.altChunk, ctx) ?? "";
  }
  if ("customXml" in child) {
    return customXmlBlockDesc.stringify(child.customXml, ctx) ?? "";
  }
  if ("bookmarkStart" in child) {
    const bs = child.bookmarkStart;
    const a: string[] = [`w:id="${bs.id}"`, `w:name="${escapeXml(bs.name)}"`];
    if (bs.displacedByCustomXml) a.push(`w:displacedByCustomXml="${bs.displacedByCustomXml}"`);
    if (bs.colFirst !== undefined) a.push(`w:colFirst="${bs.colFirst}"`);
    if (bs.colLast !== undefined) a.push(`w:colLast="${bs.colLast}"`);
    return `<w:bookmarkStart ${a.join(" ")}/>`;
  }
  if ("bookmarkEnd" in child) {
    const be = child.bookmarkEnd;
    const a: string[] = [`w:id="${be.id}"`];
    if (be.displacedByCustomXml) a.push(`w:displacedByCustomXml="${be.displacedByCustomXml}"`);
    return `<w:bookmarkEnd ${a.join(" ")}/>`;
  }
  if ("rawXml" in child) {
    return child.rawXml;
  }

  throw new Error("Unknown section child type");
}

// ── Document background (pure function, no XmlComponent) ──

function stringifyDocumentBackground(opts: DocumentBackgroundOptions, ctx: BodyContext): string {
  // Raw-XML passthrough for backgrounds that don't fit the structured model
  // (VML pattern fills, texture images). Register each referenced media item
  // so the compiler resolves the `{fileName}` placeholders into rIds.
  if (opts.rawXml) {
    if (opts.rawMedia) {
      for (const m of opts.rawMedia) {
        const data = toUint8Array(m.data);
        const entry = ctx.file.media.addMedia(
          data,
          m.type,
          (fileName) =>
            ({
              type: m.type,
              data,
              fileName,
              transformation: { emus: { x: 0, y: 0 }, pixels: { x: 0, y: 0 } },
            }) as MediaData,
          m.fileName,
        );
        // Dedup may reuse an earlier file name; remap the placeholder so the
        // compiler resolves it to the shared media relationship.
        if (entry.fileName !== m.fileName) {
          opts.rawXml = opts.rawXml.split(`{${m.fileName}}`).join(`{${entry.fileName}}`);
        }
      }
    }
    return opts.rawXml;
  }

  const attrs: string[] = [];
  if (opts.color !== undefined) attrs.push(`w:color="${hexColorValue(opts.color)}"`);
  if (opts.themeColor !== undefined) attrs.push(`w:themeColor="${opts.themeColor}"`);
  if (opts.themeShade !== undefined)
    attrs.push(`w:themeShade="${uCharHexNumber(opts.themeShade)}"`);
  if (opts.themeTint !== undefined) attrs.push(`w:themeTint="${uCharHexNumber(opts.themeTint)}"`);
  const attrStr = attrs.join(" ");

  if (opts.image) {
    const image = opts.image;
    const rawData = toUint8Array(image.data) as Uint8Array;
    const { fileName } = ctx.file.media.addMedia(
      rawData,
      image.type,
      (name) =>
        ({
          type: image.type as "jpg" | "png" | "gif" | "bmp" | "tif" | "ico" | "emf" | "wmf",
          data: rawData,
          fileName: name,
          transformation: { emus: { x: 0, y: 0 }, pixels: { x: 0, y: 0 } },
        }) as MediaData,
    );

    const vmlBg = stringifyVmlBackground({
      // stringifyDocumentXml emits the background before body children, so the
      // allocator hands out 1025 here — matching Word's fixed v:background id.
      id: nextVmlShapeId(),
      fill: {
        type: "frame",
        recolor: true,
        relationshipId: `{${fileName}}`,
        officeTitle: fileName,
      },
    });
    return `<w:background ${attrStr}>${vmlBg}</w:background>`;
  }

  return `<w:background ${attrStr}/>`;
}

// ── Textbox (pure function, no XmlComponent) ──

function stringifyTextbox(
  opts: Omit<ParagraphOptions, "style" | "children"> & {
    style?: VmlShapeStyle;
    children?: SectionChild[];
  },
  ctx: BodyContext,
): string {
  // Destructure to separate VML style/children from paragraph properties
  const { style, children, ...paraOpts } = opts;
  const props = stringifyParagraphProperties(paraOpts);
  const pPrXml = props.xml ?? "";

  // Textbox content — serialize children via stringifyBodyChild
  const contentParts: string[] = [];
  if (children) {
    for (const c of children) {
      contentParts.push(stringifyBodyChild(c, ctx));
    }
  }
  const txbxContent = contentParts.join("");

  const vshape = stringifyVmlShape({
    id: nextVmlShapeId(),
    type: "#_x0000_t202",
    style,
    textbox: {
      style: { fitShapeToText: true },
      insetmode: "auto",
      txbxContent,
    },
  });

  // w:pict is run-level content (EG_RunInnerContent) — Word rejects it bare
  // under w:p, so the textbox paragraph carries its VML shape inside a run
  return `<w:p>${pPrXml}<w:r><w:pict>${vshape}</w:pict></w:r></w:p>`;
}

// ── Document body ──

/** Document-level namespace string (cached, MS Word declaration order). */
const DOC_NS = documentNamespaceAttributes([
  "wpc",
  "mc",
  "o",
  "r",
  "m",
  "v",
  "wp14",
  "wp",
  "w10",
  "w",
  "w14",
  "w15",
  "wpg",
  "wpi",
  "wne",
  "wps",
  "cx",
  "cx1",
  "cx2",
  "cx3",
  "cx4",
  "cx5",
  "cx6",
  "cx7",
  "cx8",
  "aink",
  "am3d",
  "w16cex",
  "w16cid",
  "w16",
  "w16sdtdh",
  "w16se",
]);

/**
 * Stringify the complete document.xml from context data.
 *
 * This is the pure JSON path — iterates raw section children via
 * `stringifyBodyChild()` while reusing existing SectionProperties
 * instances for sectPr XML (which are already created with correct
 * header/footer references).
 *
 * Produces the complete `<w:document>` element including namespaces,
 * background, body content with interleaved section properties.
 */
export function stringifyDocumentXml(ctx: DocxWriteContext, docCtx: BodyContext): string {
  const sections = ctx._options.sections;
  const bodySections = ctx.sectionProperties;
  const parts: string[] = [];

  // <w:document> open tag
  const conformanceAttr = ctx._options.conformance
    ? ` w:conformance="${ctx._options.conformance}"`
    : "";
  parts.push(`<w:document ${DOC_NS} mc:Ignorable="w14 w15 wp14"${conformanceAttr}>`);

  // Background (if any)
  if (ctx._options.background) {
    parts.push(stringifyDocumentBackground(ctx._options.background, docCtx));
  }

  // <w:body> — children go straight into `parts` (single join, no intermediate)
  parts.push("<w:body>");

  for (let si = 0; si < sections.length; si++) {
    const section = sections[si]!;
    const children = section.children ?? [];
    const sectPrOpts = bodySections[si];
    const sectPrXml = sectPrOpts ? (sectionPropertiesDesc.stringify(sectPrOpts, docCtx) ?? "") : "";
    const isLast = si === sections.length - 1;

    // Per OOXML, a non-final section's sectPr lives in the pPr of its LAST
    // paragraph (the section-break paragraph carries both content and sectPr).
    // Host it there when possible; fall back to a dedicated break paragraph if
    // the section is empty or ends in a non-paragraph child. The last section
    // emits its sectPr at the body level — and only the last section may omit
    // it: a mid-document section with no explicit properties still emits an
    // empty <w:sectPr/> (CT_SectPr children are all optional) so the
    // user-declared boundary survives generate→parse.
    let sectPrHosted = isLast;
    for (let ci = 0; ci < children.length; ci++) {
      const child = children[ci]!;
      const inject =
        !isLast &&
        sectPrXml &&
        ci === children.length - 1 &&
        ("paragraph" in child || "toc" in child);
      if (inject) sectPrHosted = true;
      parts.push(stringifyBodyChild(child, docCtx, inject ? sectPrXml : undefined));
    }
    if (!isLast && !sectPrHosted) {
      parts.push(`<w:p><w:pPr>${sectPrXml || "<w:sectPr/>"}</w:pPr></w:p>`);
    }
    if (isLast && (sectPrXml || sections.length > 1)) {
      // A single-section document without properties stays sectPr-free (Word
      // applies defaults); with multiple sections the final boundary is
      // structural too and emits an empty sectPr to keep the section count.
      parts.push(sectPrXml || "<w:sectPr/>");
    }
  }

  parts.push("</w:body></w:document>");

  return dedupeRevisionIds(parts.join(""));
}

// Revision markers carry document-unique @w:id values (the SDK enforces
// uniqueness). Hand-written options may repeat an id across the markers of one
// logical edit; renumber only the duplicates so round-tripped sources keep
// their original ids byte-for-byte.
const REVISION_ID_TAGS =
  /(<w:(?:ins|del|moveFrom|moveTo|cellIns|cellDel|cellMerge|cellSplit|rPrChange|pPrChange|trPrChange|tcPrChange|sectPrChange|tblPrChange|tblGridChange)\b[^>]*w:id=")(\d+)(")/g;

function dedupeRevisionIds(xml: string): string {
  const seen = new Set<string>();
  let hasDup = false;
  for (const m of xml.matchAll(REVISION_ID_TAGS)) {
    if (seen.has(m[2]!)) hasDup = true;
    seen.add(m[2]!);
  }
  if (!hasDup) return xml;
  const taken = new Set(seen);
  return xml.replace(REVISION_ID_TAGS, (m, pre: string, id: string, post: string) => {
    const first = !seen.has(id);
    seen.add(id);
    if (first) return m;
    let n = 0;
    while (taken.has(String(n))) n++;
    taken.add(String(n));
    return `${pre}${n}${post}`;
  });
}

// ────────────────────────────────────────────────────────────────────────────────
// Parse (XML → JSON options)
// ────────────────────────────────────────────────────────────────────────────────

const HEADING_MAP: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  Heading1: HeadingLevel.HEADING_1,
  Heading2: HeadingLevel.HEADING_2,
  Heading3: HeadingLevel.HEADING_3,
  Heading4: HeadingLevel.HEADING_4,
  Heading5: HeadingLevel.HEADING_5,
  Heading6: HeadingLevel.HEADING_6,
  Title: HeadingLevel.TITLE,
};

/** Valid w:spacing/`@w:lineRule` values (ST_LineSpacingRule). */
const LINE_RULES = Object.values(LineRuleType) as readonly string[];

// On/off paragraph properties: XML child tag → options key.
const ON_OFF_PARAGRAPH_PROPS = [
  ["w:keepNext", "keepNext"],
  ["w:keepLines", "keepLines"],
  ["w:pageBreakBefore", "pageBreakBefore"],
  ["w:widowControl", "widowControl"],
  ["w:suppressLineNumbers", "suppressLineNumbers"],
  ["w:contextualSpacing", "contextualSpacing"],
  ["w:bidi", "bidirectional"],
  ["w:wordWrap", "wordWrap"],
  ["w:suppressAutoHyphens", "suppressAutoHyphens"],
  ["w:adjustRightInd", "adjustRightInd"],
  ["w:snapToGrid", "snapToGrid"],
  ["w:mirrorIndents", "mirrorIndents"],
  ["w:kinsoku", "kinsoku"],
  ["w:topLinePunct", "topLinePunct"],
  ["w:autoSpaceDE", "autoSpaceDE"],
  ["w:autoSpaceDN", "autoSpaceEastAsianText"],
  ["w:overflowPunct", "overflowPunctuation"],
  ["w:suppressOverlap", "suppressOverlap"],
] as const;

// pBdr side element names (CT_PBdr children order).
const PBDR_SIDES = ["top", "bottom", "left", "right", "between", "bar"] as const;

// Inline element payloads extracted from the ParagraphChild union — used by
// parse to build typed objects instead of Record<string, unknown>.
type SmartTagInlineOptions = Extract<ParagraphChild, { smartTag: unknown }>["smartTag"];
type CustomXmlInlineOptions = Extract<ParagraphChild, { customXml: unknown }>["customXml"];
type DirInlineOptions = Extract<ParagraphChild, { dir: unknown }>["dir"];
type HyperlinkInlineOptions = Extract<ParagraphChild, { hyperlink: unknown }>["hyperlink"];
type PermStartInlineOptions = Extract<ParagraphChild, { permStart: unknown }>["permStart"];

/**
 * Parse w:pPr element into paragraph properties (without children).
 */
export function parseParagraphProperties(
  el: Element,
  ctx: DocxReadContext,
): Partial<ParagraphPropertiesOptions> {
  const opts: Partial<ParagraphPropertiesOptions> = {};

  // Style / heading
  const pStyle = findChild(el, "w:pStyle");
  if (pStyle) {
    const styleVal = attr(pStyle, "w:val");
    if (styleVal) {
      if (HEADING_MAP[styleVal]) {
        opts.heading = HEADING_MAP[styleVal];
      } else {
        opts.style = styleVal;
      }
    }
  }

  // Alignment
  const jc = findChild(el, "w:jc");
  if (jc) {
    const val = attr(jc, "w:val");
    if (val) opts.alignment = xsdJcAlignment.from(val) as ParagraphPropertiesOptions["alignment"];
  }

  // Spacing — before/after/line are ST_TwipsMeasure (number | UniversalMeasure);
  // use attrMeasure so UniversalMeasure round-trips with the stringify side.
  const spacing = findChild(el, "w:spacing");
  if (spacing) {
    const sp: SpacingProperties = {};
    const before = attrMeasure(spacing, "w:before");
    if (before !== undefined) sp.before = before as SpacingProperties["before"];
    const after = attrMeasure(spacing, "w:after");
    if (after !== undefined) sp.after = after as SpacingProperties["after"];
    const line = attrMeasure(spacing, "w:line");
    if (line !== undefined) sp.line = line as SpacingProperties["line"];
    const lineRule = attr(spacing, "w:lineRule");
    if (lineRule && (LINE_RULES as readonly string[]).includes(lineRule)) {
      sp.lineRule = lineRule as SpacingProperties["lineRule"];
    }
    const beforeAutoSpacing = attrBool(spacing, "w:beforeAutospacing");
    if (beforeAutoSpacing !== undefined) sp.beforeAutoSpacing = beforeAutoSpacing;
    const afterAutoSpacing = attrBool(spacing, "w:afterAutospacing");
    if (afterAutoSpacing !== undefined) sp.afterAutoSpacing = afterAutoSpacing;
    const beforeLines = attrNum(spacing, "w:beforeLines");
    if (beforeLines !== undefined) sp.beforeLines = beforeLines;
    const afterLines = attrNum(spacing, "w:afterLines");
    if (afterLines !== undefined) sp.afterLines = afterLines;
    if (Object.keys(sp).length > 0) opts.spacing = sp;
  }

  // Indent — left/right/start/end are ST_SignedTwipsMeasure, hanging/firstLine
  // are ST_TwipsMeasure (number | UniversalMeasure); use attrMeasure so
  // UniversalMeasure round-trips. *Chars are ST_DecimalNumber (pure number).
  const ind = findChild(el, "w:ind");
  if (ind) {
    const indentObj: IndentProperties = {};
    const left = attrMeasure(ind, "w:left");
    if (left !== undefined) indentObj.left = left as IndentProperties["left"];
    const leftChars = attrNum(ind, "w:leftChars");
    if (leftChars !== undefined) indentObj.leftChars = leftChars;
    const right = attrMeasure(ind, "w:right");
    if (right !== undefined) indentObj.right = right as IndentProperties["right"];
    const rightChars = attrNum(ind, "w:rightChars");
    if (rightChars !== undefined) indentObj.rightChars = rightChars;
    const start = attrMeasure(ind, "w:start");
    if (start !== undefined) indentObj.start = start as IndentProperties["start"];
    const startChars = attrNum(ind, "w:startChars");
    if (startChars !== undefined) indentObj.startChars = startChars;
    const end = attrMeasure(ind, "w:end");
    if (end !== undefined) indentObj.end = end as IndentProperties["end"];
    const endChars = attrNum(ind, "w:endChars");
    if (endChars !== undefined) indentObj.endChars = endChars;
    const hanging = attrMeasure(ind, "w:hanging");
    if (hanging !== undefined) indentObj.hanging = hanging as IndentProperties["hanging"];
    const hangingChars = attrNum(ind, "w:hangingChars");
    if (hangingChars !== undefined) indentObj.hangingChars = hangingChars;
    const firstLine = attrMeasure(ind, "w:firstLine");
    if (firstLine !== undefined) indentObj.firstLine = firstLine as IndentProperties["firstLine"];
    const firstLineChars = attrNum(ind, "w:firstLineChars");
    if (firstLineChars !== undefined) indentObj.firstLineChars = firstLineChars;
    if (Object.keys(indentObj).length > 0) opts.indent = indentObj;
  }

  // Numbering (w:numPr)
  const numPr = findChild(el, "w:numPr");
  if (numPr) {
    const ilvl = findChild(numPr, "w:ilvl");
    // No w:ilvl → level stays undefined (numId-only numPr inherits the level).
    const level = ilvl ? attrNum(ilvl, "w:val") : undefined;
    const numIdEl = findChild(numPr, "w:numId");
    const numId = numIdEl ? attr(numIdEl, "w:val") : undefined;
    if (numId === "0") {
      // numId=0 is the OOXML reserved value that cancels numbering inherited
      // from the paragraph style — emit numId=0 verbatim instead of falling
      // back to a bullet (which would inject ListParagraph + numId=1). A
      // w:ilvl alongside keeps its level pin.
      opts.numbering = level !== undefined ? { none: true, level } : false;
    } else if (numId === undefined) {
      // A numPr without numId carries nothing resolvable — except tracked
      // revision markers (w:ins / w:numberingChange): the numbering property
      // set itself is a revision inheriting its numbering from the style
      // chain. Keep those, and keep a bare w:ilvl too (level override with
      // the numbering definition still inherited from the style chain); the
      // bullet fallback would fabricate numId=1 + ListParagraph the source
      // never had.
      const insEl = findChild(numPr, "w:ins");
      const numberingChangeEl = findChild(numPr, "w:numberingChange");
      if (level !== undefined) {
        opts.numbering = { levelOnly: true, level };
      } else if (insEl || numberingChangeEl) {
        const rev: {
          revisionOnly: true;
          numberingChange?: { original: string; id: string; author: string; date?: string };
          insertion?: NumberingInsertionOptions;
        } = { revisionOnly: true };
        if (numberingChangeEl) {
          const nc: { original: string; id: string; author: string; date?: string } = {
            original: attr(numberingChangeEl, "w:original") ?? "",
            id: attr(numberingChangeEl, "w:id") ?? "",
            author: attr(numberingChangeEl, "w:author") ?? "",
          };
          const ncDate = attr(numberingChangeEl, "w:date");
          if (ncDate) nc.date = ncDate;
          rev.numberingChange = nc;
        }
        if (insEl) {
          const ins: Partial<NumberingInsertionOptions> = {
            id: attr(insEl, "w:id") ?? "",
            author: attr(insEl, "w:author") ?? "",
          };
          const insDate = attr(insEl, "w:date");
          if (insDate) ins.date = insDate;
          rev.insertion = ins as NumberingInsertionOptions;
        }
        opts.numbering = rev;
      }
    } else if (ctx.numberingCache.size > 0) {
      // Cache lookup ("" = a w:num lacking the abstractNumId child → treated
      // like an unknown id, falling to the bullet, same as the old inline scan).
      const abstractNumId = ctx.numIdCache.get(numId);
      if (abstractNumId) {
        // autoStyle: false suppresses the ListParagraph pStyle auto-injection
        // in stringifyParagraphProperties. Round-tripped list paragraphs carry
        // no pStyle in the source (the list formatting lives in numbering);
        // injecting ListParagraph would reference a style that round-tripped
        // styles.xml may not define → dangling reference Word rejects.
        const numberingOpts: {
          reference: string;
          level?: number;
          autoStyle: boolean;
          numberingChange?: { original: string; id: string; author: string; date?: string };
          insertion?: NumberingInsertionOptions;
        } = { reference: `list_${numId}`, level, autoStyle: false };
        // w:numberingChange (CT_TrackChangeNumbering) — child of w:numPr
        const numberingChangeEl = findChild(numPr, "w:numberingChange");
        if (numberingChangeEl) {
          const nc: { original: string; id: string; author: string; date?: string } = {
            original: attr(numberingChangeEl, "w:original") ?? "",
            id: attr(numberingChangeEl, "w:id") ?? "",
            author: attr(numberingChangeEl, "w:author") ?? "",
          };
          const ncDate = attr(numberingChangeEl, "w:date");
          if (ncDate) nc.date = ncDate;
          numberingOpts.numberingChange = nc;
        }
        // w:ins (CT_TrackChange) — numbering applied as a revision
        const insEl = findChild(numPr, "w:ins");
        if (insEl) {
          const ins: Partial<NumberingInsertionOptions> = {
            id: attr(insEl, "w:id") ?? "",
            author: attr(insEl, "w:author") ?? "",
          };
          const insDate = attr(insEl, "w:date");
          if (insDate) ins.date = insDate;
          numberingOpts.insertion = ins as NumberingInsertionOptions;
        }
        opts.numbering = numberingOpts;
      } else {
        opts.bullet = { level: level ?? 0 };
      }
    } else {
      opts.bullet = { level: level ?? 0 };
    }
  }

  // Tab stops
  const tabs = findChild(el, "w:tabs");
  if (tabs) {
    const tabStops: TabStopDefinition[] = [];
    for (const tab of tabs.elements ?? []) {
      if (tab.name !== "w:tab") continue;
      const tabObj: Partial<TabStopDefinition> = {};
      const pos = attrNum(tab, "w:pos");
      if (pos !== undefined) tabObj.position = pos;
      const val = attr(tab, "w:val");
      if (val) tabObj.type = val as TabStopDefinition["type"];
      const leader = attr(tab, "w:leader");
      if (leader) tabObj.leader = leader as TabStopDefinition["leader"];
      tabStops.push(tabObj as TabStopDefinition);
    }
    if (tabStops.length > 0) opts.tabStops = tabStops;
  }

  // On/off properties
  for (const [name, optKey] of ON_OFF_PARAGRAPH_PROPS) {
    const child = findChild(el, name);
    if (child) opts[optKey] = attrBool(child, "w:val") ?? true;
  }

  // Thematic break
  const pBdr = findChild(el, "w:pBdr");
  if (pBdr) {
    const border: BordersOptions = {};
    for (const side of PBDR_SIDES) {
      const sideEl = findChild(pBdr, `w:${side}`);
      if (!sideEl) continue;
      const sideOpts = parseBorderSide(sideEl);
      if (!sideOpts) continue;
      border[side] = sideOpts;
    }
    if (Object.keys(border).length > 0) opts.border = border;
  }

  // Shading
  const shd = findChild(el, "w:shd");
  if (shd) {
    const shading = parseShading(shd);
    if (shading) opts.shading = shading;
  }

  // Text alignment
  const textAlignment = findChild(el, "w:textAlignment");
  if (textAlignment) {
    const val = attr(textAlignment, "w:val");
    if (val) opts.textAlignment = val as ParagraphPropertiesOptions["textAlignment"];
  }

  // Outline level
  const outlineLvl = findChild(el, "w:outlineLvl");
  if (outlineLvl) {
    const val = attrNum(outlineLvl, "w:val");
    if (val !== undefined) opts.outlineLevel = val;
  }

  // Text direction (w:textDirection — ST_TextDirection).
  const textDirection = findChild(el, "w:textDirection");
  if (textDirection) {
    const val = attr(textDirection, "w:val");
    if (val) opts.textDirection = val as ParagraphPropertiesOptions["textDirection"];
  }

  // Textbox tight wrap (w:textboxTightWrap).
  const textboxTightWrap = findChild(el, "w:textboxTightWrap");
  if (textboxTightWrap) {
    const val = attr(textboxTightWrap, "w:val");
    if (val) opts.textboxTightWrap = val as ParagraphPropertiesOptions["textboxTightWrap"];
  }

  // HTML div id (w:divId).
  const divIdEl = findChild(el, "w:divId");
  if (divIdEl) {
    const val = attrNum(divIdEl, "w:val");
    if (val !== undefined) opts.divId = val;
  }

  // Conditional formatting style (w:cnfStyle — CT_Cnf w:val or 12 attrs).
  const cnfStyle = findChild(el, "w:cnfStyle");
  if (cnfStyle) {
    const cnf = parseCnfStyle(cnfStyle);
    if (cnf) opts.cnfStyle = cnf;
  }

  // Run properties (paragraph-level defaults) — the paragraph-mark
  // track-change markers (w:ins/w:del inside w:rPr) ride along on them.
  const rPr = findChild(el, "w:rPr");
  if (rPr) {
    const run = parseRunProperties(rPr) as ParagraphRunPropertiesOptions;
    const ins = findChild(rPr, "w:ins");
    if (ins) {
      run.insertion = {
        id: attrNum(ins, "w:id") ?? 0,
        author: attr(ins, "w:author") ?? "",
        date: attr(ins, "w:date") ?? "",
      };
    }
    const del = findChild(rPr, "w:del");
    if (del) {
      run.deletion = {
        id: attrNum(del, "w:id") ?? 0,
        author: attr(del, "w:author") ?? "",
        date: attr(del, "w:date") ?? "",
      };
    }
    opts.run = run;
  }

  // Frame properties — rebuilt into the public FrameOptions union so parse
  // output re-enters generate unchanged (CT_FramePr attributes are all
  // optional, hence the optional base fields).
  const framePr = findChild(el, "w:framePr");
  if (framePr) {
    // Mutable superset of the FrameOptions union members — cast once at the end.
    const frame: {
      type?: "absolute" | "alignment";
      position?: { x?: number | UniversalMeasure; y?: number | UniversalMeasure };
      alignment?: { x?: string; y?: string };
      anchor?: { horizontal?: string; vertical?: string };
      space?: { horizontal?: number | UniversalMeasure; vertical?: number | UniversalMeasure };
      dropCap?: string;
      lines?: string;
      wrap?: string;
      rule?: string;
      anchorLock?: boolean;
      width?: number | UniversalMeasure;
      height?: number | UniversalMeasure;
    } = {};
    for (const [attrName, optName] of [
      ["w:dropCap", "dropCap"],
      ["w:lines", "lines"],
      ["w:wrap", "wrap"],
      ["w:hRule", "rule"],
    ] as const) {
      const val = attr(framePr, attrName);
      if (val !== undefined) frame[optName] = val;
    }
    // Position: absolute coordinates (w:x/w:y) vs alignment (w:xAlign/w:yAlign)
    const x = attrMeasure(framePr, "w:x") as number | UniversalMeasure;
    const y = attrMeasure(framePr, "w:y") as number | UniversalMeasure;
    const xAlign = attr(framePr, "w:xAlign");
    const yAlign = attr(framePr, "w:yAlign");
    if (x !== undefined || y !== undefined) {
      frame.type = "absolute";
      frame.position = { ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}) };
    } else if (xAlign || yAlign) {
      frame.type = "alignment";
      frame.alignment = {
        ...(xAlign ? { x: xAlign } : {}),
        ...(yAlign ? { y: yAlign } : {}),
      };
    }
    // Anchor (hAnchor/vAnchor)
    const hAnchor = attr(framePr, "w:hAnchor");
    const vAnchor = attr(framePr, "w:vAnchor");
    if (hAnchor || vAnchor) {
      frame.anchor = {
        ...(hAnchor ? { horizontal: hAnchor } : {}),
        ...(vAnchor ? { vertical: vAnchor } : {}),
      };
    }
    // Spacing (hSpace/vSpace)
    const hSpace = attrMeasure(framePr, "w:hSpace") as number | UniversalMeasure;
    const vSpace = attrMeasure(framePr, "w:vSpace") as number | UniversalMeasure;
    if (hSpace !== undefined || vSpace !== undefined) {
      frame.space = {
        ...(hSpace !== undefined ? { horizontal: hSpace } : {}),
        ...(vSpace !== undefined ? { vertical: vSpace } : {}),
      };
    }
    const anchorLock = attrBool(framePr, "w:anchorLock");
    if (anchorLock !== undefined) frame.anchorLock = anchorLock;
    const w = attrMeasure(framePr, "w:w") as number | UniversalMeasure;
    if (w !== undefined) frame.width = w;
    const h = attrMeasure(framePr, "w:h") as number | UniversalMeasure;
    if (h !== undefined) frame.height = h;
    if (Object.keys(frame).length > 0) opts.frame = frame as FrameOptions;
  }

  // Revision (w:pPrChange) — symmetric with stringifyParagraphProperties
  const pPrChange = findChild(el, "w:pPrChange");
  if (pPrChange) {
    const rev: Partial<ParagraphPropertiesChangeOptions> = {};
    const author = attr(pPrChange, "w:author");
    if (author) rev.author = author;
    const revDate = attr(pPrChange, "w:date");
    if (revDate) rev.date = revDate;
    const revId = attrNum(pPrChange, "w:id");
    if (revId !== undefined) rev.id = revId;
    const innerPPr = findChild(pPrChange, "w:pPr");
    if (innerPPr) Object.assign(rev, parseParagraphProperties(innerPPr, ctx));
    if (Object.keys(rev).length > 0) opts.revision = rev as ParagraphPropertiesChangeOptions;
  }

  // A bare <w:pPr/> yields no fields — mark the presence so stringify
  // re-emits the empty element. A pPr whose only child is w:sectPr is not
  // empty: the section model owns that sectPr and re-injects it here, so the
  // marker must not claim the pPr.
  if (Object.keys(opts).length === 0 && !findChild(el, "w:sectPr")) {
    opts.emptyProperties = true;
  }

  return opts;
}

// CT_Cnf attribute order — shared by parseCnfStyle (w:val digits + w: attrs).
const CNF_KEYS = [
  "firstRow",
  "lastRow",
  "firstColumn",
  "lastColumn",
  "oddVBand",
  "evenVBand",
  "oddHBand",
  "evenHBand",
  "firstRowFirstColumn",
  "firstRowLastColumn",
  "lastRowFirstColumn",
  "lastRowLastColumn",
] as const;

/** Read w:cnfStyle (CT_Cnf). Office's canonical w:val is a 12-char [01]*
 *  string (ST_Cnf), one digit per flag in CNF_KEYS order; the XSD also
 *  permits 12 individual w: attributes, parsed as a fallback. */
function parseCnfStyle(el: Element): NonNullable<ParagraphPropertiesOptions["cnfStyle"]> {
  const val = attr(el, "w:val");
  const result: Record<string, boolean> = {};
  if (val && val.length === 12) {
    for (let i = 0; i < 12; i++) {
      if (val[i] === "1") result[CNF_KEYS[i]!] = true;
    }
  } else {
    for (const key of CNF_KEYS) {
      if (attrBool(el, `w:${key}`)) result[key] = true;
    }
  }
  // An empty object preserves the presence of a bare/all-zero CT_Cnf element;
  // undefined remains reserved for an absent w:cnfStyle child.
  return result as NonNullable<ParagraphPropertiesOptions["cnfStyle"]>;
}

/**
 * Concatenate `<w:t>` text in a run element.
 *
 * Used to capture a textInput form field's current value from the result run
 * (the runs between the `separate` and `end` fldChars). Only `<w:t>` is read —
 * `<w:tab>`/`<w:br>` in results are ignored as rare for user-entered text.
 */
/** Field-chain accumulator state, shared by the paragraph and track-change run loops. */
interface FieldRunState {
  kind: "form" | "complex" | null;
  pendingFormField: FormFieldOptions | null;
  pendingInstruction: string;
  pendingResult: string;
  controlRPr?: string;
  resultRPr?: string;
  /** Field nesting depth (1 = outermost field). */
  depth: number;
  /** The outer field's begin run — checked for a co-located pagination hint. */
  beginRunEl?: Element;
  collectingResult: boolean;
  /** Instruction-stage run elements (begin → separate/end), buffered for the
   *  plain-shape check at the closing end marker. */
  instrRunEls: Element[];
  /** Result-stage run elements (separate → end), buffered likewise. */
  resultRunEls: Element[];
}

const initialFieldRunState = (): FieldRunState => ({
  kind: null,
  depth: 0,
  pendingFormField: null,
  pendingInstruction: "",
  pendingResult: "",
  collectingResult: false,
  instrRunEls: [],
  resultRunEls: [],
});

/**
 * True when the field-stage runs are exactly what the plain stringify template
 * reproduces: a single run with the expected rPr whose only child is the
 * stage's text element. Multi-run chains (leading/trailing space runs with
 * their own rStyle, w:br inside the format switch, per-run rFonts on result
 * segments) need the verbatim channel.
 */
function isPlainFieldRuns(
  runs: Element[],
  expectedRPr: string | undefined,
  tags: string[],
): boolean {
  if (runs.length === 0) return true;
  if (runs.length > 1) return false;
  const run = runs[0]!;
  if (runRPrXml(run) !== expectedRPr) return false;
  const content = (run.elements ?? []).filter((c) => c.name !== "w:rPr");
  return content.length === 1 && tags.includes(content[0]!.name!);
}

/**
 * Feed one w:r element into the field accumulator. A field (form field OR
 * plain complex field) spans several runs (begin fldChar → instrText →
 * separate → result → end):
 * - Form fields carry w:ffData on the begin fldChar; their state lives there,
 *   and only a textInput's result is captured (as `value`).
 * - Plain complex fields (PAGE/DATE/TOC/HYPERLINK...) have no ffData; their
 *   instrText + result are captured as a complexField child for round-trip.
 * Control and in-field runs are consumed; the closing run returns the whole
 * field collapsed to a single child. Runs outside any field pass through.
 */
function feedFieldRun(
  run: Element,
  state: FieldRunState,
): { consumed: boolean; child?: ParagraphChild } {
  const fldCharEl = findChild(run, "w:fldChar");
  if (fldCharEl) {
    const fctype = attr(fldCharEl, "w:fldCharType");
    if (fctype === "begin") {
      // A nested field opening inside an outer field's instruction/result span
      // (e.g. `t "<seq Appendix>-<seq Figure>"` marker fields): keep the whole
      // nested chain verbatim in the outer field's stage buffer instead of
      // resetting the accumulator — the plain state machine cannot represent
      // interleaved instructions, and the verbatim channel round-trips them.
      if (state.kind === "complex" && state.depth > 0) {
        state.depth++;
        (state.collectingResult ? state.resultRunEls : state.instrRunEls).push(run);
        return { consumed: true };
      }
      const ffDataEl = findChild(fldCharEl, "w:ffData");
      if (ffDataEl) {
        state.kind = "form";
        state.pendingFormField = parseFormFieldData(ffDataEl);
      } else {
        state.kind = "complex";
        state.pendingInstruction = "";
        state.pendingResult = "";
      }
      // The begin run's rPr stands in for the field's control-run rPr.
      state.controlRPr = runRPrXml(run);
      state.beginRunEl = run;
      state.resultRPr = undefined;
      state.collectingResult = false;
      state.depth = 1;
      state.instrRunEls = [];
      state.resultRunEls = [];
    } else if (fctype === "separate") {
      if (state.kind === "complex" && state.depth > 1) {
        (state.collectingResult ? state.resultRunEls : state.instrRunEls).push(run);
        return { consumed: true };
      }
      state.collectingResult = true;
      state.resultRunEls = [];
    } else if (fctype === "end" && state.kind) {
      if (state.kind === "complex" && state.depth > 1) {
        state.depth--;
        (state.collectingResult ? state.resultRunEls : state.instrRunEls).push(run);
        return { consumed: true };
      }
      let child: ParagraphChild | undefined;
      if (state.kind === "form" && state.pendingFormField) {
        child = { formField: state.pendingFormField };
      } else if (state.kind === "complex") {
        const cf: ComplexFieldOptions = { instruction: state.pendingInstruction };
        // Pagination hint parked on the begin run — re-emit it on the begin run.
        if (findChild(state.beginRunEl ?? run, "w:lastRenderedPageBreak")) {
          cf.lastRenderedPageBreak = true;
        }
        // Mark the result present when the field carried any result run — an
        // empty-text result still round-trips its separate marker.
        if (state.resultRunEls.length > 0) cf.result = state.pendingResult;
        if (state.controlRPr) cf.rPrXml = state.controlRPr;
        if (state.resultRPr) cf.resultRPrXml = state.resultRPr;
        // Word styles the end run like the result (not like the controls).
        const endRPr = runRPrXml(run);
        if (endRPr && endRPr !== state.controlRPr) cf.endRPrXml = endRPr;
        if (
          !isPlainFieldRuns(state.instrRunEls, state.controlRPr, ["w:instrText", "w:delInstrText"])
        ) {
          cf.instrRunsXml = state.instrRunEls.map((el) => stringifyElement(el)).join("");
        }
        // The plain result template pairs the result rPr (defaulting to the
        // control rPr) with a single text run — anything else goes verbatim.
        if (
          !isPlainFieldRuns(state.resultRunEls, state.resultRPr ?? state.controlRPr, [
            "w:t",
            "w:delText",
          ])
        ) {
          cf.resultRunsXml = state.resultRunEls.map((el) => stringifyElement(el)).join("");
        }
        child = { complexField: cf };
      }
      state.kind = null;
      state.depth = 0;
      state.pendingFormField = null;
      state.collectingResult = false;
      state.instrRunEls = [];
      state.resultRunEls = [];
      return { consumed: true, child };
    }
    // An end (or separate) marker with no open field is the tail of a
    // cross-paragraph field the accumulator never saw. A bare marker run is
    // consumed silently (the field's own emit re-creates it); one carrying
    // extra content (pagination hint, rPr) round-trips verbatim so nothing
    // is lost.
    if (!state.kind) {
      // Only a run carrying real content beyond the marker (e.g. a pagination
      // hint) needs the verbatim channel — a bare or rPr-only end run is
      // re-created by the field's own emit path.
      const extras = (run.elements ?? []).filter(
        (c) => c.type === "element" && c.name !== "w:fldChar" && c.name !== "w:rPr",
      );
      if (extras.length > 0) {
        return { consumed: true, child: { rawXml: stringifyElement(run) } };
      }
    }
    return { consumed: true };
  }
  if (state.kind) {
    if (state.kind === "complex") {
      if (state.collectingResult) {
        // Capture the first result run's rPr for round-trip.
        if (state.resultRPr === undefined) state.resultRPr = runRPrXml(run);
        state.pendingResult += collectRunText(run);
        state.resultRunEls.push(run);
      } else {
        // Deleted fields spell the instruction w:delInstrText instead.
        const instrEl = findChild(run, "w:instrText") ?? findChild(run, "w:delInstrText");
        if (instrEl) state.pendingInstruction += textOf(instrEl);
        // Buffer the run for the verbatim channel when its shape is not what
        // the plain instruction template reproduces (per-run rPr, w:br...).
        state.instrRunEls.push(run);
      }
    } else if (state.collectingResult && state.pendingFormField?.textInput) {
      // Capture a textInput's current value; checkbox/dropdown results are
      // discarded (their state is in w:ffData).
      const text = collectRunText(run);
      if (text) {
        const ti = state.pendingFormField.textInput;
        ti.value = (ti.value ?? "") + text;
      }
    }
    return { consumed: true };
  }
  return { consumed: false };
}

/**
 * Parse a w:r that carries a drawing — direct w:drawing child OR wrapped in
 * mc:AlternateContent > mc:Choice (DrawingML shapes wpg/wps use this wrapper;
 * the Fallback holds the VML equivalent). Resolves either and, when an
 * AlternateContent wrapper is present, carries the Fallback as raw XML so the
 * full mc:AlternateContent round-trips verbatim. Returns undefined when the
 * run has no drawing (caller falls back to the plain-run path).
 */
function parseDrawingRunChild(child: Element, ctx: DocxReadContext): ParagraphChild | undefined {
  let drawingEl = findChild(child, "w:drawing");
  let altFallback: string | undefined;
  let altFallbackMedia: BackgroundRawMediaOptions[] | undefined;
  let altRequires: string | undefined;
  if (!drawingEl) {
    const alt = findChild(child, "mc:AlternateContent");
    if (alt) {
      const choice = findChild(alt, "mc:Choice");
      if (choice) {
        drawingEl = findChild(choice, "w:drawing");
        altRequires = attr(choice, "Requires");
      }
      const fallback = findChild(alt, "mc:Fallback");
      if (fallback) {
        // Replace the VML fallback's r:id/r:embed/r:link refs with {fileName}
        // placeholders and collect the media; otherwise the carried source
        // rIds dangle (not defined in the generated rels).
        const replaced = replaceRelsWithPlaceholders(stringifyElement(fallback), ctx);
        altFallback = replaced.rawXml;
        altFallbackMedia = replaced.rawMedia.length > 0 ? replaced.rawMedia : undefined;
      }
    }
  }
  if (!drawingEl) return undefined;
  const drawingChild = parseDrawingRun(drawingEl, ctx);
  if (!drawingChild) {
    // Unrecognized drawing payload (lockedCanvas, future graphicData URIs) —
    // keep the whole run verbatim instead of dropping the drawing.
    return { rawXml: stringifyElement(child) };
  }
  // Parse the wrapping run's rPr into structured fields so round-trip stays
  // editable (drawings/shapes can be wrapped in <w:r><w:rPr>…</w:rPr>…).
  const rPrEl = findChild(child, "w:rPr");
  const runProperties = rPrEl ? parseRunProperties(rPrEl) : undefined;
  // Attach the VML fallback + Choice Requires so stringify can rebuild the
  // mc:AlternateContent wrapper (Choice structured + Fallback raw).
  if (altFallback) {
    if ("wpsShape" in drawingChild) {
      drawingChild.wpsShape.vmlFallback = altFallback;
      drawingChild.wpsShape.vmlFallbackMedia = altFallbackMedia;
      if (altRequires) drawingChild.wpsShape.mcChoiceRequires = altRequires;
    } else if ("wpgGroup" in drawingChild) {
      drawingChild.wpgGroup.vmlFallback = altFallback;
      drawingChild.wpgGroup.vmlFallbackMedia = altFallbackMedia;
      if (altRequires) drawingChild.wpgGroup.mcChoiceRequires = altRequires;
    }
  }
  if (runProperties) {
    if ("picture" in drawingChild) {
      drawingChild.picture.runProperties = runProperties;
    } else if ("wpsShape" in drawingChild) {
      drawingChild.wpsShape.runProperties = runProperties;
    } else if ("wpgGroup" in drawingChild) {
      drawingChild.wpgGroup.runProperties = runProperties;
    } else if ("chart" in drawingChild) {
      drawingChild.chart.runProperties = runProperties;
    } else if ("smartArt" in drawingChild) {
      drawingChild.smartArt.runProperties = runProperties;
    }
  }
  // A run-level empty element (Word's pagination hint) sharing the drawing's
  // run — carried on the drawing options and emitted before the drawing.
  if (findChild(child, "w:lastRenderedPageBreak")) {
    if ("picture" in drawingChild) {
      drawingChild.picture.lastRenderedPageBreak = true;
    } else if ("wpsShape" in drawingChild) {
      drawingChild.wpsShape.lastRenderedPageBreak = true;
    } else if ("wpgGroup" in drawingChild) {
      drawingChild.wpgGroup.lastRenderedPageBreak = true;
    } else if ("chart" in drawingChild) {
      drawingChild.chart.lastRenderedPageBreak = true;
    } else if ("smartArt" in drawingChild) {
      drawingChild.smartArt.lastRenderedPageBreak = true;
    }
  }
  return drawingChild;
}

/**
 * Parse the children of a track-change wrapper (w:ins/w:del/w:moveFrom/w:moveTo):
 * runs (reference runs keep their shape as run-children), the comment range
 * markers Word anchors directly inside the wrapper, complete field chains,
 * drawings (wps shapes and text boxes inserted as revisions), and nested
 * same-family wrappers.
 */
function parseTrackChangeRuns(el: Element, ctx: DocxReadContext): TrackChangeChild[] {
  const out: TrackChangeChild[] = [];
  const fieldState = initialFieldRunState();
  for (const sub of el.elements ?? []) {
    if (sub.name === "w:r") {
      const fed = feedFieldRun(sub, fieldState);
      if (fed.consumed) {
        if (fed.child) out.push(fed.child as TrackChangeChild);
        continue;
      }
      const drawingChild = parseDrawingRunChild(sub, ctx);
      if (drawingChild) {
        out.push(drawingChild as TrackChangeChild);
        continue;
      }
      const parsed = parseRun(sub, ctx);
      const runOpts = parsedRunToOptions(parsed);
      if (typeof runOpts === "object" && "commentReference" in runOpts) {
        const { commentReference, properties } = runOpts as {
          commentReference: number;
          properties?: RunPropertiesOptions;
        };
        out.push({ ...properties, children: [{ commentReference }] });
        continue;
      }
      out.push(runOpts);
    } else if (sub.name === "w:commentRangeStart") {
      const m = parseMarkupRangeOptions(sub);
      if (m) out.push({ commentRangeStart: m });
    } else if (sub.name === "w:commentRangeEnd") {
      const m = parseMarkupRangeOptions(sub);
      if (m) out.push({ commentRangeEnd: m });
    } else if (sub.name === "w:proofErr") {
      // Spell/grammar markers can sit inside the wrapper (CT_RunTrackChange
      // accepts the full range-markup group).
      const type = attr(sub, "w:type");
      if (
        type === "spellStart" ||
        type === "spellEnd" ||
        type === "gramStart" ||
        type === "gramEnd"
      ) {
        out.push({ proofErr: type });
      }
    } else if (sub.name === "w:ins" || sub.name === "w:del") {
      // Nested wrappers (w:ins > w:del) — recurse with the same shape.
      const nested = parseTrackChangeRuns(sub, ctx);
      if (nested.length > 0) {
        const meta = {
          id: attrNum(sub, "w:id") ?? 0,
          author: attr(sub, "w:author") ?? "",
          date: attr(sub, "w:date") ?? "",
        };
        out.push(
          sub.name === "w:ins"
            ? { insertion: { ...meta, children: nested } }
            : { deletion: { ...meta, children: nested } },
        );
      }
    }
  }
  return out;
}

function collectRunText(el: Element): string {
  let text = "";
  // w:delText inside a deletion wrapper carries the same character data as
  // w:t — a deleted field's cached result is spelled that way.
  for (const c of el.elements ?? []) {
    if (c.name === "w:t" || c.name === "w:delText") text += textOf(c);
  }
  return text;
}

/**
 * Parse the inline children of a smartTag/customXml container (recursive).
 *
 * Handles runs and nested smartTag/customXml. Form fields, hyperlinks and
 * other paragraph-level constructs are rare inside these containers and are
 * not handled here.
 */
function parseContainerChildren(el: Element, ctx: DocxReadContext): ParagraphChild[] {
  const children: ParagraphChild[] = [];
  for (const sub of el.elements ?? []) {
    switch (sub.name) {
      case "w:r": {
        const parsed = parseRun(sub, ctx);
        children.push(parsedRunToOptions(parsed));
        break;
      }
      case "w:smartTag": {
        const smartTag = parseSmartTagInline(sub, ctx);
        if (smartTag) children.push({ smartTag });
        break;
      }
      case "w:customXml": {
        const customXml = parseCustomXmlInline(sub, ctx);
        if (customXml) children.push({ customXml });
        break;
      }
      default:
        break;
    }
  }
  return children;
}

/** Parse a w:smartTag element into its ParagraphChild form. */
function parseSmartTagInline(el: Element, ctx: DocxReadContext): SmartTagInlineOptions | undefined {
  const element = attr(el, "w:element");
  if (!element) return undefined;
  const st: SmartTagInlineOptions = { element };
  const uri = attr(el, "w:uri");
  if (uri) st.uri = uri;
  const pr = findChild(el, "w:smartTagPr");
  if (pr) {
    const props: Array<{ uri?: string; name: string; val: string }> = [];
    for (const a of pr.elements ?? []) {
      if (a.name !== "w:attr") continue;
      const prop: { uri?: string; name: string; val: string } = {
        name: attr(a, "w:name") ?? "",
        val: attr(a, "w:val") ?? "",
      };
      const auri = attr(a, "w:uri");
      if (auri) prop.uri = auri;
      props.push(prop);
    }
    if (props.length > 0) st.properties = props;
  }
  const content = parseContainerChildren(el, ctx);
  if (content.length > 0) st.children = content;
  return st;
}

/** Parse an inline w:customXml element into its ParagraphChild form. */
function parseCustomXmlInline(
  el: Element,
  ctx: DocxReadContext,
): CustomXmlInlineOptions | undefined {
  const element = attr(el, "w:element");
  if (!element) return undefined;
  const cx: CustomXmlInlineOptions = { element };
  const uri = attr(el, "w:uri");
  if (uri) cx.uri = uri;
  const pr = findChild(el, "w:customXmlPr");
  if (pr) {
    const parsed = parseCustomXmlProperties(pr);
    if (parsed.placeholder !== undefined || parsed.attributes !== undefined) {
      cx.properties = parsed;
    }
  }
  const content = parseContainerChildren(el, ctx);
  if (content.length > 0) cx.children = content;
  return cx;
}

/** Parse a move-revision range start (w:moveFromRangeStart / w:moveToRangeStart). */
function parseMoveRangeStart(el: Element): MoveRangeStartOptions | null {
  const id = attrNum(el, "w:id");
  if (id === undefined) return null;
  const m: Partial<MoveRangeStartOptions> = { id };
  const name = attr(el, "w:name");
  if (name !== undefined) m.name = name;
  const author = attr(el, "w:author");
  if (author !== undefined) m.author = author;
  const date = attr(el, "w:date");
  if (date !== undefined) m.date = date;
  const disp = attr(el, "w:displacedByCustomXml");
  if (disp === "next" || disp === "prev") m.displacedByCustomXml = disp as DisplacedByCustomXml;
  const colFirst = attrNum(el, "w:colFirst");
  if (colFirst !== undefined) m.colFirst = colFirst;
  const colLast = attrNum(el, "w:colLast");
  if (colLast !== undefined) m.colLast = colLast;
  return m as MoveRangeStartOptions;
}

/** Parse a customXml range start (Ins/Del/MoveFrom/MoveTo). */
function parseCustomXmlRangeStart(
  el: Element,
): { id: number; author?: string; date?: string } | null {
  const id = attrNum(el, "w:id");
  if (id === undefined) return null;
  const m: { id: number; author?: string; date?: string } = { id };
  const author = attr(el, "w:author");
  if (author !== undefined) m.author = author;
  const date = attr(el, "w:date");
  if (date !== undefined) m.date = date;
  return m;
}

/** Parse a CT_MarkupRange end marker (id + displacedByCustomXml). */
function parseMarkupRangeOptions(el: Element): MarkupRangeOptions | undefined {
  const id = attrNum(el, "w:id");
  if (id === undefined) return undefined;
  const m: Partial<MarkupRangeOptions> = { id };
  const disp = attr(el, "w:displacedByCustomXml");
  if (disp === "next" || disp === "prev") m.displacedByCustomXml = disp as DisplacedByCustomXml;
  return m as MarkupRangeOptions;
}

/**
 * Parse a w:p element into ParagraphOptions.
 */
/** Serialize a w:r's w:rPr child verbatim (or undefined when the run has none). */
export function runRPrXml(run: Element): string | undefined {
  const rPr = findChild(run, "w:rPr");
  return rPr ? stringifyElement(rPr) : undefined;
}

/** Parse a w:bookmarkStart element (id + name + table-column extents). */
export function parseBookmarkStartOptions(el: Element): BookmarkStartOptions | undefined {
  const id = attrNum(el, "w:id");
  const name = attr(el, "w:name");
  if (id === undefined || !name) return undefined;
  const bookmarkStart: Partial<BookmarkStartOptions> = { id, name };
  const disp = attr(el, "w:displacedByCustomXml");
  if (disp === "next" || disp === "prev")
    bookmarkStart.displacedByCustomXml = disp as DisplacedByCustomXml;
  const colFirst = attrNum(el, "w:colFirst");
  if (colFirst !== undefined) bookmarkStart.colFirst = colFirst;
  const colLast = attrNum(el, "w:colLast");
  if (colLast !== undefined) bookmarkStart.colLast = colLast;
  return bookmarkStart as BookmarkStartOptions;
}

/** Parse a w:bookmarkEnd element (id + displacedByCustomXml). */
export function parseBookmarkEndOptions(el: Element): MarkupRangeOptions | undefined {
  const id = attrNum(el, "w:id");
  if (id === undefined) return undefined;
  const bookmarkEnd: Partial<MarkupRangeOptions> = { id };
  const disp = attr(el, "w:displacedByCustomXml");
  if (disp === "next" || disp === "prev")
    bookmarkEnd.displacedByCustomXml = disp as DisplacedByCustomXml;
  return bookmarkEnd as MarkupRangeOptions;
}

/**
 * Parses one w:hyperlink element into a `{ hyperlink }` child, or null when it
 * carries no content. CT_Hyperlink content is EG_PContent, so a hyperlink may
 * nest another hyperlink (pandoc emits these for nested anchors) — recursion
 * handles both levels through the same shape.
 */
function parseHyperlinkChild(child: Element, ctx: DocxReadContext): ParagraphChild | null {
  const hl: Partial<HyperlinkInlineOptions> = {};
  const rId = attr(child, "r:id");
  if (rId) {
    // rId numbering is per-part: a hyperlink inside a footnote/header
    // resolves against that part's own rels first, then document.xml's.
    const target =
      ctx.docx.partRefs.partHyperlinks.get(ctx.currentPart)?.get(rId) ??
      ctx.docx.partRefs.hyperlinks.get(rId);
    if (target) hl.url = target;
  }
  const anchor = attr(child, "w:anchor");
  if (anchor) hl.anchor = anchor;
  const tooltip = attr(child, "w:tooltip");
  if (tooltip) hl.tooltip = tooltip;
  const tgtFrame = attr(child, "w:tgtFrame");
  if (tgtFrame) hl.targetFrame = tgtFrame;
  const docLocation = attr(child, "w:docLocation");
  if (docLocation) hl.docLocation = docLocation;
  const history = attrBool(child, "w:history");
  if (history !== undefined) hl.history = history;

  const linkRuns: (RunOptions | string | ParagraphChild)[] = [];
  // Field accumulator scoped to the hyperlink: Word nests complex fields
  // inside link content (e.g. the PAGEREF page number of a TOC entry),
  // fully closed within the hyperlink element.
  const fieldState = initialFieldRunState();
  for (const sub of child.elements ?? []) {
    if (sub.name === "w:r") {
      const fed = feedFieldRun(sub, fieldState);
      if (fed.consumed) {
        if (fed.child) linkRuns.push(fed.child);
        continue;
      }
      // Drawing runs inside hyperlinks (image links) resolve through the
      // same paragraph-child extraction — parseRun skips w:drawing.
      const drawingChild = parseDrawingRunChild(sub, ctx);
      if (drawingChild) {
        linkRuns.push(drawingChild);
        continue;
      }
      const parsed = parseRun(sub, ctx);
      const runOpts = parsedRunToOptions(parsed);
      // parsedRunToOptions returns { commentReference } for pure
      // comment-reference runs; hyperlink children are runs, so skip it.
      if (!("commentReference" in runOpts)) {
        linkRuns.push(runOpts);
      }
    } else if (sub.name === "w:hyperlink") {
      const nested = parseHyperlinkChild(sub, ctx);
      if (nested) linkRuns.push(nested);
    } else if (sub.name === "w:bookmarkStart") {
      // Bookmarks may open inside link content (Word parks _GoBack on the
      // last edit position, often an image link run).
      const bookmarkStart = parseBookmarkStartOptions(sub);
      if (bookmarkStart) linkRuns.push({ bookmarkStart });
    } else if (sub.name === "w:bookmarkEnd") {
      const bookmarkEnd = parseBookmarkEndOptions(sub);
      if (bookmarkEnd) linkRuns.push({ bookmarkEnd });
    }
  }
  if (linkRuns.length === 0) return null;
  hl.children = linkRuns;
  return { hyperlink: hl };
}

/**
 * Parse run-level children shared by paragraphs and inline-SDT content.
 * Includes the field accumulator that collapses form/complex fields spanning
 * multiple w:r runs into a single child.
 */
function parseRunLevelChildren(
  elements: Element[] | undefined,
  ctx: DocxReadContext,
): ParagraphChild[] {
  const childList: ParagraphChild[] = [];

  // Field accumulator — see feedFieldRun. The whole field collapses to a
  // single child.
  const fieldState = initialFieldRunState();

  for (const child of elements ?? []) {
    switch (child.name) {
      case "w:pPr":
        break;
      case "w:r": {
        // Field: fldChar markers + the instrText/result runs between them.
        const fed = feedFieldRun(child, fieldState);
        if (fed.consumed) {
          if (fed.child) childList.push(fed.child);
          break;
        }

        const drawingChild = parseDrawingRunChild(child, ctx);
        if (drawingChild) {
          childList.push(drawingChild);
          break;
        }
        const parsed = parseRun(child, ctx);
        childList.push(parsedRunToOptions(parsed));
        break;
      }
      case "w:hyperlink": {
        const hlChild = parseHyperlinkChild(child, ctx);
        if (hlChild) childList.push(hlChild);
        break;
      }
      case "w:subDoc": {
        // EG_PContent member — the sub-document insertion sits inside a
        // paragraph like a hyperlink, never directly under w:body
        childList.push({ subDoc: parseSubDoc(child, ctx) });
        break;
      }
      case "w:bookmarkStart": {
        const bookmarkStart = parseBookmarkStartOptions(child);
        if (bookmarkStart) childList.push({ bookmarkStart });
        break;
      }
      case "w:bookmarkEnd": {
        const bookmarkEnd = parseBookmarkEndOptions(child);
        if (bookmarkEnd) childList.push({ bookmarkEnd });
        break;
      }
      case "w:commentRangeStart": {
        const m = parseMarkupRangeOptions(child);
        if (m) childList.push({ commentRangeStart: m });
        break;
      }
      case "w:commentRangeEnd": {
        const m = parseMarkupRangeOptions(child);
        if (m) childList.push({ commentRangeEnd: m });
        break;
      }
      case "w:commentReference": {
        const id = attrNum(child, "w:id");
        if (id !== undefined) childList.push({ commentReference: id });
        break;
      }
      case "m:oMath": {
        const mathChildren = parseMathChildren(child);
        childList.push({ math: { children: mathChildren } });
        break;
      }
      case "m:oMathPara": {
        // Display math: m:oMathParaPr/m:jc + the inline equation it wraps.
        const jcEl = findChild(findChild(child, "m:oMathParaPr") ?? child, "m:jc");
        const jc = jcEl
          ? (attr(jcEl, "m:val") as "left" | "right" | "center" | "centerGroup" | undefined)
          : undefined;
        const oMathEl = findChild(child, "m:oMath");
        const mathChildren = oMathEl ? parseMathChildren(oMathEl) : [];
        childList.push({
          math: {
            children: mathChildren,
            display: true,
            ...(jc ? { justification: jc } : {}),
          },
        });
        break;
      }
      case "w:ins": {
        const children = parseTrackChangeRuns(child, ctx);
        if (children.length > 0) {
          childList.push({
            insertion: {
              id: attrNum(child, "w:id") ?? 0,
              author: attr(child, "w:author") ?? "",
              date: attr(child, "w:date") ?? "",
              children,
            },
          });
        }
        break;
      }
      case "w:del": {
        const children = parseTrackChangeRuns(child, ctx);
        if (children.length > 0) {
          childList.push({
            deletion: {
              id: attrNum(child, "w:id") ?? 0,
              author: attr(child, "w:author") ?? "",
              date: attr(child, "w:date") ?? "",
              children,
            },
          });
        }
        break;
      }
      case "w:moveFrom": {
        const children = parseTrackChangeRuns(child, ctx);
        if (children.length > 0) {
          childList.push({
            movedFrom: {
              id: attrNum(child, "w:id") ?? 0,
              author: attr(child, "w:author") ?? "",
              date: attr(child, "w:date") ?? "",
              children,
            },
          });
        }
        break;
      }
      case "w:moveTo": {
        const children = parseTrackChangeRuns(child, ctx);
        if (children.length > 0) {
          childList.push({
            movedTo: {
              id: attrNum(child, "w:id") ?? 0,
              author: attr(child, "w:author") ?? "",
              date: attr(child, "w:date") ?? "",
              children,
            },
          });
        }
        break;
      }
      case "w:fldSimple": {
        const instruction = attr(child, "w:instr");
        if (instruction) {
          const sf: {
            instruction: string;
            cachedValue?: string;
            cachedRunsXml?: string;
            fieldLock?: boolean;
            dirty?: boolean;
          } = { instruction };
          // cachedValue: concatenate the result-run <w:t> text (one or more
          // <w:r> children between the fldSimple tags). Some files carry the
          // result as w:instrText runs instead (nested-field expansions) —
          // those count as display text too.
          let cachedValue = "";
          const cachedRunEls: Element[] = [];
          for (const sub of child.elements ?? []) {
            if (sub.name === "w:r") {
              cachedValue += collectRunText(sub);
              for (const rc of sub.elements ?? []) {
                if (rc.name === "w:instrText") cachedValue += textOf(rc) ?? "";
              }
              cachedRunEls.push(sub);
            }
          }
          // Mark the cached value present when any run sat inside the field —
          // empty-text results still round-trip their run.
          if (cachedRunEls.length > 0) sf.cachedValue = cachedValue;
          // The plain template emits one bare text run — cached runs carrying
          // rPr (Word marks field results w:noProof) go through verbatim.
          if (!isPlainFieldRuns(cachedRunEls, undefined, ["w:t", "w:instrText"])) {
            sf.cachedRunsXml = cachedRunEls.map((el) => stringifyElement(el)).join("");
          }
          const sfLock = attrBool(child, "w:fldLock");
          if (sfLock !== undefined) sf.fieldLock = sfLock;
          const sfDirty = attrBool(child, "w:dirty");
          if (sfDirty !== undefined) sf.dirty = sfDirty;
          childList.push({ simpleField: sf });
        }
        break;
      }
      case "w:smartTag": {
        const st = parseSmartTagInline(child, ctx);
        if (st) childList.push({ smartTag: st });
        break;
      }
      case "w:customXml": {
        const cx = parseCustomXmlInline(child, ctx);
        if (cx) childList.push({ customXml: cx });
        break;
      }
      // ── Bidirectional containers (reuse the smartTag/customXml child parser) ──
      case "w:dir": {
        const val = attr(child, "w:val");
        if (val) {
          const dir: DirInlineOptions = { val: val as "ltr" | "rtl" };
          const content = parseContainerChildren(child, ctx);
          if (content.length > 0) dir.children = content;
          childList.push({ dir });
        }
        break;
      }
      case "w:bdo": {
        const val = attr(child, "w:val");
        if (val) {
          const bdo: DirInlineOptions = { val: val as "ltr" | "rtl" };
          const content = parseContainerChildren(child, ctx);
          if (content.length > 0) bdo.children = content;
          childList.push({ bdo });
        }
        break;
      }
      // ── Range markers: proof errors, positional tabs, permissions, revisions ──
      case "w:proofErr": {
        const type = attr(child, "w:type");
        if (
          type === "spellStart" ||
          type === "spellEnd" ||
          type === "gramStart" ||
          type === "gramEnd"
        ) {
          childList.push({ proofErr: type });
        }
        break;
      }
      case "w:ptab": {
        const alignment = attr(child, "w:alignment");
        const leader = attr(child, "w:leader");
        const relativeTo = attr(child, "w:relativeTo");
        if (alignment !== undefined && leader !== undefined && relativeTo !== undefined) {
          childList.push({
            positionalTab: {
              alignment: alignment as PositionalTabOptions["alignment"],
              leader: leader as PositionalTabOptions["leader"],
              relativeTo: relativeTo as PositionalTabOptions["relativeTo"],
            },
          });
        }
        break;
      }
      case "w:permStart": {
        const id = attr(child, "w:id");
        if (id !== undefined) {
          const ps: PermStartInlineOptions = { id };
          const ed = attr(child, "w:ed");
          if (ed !== undefined) ps.editor = ed;
          const editGroup = attr(child, "w:edGrp");
          if (editGroup !== undefined) {
            ps.editGroup = editGroup as PermStartInlineOptions["editGroup"];
          }
          const colFirst = attrNum(child, "w:colFirst");
          if (colFirst !== undefined) ps.colFirst = colFirst;
          const colLast = attrNum(child, "w:colLast");
          if (colLast !== undefined) ps.colLast = colLast;
          childList.push({ permStart: ps });
        }
        break;
      }
      case "w:permEnd": {
        const id = attr(child, "w:id");
        if (id !== undefined) childList.push({ permEnd: id });
        break;
      }
      case "w:moveFromRangeStart": {
        const m = parseMoveRangeStart(child);
        if (m) childList.push({ moveFromRangeStart: m });
        break;
      }
      case "w:moveFromRangeEnd": {
        const m = parseMarkupRangeOptions(child);
        if (m) childList.push({ moveFromRangeEnd: m });
        break;
      }
      case "w:moveToRangeStart": {
        const m = parseMoveRangeStart(child);
        if (m) childList.push({ moveToRangeStart: m });
        break;
      }
      case "w:moveToRangeEnd": {
        const m = parseMarkupRangeOptions(child);
        if (m) childList.push({ moveToRangeEnd: m });
        break;
      }
      case "w:customXmlInsRangeStart": {
        const m = parseCustomXmlRangeStart(child);
        if (m) childList.push({ customXmlInsRangeStart: m });
        break;
      }
      case "w:customXmlInsRangeEnd": {
        const id = attrNum(child, "w:id");
        if (id !== undefined) childList.push({ customXmlInsRangeEnd: id });
        break;
      }
      case "w:customXmlDelRangeStart": {
        const m = parseCustomXmlRangeStart(child);
        if (m) childList.push({ customXmlDelRangeStart: m });
        break;
      }
      case "w:customXmlDelRangeEnd": {
        const id = attrNum(child, "w:id");
        if (id !== undefined) childList.push({ customXmlDelRangeEnd: id });
        break;
      }
      case "w:customXmlMoveFromRangeStart": {
        const m = parseCustomXmlRangeStart(child);
        if (m) childList.push({ customXmlMoveFromRangeStart: m });
        break;
      }
      case "w:customXmlMoveFromRangeEnd": {
        const id = attrNum(child, "w:id");
        if (id !== undefined) childList.push({ customXmlMoveFromRangeEnd: id });
        break;
      }
      case "w:customXmlMoveToRangeStart": {
        const m = parseCustomXmlRangeStart(child);
        if (m) childList.push({ customXmlMoveToRangeStart: m });
        break;
      }
      case "w:customXmlMoveToRangeEnd": {
        const id = attrNum(child, "w:id");
        if (id !== undefined) childList.push({ customXmlMoveToRangeEnd: id });
        break;
      }
      case "w:sdt": {
        const sdtPr = findChild(child, "w:sdtPr");
        const properties = sdtPr ? parseSdtProperties(sdtPr) : {};
        // CT_SdtEndPr wraps its run properties in a w:rPr child
        const sdtEndPr = findChild(child, "w:sdtEndPr");
        const endRPr = sdtEndPr ? findChild(sdtEndPr, "w:rPr") : undefined;
        const endProperties = sdtEndPr ? (endRPr ? parseRunProperties(endRPr) : {}) : undefined;
        const sdtContent = findChild(child, "w:sdtContent");
        const sdtChildren = parseRunLevelChildren(sdtContent?.elements, ctx);
        const sdt: SdtRunOptions = { properties };
        if (sdtChildren.length > 0) sdt.children = sdtChildren;
        if (endProperties) sdt.endProperties = endProperties;
        childList.push({ sdt });
        break;
      }
      default:
        break;
    }
  }

  // A complex field still open at the paragraph end spans paragraphs (e.g. a
  // TOC head paragraph carrying the first entry). Release the buffered result
  // runs as regular children — the aggregator rebuilds the outer field's
  // control chain from its own capture, and a field nested inside the result
  // (a PAGEREF page number) re-parses through the sub accumulator. The head
  // runs stay unreleased: re-emitting them here would duplicate the chain the
  // emit path injects.
  if (fieldState.kind === "complex" && fieldState.resultRunEls.length > 0) {
    const sub = initialFieldRunState();
    for (const el of fieldState.resultRunEls) {
      const fed = feedFieldRun(el, sub);
      if (fed.consumed) {
        if (fed.child) childList.push(fed.child);
        continue;
      }
      const drawingChild = parseDrawingRunChild(el, ctx);
      if (drawingChild) {
        childList.push(drawingChild);
        continue;
      }
      const parsed = parseRun(el, ctx);
      childList.push(parsedRunToOptions(parsed));
    }
  }

  return childList;
}

/** True when a child is a single-field `{ text: string }` run (simple text). */
function isTextOnlyRun(c: unknown): c is { text: string } {
  return typeof c === "object" && c !== null && "text" in c && Object.keys(c).length === 1;
}

export function parseParagraph(el: Element, ctx: DocxReadContext): ParagraphOptions {
  const opts: Partial<ParagraphOptions> = {};

  // w:p element attributes: rsid family + w14:paraId/textId (hex string verbatim)
  const paraId = attr(el, "w14:paraId");
  if (paraId) opts.paraId = paraId;
  const textId = attr(el, "w14:textId");
  if (textId) opts.textId = textId;
  const rsid = attr(el, "w:rsidR");
  if (rsid) opts.additionRsid = rsid;
  const defaultRunRsid = attr(el, "w:rsidRDefault");
  if (defaultRunRsid) opts.defaultRunRsid = defaultRunRsid;
  const propertiesRsid = attr(el, "w:rsidP");
  if (propertiesRsid) opts.propertiesRsid = propertiesRsid;
  const runPropertiesRsid = attr(el, "w:rsidRPr");
  if (runPropertiesRsid) opts.runPropertiesRsid = runPropertiesRsid;
  const deletionRsid = attr(el, "w:rsidDel");
  if (deletionRsid) opts.deletionRsid = deletionRsid;

  const pPr = findChild(el, "w:pPr");
  if (pPr) {
    Object.assign(opts, parseParagraphProperties(pPr, ctx));
  }

  const childList = parseRunLevelChildren(el.elements, ctx);

  // Simple text optimization: a single text-only run collapses into opts.text
  // (the canonical ParagraphOptions form). Multiple runs stay a children
  // array — run boundaries carry spelling-check and session-edit history and
  // must round-trip instead of merging into one emitted run.
  if (childList.length === 1) {
    const only = childList[0] as unknown;
    if (isTextOnlyRun(only) && only.text) {
      opts.text = only.text;
      return opts as ParagraphOptions;
    }
  }
  if (childList.length > 0) {
    opts.children = childList;
  }

  return opts as ParagraphOptions;
}
