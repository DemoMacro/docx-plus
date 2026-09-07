import { escapeXml } from "@office-open/xml";

import type { XmlifyedFile } from "./packer";

/** OPC relationship type URIs keyed by their trailing token — the single
 *  source for every relationship type this library emits or accepts. The
 *  {@link RelationshipType} union derives from it, so a typo is a compile
 *  error instead of a corrupt package. Spec files keep raw URI literals as
 *  independent expected-value anchors. */
export const RELATIONSHIP_TYPES = {
  txbxMs: "http://schemas.microsoft.com/office/2006/relationships/txbx",
  diagramColorsMs: "http://schemas.microsoft.com/office/2007/relationships/diagramColors",
  diagramDrawingMs: "http://schemas.microsoft.com/office/2007/relationships/diagramDrawing",
  diagramLayoutMs: "http://schemas.microsoft.com/office/2007/relationships/diagramLayout",
  diagramStyleMs: "http://schemas.microsoft.com/office/2007/relationships/diagramStyle",
  mediaMs: "http://schemas.microsoft.com/office/2007/relationships/media",
  commentsExtendedMs: "http://schemas.microsoft.com/office/2011/relationships/commentsExtended",
  peopleMs: "http://schemas.microsoft.com/office/2011/relationships/people",
  aFChunk: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk",
  attachedTemplate:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate",
  audio: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio",
  bibliography: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/bibliography",
  calcChain: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain",
  chart: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
  chartUserShapes:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartUserShapes",
  chartsheet: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartsheet",
  commentAuthors:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors",
  comments: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
  connections: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/connections",
  customProperties:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties",
  customXml: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml",
  diagramColors:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramColors",
  diagramData: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData",
  diagramLayout:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramLayout",
  diagramQuickStyle:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramQuickStyle",
  dialogsheet: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/dialogsheet",
  drawing: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
  endnotes: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes",
  extendedProperties:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
  externalLink: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink",
  externalLinkPath:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath",
  font: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font",
  fontTable: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable",
  footer: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer",
  footnotes: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes",
  glossaryDocument:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/glossaryDocument",
  handoutMaster:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/handoutMaster",
  header: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header",
  hyperlink: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
  image: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
  metadata: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/metadata",
  notesMaster: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster",
  notesSlide: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide",
  numbering: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering",
  officeDocument:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
  oleObject: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject",
  package: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/package",
  pivotCacheDefinition:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition",
  pivotCacheRecords:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords",
  pivotTable: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotTable",
  presProps: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps",
  queryTable: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/queryTable",
  revisionHeaders:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/revisionHeaders",
  revisionLog: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/revisionLog",
  settings: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings",
  sharedStrings:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings",
  sheetMetadata:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata",
  slide: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide",
  slideLayout: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout",
  slideMaster: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster",
  slideSyncProperties:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideSyncProperties",
  styles: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
  subDocument: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/subDocument",
  table: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/table",
  tableSingleCells:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableSingleCells",
  tableStyles: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles",
  theme: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
  themeManager: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/themeManager",
  themeOverride:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/themeOverride",
  users: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/users",
  video: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/video",
  viewProps: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps",
  vmlDrawing: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing",
  volTypes: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/volTypes",
  webSettings: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/webSettings",
  worksheet: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
  xmlMaps: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/xmlMaps",
  metadataCoreProperties:
    "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
} as const satisfies Record<string, string>;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[keyof typeof RELATIONSHIP_TYPES];

export const TargetModeType = {
  EXTERNAL: "External",
} as const;

interface RelationshipEntry {
  id: string;
  type: RelationshipType;
  target: string;
  targetMode?: string;
}

/**
 * Manages OOXML relationship entries and serializes to XML.
 *
 * Standalone class — no XmlComponent inheritance.
 * Pure string concatenation for zero-allocation XML output.
 */
export class Relationships {
  private entries: RelationshipEntry[] = [];
  // Max numeric id across entries, maintained on every mutation so the next
  // free id is O(1) instead of a full scan per read.
  private maxId = 0;

  private trackId(rid: string): void {
    const n = /^rId(\d+)$/.exec(rid);
    if (n) this.maxId = Math.max(this.maxId, Number(n[1]));
  }

  public addRelationship(
    id: number | string,
    type: RelationshipType,
    target: string,
    targetMode?: (typeof TargetModeType)[keyof typeof TargetModeType],
  ): void {
    // A string id is the full "rIdN" form (a passthrough source id) — prefix
    // only numbers, so "rId2" can't become "rIdrId2".
    const rid = typeof id === "number" ? `rId${id}` : id;
    this.trackId(rid);
    this.entries.push({ id: rid, type, target, targetMode });
  }

