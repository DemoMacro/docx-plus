/**
 * Body-level child descriptors for DOCX.
 *
 * Provides descriptor-based stringification for section children.
 * All types use pure string builders — zero class instantiation, zero toXml().
 *
 * @module
 */

import { RELATIONSHIP_TYPES, toUint8Array, uniqueId } from "@office-open/core";
import type { CustomDescriptor } from "@office-open/core/descriptor";
import { attr, escapeXml, findChild } from "@office-open/xml";
import type { Element } from "@office-open/xml";
import type { AltChunkOptions } from "@parts/alt-chunk/alt-chunk";
import type { CustomXmlPropertiesOptions } from "@parts/custom-xml/custom-xml";
import type { RunPropertiesOptions } from "@parts/paragraph/run/properties";
import { parseRunProperties } from "@parts/paragraph/run/run-parse";
import { onOff, stringifyRunPropertiesInner } from "@parts/paragraph/stringify";
import { parseSdtProperties } from "@parts/sdt/sdt-parse";
import type { SubDocOptions } from "@parts/sub-doc/sub-doc";
import type { SdtCheckboxOptions, SdtPropertiesOptions } from "@parts/table-of-contents";
import type { BlockContentChild, SectionChild } from "@shared/section";

import type { BodyContext, DocxReadContext } from "../context";

// ── AltChunk (pure string — registers relationships + altChunks) ──

const ALTCHUNK_REL_TYPE = RELATIONSHIP_TYPES.aFChunk;

function wrapHtmlDocument(fragment: string): string {
  if (/<(!DOCTYPE|html|HTML)/i.test(fragment)) {
    return fragment;
  }
  return `<!DOCTYPE html>\n<html><head><meta charset="utf-8"></head>\n<body>${fragment}</body></html>`;
}

export const altChunkDesc: CustomDescriptor<AltChunkOptions, BodyContext> = {
  kind: "custom",

  stringify(opts, ctx) {
    const relId = uniqueId();
    const extension = opts.extension;
    const partPath = `afchunks/afchunk${relId}.${extension}`;
    const rawData = typeof opts.data === "string" ? toUint8Array(opts.data) : opts.data;
    const data =
      opts.contentType === "text/html" && typeof opts.data === "string"
        ? toUint8Array(wrapHtmlDocument(opts.data))
        : rawData;

    ctx.fileData.document.relationships.addRelationship(`rId${relId}`, ALTCHUNK_REL_TYPE, partPath);
    ctx.fileData.altChunks.addAltChunk(relId, {
      key: relId,
      data,
      path: partPath,
      extension,
      contentType: opts.contentType,
    });

    const rId = `rId${relId}`;
    if (opts.matchSource) {
      return `<w:altChunk r:id="${rId}"><w:altChunkPr><w:matchSrc/></w:altChunkPr></w:altChunk>`;
    }
    return `<w:altChunk r:id="${rId}"/>`;
  },

  parse(el, ctx) {
    const rId = attr(el, "r:id");
    const opts: Partial<AltChunkOptions> = {};

    // Check for matchSource
    const altChunkPr = findChild(el, "w:altChunkPr");
    if (altChunkPr && findChild(altChunkPr, "w:matchSrc")) {
      opts.matchSource = true;
    }

    // Resolve the altChunk data from relationships
    const dctx = ctx as DocxReadContext;
    if (rId) {
      const path = dctx.resolveRelationship(rId);
      if (path) {
        const data = dctx.getRaw(path);
        if (data) {
          opts.data = data;
          const ext = path.split(".").pop() ?? "txt";
          switch (ext) {
            case "html":
              opts.contentType = "text/html";
              opts.extension = "html";
              break;
            case "rtf":
              opts.contentType = "application/rtf";
              opts.extension = "rtf";
              break;
            default:
              opts.contentType = "text/plain";
              opts.extension = "txt";
              break;
          }
        }
      }
    }

    return opts as AltChunkOptions;
  },
};

