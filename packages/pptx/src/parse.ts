import type { ParsedArchive, PassthroughRelationship } from "@office-open/core";
import {
  appPropertiesDesc,
  collectPassthroughParts,
  contentTypesDesc,
  customPropertiesDesc,
  isEncryptedContainer,
  parseArchive,
  parseCorePropsElement,
  partPathToRelsPath,
  resolveRelationshipTarget,
} from "@office-open/core";
import type { DataType } from "@office-open/core";
import { extUriMatches, toUint8Array, toUint8ArrayAsync } from "@office-open/core";
import type { ReadContext } from "@office-open/core/descriptor";
import { themeDesc, themeOverrideDesc } from "@office-open/core/theme";
import type { Element } from "@office-open/xml";
import { attr, attrNum, findChild } from "@office-open/xml";

import { PptxReadContext, ParseContext } from "./context";
import { commentAuthorsDesc, slideCommentsDesc } from "./parts/descriptors/comments";
import { handoutMasterDesc } from "./parts/descriptors/handout-master";
import { notesMasterDesc } from "./parts/descriptors/notes-master";
import { notesSlideDesc } from "./parts/descriptors/notes-slide";
import { presentationDesc } from "./parts/descriptors/presentation";
import { presentationPropertiesDesc } from "./parts/descriptors/presentation-properties";
import { slideDesc } from "./parts/descriptors/slide";
import { slideLayoutDesc } from "./parts/descriptors/slide-layout";
import { slideMasterDesc } from "./parts/descriptors/slide-master";
import { tableStylesDesc } from "./parts/descriptors/table-styles";
import { viewPropsDesc } from "./parts/descriptors/view-properties";

export { parseArchive };

import type { CustomerDataOptions } from "./parts/presentation";
import type { SlideLayoutType } from "./parts/slide-layout";
import type {
  LayoutDefinition,
  MasterDefinition,
  SlideOptions,
  SlideCommentOptions,
  PresentationOptions,
} from "./shared/file";

/**
 * All part paths extracted from the PPTX package.
 * Field names correspond directly to the OOXML directory structure.
 */
export interface PptxPartRefs {
  /** ppt/theme/themeN.xml */
  themes: string[];
  /** ppt/notesMasters/notesMasterN.xml */
  notesMasters: string[];
  /** ppt/handoutMasters/handoutMasterN.xml */
  handoutMasters: string[];
  /** ppt/handoutMasters/handoutMasterN.xml presence. */
  handoutMaster: boolean;
  /** ppt/commentAuthors.xml */
  commentAuthors?: string;
  /** ppt/comments/commentN.xml (from slide rels) */
  comments: string[];
  /** ppt/charts/chartN.xml (from slide rels) */
  charts: string[];
  /** ppt/diagrams/dataN.xml (from slide rels) */
  diagramData: string[];
  /** ppt/media/* (all media files) */
  media: string[];
}

export interface PptxDocument {
  doc: ParsedArchive;
  /** ppt/presentation.xml root element (p:presentation) */
  presentation?: Element;
  /** ppt/slides/slideN.xml */
  slides: string[];
  /** ppt/slideMasters/slideMasterN.xml */
  slideMasters: string[];
  /** ppt/slideLayouts/slideLayoutN.xml */
  slideLayouts: string[];
  /** ppt/notesSlides/notesSlideN.xml */
  notesSlides: string[];
  partRefs: PptxPartRefs;
  /** ppt/presProps.xml */
  presProps?: string;
  /** ppt/viewProps.xml */
  viewProps?: string;
  /** ppt/tableStyles.xml */
  tableStyles?: string;
  /** docProps/core.xml */
  coreProps?: string;
  /** docProps/app.xml */
  appProps?: string;
  /** docProps/custom.xml */
  customProps?: string;
}

function sortByNumber(paths: string[]): string[] {
  return paths.sort((a, b) => {
    const numA = parseInt(a.match(/(\d+)/)?.[1] ?? "0", 10);
    const numB = parseInt(b.match(/(\d+)/)?.[1] ?? "0", 10);
    return numA - numB;
  });
}

function xmlKeys(keys: string[]): string[] {
  return keys.filter((k) => k.endsWith(".xml"));
}

