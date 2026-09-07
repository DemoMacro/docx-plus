/**
 * Document part compile phase: word/document.xml (chart/SmartArt/numbering
 * placeholder resolution over the stringified body) and
 * word/_rels/document.xml.rels.
 *
 * The document part is the only one whose media/embedding relationships
 * re-emit the source rIds on round-trip: the body XML references them
 * verbatim, so registration goes through sourceRidFor before falling back to
 * the offset-derived id.
 *
 * @module
 */

import {
  RELATIONSHIP_TYPES,
  type XmlifyedFile,
  addSmartArtRelationships,
  findAndReplaceImagePlaceholders,
  formatId,
  hasPlaceholders,
  replaceAllPlaceholders,
  replaceNumberingPlaceholders,
} from "@office-open/core";

import type { DocxWriteContext } from "../context";
import { XML_DECL, embeddingRelationship } from "./shared";

/**
 * Look up the source rId for a document relationship by kind+target. Returns
 * the numeric id when the source carried the same rel, undefined otherwise.
 * The body XML's `r:id` references the source rId verbatim on round-trip, so
 * the structured compiler must emit the rel at that exact id — otherwise
 * `r:id="rId4"` would point at a different rel and Word refuses to open.
 */
function sourceRidFor(
  passthroughRelationships:
    | readonly { source: string; relationshipType: string; target: string; rId: string }[]
    | undefined,
  ownerSource: string,
  relationshipType: string,
  target: string,
): number | undefined {
  if (!passthroughRelationships) return undefined;
  for (const rel of passthroughRelationships) {
    if (
      rel.source === ownerSource &&
      rel.relationshipType === relationshipType &&
      rel.target === target
    ) {
      const m = /^rId(\d+)$/.exec(rel.rId);
      if (m) return Number(m[1]);
    }
  }
  return undefined;
}

/**
 * Build a {fileName → rId} map for source rels targeting `media/` or
 * `embeddings/`. findAndReplaceImagePlaceholders consults this map to
 * substitute the source rId in body XML (so `<a:blip r:embed="rId5"/>` points
 * at the rel registered at rId5 — not the rel registered at an
 * offset-derived id, which dangles against any source body that referenced
 * the source rId). Placeholder keys use the media-collection fileName; a
 * dedup-renamed file misses the map and falls through to the offset id on
 * BOTH the body and the .rels side, keeping them consistent.
 */
function documentSourceRids(
  ctx: DocxWriteContext,
  dir: "media" | "embeddings",
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  const prefix = `${dir}/`;
  for (const rel of ctx._options.passthroughRelationships ?? []) {
    if (rel.source !== "word/document.xml") continue;
    if (!rel.target.startsWith(prefix)) continue;
    map.set(rel.target.slice(prefix.length), rel.rId);
  }
  return map;
}

/** Resolve the document body's media/embedding placeholders, then emit the
 * document part and its rels. The rels entry registers media, embeddings,
 * charts, SmartArt, the font table, and the claimed passthrough rels — in
 * that order, so the source rId ordering is preserved. */