// ── SubDoc (pure string — registers relationships + subDocs) ──

const SUBDOC_REL_TYPE = RELATIONSHIP_TYPES.subDocument;

export const subDocDesc: CustomDescriptor<SubDocOptions, BodyContext> = {
  kind: "custom",

  stringify(opts, ctx) {
    const relId = uniqueId();
    const partPath = `subdocs/subdoc${relId}.docx`;
    const data = toUint8Array(opts.data);

    ctx.fileData.document.relationships.addRelationship(`rId${relId}`, SUBDOC_REL_TYPE, partPath);
    ctx.fileData.subDocs.addSubDoc(relId, {
      data,
      path: partPath,
    });

    return `<w:subDoc r:id="rId${relId}"/>`;
  },

  parse(el, ctx) {
    const rId = attr(el, "r:id");
    const dctx = ctx as DocxReadContext;
    if (rId) {
      const path = dctx.resolveRelationship(rId);
      if (path) {
        const data = dctx.getRaw(path);
        if (data) {
          return { data } as SubDocOptions;
        }
      }
    }
    return { data: new Uint8Array(0) } as SubDocOptions;
  },
};

// ── SDT (pure string — inline sdtPr + stringify children) ──

export interface SdtBlockOptions {
  properties: SdtPropertiesOptions;
  children?: BlockContentChild[];
  /** Run properties for the SDT end mark (w:sdtEndPr). */
  endProperties?: RunPropertiesOptions;
}

function sdtListItemXml(
  item: { displayText?: string; value?: string },
  forceValue?: boolean,
): string {
  const attrs: string[] = [];
  if (item.displayText !== undefined) attrs.push(`w:displayText="${escapeXml(item.displayText)}"`);
  const value = item.value ?? (forceValue ? item.displayText : undefined);
  if (value !== undefined) attrs.push(`w:value="${escapeXml(value)}"`);
  return `<w:listItem ${attrs.join(" ")}/>`;
}

function sdtListTypeXml(
  name: string,
  options: { items?: { displayText?: string; value?: string }[]; lastValue?: string },
): string {
  const parts: string[] = [];
  if (options.items) {
    for (const item of options.items) {
      parts.push(sdtListItemXml(item, name === "w:dropDownList"));
    }
  }
  const attrs: string[] = [];
  if (options.lastValue !== undefined) attrs.push(`w:lastValue="${escapeXml(options.lastValue)}"`);
  const attrStr = attrs.length ? " " + attrs.join(" ") : "";
  return parts.length ? `<${name}${attrStr}>${parts.join("")}</${name}>` : `<${name}${attrStr}/>`;
}

function sdtDateXml(options: {
  dateFormat?: string;
  languageId?: string;
  storeMappedDataAs?: string;
  calendar?: string;
  fullDate?: string;
}): string {
  const parts: string[] = [];
  if (options.dateFormat !== undefined)
    parts.push(`<w:dateFormat w:val="${escapeXml(options.dateFormat)}"/>`);
  if (options.languageId !== undefined)
    parts.push(`<w:lid w:val="${escapeXml(options.languageId)}"/>`);
  if (options.storeMappedDataAs !== undefined)
    parts.push(`<w:storeMappedDataAs w:val="${options.storeMappedDataAs}"/>`);
  if (options.calendar !== undefined) parts.push(`<w:calendar w:val="${options.calendar}"/>`);
  const attrs: string[] = [];
  if (options.fullDate !== undefined) attrs.push(`w:fullDate="${options.fullDate}"`);
  const attrStr = attrs.length ? " " + attrs.join(" ") : "";
  return parts.length ? `<w:date${attrStr}>${parts.join("")}</w:date>` : `<w:date${attrStr}/>`;
}

