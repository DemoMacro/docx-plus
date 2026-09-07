/**
 * Cross-domain compile scaffolding shared by the pptx compile phases: the
 * XML declaration/encoder pair, the mapping shape, and the relationship
 * wiring helpers every part family (masters, layouts, slides, notes) reuses.
 *
 * @module
 */

import {
  RELATIONSHIP_TYPES,
  Relationships,
  collectPlaceholderKeys,
  replacePlaceholders,
} from "@office-open/core";
import type { RelationshipType } from "@office-open/core";
import { OOXML_XML_DECLARATION } from "@office-open/xml";
import type { PresentationOptions } from "@shared/file";

import type { HyperlinkEntry } from "../context";

export const encoder = new TextEncoder();
export const XML_DECL = OOXML_XML_DECLARATION + "\n";

export interface RelEntry {
  id: number | string;
  type: RelationshipType;
  target: string;
  mode?: string;
}

export interface XmlifyedFileMapping {
  [key: string]: { data: string; path: string };
}

/** Rel kinds whose targets are media files the model may rename on absorb. */
export const MEDIA_REL_KINDS = new Set(["image", "media", "audio", "video"]);

export function buildRels(entries: RelEntry[]): Relationships {
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
export function wirePartHyperlinks(
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
  const SLIDE_REL = RELATIONSHIP_TYPES.slide;
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
    add(id, RELATIONSHIP_TYPES.hyperlink, hlink.url ?? "", "External");
  }
  const replacement = new Map<string, string>();
  for (const [key, id] of idByKey) replacement.set(`hlink:${key}`, `rId${id}`);
  return replacePlaceholders(xml, replacement);
}

/** Promote the slide layout rel to its source id when the source rId is free
 * — verbatim slide content references the source rId and dangling the layout
 * would dangle the rest of the slide's rels. */
export function promoteLayoutToSourceId(
  rels: Relationships,
  sourcePassthrough: { rId: string; target: string; relationshipType: string }[] | undefined,
): void {
  if (!sourcePassthrough) return;
  const sourceLayout = sourcePassthrough.find(
    (r) => r.relationshipType === RELATIONSHIP_TYPES.slideLayout,
  );
  if (!sourceLayout) return;
  const numeric = /^rId(\d+)$/.exec(sourceLayout.rId);
  if (!numeric) return;
  rels.renameEntryByType(RELATIONSHIP_TYPES.slideLayout, Number(numeric[1]));
}

/** Reserve the captured ids whose rels a claim will re-emit. A captured rel
 * whose kind the model registers for the part (layout, theme, media, …) is
 * absorbed — the claim skips it as owned, so reserving its id only opens a
 * hole the round-trip then reports as drift. Kinds outside `absorbedKinds`
 * have no model counterpart (a chart part carried as a raw island beside a
 * modeled picture, say): their claims keep the source ids verbatim content
 * references, so those ids must stay free above the batch allocations. */
export function reserveClaimedSourceRids(
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
