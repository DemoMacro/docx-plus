/**
 * Master/layout compile phase: builds the slide-master map (masters, their
 * layouts, deduped themes) and writes the master, layout, notesMaster, and
 * handoutMaster parts into the file mapping.
 *
 * @module
 */

import {
  RELATIONSHIP_TYPES,
  Relationships,
  collectPlaceholderKeys,
  convertToEmu,
  getReferencedMedia,
  replaceImageLinkPlaceholders,
  replaceImagePlaceholders,
  replaceOleLinkPlaceholders,
  themeOverrideDesc,
} from "@office-open/core";
import type { PresentationPartOptions } from "@parts/presentation";
import { buildCustomLayoutXml, buildLayoutXml, type SlideLayoutType } from "@parts/slide-layout";
import type {
  LayoutDefinition,
  MasterDefinition,
  PresentationOptions,
  SlideOptions,
  SlideSize,
} from "@shared/file";
import { createThemeXml } from "@shared/theme";

import type { PptxWriteContext } from "../context";
import { handoutMasterDesc } from "../parts/descriptors/handout-master";
import { notesMasterDesc } from "../parts/descriptors/notes-master";
import { parseLayoutDef, slideLayoutDesc } from "../parts/descriptors/slide-layout";
import { slideMasterDesc } from "../parts/descriptors/slide-master";
import {
  MEDIA_REL_KINDS,
  XML_DECL,
  type RelEntry,
  type XmlifyedFileMapping,
  buildRels,
  reserveClaimedSourceRids,
  wirePartHyperlinks,
} from "./shared";

export interface LayoutInfo {
  key: string;
  index: number;
  masterIndex: number;
  def: LayoutDefinition;
  /** Serialized themeOverride part XML, when the layout deviates from its master's theme. */
  themeOverride?: string;
}

export interface MasterInfo {
  name: string;
  index: number;
  master: string;
  theme: string;
  /** Emitted theme part index — shared when masters carry identical themes. */
  themeIndex: number;
  layouts: LayoutInfo[];
  masterRels: Relationships;
  layoutRels: Relationships[];
}

/**
 * Resolve a layout definition to its structured form for stringify.
 *
 * Structured defs (round-trip parse, or user-provided shapes/bg/transition/etc)
 * pass through unchanged. Fresh template / custom / deprecated-verbatim layouts
 * are built to XML then parsed back to structure, so every layout is emitted via
 * slideLayoutDesc.stringify uniformly.
 */
function resolveLayoutDef(
  layoutDef: LayoutDefinition | undefined,
  slideLayoutType: SlideLayoutType,
  slideWidth: number,
): LayoutDefinition {
  if (layoutDef && hasStructuredLayoutContent(layoutDef)) return layoutDef;
  const xml = layoutDef?.layout
    ? layoutDef.layout
    : layoutDef
      ? buildCustomLayoutXml(layoutDef)
      : buildLayoutXml(slideLayoutType, slideWidth);
  return parseLayoutDef(xml);
}

/** True when a def carries structured content that must drive stringify directly. */
function hasStructuredLayoutContent(def: LayoutDefinition): boolean {
  return (
    (def.children !== undefined && def.children.length > 0) ||
    def.background !== undefined ||
    def.transition !== undefined ||
    def.animations !== undefined ||
    def.ext !== undefined ||
    def.headerFooter !== undefined ||
    def.colorMappingOverride !== undefined ||
    (def.controls !== undefined && def.controls.length > 0) ||
    (def.customerData !== undefined && def.customerData.length > 0)
  );
}

