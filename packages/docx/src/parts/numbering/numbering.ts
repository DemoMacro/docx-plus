import { uniqueNumericIdCreator, convertInchesToTwip } from "@office-open/core";
import { xsdJcAlignment } from "@office-open/core";
import { decimalNumber } from "@office-open/core";
/**
 * Numbering module for WordprocessingML documents.
 *
 * Numbering provides support for numbered and bulleted lists.
 * Pure string serialization — no XmlComponent inheritance.
 *
 * Reference: http://officeopenxml.com/WPnumbering.php
 *
 * @module
 */
import { attr, attrBool, attrNum, findChild } from "@office-open/xml";
import type { Element } from "@office-open/xml";
import { documentNamespaceAttributes } from "@parts/document/document-attributes";
import { AlignmentType } from "@parts/paragraph";
import type { ParagraphPropertiesOptions } from "@parts/paragraph/properties";
import { parseRunProperties } from "@parts/paragraph/run/run-parse";
import { parsePict, stringifyPict } from "@parts/pict";
import type { PictOptions } from "@parts/pict";

import type { DocxReadContext, DocxWriteContext } from "../../context";
import { stringifyElement } from "../../util/stringify-element";
import { stringifyParagraphProperties, stringifyRunProperties } from "../paragraph/stringify";
import { LevelFormat } from "./level";
import type { LevelsOptions } from "./level";

/**
 * Options for configuring numbering definitions.
 */
export interface NumberingOptions {
  /** Abstract numbering definitions (w:abstractNum), each addressed by its reference name. */
  abstractNumberings: {
    levels: LevelsOptions[];
    reference: string;
    properties?: AbstractNumberingPropertiesOptions;
    /**
     * Numbering instances (w:num) to emit up front, independent of body
     * references — fresh authoring omits it (instances are created on demand);
     * round-trip sets 1 so unreferenced instances keep their w:num element.
     */
    instanceCount?: number;
    /**
     * Per-instance level overrides (the instance w:num's w:lvlOverride
     * children): a wholesale level redefinition and/or a start re-pin,
     * kept separate from the abstract definition so both round-trip.
     */
    overrideLevels?: LevelOverrideOptions[];
    /**
     * Additional source w:num ids pointing at the same abstract definition
     * with identical overrides, so each does not emit its own copy of the
     * definition.
     */
    aliases?: string[];
    /**
     * Reference of another config holding the same abstract definition: this
     * config's instances share it (source w:num elements pointing at one
     * w:abstractNumId with differing overrides). The definition emits once.
     */
    sharedDefinitionOf?: string;
  }[];
  /** Numbering cleanup ID (w:numIdMacAtCleanup) */
  numIdMacAtCleanup?: number;
  /** Picture bullet definitions for numbering (w:numPicBullet) */
  numPicBullets?: {
    numPicBulletId: number;
    /** VML picture content (CT_Picture) — imagedata media round-trips through it */
    pict?: PictOptions;
    /** Verbatim w:drawing element XML (CT_Drawing) — alternative to pict */
    drawing?: string;
  }[];
}

/** Namespace attributes for w:numbering (pre-computed constant). */
const NUMBERING_ATTRS =
  documentNamespaceAttributes([
    "wpc",
    "mc",
    "o",
    "pvml",
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
    "x",
  ]) + ' mc:Ignorable="w14 w15 wp14"';

