/**
 * Direct XML string builders for paragraph and run properties.
 *
 * Replaces `buildParagraphProperties() + xml()` and `buildRunProperties() + xml()`
 * with direct string concatenation — no intermediate object-tree allocation,
 * no recursive xml() traversal. Follows PPTX/XLSX pattern.
 *
 * @module
 */

import {
  convertToPt,
  convertToTwip,
  decimalNumber,
  eighthPointMeasureValue,
  hexColorValue,
  hpsMeasureValue,
  mapOptional,
  pointMeasureValue,
  uCharHexNumber,
  xsdJcAlignment,
  xsdShadingPattern,
} from "@office-open/core";
import { attrsRaw, escapeXml } from "@office-open/xml";
import type { CnfConditionalOptions } from "@parts/paragraph/formatting/cnf-style";
import type { IndentProperties } from "@parts/paragraph/formatting/indent";
import type { SpacingProperties } from "@parts/paragraph/formatting/spacing";
import type { TabStopDefinition } from "@parts/paragraph/formatting/tab-stop";
import type { FrameOptions } from "@parts/paragraph/frame/frame-properties";
import type { ParagraphOptions } from "@parts/paragraph/paragraph";
import type {
  NumberingInsertionOptions,
  ParagraphPropertiesOptions,
} from "@parts/paragraph/properties";
import type { EastAsianLayoutOptions } from "@parts/paragraph/run/east-asian-layout";
import type { ColorOptions } from "@parts/paragraph/run/formatting";
import type { LanguageOptions } from "@parts/paragraph/run/language";
import type {
  ParagraphRunPropertiesOptions,
  RunPropertiesChangeOptions,
  RunPropertiesOptions,
} from "@parts/paragraph/run/properties";
import type { FontProperties } from "@parts/paragraph/run/run-fonts";
import type { BorderOptions } from "@shared/border";
import { BorderStyle } from "@shared/border";
import type { ShadingProperties } from "@shared/shading";
import { autoRevisionId } from "@shared/track-revision/track-revision";

// ── Inline helpers ──

/** On/off: `<w:name/>` for true, `<w:name w:val="0"/>` for false */
export function onOff(name: string, val: boolean): string {
  // "off" is the only negative spelling both validators accept: ISO's
  // s:ST_OnOff allows all six spellings, but tblHeader/cantSplit bind
  // CT_OnOffOnly in the SDK's stricter schema (enumeration: on/off only).
  return val ? `<${name}/>` : `<${name} w:val="off"/>`;
}

/** The w:p opening-tag identity attributes (rsid family + w14:paraId/textId,
 *  hex strings verbatim) — shared by the body-level and inline-container
 *  paragraph stringifiers so both round-trip what the parser reads. */
export function paragraphIdentityAttrs(opts: ParagraphOptions): string {
  let attr = "";
  if (opts.paraId) attr += ` w14:paraId="${opts.paraId}"`;
  if (opts.textId) attr += ` w14:textId="${opts.textId}"`;
  if (opts.additionRsid) attr += ` w:rsidR="${opts.additionRsid}"`;
  if (opts.defaultRunRsid) attr += ` w:rsidRDefault="${opts.defaultRunRsid}"`;
  if (opts.propertiesRsid) attr += ` w:rsidP="${opts.propertiesRsid}"`;
  if (opts.runPropertiesRsid) attr += ` w:rsidRPr="${opts.runPropertiesRsid}"`;
  if (opts.deletionRsid) attr += ` w:rsidDel="${opts.deletionRsid}"`;
  return attr;
}

// ── Border ──

export function borderStr(name: string, opts: BorderOptions): string {
  const a = attrsRaw({
    "w:val": opts.style,
    "w:color": opts.color !== undefined ? hexColorValue(opts.color) : undefined,
    "w:sz": opts.size !== undefined ? eighthPointMeasureValue(opts.size) : undefined,
    "w:space": opts.space !== undefined ? pointMeasureValue(opts.space) : undefined,
    "w:themeColor": opts.themeColor,
    "w:themeTint": opts.themeTint !== undefined ? uCharHexNumber(opts.themeTint) : undefined,
    "w:themeShade": opts.themeShade !== undefined ? uCharHexNumber(opts.themeShade) : undefined,
    "w:shadow": opts.shadow !== undefined ? (opts.shadow ? 1 : 0) : undefined,
    "w:frame": opts.frame !== undefined ? (opts.frame ? 1 : 0) : undefined,
  });
  return `<${name}${a}/>`;
}

