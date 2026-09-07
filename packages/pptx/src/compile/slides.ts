/**
 * Slide compile phase: slide serialization (`stringifySlide`), comment data,
 * and the per-slide mapping/relationship batches (media, charts, SmartArt,
 * hyperlinks, OLE, notes, sync, comments).
 *
 * @module
 */

import {
  RELATIONSHIP_TYPES,
  Relationships,
  addSmartArtRelationships,
  collectPlaceholderKeys,
  convertToEmu,
  getAudioRefs,
  getMediaRefs,
  getOleRefs,
  getReferencedMedia,
  getVideoRefs,
  hasPlaceholders,
  replaceAudioPlaceholders,
  replaceChartPlaceholders,
  replaceImageLinkPlaceholders,
  replaceImagePlaceholders,
  replaceMediaPlaceholders,
  replaceOleLinkPlaceholders,
  replaceOlePlaceholders,
  replaceSmartArtPlaceholders,
  replaceVideoPlaceholders,
} from "@office-open/core";
import { ChartCollection } from "@office-open/core/chart";
import { SmartArtCollection } from "@office-open/core/smartart";
import type { AuthorEntry, CommentEntry } from "@parts/comment";
import { stringifyControls, stringifyCustDataLst } from "@parts/slide/c-sld";
import type { SlideSyncOptions } from "@parts/slide/slide-sync-properties";
import { SP_TREE_HEADER } from "@shared/constants";
import type { PresentationOptions, SlideOptions } from "@shared/file";
import { buildHeaderFooterShapes } from "@shared/header-footer";

import { PptxWriteContext } from "../context";
import { timingDesc } from "../parts/descriptors/animation";
import { backgroundDesc } from "../parts/descriptors/background";
import { stringifyChild } from "../parts/descriptors/bridge";
import { colorMappingOverrideDesc } from "../parts/descriptors/color-map-override";
import type { NotesSlideOptions } from "../parts/descriptors/notes-slide";
import { stringifyTransition } from "../parts/descriptors/slide";
import { deriveInitials } from "./masters";
import {
  MEDIA_REL_KINDS,
  XML_DECL,
  type XmlifyedFileMapping,
  promoteLayoutToSourceId,
  reserveClaimedSourceRids,
  wirePartHyperlinks,
} from "./shared";

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

