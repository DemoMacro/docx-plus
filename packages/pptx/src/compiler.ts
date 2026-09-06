/**
 * Descriptor-based PPTX compiler.
 *
 * Produces a valid PPTX ZIP archive using the descriptor pipeline.
 * Accepts pure JSON PresentationOptions — no intermediate class needed.
 *
 * @module
 */

import {
  IMAGE_MEDIA_CONTENT_TYPES,
  Relationships,
  addBinaryFile,
  buildRootRelationships,
  convertToEmu,
  dropDanglingPassthroughRels,
} from "@office-open/core";
import type { RelationshipType } from "@office-open/core";
import {
  appPropertiesDesc,
  buildCorePropertiesXmlString,
  collectPlaceholderKeys,
  compileMapping,
  customPropertiesDesc,
  getReferencedMedia,
  getAudioRefs,
  getMediaRefs,
  getOleRefs,
  getVideoRefs,
  hasPlaceholders,
  replaceAudioPlaceholders,
  replaceChartPlaceholders,
  replacePlaceholders,
  replaceImageLinkPlaceholders,
  replaceImagePlaceholders,
  replaceMediaPlaceholders,
  replaceOleLinkPlaceholders,
  replaceOlePlaceholders,
  replaceSmartArtPlaceholders,
  replaceVideoPlaceholders,
  addSmartArtRelationships,
  contentTypesDesc,
  deriveContentTypes,
  resolverFromRegistry,
  themeOverrideDesc,
  toUint8Array,
  PPTX_PARTS,
} from "@office-open/core";
import type { XmlifyedFile, Zippable } from "@office-open/core";
import { ChartCollection } from "@office-open/core/chart";
import { SmartArtCollection } from "@office-open/core/smartart";
import {
  stringifyColorDefinitionPart,
  stringifyLayoutDefinitionPart,
  stringifyStyleDefinitionPart,
} from "@office-open/core/smartart";
import { escapeXml, OOXML_XML_DECLARATION } from "@office-open/xml";
import type { AuthorEntry, CommentEntry } from "@parts/comment";
import type { PresentationPartOptions, PresentationSectionGroup } from "@parts/presentation";
import { buildCustomLayoutXml, buildLayoutXml, type SlideLayoutType } from "@parts/slide-layout";
import { stringifyControls, stringifyCustDataLst } from "@parts/slide/c-sld";
import type { SlideSyncOptions } from "@parts/slide/slide-sync-properties";
import { getColorXml, getLayoutXml, getStyleXml, DEFAULT_DRAWING_XML } from "@parts/smartart";
import { SP_TREE_HEADER } from "@shared/constants";
import {
  type PresentationOptions,
  type MasterDefinition,
  type LayoutDefinition,
  type SlideOptions,
  type SlideSize,
} from "@shared/file";
import { buildHeaderFooterShapes } from "@shared/header-footer";
import type { MediaData } from "@shared/media/data";
import { createThemeXml } from "@shared/theme";

import { PptxWriteContext, type HyperlinkEntry } from "./context";
import { timingDesc } from "./parts/descriptors/animation";
import { backgroundDesc } from "./parts/descriptors/background";
import { stringifyChild } from "./parts/descriptors/bridge";
import { colorMappingOverrideDesc } from "./parts/descriptors/color-map-override";
import { commentAuthorsDesc, slideCommentsDesc } from "./parts/descriptors/comments";
import { handoutMasterDesc } from "./parts/descriptors/handout-master";
import { notesMasterDesc } from "./parts/descriptors/notes-master";
import { notesSlideDesc, type NotesSlideOptions } from "./parts/descriptors/notes-slide";
import { presentationDesc } from "./parts/descriptors/presentation";
import { presentationPropertiesDesc } from "./parts/descriptors/presentation-properties";
import { stringifyTransition } from "./parts/descriptors/slide";
import { parseLayoutDef, slideLayoutDesc } from "./parts/descriptors/slide-layout";
import { slideMasterDesc } from "./parts/descriptors/slide-master";
import { slideSyncDesc } from "./parts/descriptors/slide-sync";
import { tableStylesDesc } from "./parts/descriptors/table-styles";
import { viewPropsDesc } from "./parts/descriptors/view-properties";

// ── Constants ──

const encoder = new TextEncoder();
const XML_DECL = OOXML_XML_DECLARATION + "\n";

// ── Helper types ──

interface RelEntry {
  id: number | string;
  type: RelationshipType;
  target: string;
  mode?: string;
}

interface LayoutInfo {
  key: string;
  index: number;
  masterIndex: number;
  def: LayoutDefinition;
  /** Serialized themeOverride part XML, when the layout deviates from its master's theme. */
  themeOverride?: string;
}

interface MasterInfo {
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

interface XmlifyedFileMapping {
  [key: string]: { data: string; path: string };
}

// ── Pure helper functions (extracted from File class) ──

/** Rel kinds whose targets are media files the model may rename on absorb. */
const MEDIA_REL_KINDS = new Set(["image", "media", "audio", "video"]);

function buildRels(entries: RelEntry[]): Relationships {
  const rels = new Relationships();
  for (const e of entries) {
    rels.addRelationship(e.id, e.type, e.target, e.mode as "External" | undefined);
  }
  return rels;
}

/**
 * Replace `{hlink:key}` placeholders in a serialized part with real r:ids and
 * wire the matching hyperlink relationships. Every part that can host text
 * (master, layout, notes slide, notesMaster, handoutMaster) routes here —
 * without it, hyperlinks in those parts leak raw placeholders and dangle.
 * `slideTargetPrefix` differs per directory: slides reference each other
 * directly, every other part needs "../slides/". Slide-target relationships
 * dedup by target (a part may carry only one slide rel per target — several
 * hyperlinks jumping to the same slide share one rId).
 */
function wirePartHyperlinks(
  xml: string,
  hyperlinks: HyperlinkEntry[],
  nextId: number,
  add: (id: number, type: RelationshipType, target: string, mode?: "External") => void,
  slideTargetPrefix: string,
  existingIdOf?: (target: string) => number | undefined,
): string {
  const keys = collectPlaceholderKeys(xml, "hlink:");
  if (keys.length === 0) return xml;
  const keySet = new Set(keys);
  const matched = hyperlinks.filter((h) => keySet.has(h.key));
  const SLIDE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
  // Parts that resolve an existing rel (slides, notes) are round-trip owners —
  // each hyperlink keeps its own relationship there even when targets repeat
  // (source files may legally carry several). Fresh parts (master, layout,
  // notesMaster, handoutMaster) dedup by target so the SDK's one-slide-rel-
  // per-target rule holds for generated packages. Resolve pre-existing rels
  // once up front — a live re-query would see rels this helper just added and
  // fold round-trip duplicates into one.
  const dedup = existingIdOf === undefined;
  const preExisting = new Map<string, number>();
  if (existingIdOf) {
    for (const hlink of matched) {
      if (hlink.slide === undefined) continue;
      const target = `${slideTargetPrefix}slide${hlink.slide}.xml`;
      if (!preExisting.has(target)) {
        const id = existingIdOf(target);
        if (id !== undefined) preExisting.set(target, id);
      }
    }
  }
  const idBySlideTarget = new Map<string, number>();
  let cursor = nextId;
  const idByKey = new Map<string, number>();
  for (const hlink of matched) {
    if (hlink.slide === undefined) continue;
    const target = `${slideTargetPrefix}slide${hlink.slide}.xml`;
    let id = preExisting.get(target);
    if (id === undefined) id = dedup ? idBySlideTarget.get(target) : undefined;
    if (id === undefined) {
      id = cursor++;
      if (dedup) idBySlideTarget.set(target, id);
      add(id, SLIDE_REL as RelationshipType, target);
    }
    idByKey.set(hlink.key, id);
  }
  for (const hlink of matched) {
    if (hlink.slide !== undefined) continue;
    const id = cursor++;
    idByKey.set(hlink.key, id);
    add(
      id,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
      hlink.url ?? "",
      "External",
    );
  }
  const replacement = new Map<string, string>();
  for (const [key, id] of idByKey) replacement.set(`hlink:${key}`, `rId${id}`);
  return replacePlaceholders(xml, replacement);
}

function resolveSlideSize(size?: SlideSize): { width: number; height: number } {
  if (!size || size === "16:9") return { width: 12192000, height: 6858000 };
  if (size === "4:3") return { width: 9144000, height: 6858000 };
  return { width: convertToEmu(size.width), height: convertToEmu(size.height) };
}

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.slice(0, 2).toUpperCase();
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!first || !last) return name.slice(0, 2).toUpperCase();
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

