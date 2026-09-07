import type { LongHexNumber } from "@office-open/core";
import { escapeXml } from "@office-open/xml";
import { documentNamespaceRecord } from "@parts/document/document-attributes";
import { AlignmentType } from "@parts/paragraph";
/**
 * Factory module for creating default document styles.
 *
 * Creates styles matching Microsoft Word's default document template.
 * Pure string generation — no XmlComponent inheritance.
 *
 * Reference: http://officeopenxml.com/WPstyles.php
 *
 * @module
 */
import type { ParagraphStylePropertiesOptions } from "@parts/paragraph/properties";
import type { RunStylePropertiesOptions } from "@parts/paragraph/run/properties";
import {
  stringifyTableCellProperties,
  stringifyTableProperties,
  stringifyTableRowProperties,
} from "@parts/table/stringify";
import type { TableCellPropertiesOptions } from "@parts/table/table-cell/table-cell-properties";
import type { TablePropertiesOptions } from "@parts/table/table-properties/table-properties";
import type { TableRowPropertiesOptions } from "@parts/table/table-row/table-row-properties";
import { WidthType } from "@parts/table/table-width";
import { BorderStyle, type BorderOptions } from "@shared/border";

import type { LanguageOptions } from "../paragraph/run/language";
import {
  languageStr,
  stringifyParagraphProperties,
  stringifyRunProperties,
} from "../paragraph/stringify";
import type { StylesOptions } from "./styles";

// ── Style options interfaces ──

export interface DefaultStylesOptions {
  document?: DocumentDefaultsOptions;
  /** docDefaults `w:lang` injected into fresh documents — Word derives it from the
   *  editing language. Defaults to `{ value: "en-US" }` (en-US Word install); a
   *  zh-CN install writes `{ value: "en-US", eastAsia: "zh-CN", bidirectional: "ar-SA" }`. */
  language?: LanguageOptions;
  title?: ParagraphStyleOptions;
  subtitle?: ParagraphStyleOptions;
  heading1?: ParagraphStyleOptions;
  heading2?: ParagraphStyleOptions;
  heading3?: ParagraphStyleOptions;
  heading4?: ParagraphStyleOptions;
  heading5?: ParagraphStyleOptions;
  heading6?: ParagraphStyleOptions;
  heading7?: ParagraphStyleOptions;
  heading8?: ParagraphStyleOptions;
  heading9?: ParagraphStyleOptions;
  strong?: ParagraphStyleOptions;
  emphasis?: ParagraphStyleOptions;
  listParagraph?: ParagraphStyleOptions;
  quote?: ParagraphStyleOptions;
  intenseQuote?: ParagraphStyleOptions;
  hyperlink?: CharacterStyleOptions;
  footnoteReference?: CharacterStyleOptions;
  footnoteText?: ParagraphStyleOptions;
  footnoteTextChar?: CharacterStyleOptions;
  endnoteReference?: CharacterStyleOptions;
  endnoteText?: ParagraphStyleOptions;
  endnoteTextChar?: CharacterStyleOptions;
}

export interface DocumentDefaultsOptions {
  paragraph?: ParagraphStylePropertiesOptions | null;
  run?: RunStylePropertiesOptions | null;
}

export interface StyleOptions {
  name?: string;
  aliases?: string;
  basedOn?: string;
  next?: string;
  link?: string;
  autoRedefine?: boolean;
  uiPriority?: number;
  semiHidden?: boolean;
  unhideWhenUsed?: boolean;
  quickFormat?: boolean;
  locked?: boolean;
  personal?: boolean;
  personalCompose?: boolean;
  personalReply?: boolean;
  /** CT_Style w:hidden — style hidden from the UI (CT_OnOff). */
  hidden?: boolean;
  /** CT_Style w:rsid — revision save id (CT_LongHexNumber, hex string verbatim). */
  rsid?: LongHexNumber;
  /** CT_Style `@w:default` — the default style for its type (CT_OnOff). */
  default?: boolean;
  /** CT_Style `@w:customStyle` — a user-defined custom style (CT_OnOff). */
  customStyle?: boolean;
}

export type ParagraphStyleOptions = {
  paragraph?: ParagraphStylePropertiesOptions;
  run?: RunStylePropertiesOptions;
} & StyleOptions & { id?: string };

export type CharacterStyleOptions = {
  run?: RunStylePropertiesOptions;
} & StyleOptions & { id?: string };

// ── String builders ──

/**
 * Build CT_Style style-level children (name…rsid), shared by paragraph/character/table styles.
 * Order follows CT_Style sequence: name, aliases, basedOn, next, link, autoRedefine, hidden,
 * uiPriority, semiHidden, unhideWhenUsed, qFormat, locked, personal, personalCompose,
 * personalReply, rsid.
 */
