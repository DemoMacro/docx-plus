/**
 * Relationship wiring shared by the docx compile phases: the XML declaration,
 * the OLE/PACKAGE embedding relationship resolution, and the per-part media +
 * embedding placeholder bridge.
 *
 * @module
 */

import {
  RELATIONSHIP_TYPES,
  type RelationshipType,
  type Relationships,
  findAndReplaceImagePlaceholders,
  replaceAllPlaceholders,
} from "@office-open/core";
import { OOXML_XML_DECLARATION } from "@office-open/xml";
import type { EmbeddingCollection } from "@shared/embeddings/embeddings";

import type { DocxWriteContext } from "../context";

/** XML declaration prepended to every OOXML part. */
export const XML_DECL = OOXML_XML_DECLARATION;

/** Relationship type for OLE embedding parts (word|ppt/embeddings/*). */
const OLE_OBJECT_RELATIONSHIP = RELATIONSHIP_TYPES.oleObject;

/** Relationship type for native-format embedding parts (embedded xlsx/docx). */
export const PACKAGE_RELATIONSHIP = RELATIONSHIP_TYPES.package;

/** Re-emit the relationship type the source used for an embedding part — a
 *  native OPC package (xlsx/docx) stays a package rel, an OLE compound binary
 *  stays an oleObject rel. */
export const embeddingRelationship = (
  embeddings: EmbeddingCollection,
  fileName: string,
): RelationshipType =>
  embeddings.array.find((e) => e.fileName === fileName)?.relationshipType === "package"
    ? PACKAGE_RELATIONSHIP
    : OLE_OBJECT_RELATIONSHIP;

/** Resolved media/embedding placeholders for one part, with the offsets its
 *  relationship registrations must use (ids are per-part numbering). */
export interface PartMediaResolution {
  xml: string;
  relCount: number;
  embeddingOffset: number;
  mediaRefs: { fileName: string }[];
  embeddingRefs: { fileName: string }[];
}

/**
 * Resolve a part's {fileName} media placeholders against the package media
 * store, then its embedding placeholders chained past the media
 * relationships (same ordering as the document part — headers/footers and
 * notes can carry w:object runs of their own).
 */
export function resolvePartMedia(
  xml: string,
  ctx: DocxWriteContext,
  relCount: number,
): PartMediaResolution {
  const media = findAndReplaceImagePlaceholders(xml, ctx.media.array, relCount);
  const embeddingOffset = relCount + media.referenced.length;
  const embeddings = findAndReplaceImagePlaceholders(
    media.xml,
    ctx.embeddings.array,
    embeddingOffset,
  );
  return {
    xml: embeddings.xml,
    relCount,
    embeddingOffset,
    mediaRefs: media.referenced,
    embeddingRefs: embeddings.referenced,
  };
}

/** Register the resolved media + embedding relationships on the part's rels. */
export function registerPartMedia(
  rels: Relationships,
  ctx: DocxWriteContext,
  resolved: PartMediaResolution,
): void {
  for (const [i, ref] of resolved.mediaRefs.entries()) {
    rels.addRelationship(resolved.relCount + i, RELATIONSHIP_TYPES.image, `media/${ref.fileName}`);
  }
  for (const [i, ref] of resolved.embeddingRefs.entries()) {
    rels.addRelationship(
      resolved.embeddingOffset + i,
      embeddingRelationship(ctx.embeddings, ref.fileName),
      `embeddings/${ref.fileName}`,
    );
  }
}

/** Matches any chart/SmartArt placeholder prefix in a part's XML. */
const CHART_SMARTART_PLACEHOLDER = /\{(chart:|smartart(?:-lo|-qs|-cs)?:)/;

/**
 * Resolve a part's {chart:key} / {smartart*:key} placeholders and register the
 * referenced parts on the part's own rels — headers/footers and notes can
 * carry chart and SmartArt drawings of their own. The document part resolves
 * the full collections (compile/document.ts); here only keys this part
 * actually references get relationships, at ids continuing past the part's
 * media/embedding block. Targets keep the package-wide collection order
 * (charts/chartN.xml, diagrams/{data,layout,quickStyle,colors}N.xml), so
 * several parts referencing one chart all point at the same file.
 */
export function resolvePartCharts(
  xml: string,
  ctx: DocxWriteContext,
  rels: Relationships,
  relCount: number,
): string {
  if (!CHART_SMARTART_PLACEHOLDER.test(xml)) return xml;
  const entries: Array<{ prefix?: string; key: string; value: string }> = [];
  const referencedCharts = ctx.charts.array.filter((c) => xml.includes(`{chart:${c.key}}`));
  referencedCharts.forEach((chart, i) => {
    entries.push({ prefix: "chart:", key: chart.key, value: `rId${relCount + i}` });
    rels.addRelationship(
      relCount + i,
      RELATIONSHIP_TYPES.chart,
      `charts/chart${ctx.charts.array.indexOf(chart) + 1}.xml`,
    );
  });
  const referencedSmartArts = ctx.smartArts.array.filter((s) =>
    ["", "-lo", "-qs", "-cs"].some((suffix) => xml.includes(`{smartart${suffix}:${s.key}}`)),
  );
  const chartCount = referencedCharts.length;
  const smartArtCount = referencedSmartArts.length;
  const base = relCount + chartCount;
  const loOffset = base + smartArtCount;
  const qsOffset = loOffset + smartArtCount;
  const csOffset = qsOffset + smartArtCount;
  const drawingOffset = csOffset + smartArtCount;
  referencedSmartArts.forEach((smartArt, i) => {
    const fileIndex = ctx.smartArts.array.indexOf(smartArt) + 1;
    const relsByPrefix: Array<[string, number, RelationshipType, string]> = [
      ["smartart:", base, RELATIONSHIP_TYPES.diagramData, "data"],
      ["smartart-lo:", loOffset, RELATIONSHIP_TYPES.diagramLayout, "layout"],
      ["smartart-qs:", qsOffset, RELATIONSHIP_TYPES.diagramQuickStyle, "quickStyle"],
      ["smartart-cs:", csOffset, RELATIONSHIP_TYPES.diagramColors, "colors"],
    ];
    for (const [prefix, offset, type, file] of relsByPrefix) {
      entries.push({ prefix, key: smartArt.key, value: `rId${offset + i}` });
      rels.addRelationship(offset + i, type, `diagrams/${file}${fileIndex}.xml`);
    }
    // The drawing part is an Office render cache, present only when the source
    // carried it — Word never emits it for a fresh SmartArt.
    if (smartArt.raw?.drawing !== undefined) {
      rels.addRelationship(
        drawingOffset + i,
        RELATIONSHIP_TYPES.diagramDrawingMs,
        `diagrams/drawing${fileIndex}.xml`,
      );
    }
  });
  return replaceAllPlaceholders(xml, entries);
}
