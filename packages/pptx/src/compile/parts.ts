/**
 * Package-tail compile phase: writes the parts the slide/master mapping
 * doesn't cover — chart and SmartArt part families, viewProps/presProps
 * rels, notes slides, sync properties, and comment parts.
 *
 * @module
 */

import {
  IMAGE_MEDIA_CONTENT_TYPES,
  RELATIONSHIP_TYPES,
  Relationships,
  PPTX_PARTS,
  getReferencedMedia,
  replaceImagePlaceholders,
  resolverFromRegistry,
} from "@office-open/core";
import type { Zippable } from "@office-open/core";
import { ChartCollection } from "@office-open/core/chart";
import {
  stringifyColorDefinitionPart,
  stringifyLayoutDefinitionPart,
  stringifyStyleDefinitionPart,
} from "@office-open/core/smartart";
import { SmartArtCollection } from "@office-open/core/smartart";
import { escapeXml } from "@office-open/xml";
import { getColorXml, getLayoutXml, getStyleXml, DEFAULT_DRAWING_XML } from "@parts/smartart";
import type { PresentationOptions } from "@shared/file";

import type { PptxWriteContext } from "../context";
import { commentAuthorsDesc, slideCommentsDesc } from "../parts/descriptors/comments";
import { notesSlideDesc } from "../parts/descriptors/notes-slide";
import { slideSyncDesc } from "../parts/descriptors/slide-sync";
import { XML_DECL, encoder, wirePartHyperlinks } from "./shared";
import type { SlideCompileArtifacts } from "./slides";

/** PPTX part path → content type, derived from the part registry. Matches
 * actual file paths, so dense (slides) and sparse (slide-indexed comments)
 * naming are both handled. */
export const PPTX_CONTENT_TYPE_RESOLVER = resolverFromRegistry(PPTX_PARTS);

/** Chart part → user-shapes part relationship (c:userShapes bridge). */
const CHART_USER_SHAPES_REL = RELATIONSHIP_TYPES.chartUserShapes;

/** Extension → MIME for media Default entries (image/video/audio). Declared
 * only for extensions actually present in the package. */
export const PPTX_MEDIA_CONTENT_TYPES: Record<string, string> = {
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

/** Write the parts that follow the mapping→Zippable conversion: chart and
 * SmartArt families, viewProps/presProps rels, notes slides, sync
 * properties, and comment parts. */
export function compileTailParts(
  files: Zippable,
  descCtx: PptxWriteContext,
  charts: ChartCollection,
  smartArts: SmartArtCollection,
  artifacts: SlideCompileArtifacts,
  slideCount: number,
  options: PresentationOptions,
): void {
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
  const hasOutlineViewSlides =
    !!options.view?.outlineView?.slides && options.view.outlineView.slides.length > 0;
  if (hasOutlineViewSlides) {
    const vpRels = new Relationships();
    for (let i = 0; i < slideCount; i++) {
      vpRels.addRelationship(i + 1, RELATIONSHIP_TYPES.slide, `slides/slide${i + 1}.xml`);
    }
    files["ppt/_rels/viewProps.xml.rels"] = encoder.encode(XML_DECL + vpRels.serialize());
  }

  // PresProps relationships
  const htmlPublishInfo = options.htmlPublish?.rId
    ? { rId: options.htmlPublish.rId, target: options.htmlPublish.target }
    : undefined;
  if (htmlPublishInfo) {
    const presPropsRels = new Relationships();
    presPropsRels.addRelationship(
      htmlPublishInfo.rId,
      RELATIONSHIP_TYPES.hyperlink,
      htmlPublishInfo.target ?? "presentation.htm",
      "External",
    );
    files["ppt/_rels/presProps.xml.rels"] = encoder.encode(XML_DECL + presPropsRels.serialize());
  }

  // Notes slides
  const notesSlideToSlide = new Map<number, number>();
  for (const [slideIdx, notesIdx] of artifacts.notesSlideIndexMap) {
    notesSlideToSlide.set(notesIdx, slideIdx);
  }
  for (let i = 0; i < artifacts.notesOptions.length; i++) {
    const slideIdx = notesSlideToSlide.get(i) ?? 0;
    const nsRels = new Relationships();
    nsRels.addRelationship(1, RELATIONSHIP_TYPES.notesMaster, "../notesMasters/notesMaster1.xml");
    nsRels.addRelationship(2, RELATIONSHIP_TYPES.slide, `../slides/slide${slideIdx + 1}.xml`);
    // Media referenced by notes shapes gets slide-style image wiring (notes
    // accept pictures just like slides do).
    const notesRaw = notesSlideDesc.stringify(artifacts.notesOptions[i]!, descCtx) ?? "";
    const notesMediaData = getReferencedMedia(notesRaw, descCtx.mediaCollection.array);
    const notesImageOffset = nsRels.nextRelationshipId;
    for (const [idx, mediaItem] of notesMediaData.entries()) {
      nsRels.addRelationship(
        notesImageOffset + idx,
        RELATIONSHIP_TYPES.image,
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
  for (const [i, syncOpts] of artifacts.slideSyncOptionsList.entries()) {
    files[`ppt/slideSyncPr/slideSyncPr${i + 1}.xml`] = encoder.encode(
      XML_DECL + (slideSyncDesc.stringify(syncOpts, descCtx) ?? ""),
    );
  }

  // Comment authors
  if (artifacts.commentAuthors) {
    files["ppt/commentAuthors.xml"] = encoder.encode(
      XML_DECL + (commentAuthorsDesc.stringify(artifacts.commentAuthors, descCtx) ?? ""),
    );
  }

  // Slide comments
  for (let i = 0; i < artifacts.slideComments.length; i++) {
    if (artifacts.slideComments[i]) {
      files[`ppt/comments/comment${i + 1}.xml`] = encoder.encode(
        XML_DECL + (slideCommentsDesc.stringify(artifacts.slideComments[i]!, descCtx) ?? ""),
      );
    }
  }
}