function stringifyStyleLevelChildren(opts: StyleOptions & { id?: string }): string {
  const parts: string[] = [`<w:name w:val="${escapeXml(opts.name ?? opts.id ?? "")}"/>`];
  if (opts.aliases) parts.push(`<w:aliases w:val="${escapeXml(opts.aliases)}"/>`);
  if (opts.basedOn) parts.push(`<w:basedOn w:val="${escapeXml(opts.basedOn)}"/>`);
  if (opts.next) parts.push(`<w:next w:val="${escapeXml(opts.next)}"/>`);
  if (opts.link) parts.push(`<w:link w:val="${escapeXml(opts.link)}"/>`);
  if (opts.autoRedefine) parts.push("<w:autoRedefine/>");
  if (opts.hidden) parts.push("<w:hidden/>");
  if (opts.uiPriority !== undefined) parts.push(`<w:uiPriority w:val="${opts.uiPriority}"/>`);
  if (opts.semiHidden) parts.push("<w:semiHidden/>");
  if (opts.unhideWhenUsed) parts.push("<w:unhideWhenUsed/>");
  if (opts.quickFormat) parts.push("<w:qFormat/>");
  if (opts.locked) parts.push("<w:locked/>");
  if (opts.personal) parts.push("<w:personal/>");
  if (opts.personalCompose) parts.push("<w:personalCompose/>");
  if (opts.personalReply) parts.push("<w:personalReply/>");
  if (opts.rsid) parts.push(`<w:rsid w:val="${opts.rsid}"/>`);
  return parts.join("");
}

/**
 * Build the `<w:style>` opening tag: type/styleId plus the optional w:default
 * and w:customStyle element attributes (CT_Style). Shared by paragraph/
 * character/table styles.
 */
function styleOpenTag(
  type: string,
  opts: { id?: string; default?: boolean; customStyle?: boolean },
): string {
  let attrs = ` w:type="${type}" w:styleId="${escapeXml(opts.id ?? "")}"`;
  if (opts.default) attrs += ' w:default="1"';
  if (opts.customStyle) attrs += ' w:customStyle="1"';
  return `<w:style${attrs}>`;
}

/** Build `<w:style>` XML for a paragraph style. */
export function stringifyParagraphStyle(
  opts: StyleOptions & {
    id: string;
    paragraph?: ParagraphStylePropertiesOptions;
    run?: RunStylePropertiesOptions;
  },
): string {
  const children: string[] = [stringifyStyleLevelChildren(opts)];

  const pPr = stringifyParagraphProperties(opts.paragraph).xml;
  if (pPr) children.push(pPr);
  const rPr = stringifyRunProperties(opts.run);
  if (rPr) children.push(rPr);

  return `${styleOpenTag("paragraph", opts)}${children.join("")}</w:style>`;
}

/** Build `<w:style>` XML for a character style. */
export function stringifyCharacterStyle(
  opts: StyleOptions & {
    id: string;
    run?: RunStylePropertiesOptions;
  },
): string {
  const children: string[] = [stringifyStyleLevelChildren(opts)];

  const rPr = stringifyRunProperties(opts.run);
  if (rPr) children.push(rPr);

  return `${styleOpenTag("character", opts)}${children.join("")}</w:style>`;
}

// ── Table style (CT_Style type="table") ──

/** ST_TblStyleOverrideType — OOXML tokens verbatim (CT_TblStylePr `@w:type`). */
export type TableStyleOverrideType =
  | "wholeTable"
  | "firstRow"
  | "lastRow"
  | "firstCol"
  | "lastCol"
  | "band1Vert"
  | "band2Vert"
  | "band1Horz"
  | "band2Horz"
  | "neCell"
  | "nwCell"
  | "seCell"
  | "swCell";

/** Conditional table style format (CT_TblStylePr). */
export interface ConditionalTableStyleOptions {
  /** Which region this format applies to (CT_TblStylePr `@w:type`, required). */
  type: TableStyleOverrideType;
  /** Paragraph properties (CT_PPrGeneral). */
  paragraph?: ParagraphStylePropertiesOptions;
  /** Run properties (CT_RPr). */
  run?: RunStylePropertiesOptions;
  /** Table properties (CT_TblPrBase). */
  table?: TablePropertiesOptions;
  /** Table row properties (CT_TrPr). */
  row?: TableRowPropertiesOptions;
  /** Table cell properties (CT_TcPr). */
  cell?: TableCellPropertiesOptions;
}

/** Table style (CT_Style type="table"). */
export type TableStyleOptions = {
  /** Paragraph properties (CT_PPrGeneral). */
  paragraph?: ParagraphStylePropertiesOptions;
  /** Run properties (CT_RPr). */
  run?: RunStylePropertiesOptions;
  /** Table properties (CT_TblPrBase). */
  table?: TablePropertiesOptions;
  /** Table row properties (CT_TrPr). */
  row?: TableRowPropertiesOptions;
  /** Table cell properties (CT_TcPr). */
  cell?: TableCellPropertiesOptions;
  /** Conditional formats per region (CT_TblStylePr, unbounded). */
  conditionalFormats?: ConditionalTableStyleOptions[];
} & StyleOptions & { id: string };