/** Default bullet levels (9 levels: 0-8). */
const DEFAULT_BULLET_LEVELS: LevelsOptions[] = [
  {
    alignment: AlignmentType.LEFT,
    format: LevelFormat.BULLET,
    level: 0,
    paragraph: { indent: { hanging: convertInchesToTwip(0.25), left: convertInchesToTwip(0.5) } },
    text: "●",
  },
  {
    alignment: AlignmentType.LEFT,
    format: LevelFormat.BULLET,
    level: 1,
    paragraph: { indent: { hanging: convertInchesToTwip(0.25), left: convertInchesToTwip(1) } },
    text: "○",
  },
  {
    alignment: AlignmentType.LEFT,
    format: LevelFormat.BULLET,
    level: 2,
    paragraph: { indent: { hanging: convertInchesToTwip(0.25), left: 2160 } },
    text: "■",
  },
  {
    alignment: AlignmentType.LEFT,
    format: LevelFormat.BULLET,
    level: 3,
    paragraph: { indent: { hanging: convertInchesToTwip(0.25), left: 2880 } },
    text: "●",
  },
  {
    alignment: AlignmentType.LEFT,
    format: LevelFormat.BULLET,
    level: 4,
    paragraph: { indent: { hanging: convertInchesToTwip(0.25), left: 3600 } },
    text: "○",
  },
  {
    alignment: AlignmentType.LEFT,
    format: LevelFormat.BULLET,
    level: 5,
    paragraph: { indent: { hanging: convertInchesToTwip(0.25), left: 4320 } },
    text: "■",
  },
  {
    alignment: AlignmentType.LEFT,
    format: LevelFormat.BULLET,
    level: 6,
    paragraph: { indent: { hanging: convertInchesToTwip(0.25), left: 5040 } },
    text: "●",
  },
  {
    alignment: AlignmentType.LEFT,
    format: LevelFormat.BULLET,
    level: 7,
    paragraph: { indent: { hanging: convertInchesToTwip(0.25), left: 5760 } },
    text: "●",
  },
  {
    alignment: AlignmentType.LEFT,
    format: LevelFormat.BULLET,
    level: 8,
    paragraph: { indent: { hanging: convertInchesToTwip(0.25), left: 6480 } },
    text: "●",
  },
];

/**
 * Numbering definitions for a WordprocessingML document.
 *
 * Pure data accumulator — no XmlComponent inheritance.
 * Serializes via `serialize()` producing a complete XML part.
 */
export class Numbering {
  private abstractNumberingData = new Map<
    string,
    { id: number; levels: LevelsOptions[]; properties?: AbstractNumberingPropertiesOptions }
  >();
  private concreteNumberingData = new Map<
    string,
    {
      numId: number;
      abstractNumId: number;
      reference: string;
      instance: number;
      overrideLevels?: LevelOverrideOptions[];
    }
  >();
  private referenceConfigMap = new Map<string, LevelsOptions[]>();
  private abstractNumUniqueNumericId = uniqueNumericIdCreator();
  private concreteNumUniqueNumericId = uniqueNumericIdCreator(1);
  private _numIdMacAtCleanup?: number;
  private _numPicBullets?: {
    numPicBulletId: number;
    pict?: PictOptions;
    drawing?: string;
  }[];

  public constructor(options: NumberingOptions, injectDefaultList = true) {
    this._numIdMacAtCleanup = options.numIdMacAtCleanup;
    this._numPicBullets = options.numPicBullets;

    // Only inject the default bullet numbering on a fresh compile (Word ships
    // a default bullet list) when the caller supplied no numbering content at
    // all. Round-tripped documents carry their own — even an empty shell part
    // or one holding only numPicBullets/numIdMacAtCleanup — so injecting a
    // default would inflate or corrupt the part (extra abstractNum + 9 levels).
    if (
      injectDefaultList &&
      options.abstractNumberings.length === 0 &&
      !options.numPicBullets &&
      options.numIdMacAtCleanup === undefined
    ) {
      const defaultAbstractId = this.abstractNumUniqueNumericId();
      this.abstractNumberingData.set("default-bullet-numbering", {
        id: defaultAbstractId,
        levels: DEFAULT_BULLET_LEVELS,
      });
      this.concreteNumberingData.set("default-bullet-numbering", {
        abstractNumId: defaultAbstractId,
        instance: 0,
        numId: 1,
        overrideLevels: [{ num: 0, start: 1 }],
        reference: "default-bullet-numbering",
      });
    }

    for (const con of options.abstractNumberings) {
      // A config sharing another's definition resolves to the same data
      // object — the serializer's identity dedup emits the abstractNum once.
      const shared = con.sharedDefinitionOf
        ? this.abstractNumberingData.get(con.sharedDefinitionOf)
        : undefined;
      const abstractData = shared ?? {
        id: this.abstractNumUniqueNumericId(),
        levels: con.levels,
        properties: con.properties,
      };
      this.abstractNumberingData.set(con.reference, abstractData);
      // Aliased references resolve to the same abstract data — several source
      // w:num elements share one w:abstractNum.
      for (const alias of con.aliases ?? []) {
        this.abstractNumberingData.set(alias, abstractData);
      }
      this.referenceConfigMap.set(con.reference, con.levels);
      // Round-tripped instances exist in the source regardless of body use —
      // pre-register them so their w:num is emitted even when no paragraph
      // references the definition (styles-only or dead definitions). Each
      // round-tripped config maps to one source w:num, so its lvlOverride
      // children travel with it. Aliases are one w:num each, not a per-alias
      // copy of the whole instance run.
      for (let i = 0; i < (con.instanceCount ?? 0); i++) {
        this.registerConcreteInstance(con.reference, i, con.overrideLevels);
      }
      for (const alias of con.aliases ?? []) {
        this.registerConcreteInstance(alias, 0, con.overrideLevels);
      }
    }
  }