// ── Shading ──

export function shadingStr(opts: ShadingProperties): string {
  const a = attrsRaw({
    "w:val": opts.type !== undefined ? xsdShadingPattern.to(opts.type) : "clear",
    "w:color": opts.color !== undefined ? hexColorValue(opts.color) : undefined,
    "w:fill": opts.fill !== undefined ? hexColorValue(opts.fill) : undefined,
    "w:themeColor": opts.themeColor,
    "w:themeTint": opts.themeTint !== undefined ? uCharHexNumber(opts.themeTint) : undefined,
    "w:themeShade": opts.themeShade !== undefined ? uCharHexNumber(opts.themeShade) : undefined,
    "w:themeFill": opts.themeFill,
    "w:themeFillTint":
      opts.themeFillTint !== undefined ? uCharHexNumber(opts.themeFillTint) : undefined,
    "w:themeFillShade":
      opts.themeFillShade !== undefined ? uCharHexNumber(opts.themeFillShade) : undefined,
  });
  return `<w:shd${a}/>`;
}

// ── Spacing ──

function spacingStr(opts: SpacingProperties): string {
  const a = attrsRaw({
    "w:after": opts.after !== undefined ? convertToTwip(opts.after) : undefined,
    "w:afterAutospacing":
      opts.afterAutoSpacing !== undefined ? (opts.afterAutoSpacing ? 1 : 0) : undefined,
    "w:afterLines": opts.afterLines !== undefined ? decimalNumber(opts.afterLines) : undefined,
    "w:before": opts.before !== undefined ? convertToTwip(opts.before) : undefined,
    "w:beforeAutospacing":
      opts.beforeAutoSpacing !== undefined ? (opts.beforeAutoSpacing ? 1 : 0) : undefined,
    "w:beforeLines": opts.beforeLines !== undefined ? decimalNumber(opts.beforeLines) : undefined,
    "w:line": opts.line !== undefined ? convertToTwip(opts.line) : undefined,
    "w:lineRule": opts.lineRule,
  });
  return `<w:spacing${a}/>`;
}

// ── Indent ──

function indentStr(opts: IndentProperties): string {
  const a = attrsRaw({
    "w:start": opts.start !== undefined ? convertToTwip(opts.start) : undefined,
    "w:startChars": opts.startChars !== undefined ? decimalNumber(opts.startChars) : undefined,
    "w:end": opts.end !== undefined ? convertToTwip(opts.end) : undefined,
    "w:endChars": opts.endChars !== undefined ? decimalNumber(opts.endChars) : undefined,
    "w:left": opts.left !== undefined ? convertToTwip(opts.left) : undefined,
    "w:leftChars": opts.leftChars !== undefined ? decimalNumber(opts.leftChars) : undefined,
    "w:right": opts.right !== undefined ? convertToTwip(opts.right) : undefined,
    "w:rightChars": opts.rightChars !== undefined ? decimalNumber(opts.rightChars) : undefined,
    "w:hanging": opts.hanging !== undefined ? convertToTwip(opts.hanging) : undefined,
    "w:hangingChars":
      opts.hangingChars !== undefined ? decimalNumber(opts.hangingChars) : undefined,
    "w:firstLine": opts.firstLine !== undefined ? convertToTwip(opts.firstLine) : undefined,
    "w:firstLineChars":
      opts.firstLineChars !== undefined ? decimalNumber(opts.firstLineChars) : undefined,
  });
  return `<w:ind${a}/>`;
}

// ── Tab stops ──

function tabStopsStr(defs: TabStopDefinition[]): string {
  const items = defs.map(({ type, position, leader }) => {
    const a = attrsRaw({
      "w:val": type,
      "w:pos": convertToTwip(position),
      "w:leader": leader,
    });
    return `<w:tab${a}/>`;
  });
  return `<w:tabs>${items.join("")}</w:tabs>`;
}

// ── CNF style ──