function sdtDataBindingXml(options: {
  prefixMappings?: string;
  xpath: string;
  storeItemID: string;
}): string {
  const attrs: string[] = [`w:xpath="${escapeXml(options.xpath)}"`];
  // @w:storeItemID is required by CT_DataBinding; an empty string is not a
  // legal value and Word rejects the package on open, so skip the attribute
  // only in that degenerate case.
  if (options.storeItemID) attrs.push(`w:storeItemID="${escapeXml(options.storeItemID)}"`);
  if (options.prefixMappings !== undefined)
    attrs.push(`w:prefixMappings="${escapeXml(options.prefixMappings)}"`);
  return `<w:dataBinding ${attrs.join(" ")}/>`;
}

function sdtDocPartXml(
  name: string,
  options: { gallery?: string; category?: string; unique?: boolean },
): string {
  const parts: string[] = [];
  if (options.gallery !== undefined)
    parts.push(`<w:docPartGallery w:val="${escapeXml(options.gallery)}"/>`);
  if (options.category !== undefined)
    parts.push(`<w:docPartCategory w:val="${escapeXml(options.category)}"/>`);
  if (options.unique !== undefined)
    parts.push(options.unique ? "<w:docPartUnique/>" : '<w:docPartUnique w:val="0"/>');
  return parts.length ? `<${name}>${parts.join("")}</${name}>` : `<${name}/>`;
}

const W14_NS = 'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"';

/** Default symbol font for checkbox content controls (CT_SdtCheckboxSymbol). */
const CHECKBOX_FONT = "MS Gothic";

const DEFAULT_CHECKED: { val: string; font: string } = { val: "2612", font: CHECKBOX_FONT };
const DEFAULT_UNCHECKED: { val: string; font: string } = { val: "2610", font: CHECKBOX_FONT };

/**
 * Build a w14:checkbox element (Word 2010+ content control checkbox).
 *
 * Lives in the w14 extension namespace; emitted with an inline xmlns:w14 so it
 * is valid wherever w:sdtPr appears. validate.ts tolerates the w14 namespace.
 */
function sdtCheckboxXml(opts: SdtCheckboxOptions): string {
  const checked = opts.checkedState ?? DEFAULT_CHECKED;
  const unchecked = opts.uncheckedState ?? DEFAULT_UNCHECKED;
  const inner =
    (opts.checked ? "<w14:checked/>" : '<w14:checked w14:val="0"/>') +
    `<w14:checkedState w14:val="${escapeXml(checked.val)}" w14:font="${escapeXml(checked.font ?? CHECKBOX_FONT)}"/>` +
    `<w14:uncheckedState w14:val="${escapeXml(unchecked.val)}" w14:font="${escapeXml(unchecked.font ?? CHECKBOX_FONT)}"/>`;
  return `<w14:checkbox ${W14_NS}>${inner}</w14:checkbox>`;
}

/** Build the run that renders a checkbox content control's current state symbol. */
export function checkboxSymbolRunInner(cb: SdtCheckboxOptions): string {
  const symbol =
    (cb.checked ?? false)
      ? (cb.checkedState ?? DEFAULT_CHECKED)
      : (cb.uncheckedState ?? DEFAULT_UNCHECKED);
  const font = escapeXml(symbol.font ?? CHECKBOX_FONT);
  const char = escapeXml(String.fromCodePoint(parseInt(symbol.val, 16)));
  return `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/></w:rPr><w:t>${char}</w:t></w:r>`;
}

