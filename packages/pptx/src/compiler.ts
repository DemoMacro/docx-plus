/**
 * Descriptor-based PPTX compiler.
 *
 * Produces a valid PPTX ZIP archive using the descriptor pipeline.
 * Accepts pure JSON PresentationOptions — no intermediate class needed.
 *
 * The compile runs in phases owned by the compile/ folder: masters/layouts
 * (compile/masters), the per-slide loop (compile/slides), the package tail
 * (compile/parts), and the relationship wiring scaffolding they share
 * (compile/shared). This module keeps the presentation-level orchestration.
 *
 * @module
 */

import {
  RELATIONSHIP_TYPES,
  addModelBinaries,
  buildRootRelationships,
  compileMapping,
  dropDanglingPassthroughRels,
  finalizeContentTypes,
  getReferencedMedia,
  replaceImagePlaceholders,
} from "@office-open/core";
import type { XmlifyedFile, Zippable } from "@office-open/core";
import {
  appPropertiesDesc,
  buildCorePropertiesXmlString,
  customPropertiesDesc,
} from "@office-open/core";
import { ChartCollection } from "@office-open/core/chart";
import { SmartArtCollection } from "@office-open/core/smartart";
import type { PresentationPartOptions, PresentationSectionGroup } from "@parts/presentation";
import type { PresentationOptions } from "@shared/file";

import {
  buildMasterMap,
  buildSlideRels,
  initPresRels,
  mapMasterAndLayoutParts,
  mapNotesAndHandoutMasters,
  resolveSlideSize,
} from "./compile/masters";
import {
  PPTX_CONTENT_TYPE_RESOLVER,
  PPTX_MEDIA_CONTENT_TYPES,
  compileTailParts,
} from "./compile/parts";
import {
  XML_DECL,
  type XmlifyedFileMapping,
  encoder,
  reserveClaimedSourceRids,
} from "./compile/shared";
import { compileSlideParts } from "./compile/slides";
import { PptxWriteContext } from "./context";
import { presentationDesc } from "./parts/descriptors/presentation";
import { presentationPropertiesDesc } from "./parts/descriptors/presentation-properties";
import { tableStylesDesc } from "./parts/descriptors/table-styles";
import { viewPropsDesc } from "./parts/descriptors/view-properties";

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

  // ── Pure structural computations ──

  const masters = buildMasterMap(
    masterDefs,
    slides,
    sz.width,
    descCtx,
    options.passthroughRelationships,
  );
  // Unique master themes in theme-index order (deduped in buildMasterMap) —
  // notesMaster/handoutMaster themes append after these.
  const uniqueMasterThemes: string[] = [];
  for (const m of masters) uniqueMasterThemes[m.themeIndex] ??= m.theme;
  const themes = uniqueMasterThemes;
  const slideRels = buildSlideRels(masters, slides);

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

  mapMasterAndLayoutParts(mapping, masters, descCtx, options.passthroughRelationships);
  mapNotesAndHandoutMasters(
    mapping,
    presRels,
    presOptions,
    options,
    slides,
    descCtx,
    themes.length,
  );

  // Comment Authors
  if (
    slides.some((s) => s.comments !== undefined && s.comments.length > 0) &&
    !presRels.hasRelationshipKind("commentAuthors")
  ) {
    presRels.add(RELATIONSHIP_TYPES.commentAuthors, "commentAuthors.xml");
  }

  // Structure-owned presentation rels not claimable by passthrough
  // (presProps/viewProps/theme/tableStyles), slotted after the pre-claimed
  // source ids so the source rId ordering is preserved.
  // presentation.xml.rels carries exactly one theme rel (the presentation's
  // default theme) regardless of how many masters or theme parts exist —
  // extra masters reference their themes through their own rels.
  if (!presRels.hasRelationshipKind("presProps")) {
    presRels.add(RELATIONSHIP_TYPES.presProps, "presProps.xml");
  }
  if (!presRels.hasRelationshipKind("viewProps")) {
    presRels.add(RELATIONSHIP_TYPES.viewProps, "viewProps.xml");
  }
  if (!presRels.hasRelationshipKind("theme")) {
    presRels.add(RELATIONSHIP_TYPES.theme, "theme/theme1.xml");
  }
  if (!presRels.hasRelationshipKind("tableStyles")) {
    presRels.add(RELATIONSHIP_TYPES.tableStyles, "tableStyles.xml");
  }

  // Presentation XML
  const presBody = presentationDesc.stringify(presOptions, descCtx);
  const presentationXml = presBody ? XML_DECL + presBody : "";
  const mediaData = getReferencedMedia(presentationXml, media.array);
  const presImageOffset = presRels.nextRelationshipId;
  for (const [idx, mediaItem] of mediaData.entries()) {
    presRels.addRelationship(
      presImageOffset + idx,
      RELATIONSHIP_TYPES.image,
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
  const artifacts = compileSlideParts(
    mapping,
    slides,
    slideRels,
    descCtx,
    charts,
    smartArts,
    options.passthroughRelationships,
  );

  // Compile mapping to Zippable
  const files = compileMapping(mapping, overrides);

  compileTailParts(files, descCtx, charts, smartArts, artifacts, slides.length, options);

  // Media + OLE embedding binaries (ppt/media/*, ppt/embeddings/*)
  addModelBinaries(files, "ppt", media.array, descCtx.embeddings, mediaLevel);

  // Derive [Content_Types].xml from the actual parts written — the file set is
  // the single source of truth, so declarations cannot drift from what is on
  // disk, and sparse/index-based names (slide-keyed comments) are handled
  // naturally because emission follows the files. Raw passthrough parts
  // (handout masters, customXml, unknown extensions, …) copy in first: the
  // compiler output above wins at the same path, so only what the model missed
  // actually passes through.
  files["[Content_Types].xml"] = encoder.encode(
    finalizeContentTypes(
      files,
      {
        resolve: PPTX_CONTENT_TYPE_RESOLVER,
        mediaContentTypes: PPTX_MEDIA_CONTENT_TYPES,
        // Round-trip: the source declaration table is the base; derived entries
        // only fill what surviving source entries leave uncovered or mistyped.
        source: options.contentTypes,
        rawParts: options.rawParts,
      },
      descCtx,
    ),
  );

  // Guard: drop passthrough rels whose target part never made it into the
  // package (hand-authored input) — Office refuses to open dangling rels.
  dropDanglingPassthroughRels(files, options.passthroughRelationships);

  return files;
}