function cnfStyleStr(opts: CnfConditionalOptions): string {
  const a = attrsRaw({
    "w:firstRow": opts.firstRow ? "1" : "0",
    "w:lastRow": opts.lastRow ? "1" : "0",
    "w:firstColumn": opts.firstColumn ? "1" : "0",
    "w:lastColumn": opts.lastColumn ? "1" : "0",
    "w:oddVBand": opts.oddVBand ? "1" : "0",
    "w:evenVBand": opts.evenVBand ? "1" : "0",
    "w:oddHBand": opts.oddHBand ? "1" : "0",
    "w:evenHBand": opts.evenHBand ? "1" : "0",
    "w:firstRowFirstColumn": opts.firstRowFirstColumn ? "1" : "0",
    "w:firstRowLastColumn": opts.firstRowLastColumn ? "1" : "0",
    "w:lastRowFirstColumn": opts.lastRowFirstColumn ? "1" : "0",
    "w:lastRowLastColumn": opts.lastRowLastColumn ? "1" : "0",
  });
  return `<w:cnfStyle${a}/>`;
}

// ── Frame properties ──

function framePrStr(opts: FrameOptions): string {
  const alignment = (opts as { alignment?: { x?: string; y?: string } }).alignment;
  const position = (opts as { position?: { x?: number; y?: number } }).position;
  // Twip-measured attributes normalize UniversalMeasure to plain integers
  // (same rule as w:pgSz/w:pgMar in section properties).
  const a = attrsRaw({
    "w:xAlign": alignment?.x,
    "w:yAlign": alignment?.y,
    "w:hAnchor": opts.anchor?.horizontal,
    "w:anchorLock": opts.anchorLock,
    "w:vAnchor": opts.anchor?.vertical,
    "w:dropCap": opts.dropCap,
    "w:h": mapOptional(opts.height, convertToTwip),
    "w:lines": opts.lines,
    "w:hRule": opts.rule,
    "w:hSpace": mapOptional(opts.space?.horizontal, convertToTwip),
    "w:vSpace": mapOptional(opts.space?.vertical, convertToTwip),
    "w:w": mapOptional(opts.width, convertToTwip),
    "w:wrap": opts.wrap,
    "w:x": mapOptional(position?.x, convertToTwip),
    "w:y": mapOptional(position?.y, convertToTwip),
  });
  return `<w:framePr${a}/>`;
}

// ── Number properties ──

function numPrStr(
  numberId: number | string | undefined,
  indentLevel: number | undefined,
  numberingChange?: { original: string; id: string; author: string; date?: string },
  insertion?: NumberingInsertionOptions,
): string {
  // numberId undefined → a track-change-only numPr: just the revision
  // markers, no w:ilvl/w:numId (the numbering inherits from the style chain).
  // Otherwise w:ilvl is optional in CT_NumPr — omit it when the source numPr
  // carried only w:numId (level inherited rather than pinned).
  let parts: string[];
  if (numberId === undefined) {
    parts = [];
  } else {
    const idVal = typeof numberId === "string" ? `{${numberId}}` : numberId;
    parts =
      indentLevel === undefined
        ? [`<w:numId w:val="${idVal}"/>`]
        : [`<w:ilvl w:val="${Math.min(indentLevel, 9)}"/>`, `<w:numId w:val="${idVal}"/>`];
  }
  if (numberingChange) {
    const a = attrsRaw({
      "w:original": numberingChange.original,
      "w:id": numberingChange.id,
      "w:author": escapeXml(numberingChange.author),
      "w:date": numberingChange.date !== undefined ? escapeXml(numberingChange.date) : undefined,
    });
    parts.push(`<w:numberingChange${a}/>`);
  }
  if (insertion) {
    const a = attrsRaw({
      "w:id": insertion.id,
      "w:author": escapeXml(insertion.author),
      "w:date": insertion.date !== undefined ? escapeXml(insertion.date) : undefined,
    });
    parts.push(`<w:ins${a}/>`);
  }
  return `<w:numPr>${parts.join("")}</w:numPr>`;
}

// ── Run-level formatting helpers ──

function colorStr(colorOrOptions: string | ColorOptions): string {
  if (typeof colorOrOptions === "string") {
    return `<w:color w:val="${hexColorValue(colorOrOptions)}"/>`;
  }
  const opts = colorOrOptions;
  const a = attrsRaw({
    "w:val": opts.val !== undefined ? hexColorValue(opts.val) : undefined,
    "w:themeColor": opts.themeColor,
    "w:themeTint": opts.themeTint !== undefined ? uCharHexNumber(opts.themeTint) : undefined,
    "w:themeShade": opts.themeShade !== undefined ? uCharHexNumber(opts.themeShade) : undefined,
  });
  return `<w:color${a}/>`;
}

