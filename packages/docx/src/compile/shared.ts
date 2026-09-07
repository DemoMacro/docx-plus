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