export function buildMasterMap(
  masterDefs: MasterDefinition[],
  slides: SlideOptions[],
  slideWidth: number,
  ctx: PptxWriteContext,
  passthroughRelationships: PresentationOptions["passthroughRelationships"],
): MasterInfo[] {
  // Master placeholder positions scale to the slide width — record it on the
  // shared context so slideMasterDesc.stringify can read it.
  ctx.slideWidth = slideWidth;
  const defs = masterDefs.length > 0 ? masterDefs : [{} as MasterDefinition];
  const slideMasterLookup = new Map<number, number>();

  for (const [si, slide] of slides.entries()) {
    const masterName = slide.master;
    if (masterName === undefined) {
      slideMasterLookup.set(si, 0);
      continue;
    }
    const mi = defs.findIndex((d) => d.name === masterName);
    slideMasterLookup.set(si, mi >= 0 ? mi : 0);
  }

  let globalLayoutIndex = 0;
  const masters: MasterInfo[] = [];
  // Identical master themes share one theme part (sources commonly point two
  // masters at the same theme) — dedupe by serialized content, like media.
  const themeIndexByXml = new Map<string, number>();
  let themeCount = 0;

  for (const [mi, def] of defs.entries()) {
    const name = def.name ?? `master${mi + 1}`;

    const layoutDefs = def.layouts;
    let layoutKeys: string[];
    if (layoutDefs && layoutDefs.length > 0) {
      layoutKeys = layoutDefs.map(
        (ld) => ld.type ?? ld.name ?? `layout${mi}_${layoutDefs.indexOf(ld)}`,
      );
    } else {
      const seen = new Set<string>();
      const keys: string[] = [];
      for (const [si, slide] of slides.entries()) {
        if (slideMasterLookup.get(si) === mi) {
          const lt = slide.layout ?? "blank";
          if (!seen.has(lt)) {
            seen.add(lt);
            keys.push(lt);
          }
        }
      }
      layoutKeys = keys.length > 0 ? keys : ["blank"];
    }

    // Layout id + rId pairs — rId order matches masterRels below. Source
    // layout ids round-trip as-is; only fresh authoring renumbers.
    const layoutIdBase = 2147483648 + mi * 12 + 1;
    const layoutDefsById = def.layouts;
    const slideLayoutIds = layoutKeys.map((_, li) => ({
      id: layoutDefsById?.[li]?.layoutId ?? layoutIdBase + li,
      relationshipId: `rId${li + 1}`,
    }));
    // Rest-spread so every SlideMasterOptions field flows to the descriptor —
    // field-copy whitelists here have dropped newly added options before.
    const { name: _masterName, theme: _theme, layouts: _layouts, ...masterOpts } = def;
    const master = slideMasterDesc.stringify({ ...masterOpts, slideLayoutIds }, ctx) ?? "";
    const theme = createThemeXml(def.theme, ctx);
    let themeIndex = themeIndexByXml.get(theme);
    if (themeIndex === undefined) {
      themeIndex = themeCount++;
      themeIndexByXml.set(theme, themeIndex);
    }

    const layouts: LayoutInfo[] = [];
    const layoutRels: Relationships[] = [];

    for (const [li, key] of layoutKeys.entries()) {
      const layoutDef = layoutDefs?.[li];
      const slideLayoutType = (layoutDef?.type ?? key) as SlideLayoutType;
      const themeOverride = layoutDef?.themeOverride
        ? (themeOverrideDesc.stringify(layoutDef.themeOverride, ctx) ?? undefined)
        : undefined;
      layouts.push({
        key,
        index: globalLayoutIndex,
        masterIndex: mi,
        def: resolveLayoutDef(layoutDef, slideLayoutType, slideWidth),
        themeOverride,
      });
      const layoutRelEntries: RelEntry[] = [
        {
          id: 1,
          type: RELATIONSHIP_TYPES.slideMaster,
          target: `../slideMasters/slideMaster${mi + 1}.xml`,
        },
      ];
      if (themeOverride) {
        layoutRelEntries.push({
          id: 2,
          type: RELATIONSHIP_TYPES.themeOverride,
          target: `../theme/themeOverride${globalLayoutIndex + 1}.xml`,
        });
      }
      const layoutRel = buildRels(layoutRelEntries);
      // The layout's captured rels are claimed in the mapping phase, after
      // the layout's media/hyperlink batches have registered their kinds —
      // claiming here would re-emit rels the batches then duplicate.
      layoutRels.push(layoutRel);
      globalLayoutIndex++;
    }

    // The master's rels go through the Relationships class like every other
    // part: model registrations and the passthrough claim below share one id
    // space, so a hand-written max-id fallback can't collide with a batch
    // offset. Captured ids whose rels a claim will re-emit are reserved
    // before the media batch snapshots nextRelationshipId; absorbed kinds
    // (slideLayout, theme, images the media batch re-registers) are skipped —
    // reserving them would only open holes their claims never fill.
    const masterMediaData = getReferencedMedia(master, ctx.mediaCollection.array);
    const masterAbsorbedKinds = new Set([
      "slideLayout",
      "theme",
      ...(masterMediaData.length > 0 ? ["image"] : []),
    ]);
    const masterRels = new Relationships();
    reserveClaimedSourceRids(
      masterRels,
      `ppt/slideMasters/slideMaster${mi + 1}.xml`,
      passthroughRelationships,
      masterAbsorbedKinds,
    );
    for (const [li, layout] of layouts.entries()) {
      masterRels.addRelationship(
        li + 1,
        RELATIONSHIP_TYPES.slideLayout,
        `../slideLayouts/slideLayout${layout.index + 1}.xml`,
      );
    }
    masterRels.add(RELATIONSHIP_TYPES.theme, `../theme/theme${themeIndex + 1}.xml`);
    // Media referenced by master shapes gets the same image-relationship
    // wiring slides/layouts use (master pictures otherwise lose their rel).
    // Registered before the passthrough loop so its kind ownership test sees
    // the model registration and skips the source's stale image rels.
    const masterImageOffset = masterRels.nextRelationshipId;
    for (const [idx, mediaItem] of masterMediaData.entries()) {
      masterRels.addRelationship(
        masterImageOffset + idx,
        RELATIONSHIP_TYPES.image,
        `../media/${mediaItem.fileName}`,
      );
    }
    let masterXml = replaceImagePlaceholders(master, masterMediaData, masterImageOffset);
    // Linked image sources on master shapes get the same External wiring.
    const masterImgLinkKeys = collectPlaceholderKeys(masterXml, "img-link:");
    if (masterImgLinkKeys.length > 0) {
      const masterImgLinkSet = new Set(masterImgLinkKeys);
      const masterImgLinks = ctx.imageLinks.filter((l) => masterImgLinkSet.has(l.key));
      const imgLinkOffset = masterRels.nextRelationshipId;
      masterXml = replaceImageLinkPlaceholders(masterXml, masterImgLinks, imgLinkOffset);
      for (const [ili, imgLink] of masterImgLinks.entries()) {
        masterRels.addRelationship(
          imgLinkOffset + ili,
          RELATIONSHIP_TYPES.image,
          imgLink.url,
          "External",
        );
      }
    }
    // Hyperlinks on master shapes/text — same placeholder wiring slides get.
    masterXml = wirePartHyperlinks(
      masterXml,
      ctx.hyperlinks,
      masterRels.nextRelationshipId,
      (id, type, target, mode) => masterRels.addRelationship(id, type, target, mode),
      "../slides/",
    );
    // Master-level passthrough relationships (round-trip) — re-emitted as
    // written unless the model already registered the same kind+target
    // (ownership test: targets may be renamed and ISO-strict types differ in
    // URI only). Media-targeted rels whose kind the model already owns mean
    // the source rel was absorbed under a renamed target — skip on kind alone
    // or the stale target would re-emit dangling (same rule as slides).
    for (const rel of passthroughRelationships ?? []) {
      if (rel.source !== `ppt/slideMasters/slideMaster${mi + 1}.xml`) continue;
      const kind = rel.relationshipType.split("/").pop()!;
      if (MEDIA_REL_KINDS.has(kind) && masterRels.hasRelationshipKind(kind)) continue;
      masterRels.claimSourceRel(rel);
    }

    masters.push({
      name,
      index: mi,
      master: masterXml,
      theme,
      themeIndex,
      layouts,
      masterRels,
      layoutRels,
    });
  }

  return masters;
}