export function stringifySdtPr(opts: SdtPropertiesOptions): string {
  const parts: string[] = [];

  // rPr — the SDT start mark's run properties (CT_SdtPr's leading element)
  if (opts.runProperties) {
    const rPrInner = stringifyRunPropertiesInner(opts.runProperties);
    if (rPrInner) parts.push(`<w:rPr>${rPrInner}</w:rPr>`);
  }

  if (opts.alias !== undefined) parts.push(`<w:alias w:val="${escapeXml(opts.alias)}"/>`);
  if (opts.tag !== undefined) parts.push(`<w:tag w:val="${escapeXml(opts.tag)}"/>`);
  if (opts.id !== undefined) parts.push(`<w:id w:val="${opts.id}"/>`);
  if (opts.lock !== undefined) parts.push(`<w:lock w:val="${opts.lock}"/>`);

  // CT_Placeholder requires its w:docPart child — skip the element entirely
  // when no building block is referenced instead of writing the illegal bare
  // <w:placeholder/>.
  if (opts.placeholder?.docPart !== undefined) {
    parts.push(
      `<w:placeholder><w:docPart w:val="${escapeXml(opts.placeholder.docPart)}"/></w:placeholder>`,
    );
  }

  if (opts.temporary !== undefined) parts.push(onOff("w:temporary", opts.temporary));
  const effectiveShowingPlcHdr = opts.showingPlaceholder ?? false;
  if (opts.showingPlaceholder !== undefined || effectiveShowingPlcHdr) {
    parts.push(onOff("w:showingPlcHdr", effectiveShowingPlcHdr));
  }
  if (opts.dataBinding) parts.push(sdtDataBindingXml(opts.dataBinding));
  if (opts.label !== undefined) parts.push(`<w:label w:val="${opts.label}"/>`);
  if (opts.tabIndex !== undefined) parts.push(`<w:tabIndex w:val="${opts.tabIndex}"/>`);

  // Type discriminator (xsd:choice)
  if (opts.equation) {
    parts.push("<w:equation/>");
  } else if (opts.comboBox) {
    parts.push(sdtListTypeXml("w:comboBox", opts.comboBox));
  } else if (opts.date) {
    parts.push(sdtDateXml(opts.date));
  } else if (opts.docPartObj) {
    parts.push(sdtDocPartXml("w:docPartObj", opts.docPartObj));
  } else if (opts.docPartList) {
    parts.push(sdtDocPartXml("w:docPartList", opts.docPartList));
  } else if (opts.dropDownList) {
    parts.push(sdtListTypeXml("w:dropDownList", opts.dropDownList));
  } else if (opts.picture) {
    parts.push("<w:picture/>");
  } else if (opts.richText) {
    parts.push("<w:richText/>");
  } else if (opts.text !== undefined) {
    // w:multiLine defaults to false (ST_OnOff) — Office omits the attribute
    // for the default, so only the true case carries it.
    parts.push(opts.text.multiLine === true ? `<w:text w:multiLine="1"/>` : `<w:text/>`);
  } else if (opts.citation) {
    parts.push("<w:citation/>");
  } else if (opts.group) {
    parts.push("<w:group/>");
  } else if (opts.bibliography) {
    parts.push("<w:bibliography/>");
  } else if (opts.checkbox) {
    parts.push(sdtCheckboxXml(opts.checkbox));
  }

  // w15:appearance (Word 2013+) trails the CT_SdtPr sequence.
  if (opts.appearance) parts.push(`<w15:appearance w15:val="${opts.appearance}"/>`);

  return parts.length ? `<w:sdtPr>${parts.join("")}</w:sdtPr>` : "<w:sdtPr/>";
}

/**
 * Build the <w:sdt> shell shared by all four SDT levels (block/run/cell/row).
 * The caller supplies the sdtContent body; sdtPr/sdtEndPr are handled uniformly.
 */
export function stringifySdtShell(
  properties: SdtPropertiesOptions,
  endProperties: RunPropertiesOptions | undefined,
  contentXml: string,
): string {
  // sdtEndPr is optional (CT_Sdt's minOccurs=0) — omit when the source had
  // none; an empty object still emits the bare element the source carried.
  const endPrInner = endProperties ? stringifyRunPropertiesInner(endProperties) : undefined;
  const endPr =
    endProperties === undefined
      ? ""
      : endPrInner
        ? `<w:sdtEndPr><w:rPr>${endPrInner}</w:rPr></w:sdtEndPr>`
        : "<w:sdtEndPr/>";
  const content = contentXml ? `<w:sdtContent>${contentXml}</w:sdtContent>` : "<w:sdtContent/>";
  return `<w:sdt>${stringifySdtPr(properties)}${endPr}${content}</w:sdt>`;
}