function runFontsStr(nameOrAttrs: string | FontProperties, hint?: string): string {
  if (typeof nameOrAttrs === "string") {
    const a = attrsRaw({
      "w:ascii": nameOrAttrs,
      "w:cs": nameOrAttrs,
      "w:eastAsia": nameOrAttrs,
      "w:hAnsi": nameOrAttrs,
      "w:hint": hint,
    });
    return `<w:rFonts${a}/>`;
  }
  const attrs = nameOrAttrs;
  const a = attrsRaw({
    "w:ascii": attrs.ascii,
    "w:asciiTheme": attrs.asciiTheme,
    "w:cs": attrs.complexScript,
    "w:cstheme": attrs.complexScriptTheme,
    "w:eastAsia": attrs.eastAsia,
    "w:eastAsiaTheme": attrs.eastAsiaTheme,
    "w:hAnsi": attrs.hAnsi,
    "w:hAnsiTheme": attrs.hAnsiTheme,
    "w:hint": attrs.hint,
  });
  return `<w:rFonts${a}/>`;
}

function underlineStr(type: string | undefined, color?: string): string {
  // Scalar build — this runs for every underlined run, and the Record +
  // Object.entries round-trip of attrParts showed up in compile profiles.
  if (color === undefined) return `<w:u w:val="${type ?? "single"}"/>`;
  return `<w:u w:val="${type ?? "single"}" w:color="${hexColorValue(color)}"/>`;
}

function eastAsianLayoutStr(opts: EastAsianLayoutOptions): string {
  const a = attrsRaw({
    "w:id": opts.id !== undefined ? decimalNumber(opts.id) : undefined,
    "w:combine": opts.combine !== undefined ? (opts.combine ? 1 : 0) : undefined,
    "w:combineBrackets": opts.combineBrackets,
    "w:vert": opts.vertical !== undefined ? (opts.vertical ? 1 : 0) : undefined,
    "w:vertCompress":
      opts.verticalCompress !== undefined ? (opts.verticalCompress ? 1 : 0) : undefined,
  });
  return `<w:eastAsianLayout${a}/>`;
}

function languageStr(opts: LanguageOptions): string {
  const a = attrsRaw({
    "w:val": opts.value,
    "w:eastAsia": opts.eastAsia,
    "w:bidi": opts.bidirectional,
  });
  return `<w:lang${a}/>`;
}

// ════════════════════════════════════════════════════════════════════════════
// Paragraph Properties
// ════════════════════════════════════════════════════════════════════════════

export interface StringifyPPrResult {
  xml: string | undefined;
  numberingReferences: { reference: string; instance: number }[];
}

/** Shared empty result — plain-text paragraphs produce no pPr and no numbering. */
export const EMPTY_PPR_RESULT: StringifyPPrResult = { xml: undefined, numberingReferences: [] };

/**
 * Build `<w:pPr>` XML string directly from options — no intermediate object tree.
 *
 * Replaces `buildParagraphProperties() + xml()` with a single-pass string builder.
 */