function parseRootRels(doc: ParsedArchive): {
  coreProps?: string;
  appProps?: string;
  customProps?: string;
} {
  const relsEl = doc.get("_rels/.rels");
  if (!relsEl) return {};

  // Canonical OPC/docProps relationship types. Duplicate rels with variant
  // URIs (camelCase …/extendedProperties, the …/officedocument/… core form)
  // exist in the wild — the canonical spelling wins, the losing part flows
  // through the passthrough pipeline untouched.
  const canonicalCore =
    "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties";
  const canonicalApp =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties";
  const canonicalCustom =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties";
  let coreProps: string | undefined;
  let appProps: string | undefined;
  let customProps: string | undefined;

  for (const child of relsEl.elements ?? []) {
    if (child.name !== "Relationship") continue;
    const type = attr(child, "Type") ?? "";
    const target = attr(child, "Target") ?? "";
    if (!target) continue;

    const path = target.startsWith("/") ? target.slice(1) : target;

    // Transitional packages use the oclc URI form with camelCase segments
    // (…/extendedProperties); normalize case and hyphens so both resolve.
    const relType = type.toLowerCase().replaceAll("-", "");
    if (relType.includes("/coreproperties")) {
      if (type === canonicalCore || coreProps === undefined) coreProps = path;
    } else if (relType.includes("/extendedproperties")) {
      if (type === canonicalApp || appProps === undefined) appProps = path;
    } else if (relType.includes("/customproperties")) {
      if (type === canonicalCustom || customProps === undefined) customProps = path;
    }
  }

  return { coreProps, appProps, customProps };
}

function parseSlideRels(doc: ParsedArchive, slidePaths: string[], refs: PptxPartRefs): void {
  const commentsSet = new Set(refs.comments);
  const chartsSet = new Set(refs.charts);
  const diagramDataSet = new Set(refs.diagramData);
  const mediaSet = new Set(refs.media);

  for (const slidePath of slidePaths) {
    const relsPath = partPathToRelsPath(slidePath);

    const relsEl = doc.get(relsPath);
    if (!relsEl) continue;

    for (const child of relsEl.elements ?? []) {
      if (child.name !== "Relationship") continue;
      const type = attr(child, "Type") ?? "";
      const target = attr(child, "Target") ?? "";
      if (!target) continue;

      const path = resolveRelationshipTarget(slidePath, target);

      if (type.includes("/comments") && !type.includes("commentAuthors")) {
        commentsSet.add(path);
      } else if (type.includes("/chart")) {
        chartsSet.add(path);
      } else if (type.includes("/diagramData")) {
        diagramDataSet.add(path);
      } else if (
        type.includes("/image") ||
        type.includes("/video") ||
        type.includes("/audio") ||
        type.includes("/media")
      ) {
        mediaSet.add(path);
      }
    }
  }

  refs.comments = [...commentsSet];
  refs.charts = [...chartsSet];
  refs.diagramData = [...diagramDataSet];
  refs.media = [...mediaSet];
}

export function parsePptx(data: DataType): PptxDocument {
  const uint8 = toUint8Array(data);
  const doc = parseArchive(uint8);

  const presentation = doc.get("ppt/presentation.xml");

  const relsXml = doc.get("ppt/_rels/presentation.xml.rels");
  const slides: string[] = [];
  const slideMasters: string[] = [];
  const themes: string[] = [];
  const notesMasters: string[] = [];
  const handoutMasters: string[] = [];
  let presProps: string | undefined;
  let viewProps: string | undefined;
  let tableStyles: string | undefined;
  let commentAuthors: string | undefined;

  if (relsXml) {
    for (const child of relsXml.elements ?? []) {
      if (child.name !== "Relationship") continue;
      const type = attr(child, "Type") ?? "";
      const target = attr(child, "Target") ?? "";
      if (!target) continue;

      const path = resolveRelationshipTarget("ppt/presentation.xml", target);

      if (type.includes("/slideMaster")) {
        slideMasters.push(path);
      } else if (
        type.includes("/slide") &&
        !type.includes("slideLayout") &&
        !type.includes("slideMaster")
      ) {
        slides.push(path);
      } else if (type.includes("/theme")) {
        themes.push(path);
      } else if (type.includes("/notesMaster")) {
        notesMasters.push(path);
      } else if (type.includes("/handoutMaster")) {
        handoutMasters.push(path);
      } else if (type.includes("/presProps")) {
        presProps = path;
      } else if (type.includes("/viewProps")) {
        viewProps = path;
      } else if (type.includes("/tableStyles")) {
        tableStyles = path;
      } else if (type.includes("/commentAuthors")) {
        commentAuthors = path;
      }
    }
  }

  sortByNumber(slides);
  sortByNumber(slideMasters);
  sortByNumber(themes);
  sortByNumber(notesMasters);
  sortByNumber(handoutMasters);

  const slideLayouts = sortByNumber(xmlKeys(doc.keys("ppt/slideLayouts/")));
  const notesSlides = sortByNumber(xmlKeys(doc.keys("ppt/notesSlides/")));

  const partRefs: PptxPartRefs = {
    themes,
    notesMasters,
    handoutMasters,
    handoutMaster: handoutMasters.length > 0,
    commentAuthors,
    comments: [],
    charts: [],
    diagramData: [],
    media: doc.keys("ppt/media/"),
  };

  parseSlideRels(doc, slides, partRefs);
  sortByNumber(partRefs.comments);
  sortByNumber(partRefs.charts);
  sortByNumber(partRefs.diagramData);

  const { coreProps, appProps, customProps } = parseRootRels(doc);

  return {
    doc,
    presentation,
    slides,
    slideMasters,
    slideLayouts,
    notesSlides,
    partRefs,
    presProps,
    viewProps,
    tableStyles,
    coreProps,
    appProps,
    customProps,
  };
}