  /** Serialize to word/numbering.xml content (with XML declaration). */
  public serialize(ctx: DocxWriteContext): string {
    const parts: string[] = [];
    parts.push(`<w:numbering ${NUMBERING_ATTRS}>`);

    // numPicBullet elements come first (XSD order)
    if (this._numPicBullets) {
      for (const bullet of this._numPicBullets) {
        if (bullet.pict) {
          parts.push(
            `<w:numPicBullet w:numPicBulletId="${bullet.numPicBulletId}">${stringifyPict(bullet.pict, { file: ctx })}</w:numPicBullet>`,
          );
        } else if (bullet.drawing) {
          parts.push(
            `<w:numPicBullet w:numPicBulletId="${bullet.numPicBulletId}">${bullet.drawing}</w:numPicBullet>`,
          );
        } else {
          parts.push(`<w:numPicBullet w:numPicBulletId="${bullet.numPicBulletId}"/>`);
        }
      }
    }

    // Alias references share the abstract data object — emit each definition
    // once (object identity dedup).
    const emittedAbstracts = new Set<unknown>();
    for (const an of this.abstractNumberingData.values()) {
      if (emittedAbstracts.has(an)) continue;
      emittedAbstracts.add(an);
      parts.push(stringifyAbstractNumbering(an.id, an.levels, an.properties));
    }
    for (const cn of this.concreteNumberingData.values()) {
      parts.push(stringifyConcreteNumbering(cn));
    }
    if (this._numIdMacAtCleanup !== undefined) {
      parts.push(`<w:numIdMacAtCleanup w:val="${decimalNumber(this._numIdMacAtCleanup)}"/>`);
    }

    parts.push("</w:numbering>");
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + parts.join("");
  }

  /**
   * Creates a concrete numbering instance from an abstract numbering definition.
   */
  public createConcreteNumberingInstance(reference: string, instance: number): void {
    const referenceConfigLevels = this.referenceConfigMap.get(reference);
    const firstLevelStartNumber = referenceConfigLevels?.[0]?.start;

    // Only emit a lvlOverride when the instance's start differs from the
    // abstract default (1) — otherwise it is redundant and inflates the part.
    const overrideLevels =
      typeof firstLevelStartNumber === "number" &&
      Number.isInteger(firstLevelStartNumber) &&
      firstLevelStartNumber !== 1
        ? [{ num: 0, start: firstLevelStartNumber }]
        : undefined;
    this.registerConcreteInstance(reference, instance, overrideLevels);
  }

  /** Register a concrete instance unless the (reference, instance) pair exists. */
  private registerConcreteInstance(
    reference: string,
    instance: number,
    overrideLevels?: LevelOverrideOptions[],
  ): void {
    const abstractNumbering = this.abstractNumberingData.get(reference);
    if (!abstractNumbering) return;

    const fullReference = `${reference}-${instance}`;
    if (this.concreteNumberingData.has(fullReference)) return;

    this.concreteNumberingData.set(fullReference, {
      abstractNumId: abstractNumbering.id,
      instance,
      numId: this.concreteNumUniqueNumericId(),
      overrideLevels,
      reference,
    });
  }

  /** Gets all concrete numbering instances. */
  public get concreteNumbering(): { numId: number; reference: string; instance: number }[] {
    return [...this.concreteNumberingData.values()];
  }