// includeIfEmpty is a stringify-internal knob (force an empty pPr/trPr/tblPr for
// nested revision wrappers), not document data — kept out of the public options.
export function stringifyParagraphProperties(
  options?: ParagraphPropertiesOptions & { includeIfEmpty?: boolean },
): StringifyPPrResult {
  if (!options) return EMPTY_PPR_RESULT;

  let numberingReferences: { reference: string; instance: number }[] | undefined;

  let s = "";

  // Style / heading / bullet / numbering style references.
  // Single w:pStyle writer (CT_PPrBase allows exactly one): heading/bullet/
  // numbering are sugars over style — an explicit style wins, then heading,
  // then the ListParagraph convenience applied to plain list paragraphs.
  const pStyle =
    options.style ??
    options.heading ??
    (options.bullet ||
    (options.numbering &&
      typeof options.numbering === "object" &&
      "reference" in options.numbering &&
      options.numbering.autoStyle !== false)
      ? "ListParagraph"
      : undefined);
  if (pStyle) {
    s += `<w:pStyle w:val="${escapeXml(pStyle)}"/>`;
  }

  // CT_PPrBase element order per XSD (wml.xsd) — strictly ordered sequence.
  // 1-4: keepNext, keepLines, pageBreakBefore
  if (options.keepNext !== undefined) s += onOff("w:keepNext", options.keepNext);
  if (options.keepLines !== undefined) s += onOff("w:keepLines", options.keepLines);
  if (options.pageBreakBefore !== undefined)
    s += onOff("w:pageBreakBefore", options.pageBreakBefore);

  // 5: framePr
  if (options.frame) s += framePrStr(options.frame);

  // 6: widowControl
  if (options.widowControl !== undefined) s += onOff("w:widowControl", options.widowControl);

  // 7: numPr — single writer (CT_PPrBase allows exactly one). An explicit
  // numbering (or false = remove) wins over the bullet sugar, which pins the
  // built-in bullet list (numId 1).
  if (options.numbering) {
    if ("levelOnly" in options.numbering) {
      s += `<w:numPr><w:ilvl w:val="${Math.min(options.numbering.level ?? 0, 9)}"/></w:numPr>`;
    } else if ("none" in options.numbering) {
      // numId=0 cancels style-inherited numbering, keeping a pinned w:ilvl.
      s += numPrStr(0, options.numbering.level);
    } else if ("revisionOnly" in options.numbering) {
      s += numPrStr(
        undefined,
        undefined,
        options.numbering.numberingChange,
        options.numbering.insertion,
      );
    } else {
      (numberingReferences ??= []).push({
        instance: options.numbering.instance ?? 0,
        reference: options.numbering.reference,
      });

      const numId = `${options.numbering.reference}-${options.numbering.instance ?? 0}`;
      s += numPrStr(
        numId,
        options.numbering.level,
        options.numbering.numberingChange,
        options.numbering.insertion,
      );
    }
  } else if (options.numbering === false) {
    // numId=0 cancels style-inherited numbering — no w:ilvl (the source form
    // carries none; pinning level 0 would fabricate an element it never had).
    s += numPrStr(0, undefined);
  } else if (options.bullet) {
    s += `<w:numPr><w:ilvl w:val="${Math.min(options.bullet.level, 9)}"/><w:numId w:val="1"/></w:numPr>`;
  }

  // 8: suppressLineNumbers
  if (options.suppressLineNumbers !== undefined)
    s += onOff("w:suppressLineNumbers", options.suppressLineNumbers);

  // 9: pBdr — single writer (CT_PPrBase allows exactly one). thematicBreak is
  // sugar for a bottom single border; an explicit border wins per edge and
  // thematicBreak fills a missing bottom.
  if (options.border || options.thematicBreak) {
    const bParts: string[] = [];
    if (options.border?.top) bParts.push(borderStr("w:top", options.border.top));
    if (options.border?.left) bParts.push(borderStr("w:left", options.border.left));
    if (options.border?.bottom) {
      bParts.push(borderStr("w:bottom", options.border.bottom));
    } else if (options.thematicBreak) {
      bParts.push(
        borderStr("w:bottom", { color: "auto", size: 6, space: 1, style: BorderStyle.SINGLE }),
      );
    }
    if (options.border?.right) bParts.push(borderStr("w:right", options.border.right));
    if (options.border?.between) bParts.push(borderStr("w:between", options.border.between));
    if (options.border?.bar) bParts.push(borderStr("w:bar", options.border.bar));
    if (bParts.length) s += `<w:pBdr>${bParts.join("")}</w:pBdr>`;
  }

  // 10: shd
  if (options.shading) s += shadingStr(options.shading);

  // 11: tabs
  const tabDefs: TabStopDefinition[] = [
    ...(options.rightTabStop !== undefined
      ? [{ position: options.rightTabStop, type: "right" as const }]
      : []),
    ...(options.tabStops ? options.tabStops : []),
    ...(options.leftTabStop !== undefined
      ? [{ position: options.leftTabStop, type: "left" as const }]
      : []),
  ];
  if (tabDefs.length > 0) s += tabStopsStr(tabDefs);

  // 12-18: suppressAutoHyphens, kinsoku, wordWrap, overflowPunct, topLinePunct, autoSpaceDE, autoSpaceDN
  if (options.suppressAutoHyphens !== undefined)
    s += onOff("w:suppressAutoHyphens", options.suppressAutoHyphens);
  if (options.kinsoku !== undefined) s += onOff("w:kinsoku", options.kinsoku);
  if (options.wordWrap !== undefined) s += onOff("w:wordWrap", options.wordWrap);
  if (options.overflowPunctuation !== undefined)
    s += onOff("w:overflowPunct", options.overflowPunctuation);
  if (options.topLinePunct !== undefined) s += onOff("w:topLinePunct", options.topLinePunct);
  if (options.autoSpaceDE !== undefined) s += onOff("w:autoSpaceDE", options.autoSpaceDE);
  if (options.autoSpaceEastAsianText !== undefined)
    s += onOff("w:autoSpaceDN", options.autoSpaceEastAsianText);

  // 19: bidi
  if (options.bidirectional !== undefined) s += onOff("w:bidi", options.bidirectional);

  // 20-21: adjustRightInd, snapToGrid
  if (options.adjustRightInd !== undefined) s += onOff("w:adjustRightInd", options.adjustRightInd);
  if (options.snapToGrid !== undefined) s += onOff("w:snapToGrid", options.snapToGrid);

  // 22-24: spacing, ind, contextualSpacing
  if (options.spacing) s += spacingStr(options.spacing);
  if (options.indent) s += indentStr(options.indent);
  if (options.contextualSpacing !== undefined)
    s += onOff("w:contextualSpacing", options.contextualSpacing);

  // 25-26: mirrorIndents, suppressOverlap
  if (options.mirrorIndents !== undefined) s += onOff("w:mirrorIndents", options.mirrorIndents);
  if (options.suppressOverlap !== undefined)
    s += onOff("w:suppressOverlap", options.suppressOverlap);

  // 27: jc
  if (options.alignment) s += `<w:jc w:val="${xsdJcAlignment.to(options.alignment)}"/>`;

  // 28-30: textDirection, textAlignment, textboxTightWrap
  if (options.textDirection !== undefined)
    s += `<w:textDirection w:val="${options.textDirection}"/>`;
  if (options.textAlignment !== undefined)
    s += `<w:textAlignment w:val="${options.textAlignment}"/>`;
  if (options.textboxTightWrap !== undefined)
    s += `<w:textboxTightWrap w:val="${options.textboxTightWrap}"/>`;

  // 31-33: outlineLvl, divId, cnfStyle
  if (options.outlineLevel !== undefined) s += `<w:outlineLvl w:val="${options.outlineLevel}"/>`;
  if (options.divId !== undefined) s += `<w:divId w:val="${options.divId}"/>`;
  if (options.cnfStyle) s += cnfStyleStr(options.cnfStyle);

  // Embedded run properties (w:rPr inside w:pPr) — emitted even when the rPr
  // holds only a paragraph-mark track-change marker (w:ins/w:del) or is a
  // parsed bare <w:rPr/> (emptyProperties).
  if (options.run) {
    const inner = stringifyRunPropertiesInner(options.run);
    const runOpts = options.run as ParagraphRunPropertiesOptions;
    if (inner !== undefined || runOpts.insertion || runOpts.deletion || runOpts.emptyProperties) {
      const extra: string[] = [];
      if (runOpts.insertion) {
        const { id, author, date } = runOpts.insertion;
        extra.push(
          `<w:ins w:id="${id ?? autoRevisionId()}" w:author="${escapeXml(author)}" w:date="${date}"/>`,
        );
      }
      if (runOpts.deletion) {
        const { id, author, date } = runOpts.deletion;
        extra.push(
          `<w:del w:id="${id ?? autoRevisionId()}" w:author="${escapeXml(author)}" w:date="${date}"/>`,
        );
      }
      // CT_ParaRPr sequence: ins/del/moveFrom/moveTo lead, then EG_RPrBase.
      const body = extra.join("") + (inner ?? "");
      s += body ? `<w:rPr>${body}</w:rPr>` : "<w:rPr/>";
    }
  }

  // Revision (pPrChange)
  if (options.revision) {
    const rev = options.revision;
    // The embedded w:pPr is CT_PPrBase — no rPr (run), so drop it before
    // serializing the pre-change properties.
    const { author: _a, date: _d, id: _i, run: _r, ...originalProps } = rev;
    const inner = stringifyParagraphProperties({ ...originalProps, includeIfEmpty: true });
    s += `<w:pPrChange w:author="${escapeXml(rev.author)}" w:date="${rev.date}" w:id="${rev.id ?? autoRevisionId()}">${inner.xml ?? "<w:pPr/>"}</w:pPrChange>`;
  }

  const body = s;
  // A parsed bare <w:pPr/> round-trips as the empty element.
  const xml =
    options.includeIfEmpty || body.length > 0
      ? `<w:pPr>${body}</w:pPr>`
      : options.emptyProperties
        ? "<w:pPr/>"
        : undefined;
  if (numberingReferences === undefined) {
    return xml === undefined
      ? EMPTY_PPR_RESULT
      : { xml, numberingReferences: EMPTY_PPR_RESULT.numberingReferences };
  }
  return { xml, numberingReferences };
}