function findLayoutForSlide(
  masters: MasterInfo[],
  slides: SlideOptions[],
  slideIndex: number,
): LayoutInfo {
  // slideIndex is caller-bounded by slides.length; masters is built by buildMasterMap
  // with non-empty layouts — these indexed accesses are contract narrows, not runtime checks.
  const opts = slides[slideIndex]!;
  const mi =
    opts.master !== undefined
      ? Math.max(
          0,
          masters.findIndex((m) => m.name === opts.master),
        )
      : 0;
  const master = masters[mi]!;
  const layoutKey = opts.layout ?? "blank";
  const li = master.layouts.find((l) => l.key === layoutKey);
  return li ?? master.layouts[0]!;
}

export function buildSlideRels(masters: MasterInfo[], slides: SlideOptions[]): Relationships[] {
  const rels: Relationships[] = [];
  for (let i = 0; i < slides.length; i++) {
    const layout = findLayoutForSlide(masters, slides, i);
    rels.push(
      buildRels([
        {
          id: 1,
          type: RELATIONSHIP_TYPES.slideLayout,
          target: `../slideLayouts/slideLayout${layout.index + 1}.xml`,
        },
      ]),
    );
  }
  return rels;
}

export function initPresRels(masters: MasterInfo[], slideCount: number): Relationships {
  // Only structure-owned slots are pre-allocated here: slideMaster + slide rels.
  // presProps/viewProps/theme/tableStyles are added at the end of the
  // compiler pass after passthrough id pre-claim, so they slot in *after* the
  // source ids (notesMaster, handoutMaster, …) and the source ordering of
  // presentation.xml.rels survives round-trip.
  const rels = new Relationships();
  for (let mi = 0; mi < masters.length; mi++) {
    rels.addRelationship(
      mi + 1,
      RELATIONSHIP_TYPES.slideMaster,
      `slideMasters/slideMaster${mi + 1}.xml`,
    );
  }
  for (let i = 0; i < slideCount; i++) {
    rels.addRelationship(
      masters.length + i + 1,
      RELATIONSHIP_TYPES.slide,
      `slides/slide${i + 1}.xml`,
    );
  }
  return rels;
}