// ── SDT parse helpers ──
/** Parse w:customXmlPr element into CustomXmlPropertiesOptions. */
export function parseCustomXmlProperties(el: Element): CustomXmlPropertiesOptions {
  const opts: CustomXmlPropertiesOptions = {};
  const placeholder = findChild(el, "w:placeholder");
  if (placeholder) {
    const val = attr(placeholder, "w:val");
    if (val) opts.placeholder = val;
  }
  const attributes: { name: string; val: string; uri?: string }[] = [];
  for (const child of el.elements ?? []) {
    if (child.name !== "w:attr") continue;
    const name = attr(child, "w:name");
    const val = attr(child, "w:val");
    if (name && val) {
      const attrOpts: { name: string; val: string; uri?: string } = { name, val };
      const uriVal = attr(child, "w:uri");
      if (uriVal) attrOpts.uri = uriVal;
      attributes.push(attrOpts);
    }
  }
  if (attributes.length > 0) opts.attributes = attributes;
  return opts;
}

/** Body child element parsing callback for SDT/customXml content. */
let _parseBodyChild: ((el: Element, ctx: DocxReadContext) => SectionChild) | undefined;

/** Register the body child parser (called from parse/body.ts to break circular dependency). */
export function setBodyParseChild(
  parser: (el: Element, ctx: DocxReadContext) => SectionChild,
): void {
  _parseBodyChild = parser;
}

/** Parse through the registered block-child dispatcher without importing parse/body.ts. */
export function parseRegisteredBodyChild(
  el: Element,
  ctx: DocxReadContext,
): SectionChild | undefined {
  return _parseBodyChild?.(el, ctx);
}

function parseBodyChildren(elements: Element[], ctx: DocxReadContext): SectionChild[] {
  if (!_parseBodyChild) return [];
  const result: SectionChild[] = [];
  for (const el of elements) {
    result.push(_parseBodyChild(el, ctx));
  }
  return result;
}

export const sdtBlockDesc: CustomDescriptor<SdtBlockOptions, BodyContext> = {
  kind: "custom",

  stringify(opts, ctx) {
    const parts: string[] = ["<w:sdt>"];

    // sdtPr
    parts.push(stringifySdtPr(opts.properties));

    // sdtEndPr — optional; CT_SdtEndPr wraps its run properties in w:rPr.
    // An empty object still emits the bare element the source carried.
    const endPrInner = opts.endProperties
      ? stringifyRunPropertiesInner(opts.endProperties)
      : undefined;
    if (opts.endProperties !== undefined) {
      parts.push(
        endPrInner ? `<w:sdtEndPr><w:rPr>${endPrInner}</w:rPr></w:sdtEndPr>` : "<w:sdtEndPr/>",
      );
    }

    // sdtContent — checkbox renders its current state symbol; otherwise serialize children
    if (opts.properties.checkbox) {
      parts.push(
        `<w:sdtContent><w:p>${checkboxSymbolRunInner(opts.properties.checkbox)}</w:p></w:sdtContent>`,
      );
    } else if (opts.children && opts.children.length > 0) {
      const contentParts: string[] = [];
      for (const child of opts.children) {
        contentParts.push(ctx.stringifyChild(child));
      }
      const contentBody = contentParts.join("");
      parts.push(contentBody ? `<w:sdtContent>${contentBody}</w:sdtContent>` : "<w:sdtContent/>");
    }

    parts.push("</w:sdt>");
    return parts.join("");
  },

  parse(el, ctx) {
    const dctx = ctx as DocxReadContext;

    // Parse sdtPr
    const sdtPr = findChild(el, "w:sdtPr");
    const properties = sdtPr ? parseSdtProperties(sdtPr) : {};

    // Parse sdtEndPr (CT_SdtEndPr wraps its run properties in a w:rPr child)
    let endProperties: RunPropertiesOptions | undefined;
    const sdtEndPr = findChild(el, "w:sdtEndPr");
    if (sdtEndPr) {
      const rPr = findChild(sdtEndPr, "w:rPr");
      endProperties = rPr ? parseRunProperties(rPr) : {};
    }

    // Parse sdtContent children
    const sdtContent = findChild(el, "w:sdtContent");
    let childList: SectionChild[] | undefined;
    if (sdtContent && sdtContent.elements?.length) {
      childList = parseBodyChildren(sdtContent.elements, dctx);
      if (childList.length === 0) childList = undefined;
    }

    return { properties, children: childList, endProperties } as SdtBlockOptions;
  },
};

