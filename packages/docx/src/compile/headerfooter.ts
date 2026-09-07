/**
 * Header/footer compile phase: the four mapping arrays (Headers, Footers,
 * HeaderRelationships, FooterRelationships).
 *
 * Headers and footers are structural twins — same stringify → placeholder
 * resolution → relationship registration pipeline, differing only in element
 * name, namespaces, and default part name — so one per-part helper serves
 * both, and each part's body and rels are produced together (no cross-entry
 * state needed).
 *
 * @module
 */

import {
  type XmlifyedFile,
  optionalRelsPart,
  replaceNumberingPlaceholders,
} from "@office-open/core";
import {
  FOOTER_NAMESPACES,
  HEADER_NAMESPACES,
  type HeaderFooterEntry,
  stringifyHeaderFooter,
} from "@parts/header-footer";

import type { PartCtxFactory } from "../compiler";
import type { DocxWriteContext } from "../context";
import { XML_DECL, registerPartMedia, resolvePartMedia } from "./shared";

/** Stringify one header/footer part and wire its media/embedding
 * relationships. Images get per-part relationship IDs starting at
 * nextRelationshipId, mirroring the document part; the placeholder pass uses
 * referenced-local positions, so body r:embed and .rels stay aligned. */
function compileHeaderFooterPart(
  kind: "header" | "footer",
  entry: HeaderFooterEntry,
  index: number,
  ctx: DocxWriteContext,
  mkCtx: PartCtxFactory,
): { part: XmlifyedFile; rels?: XmlifyedFile } {
  const partName = entry.partName ?? `${kind}${index + 1}.xml`;
  const partCtx = mkCtx({
    relationships: entry.relationships,
    partName: `word/${partName}`,
  });
  const xmlData =
    XML_DECL +
    stringifyHeaderFooter(
      kind === "footer" ? "w:ftr" : "w:hdr",
      kind === "footer" ? FOOTER_NAMESPACES : HEADER_NAMESPACES,
      entry.children,
      partCtx,
    );
  const relCount = entry.relationships.nextRelationshipId;
  const resolved = resolvePartMedia(xmlData, ctx, relCount);
  registerPartMedia(entry.relationships, ctx, resolved);
  return {
    part: {
      data: replaceNumberingPlaceholders(resolved.xml, ctx.numbering.concreteNumbering),
      path: `word/${partName}`,
    },
    rels: optionalRelsPart(entry.relationships, XML_DECL, `word/_rels/${partName}.rels`),
  };
}

function mapParts(
  entries: HeaderFooterEntry[],
  kind: "header" | "footer",
  ctx: DocxWriteContext,
  mkCtx: PartCtxFactory,
): { parts: XmlifyedFile[]; rels: XmlifyedFile[] } {
  const parts: XmlifyedFile[] = [];
  const rels: XmlifyedFile[] = [];
  entries.forEach((entry, index) => {
    const compiled = compileHeaderFooterPart(kind, entry, index, ctx, mkCtx);
    parts.push(compiled.part);
    if (compiled.rels) rels.push(compiled.rels);
  });
  return { parts, rels };
}

export function compileHeaderFooterParts(
  ctx: DocxWriteContext,
  mkCtx: PartCtxFactory,
): {
  Headers: XmlifyedFile[];
  Footers: XmlifyedFile[];
  HeaderRelationships: XmlifyedFile[];
  FooterRelationships: XmlifyedFile[];
} {
  const headers = mapParts(ctx.headers, "header", ctx, mkCtx);
  const footers = mapParts(ctx.footers, "footer", ctx, mkCtx);
  return {
    Headers: headers.parts,
    HeaderRelationships: headers.rels,
    Footers: footers.parts,
    FooterRelationships: footers.rels,
  };
}