  /**
   * Register a relationship with an auto-allocated sequential id and return
   * the numeric id. Prefer this over the `relationshipCount + 1` +
   * `addRelationship` pair at every call site that wants the next id; reach
   * for `addRelationship` directly only when the id is externally determined
   * (a contiguous batch pre-computed from an offset, a fixed rId1, …).
   *
   * The id is max(existing) + 1, not count + 1 — externally-determined ids
   * (passthrough source ids) can leave gaps, and a gap-following count-based
   * id would collide with an existing entry (duplicate Relationship ids
   * corrupt the package for Office applications).
   */
  public add(
    type: RelationshipType,
    target: string,
    targetMode?: (typeof TargetModeType)[keyof typeof TargetModeType],
  ): number {
    const id = this.maxId + 1;
    this.maxId = id;
    this.entries.push({ id: `rId${id}`, type, target, targetMode });
    return id;
  }

  public get relationshipCount(): number {
    return this.entries.length;
  }

  /** The next free numeric id (max existing + 1) — the safe offset base when
   * externally-determined ids (passthrough source ids) leave gaps below it. */
  public get nextRelationshipId(): number {
    return this.maxId + 1;
  }

  /** Pre-claim a source id without registering an entry. Reserving every
   * passthrough source id up front keeps auto-allocated ids (add(), next)
   * strictly above the source id space, so a part the source didn't carry
   * (a fresh comment, say) can never take an id a later source re-use will
   * need — re-emitting the source rel at a taken id corrupts the package.
   * Accepts the passthrough `rId` form ("rId7") or a bare number. */
  public reserveId(id: number | string): void {
    const n = typeof id === "number" ? id : /^rId(\d+)$/.exec(id)?.[1];
    if (n !== undefined) this.trackId(`rId${n}`);
  }

  /** Reserve every passthrough id held by one source part — the uniform entry
   * point compilers call before filling a part's rels from the model. Without
   * it the model's batch allocations (offset snapshots, add()) can land on a
   * source id, forcing the later source re-emission to collide or renumber
   * (renumbering dangles the verbatim references that motivated keeping the
   * source id). Reserving is invisible to hasId/hasRelationship, so source
   * re-emission and rename-to-source-id still work. */
  public reserveSourceRids(
    source: string,
    passthrough: readonly { source: string; rId: string }[],
  ): void {
    for (const rel of passthrough) {
      if (rel.source === source) this.reserveId(rel.rId);
    }
  }

  /** Rename the first entry matching `type` to `newId` — used to promote a
   * structured rel (e.g. the slide layout) to its source id when the
   * source rId is free. No-op when the slot is taken or no match. */
  public renameEntryByType(type: string, newId: number): void {
    if (this.hasId(`rId${newId}`)) return;
    const entry = this.entries.find((e) => e.type === type);
    if (entry) {
      entry.id = `rId${newId}`;
      this.maxId = Math.max(this.maxId, newId);
    }
  }

  /** Numeric id of the first entry matching `kind` (last segment of the type
   * URI), or undefined when none is registered. */
  public idByKind(kind: string): number | undefined {
    const entry = this.entries.find((e) => e.type.split("/").pop() === kind);
    if (!entry) return undefined;
    const m = /^rId(\d+)$/.exec(entry.id);
    if (!m) return undefined;
    return Number(m[1]);
  }

  /**
   * Claim a captured source relationship (round-trip pre-claim). Verbatim
   * part content references the source rIds, so re-emit the rel at its exact
   * source id whenever that slot is still free — renumbering would dangle
   * those references. Skips rels already registered under the same
   * kind+target (the model absorbed them); falls back to an auto id for
   * non-numeric source ids.
   */
  public claimSourceRel(rel: {
    relationshipType: string;
    target: string;
    rId: string;
    targetMode?: "External";
  }): void {
    if (this.hasRelationship(rel.relationshipType, rel.target)) return;
    const numeric = /^rId(\d+)$/.exec(rel.rId);
    if (numeric && !this.hasId(rel.rId)) {
      this.addRelationship(
        Number(numeric[1]),
        rel.relationshipType as RelationshipType,
        rel.target,
        rel.targetMode,
      );
    } else {
      this.add(rel.relationshipType as RelationshipType, rel.target, rel.targetMode);
    }
  }

  /**
   * True when a relationship of the same kind and target is already
   * registered. The kind compares only the relationship type's last path
   * segment, so the transitional and strict URI forms of the same
   * relationship compare equal — passthrough re-emission uses this to skip
   * relationships the compiler already wired (a duplicate entry corrupts the
   * package for Office applications).
   */
  public hasRelationship(type: string, target: string): boolean {
    const kind = type.split("/").pop();
    return this.entries.some((e) => e.type.split("/").pop() === kind && e.target === target);
  }