/**
 * Parse a single slide's relationship file into a Map<rId, path>.
 */
function parseSlideRelMap(doc: ParsedArchive, slidePath: string): Map<string, string> {
  const rels = new Map<string, string>();
  const relsPath = partPathToRelsPath(slidePath);

  const relsEl = doc.get(relsPath);
  if (!relsEl) return rels;

  for (const child of relsEl.elements ?? []) {
    if (child.name !== "Relationship") continue;
    const id = attr(child, "Id") ?? "";
    const target = attr(child, "Target") ?? "";
    if (!id || !target) continue;
    // External links (hyperlinks) keep their original URL target
    if (attr(child, "TargetMode") === "External") {
      rels.set(id, target);
    } else {
      rels.set(id, resolveRelationshipTarget(slidePath, target));
    }
  }

  return rels;
}

/**
 * External relationships of slide parts. The shared collector drops
 * part-level External entries because a rebuilt owner usually remaps its
 * rIds — but a slide re-emits unrecognized content verbatim (rawXml children,
 * e.g. a linked p:oleObj) whose source rIds never renumber, so each
 * relationship must survive with its source id for the reference to stay
 * resolvable.
 */
function collectExternalPartRelationships(
  doc: ParsedArchive,
  partPaths: readonly string[],
): PassthroughRelationship[] {
  const out: PassthroughRelationship[] = [];
  for (const partPath of partPaths) {
    const relsEl = doc.get(partPathToRelsPath(partPath));
    for (const rel of relsEl?.elements ?? []) {
      if (rel.name !== "Relationship") continue;
      if (attr(rel, "TargetMode") !== "External") continue;
      const relationshipType = attr(rel, "Type");
      const target = attr(rel, "Target");
      const rId = attr(rel, "Id");
      if (!relationshipType || !target || !rId) continue;
      out.push({ source: partPath, relationshipType, target, rId, targetMode: "External" });
    }
  }
  return out;
}

/**
 * Build a map from each path to the rel target matching a predicate.
 */
function resolveRelTargets(
  doc: ParsedArchive,
  paths: string[],
  predicate: (target: string) => boolean,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const path of paths) {
    for (const target of parseSlideRelMap(doc, path).values()) {
      if (predicate(target)) map.set(path, target);
    }
  }
  return map;
}

/**
 * Parse p14:sectionLst from presentation.xml and map each slide path to its
 * section name. Bridges p14:sldId (by slide id) -> p:sldIdLst (slide id ->
 * rId) -> presentation rels (rId -> path).
 */