// ════════════════════════════════════════════════════════════════════════════
// Run Properties
// ════════════════════════════════════════════════════════════════════════════

/**
 * Build the inner content of `<w:rPr>` as a string.
 * Returns undefined if no properties are set.
 */
export function stringifyRunPropertiesInner(opts?: RunPropertiesOptions): string | undefined {
  if (!opts) return undefined;

  let s = "";

  // Style
  if (opts.style) s += `<w:rStyle w:val="${escapeXml(opts.style)}"/>`;

  // Font
  if (opts.font) {
    if (typeof opts.font === "string") {
      s += runFontsStr(opts.font);
    } else if ("name" in opts.font) {
      s += runFontsStr(opts.font.name, opts.font.hint);
    } else {
      s += runFontsStr(opts.font);
    }
  }

  // Bold — w:b and w:bCs are independent toggle properties (Latin vs complex
  // script, per ISO/IEC 29500). Emit each only when explicitly set so round-trip
  // is field-faithful (source <w:b/> stays <w:b/>, not inflated to <w:b/><w:bCs/>).
  if (opts.bold !== undefined) s += onOff("w:b", opts.bold);
  if (opts.boldComplexScript !== undefined) s += onOff("w:bCs", opts.boldComplexScript);

  // Italic — w:i and w:iCs are independent (same rationale as bold).
  if (opts.italic !== undefined) s += onOff("w:i", opts.italic);
  if (opts.italicComplexScript !== undefined) s += onOff("w:iCs", opts.italicComplexScript);

  // Caps — EG_RPrBase order is caps then smallCaps
  // w:smallCaps and w:caps are independent EG_RPrBase siblings — both can
  // appear on the same run, so each is emitted on its own.
  if (opts.allCaps !== undefined) {
    s += onOff("w:caps", opts.allCaps);
  }
  if (opts.smallCaps !== undefined) {
    s += onOff("w:smallCaps", opts.smallCaps);
  }

  // Strike through webHidden — strictly in EG_RPrBase sequence order
  if (opts.strike !== undefined) s += onOff("w:strike", opts.strike);
  if (opts.doubleStrike !== undefined) s += onOff("w:dstrike", opts.doubleStrike);
  if (opts.outline !== undefined) s += onOff("w:outline", opts.outline);
  if (opts.shadow !== undefined) s += onOff("w:shadow", opts.shadow);
  if (opts.emboss !== undefined) s += onOff("w:emboss", opts.emboss);
  if (opts.imprint !== undefined) s += onOff("w:imprint", opts.imprint);
  if (opts.noProof !== undefined) s += onOff("w:noProof", opts.noProof);
  if (opts.snapToGrid !== undefined) s += onOff("w:snapToGrid", opts.snapToGrid);
  // w:val="0" forms are meaningful (explicitly off) — emit on any set value.
  if (opts.vanish !== undefined) s += onOff("w:vanish", opts.vanish);
  if (opts.webHidden !== undefined) s += onOff("w:webHidden", opts.webHidden);

  // Color
  if (opts.color) s += colorStr(opts.color);

  // Character spacing — 0 is meaningful (explicitly normal) — emit on any set value.
  if (opts.characterSpacing !== undefined) {
    s += `<w:spacing w:val="${convertToTwip(opts.characterSpacing)}"/>`;
  }

  // Scale
  if (opts.scale !== undefined) s += `<w:w w:val="${opts.scale}"/>`;

  // Kern — w:val="0" is meaningful (explicitly disables kerning), so emit
  // whenever the field is set rather than truthy-checking it.
  if (opts.kern !== undefined) {
    const kernPts = typeof opts.kern === "number" ? opts.kern : convertToPt(opts.kern);
    s += `<w:kern w:val="${hpsMeasureValue(kernPts * 2)}"/>`;
  }

  // Position (points → half-points)
  if (opts.position !== undefined) {
    const points = typeof opts.position === "number" ? opts.position : convertToPt(opts.position);
    s += `<w:position w:val="${Math.round(points * 2)}"/>`;
  }

  // Size (points → half-points). sz and szCs are independent (Latin vs complex
  // script); emit each only when set so round-trip is field-faithful.
  if (opts.size !== undefined) s += `<w:sz w:val="${hpsMeasureValue(opts.size * 2)}"/>`;
  if (opts.sizeComplexScript !== undefined) {
    s += `<w:szCs w:val="${hpsMeasureValue(opts.sizeComplexScript * 2)}"/>`;
  }

  // Highlight
  if (opts.highlight) s += `<w:highlight w:val="${opts.highlight}"/>`;

  // Underline
  if (opts.underline) s += underlineStr(opts.underline.type, opts.underline.color);

  // Effect
  if (opts.effect) s += `<w:effect w:val="${opts.effect}"/>`;

  // Border
  if (opts.border) s += borderStr("w:bdr", opts.border);

  // Shading
  if (opts.shading) s += shadingStr(opts.shading);

  // Fit text — EG_RPrBase order: shd, fitText, vertAlign, rtl, cs, em, lang
  if (opts.fitText !== undefined) s += `<w:fitText w:val="${opts.fitText}"/>`;

  // Vertical alignment
  if (opts.verticalAlign) s += `<w:vertAlign w:val="${opts.verticalAlign}"/>`;

  // RTL
  if (opts.rightToLeft !== undefined) s += onOff("w:rtl", opts.rightToLeft);

  // Complex script
  if (opts.complexScript !== undefined) s += onOff("w:cs", opts.complexScript);

  // Emphasis mark
  if (opts.emphasisMark) s += `<w:em w:val="${opts.emphasisMark.type ?? "dot"}"/>`;

  // Language
  if (opts.language) s += languageStr(opts.language);

  // East Asian layout
  if (opts.eastAsianLayout) s += eastAsianLayoutStr(opts.eastAsianLayout);

  // Spec vanish — val="0" is meaningful (explicitly off)
  if (opts.specVanish !== undefined) s += onOff("w:specVanish", opts.specVanish);

  // Math (oMath is the EG_RPrBase tail)
  if (opts.math) s += onOff("w:oMath", opts.math);

  // Content part
  if (opts.contentPartRId) s += `<w:contentPart r:id="${opts.contentPartRId}"/>`;

  // Revision (rPrChange)
  if (opts.revision) {
    const rev = opts.revision as RunPropertiesChangeOptions;
    const { author: _a, date: _d, id: _i, ...originalProps } = rev;
    const inner = stringifyRunPropertiesInner(originalProps as RunPropertiesOptions);
    s += `<w:rPrChange w:author="${escapeXml(rev.author)}" w:date="${rev.date}" w:id="${rev.id ?? autoRevisionId()}"><w:rPr>${inner ?? ""}</w:rPr></w:rPrChange>`;
  }

  // w14:* text effects — raw passthrough, emitted last (EG_RPrBase extension slot)
  if (opts.w14RawXml) s += opts.w14RawXml;

  return s.length > 0 ? s : undefined;
}

/**
 * Build `<w:rPr>` XML string directly from options — no intermediate object tree.
 *
 * Replaces `buildRunProperties() + xml()` with a single-pass string builder.
 */
export function stringifyRunProperties(opts?: RunPropertiesOptions): string | undefined {
  const inner = stringifyRunPropertiesInner(opts);
  if (inner) return `<w:rPr>${inner}</w:rPr>`;
  // A parsed bare <w:rPr/> round-trips as the empty element.
  return opts?.emptyProperties ? "<w:rPr/>" : undefined;
}