/** Numbering style (CT_Style type="numbering"). */
export type NumberingStyleOptions = {
  /** Paragraph properties (CT_PPrGeneral — usually carries numPr). */
  paragraph?: ParagraphStylePropertiesOptions;
  /** Run properties (CT_RPr). */
  run?: RunStylePropertiesOptions;
} & StyleOptions & { id: string };

/** Build `<w:tblStylePr>` XML for a conditional table style format. */
export function stringifyConditionalTableStyle(opts: ConditionalTableStyleOptions): string {
  const children: string[] = [];
  // CT_TblStylePr child order: pPr, rPr, tblPr, trPr, tcPr
  const pPr = stringifyParagraphProperties(opts.paragraph).xml;
  if (pPr) children.push(pPr);
  const rPr = stringifyRunProperties(opts.run);
  if (rPr) children.push(rPr);
  if (opts.table) {
    // includeIfEmpty: a table-style tblPr survives as an empty element even
    // with no fields (Word writes <w:tblPr/> placeholders in tblStylePr).
    children.push(stringifyTableProperties({ ...opts.table, includeIfEmpty: true }) ?? "");
  }
  if (opts.row) {
    const trPr = stringifyTableRowProperties(opts.row);
    if (trPr) children.push(trPr);
  }
  if (opts.cell) {
    const tcPr = stringifyTableCellProperties(opts.cell);
    if (tcPr) children.push(tcPr);
  }
  return `<w:tblStylePr w:type="${opts.type}">${children.join("")}</w:tblStylePr>`;
}

/** Build `<w:style type="table">` XML for a table style. */
export function stringifyTableStyle(opts: TableStyleOptions): string {
  const children: string[] = [stringifyStyleLevelChildren(opts)];
  // CT_Style child order: style-level, pPr, rPr, tblPr, trPr, tcPr, tblStylePr[]
  const pPr = stringifyParagraphProperties(opts.paragraph).xml;
  if (pPr) children.push(pPr);
  const rPr = stringifyRunProperties(opts.run);
  if (rPr) children.push(rPr);
  if (opts.table) {
    // includeIfEmpty mirrors the conditional-format writer — an empty table
    // object means "keep the (empty) tblPr element".
    children.push(stringifyTableProperties({ ...opts.table, includeIfEmpty: true }) ?? "");
  }
  if (opts.row) {
    const trPr = stringifyTableRowProperties(opts.row);
    if (trPr) children.push(trPr);
  }
  if (opts.cell) {
    const tcPr = stringifyTableCellProperties(opts.cell);
    if (tcPr) children.push(tcPr);
  }
  for (const cf of opts.conditionalFormats ?? []) {
    children.push(stringifyConditionalTableStyle(cf));
  }
  return `${styleOpenTag("table", opts)}${children.join("")}</w:style>`;
}

/** Build `<w:style type="numbering">` XML for a numbering style. */
export function stringifyNumberingStyle(opts: NumberingStyleOptions): string {
  const children: string[] = [stringifyStyleLevelChildren(opts)];
  // CT_Style child order: style-level, pPr, rPr
  const pPr = stringifyParagraphProperties(opts.paragraph).xml;
  if (pPr) children.push(pPr);
  const rPr = stringifyRunProperties(opts.run);
  if (rPr) children.push(rPr);
  return `${styleOpenTag("numbering", opts)}${children.join("")}</w:style>`;
}

/** Resolve a user override for heading level N (1-9) from default styles options. */
function headingOverride(
  options: DefaultStylesOptions,
  level: number,
): ParagraphStyleOptions | undefined {
  switch (level) {
    case 1:
      return options.heading1;
    case 2:
      return options.heading2;
    case 3:
      return options.heading3;
    case 4:
      return options.heading4;
    case 5:
      return options.heading5;
    case 6:
      return options.heading6;
    case 7:
      return options.heading7;
    case 8:
      return options.heading8;
    case 9:
      return options.heading9;
    default:
      return undefined;
  }
}

/** Word's default `<w:rPrDefault>` — theme fonts, kern, 11pt, ligatures. Injected
 *  for fresh documents (no structured docDefaults provided) to mirror Word's
 *  Normal.dotx; `language` stands in for Word's editing language (default: an
 *  en-US install writes `<w:lang w:val="en-US"/>`). On round-trip the structured
 *  form is used instead. */
const wordDefaultRprDefault = (language?: LanguageOptions): string =>
  `<w:rPrDefault><w:rPr>` +
  `<w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia" w:hAnsiTheme="minorHAnsi" w:cstheme="minorBidi"/>` +
  `<w:kern w:val="2"/>` +
  `<w:sz w:val="22"/><w:szCs w:val="24"/>` +
  languageStr(language ?? { value: "en-US" }) +
  `<w14:ligatures w14:val="standardContextual"/>` +
  `</w:rPr></w:rPrDefault>`;