function parseSlideSections(
  presentation: Element | undefined,
  doc: ParsedArchive,
): Map<string, string> {
  const pathToSection = new Map<string, string>();
  if (!presentation) return pathToSection;

  const extLst = findChild(presentation, "p:extLst");
  if (!extLst) return pathToSection;

  let sectionLst: Element | undefined;
  for (const ext of extLst.elements ?? []) {
    if (ext.name !== "p:ext") continue;
    if (!extUriMatches(attr(ext, "uri"), "{521415D9-36F7-43E2-AB2F-B90AF26B5E84}")) continue;
    sectionLst = findChild(ext, "p14:sectionLst");
    if (sectionLst) break;
  }
  if (!sectionLst) return pathToSection;

  // slideId -> sectionName
  const sectionBySlideId = new Map<number, string>();
  for (const section of sectionLst.elements ?? []) {
    if (section.name !== "p14:section") continue;
    const name = attr(section, "name");
    if (!name) continue;
    const sldIdLst = findChild(section, "p14:sldIdLst");
    for (const sldId of sldIdLst?.elements ?? []) {
      if (sldId.name !== "p14:sldId") continue;
      const id = attrNum(sldId, "id");
      if (id !== undefined) sectionBySlideId.set(id, name);
    }
  }
  if (sectionBySlideId.size === 0) return pathToSection;

  // slideId -> rId (from p:sldIdLst)
  const sldIdLst = findChild(presentation, "p:sldIdLst");
  const rIdBySlideId = new Map<number, string>();
  for (const sldId of sldIdLst?.elements ?? []) {
    if (sldId.name !== "p:sldId") continue;
    const id = attrNum(sldId, "id");
    const rId = attr(sldId, "r:id");
    if (id !== undefined && rId) rIdBySlideId.set(id, rId);
  }

  // rId -> path (from presentation.xml.rels)
  const relsEl = doc.get("ppt/_rels/presentation.xml.rels");
  const pathByRId = new Map<string, string>();
  for (const child of relsEl?.elements ?? []) {
    if (child.name !== "Relationship") continue;
    const id = attr(child, "Id");
    const target = attr(child, "Target");
    if (id && target) pathByRId.set(id, resolveRelationshipTarget("ppt/presentation.xml", target));
  }

  for (const [slideId, name] of sectionBySlideId) {
    const rId = rIdBySlideId.get(slideId);
    if (!rId) continue;
    const path = pathByRId.get(rId);
    if (path) pathToSection.set(path, name);
  }

  return pathToSection;
}

/**
 * Parse a .pptx file and convert it into PresentationOptions.
 *
 * This is the main public API for parsing PPTX files. Async so that `Blob`
 * (including `File`) and `ReadableStream` inputs are accepted alongside raw
 * bytes — parts are indexed and decompressed on demand.
 * The returned options can be passed directly to `new Presentation(parsed)`
 * to recreate the presentation.
 *
 * @param data - .pptx file content — raw bytes, base64 string, Blob, or ReadableStream
 * @returns Parsed presentation options
 */
export async function parsePresentation(data: DataType): Promise<PresentationOptions> {
  return parsePresentationFromBytes(await toUint8ArrayAsync(data));
}

/**
 * Synchronous counterpart of {@link parsePresentation}: same result, but
 * `Blob` and `ReadableStream` inputs throw (normalize them to bytes first,
 * or use the async entry).
 */
export function parsePresentationSync(data: DataType): PresentationOptions {
  return parsePresentationFromBytes(toUint8Array(data));
}