export function resolveSlideSize(size?: SlideSize): { width: number; height: number } {
  if (!size || size === "16:9") return { width: 12192000, height: 6858000 };
  if (size === "4:3") return { width: 9144000, height: 6858000 };
  return { width: convertToEmu(size.width), height: convertToEmu(size.height) };
}

export function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.slice(0, 2).toUpperCase();
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!first || !last) return name.slice(0, 2).toUpperCase();
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

/** Map the slide-master parts and their layouts. Layout media/hyperlink
 * batches register their kinds before the layout's captured rels are claimed
 * (see buildMasterMap for the matching master-side reservation). */
export function mapMasterAndLayoutParts(
  mapping: XmlifyedFileMapping,
  masters: MasterInfo[],
  descCtx: PptxWriteContext,
  passthroughRelationships: PresentationOptions["passthroughRelationships"],
): void {
  const media = descCtx.mediaCollection;
  const masterRels = masters.map((m) => m.masterRels);
  const allLayouts = masters.flatMap((m) => m.layouts);
  const allLayoutRels = masters.flatMap((m) => m.layoutRels);

  // Slide Masters
  for (const [mi, masterInfo] of masters.entries()) {
    mapping[`SlideMaster${mi}`] = {
      data: XML_DECL + masterInfo.master,
      path: `ppt/slideMasters/slideMaster${mi + 1}.xml`,
    };
    mapping[`SlideMasterRels${mi}`] = {
      data: XML_DECL + masterRels[mi]!.serialize(),
      path: `ppt/slideMasters/_rels/slideMaster${mi + 1}.xml.rels`,
    };
  }

  // Slide Layouts
  for (const [li, layoutInfo] of allLayouts.entries()) {
    const layoutXml = slideLayoutDesc.stringify(layoutInfo.def, descCtx) ?? "";
    // Media referenced by layout shapes gets the same image-relationship
    // wiring slides use (layout pictures otherwise lose their rel).
    const layoutRels = allLayoutRels[li]!;
    const layoutMediaData = getReferencedMedia(layoutXml, media.array);
    // Reserve captured ids whose rels a claim will re-emit before the media
    // batch below snapshots nextRelationshipId. Absorbed kinds (the
    // slideMaster rel, a present themeOverride, images the media batch
    // re-registers) are skipped — reserving them would only open holes.
    reserveClaimedSourceRids(
      layoutRels,
      `ppt/slideLayouts/slideLayout${li + 1}.xml`,
      passthroughRelationships,
      new Set([
        "slideMaster",
        ...(layoutInfo.themeOverride ? ["themeOverride"] : []),
        ...(layoutMediaData.length > 0 ? ["image"] : []),
      ]),
    );
    const layoutImageOffset = layoutRels.nextRelationshipId;
    for (const [idx, mediaItem] of layoutMediaData.entries()) {
      layoutRels.addRelationship(
        layoutImageOffset + idx,
        RELATIONSHIP_TYPES.image,
        `../media/${mediaItem.fileName}`,
      );
    }
    let replacedLayoutXml = replaceImagePlaceholders(layoutXml, layoutMediaData, layoutImageOffset);
    // Linked image sources on layout shapes get the same External wiring.
    const layoutImgLinkKeys = collectPlaceholderKeys(replacedLayoutXml, "img-link:");
    if (layoutImgLinkKeys.length > 0) {
      const layoutImgLinkSet = new Set(layoutImgLinkKeys);
      const layoutImgLinks = descCtx.imageLinks.filter((l) => layoutImgLinkSet.has(l.key));
      const imgLinkOffset = layoutRels.nextRelationshipId;
      replacedLayoutXml = replaceImageLinkPlaceholders(
        replacedLayoutXml,
        layoutImgLinks,
        imgLinkOffset,
      );
      for (const [ili, imgLink] of layoutImgLinks.entries()) {
        layoutRels.addRelationship(
          imgLinkOffset + ili,
          RELATIONSHIP_TYPES.image,
          imgLink.url,
          "External",
        );
      }
    }
    // Linked OLE objects on layout shapes get the same External wiring.
    const layoutOleLinkKeys = collectPlaceholderKeys(replacedLayoutXml, "ole-link:");
    if (layoutOleLinkKeys.length > 0) {
      const layoutOleLinkSet = new Set(layoutOleLinkKeys);
      const layoutOleLinks = descCtx.oleLinks.filter((l) => layoutOleLinkSet.has(l.key));
      const oleLinkOffset = layoutRels.nextRelationshipId;
      replacedLayoutXml = replaceOleLinkPlaceholders(
        replacedLayoutXml,
        layoutOleLinks,
        oleLinkOffset,
      );
      for (const [oli, oleLink] of layoutOleLinks.entries()) {
        layoutRels.addRelationship(
          oleLinkOffset + oli,
          RELATIONSHIP_TYPES.oleObject,
          oleLink.url,
          "External",
        );
      }
    }
    // Hyperlinks on layout shapes/text — same placeholder wiring slides get.
    replacedLayoutXml = wirePartHyperlinks(
      replacedLayoutXml,
      descCtx.hyperlinks,
      layoutRels.nextRelationshipId,
      (id, type, target, mode) => layoutRels.addRelationship(id, type, target, mode),
      "../slides/",
    );
    // Layout-level passthrough relationships (round-trip) — appended after
    // every model registration so the kind ownership test sees them all.
    // claimSourceRel keeps the source ids when free (verbatim layout islands
    // reference them).
    for (const rel of passthroughRelationships ?? []) {
      if (rel.source !== `ppt/slideLayouts/slideLayout${li + 1}.xml`) continue;
      if (layoutRels.hasRelationshipKind(rel.relationshipType.split("/").pop()!)) continue;
      layoutRels.claimSourceRel(rel);
    }
    mapping[`SlideLayout${li}`] = {
      data: XML_DECL + replacedLayoutXml,
      path: `ppt/slideLayouts/slideLayout${li + 1}.xml`,
    };
    mapping[`SlideLayoutRels${li}`] = {
      data: XML_DECL + layoutRels.serialize(),
      path: `ppt/slideLayouts/_rels/slideLayout${li + 1}.xml.rels`,
    };
    if (layoutInfo.themeOverride) {
      mapping[`SlideLayoutThemeOverride${li}`] = {
        data: XML_DECL + layoutInfo.themeOverride,
        path: `ppt/theme/themeOverride${li + 1}.xml`,
      };
    }
  }
}