export function buildCommentData(
  slides: readonly SlideOptions[],
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

/** Parts the slide loop emits besides the slide XML itself, needed by the
 * package tail (notes slides, sync properties, comment authors/comments). */
export interface SlideCompileArtifacts {
  notesOptions: NotesSlideOptions[];
  notesSlideIndexMap: Map<number, number>;
  slideSyncOptionsList: SlideSyncOptions[];
  slideSyncIndexMap: Map<number, number>;
  commentAuthors: AuthorEntry[] | undefined;
  slideComments: (CommentEntry[] | undefined)[];
}

/** Run the per-slide compile: map every slide's XML and relationships and
 * collect the per-slide attachments the package tail emits later. */
export function compileSlideParts(
  mapping: XmlifyedFileMapping,
  slides: readonly SlideOptions[],
  slideRels: readonly Relationships[],
  descCtx: PptxWriteContext,
  charts: ChartCollection,
  smartArts: SmartArtCollection,
  passthroughRelationships: PresentationOptions["passthroughRelationships"],
): SlideCompileArtifacts {
  const media = descCtx.mediaCollection;

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

  const { authors: commentAuthorEntries, perSlide: slideCommentEntries } = buildCommentData(slides);

  // Group passthrough rels by source part once — the per-slide loop below
  // looks its own slice up instead of re-filtering the full list each time.
  const slidePassthroughBySource = new Map<
    string,
    PresentationOptions["passthroughRelationships"]
  >();
  for (const rel of passthroughRelationships ?? []) {
    const group = slidePassthroughBySource.get(rel.source);
    if (group) group.push(rel);
    else slidePassthroughBySource.set(rel.source, [rel]);
  }
  for (const [i, slide] of slides.entries()) {
    const slideXml = stringifySlide(slide, descCtx);

    const slideMediaData = getReferencedMedia(slideXml, media.array);
    const currentSlideRels = slideRels[i];
    if (!currentSlideRels) continue; // slideRels is built one-per-slide in lockstep with slides
    absorbSlideSourceKinds(
      currentSlideRels,
      slide,
      slideXml,
      slideMediaData,
      `ppt/slides/slide${i + 1}.xml`,
      passthroughRelationships,
      descCtx,
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
        RELATIONSHIP_TYPES.image,
        `../media/${mediaItem.fileName}`,
      );
    }

    const replacedSlideXml = wireSlidePlaceholderBatches(
      replaceImagePlaceholders(slideXml, slideMediaData, slideImageOffset),
      currentSlideRels,
      descCtx,
      charts,
      smartArts,
    );

    mapping[`Slide${i}`] = {
      data: replacedSlideXml,
      path: `ppt/slides/slide${i + 1}.xml`,
    };

    if (
      slideCommentEntries[i] &&
      !currentSlideRels.hasRelationshipKind("comments") &&
      !currentSlideRels.hasRelationship(
        RELATIONSHIP_TYPES.comments,
        `../comments/comment${i + 1}.xml`,
      )
    ) {
      currentSlideRels.add(RELATIONSHIP_TYPES.comments, `../comments/comment${i + 1}.xml`);
    }

    const notesSlideIndex = notesSlideIndexMap.get(i);
    if (
      notesSlideIndex !== undefined &&
      !currentSlideRels.hasRelationshipKind("notesSlide") &&
      !currentSlideRels.hasRelationship(
        RELATIONSHIP_TYPES.notesSlide,
        `../notesSlides/notesSlide${notesSlideIndex + 1}.xml`,
      )
    ) {
      currentSlideRels.add(
        RELATIONSHIP_TYPES.notesSlide,
        `../notesSlides/notesSlide${notesSlideIndex + 1}.xml`,
      );
    }

    const slideSyncIndex = slideSyncIndexMap.get(i);
    if (slideSyncIndex !== undefined) {
      currentSlideRels.add(
        RELATIONSHIP_TYPES.slideSyncProperties,
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
    for (const rel of passthroughRelationships ?? []) {
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

  return {
    notesOptions,
    notesSlideIndexMap,
    slideSyncOptionsList,
    slideSyncIndexMap,
    commentAuthors: commentAuthorEntries,
    slideComments: slideCommentEntries,
  };
}

/** Register every placeholder batch a slide carries (charts, SmartArt,
 * hyperlinks, linked images/OLE, media, embeddings) onto its relationships
 * and return the XML with placeholders resolved. */
function wireSlidePlaceholderBatches(
  slideXml: string,
  rels: Relationships,
  descCtx: PptxWriteContext,
  charts: ChartCollection,
  smartArts: SmartArtCollection,
): string {
  let replacedSlideXml = slideXml;
  const media = descCtx.mediaCollection;
  if (!hasPlaceholders(replacedSlideXml)) return replacedSlideXml;

  // Chart
  const slideChartKeys = collectPlaceholderKeys(replacedSlideXml, "chart:");
  if (slideChartKeys.length > 0) {
    const slideChartOffset = rels.nextRelationshipId;
    const slideChartKeySet = new Set(slideChartKeys);
    const xmlCompCharts = charts.array.filter((c) => slideChartKeySet.has(c.key));
    const descCharts = descCtx.charts.filter((c) => slideChartKeySet.has(c.key));
    const allChartKeys = [...xmlCompCharts.map((c) => c.key), ...descCharts.map((c) => c.key)];
    replacedSlideXml = replaceChartPlaceholders(replacedSlideXml, allChartKeys, slideChartOffset);
    for (const [ci, chartKey] of allChartKeys.entries()) {
      rels.addRelationship(
        slideChartOffset + ci,
        RELATIONSHIP_TYPES.chart,
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
    const allSaKeys = [...xmlCompSmartArts.map((s) => s.key), ...descSmartArts.map((s) => s.key)];
    const saOffset = rels.nextRelationshipId;
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
          rels.addRelationship(id, type, target);
        },
        saOffset,
        saGlobalStart,
        {
          pathPrefix: "../",
          styleRelType: RELATIONSHIP_TYPES.diagramQuickStyle,
        },
      );
    }
  }

  // Hyperlinks — slides reference each other directly (no ../slides/).
  replacedSlideXml = wirePartHyperlinks(
    replacedSlideXml,
    descCtx.hyperlinks,
    rels.nextRelationshipId,
    (id, type, target, mode) => rels.addRelationship(id, type, target, mode),
    "",
    (target) => {
      const rid = rels.idOf("slide", target);
      return rid === undefined ? undefined : Number(rid.slice(3));
    },
  );

  // Linked image sources (a:blip @r:link) — one External image relationship
  // per referenced URL.
  const slideImgLinkKeys = collectPlaceholderKeys(replacedSlideXml, "img-link:");
  if (slideImgLinkKeys.length > 0) {
    const slideImgLinkSet = new Set(slideImgLinkKeys);
    const slideImgLinks = descCtx.imageLinks.filter((l) => slideImgLinkSet.has(l.key));
    const imgLinkOffset = rels.nextRelationshipId;
    replacedSlideXml = replaceImageLinkPlaceholders(replacedSlideXml, slideImgLinks, imgLinkOffset);
    for (const [li, imgLink] of slideImgLinks.entries()) {
      rels.addRelationship(imgLinkOffset + li, RELATIONSHIP_TYPES.image, imgLink.url, "External");
    }
  }

  // Linked OLE objects (p:oleObj @r:id with p:link) — one External
  // oleObject relationship per referenced URL.
  const slideOleLinkKeys = collectPlaceholderKeys(replacedSlideXml, "ole-link:");
  if (slideOleLinkKeys.length > 0) {
    const slideOleLinkSet = new Set(slideOleLinkKeys);
    const slideOleLinks = descCtx.oleLinks.filter((l) => slideOleLinkSet.has(l.key));
    const oleLinkOffset = rels.nextRelationshipId;
    replacedSlideXml = replaceOleLinkPlaceholders(replacedSlideXml, slideOleLinks, oleLinkOffset);
    for (const [oli, oleLink] of slideOleLinks.entries()) {
      rels.addRelationship(
        oleLinkOffset + oli,
        RELATIONSHIP_TYPES.oleObject,
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
    const mediaOffset = rels.nextRelationshipId;
    const audioOffset = mediaOffset + slideMediaRefs.length;
    const videoOffset = audioOffset + slideAudioRefs.length;
    replacedSlideXml = replaceMediaPlaceholders(replacedSlideXml, slideMediaRefs, mediaOffset);
    replacedSlideXml = replaceAudioPlaceholders(replacedSlideXml, slideAudioRefs, audioOffset);
    replacedSlideXml = replaceVideoPlaceholders(replacedSlideXml, slideVideoRefs, videoOffset);
    for (const [mi, mediaRef] of slideMediaRefs.entries()) {
      rels.addRelationship(
        mediaOffset + mi,
        RELATIONSHIP_TYPES.mediaMs,
        `../media/${mediaRef.fileName}`,
      );
    }
    for (const [ai, audioRef] of slideAudioRefs.entries()) {
      rels.addRelationship(
        audioOffset + ai,
        RELATIONSHIP_TYPES.audio,
        `../media/${audioRef.fileName}`,
      );
    }
    for (const [vi, videoRef] of slideVideoRefs.entries()) {
      rels.addRelationship(
        videoOffset + vi,
        RELATIONSHIP_TYPES.video,
        `../media/${videoRef.fileName}`,
      );
    }
  }

  // OLE embeddings
  const slideOleRefs = getOleRefs(replacedSlideXml, descCtx.embeddings);
  if (slideOleRefs.length > 0) {
    const oleOffset = rels.nextRelationshipId;
    replacedSlideXml = replaceOlePlaceholders(replacedSlideXml, slideOleRefs, oleOffset);
    for (const [oi, oleRef] of slideOleRefs.entries()) {
      rels.addRelationship(
        oleOffset + oi,
        RELATIONSHIP_TYPES.oleObject,
        `../embeddings/${oleRef.fileName}`,
      );
    }
  }

  return replacedSlideXml;
}

/** Reserve the slide's captured ids whose rels a claim will re-emit — the
 * media/chart/… batches snapshot nextRelationshipId, and a batch landing on
 * such an id would force the claim loop at the end to renumber a verbatim
 * reference into a dangle. Kinds the batches register (layout, images,
 * charts, media, notes, …) are absorbed by the model — the claim skips them
 * as owned, so reserving their ids would only open holes the round-trip then
 * reports as drift. */
function absorbSlideSourceKinds(
  rels: Relationships,
  slide: SlideOptions,
  slideXml: string,
  slideMediaData: readonly { fileName: string }[],
  source: string,
  passthroughRelationships: PresentationOptions["passthroughRelationships"],
  descCtx: PptxWriteContext,
): void {
  const slideAbsorbedKinds = new Set<string>(["slideLayout"]);
  if (slideMediaData.length > 0 || collectPlaceholderKeys(slideXml, "img-link:").length > 0)
    slideAbsorbedKinds.add("image");
  if (collectPlaceholderKeys(slideXml, "chart:").length > 0) slideAbsorbedKinds.add("chart");
  if (collectPlaceholderKeys(slideXml, "smartart:").length > 0) {
    slideAbsorbedKinds.add("diagramData");
    slideAbsorbedKinds.add("diagramColors");
    slideAbsorbedKinds.add("diagramQuickStyle");
  }
  const media = descCtx.mediaCollection;
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
  reserveClaimedSourceRids(rels, source, passthroughRelationships, slideAbsorbedKinds);
}