  /**
   * True when any entry carries the relationship kind (last type segment).
   * Round-trip re-emission uses this as the ownership test: a rebuilt part
   * that already registered a rel of this kind absorbed the concept, so the
   * captured source rel (possibly a renamed target or the ISO-strict type
   * dual) must not be re-emitted alongside it.
   */
  public hasRelationshipKind(kind: string): boolean {
    return this.entries.some((e) => e.type.split("/").pop() === kind);
  }

  /** True when an entry already occupies this exact relationship id. */
  public hasId(id: string): boolean {
    return this.entries.some((e) => e.id === id);
  }

  /**
   * The id of the entry matching kind+target (same last-path-segment equality
   * as {@link hasRelationship}), or undefined when absent. Round-trip legs use
   * this to point a reference element at an already-registered relationship.
   */
  public idOf(type: string, target: string): string | undefined {
    const kind = type.split("/").pop();
    return this.entries.find((e) => e.type.split("/").pop() === kind && e.target === target)?.id;
  }

  /** Directly builds XML string — zero intermediate tree allocation. */
  public serialize(): string {
    const p: string[] = [
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ];
    for (const e of this.entries) {
      const tm = e.targetMode ? ` TargetMode="${escapeXml(e.targetMode)}"` : "";
      p.push(
        `<Relationship Id="${escapeXml(e.id)}" Type="${escapeXml(e.type)}" Target="${escapeXml(e.target)}"${tm}/>`,
      );
    }
    p.push("</Relationships>");
    return p.join("");
  }
}

/**
 * Serialize a Relationships part only when it carries at least one
 * relationship. Optional parts (fontTable, headers, footers, charts, drawings,
 * worksheets, …) emit no .rels part when empty — Office strips empty rels
 * shells when re-saving, so skipping them keeps generated packages free of
 * redundant empty parts and matches Office's normalized output.
 *
 * Always-on parts (the package `_rels/.rels` and the main
 * document/presentation/workbook parts) carry relationships by construction
 * and must NOT use this gate.
 */
export function optionalRelsPart(
  rel: Relationships,
  xmlDeclaration: string,
  path: string,
): XmlifyedFile | undefined {
  return rel.relationshipCount > 0 ? { data: xmlDeclaration + rel.serialize(), path } : undefined;
}

/** Build the package root relationships shared by docx, pptx, and xlsx. */
export function buildRootRelationships(
  mainPartTarget: string,
  includeCustomProperties: boolean,
  passthroughRelationships?: readonly {
    source: string;
    relationshipType: string;
    target: string;
    targetMode?: "External";
  }[],
): Relationships {
  const rels = new Relationships();
  rels.addRelationship(
    1,
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
    mainPartTarget,
  );
  rels.addRelationship(
    2,
    "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
    "docProps/core.xml",
  );
  rels.addRelationship(
    3,
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
    "docProps/app.xml",
  );
  if (includeCustomProperties) {
    rels.addRelationship(
      4,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties",
      "docProps/custom.xml",
    );
  }
  // Root-level passthrough relationships (round-trip): the source _rels/.rels
  // referenced parts the model carries verbatim — the package thumbnail above
  // all. Re-emitted as written; targets never move.
  for (const rel of passthroughRelationships ?? []) {
    if (rel.source !== "") continue;
    if (rels.hasRelationship(rel.relationshipType, rel.target)) continue;
    rels.add(rel.relationshipType as RelationshipType, rel.target, rel.targetMode);
  }
  return rels;
}

/**
 * Derive the .rels part path for a package part:
 * "ppt/slides/slide1.xml" → "ppt/slides/_rels/slide1.xml.rels".
 */
export function partPathToRelsPath(partPath: string): string {
  const idx = partPath.lastIndexOf("/");
  const dir = partPath.substring(0, idx);
  const file = partPath.substring(idx + 1);
  return `${dir}/_rels/${file}.rels`;
}

/**
 * Resolve a relationship target against the referencing part's directory,
 * segment by segment: each ".." pops one directory level. A single
 * String.replace("../", …) only strips the first occurrence and mis-resolves
 * deeper targets like "../../media/image.png".
 */
export function resolveRelationshipTarget(partPath: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const dir = partPath.substring(0, partPath.lastIndexOf("/"));
  const dirParts = dir ? dir.split("/") : [];
  for (const part of target.split("/")) {
    if (part === "..") {
      dirParts.pop();
    } else if (part !== "." && part !== "") {
      dirParts.push(part);
    }
  }
  return dirParts.join("/");
}