  /** Gets all reference configurations. */
  public get referenceConfig(): LevelsOptions[][] {
    return [...this.referenceConfigMap.values()];
  }
}

// ── Types ──

/**
 * Per-instance level override (CT_NumLvl, child of the instance's w:num):
 * a nested w:lvl redefines the level wholesale, w:startOverride re-pins its
 * start; both may appear together.
 */
export interface LevelOverrideOptions {
  /** Level index the override applies to (w:lvlOverride @w:ilvl). */
  num: number;
  /** Start override (w:startOverride @w:val). */
  start?: number;
  /** Wholesale level redefinition (nested w:lvl). */
  level?: LevelsOptions;
}

/** w:abstractNum attributes + child elements + w15 restart (CT_AbstractNum). */
export interface AbstractNumberingPropertiesOptions {
  nsid?: string;
  /**
   * w:multiLevelType value (ST_MultiLevelType). Defaults to hybridMultilevel
   * when omitted.
   */
  multiLevelType?: "singleLevel" | "multilevel" | "hybridMultilevel";
  /** w15:restartNumberingAfterBreak attribute on w:abstractNum. Omitted when undefined. */
  restartNumberingAfterBreak?: boolean;
  tmpl?: string;
  name?: string;
  styleLink?: string;
  numStyleLink?: string;
}

// String-valued w:abstractNum child elements: XML tag → options key.
// multiLevelType is handled separately (enum-typed, not plain string).
const ABSTRACT_EXTRA_PROPS = [
  ["w:nsid", "nsid"],
  ["w:tmpl", "tmpl"],
  ["w:name", "name"],
  ["w:styleLink", "styleLink"],
  ["w:numStyleLink", "numStyleLink"],
] as const;

// ── Pure function serializers ──

function stringifyAbstractNumbering(
  id: number,
  levels: LevelsOptions[],
  properties?: AbstractNumberingPropertiesOptions,
): string {
  const parts: string[] = [];
  // w15:restartNumberingAfterBreak is optional (w15 extension); only emit when
  // explicitly carried so round-trip matches sources that omit it.
  const restartAttr =
    properties?.restartNumberingAfterBreak !== undefined
      ? ` w15:restartNumberingAfterBreak="${properties.restartNumberingAfterBreak ? 1 : 0}"`
      : "";
  parts.push(`<w:abstractNum w:abstractNumId="${decimalNumber(id)}"${restartAttr}>`);

  if (properties?.nsid !== undefined) {
    parts.push(`<w:nsid w:val="${properties.nsid}"/>`);
  }
  parts.push(`<w:multiLevelType w:val="${properties?.multiLevelType ?? "hybridMultilevel"}"/>`);
  if (properties?.tmpl !== undefined) {
    parts.push(`<w:tmpl w:val="${properties.tmpl}"/>`);
  }
  if (properties?.name !== undefined) {
    parts.push(`<w:name w:val="${properties.name}"/>`);
  }
  if (properties?.styleLink !== undefined) {
    parts.push(`<w:styleLink w:val="${properties.styleLink}"/>`);
  }
  if (properties?.numStyleLink !== undefined) {
    parts.push(`<w:numStyleLink w:val="${properties.numStyleLink}"/>`);
  }

  for (const level of levels) {
    parts.push(stringifyLevel(level));
  }

  parts.push("</w:abstractNum>");
  return parts.join("");
}

function stringifyConcreteNumbering(cn: {
  numId: number;
  abstractNumId: number;
  overrideLevels?: LevelOverrideOptions[];
}): string {
  const parts: string[] = [];
  parts.push(`<w:num w:numId="${decimalNumber(cn.numId)}">`);
  parts.push(`<w:abstractNumId w:val="${decimalNumber(cn.abstractNumId)}"/>`);

  if (cn.overrideLevels) {
    for (const level of cn.overrideLevels) {
      // CT_NumLvl sequence: startOverride before the nested lvl redefinition.
      if (level.start !== undefined || level.level !== undefined) {
        const inner =
          (level.start !== undefined ? `<w:startOverride w:val="${level.start}"/>` : "") +
          (level.level !== undefined ? stringifyLevel(level.level) : "");
        parts.push(`<w:lvlOverride w:ilvl="${level.num}">${inner}</w:lvlOverride>`);
      } else {
        parts.push(`<w:lvlOverride w:ilvl="${level.num}"/>`);
      }
    }
  }

  parts.push("</w:num>");
  return parts.join("");
}