function buildMasterMap(
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
          type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster",
          target: `../slideMasters/slideMaster${mi + 1}.xml`,
        },
      ];
      if (themeOverride) {
        layoutRelEntries.push({
          id: 2,
          type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/themeOverride",
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
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout",
        `../slideLayouts/slideLayout${layout.index + 1}.xml`,
      );
    }
    masterRels.add(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
      `../theme/theme${themeIndex + 1}.xml`,
    );
    // Media referenced by master shapes gets the same image-relationship
    // wiring slides/layouts use (master pictures otherwise lose their rel).
    // Registered before the passthrough loop so its kind ownership test sees
    // the model registration and skips the source's stale image rels.
    const masterImageOffset = masterRels.nextRelationshipId;
    for (const [idx, mediaItem] of masterMediaData.entries()) {
      masterRels.addRelationship(
        masterImageOffset + idx,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
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
          "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
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

function buildSlideRels(masters: MasterInfo[], slides: SlideOptions[]): Relationships[] {
  const rels: Relationships[] = [];
  for (let i = 0; i < slides.length; i++) {
    const layout = findLayoutForSlide(masters, slides, i);
    rels.push(
      buildRels([
        {
          id: 1,
          type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout",
          target: `../slideLayouts/slideLayout${layout.index + 1}.xml`,
        },
      ]),
    );
  }
  return rels;
}

/** Promote the slide layout rel to its source id when the source rId is free
 * — verbatim slide content references the source rId and dangling the layout
 * would dangle the rest of the slide's rels. */
function promoteLayoutToSourceId(
  rels: Relationships,
  sourcePassthrough: { rId: string; target: string; relationshipType: string }[] | undefined,
): void {
  if (!sourcePassthrough) return;
  const sourceLayout = sourcePassthrough.find(
    (r) =>
      r.relationshipType ===
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout",
  );
  if (!sourceLayout) return;
  const numeric = /^rId(\d+)$/.exec(sourceLayout.rId);
  if (!numeric) return;
  rels.renameEntryByType(
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout",
    Number(numeric[1]),
  );
}

/** Reserve the captured ids whose rels a claim will re-emit. A captured rel
 * whose kind the model registers for the part (layout, theme, media, …) is
 * absorbed — the claim skips it as owned, so reserving its id only opens a
 * hole the round-trip then reports as drift. Kinds outside `absorbedKinds`
 * have no model counterpart (a chart part carried as a raw island beside a
 * modeled picture, say): their claims keep the source ids verbatim content
 * references, so those ids must stay free above the batch allocations. */
function reserveClaimedSourceRids(
  rels: Relationships,
  source: string,
  passthroughRelationships: PresentationOptions["passthroughRelationships"],
  absorbedKinds: ReadonlySet<string>,
): void {
  for (const rel of passthroughRelationships ?? []) {
    if (rel.source !== source) continue;
    if (absorbedKinds.has(rel.relationshipType.split("/").pop()!)) continue;
    rels.reserveId(rel.rId);
  }
}

export function buildCommentData(
  slides: SlideOptions[],
  existingAuthors: AuthorEntry[] = [],
): {
  authors: AuthorEntry[] | undefined;
  perSlide: (CommentEntry[] | undefined)[];
} {
  const authorMap = new Map<
    string,
    { id: number; name: string; initials: string; clrIdx: number; commentCount: number }
  >();
  let nextAuthorId = 0;
  // Seed from existing authors so appended comments continue author ids and the
  // per-author idx counter (commentCount resumes at lastIdx).
  for (const a of existingAuthors) {
    authorMap.set(a.name, {
      id: a.id,
      name: a.name,
      initials: a.initials,
      clrIdx: a.clrIdx,
      commentCount: a.lastIdx,
    });
    if (a.id >= nextAuthorId) nextAuthorId = a.id + 1;
  }

  const perSlide: (CommentEntry[] | undefined)[] = Array.from({ length: slides.length });

  for (const [i, slide] of slides.entries()) {
    const slideComments = slide.comments;
    if (!slideComments || slideComments.length === 0) continue;

    const commentEntries: CommentEntry[] = [];

    for (const c of slideComments) {
      let author = authorMap.get(c.author);
      if (!author) {
        const id = nextAuthorId++;
        author = {
          id,
          name: c.author,
          initials: c.initials || deriveInitials(c.author),
          clrIdx: id,
          commentCount: 0,
        };
        authorMap.set(c.author, author);
      }
      author.commentCount++;

      commentEntries.push({
        authorId: author.id,
        idx: author.commentCount,
        date: c.date,
        x: convertToEmu(c.x),
        y: convertToEmu(c.y),
        text: c.text,
        modified: c.modified,
      });
    }

    perSlide[i] = commentEntries;
  }

  const authors =
    authorMap.size > 0
      ? Array.from(authorMap.values(), (a) => ({
          id: a.id,
          name: a.name,
          initials: a.initials,
          clrIdx: a.clrIdx,
          lastIdx: a.commentCount,
        }))
      : undefined;

  return { authors, perSlide };
}

/** PPTX part path → content type, derived from the part registry. Matches
 * actual file paths, so dense (slides) and sparse (slide-indexed comments)
 * naming are both handled. */
const PPTX_CONTENT_TYPE_RESOLVER = resolverFromRegistry(PPTX_PARTS);

/** Chart part → user-shapes part relationship (c:userShapes bridge). */
const CHART_USER_SHAPES_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartUserShapes";

/** Extension → MIME for media Default entries (image/video/audio). Declared
 * only for extensions actually present in the package. */
const PPTX_MEDIA_CONTENT_TYPES: Record<string, string> = {
  ...IMAGE_MEDIA_CONTENT_TYPES,
  mp4: "video/mp4",
  mov: "video/quicktime",
  wmv: "video/x-ms-wmv",
  avi: "video/x-msvideo",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  wma: "audio/x-ms-wma",
  aac: "audio/aac",
  bin: "application/vnd.openxmlformats-officedocument.oleObject",
};

function initPresRels(masters: MasterInfo[], slideCount: number): Relationships {
  // Only structure-owned slots are pre-allocated here: slideMaster + slide rels.
  // presProps/viewProps/theme/tableStyles are added at the end of the
  // compiler pass after passthrough id pre-claim, so they slot in *after* the
  // source ids (notesMaster, handoutMaster, …) and the source ordering of
  // presentation.xml.rels survives round-trip.
  const rels = new Relationships();
  for (let mi = 0; mi < masters.length; mi++) {
    rels.addRelationship(
      mi + 1,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster",
      `slideMasters/slideMaster${mi + 1}.xml`,
    );
  }
  for (let i = 0; i < slideCount; i++) {
    rels.addRelationship(
      masters.length + i + 1,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide",
      `slides/slide${i + 1}.xml`,
    );
  }
  return rels;
}

function buildPresAttrOpts(
  options: PresentationOptions,
): Partial<
  Pick<
    PresentationPartOptions,
    | "serverZoom"
    | "firstSlideNum"
    | "showSpecialPlsOnTitleSld"
    | "rtl"
    | "removePersonalInfoOnSave"
    | "compatMode"
    | "strictFirstAndLastChars"
    | "embedTrueTypeFonts"
    | "saveSubsetFonts"
    | "autoCompressPictures"
    | "bookmarkIdSeed"
    | "conformance"
    | "photoAlbum"
    | "modifyVerifier"
    | "embeddedFonts"
    | "customShows"
    | "kinsoku"
    | "customerData"
    | "smartTags"
    | "defaultTextStyle"
  >
> {
  if (
    !options.serverZoom &&
    options.firstSlideNum === undefined &&
    options.showSpecialPlsOnTitleSld === undefined &&
    options.rtl === undefined &&
    options.removePersonalInfoOnSave === undefined &&
    options.compatMode === undefined &&
    options.strictFirstAndLastChars === undefined &&
    options.embedTrueTypeFonts === undefined &&
    options.saveSubsetFonts === undefined &&
    options.autoCompressPictures === undefined &&
    options.bookmarkIdSeed === undefined &&
    options.conformance === undefined &&
    options.photoAlbum === undefined &&
    options.modifyVerifier === undefined &&
    options.embeddedFonts === undefined &&
    options.customShows === undefined &&
    options.kinsoku === undefined &&
    options.customerData === undefined &&
    options.smartTags === undefined &&
    options.defaultTextStyle === undefined
  ) {
    return {};
  }
  return {
    serverZoom: options.serverZoom,
    firstSlideNum: options.firstSlideNum,
    showSpecialPlsOnTitleSld: options.showSpecialPlsOnTitleSld,
    rtl: options.rtl,
    removePersonalInfoOnSave: options.removePersonalInfoOnSave,
    compatMode: options.compatMode,
    strictFirstAndLastChars: options.strictFirstAndLastChars,
    embedTrueTypeFonts: options.embedTrueTypeFonts,
    saveSubsetFonts: options.saveSubsetFonts,
    autoCompressPictures: options.autoCompressPictures,
    bookmarkIdSeed: options.bookmarkIdSeed,
    conformance: options.conformance,
    photoAlbum: options.photoAlbum,
    modifyVerifier: options.modifyVerifier,
    embeddedFonts: options.embeddedFonts,
    customShows: options.customShows,
    kinsoku: options.kinsoku,
    customerData: options.customerData,
    smartTags: options.smartTags,
    defaultTextStyle: options.defaultTextStyle,
  };
}

// ── Slide serializer using descriptors ──

/**
 * Serialize a single slide to its `<p:sld>` XML (no XML declaration — matches
 * the generated slide parts). Exposed so patch can append/replace slides by
 * reusing the full slide vocabulary without re-running the compiler.
 */
export function stringifySlide(slideOpts: SlideOptions, ctx: PptxWriteContext): string {
  const parts: string[] = [];
  ctx.beginShapeScope();

  const sldAttrs: string[] = [];
  if (slideOpts.showMasterShapes === false) sldAttrs.push(' showMasterSp="0"');
  if (slideOpts.showMasterPlaceholderAnimations === false) sldAttrs.push(' showMasterPhAnim="0"');
  if (slideOpts.hidden) sldAttrs.push(' show="0"');
  parts.push(
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"${sldAttrs.join("")}>`,
  );

  parts.push("<p:cSld>");

  if (slideOpts.background) {
    parts.push(backgroundDesc.stringify(slideOpts.background, ctx) ?? "");
  }

  parts.push("<p:spTree>");
  parts.push(SP_TREE_HEADER);

  if (slideOpts.children) {
    for (const child of slideOpts.children) {
      const xml = stringifyChild(child, ctx);
      if (xml) parts.push(xml);
    }
  }

  // Per-slide header/footer: instantiate the dt/ftr/sldNum placeholder shapes
  // after the children (spTree tail, ids continue the child sequence). A type
  // the children already carry — a round-tripped placeholder shape — is left
  // untouched so re-serialization never duplicates it.
  if (slideOpts.headerFooter) {
    const present = new Set(
      (slideOpts.children ?? []).flatMap((c) =>
        "shape" in c && c.shape?.placeholder ? [c.shape.placeholder] : [],
      ),
    );
    for (const shape of buildHeaderFooterShapes(slideOpts.headerFooter)) {
      if (present.has(shape.placeholder!)) continue;
      const xml = stringifyChild({ shape }, ctx);
      if (xml) parts.push(xml);
    }
  }

  parts.push("</p:spTree>");

  parts.push(stringifyCustDataLst(slideOpts.customerData));
  parts.push(stringifyControls(slideOpts.controls));

  // cSld-tail extLst (p14:creationId's home) — verbatim, before the cSld close
  // and distinct from the root-level extLst emitted after timing.
  if (slideOpts.cSldExt) {
    parts.push(`<p:extLst>${slideOpts.cSldExt}</p:extLst>`);
  }

  parts.push("</p:cSld>");
  // Optional per CT_Slide — undefined (a source without one) omits it.
  parts.push(colorMappingOverrideDesc.stringify(slideOpts.colorMappingOverride, ctx) ?? "");

  if (slideOpts.transition) {
    parts.push(stringifyTransition(slideOpts.transition, ctx));
  }

  if (slideOpts.animations && slideOpts.animations.length > 0) {
    parts.push(timingDesc.stringify(slideOpts.animations, ctx) ?? "");
  }

  // p:extLst — verbatim round-trip (last child per CT_Slide sequence)
  if (slideOpts.ext) {
    parts.push(`<p:extLst>${slideOpts.ext}</p:extLst>`);
  }

  parts.push("</p:sld>");
  return parts.join("");
}

// ── Main compiler entry ──

export function compilePresentation(
  options: PresentationOptions,
  overrides: XmlifyedFile[] = [],
  mediaLevel: number = 0,
): Zippable {
  const descCtx = new PptxWriteContext();
  const slides = options.slides ?? [];
  const masterDefs = options.masters ?? [];
  const sz = resolveSlideSize(options.size);
  const includeHandout = options.includeHandoutMaster ?? false;

  // ── Pure structural computations ──

  const masters = buildMasterMap(
    masterDefs,
    slides,
    sz.width,
    descCtx,
    options.passthroughRelationships,
  );
  const allLayouts = masters.flatMap((m) => m.layouts);
  const allLayoutRels = masters.flatMap((m) => m.layoutRels);
  // Unique master themes in theme-index order (deduped in buildMasterMap) —
  // notesMaster/handoutMaster themes append after these.
  const uniqueMasterThemes: string[] = [];
  for (const m of masters) uniqueMasterThemes[m.themeIndex] ??= m.theme;
  const themes = uniqueMasterThemes;
  const masterRels = masters.map((m) => m.masterRels);
  const slideRels = buildSlideRels(masters, slides);
  const { authors: commentAuthorEntries, perSlide: slideCommentEntries } = buildCommentData(slides);

  const notesOptions: NotesSlideOptions[] = [];
  const notesSlideIndexMap = new Map<number, number>();
  let notesIdx = 0;
  for (const [i, slide] of slides.entries()) {
    if (slide.notes) {
      notesOptions.push(typeof slide.notes === "string" ? { text: slide.notes } : slide.notes);
      notesSlideIndexMap.set(i, notesIdx++);
    }
  }

  const slideSyncOptionsList: SlideSyncOptions[] = [];
  const slideSyncIndexMap = new Map<number, number>();
  let syncIdx = 0;
  for (const [i, slide] of slides.entries()) {
    if (slide.slideSync) {
      slideSyncOptionsList.push(slide.slideSync);
      slideSyncIndexMap.set(i, syncIdx++);
    }
  }

  // ── Mutable state ──

  // Presence-based: a parsed empty docProps/custom.xml round-trips as an
  // empty part (undefined = fresh document, omit the part).
  const hasCustomProperties = options.customProperties !== undefined;
  const presRels = initPresRels(masters, slides.length);
  // Reserve the presentation's captured ids whose rels a claim will re-emit —
  // after the structured slide/master slots above (their r:ids are written
  // verbatim into sldMasterIdLst/sldIdLst and take precedence), but before
  // the claim loop, so anything allocated on the way there lands above those
  // ids. Kinds the compiler always re-emits (slides, masters, the property
  // parts) are absorbed and skipped: reserving them would only open holes.
  reserveClaimedSourceRids(
    presRels,
    "ppt/presentation.xml",
    options.passthroughRelationships,
    new Set([
      "slide",
      "slideMaster",
      "theme",
      "presProps",
      "viewProps",
      "tableStyles",
      "notesMaster",
      "handoutMaster",
    ]),
  );
  // Group slides into p14:sections by name (first-occurrence order); slides
  // without a section name are left ungrouped (absent from p14:sectionLst).
  const sectionOrder: string[] = [];
  const sectionIndices = new Map<string, number[]>();
  for (const [i, slide] of slides.entries()) {
    const name = slide.section;
    if (!name) continue;
    let arr = sectionIndices.get(name);
    if (!arr) {
      arr = [];
      sectionIndices.set(name, arr);
      sectionOrder.push(name);
    }
    arr.push(i);
  }
  const sections: PresentationSectionGroup[] = sectionOrder.map((name) => ({
    name,
    slideIndices: sectionIndices.get(name)!,
  }));

  const presOptions: PresentationPartOptions = {
    slideWidth: sz.width,
    slideHeight: sz.height,
    slideIds: slides.map((_, i) => 256 + i),
    masterCount: masters.length,
    sections,
    ...buildPresAttrOpts(options),
    ...(options.ext !== undefined ? { ext: options.ext } : {}),
  };
  const fileRels = buildRootRelationships(
    "ppt/presentation.xml",
    hasCustomProperties,
    options.passthroughRelationships,
  );
  const media = descCtx.mediaCollection;
  const charts = new ChartCollection();
  const smartArts = new SmartArtCollection();

  const presPropsFullOpts =
    options.web ||
    options.print ||
    options.htmlPublish ||
    options.colorMru ||
    options.show ||
    options.presentationPropertiesExt
      ? {
          web: options.web,
          print: options.print,
          htmlPublish: options.htmlPublish,
          colorMru: options.colorMru,
          show: options.show,
          ext: options.presentationPropertiesExt,
        }
      : undefined;

  const hasOutlineViewSlides =
    !!options.view?.outlineView?.slides && options.view.outlineView.slides.length > 0;
  const htmlPublishInfo = presPropsFullOpts?.htmlPublish?.rId
    ? { rId: presPropsFullOpts.htmlPublish.rId, target: presPropsFullOpts.htmlPublish.target }
    : undefined;

  // ── Build XML file mapping ──

  const mapping: XmlifyedFileMapping = {
    AppProperties: {
      data: XML_DECL + (appPropertiesDesc.stringify(options.appProperties ?? {}, descCtx) ?? ""),
      path: "docProps/app.xml",
    },
    Properties: {
      data: XML_DECL + buildCorePropertiesXmlString(options),
      path: "docProps/core.xml",
    },
    ...(hasCustomProperties
      ? {
          CustomProperties: {
            data:
              XML_DECL +
              (customPropertiesDesc.stringify(
                { properties: options.customProperties ?? [] },
                descCtx,
              ) ?? ""),
            path: "docProps/custom.xml",
          },
        }
      : {}),
    FileRelationships: {
      data: XML_DECL + fileRels.serialize(),
      path: "_rels/.rels",
    },
  };

  for (let ti = 0; ti < themes.length; ti++) {
    mapping[`Theme${ti}`] = {
      data: XML_DECL + themes[ti],
      path: `ppt/theme/theme${ti + 1}.xml`,
    };
  }

  mapping["TableStyles"] = {
    data: XML_DECL + (tableStylesDesc.stringify({ opts: options.tableStyles }, descCtx) ?? ""),
    path: "ppt/tableStyles.xml",
  };

  mapping["PresProps"] = {
    data: XML_DECL + (presentationPropertiesDesc.stringify(presPropsFullOpts ?? {}, descCtx) ?? ""),
    path: "ppt/presProps.xml",
  };

  mapping["ViewProps"] = {
    data: XML_DECL + (viewPropsDesc.stringify(options.view ?? {}, descCtx) ?? ""),
    path: "ppt/viewProps.xml",
  };

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
      options.passthroughRelationships,
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
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
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
          "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
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
          "http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject",
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
    for (const rel of options.passthroughRelationships ?? []) {
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

  // Notes Master — emitted when notes slides exist or the source carried one.
  // Pre-claim the source passthrough rel ids first so the structured
  // notesMaster/handoutMaster additions slot in after them (preserving
  // source rId ordering); claimSourceRel skips entries the model already owns.
  for (const rel of options.passthroughRelationships ?? []) {
    if (rel.source !== "ppt/presentation.xml") continue;
    presRels.claimSourceRel(rel);
  }
  const includeNotesMasterPart =
    notesOptions.length > 0 || options.notesMasterOptions !== undefined;
  if (includeNotesMasterPart) {
    let notesMasterRId: number;
    if (presRels.hasRelationshipKind("notesMaster")) {
      // Already pre-claimed by the source passthrough rel (round-trip).
      notesMasterRId = presRels.idByKind("notesMaster")!;
    } else {
      notesMasterRId = presRels.add(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster",
        "notesMasters/notesMaster1.xml",
      );
    }
    presOptions.notesMasterRId = notesMasterRId;
    const notesMasterThemeIndex = themes.length + 1;
    let notesMasterXml = notesMasterDesc.stringify(options.notesMasterOptions ?? {}, descCtx) ?? "";
    const notesMasterThemeXml = createThemeXml(options.notesMasterOptions?.theme, descCtx);
    mapping["NotesMasterTheme"] = {
      data: XML_DECL + notesMasterThemeXml,
      path: `ppt/theme/theme${notesMasterThemeIndex}.xml`,
    };
    const notesMasterRels = new Relationships();
    notesMasterRels.addRelationship(
      1,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
      `../theme/theme${notesMasterThemeIndex}.xml`,
    );
    // Media referenced by notes-master shapes gets slide-style image wiring.
    const notesMasterMediaData = getReferencedMedia(notesMasterXml, media.array);
    const notesMasterImageOffset = notesMasterRels.nextRelationshipId;
    for (const [idx, mediaItem] of notesMasterMediaData.entries()) {
      notesMasterRels.addRelationship(
        notesMasterImageOffset + idx,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
        `../media/${mediaItem.fileName}`,
      );
    }
    notesMasterXml = replaceImagePlaceholders(
      notesMasterXml,
      notesMasterMediaData,
      notesMasterImageOffset,
    );
    // Hyperlinks on notes-master shapes/text — same placeholder wiring slides get.
    notesMasterXml = wirePartHyperlinks(
      notesMasterXml,
      descCtx.hyperlinks,
      notesMasterRels.nextRelationshipId,
      (id, type, target, mode) => notesMasterRels.addRelationship(id, type, target, mode),
      "../slides/",
    );
    mapping["NotesMaster"] = {
      data: XML_DECL + notesMasterXml,
      path: "ppt/notesMasters/notesMaster1.xml",
    };
    mapping["NotesMasterRelationships"] = {
      data: XML_DECL + notesMasterRels.serialize(),
      path: "ppt/notesMasters/_rels/notesMaster1.xml.rels",
    };
  }

  // Handout Master
  if (includeHandout) {
    let handoutMasterRId: number;
    if (presRels.hasRelationshipKind("handoutMaster")) {
      handoutMasterRId = presRels.idByKind("handoutMaster")!;
    } else {
      handoutMasterRId = presRels.add(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/handoutMaster",
        "handoutMasters/handoutMaster1.xml",
      );
    }
    presOptions.handoutMasterRId = handoutMasterRId;
    const handoutMasterThemeIndex = themes.length + (includeNotesMasterPart ? 2 : 1);
    const handoutMasterXml =
      handoutMasterDesc.stringify({ options: options.handoutMasterOptions }, descCtx) ?? "";
    const handoutMasterThemeXml = createThemeXml(options.handoutMasterOptions?.theme, descCtx);
    mapping["HandoutMasterTheme"] = {
      data: XML_DECL + handoutMasterThemeXml,
      path: `ppt/theme/theme${handoutMasterThemeIndex}.xml`,
    };
    const handoutMasterRels = new Relationships();
    handoutMasterRels.addRelationship(
      1,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
      `../theme/theme${handoutMasterThemeIndex}.xml`,
    );
    // Media referenced by handout-master shapes gets slide-style image wiring.
    const handoutMediaData = getReferencedMedia(handoutMasterXml, media.array);
    const handoutImageOffset = handoutMasterRels.nextRelationshipId;
    for (const [idx, mediaItem] of handoutMediaData.entries()) {
      handoutMasterRels.addRelationship(
        handoutImageOffset + idx,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
        `../media/${mediaItem.fileName}`,
      );
    }
    let handoutXml = replaceImagePlaceholders(
      handoutMasterXml,
      handoutMediaData,
      handoutImageOffset,
    );
    // Hyperlinks on handout-master shapes/text — same placeholder wiring
    // slides get.
    handoutXml = wirePartHyperlinks(
      handoutXml,
      descCtx.hyperlinks,
      handoutMasterRels.nextRelationshipId,
      (id, type, target, mode) => handoutMasterRels.addRelationship(id, type, target, mode),
      "../slides/",
    );
    mapping["HandoutMaster"] = {
      data: XML_DECL + handoutXml,
      path: "ppt/handoutMasters/handoutMaster1.xml",
    };
    mapping["HandoutMasterRelationships"] = {
      data: XML_DECL + handoutMasterRels.serialize(),
      path: "ppt/handoutMasters/_rels/handoutMaster1.xml.rels",
    };
  }

  // Comment Authors
  if (commentAuthorEntries && !presRels.hasRelationshipKind("commentAuthors")) {
    presRels.add(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors",
      "commentAuthors.xml",
    );
  }

  // Structure-owned presentation rels not claimable by passthrough
  // (presProps/viewProps/theme/tableStyles), slotted after the pre-claimed
  // source ids so the source rId ordering is preserved.
  // presentation.xml.rels carries exactly one theme rel (the presentation's
  // default theme) regardless of how many masters or theme parts exist —
  // extra masters reference their themes through their own rels.
  if (!presRels.hasRelationshipKind("presProps")) {
    presRels.add(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps",
      "presProps.xml",
    );
  }
  if (!presRels.hasRelationshipKind("viewProps")) {
    presRels.add(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps",
      "viewProps.xml",
    );
  }
  if (!presRels.hasRelationshipKind("theme")) {
    presRels.add(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
      "theme/theme1.xml",
    );
  }
  if (!presRels.hasRelationshipKind("tableStyles")) {
    presRels.add(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles",
      "tableStyles.xml",
    );
  }

  // Presentation XML
  const presBody = presentationDesc.stringify(presOptions, descCtx);
  const presentationXml = presBody ? XML_DECL + presBody : "";
  const mediaData = getReferencedMedia(presentationXml, media.array);
  const presImageOffset = presRels.nextRelationshipId;
  for (const [idx, mediaItem] of mediaData.entries()) {
    presRels.addRelationship(
      presImageOffset + idx,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
      `../media/${mediaItem.fileName}`,
    );
  }
  const replacedPresentationXml = replaceImagePlaceholders(
    presentationXml,
    mediaData,
    presImageOffset,
  );

  mapping["Presentation"] = {
    data: replacedPresentationXml,
    path: "ppt/presentation.xml",
  };
  mapping["PresentationRelationships"] = {
    data: XML_DECL + presRels.serialize(),
    path: "ppt/_rels/presentation.xml.rels",
  };

  // Slides
  // Group passthrough rels by source part once — the per-slide loop below
  // looks its own slice up instead of re-filtering the full list each time.
  const slidePassthroughBySource = new Map<string, typeof options.passthroughRelationships>();
  for (const rel of options.passthroughRelationships ?? []) {
    const group = slidePassthroughBySource.get(rel.source);
    if (group) group.push(rel);
    else slidePassthroughBySource.set(rel.source, [rel]);
  }
  for (const [i, slide] of slides.entries()) {
    const slideXml = stringifySlide(slide, descCtx);

    const slideMediaData = getReferencedMedia(slideXml, media.array);
    const currentSlideRels = slideRels[i];
    if (!currentSlideRels) continue; // slideRels is built one-per-slide in lockstep with slides
    // Reserve the slide's captured ids whose rels a claim will re-emit — the
    // media/chart/… batches below snapshot nextRelationshipId, and a batch
    // landing on such an id would force the claim loop at the end to
    // renumber a verbatim reference into a dangle. Kinds the batches register
    // (layout, images, charts, media, notes, …) are absorbed by the model —
    // the claim skips them as owned, so reserving their ids would only open
    // holes the round-trip then reports as drift.
    const slideAbsorbedKinds = new Set<string>(["slideLayout"]);
    if (slideMediaData.length > 0 || collectPlaceholderKeys(slideXml, "img-link:").length > 0)
      slideAbsorbedKinds.add("image");
    if (collectPlaceholderKeys(slideXml, "chart:").length > 0) slideAbsorbedKinds.add("chart");
    if (collectPlaceholderKeys(slideXml, "smartart:").length > 0) {
      slideAbsorbedKinds.add("diagramData");
      slideAbsorbedKinds.add("diagramColors");
      slideAbsorbedKinds.add("diagramQuickStyle");
    }
    if (getMediaRefs(slideXml, media.array).length > 0) slideAbsorbedKinds.add("media");
    if (getAudioRefs(slideXml, media.array).length > 0) slideAbsorbedKinds.add("audio");
    if (getVideoRefs(slideXml, media.array).length > 0) slideAbsorbedKinds.add("video");
    if (
      getOleRefs(slideXml, descCtx.embeddings).length > 0 ||
      collectPlaceholderKeys(slideXml, "ole-link:").length > 0
    )
      slideAbsorbedKinds.add("oleObject");
    if (collectPlaceholderKeys(slideXml, "hlink:").length > 0) slideAbsorbedKinds.add("hyperlink");
    if (slide.notes) slideAbsorbedKinds.add("notesSlide");
    if (slide.comments) slideAbsorbedKinds.add("comments");
    reserveClaimedSourceRids(
      currentSlideRels,
      `ppt/slides/slide${i + 1}.xml`,
      options.passthroughRelationships,
      slideAbsorbedKinds,
    );
    // Promote the slide layout rel to its source id up front — the model's
    // layout registration is rId1 by construction and the source id is free
    // below it, so the rename never collides.
    promoteLayoutToSourceId(
      currentSlideRels,
      slidePassthroughBySource.get(`ppt/slides/slide${i + 1}.xml`),
    );
    const slideImageOffset = currentSlideRels.nextRelationshipId;
    for (const [idx, mediaItem] of slideMediaData.entries()) {
      currentSlideRels.addRelationship(
        slideImageOffset + idx,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
        `../media/${mediaItem.fileName}`,
      );
    }

    let replacedSlideXml = replaceImagePlaceholders(slideXml, slideMediaData, slideImageOffset);

    if (hasPlaceholders(replacedSlideXml)) {
      // Chart
      const slideChartKeys = collectPlaceholderKeys(replacedSlideXml, "chart:");
      if (slideChartKeys.length > 0) {
        const slideChartOffset = currentSlideRels.nextRelationshipId;
        const slideChartKeySet = new Set(slideChartKeys);
        const xmlCompCharts = charts.array.filter((c) => slideChartKeySet.has(c.key));
        const descCharts = descCtx.charts.filter((c) => slideChartKeySet.has(c.key));
        const allChartKeys = [...xmlCompCharts.map((c) => c.key), ...descCharts.map((c) => c.key)];
        replacedSlideXml = replaceChartPlaceholders(
          replacedSlideXml,
          allChartKeys,
          slideChartOffset,
        );
        for (const [ci, chartKey] of allChartKeys.entries()) {
          currentSlideRels.addRelationship(
            slideChartOffset + ci,
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
            `../charts/chart${getChartGlobalIndex(chartKey, charts.array, descCtx.charts) + 1}.xml`,
          );
        }
      }

      // SmartArt
      const slideSmartArtKeys = collectPlaceholderKeys(replacedSlideXml, "smartart:");
      if (slideSmartArtKeys.length > 0) {
        const slideSmartArtKeySet = new Set(slideSmartArtKeys);
        const xmlCompSmartArts = smartArts.array.filter((s) => slideSmartArtKeySet.has(s.key));
        const descSmartArts = descCtx.smartArts.filter((s) => slideSmartArtKeySet.has(s.key));
        const allSaKeys = [
          ...xmlCompSmartArts.map((s) => s.key),
          ...descSmartArts.map((s) => s.key),
        ];
        const saOffset = currentSlideRels.nextRelationshipId;
        replacedSlideXml = replaceSmartArtPlaceholders(replacedSlideXml, allSaKeys, saOffset);
        const firstSaKey = allSaKeys[0];
        if (firstSaKey !== undefined) {
          const saGlobalStart = computeSmartArtGlobalStart(
            firstSaKey,
            smartArts.array,
            descCtx.smartArts,
          );
          addSmartArtRelationships(
            allSaKeys,
            (id, type, target) => {
              currentSlideRels.addRelationship(id, type, target);
            },
            saOffset,
            saGlobalStart,
            {
              pathPrefix: "../",
              styleRelType:
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramQuickStyle",
            },
          );
        }
      }

      // Hyperlinks
      // Hyperlinks — slides reference each other directly (no ../slides/).
      replacedSlideXml = wirePartHyperlinks(
        replacedSlideXml,
        descCtx.hyperlinks,
        currentSlideRels.nextRelationshipId,
        (id, type, target, mode) => currentSlideRels.addRelationship(id, type, target, mode),
        "",
        (target) => {
          const rid = currentSlideRels.idOf("slide", target);
          return rid === undefined ? undefined : Number(rid.slice(3));
        },
      );

      // Linked image sources (a:blip @r:link) — one External image relationship
      // per referenced URL.
      const slideImgLinkKeys = collectPlaceholderKeys(replacedSlideXml, "img-link:");
      if (slideImgLinkKeys.length > 0) {
        const slideImgLinkSet = new Set(slideImgLinkKeys);
        const slideImgLinks = descCtx.imageLinks.filter((l) => slideImgLinkSet.has(l.key));
        const imgLinkOffset = currentSlideRels.nextRelationshipId;
        replacedSlideXml = replaceImageLinkPlaceholders(
          replacedSlideXml,
          slideImgLinks,
          imgLinkOffset,
        );
        for (const [li, imgLink] of slideImgLinks.entries()) {
          currentSlideRels.addRelationship(
            imgLinkOffset + li,
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
            imgLink.url,
            "External",
          );
        }
      }

      // Linked OLE objects (p:oleObj @r:id with p:link) — one External
      // oleObject relationship per referenced URL.
      const slideOleLinkKeys = collectPlaceholderKeys(replacedSlideXml, "ole-link:");
      if (slideOleLinkKeys.length > 0) {
        const slideOleLinkSet = new Set(slideOleLinkKeys);
        const slideOleLinks = descCtx.oleLinks.filter((l) => slideOleLinkSet.has(l.key));
        const oleLinkOffset = currentSlideRels.nextRelationshipId;
        replacedSlideXml = replaceOleLinkPlaceholders(
          replacedSlideXml,
          slideOleLinks,
          oleLinkOffset,
        );
        for (const [oli, oleLink] of slideOleLinks.entries()) {
          currentSlideRels.addRelationship(
            oleLinkOffset + oli,
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject",
            oleLink.url,
            "External",
          );
        }
      }

      // Media (video/audio)
      const slideMediaRefs = getMediaRefs(replacedSlideXml, media.array);
      const slideAudioRefs = getAudioRefs(replacedSlideXml, media.array);
      const slideVideoRefs = getVideoRefs(replacedSlideXml, media.array);
      if (slideMediaRefs.length > 0 || slideAudioRefs.length > 0 || slideVideoRefs.length > 0) {
        const mediaOffset = currentSlideRels.nextRelationshipId;
        const audioOffset = mediaOffset + slideMediaRefs.length;
        const videoOffset = audioOffset + slideAudioRefs.length;
        replacedSlideXml = replaceMediaPlaceholders(replacedSlideXml, slideMediaRefs, mediaOffset);
        replacedSlideXml = replaceAudioPlaceholders(replacedSlideXml, slideAudioRefs, audioOffset);
        replacedSlideXml = replaceVideoPlaceholders(replacedSlideXml, slideVideoRefs, videoOffset);
        for (const [mi, mediaRef] of slideMediaRefs.entries()) {
          currentSlideRels.addRelationship(
            mediaOffset + mi,
            "http://schemas.microsoft.com/office/2007/relationships/media",
            `../media/${mediaRef.fileName}`,
          );
        }
        for (const [ai, audioRef] of slideAudioRefs.entries()) {
          currentSlideRels.addRelationship(
            audioOffset + ai,
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio",
            `../media/${audioRef.fileName}`,
          );
        }
        for (const [vi, videoRef] of slideVideoRefs.entries()) {
          currentSlideRels.addRelationship(
            videoOffset + vi,
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/video",
            `../media/${videoRef.fileName}`,
          );
        }
      }

      // OLE embeddings
      const slideOleRefs = getOleRefs(replacedSlideXml, descCtx.embeddings);
      if (slideOleRefs.length > 0) {
        const oleOffset = currentSlideRels.nextRelationshipId;
        replacedSlideXml = replaceOlePlaceholders(replacedSlideXml, slideOleRefs, oleOffset);
        for (const [oi, oleRef] of slideOleRefs.entries()) {
          currentSlideRels.addRelationship(
            oleOffset + oi,
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject",
            `../embeddings/${oleRef.fileName}`,
          );
        }
      }
    }

    mapping[`Slide${i}`] = {
      data: replacedSlideXml,
      path: `ppt/slides/slide${i + 1}.xml`,
    };

    if (
      slideCommentEntries[i] &&
      !currentSlideRels.hasRelationshipKind("comments") &&
      !currentSlideRels.hasRelationship(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
        `../comments/comment${i + 1}.xml`,
      )
    ) {
      currentSlideRels.add(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
        `../comments/comment${i + 1}.xml`,
      );
    }

    const notesSlideIndex = notesSlideIndexMap.get(i);
    if (
      notesSlideIndex !== undefined &&
      !currentSlideRels.hasRelationshipKind("notesSlide") &&
      !currentSlideRels.hasRelationship(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide",
        `../notesSlides/notesSlide${notesSlideIndex + 1}.xml`,
      )
    ) {
      currentSlideRels.add(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide",
        `../notesSlides/notesSlide${notesSlideIndex + 1}.xml`,
      );
    }

    const slideSyncIndex = slideSyncIndexMap.get(i);
    if (slideSyncIndex !== undefined) {
      currentSlideRels.add(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideSyncProperties",
        `../slideSyncPr/slideSyncPr${slideSyncIndex + 1}.xml`,
      );
    }

    // Slide-level passthrough relationships, appended after every model
    // registration so the ownership test sees them all. claimSourceRel keeps
    // the source id when its slot is free — verbatim slide islands reference
    // the source rIds and renumbering would dangle them. Media-targeted rels
    // whose kind the model already owns mean the source rel was absorbed
    // under a renamed target — skip on kind alone or the stale target would
    // re-emit dangling.
    for (const rel of options.passthroughRelationships ?? []) {
      if (rel.source !== `ppt/slides/slide${i + 1}.xml`) continue;
      const kind = rel.relationshipType.split("/").pop()!;
      if (MEDIA_REL_KINDS.has(kind) && currentSlideRels.hasRelationshipKind(kind)) continue;
      currentSlideRels.claimSourceRel(rel);
    }

    mapping[`SlideRelationships${i}`] = {
      data: XML_DECL + currentSlideRels.serialize(),
      path: `ppt/slides/_rels/slide${i + 1}.xml.rels`,
    };
  }

  // Compile mapping to Zippable
  const files = compileMapping(mapping, overrides);

  // Chart parts
  const allCharts = [
    ...charts.array.map((c) => ({
      key: c.key,
      xml: XML_DECL + c.chartSpaceXml,
      userShapes: c.userShapes,
    })),
    ...descCtx.charts.map((c) => ({
      key: c.key,
      xml: c.chartSpaceXml,
      userShapes: c.userShapes,
    })),
  ];
  for (const [i, chart] of allCharts.entries()) {
    files[`ppt/charts/chart${i + 1}.xml`] = encoder.encode(chart.xml);
    // User-shapes part behind c:userShapes: the chart's own rels entry plus
    // the body part (chartUserShapes relationship, same directory).
    if (chart.userShapes) {
      files[`ppt/charts/userShapes${i + 1}.xml`] = encoder.encode(chart.userShapes.xml);
      files[`ppt/charts/_rels/chart${i + 1}.xml.rels`] = encoder.encode(
        XML_DECL +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="${escapeXml(chart.userShapes.relationshipId)}" Type="${CHART_USER_SHAPES_REL}" Target="userShapes${i + 1}.xml"/>` +
          `</Relationships>`,
      );
    }
  }

  // SmartArt parts
  const allSmartArts = [
    ...smartArts.array.map((s) => ({
      key: s.key,
      dataModelXml: XML_DECL + s.dataModelXml,
      layout: s.layout,
      style: s.style,
      color: s.color,
    })),
    ...descCtx.smartArts.map((s) => ({
      key: s.key,
      dataModelXml: s.dataModelXml,
      layout: s.layout,
      style: s.style,
      color: s.color,
    })),
  ];
  for (const [i, sa] of allSmartArts.entries()) {
    files[`ppt/diagrams/data${i + 1}.xml`] = encoder.encode(sa.dataModelXml);
    files[`ppt/diagrams/layout${i + 1}.xml`] = encoder.encode(
      typeof sa.layout === "string"
        ? getLayoutXml(sa.layout)
        : stringifyLayoutDefinitionPart(sa.layout),
    );
    files[`ppt/diagrams/quickStyle${i + 1}.xml`] = encoder.encode(
      typeof sa.style === "string" ? getStyleXml(sa.style) : stringifyStyleDefinitionPart(sa.style),
    );
    files[`ppt/diagrams/colors${i + 1}.xml`] = encoder.encode(
      typeof sa.color === "string" ? getColorXml(sa.color) : stringifyColorDefinitionPart(sa.color),
    );
    files[`ppt/diagrams/drawing${i + 1}.xml`] = encoder.encode(DEFAULT_DRAWING_XML);
  }

  // ViewProps relationships
  if (hasOutlineViewSlides) {
    const vpRels = new Relationships();
    for (let i = 0; i < slides.length; i++) {
      vpRels.addRelationship(
        i + 1,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide",
        `slides/slide${i + 1}.xml`,
      );
    }
    files["ppt/_rels/viewProps.xml.rels"] = encoder.encode(XML_DECL + vpRels.serialize());
  }

  // PresProps relationships
  if (htmlPublishInfo) {
    const presPropsRels = new Relationships();
    presPropsRels.addRelationship(
      htmlPublishInfo.rId,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
      htmlPublishInfo.target ?? "presentation.htm",
      "External",
    );
    files["ppt/_rels/presProps.xml.rels"] = encoder.encode(XML_DECL + presPropsRels.serialize());
  }

  // Notes slides
  const notesSlideToSlide = new Map<number, number>();
  for (const [slideIdx, notesIdx] of notesSlideIndexMap) {
    notesSlideToSlide.set(notesIdx, slideIdx);
  }
  for (let i = 0; i < notesOptions.length; i++) {
    const slideIdx = notesSlideToSlide.get(i) ?? 0;
    const nsRels = new Relationships();
    nsRels.addRelationship(
      1,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster",
      "../notesMasters/notesMaster1.xml",
    );
    nsRels.addRelationship(
      2,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide",
      `../slides/slide${slideIdx + 1}.xml`,
    );
    // Media referenced by notes shapes gets slide-style image wiring (notes
    // accept pictures just like slides do).
    const notesRaw = notesSlideDesc.stringify(notesOptions[i]!, descCtx) ?? "";
    const notesMediaData = getReferencedMedia(notesRaw, media.array);
    const notesImageOffset = nsRels.nextRelationshipId;
    for (const [idx, mediaItem] of notesMediaData.entries()) {
      nsRels.addRelationship(
        notesImageOffset + idx,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
        `../media/${mediaItem.fileName}`,
      );
    }
    let notesXml = replaceImagePlaceholders(notesRaw, notesMediaData, notesImageOffset);
    // Hyperlinks in notes text get the same placeholder wiring slides get
    // (a jump to the host slide reuses its existing slide rel).
    notesXml = wirePartHyperlinks(
      notesXml,
      descCtx.hyperlinks,
      nsRels.nextRelationshipId,
      (id, type, target, mode) => nsRels.addRelationship(id, type, target, mode),
      "../slides/",
      (target) => {
        const rid = nsRels.idOf("slide", target);
        return rid === undefined ? undefined : Number(rid.slice(3));
      },
    );
    files[`ppt/notesSlides/notesSlide${i + 1}.xml`] = encoder.encode(XML_DECL + notesXml);
    files[`ppt/notesSlides/_rels/notesSlide${i + 1}.xml.rels`] = encoder.encode(
      XML_DECL + nsRels.serialize(),
    );
  }

  // Slide sync properties
  for (const [i, syncOpts] of slideSyncOptionsList.entries()) {
    files[`ppt/slideSyncPr/slideSyncPr${i + 1}.xml`] = encoder.encode(
      XML_DECL + (slideSyncDesc.stringify(syncOpts, descCtx) ?? ""),
    );
  }

  // Comment authors
  if (commentAuthorEntries) {
    files["ppt/commentAuthors.xml"] = encoder.encode(
      XML_DECL + (commentAuthorsDesc.stringify(commentAuthorEntries, descCtx) ?? ""),
    );
  }

  // Slide comments
  for (let i = 0; i < slideCommentEntries.length; i++) {
    if (slideCommentEntries[i]) {
      files[`ppt/comments/comment${i + 1}.xml`] = encoder.encode(
        XML_DECL + (slideCommentsDesc.stringify(slideCommentEntries[i]!, descCtx) ?? ""),
      );
    }
  }

  // Media files
  for (const image of media.array) {
    addBinaryFile(files, `ppt/media/${image.fileName}`, image.data, mediaLevel);
    if (image.type === "svg" && "fallback" in image) {
      const fallback = (
        image as MediaData & {
          fallback: { fileName: string; data: Uint8Array };
        }
      ).fallback;
      addBinaryFile(files, `ppt/media/${fallback.fileName}`, fallback.data, mediaLevel);
    }
  }

  // OLE embedding binaries (ppt/embeddings/oleObjectN.bin)
  for (const embedding of descCtx.embeddings) {
    addBinaryFile(files, `ppt/embeddings/${embedding.fileName}`, embedding.data, mediaLevel);
  }

  // Raw passthrough parts (handout masters, customXml, unknown extensions, …).
  // The compiler output above wins over a passthrough copy at the same path —
  // media/charts/notes absorbed into the model are re-emitted under pinned
  // source paths, so only what the model missed actually passes through.
  const passthroughSkipped = new Set<string>();
  for (const part of options.rawParts ?? []) {
    if (files[part.path] !== undefined) {
      passthroughSkipped.add(part.path);
      continue;
    }
    files[part.path] = toUint8Array(part.data);
  }

  // Derive [Content_Types].xml from the actual parts written — the file set is
  // the single source of truth, so declarations cannot drift from what is on
  // disk, and sparse/index-based names (slide-keyed comments) are handled
  // naturally because emission follows the files.
  const contentTypesInput = deriveContentTypes(Object.keys(files), {
    resolve: PPTX_CONTENT_TYPE_RESOLVER,
    mediaContentTypes: PPTX_MEDIA_CONTENT_TYPES,
    // Round-trip: the source declaration table is the base; derived entries
    // only fill what surviving source entries leave uncovered or mistyped.
    source: options.contentTypes,
    verbatimPaths: new Set((options.rawParts ?? []).map((p) => p.path)),
  });
  // Passthrough parts whose extension has no covering Default would leave the
  // package invalid (an undeclared part — Office refuses to open). Only those
  // borrow their source content-type declaration as a per-part Override;
  // extensions already covered (xml/rels/media) stay as derived above.
  const coveredExt = new Set(contentTypesInput.defaults.map((d) => d.extension.toLowerCase()));
  for (const part of options.rawParts ?? []) {
    if (part.contentType === undefined || passthroughSkipped.has(part.path)) continue;
    const dot = part.path.lastIndexOf(".");
    const slash = part.path.lastIndexOf("/");
    const ext = dot > slash ? part.path.slice(dot + 1).toLowerCase() : undefined;
    if (ext && coveredExt.has(ext)) continue;
    contentTypesInput.overrides.push({ partName: `/${part.path}`, contentType: part.contentType });
  }
  files["[Content_Types].xml"] = encoder.encode(
    XML_DECL + (contentTypesDesc.stringify(contentTypesInput, descCtx) ?? ""),
  );

  // Guard: drop passthrough rels whose target part never made it into the
  // package (hand-authored input) — Office refuses to open dangling rels.
  dropDanglingPassthroughRels(files, options.passthroughRelationships);

  return files;
}

function getChartGlobalIndex(
  key: string,
  legacyCharts: { key: string }[],
  descCharts: { key: string }[],
): number {
  const legacyIdx = legacyCharts.findIndex((c) => c.key === key);
  if (legacyIdx >= 0) return legacyIdx;
  return legacyCharts.length + descCharts.findIndex((c) => c.key === key);
}

function computeSmartArtGlobalStart(
  firstKey: string,
  legacySmartArts: { key: string }[],
  descSmartArts: { key: string }[],
): number {
  const legacyIdx = legacySmartArts.findIndex((s) => s.key === firstKey);
  if (legacyIdx >= 0) return legacyIdx;
  return legacySmartArts.length + descSmartArts.findIndex((s) => s.key === firstKey);
}