/** Map the notesMaster and handoutMaster parts. The presentation's captured
 * rel ids are pre-claimed first so the structured notesMaster/handoutMaster
 * additions slot in after them (preserving source rId ordering);
 * claimSourceRel skips entries the model already owns. */
export function mapNotesAndHandoutMasters(
  mapping: XmlifyedFileMapping,
  presRels: Relationships,
  presOptions: PresentationPartOptions,
  options: PresentationOptions,
  slides: readonly SlideOptions[],
  descCtx: PptxWriteContext,
  themesCount: number,
): void {
  for (const rel of options.passthroughRelationships ?? []) {
    if (rel.source !== "ppt/presentation.xml") continue;
    presRels.claimSourceRel(rel);
  }
  // Notes Master — emitted when notes slides exist or the source carried one.
  const includeNotesMasterPart =
    slides.some((s) => Boolean(s.notes)) || options.notesMasterOptions !== undefined;
  if (includeNotesMasterPart) {
    let notesMasterRId: number;
    if (presRels.hasRelationshipKind("notesMaster")) {
      // Already pre-claimed by the source passthrough rel (round-trip).
      notesMasterRId = presRels.idByKind("notesMaster")!;
    } else {
      notesMasterRId = presRels.add(
        RELATIONSHIP_TYPES.notesMaster,
        "notesMasters/notesMaster1.xml",
      );
    }
    presOptions.notesMasterRId = notesMasterRId;
    mapMasterLikePart(
      mapping,
      descCtx,
      "NotesMaster",
      "notesMasters/notesMaster1",
      notesMasterDesc.stringify(options.notesMasterOptions ?? {}, descCtx) ?? "",
      createThemeXml(options.notesMasterOptions?.theme, descCtx),
      themesCount + 1,
    );
  }

  // Handout Master
  if (options.includeHandoutMaster ?? false) {
    let handoutMasterRId: number;
    if (presRels.hasRelationshipKind("handoutMaster")) {
      handoutMasterRId = presRels.idByKind("handoutMaster")!;
    } else {
      handoutMasterRId = presRels.add(
        RELATIONSHIP_TYPES.handoutMaster,
        "handoutMasters/handoutMaster1.xml",
      );
    }
    presOptions.handoutMasterRId = handoutMasterRId;
    mapMasterLikePart(
      mapping,
      descCtx,
      "HandoutMaster",
      "handoutMasters/handoutMaster1",
      handoutMasterDesc.stringify({ options: options.handoutMasterOptions }, descCtx) ?? "",
      createThemeXml(options.handoutMasterOptions?.theme, descCtx),
      themesCount + (includeNotesMasterPart ? 2 : 1),
    );
  }
}