function stringifyLevel(opts: LevelsOptions): string {
  const children: string[] = [];

  // w:start is optional (defaults to 1): a source level without it must not
  // gain an explicit element on round-trip.
  if (opts.start !== undefined) {
    children.push(`<w:start w:val="${decimalNumber(opts.start)}"/>`);
  }
  if (opts.format) children.push(`<w:numFmt w:val="${opts.format}"/>`);
  if (opts.levelRestart !== undefined)
    children.push(`<w:lvlRestart w:val="${decimalNumber(opts.levelRestart)}"/>`);
  if (opts.paragraphStyle !== undefined)
    children.push(`<w:pStyle w:val="${opts.paragraphStyle}"/>`);
  // CT_Lvl sequence: pStyle → isLgl → suff (XSD). isLgl must precede suff.
  if (opts.isLegalNumberingStyle) children.push("<w:isLgl/>");
  if (opts.suffix) children.push(`<w:suff w:val="${opts.suffix}"/>`);
  if (opts.text !== undefined || opts.textNull) {
    const lvlTextAttrs: string[] = [];
    if (opts.text !== undefined) lvlTextAttrs.push(`w:val="${opts.text}"`);
    if (opts.textNull) lvlTextAttrs.push('w:null="1"');
    children.push(`<w:lvlText ${lvlTextAttrs.join(" ")}/>`);
  }
  if (opts.levelPictureBulletId !== undefined)
    children.push(`<w:lvlPicBulletId w:val="${decimalNumber(opts.levelPictureBulletId)}"/>`);
  if (opts.legacy !== undefined) {
    const legacyAttrs: string[] = [`w:legacy="${(opts.legacy.enabled ?? true) ? 1 : 0}"`];
    if (opts.legacy.space !== undefined) legacyAttrs.push(`w:legacySpace="${opts.legacy.space}"`);
    if (opts.legacy.indent !== undefined)
      legacyAttrs.push(`w:legacyIndent="${opts.legacy.indent}"`);
    children.push(`<w:legacy ${legacyAttrs.join(" ")}/>`);
  }
  children.push(`<w:lvlJc w:val="${xsdJcAlignment.to(opts.alignment ?? AlignmentType.START)}"/>`);

  // Paragraph/run properties — use compile-path pure string builders
  const pPrXml = stringifyParagraphProperties(opts.paragraph).xml;
  const rPrXml = stringifyRunProperties(opts.run);
  if (pPrXml) children.push(pPrXml);
  if (rPrXml) children.push(rPrXml);

  const lvlAttrs: string[] = [`w:ilvl="${decimalNumber(Math.min(opts.level, 9))}"`];
  // w15:tentative is optional; only emit when carried (matches sources that omit it).
  if (opts.w15Tentative !== undefined)
    lvlAttrs.push(`w15:tentative="${opts.w15Tentative ? 1 : 0}"`);
  if (opts.templateCode !== undefined) lvlAttrs.push(`w:tplc="${opts.templateCode}"`);
  if (opts.tentative !== undefined) lvlAttrs.push(`w:tentative="${opts.tentative ? 1 : 0}"`);

  return `<w:lvl ${lvlAttrs.join(" ")}>${children.join("")}</w:lvl>`;
}

// ── Parse (Element → NumberingOptions) ──

/**
 * Parse w:numbering element into NumberingOptions.
 */