export function compileDocumentEntries(
  ctx: DocxWriteContext,
  documentXmlData: string,
  documentRelationshipCount: number,
): { Document: XmlifyedFile; Relationships: XmlifyedFile } {
  const documentMedia = findAndReplaceImagePlaceholders(
    documentXmlData,
    ctx.media.array,
    documentRelationshipCount,
    "rId",
    documentSourceRids(ctx, "media"),
  );
  // OLE embeddings reuse the same {fileName} placeholder bridge as images; run
  // after media so {oleObjectN.bin} placeholders resolve against the embedding array.
  const documentEmbeddingOffset = documentRelationshipCount + documentMedia.referenced.length;
  const documentEmbeddings = findAndReplaceImagePlaceholders(
    documentMedia.xml,
    ctx.embeddings.array,
    documentEmbeddingOffset,
    "rId",
    documentSourceRids(ctx, "embeddings"),
  );

  return {
    Document: {
      data: (() => {
        let xmlData = documentEmbeddings.xml;
        if (hasPlaceholders(xmlData)) {
          const mediaCount = documentMedia.referenced.length;
          const embeddingCount = documentEmbeddings.referenced.length;
          const chartKeys = ctx.charts.array.map((c) => c.key);
          const smartArtKeys = ctx.smartArts.array.map((s) => s.key);
          const chartOffset = documentRelationshipCount + mediaCount + embeddingCount;
          const smartArtOffset = chartOffset + chartKeys.length;

          // Build combined replacement entries for charts, smartart, and numbering
          const entries: Array<{ prefix?: string; key: string; value: string }> = [];
          for (const [i, key] of chartKeys.entries()) {
            const chartTarget = `charts/chart${i + 1}.xml`;
            const sourceRid = sourceRidFor(
              ctx._options.passthroughRelationships,
              "word/document.xml",
              RELATIONSHIP_TYPES.chart,
              chartTarget,
            );
            entries.push({
              prefix: "chart:",
              key,
              value: sourceRid !== undefined ? `rId${sourceRid}` : formatId(chartOffset, i, "rId"),
            });
          }
          const saPrefixes = ["smartart:", "smartart-lo:", "smartart-qs:", "smartart-cs:"];
          for (const [i, key] of smartArtKeys.entries()) {
            for (let p = 0; p < saPrefixes.length; p++) {
              entries.push({
                prefix: saPrefixes[p],
                key,
                value: formatId(smartArtOffset + p * smartArtKeys.length, i, "rId"),
              });
            }
          }
          for (const { reference, instance, numId } of ctx.numbering.concreteNumbering) {
            entries.push({ key: `${reference}-${instance}`, value: numId.toString() });
          }
          xmlData = replaceAllPlaceholders(xmlData, entries);
        } else {
          xmlData = replaceNumberingPlaceholders(xmlData, ctx.numbering.concreteNumbering);
        }
        return xmlData;
      })(),
      path: "word/document.xml",
    },
    Relationships: {
      data: (() => {
        for (const [i, ref] of documentMedia.referenced.entries()) {
          const target = `media/${ref.fileName}`;
          const sourceRid = sourceRidFor(
            ctx._options.passthroughRelationships,
            "word/document.xml",
            RELATIONSHIP_TYPES.image,
            target,
          );
          ctx.document.relationships.addRelationship(
            sourceRid ?? documentRelationshipCount + i,
            RELATIONSHIP_TYPES.image,
            target,
          );
        }
        for (const [i, ref] of documentEmbeddings.referenced.entries()) {
          const target = `embeddings/${ref.fileName}`;
          const sourceRid = sourceRidFor(
            ctx._options.passthroughRelationships,
            "word/document.xml",
            embeddingRelationship(ctx.embeddings, ref.fileName),
            target,
          );
          ctx.document.relationships.addRelationship(
            sourceRid ?? documentEmbeddingOffset + i,
            embeddingRelationship(ctx.embeddings, ref.fileName),
            target,
          );
        }

        const chartOffset =
          documentRelationshipCount +
          documentMedia.referenced.length +
          documentEmbeddings.referenced.length;
        for (let i = 0; i < ctx.charts.array.length; i++) {
          const target = `charts/chart${i + 1}.xml`;
          const sourceRid = sourceRidFor(
            ctx._options.passthroughRelationships,
            "word/document.xml",
            RELATIONSHIP_TYPES.chart,
            target,
          );
          ctx.document.relationships.addRelationship(
            sourceRid ?? chartOffset + i,
            RELATIONSHIP_TYPES.chart,
            target,
          );
        }

        addSmartArtRelationships(
          ctx.smartArts.array.map((s) => s.key),
          (id, type, target) => {
            ctx.document.relationships.addRelationship(id, type, target);
          },
          documentRelationshipCount +
            documentMedia.referenced.length +
            documentEmbeddings.referenced.length +
            ctx.charts.array.length,
          0,
          {
            pathPrefix: "",
            styleRelType: RELATIONSHIP_TYPES.diagramQuickStyle,
            // The drawing part is an Office render cache, present only when the
            // source carried it — Word never emits it for a fresh SmartArt.
            hasDrawing: (key) =>
              ctx.smartArts.array.find((s) => s.key === key)?.raw?.drawing !== undefined,
          },
        );

        ctx.document.relationships.addRelationship(
          sourceRidFor(
            ctx._options.passthroughRelationships,
            "word/document.xml",
            RELATIONSHIP_TYPES.fontTable,
            "fontTable.xml",
          ) ?? ctx.document.relationships.nextRelationshipId,
          RELATIONSHIP_TYPES.fontTable,
          "fontTable.xml",
        );
        ctx.addPassthroughDocumentRelationships();

        return XML_DECL + ctx.document.relationships.serialize();
      })(),
      path: "word/_rels/document.xml.rels",
    },
  };
}