/** Wire one master-like part (notesMaster/handoutMaster): theme part, its rel,
 * slide-style media image wiring, hyperlink placeholders, and the part +
 * rels mapping entries. */
function mapMasterLikePart(
  mapping: XmlifyedFileMapping,
  descCtx: PptxWriteContext,
  key: string,
  partDir: string,
  xml: string,
  themeXml: string,
  themeIndex: number,
): void {
  mapping[`${key}Theme`] = {
    data: XML_DECL + themeXml,
    path: `ppt/theme/theme${themeIndex}.xml`,
  };
  const rels = new Relationships();
  rels.addRelationship(1, RELATIONSHIP_TYPES.theme, `../theme/theme${themeIndex}.xml`);
  // Media referenced by master shapes gets slide-style image wiring.
  const mediaData = getReferencedMedia(xml, descCtx.mediaCollection.array);
  const imageOffset = rels.nextRelationshipId;
  for (const [idx, mediaItem] of mediaData.entries()) {
    rels.addRelationship(
      imageOffset + idx,
      RELATIONSHIP_TYPES.image,
      `../media/${mediaItem.fileName}`,
    );
  }
  let wiredXml = replaceImagePlaceholders(xml, mediaData, imageOffset);
  // Hyperlinks on master shapes/text — same placeholder wiring slides get.
  wiredXml = wirePartHyperlinks(
    wiredXml,
    descCtx.hyperlinks,
    rels.nextRelationshipId,
    (id, type, target, mode) => rels.addRelationship(id, type, target, mode),
    "../slides/",
  );
  mapping[key] = {
    data: XML_DECL + wiredXml,
    path: `ppt/${partDir}.xml`,
  };
  const [partDirName, partBase] = partDir.split("/");
  mapping[`${key}Relationships`] = {
    data: XML_DECL + rels.serialize(),
    path: `ppt/${partDirName}/_rels/${partBase}.xml.rels`,
  };
}