// ── Custom XML (pure string — no context side effects) ──

export interface CustomXmlBlockDescriptorOptions {
  element: string;
  uri?: string;
  properties?: CustomXmlPropertiesOptions;
  children?: BlockContentChild[];
}

function buildCustomXmlPropertiesXml(pr: CustomXmlPropertiesOptions): string {
  const parts: string[] = ["<w:customXmlPr>"];
  if (pr.placeholder !== undefined) {
    parts.push(`<w:placeholder w:val="${escapeXml(pr.placeholder)}"/>`);
  }
  if (pr.attributes) {
    for (const attr of pr.attributes) {
      const attrParts: string[] = [
        `w:name="${escapeXml(attr.name)}"`,
        `w:val="${escapeXml(attr.val)}"`,
      ];
      if (attr.uri !== undefined) attrParts.push(`w:uri="${escapeXml(attr.uri)}"`);
      parts.push(`<w:attr ${attrParts.join(" ")}/>`);
    }
  }
  parts.push("</w:customXmlPr>");
  return parts.join("");
}

/**
 * Serialize the common customXml shell (element/uri/customXmlPr) wrapping
 * arbitrary content. Shared by all four customXml levels (block/run/row/cell).
 *
 * Microsoft Word removed support for `w:customXml` inline markup on 2010-01-10
 * (i4i Inc. v. Microsoft ruling) and deletes these elements on open; this
 * serializer exists for round-tripping documents that still carry them.
 * Prefer content controls (`w:sdt`) or a `customXml` part for new content.
 */
export function stringifyCustomXmlShell(
  opts: { element: string; uri?: string; properties?: CustomXmlPropertiesOptions },
  contentXml: string,
): string {
  const attrs: string[] = [`w:element="${escapeXml(opts.element)}"`];
  if (opts.uri !== undefined) attrs.push(`w:uri="${escapeXml(opts.uri)}"`);
  const prXml = opts.properties ? buildCustomXmlPropertiesXml(opts.properties) : "";
  return `<w:customXml ${attrs.join(" ")}>${prXml}${contentXml}</w:customXml>`;
}

export const customXmlBlockDesc: CustomDescriptor<CustomXmlBlockDescriptorOptions, BodyContext> = {
  kind: "custom",

  stringify(opts, ctx) {
    const contentParts: string[] = [];
    if (opts.children) {
      for (const child of opts.children) {
        contentParts.push(ctx.stringifyChild(child));
      }
    }
    return stringifyCustomXmlShell(opts, contentParts.join(""));
  },

  parse(el, ctx) {
    const dctx = ctx as DocxReadContext;
    const opts: Partial<CustomXmlBlockDescriptorOptions> = {};

    const element = attr(el, "w:element");
    if (element) opts.element = element;

    const uri = attr(el, "w:uri");
    if (uri) opts.uri = uri;

    // Parse w:customXmlPr
    const xmlPr = findChild(el, "w:customXmlPr");
    if (xmlPr) {
      opts.properties = parseCustomXmlProperties(xmlPr);
    }

    // Parse block-level children
    const childList: SectionChild[] = [];
    for (const child of el.elements ?? []) {
      if (child.name === "w:customXmlPr") continue;
      if (_parseBodyChild) {
        childList.push(_parseBodyChild(child, dctx));
      }
    }
    if (childList.length > 0) opts.children = childList as BlockContentChild[];

    return opts as CustomXmlBlockDescriptorOptions;
  },
};