/** Word's default `<w:pPrDefault>` — 8pt after / 1.16 line. widowControl is not
 *  written: ECMA-376 defaults it to on, matching Word's template bytes. Injected
 *  for fresh documents only. */
const WORD_DEFAULT_PPR_DEFAULT =
  `<w:pPrDefault><w:pPr>` +
  `<w:spacing w:after="160" w:line="278" w:lineRule="auto"/>` +
  `</w:pPr></w:pPrDefault>`;

/**
 * Build `<w:docDefaults>` XML from a structured {@link DocumentDefaultsOptions}.
 *
 * Three states per run/paragraph:
 *  - object → structured child element
 *  - null   → explicit empty tag (`<w:pPrDefault/>`) — the source declared "no
 *             defaults here", so Word does NOT inject its own spacing. Distinct
 *             from absence (ECMA-376: empty pPrDefault suppresses default
 *             spacing; a missing pPrDefault is application-defined).
 *  - undefined → field is missing. On fresh generation (`injectDefaults`) we
 *                mirror Word's Normal.dotx; on round-trip we omit the element
 *                to preserve the source's "this default category is absent".
 */
export function stringifyDocDefaults(
  opts: DocumentDefaultsOptions,
  injectDefaults = true,
  language?: LanguageOptions,
): string {
  const children: string[] = [];

  // rPrDefault
  if (opts.run) {
    const rPr = stringifyRunProperties(opts.run);
    children.push(rPr ? `<w:rPrDefault>${rPr}</w:rPrDefault>` : `<w:rPrDefault/>`);
  } else if (opts.run === null) {
    children.push(`<w:rPrDefault/>`);
  } else if (injectDefaults) {
    children.push(wordDefaultRprDefault(language));
  }

  // pPrDefault
  if (opts.paragraph) {
    const pPr = stringifyParagraphProperties(opts.paragraph).xml;
    children.push(pPr ? `<w:pPrDefault>${pPr}</w:pPrDefault>` : `<w:pPrDefault/>`);
  } else if (opts.paragraph === null) {
    children.push(`<w:pPrDefault/>`);
  } else if (injectDefaults) {
    children.push(WORD_DEFAULT_PPR_DEFAULT);
  }

  return `<w:docDefaults>${children.join("")}</w:docDefaults>`;
}

// ── Factory ──

let cachedDefaultStyles: StylesOptions | null = null;

/**
 * Factory for creating default document styles.
 *
 * Creates styles matching Microsoft Word's default document template.
 * Pure string generation — no XmlComponent inheritance.
 */
export class DefaultStylesFactory {
  public newInstance(options: DefaultStylesOptions = {}): StylesOptions {
    if (Object.keys(options).length === 0) {
      if (!cachedDefaultStyles) {
        cachedDefaultStyles = this.build({});
      }
      return cachedDefaultStyles;
    }
    return this.build(options);
  }