function parsePresentationFromBytes(uint8: Uint8Array): PresentationOptions {
  // Encrypted package (OLE2/CFB container): the plaintext needs the password,
  // so carry the source bytes verbatim for generate() to re-emit.
  if (isEncryptedContainer(uint8)) {
    return { encrypted: { data: uint8 } };
  }

  const pptx = parsePptx(uint8);
  const opts: Partial<PresentationOptions> = {};
  if (pptx.partRefs.handoutMaster) opts.includeHandoutMaster = true;
  const sectionBySlidePath = parseSlideSections(pptx.presentation, pptx.doc);
  // Package-level fallback context — parts parsed with it carry no rel wiring
  // (their relationship layer is resolved separately around the descriptor).
  const bareReadCtx = new PptxReadContext(new ParseContext(pptx, new Map()));

  // 1. Parse slide size from p:sldSz
  if (pptx.presentation) {
    const sldSz = findChild(pptx.presentation, "p:sldSz");
    if (sldSz) {
      const cx = attrNum(sldSz, "cx");
      const cy = attrNum(sldSz, "cy");
      if (cx === 12192000 && cy === 6858000) {
        opts.size = "16:9";
      } else if (cx === 9144000 && cy === 6858000) {
        opts.size = "4:3";
      } else if (cx && cy) {
        opts.size = { width: cx, height: cy };
      }
    }

    // p:custDataLst — customer data parts and the tags part reference.
    const custDataLst = findChild(pptx.presentation, "p:custDataLst");
    if (custDataLst) {
      const customerData: CustomerDataOptions = {};
      const data: { rId: string }[] = [];
      for (const child of custDataLst.elements ?? []) {
        if (child.name === "p:custData") {
          const rId = attr(child, "r:id");
          if (rId) data.push({ rId });
        } else if (child.name === "p:tags") {
          const rId = attr(child, "r:id");
          if (rId) customerData.tags = { rId };
        }
      }
      if (data.length > 0) customerData.data = data;
      if (Object.keys(customerData).length > 0) opts.customerData = customerData;
    }
  }

  // 1b. Presentation-level data fields — via the descriptor's own parse (the
  // same contract stringify uses); id/count/rId wiring stays compiler-owned.
  if (pptx.presentation) {
    const presPart = presentationDesc.parse(pptx.presentation, bareReadCtx);
    opts.photoAlbum = presPart.photoAlbum;
    opts.defaultTextStyle = presPart.defaultTextStyle;
    if (presPart.kinsoku) opts.kinsoku = presPart.kinsoku;
    if (presPart.customShows) opts.customShows = presPart.customShows;
    if (presPart.embeddedFonts) opts.embeddedFonts = presPart.embeddedFonts;
    if (presPart.modifyVerifier) opts.modifyVerifier = presPart.modifyVerifier;
    if (presPart.smartTags) opts.smartTags = presPart.smartTags;
    if (presPart.ext) opts.ext = presPart.ext;
  }

  // 2. Parse core properties
  if (pptx.coreProps) {
    const corePropsEl = pptx.doc.get(pptx.coreProps);
    if (corePropsEl) {
      const cp = parseCorePropsElement(corePropsEl);
      // Empty strings are meaningful (element present, text empty) — assign
      // the whole shape so they survive round-trip.
      Object.assign(opts, cp);
    }
  }

  // 2b. Parse extended (app) properties
  if (pptx.appProps) {
    const appPropsEl = pptx.doc.get(pptx.appProps);
    if (appPropsEl) {
      const ap = appPropertiesDesc.parse(appPropsEl, {} as ReadContext);
      if (ap && Object.keys(ap).length > 0) opts.appProperties = ap;
    }
  }

  // 2c. Parse custom properties — presence-based: an empty docProps/custom.xml
  // round-trips as an empty part, keeping part + rel + Override in sync.
  if (pptx.customProps) {
    const customPropsEl = pptx.doc.get(pptx.customProps);
    if (customPropsEl) {
      const cp = customPropertiesDesc.parse(customPropsEl, {} as ReadContext);
      opts.customProperties = cp.properties ?? [];
    }
  }

  // 3. Parse presentation properties (show/web/print/htmlPublish/colorMru)
  if (pptx.presProps) {
    const presPropsEl = pptx.doc.get(pptx.presProps);
    if (presPropsEl) {
      const presPropsOpts = presentationPropertiesDesc.parse(presPropsEl, {} as ReadContext);
      if (presPropsOpts.show) opts.show = presPropsOpts.show;
      if (presPropsOpts.web) opts.web = presPropsOpts.web;
      if (presPropsOpts.print) opts.print = presPropsOpts.print;
      if (presPropsOpts.htmlPublish) opts.htmlPublish = presPropsOpts.htmlPublish;
      if (presPropsOpts.colorMru) opts.colorMru = presPropsOpts.colorMru;
      if (presPropsOpts.ext) opts.presentationPropertiesExt = presPropsOpts.ext;
    }
  }

  // 3b. Parse view properties
  if (pptx.viewProps) {
    const viewPropsEl = pptx.doc.get(pptx.viewProps);
    if (viewPropsEl) {
      const viewOpts = viewPropsDesc.parse(viewPropsEl, {} as ReadContext);
      if (Object.keys(viewOpts).length > 0) opts.view = viewOpts;
    }
  }

  // 3c. Parse table styles
  if (pptx.tableStyles) {
    const tableStylesEl = pptx.doc.get(pptx.tableStyles);
    if (tableStylesEl) {
      const tableStylesResult = tableStylesDesc.parse(tableStylesEl, {} as ReadContext);
      if (tableStylesResult.opts) opts.tableStyles = tableStylesResult.opts;
    }
  }

  // 4. Build relationship maps
  const masterThemePaths = resolveRelTargets(
    pptx.doc,
    pptx.slideMasters,
    (t) => t.includes("/theme") && !t.includes("/themeOverride") && !t.includes("/themeManager"),
  );
  const layoutThemeOverridePaths = resolveRelTargets(pptx.doc, pptx.slideLayouts, (t) =>
    t.includes("/themeOverride"),
  );
  const layoutMasterPaths = resolveRelTargets(pptx.doc, pptx.slideLayouts, (t) =>
    t.includes("/slideMaster"),
  );
  const slideLayoutPaths = resolveRelTargets(pptx.doc, pptx.slides, (t) =>
    t.includes("/slideLayout"),
  );

  // 5. Parse masters

  const masterDefs: MasterDefinition[] = [];

  for (const [mi, masterPath] of pptx.slideMasters.entries()) {
    const masterEl = pptx.doc.get(masterPath);
    if (!masterEl) continue;

    // Theme (resolved separately — the descriptor does not handle theme).
    const themePath = masterThemePaths.get(masterPath);
    const themeEl = themePath ? pptx.doc.get(themePath) : undefined;
    const themeOptions = themeEl ? themeDesc.parse(themeEl, bareReadCtx) : undefined;

    // Structured master (cSld/clrMap/sldLayoutIdLst/transition/timing/hf/txStyles).
    // Placeholders are derived from spTree, so their positions survive round-trip.
    // The master's own rels back r:embed resolution (a blip-filled master
    // background references its image here).
    const masterReadCtx = new PptxReadContext(
      new ParseContext(pptx, parseSlideRelMap(pptx.doc, masterPath)),
    );
    const masterOpts = slideMasterDesc.parse(masterEl, masterReadCtx);

    // Layouts belonging to this master (resolved separately — relationship layer).
    // A layout with no .rels (sources ship such packages) still belongs when
    // the master's sldLayoutIdLst names it — fall back to that membership.
    const masterListedLayouts = new Set<string>();
    const layoutIdsByPath = new Map<string, number>();
    const sldLayoutIdLst = findChild(masterEl, "p:sldLayoutIdLst");
    if (sldLayoutIdLst) {
      const masterRelTargets = parseSlideRelMap(pptx.doc, masterPath);
      for (const sldLayoutId of sldLayoutIdLst.elements ?? []) {
        if (sldLayoutId.name !== "p:sldLayoutId") continue;
        const rid = sldLayoutId.attributes?.["r:id"];
        const target = rid ? masterRelTargets.get(String(rid)) : undefined;
        const idAttr = sldLayoutId.attributes?.["id"];
        if (target && pptx.slideLayouts.includes(target)) {
          masterListedLayouts.add(target);
          const idNum = Number(idAttr);
          if (idAttr !== undefined && Number.isFinite(idNum)) {
            layoutIdsByPath.set(target, idNum);
          }
        }
      }
    }
    const masterLayouts: LayoutDefinition[] = [];
    for (const layoutPath of pptx.slideLayouts) {
      if (layoutMasterPaths.get(layoutPath) !== masterPath && !masterListedLayouts.has(layoutPath))
        continue;
      const layoutEl = pptx.doc.get(layoutPath);
      if (layoutEl) {
        // Fully structured def (children/background/clrMapOvr/transition/...).
        // The compiler re-stringifies from structure, so edits survive round-trip.
        // The layout's own rels back its r:embed resolution (background blips).
        const layoutReadCtx = new PptxReadContext(
          new ParseContext(pptx, parseSlideRelMap(pptx.doc, layoutPath)),
        );
        const layoutDef = slideLayoutDesc.parse(layoutEl, layoutReadCtx);
        const sourceLayoutId = layoutIdsByPath.get(layoutPath);
        if (sourceLayoutId !== undefined) layoutDef.layoutId = sourceLayoutId;
        const themeOverridePath = layoutThemeOverridePaths.get(layoutPath);
        const themeOverrideEl = themeOverridePath ? pptx.doc.get(themeOverridePath) : undefined;
        if (themeOverrideEl) {
          layoutDef.themeOverride = themeOverrideDesc.parse(themeOverrideEl, layoutReadCtx);
        }
        masterLayouts.push(layoutDef);
      }
    }

    const masterName = themeOptions?.name ?? `master${mi + 1}`;
    const masterDef: Partial<MasterDefinition> = {
      name: masterName,
      background: masterOpts.background,
      children: masterOpts.children,
      placeholders: masterOpts.placeholders,
      colorMapping: masterOpts.colorMapping,
      headerFooter: masterOpts.headerFooter,
      textStyles: masterOpts.textStyles,
      preserve: masterOpts.preserve,
      transition: masterOpts.transition,
      animations: masterOpts.animations,
      customerData: masterOpts.customerData,
      controls: masterOpts.controls,
      cSldExt: masterOpts.cSldExt,
      ext: masterOpts.ext,
    };
    if (themeOptions) masterDef.theme = themeOptions;
    if (masterLayouts.length > 0) masterDef.layouts = masterLayouts;
    masterDefs.push(masterDef as MasterDefinition);
  }

  // Carry every parsed master — a single source master must survive round-trip
  // too (the compiler only synthesizes a default master when none is given).
  if (masterDefs.length > 0) {
    opts.masters = masterDefs;
  }

  // 5b. Parse notes masters
  const notesMasterThemePaths = resolveRelTargets(
    pptx.doc,
    pptx.partRefs.notesMasters,
    (t) => t.includes("/theme") && !t.includes("/themeOverride") && !t.includes("/themeManager"),
  );
  for (const nmPath of pptx.partRefs.notesMasters) {
    const nmEl = pptx.doc.get(nmPath);
    if (nmEl) {
      const nmOpts = notesMasterDesc.parse(nmEl, bareReadCtx);
      const nmThemePath = notesMasterThemePaths.get(nmPath);
      const nmThemeEl = nmThemePath ? pptx.doc.get(nmThemePath) : undefined;
      if (nmThemeEl) nmOpts.theme = themeDesc.parse(nmThemeEl, bareReadCtx);
      if (Object.keys(nmOpts).length > 0) {
        opts.includeNotesMaster = true;
        opts.notesMasterOptions = nmOpts;
      }
    }
  }

  // 5c. Parse handout masters — content plus their own theme part
  const handoutMasterThemePaths = resolveRelTargets(
    pptx.doc,
    pptx.partRefs.handoutMasters,
    (t) => t.includes("/theme") && !t.includes("/themeOverride") && !t.includes("/themeManager"),
  );
  for (const hmPath of pptx.partRefs.handoutMasters) {
    const hmEl = pptx.doc.get(hmPath);
    if (!hmEl) continue;
    const hmParsed = handoutMasterDesc.parse(hmEl, bareReadCtx);
    if (hmParsed.options) {
      const hmThemePath = handoutMasterThemePaths.get(hmPath);
      const hmThemeEl = hmThemePath ? pptx.doc.get(hmThemePath) : undefined;
      if (hmThemeEl) hmParsed.options.theme = themeDesc.parse(hmThemeEl, bareReadCtx);
      opts.handoutMasterOptions = hmParsed.options;
    }
  }

  // 6. Parse comment authors
  const commentAuthors = new Map<number, { name: string; initials: string }>();
  if (pptx.partRefs.commentAuthors) {
    const authorsEl = pptx.doc.get(pptx.partRefs.commentAuthors);
    if (authorsEl) {
      const authors = commentAuthorsDesc.parse(authorsEl, bareReadCtx);
      for (const a of authors) {
        commentAuthors.set(a.id, { name: a.name, initials: a.initials });
      }
    }
  }

  // 7. Parse slides with layout and master references
  const result: SlideOptions[] = [];
  for (const slidePath of pptx.slides) {
    const slideEl = pptx.doc.get(slidePath);
    if (!slideEl) continue;

    const slideRels = parseSlideRelMap(pptx.doc, slidePath);
    const ctx = new ParseContext(pptx, slideRels);
    const readCtx = new PptxReadContext(ctx);
    // slideDesc.parse returns the slide-part fields of SlideOptions (children/
    // background/transition/animations/…). The public-API-only fields (layout,
    // master, comments, notes, section) are enriched below before the push.
    const slideOpts = slideDesc.parse(slideEl, readCtx) as Record<string, unknown>;

    // Resolve layout → master
    const layoutPath = slideLayoutPaths.get(slidePath);
    if (layoutPath) {
      const layoutEl = pptx.doc.get(layoutPath);
      if (layoutEl) {
        // The layout's own rels back its r:embed resolution (background blips).
        const layoutReadCtx = new PptxReadContext(
          new ParseContext(pptx, parseSlideRelMap(pptx.doc, layoutPath)),
        );
        const layoutOpts = slideLayoutDesc.parse(layoutEl, layoutReadCtx);
        slideOpts.layout = (layoutOpts.type ?? "blank") as SlideLayoutType;
      }

      const resolvedMasterPath = layoutMasterPaths.get(layoutPath);
      if (resolvedMasterPath) {
        const masterIdx = pptx.slideMasters.indexOf(resolvedMasterPath);
        if (masterIdx >= 0 && masterDefs[masterIdx]) {
          slideOpts.master = masterDefs[masterIdx].name;
        }
      }
    }

    // Comments via slide rels
    for (const [, relPath] of slideRels) {
      if (!relPath.includes("/comments/")) continue;
      const commentsEl = pptx.doc.get(relPath);
      if (!commentsEl) continue;

      const parsedComments = slideCommentsDesc.parse(commentsEl, readCtx);
      if (parsedComments.length > 0) {
        const comments: Partial<SlideCommentOptions>[] = [];
        for (const cm of parsedComments) {
          const entry: Partial<SlideCommentOptions> = { x: cm.x, y: cm.y };
          if (cm.text) entry.text = cm.text;
          if (cm.date) entry.date = cm.date;
          if (cm.modified !== undefined) entry.modified = cm.modified;
          const author = commentAuthors.get(cm.authorId);
          if (author) {
            entry.author = author.name;
            if (author.initials) entry.initials = author.initials;
          }
          comments.push(entry);
        }
        if (comments.length > 0) slideOpts.comments = comments as SlideCommentOptions[];
      }
      break;
    }

    // Notes slide via slide rels
    for (const [, relPath] of slideRels) {
      if (!relPath.includes("/notesSlides/")) continue;
      const notesEl = pptx.doc.get(relPath);
      if (!notesEl) continue;
      const notesData = notesSlideDesc.parse(notesEl, readCtx);
      if (
        notesData.children ||
        notesData.text ||
        notesData.background ||
        notesData.colorMappingOverride ||
        notesData.cSldExt
      ) {
        slideOpts.notes = notesData;
      }
      break;
    }

    // Section (p14:sectionLst) — bridged via slide id -> rId -> path
    const sectionName = sectionBySlidePath.get(slidePath);
    if (sectionName) slideOpts.section = sectionName;

    result.push(slideOpts as SlideOptions);
  }

  opts.slides = result;

  // Package-wide passthrough (SDK ExtendedPart analogue): every part the model
  // did NOT absorb is carried verbatim instead of dropped. Listed below are
  // only parts the compiler ALWAYS re-emits — anything model-driven (layouts,
  // themes beyond the first, charts, notes) may or may not be emitted, so it
  // passes through and the compiler's own output at the same path wins by
  // assembly order. Media is likewise not listed (pinned source paths).
  const rebuilt: string[] = ["ppt/presentation.xml", "ppt/_rels/presentation.xml.rels"];
  if (pptx.coreProps) rebuilt.push(pptx.coreProps);
  if (pptx.appProps) rebuilt.push(pptx.appProps);
  if (pptx.customProps) rebuilt.push(pptx.customProps);
  for (const p of pptx.slides) {
    rebuilt.push(p);
    rebuilt.push(partPathToRelsPath(p));
  }
  for (const p of pptx.slideMasters) {
    rebuilt.push(p);
    rebuilt.push(partPathToRelsPath(p));
  }
  if (pptx.presProps) rebuilt.push(pptx.presProps);
  if (pptx.viewProps) rebuilt.push(pptx.viewProps);
  if (pptx.tableStyles) rebuilt.push(pptx.tableStyles);
  const { parts: passthroughParts, relationships: passthroughRels } = collectPassthroughParts(
    pptx.doc,
    rebuilt,
  );
  passthroughRels.push(...collectExternalPartRelationships(pptx.doc, pptx.slides));
  if (passthroughParts.length > 0) opts.rawParts = passthroughParts;
  if (passthroughRels.length > 0) opts.passthroughRelationships = passthroughRels;

  // Source content-type declarations — the compiler keeps them as the base
  // table so round-trip preserves the Default/Override split (a .xlsx
  // embedding stays Default-typed, a printer-settings .bin stays itself).
  const sourceContentTypes = pptx.doc.get("[Content_Types].xml");
  if (sourceContentTypes) {
    const ct = contentTypesDesc.parse(sourceContentTypes, {} as ReadContext);
    if (ct) opts.contentTypes = ct;
  }

  return opts as PresentationOptions;
}