export function parseNumberingDefinitions(
  el: Element,
  parseParagraphProperties: (
    el: Element,
    ctx: DocxReadContext,
  ) => Partial<ParagraphPropertiesOptions>,
  ctx: DocxReadContext,
): NumberingOptions | undefined {
  // Picture bullets (w:numPicBullet — choice of w:pict | w:drawing)
  const numPicBullets: NonNullable<NumberingOptions["numPicBullets"]> = [];
  for (const child of el.elements ?? []) {
    if (child.name !== "w:numPicBullet") continue;
    const id = attrNum(child, "w:numPicBulletId");
    const bullet: { numPicBulletId: number; pict?: PictOptions; drawing?: string } = {
      numPicBulletId: id ?? 0,
    };
    const pictEl = findChild(child, "w:pict");
    if (pictEl) bullet.pict = parsePict(pictEl, ctx);
    const drawingEl = findChild(child, "w:drawing");
    if (drawingEl) bullet.drawing = stringifyElement(drawingEl);
    numPicBullets.push(bullet);
  }

  // numIdMacAtCleanup (w:numIdMacAtCleanup)
  const cleanupEl = findChild(el, "w:numIdMacAtCleanup");
  const numIdMacAtCleanup = cleanupEl ? attrNum(cleanupEl, "w:val") : undefined;

  const abstractNums = new Map<string, Element>();
  for (const child of el.elements ?? []) {
    if (child.name !== "w:abstractNum") continue;
    const id = attr(child, "w:abstractNumId");
    if (id !== undefined) abstractNums.set(id, child);
  }

  // Concrete num instances: numId → abstractId + the num element. The element
  // is kept so its lvlOverride/startOverride can be read — a concrete num may
  // re-pin a level's start, and dropping the override silently reverts the
  // list's restart numbering on round-trip.
  const numEntries: { numId: string; abstractId: string; numEl: Element }[] = [];
  for (const child of el.elements ?? []) {
    if (child.name !== "w:num") continue;
    const numId = attr(child, "w:numId");
    const abstractRef = findChild(child, "w:abstractNumId");
    const abstractId = abstractRef ? attr(abstractRef, "w:val") : undefined;
    if (numId !== undefined && abstractId !== undefined) {
      numEntries.push({ numId, abstractId, numEl: child });
    }
  }

  const configs: NumberingOptions["abstractNumberings"] = [];

  // A definition with no w:lvl children is still worth keeping when it
  // carries style-link metadata: w:numStyleLink points at a numbering style
  // (the definition is a bridge, its levels live in the style's definition)
  // and dropping the whole w:abstractNum takes every w:num referencing it —
  // and their lvlOverride children — down with it.
  const hasStyleProperties = (abstractEl: Element): boolean =>
    ABSTRACT_EXTRA_PROPS.some(([tag]) => findChild(abstractEl, tag) !== undefined) ||
    findChild(abstractEl, "w:multiLevelType") !== undefined;

  // Levels + style metadata of one w:abstractNum, shared by the referenced
  // definitions below and the orphan sweep after them.
  const parseAbstractDefinition = (
    abstractEl: Element,
  ): { levels: LevelsOptions[]; properties: AbstractNumberingPropertiesOptions } | undefined => {
    const levels: LevelsOptions[] = [];
    for (const child of abstractEl.elements ?? []) {
      if (child.name !== "w:lvl") continue;
      const levelOpts = parseLevelEl(child, parseParagraphProperties, ctx);
      if (levelOpts) levels.push(levelOpts);
    }
    if (levels.length === 0 && !hasStyleProperties(abstractEl)) return undefined;

    const properties: AbstractNumberingPropertiesOptions = {};
    for (const [tag, key] of ABSTRACT_EXTRA_PROPS) {
      const childEl = findChild(abstractEl, tag);
      const v = childEl ? attr(childEl, "w:val") : undefined;
      if (v) properties[key] = v;
    }
    const mltEl = findChild(abstractEl, "w:multiLevelType");
    const mltVal = mltEl ? attr(mltEl, "w:val") : undefined;
    if (mltVal) {
      properties.multiLevelType = mltVal as AbstractNumberingPropertiesOptions["multiLevelType"];
    }
    const restartVal = attrBool(abstractEl, "w15:restartNumberingAfterBreak");
    if (restartVal !== undefined) properties.restartNumberingAfterBreak = restartVal;
    return { levels, properties };
  };

  // Group the w:num entries referencing one w:abstractNum with identical
  // overrides: Word documents routinely reference a shared definition from
  // several instances (styles-lists reuse). The group becomes one config —
  // one emitted abstractNum with the group's w:num count — and the extra
  // source num ids travel as aliases so paragraphs referencing them still
  // resolve. Differing overrides keep separate configs: an override belongs
  // to its w:num, not to the shared definition.
  const groups = new Map<
    string,
    { primary: string; aliases: string[]; overrides: LevelOverrideOptions[] }
  >();
  const parsedDefinitions = new Map<string, ReturnType<typeof parseAbstractDefinition>>();
  for (const { numId, abstractId, numEl } of numEntries) {
    const abstractEl = abstractNums.get(abstractId);
    if (!abstractEl) continue;
    const overrides: LevelOverrideOptions[] = [];
    for (const overrideEl of numEl.elements ?? []) {
      if (overrideEl.name !== "w:lvlOverride") continue;
      const ilvl = attrNum(overrideEl, "w:ilvl");
      if (ilvl === undefined) continue;
      const override: LevelOverrideOptions = { num: ilvl };
      const startOverrideEl = findChild(overrideEl, "w:startOverride");
      if (startOverrideEl) {
        const val = attrNum(startOverrideEl, "w:val");
        if (val !== undefined) override.start = val;
      }
      const lvlEl = findChild(overrideEl, "w:lvl");
      if (lvlEl) {
        const levelOpts = parseLevelEl(lvlEl, parseParagraphProperties, ctx);
        if (levelOpts) override.level = levelOpts;
      }
      overrides.push(override);
    }
    // Per-instance level overrides (CT_NumLvl sequence: both children may
    // appear together — a nested w:lvl redefines the level wholesale,
    // startOverride re-pins its start). They stay on the instance config so
    // the abstract definition and the override both round-trip; merging them
    // into the abstract levels would re-emit the override twice and mutate
    // the shared definition when several w:num reference it.
    const key = `${abstractId}|${JSON.stringify(overrides)}`;
    const group = groups.get(key);
    if (group) {
      group.aliases.push(`list_${numId}`);
    } else {
      groups.set(key, { primary: `list_${numId}`, aliases: [], overrides });
      if (!parsedDefinitions.has(String(abstractId))) {
        const parsed = parseAbstractDefinition(abstractEl);
        if (parsed) parsedDefinitions.set(String(abstractId), parsed);
      }
    }
  }
  // First group per abstractId owns the definition; later groups (same
  // abstract, differing overrides) point back at it so it emits once.
  const primaryPerAbstract = new Map<string, string>();
  for (const [key, group] of groups) {
    const abstractId = Number(key.split("|")[0]);
    const parsed = parsedDefinitions.get(String(abstractId));
    if (!parsed) continue;
    const primary = primaryPerAbstract.get(String(abstractId));
    if (primary === undefined) {
      primaryPerAbstract.set(String(abstractId), group.primary);
      configs.push({
        reference: group.primary,
        ...parsed,
        instanceCount: 1,
        ...(group.overrides.length > 0 ? { overrideLevels: group.overrides } : {}),
        ...(group.aliases.length > 0 ? { aliases: group.aliases } : {}),
      });
    } else {
      configs.push({
        reference: group.primary,
        ...parsed,
        instanceCount: 1,
        sharedDefinitionOf: primary,
        ...(group.overrides.length > 0 ? { overrideLevels: group.overrides } : {}),
        ...(group.aliases.length > 0 ? { aliases: group.aliases } : {}),
      });
    }
  }

  // Orphan abstractNums (no w:num references them) still carry their levels
  // and style metadata — Word keeps them after their concrete num is deleted,
  // and styles may reference them by name. Keep them as instance-less
  // definitions (instanceCount: 0 emits the w:abstractNum without a w:num).
  const referencedAbstractIds = new Set(numEntries.map((e) => e.abstractId));
  for (const [abstractId, abstractEl] of abstractNums) {
    if (referencedAbstractIds.has(abstractId)) continue;
    const parsed = parseAbstractDefinition(abstractEl);
    if (parsed) configs.push({ reference: `abstract_${abstractId}`, ...parsed, instanceCount: 0 });
  }

  if (configs.length === 0 && numPicBullets.length === 0 && numIdMacAtCleanup === undefined) {
    return undefined;
  }
  const result: NumberingOptions = { abstractNumberings: configs };
  if (numPicBullets.length > 0) result.numPicBullets = numPicBullets;
  if (numIdMacAtCleanup !== undefined) result.numIdMacAtCleanup = numIdMacAtCleanup;
  return result;
}