  private build(options: DefaultStylesOptions): StylesOptions {
    // importedStyles carries only docDefaults + latentStyles verbatim. Every
    // builtin w:style is emitted as a structured Options object so HTML renderers
    // can consume style attributes directly.
    const importedStyles: string[] = [];
    const paragraphStyles: (ParagraphStyleOptions & { id: string })[] = [];
    const characterStyles: (CharacterStyleOptions & { id: string })[] = [];
    const tableStyles: TableStyleOptions[] = [];
    const numberingStyles: NumberingStyleOptions[] = [];

    // XML namespace attributes for styles root element (matching Word exactly)
    const initialAttributes: Record<string, string> = {
      ...documentNamespaceRecord(["mc", "r", "w", "w14", "w15"]),
      "mc:Ignorable": "w14 w15",
    };

    importedStyles.push(stringifyDocDefaults(options.document ?? {}, true, options.language));

    // Latent styles - complete list from Word's default template
    // Only include styles that are NOT explicitly defined below
    importedStyles.push(
      `<w:latentStyles w:defLockedState="0" w:defUIPriority="99" w:defSemiHidden="0" w:defUnhideWhenUsed="0" w:defQFormat="0" w:count="376">` +
        `<w:lsdException w:name="Normal" w:uiPriority="0" w:qFormat="1"/>` +
        `<w:lsdException w:name="heading 1" w:uiPriority="9" w:qFormat="1"/>` +
        `<w:lsdException w:name="heading 2" w:semiHidden="1" w:uiPriority="9" w:unhideWhenUsed="1" w:qFormat="1"/>` +
        `<w:lsdException w:name="heading 3" w:semiHidden="1" w:uiPriority="9" w:unhideWhenUsed="1" w:qFormat="1"/>` +
        `<w:lsdException w:name="heading 4" w:semiHidden="1" w:uiPriority="9" w:unhideWhenUsed="1" w:qFormat="1"/>` +
        `<w:lsdException w:name="heading 5" w:semiHidden="1" w:uiPriority="9" w:unhideWhenUsed="1" w:qFormat="1"/>` +
        `<w:lsdException w:name="heading 6" w:semiHidden="1" w:uiPriority="9" w:unhideWhenUsed="1" w:qFormat="1"/>` +
        `<w:lsdException w:name="heading 7" w:semiHidden="1" w:uiPriority="9" w:unhideWhenUsed="1" w:qFormat="1"/>` +
        `<w:lsdException w:name="heading 8" w:semiHidden="1" w:uiPriority="9" w:unhideWhenUsed="1" w:qFormat="1"/>` +
        `<w:lsdException w:name="heading 9" w:semiHidden="1" w:uiPriority="9" w:unhideWhenUsed="1" w:qFormat="1"/>` +
        `<w:lsdException w:name="Default Paragraph Font" w:semiHidden="1" w:uiPriority="1" w:unhideWhenUsed="1"/>` +
        `<w:lsdException w:name="Normal Table" w:semiHidden="1" w:uiPriority="99" w:unhideWhenUsed="1"/>` +
        `<w:lsdException w:name="No List" w:semiHidden="1" w:uiPriority="99" w:unhideWhenUsed="1"/>` +
        `<w:lsdException w:name="Subtitle" w:uiPriority="11" w:qFormat="1"/>` +
        `<w:lsdException w:name="Strong" w:uiPriority="22" w:qFormat="1"/>` +
        `<w:lsdException w:name="Emphasis" w:uiPriority="20" w:qFormat="1"/>` +
        `<w:lsdException w:name="Hyperlink" w:semiHidden="1" w:unhideWhenUsed="1"/>` +
        `<w:lsdException w:name="FollowedHyperlink" w:semiHidden="1" w:unhideWhenUsed="1"/>` +
        `<w:lsdException w:name="No Spacing" w:uiPriority="1" w:qFormat="1"/>` +
        `<w:lsdException w:name="Revision" w:semiHidden="1"/>` +
        `</w:latentStyles>`,
    );

    // Built-in styles required by Word
    // Normal paragraph style (default for paragraphs)
    paragraphStyles.push({
      id: "Normal",
      name: "Normal",
      default: true,
      quickFormat: true,
    });

    // heading 1-9 styles with proper formatting (sz in points, spacing in twips)
    const headings = [
      {
        id: "Heading1",
        name: "heading 1",
        link: "Heading1Char",
        sz: 24,
        before: 480,
        after: 80,
        outlineLvl: 0,
      },
      {
        id: "Heading2",
        name: "heading 2",
        link: "Heading2Char",
        sz: 20,
        before: 160,
        after: 80,
        outlineLvl: 1,
      },
      {
        id: "Heading3",
        name: "heading 3",
        link: "Heading3Char",
        sz: 16,
        before: 160,
        after: 80,
        outlineLvl: 2,
      },
      {
        id: "Heading4",
        name: "heading 4",
        link: "Heading4Char",
        sz: 14,
        before: 80,
        after: 40,
        outlineLvl: 3,
      },
      {
        id: "Heading5",
        name: "heading 5",
        link: "Heading5Char",
        sz: 12,
        before: 80,
        after: 40,
        outlineLvl: 4,
      },
      {
        id: "Heading6",
        name: "heading 6",
        link: "Heading6Char",
        sz: undefined,
        before: 40,
        after: 0,
        outlineLvl: 5,
      },
      {
        id: "Heading7",
        name: "heading 7",
        link: "Heading7Char",
        sz: undefined,
        before: 40,
        after: 0,
        outlineLvl: 6,
      },
      {
        id: "Heading8",
        name: "heading 8",
        link: "Heading8Char",
        sz: undefined,
        before: undefined,
        after: 0,
        outlineLvl: 7,
      },
      {
        id: "Heading9",
        name: "heading 9",
        link: "Heading9Char",
        sz: undefined,
        before: undefined,
        after: 0,
        outlineLvl: 8,
      },
    ];

    for (const [headingIdx, h] of headings.entries()) {
      const outlineLvl = h.outlineLvl;
      const headingOverrideOpts = headingOverride(options, headingIdx + 1);
      if (headingOverrideOpts) {
        // User-defined heading overrides the built-in entirely.
        paragraphStyles.push({
          id: h.id,
          name: headingOverrideOpts.name ?? h.name,
          basedOn: headingOverrideOpts.basedOn ?? "Normal",
          next: headingOverrideOpts.next ?? "Normal",
          link: headingOverrideOpts.link ?? h.link,
          uiPriority: headingOverrideOpts.uiPriority ?? 9,
          quickFormat: headingOverrideOpts.quickFormat ?? true,
          semiHidden: headingOverrideOpts.semiHidden,
          unhideWhenUsed: headingOverrideOpts.unhideWhenUsed,
          paragraph: { outlineLevel: headingIdx, ...headingOverrideOpts.paragraph },
          run: headingOverrideOpts.run,
        });
        characterStyles.push({
          id: h.link,
          name: `${h.name} Char`,
          basedOn: "DefaultParagraphFont",
          link: h.id,
          // The linked char style carries the run formatting only — a copied
          // revision would emit a second w:rPrChange with the same CT_TrackChange
          // id in the same part (Word never writes one on the linked style)
          run: headingOverrideOpts.run && { ...headingOverrideOpts.run, revision: undefined },
        });
        continue;
      }

      // heading 1-6 use accent1 color + major theme fonts; 7-9 use text1 color.
      const accentRange = outlineLvl < 6;
      const runProps: RunStylePropertiesOptions = {
        font: accentRange
          ? {
              asciiTheme: "majorHAnsi",
              eastAsiaTheme: "majorEastAsia",
              hAnsiTheme: "majorHAnsi",
              complexScriptTheme: "majorBidi",
            }
          : { complexScriptTheme: "majorBidi" },
        color: accentRange
          ? { val: "0F4761", themeColor: "accent1", themeShade: "BF" }
          : { val: "595959", themeColor: "text1", themeTint: "A6" },
      };
      if (h.sz) {
        runProps.size = h.sz;
        runProps.sizeComplexScript = h.sz;
      }
      // heading 6-9 have bold
      if (outlineLvl >= 5) {
        runProps.bold = true;
        runProps.boldComplexScript = true;
      }

      paragraphStyles.push({
        id: h.id,
        name: h.name,
        basedOn: "Normal",
        next: "Normal",
        link: h.link,
        uiPriority: 9,
        semiHidden: outlineLvl > 0,
        unhideWhenUsed: outlineLvl > 0,
        quickFormat: true,
        paragraph: {
          keepNext: true,
          keepLines: true,
          spacing: {
            before: h.before,
            after: h.after,
          },
          outlineLevel: outlineLvl,
        },
        run: runProps,
      });

      // Linked character styles for headings
      characterStyles.push({
        id: h.link,
        name: `${h.name} Char`,
        basedOn: "DefaultParagraphFont",
        link: h.id,
        uiPriority: 9,
        semiHidden: outlineLvl > 0,
        run: runProps,
      });
    }

    // DefaultParagraphFont character style (default for runs)
    characterStyles.push({
      id: "DefaultParagraphFont",
      name: "Default Paragraph Font",
      default: true,
      uiPriority: 1,
      semiHidden: true,
      unhideWhenUsed: true,
    });

    // Normal Table style (default for tables)
    tableStyles.push({
      id: "NormalTable",
      name: "Normal Table",
      default: true,
      uiPriority: 99,
      semiHidden: true,
      unhideWhenUsed: true,
      table: {
        indent: { size: 0, type: WidthType.DXA },
        margins: {
          top: { size: 0, type: WidthType.DXA },
          left: { size: 108, type: WidthType.DXA },
          bottom: { size: 0, type: WidthType.DXA },
          right: { size: 108, type: WidthType.DXA },
        },
      },
    });

    // No List numbering style (default for numbering)
    numberingStyles.push({
      id: "NoList",
      name: "No List",
      default: true,
      uiPriority: 99,
      semiHidden: true,
      unhideWhenUsed: true,
    });

    // Title style (user override via options.title, else built-in default)
    if (options.title) {
      paragraphStyles.push({
        id: "Title",
        name: options.title.name ?? "Title",
        basedOn: options.title.basedOn ?? "Normal",
        next: options.title.next ?? "Normal",
        link: options.title.link ?? "TitleChar",
        uiPriority: options.title.uiPriority ?? 10,
        quickFormat: options.title.quickFormat ?? true,
        paragraph: options.title.paragraph,
        run: options.title.run,
      });
      characterStyles.push({
        id: "TitleChar",
        name: "Title Char",
        basedOn: "DefaultParagraphFont",
        link: "Title",
        run: options.title.run && { ...options.title.run, revision: undefined },
      });
    } else {
      const titleRun: RunStylePropertiesOptions = {
        font: {
          asciiTheme: "majorHAnsi",
          eastAsiaTheme: "majorEastAsia",
          hAnsiTheme: "majorHAnsi",
          complexScriptTheme: "majorBidi",
        },
        characterSpacing: -10,
        kern: 14,
        size: 28,
        sizeComplexScript: 28,
      };
      paragraphStyles.push({
        id: "Title",
        name: "Title",
        basedOn: "Normal",
        next: "Normal",
        link: "TitleChar",
        uiPriority: 10,
        quickFormat: true,
        paragraph: {
          spacing: { after: 80, line: 240, lineRule: "auto" },
          contextualSpacing: true,
          alignment: AlignmentType.CENTER,
        },
        run: titleRun,
      });
      characterStyles.push({
        id: "TitleChar",
        name: "Title Char",
        basedOn: "DefaultParagraphFont",
        link: "Title",
        uiPriority: 10,
        run: titleRun && { ...titleRun, revision: undefined },
      });
    }

    // Subtitle style (user override via options.subtitle, else built-in default)
    if (options.subtitle) {
      paragraphStyles.push({
        id: "Subtitle",
        name: options.subtitle.name ?? "Subtitle",
        basedOn: options.subtitle.basedOn ?? "Normal",
        next: options.subtitle.next ?? "Normal",
        link: options.subtitle.link ?? "SubtitleChar",
        uiPriority: options.subtitle.uiPriority ?? 11,
        quickFormat: options.subtitle.quickFormat ?? true,
        paragraph: options.subtitle.paragraph,
        run: options.subtitle.run,
      });
      characterStyles.push({
        id: "SubtitleChar",
        name: "Subtitle Char",
        basedOn: "DefaultParagraphFont",
        link: "Subtitle",
        run: options.subtitle.run && { ...options.subtitle.run, revision: undefined },
      });
    } else {
      const subtitleRun: RunStylePropertiesOptions = {
        font: {
          asciiTheme: "majorHAnsi",
          eastAsiaTheme: "majorEastAsia",
          hAnsiTheme: "majorHAnsi",
          complexScriptTheme: "majorBidi",
        },
        color: { val: "595959", themeColor: "text1", themeTint: "A6" },
        characterSpacing: 15,
        size: 14,
        sizeComplexScript: 14,
      };
      paragraphStyles.push({
        id: "Subtitle",
        name: "Subtitle",
        basedOn: "Normal",
        next: "Normal",
        link: "SubtitleChar",
        uiPriority: 11,
        quickFormat: true,
        paragraph: { alignment: AlignmentType.CENTER },
        run: subtitleRun,
      });
      characterStyles.push({
        id: "SubtitleChar",
        name: "Subtitle Char",
        basedOn: "DefaultParagraphFont",
        link: "Subtitle",
        uiPriority: 11,
        run: subtitleRun,
      });
    }

    // List Paragraph style (user override via options.listParagraph, else built-in default)
    if (options.listParagraph) {
      paragraphStyles.push({
        id: "ListParagraph",
        name: options.listParagraph.name ?? "List Paragraph",
        basedOn: options.listParagraph.basedOn ?? "Normal",
        uiPriority: options.listParagraph.uiPriority ?? 34,
        quickFormat: options.listParagraph.quickFormat ?? true,
        paragraph: options.listParagraph.paragraph,
        run: options.listParagraph.run,
      });
    } else {
      paragraphStyles.push({
        id: "ListParagraph",
        name: "List Paragraph",
        basedOn: "Normal",
        uiPriority: 34,
        quickFormat: true,
        paragraph: { indent: { left: 720 }, contextualSpacing: true },
      });
    }

    // Strong style — only emitted when the user provides a definition
    if (options.strong) {
      paragraphStyles.push({
        id: "Strong",
        name: options.strong.name ?? "Strong",
        basedOn: options.strong.basedOn ?? "Normal",
        next: options.strong.next ?? "Normal",
        quickFormat: options.strong.quickFormat ?? true,
        paragraph: options.strong.paragraph,
        run: options.strong.run,
      });
    }

    // Emphasis style — only emitted when the user provides a definition
    if (options.emphasis) {
      paragraphStyles.push({
        id: "Emphasis",
        name: options.emphasis.name ?? "Emphasis",
        basedOn: options.emphasis.basedOn ?? "Normal",
        next: options.emphasis.next ?? "Normal",
        quickFormat: options.emphasis.quickFormat ?? true,
        paragraph: options.emphasis.paragraph,
        run: options.emphasis.run,
      });
    }

    // Quote style (user override via options.quote, else built-in default)
    const quoteRun: RunStylePropertiesOptions = {
      italic: true,
      italicComplexScript: true,
      color: { val: "404040", themeColor: "text1", themeTint: "BF" },
    };
    if (options.quote) {
      paragraphStyles.push({
        id: "Quote",
        name: options.quote.name ?? "Quote",
        basedOn: options.quote.basedOn ?? "Normal",
        next: options.quote.next ?? "Normal",
        link: options.quote.link ?? "QuoteChar",
        uiPriority: options.quote.uiPriority ?? 29,
        quickFormat: options.quote.quickFormat ?? true,
        paragraph: options.quote.paragraph,
        run: options.quote.run,
      });
      characterStyles.push({
        id: "QuoteChar",
        name: "Quote Char",
        basedOn: "DefaultParagraphFont",
        link: "Quote",
        run: options.quote.run && { ...options.quote.run, revision: undefined },
      });
    } else {
      paragraphStyles.push({
        id: "Quote",
        name: "Quote",
        basedOn: "Normal",
        next: "Normal",
        link: "QuoteChar",
        uiPriority: 29,
        quickFormat: true,
        paragraph: { spacing: { before: 160 }, alignment: AlignmentType.CENTER },
        run: quoteRun,
      });
      characterStyles.push({
        id: "QuoteChar",
        name: "Quote Char",
        basedOn: "DefaultParagraphFont",
        link: "Quote",
        uiPriority: 29,
        run: quoteRun,
      });
    }

    // Intense Quote style + linked character style (built-in defaults)
    const intenseQuoteRun: RunStylePropertiesOptions = {
      italic: true,
      italicComplexScript: true,
      color: { val: "0F4761", themeColor: "accent1", themeShade: "BF" },
    };
    const intenseQuoteBorder: BorderOptions = {
      style: BorderStyle.SINGLE,
      size: 4,
      space: 10,
      color: "0F4761",
      themeColor: "accent1",
      themeShade: "BF",
    };
    paragraphStyles.push({
      id: "IntenseQuote",
      name: "Intense Quote",
      basedOn: "Normal",
      next: "Normal",
      link: "IntenseQuoteChar",
      uiPriority: 30,
      quickFormat: true,
      paragraph: {
        border: { top: intenseQuoteBorder, bottom: intenseQuoteBorder },
        spacing: { before: 360, after: 360 },
        indent: { left: 864, right: 864 },
        alignment: AlignmentType.CENTER,
      },
      run: intenseQuoteRun,
    });
    characterStyles.push({
      id: "IntenseQuoteChar",
      name: "Intense Quote Char",
      basedOn: "DefaultParagraphFont",
      link: "IntenseQuote",
      uiPriority: 30,
      run: intenseQuoteRun,
    });

    // Hyperlink character style
    characterStyles.push({
      id: "Hyperlink",
      name: "Hyperlink",
      basedOn: "DefaultParagraphFont",
      semiHidden: true,
      unhideWhenUsed: true,
      run: { color: "0563C1", underline: { type: "single" } },
      ...options.hyperlink,
    });

    // Footnote Reference character style
    characterStyles.push({
      id: "FootnoteReference",
      name: "footnote reference",
      basedOn: "DefaultParagraphFont",
      semiHidden: true,
      unhideWhenUsed: true,
      run: { verticalAlign: "superscript" },
      ...options.footnoteReference,
    });

    // Footnote Text paragraph style
    paragraphStyles.push({
      id: "FootnoteText",
      name: "footnote text",
      basedOn: "Normal",
      link: "FootnoteTextChar",
      semiHidden: true,
      uiPriority: 99,
      unhideWhenUsed: true,
      paragraph: { spacing: { after: 0, line: 240, lineRule: "auto" } },
      run: { size: 10 },
      ...options.footnoteText,
    });

    // Footnote Text Char character style
    characterStyles.push({
      id: "FootnoteTextChar",
      name: "Footnote Text Char",
      basedOn: "DefaultParagraphFont",
      link: "FootnoteText",
      semiHidden: true,
      run: { size: 10 },
      ...options.footnoteTextChar,
    });

    // Endnote Reference character style
    characterStyles.push({
      id: "EndnoteReference",
      name: "endnote reference",
      basedOn: "DefaultParagraphFont",
      semiHidden: true,
      unhideWhenUsed: true,
      run: { verticalAlign: "superscript" },
      ...options.endnoteReference,
    });

    // Endnote Text paragraph style
    paragraphStyles.push({
      id: "EndnoteText",
      name: "endnote text",
      basedOn: "Normal",
      link: "EndnoteTextChar",
      semiHidden: true,
      uiPriority: 99,
      unhideWhenUsed: true,
      paragraph: { spacing: { after: 0, line: 240, lineRule: "auto" } },
      run: { size: 10 },
      ...options.endnoteText,
    });

    // Endnote Text Char character style
    characterStyles.push({
      id: "EndnoteTextChar",
      name: "Endnote Text Char",
      basedOn: "DefaultParagraphFont",
      link: "EndnoteText",
      semiHidden: true,
      run: { size: 10 },
      ...options.endnoteTextChar,
    });

    // Intense Reference character style
    characterStyles.push({
      id: "IntenseReference",
      name: "Intense Reference",
      basedOn: "DefaultParagraphFont",
      uiPriority: 32,
      quickFormat: true,
      run: {
        bold: true,
        boldComplexScript: true,
        smallCaps: true,
        color: { val: "0F4761", themeColor: "accent1", themeShade: "BF" },
        characterSpacing: 5,
      },
    });

    return {
      importedStyles,
      paragraphStyles,
      characterStyles,
      tableStyles,
      numberingStyles,
      initialAttributes,
    };
  }
}