function parseLevelEl(
  el: Element,
  parseParagraphProperties: (
    el: Element,
    ctx: DocxReadContext,
  ) => Partial<ParagraphPropertiesOptions>,
  ctx: DocxReadContext,
): LevelsOptions | undefined {
  const opts: Partial<LevelsOptions> = {};

  const level = attrNum(el, "w:ilvl");
  if (level !== undefined) opts.level = level;

  const start = findChild(el, "w:start");
  if (start) {
    const val = attrNum(start, "w:val");
    if (val !== undefined) opts.start = val;
  }

  const lvlRestart = findChild(el, "w:lvlRestart");
  if (lvlRestart) {
    const val = attrNum(lvlRestart, "w:val");
    if (val !== undefined) opts.levelRestart = val;
  }

  const numFmt = findChild(el, "w:numFmt");
  if (numFmt) {
    const val = attr(numFmt, "w:val");
    if (val) opts.format = val as LevelsOptions["format"];
  }

  const suff = findChild(el, "w:suff");
  if (suff) {
    const val = attr(suff, "w:val");
    if (val) opts.suffix = val as LevelsOptions["suffix"];
  }

  const pStyle = findChild(el, "w:pStyle");
  if (pStyle) {
    const val = attr(pStyle, "w:val");
    if (val) opts.paragraphStyle = val;
  }

  if (findChild(el, "w:isLgl")) opts.isLegalNumberingStyle = true;

  const lvlText = findChild(el, "w:lvlText");
  if (lvlText) {
    const val = attr(lvlText, "w:val");
    // Empty string is valid (a level whose text is empty) — keep it so the
    // element round-trips instead of being dropped by a falsy check.
    if (val !== undefined) opts.text = val;
    const isNull = attrBool(lvlText, "w:null");
    if (isNull) opts.textNull = isNull;
  }

  const lvlPicBulletId = findChild(el, "w:lvlPicBulletId");
  if (lvlPicBulletId) {
    const val = attrNum(lvlPicBulletId, "w:val");
    if (val !== undefined) opts.levelPictureBulletId = val;
  }

  // Legacy spacing (w:legacy/@w:legacy [required], @w:legacySpace, @w:legacyIndent)
  const legacyEl = findChild(el, "w:legacy");
  if (legacyEl) {
    const legacy: NonNullable<LevelsOptions["legacy"]> = {};
    const enabled = attrBool(legacyEl, "w:legacy");
    if (enabled !== undefined) legacy.enabled = enabled;
    const space = attrNum(legacyEl, "w:legacySpace");
    if (space !== undefined) legacy.space = space;
    const indent = attrNum(legacyEl, "w:legacyIndent");
    if (indent !== undefined) legacy.indent = indent;
    opts.legacy = legacy;
  }

  const lvlJc = findChild(el, "w:lvlJc");
  if (lvlJc) {
    const val = attr(lvlJc, "w:val");
    if (val) opts.alignment = xsdJcAlignment.from(val) as LevelsOptions["alignment"];
  }

  // Level attributes (w:tplc templateCode; w:tentative; w15:tentative)
  const tplc = attr(el, "w:tplc");
  if (tplc) opts.templateCode = tplc;
  const tentative = attrBool(el, "w:tentative");
  if (tentative !== undefined) opts.tentative = tentative;
  const w15Tentative = attrBool(el, "w15:tentative");
  if (w15Tentative !== undefined) opts.w15Tentative = w15Tentative;

  // Run + paragraph properties — reuse the complete parse helpers for full
  // fidelity (stringifyLevel delegates to stringifyRunProperties /
  // stringifyParagraphProperties, so parse must use the matching readers).
  const rPr = findChild(el, "w:rPr");
  if (rPr) {
    const runOpts = parseRunProperties(rPr);
    if (Object.keys(runOpts).length > 0) opts.run = runOpts;
  }
  const pPr = findChild(el, "w:pPr");
  if (pPr) {
    const paraOpts = parseParagraphProperties(pPr, ctx);
    if (Object.keys(paraOpts).length > 0) {
      opts.paragraph = paraOpts;
    }
  }

  return Object.keys(opts).length > 0 ? (opts as LevelsOptions) : undefined;
}
