/**
 * XLSX patching — replace placeholders in existing .xlsx files.
 *
 * Unlike DOCX/PPTX (paragraph-based), XLSX patching targets cell values:
 * - String-valued patches substitute the placeholder text in place (shared
 *   strings table or inline strings).
 * - Non-string-valued patches (number / boolean / Date) whose placeholder is
 *   the entire cell content rewrite the cell to a typed value with the correct
 *   cell type (`t`), so the result is a real number/boolean/date cell — not a
 *   stringified copy.
 *
 * @module
 */
import {
  RELATIONSHIP_TYPES,
  OoxmlMimeType,
  appendContentType,
  appendOverride,
  appendRelationship,
  applyCorePropertiesOverride,
  getNextRelationshipIndex,
  nextNumericId,
  partPathToRelsPath,
  removeOverride,
  strFromU8,
  toJson,
  unzipSync,
  zipAndConvert,
} from "@office-open/core";
import type { BasePatchOptions, OutputByType, OutputType } from "@office-open/core";
import { toUint8Array } from "@office-open/core";
import type { ReadContext, WriteContext } from "@office-open/core/descriptor";
import { OOXML_XML_DECLARATION } from "@office-open/xml";
import { stringify } from "@office-open/xml";
import type { Element } from "@office-open/xml";
import { commentsDesc, vmlNotesDesc } from "@parts/comments";
import { SharedStrings, sharedStringsDesc } from "@parts/shared-strings";
import { buildWorksheetXml, stripWorksheetPlaceholders } from "@parts/worksheet";
import type { CommentOptions, WorksheetOptions } from "@parts/worksheet";
import { dateToSerialNumber } from "@util/index";

/** Reusable TextEncoder (stateless, safe to share). */
const encoder = new TextEncoder();

/** Scalar cell value accepted by {@link patchWorkbook}. */
export type ScalarValue = string | number | boolean | Date;

/** A patch value is just a scalar. */
export type Patch = ScalarValue;

export interface PatchWorkbookOptions<T extends OutputType = OutputType> extends BasePatchOptions<
  T,
  ScalarValue
> {
  /**
   * Worksheet collection edits. The shared-strings table is rebuilt from the
   * template first, so appended/replaced worksheets continue indexing strings
   * at the correct offset. Cell styles are not supported on appended rows —
   * reference only styles already present in the template.
   */
  worksheets?: {
    /** Replace worksheets keyed by sheet name (as declared in workbook.xml). */
    replace?: Readonly<Record<string, WorksheetOptions>>;
    /** Append worksheets after the last existing sheet. */
    append?: Readonly<WorksheetOptions[]>;
    /** Remove worksheets by name (as declared in workbook.xml). */
    remove?: readonly string[];
  };
  /**
   * Cell comments (notes) to append per worksheet. Existing comments on the
   * target worksheet are merged — parsed, extended with the new entries, and
   * re-serialized. Keyed by worksheet name (as declared in workbook.xml).
   */
  comments?: Readonly<Record<string, CommentOptions[]>>;
}

const WORKSHEET_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
const WORKSHEET_REL_TYPE = RELATIONSHIP_TYPES.worksheet;
const COMMENTS_REL_TYPE = RELATIONSHIP_TYPES.comments;
const VML_REL_TYPE = RELATIONSHIP_TYPES.vmlDrawing;
const COMMENTS_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml";
const VML_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.vmlDrawing";

/**
 * sharedStringsDesc.parse ignores its context, but its signature requires a
 * {@link ReadContext}. This stub satisfies the type without pulling in parse
 * machinery the patch path does not need.
 */
const STUB_READ_CTX: ReadContext = {
  resolveRelationship: () => undefined,
  getPart: () => undefined,
  getRaw: () => undefined,
};

/** Human-readable form for string-substitution (mixed-text) fallback. */
const toDisplayString = (value: Exclude<ScalarValue, string>): string => {
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString().split("T")[0] ?? "";
  return String(value);
};

/**
 * Patch an existing .xlsx workbook by replacing placeholder text in cells.
 *
 * @publicApi
 */
export const patchWorkbook = async <T extends OutputType = OutputType>({
  outputType,
  data,
  placeholders,
  findReplace,
  coreProperties,
  worksheets,
  comments,
  placeholderDelimiters = { start: "{{", end: "}}" } as const,
}: PatchWorkbookOptions<T>): Promise<OutputByType[T]> => {
  const { start, end } = placeholderDelimiters;
  if (!start.trim() || !end.trim()) {
    throw new Error("Both start and end delimiters must be non-empty strings.");
  }

  const zipContent = unzipSync(toUint8Array(data));

  const xmlMap = new Map<string, Element>();
  const binaryMap = new Map<string, Uint8Array>();
  // VML parts are text XML under a .vml extension — kept out of xmlMap (which
  // only holds .xml/.rels) and serialized as raw text at the end.
  const vmlFiles = new Map<string, string>();

  // Separate XML files from binary files
  for (const [key, value] of Object.entries(zipContent)) {
    if (key.endsWith(".xml") || key.endsWith(".rels")) {
      xmlMap.set(key, toJson(strFromU8(value)));
    } else {
      binaryMap.set(key, value);
    }
  }

  // Unified patch map: placeholders are delimiter-wrapped, findReplace keys are
  // literal strings. Both feed the same Pass A (typed cells) / Pass B (text) engine.
  const patchMap = new Map<string, ScalarValue>();
  if (placeholders) {
    for (const [key, value] of Object.entries(placeholders)) {
      patchMap.set(`${start}${key}${end}`, value);
    }
  }
  if (findReplace) {
    for (const [key, value] of Object.entries(findReplace)) {
      patchMap.set(key, value);
    }
  }

  const sharedStrings = xmlMap.get("xl/sharedStrings.xml");
  const sharedTextByIndex = buildSharedTextIndex(sharedStrings);

  const worksheetKeys = Object.keys(zipContent).filter(
    (k) => k.startsWith("xl/worksheets/sheet") && k.endsWith(".xml"),
  );

  // Pass A: rewrite pure placeholder cells to typed values (number / boolean / Date)
  for (const wsKey of worksheetKeys) {
    const ws = xmlMap.get(wsKey);
    if (ws) rewriteTypedCells(ws, patchMap, sharedTextByIndex);
  }

  // Pass B: text substitution in shared strings + inline strings
  // (string-valued patches, plus non-string patches embedded in mixed text)
  if (sharedStrings) patchSharedStrings(sharedStrings, patchMap);
  for (const wsKey of worksheetKeys) {
    const ws = xmlMap.get(wsKey);
    if (!ws) continue;
    patchWorksheetInlineStrings(ws, patchMap);
    // Pass C: print headers/footers (oddHeader/oddFooter/… literal text)
    patchHeaderFooter(ws, patchMap);
  }

  // Worksheet collection edits — rebuild shared strings first so appended/
  // replaced worksheets continue indexing at the right offset, then serialize.
  // Removal runs last: replace addresses the original sheet list, which the
  // removals (dropping entries) would otherwise change.
  if (worksheets) {
    const sharedStrings = rebuildSharedStrings(xmlMap);
    if (worksheets.replace) {
      for (const [name, wsOpts] of Object.entries(worksheets.replace)) {
        replaceWorksheetInMap(xmlMap, name, wsOpts, sharedStrings);
      }
    }
    if (worksheets.append) {
      for (const wsOpts of worksheets.append) {
        appendWorksheetToMap(xmlMap, wsOpts, sharedStrings);
      }
    }
    rewriteSharedStrings(xmlMap, sharedStrings);
    if (worksheets.remove) {
      removeWorksheetsFromMap(xmlMap, worksheets.remove);
    }
  }

  // Cell comments — append per worksheet, merging with any existing comments.
  if (comments) {
    for (const [sheetName, commentOpts] of Object.entries(comments)) {
      appendCommentsToMap(xmlMap, vmlFiles, sheetName, commentOpts);
    }
  }

  // Rebuild ZIP
  const files: Record<string, Uint8Array> = {};
  for (const [key, value] of xmlMap) {
    files[key] =
      key === "docProps/core.xml" && coreProperties
        ? encoder.encode(OOXML_XML_DECLARATION + applyCorePropertiesOverride(value, coreProperties))
        : encoder.encode(stringify(value));
  }
  for (const [key, value] of binaryMap) {
    files[key] = value;
  }
  for (const [key, value] of vmlFiles) {
    files[key] = encoder.encode(value);
  }

  return await zipAndConvert(files, outputType, OoxmlMimeType.XLSX);
};

/** Map each `<si>` shared-string index to its flattened text. */
function buildSharedTextIndex(sst: Element | undefined): Map<number, string> {
  const map = new Map<number, string>();
  if (!sst) return map;
  const root = sst.name ? sst : sst.elements?.[0];
  let idx = 0;
  for (const si of root?.elements ?? []) {
    if (si.name !== "si") continue;
    map.set(idx, flattenText(si));
    idx++;
  }
  return map;
}

/**
 * Pass A — for each cell whose entire text is a non-string placeholder, rewrite
 * the cell to a typed value cell (`<v>` with the correct `t`).
 */
function rewriteTypedCells(
  ws: Element,
  patchMap: Map<string, ScalarValue>,
  sharedTextByIndex: Map<number, string>,
): void {
  const root = ws.name ? ws : ws.elements?.[0];
  const sheetData = root && findLocalChild(root, "sheetData");
  if (!sheetData) return;

  for (const row of sheetData.elements ?? []) {
    if (localName(row) !== "row") continue;
    for (const cell of row.elements ?? []) {
      if (localName(cell) !== "c") continue;
      const text = effectiveCellText(cell, sharedTextByIndex);
      if (text === undefined) continue;

      // Text is fully resolved here, so an exact match is a single Map lookup.
      // A pure cell holds a single placeholder; string values are Pass B's.
      const value = patchMap.get(text);
      if (value !== undefined && typeof value !== "string") {
        rewriteCellToValue(cell, value);
      }
    }
  }
}

/** Resolve the displayed text of a string/inline-string cell, else undefined. */
function effectiveCellText(
  cell: Element,
  sharedTextByIndex: Map<number, string>,
): string | undefined {
  const t = cell.attributes?.["t"];
  if (t === "inlineStr") {
    const isEl = findLocalChild(cell, "is");
    return isEl ? flattenText(isEl) : undefined;
  }
  if (t === "s") {
    const v = findLocalChild(cell, "v");
    const raw = v?.elements?.[0]?.text;
    const idx = Number(raw);
    return Number.isNaN(idx) ? undefined : sharedTextByIndex.get(idx);
  }
  return undefined;
}

/** Rewrite a cell element to a typed value (`<v>` with the correct `t`). */
function rewriteCellToValue(cell: Element, value: Exclude<ScalarValue, string>): void {
  const attrs = cell.attributes ?? (cell.attributes = {});
  let vText: string;
  if (typeof value === "boolean") {
    attrs["t"] = "b";
    vText = value ? "1" : "0";
  } else if (value instanceof Date) {
    delete attrs["t"]; // serial date is numeric
    vText = String(dateToSerialNumber(value));
  } else {
    delete attrs["t"]; // plain numeric
    vText = String(value);
  }
  cell.elements = [{ type: "element", name: "v", elements: [{ type: "text", text: vText }] }];
}

/** Pass B — substitute placeholders in shared-string `<si>` text. */
function patchSharedStrings(sst: Element, patchMap: Map<string, ScalarValue>): void {
  const root = sst.name ? sst : sst.elements?.[0];
  if (!root) return;

  for (const si of root.elements ?? []) {
    if (si.name !== "si") continue;

    // Simple: <si><t>text</t></si>
    const t = findLocalChild(si, "t");
    if (t) {
      patchTextElement(t, patchMap);
    } else {
      // Rich text: <si><r><t>text</t></r>...</si>
      for (const r of si.elements ?? []) {
        if (r.name !== "r") continue;
        const rt = findLocalChild(r, "t");
        if (rt) patchTextElement(rt, patchMap);
      }
    }
  }
}

/** Pass B — substitute placeholders in worksheet inline strings. */
function patchWorksheetInlineStrings(ws: Element, patchMap: Map<string, ScalarValue>): void {
  const root = ws.name ? ws : ws.elements?.[0];
  if (!root) return;

  const sheetData = findLocalChild(root, "sheetData");
  if (!sheetData) return;

  for (const row of sheetData.elements ?? []) {
    if (localName(row) !== "row") continue;
    for (const cell of row.elements ?? []) {
      if (localName(cell) !== "c") continue;

      // Inline strings: <c t="inlineStr"><is><t>text</t></is></c>
      const isEl = findLocalChild(cell, "is");
      if (isEl) {
        const t = findLocalChild(isEl, "t");
        if (t) patchTextElement(t, patchMap);
      }
    }
  }
}

const HEADER_FOOTER_NAMES = new Set([
  "oddHeader",
  "oddFooter",
  "evenHeader",
  "evenFooter",
  "firstHeader",
  "firstFooter",
]);

/**
 * Pass C — substitute placeholders in worksheet print header/footer text.
 * Header/footer children (oddHeader/oddFooter/…) carry their text directly
 * (not wrapped in `<t>`), so this is a substring substitution on the element's
 * own text node.
 */
function patchHeaderFooter(ws: Element, patchMap: Map<string, ScalarValue>): void {
  const root = ws.name ? ws : ws.elements?.[0];
  if (!root) return;
  const headerFooter = findLocalChild(root, "headerFooter");
  if (!headerFooter) return;

  for (const part of headerFooter.elements ?? []) {
    if (part.type !== "element" || !HEADER_FOOTER_NAMES.has(localName(part))) continue;
    const textNode = part.elements?.[0];
    if (!textNode || typeof textNode.text !== "string") continue;

    let replaced = textNode.text;
    for (const [placeholder, value] of patchMap) {
      if (!replaced.includes(placeholder)) continue;
      const display = typeof value === "string" ? value : toDisplayString(value);
      replaced = replaced.split(placeholder).join(display);
    }
    if (replaced !== textNode.text) {
      part.elements![0] = { ...textNode, text: replaced };
    }
  }
}

/** Substitute any placeholder substring in a `<t>` element's text. */
function patchTextElement(tEl: Element, patchMap: Map<string, ScalarValue>): void {
  const textNode = tEl.elements?.[0];
  const text = textNode?.text;
  if (typeof text !== "string") return;

  let replaced = text;
  for (const [placeholder, value] of patchMap) {
    if (!replaced.includes(placeholder)) continue;
    const display = typeof value === "string" ? value : toDisplayString(value);
    replaced = replaced.split(placeholder).join(display);
  }
  if (replaced !== text && tEl.elements) {
    tEl.elements[0] = { ...textNode, text: replaced };
  }
}

/** Flatten all descendant text of an element into a single string. */
function flattenText(el: Element): string {
  let out = "";
  for (const child of el.elements ?? []) {
    if (child.type === "text") {
      out += child.text ?? "";
    } else if (child.type === "element") {
      out += flattenText(child);
    }
  }
  return out;
}

function localName(el: Element): string {
  const name = el.name ?? "";
  const colonIdx = name.indexOf(":");
  return colonIdx >= 0 ? name.slice(colonIdx + 1) : name;
}

function findLocalChild(parent: Element, name: string): Element | undefined {
  return (parent.elements ?? []).find((el) => localName(el) === name);
}

// ── Worksheet collection edits (append / replace) ──

/** Unwrap the document element: a parsed part is `{ declaration, elements: [<root>] }`. */
function rootOf(doc: Element | undefined): Element | undefined {
  return doc && (doc.name ? doc : doc.elements?.[0]);
}

/** Build a bare element node with the given attributes. */
function makeElement(name: string, attributes: Record<string, string> = {}): Element {
  return { type: "element", name, attributes, elements: [] };
}

/** Empty `<Relationships>` part (wrapped for stringify serialization). */
function createRelationshipFile(): Element {
  return {
    declaration: { attributes: { encoding: "UTF-8", standalone: "yes", version: "1.0" } },
    elements: [
      {
        attributes: { xmlns: "http://schemas.openxmlformats.org/package/2006/relationships" },
        elements: [],
        name: "Relationships",
        type: "element",
      },
    ],
  };
}

/** Next 1-based worksheet file number given existing worksheet parts. */
function nextWorksheetNumber(xmlMap: Map<string, Element>): number {
  let maxN = 0;
  for (const key of xmlMap.keys()) {
    const m = key.match(/^xl\/worksheets\/sheet(\d+)\.xml$/);
    if (m) maxN = Math.max(maxN, Number(m[1]));
  }
  return maxN + 1;
}

/** Next `sheetId` for an appended `<sheet>` entry. */
function nextSheetId(sheetsEl: Element | undefined): number {
  return nextNumericId(sheetsEl, "sheet", "sheetId", 0);
}

/** Resolve a relationship `rId` to its Target via a rels part root. */
function resolveRelTarget(relsRoot: Element | undefined, rId: string): string | undefined {
  for (const child of relsRoot?.elements ?? []) {
    if (localName(child) === "Relationship" && String(child.attributes?.["Id"]) === rId) {
      const target = child.attributes?.["Target"];
      return target !== undefined ? String(target) : undefined;
    }
  }
  return undefined;
}

/** Rebuild the shared-strings table from the template so new sheets extend it. */
function rebuildSharedStrings(xmlMap: Map<string, Element>): SharedStrings {
  const ss = new SharedStrings();
  const sstRoot = rootOf(xmlMap.get("xl/sharedStrings.xml"));
  if (sstRoot) {
    ss.loadEntries(sharedStringsDesc.parse(sstRoot, STUB_READ_CTX).entries);
  }
  return ss;
}

/** Re-serialize the shared-strings part (called after worksheets are built). */
function rewriteSharedStrings(xmlMap: Map<string, Element>, ss: SharedStrings): void {
  if (ss.count === 0) return;
  xmlMap.set("xl/sharedStrings.xml", toJson(OOXML_XML_DECLARATION + ss.serialize()));
}

/**
 * Append a worksheet: serialize it (registering strings into the shared-strings
 * table), then wire workbook `<sheets>` + workbook rels + content types.
 */
function appendWorksheetToMap(
  xmlMap: Map<string, Element>,
  wsOpts: WorksheetOptions,
  sharedStrings: SharedStrings,
): void {
  const newN = nextWorksheetNumber(xmlMap);
  const sheetPath = `xl/worksheets/sheet${newN}.xml`;
  const sheetName = wsOpts.name ?? `Sheet${newN}`;

  // Worksheet part (no XML declaration — matches generated worksheet parts).
  // Placeholder comments are stripped: patch never wires compiler-owned rels.
  xmlMap.set(
    sheetPath,
    toJson(stripWorksheetPlaceholders(buildWorksheetXml(wsOpts, { sharedStrings }))),
  );

  // workbook.xml <sheets> + workbook.xml.rels (the new rId ties them)
  const wbRoot = rootOf(xmlMap.get("xl/workbook.xml"));
  const wbSheets = wbRoot && findLocalChild(wbRoot, "sheets");
  const wbRels = xmlMap.get("xl/_rels/workbook.xml.rels") ?? createRelationshipFile();
  xmlMap.set("xl/_rels/workbook.xml.rels", wbRels);
  const newRId = getNextRelationshipIndex(wbRels);

  if (wbSheets) {
    const els = wbSheets.elements ?? (wbSheets.elements = []);
    els.push(
      makeElement("sheet", {
        name: sheetName,
        sheetId: String(nextSheetId(wbSheets)),
        "r:id": `rId${newRId}`,
      }),
    );
  }
  appendRelationship(wbRels, newRId, WORKSHEET_REL_TYPE, `worksheets/sheet${newN}.xml`);

  // [Content_Types].xml Override
  const contentTypes = xmlMap.get("[Content_Types].xml");
  if (contentTypes) {
    appendOverride(contentTypes, `/${sheetPath}`, WORKSHEET_CONTENT_TYPE);
  }
}

/** Normalize a worksheet name to its full part path via workbook.xml + rels. */
function resolveSheetPath(xmlMap: Map<string, Element>, name: string): string {
  const wbRoot = rootOf(xmlMap.get("xl/workbook.xml"));
  const wbSheets = wbRoot && findLocalChild(wbRoot, "sheets");
  const sheetEls = (wbSheets?.elements ?? []).filter((e) => localName(e) === "sheet");
  const target = sheetEls.find((e) => String(e.attributes?.["name"]) === name);
  if (!target?.attributes?.["r:id"]) {
    throw new Error(`patchWorkbook: no worksheet named "${name}"`);
  }
  const relTarget = resolveRelTarget(
    rootOf(xmlMap.get("xl/_rels/workbook.xml.rels")),
    String(target.attributes["r:id"]),
  );
  if (!relTarget) {
    throw new Error(`patchWorkbook: worksheet "${name}" relationship target not found`);
  }
  if (relTarget.startsWith("/")) return relTarget.slice(1);
  return relTarget.startsWith("xl/") ? relTarget : `xl/${relTarget}`;
}

/**
 * Replace a worksheet by name: resolve the name to its part via workbook rels,
 * then rewrite only that part's content. Sheet identity, rId, and content types
 * are unchanged.
 */
function replaceWorksheetInMap(
  xmlMap: Map<string, Element>,
  name: string,
  wsOpts: WorksheetOptions,
  sharedStrings: SharedStrings,
): void {
  const sheetPath = resolveSheetPath(xmlMap, name);
  xmlMap.set(
    sheetPath,
    toJson(stripWorksheetPlaceholders(buildWorksheetXml(wsOpts, { sharedStrings }))),
  );
}

/**
 * Remove worksheets by name: drop each `<sheet>` entry, the workbook
 * relationship, and the sheet part with its rels. `definedName` entries scoped
 * to a removed sheet are dropped and the survivors' `localSheetId` (and the
 * workbook view's `activeTab`) are renumbered to the post-removal indices.
 * Parts the sheet's rels point at (comments, drawings, …) are left in place —
 * they may be referenced elsewhere and unreferenced parts are inert in OPC.
 */
function removeWorksheetsFromMap(xmlMap: Map<string, Element>, names: readonly string[]): void {
  const wbRoot = rootOf(xmlMap.get("xl/workbook.xml"));
  const wbSheets = wbRoot && findLocalChild(wbRoot, "sheets");
  const sheetEls = (wbSheets?.elements ?? []).filter((e) => localName(e) === "sheet");
  const wbRelsKey = "xl/_rels/workbook.xml.rels";

  // Resolve every name before touching <sheets> so positions stay stable.
  const doomedEntries = new Set<Element>();
  const doomedRIds = new Set<string>();
  const doomedPositions = new Set<number>();
  const sheetPaths: string[] = [];
  for (const name of names) {
    const entry = sheetEls.find((e) => String(e.attributes?.["name"] ?? "") === name);
    const rId = entry?.attributes?.["r:id"];
    if (!entry || !rId) {
      throw new Error(`patchWorkbook: no worksheet named "${name}"`);
    }
    const relTarget = resolveRelTarget(rootOf(xmlMap.get(wbRelsKey)), String(rId));
    if (!relTarget) {
      throw new Error(`patchWorkbook: worksheet "${name}" relationship target not found`);
    }
    doomedEntries.add(entry);
    doomedRIds.add(String(rId));
    doomedPositions.add(sheetEls.indexOf(entry));
    sheetPaths.push(
      relTarget.startsWith("/")
        ? relTarget.slice(1)
        : relTarget.startsWith("xl/")
          ? relTarget
          : `xl/${relTarget}`,
    );
  }

  if (wbSheets?.elements) {
    wbSheets.elements = wbSheets.elements.filter((e) => !doomedEntries.has(e));
  }
  const wbRelsRoot = rootOf(xmlMap.get(wbRelsKey));
  if (wbRelsRoot?.elements) {
    wbRelsRoot.elements = wbRelsRoot.elements.filter(
      (e) => !(localName(e) === "Relationship" && doomedRIds.has(String(e.attributes?.["Id"]))),
    );
  }

  // Remap sheet positions for definedName@localSheetId and bookView@activeTab.
  const remapIndex = (index: number): number | undefined => {
    if (doomedPositions.has(index)) return undefined;
    let kept = 0;
    for (let p = 0; p < index; p++) {
      if (!doomedPositions.has(p)) kept++;
    }
    return kept;
  };
  if (wbRoot) {
    const definedNames = findLocalChild(wbRoot, "definedNames");
    if (definedNames?.elements) {
      definedNames.elements = definedNames.elements.flatMap((dn) => {
        if (localName(dn) !== "definedName") return [dn];
        const localSheetId = dn.attributes?.["localSheetId"];
        if (localSheetId !== undefined) {
          const mapped = remapIndex(Number(localSheetId));
          if (mapped === undefined) return []; // scoped to a removed sheet — drop
          if (mapped !== Number(localSheetId)) {
            dn.attributes!["localSheetId"] = String(mapped);
          }
        }
        return [dn];
      });
      // An emptied container is not valid — drop it entirely.
      if (definedNames.elements.length === 0) {
        wbRoot.elements = (wbRoot.elements ?? []).filter((e) => e !== definedNames);
      }
    }
    const bookViews = findLocalChild(wbRoot, "bookViews");
    for (const view of bookViews?.elements ?? []) {
      if (localName(view) !== "workbookView") continue;
      const activeTab = view.attributes?.["activeTab"];
      if (activeTab === undefined) continue;
      const mapped = remapIndex(Number(activeTab));
      if (mapped === undefined) {
        delete view.attributes!["activeTab"]; // was on a removed sheet — reset
      } else if (mapped !== Number(activeTab)) {
        view.attributes!["activeTab"] = String(mapped);
      }
    }
  }

  for (const sheetPath of sheetPaths) {
    xmlMap.delete(sheetPath);
    xmlMap.delete(partPathToRelsPath(sheetPath));
    const contentTypes = xmlMap.get("[Content_Types].xml");
    if (contentTypes) removeOverride(contentTypes, `/${sheetPath}`);
  }
}

/** Find an existing relationship of a type in a rels root: { id, target }. */
function findRelByType(
  relsRoot: Element | undefined,
  type: string,
): { id: string; target: string } | undefined {
  for (const child of relsRoot?.elements ?? []) {
    if (localName(child) === "Relationship" && String(child.attributes?.["Type"]) === type) {
      const target = child.attributes?.["Target"];
      if (target !== undefined) {
        return { id: String(child.attributes?.["Id"]), target: String(target) };
      }
    }
  }
  return undefined;
}

/** Largest existing comments file number (xl/comments{n}.xml), for append offset. */
function nextCommentsNumber(xmlMap: Map<string, Element>): number {
  let maxN = 0;
  for (const key of xmlMap.keys()) {
    const m = key.match(/^xl\/comments(\d+)\.xml$/);
    if (m) maxN = Math.max(maxN, Number(m[1]));
  }
  return maxN + 1;
}

/**
 * Insert `<legacyDrawing>` into a worksheet, after `<drawing>` and before the
 * trailing collection elements (CT_Worksheet sequence order). Skipped when one
 * already exists.
 */
function insertLegacyDrawing(wsRoot: Element, rId: string): void {
  const els = wsRoot.elements ?? (wsRoot.elements = []);
  if (els.some((e) => localName(e) === "legacyDrawing")) return;
  const legacy = makeElement("legacyDrawing", { "r:id": rId });
  const afterLegacy = new Set([
    "tableParts",
    "extLst",
    "oleObjects",
    "controls",
    "picture",
    "webPublishItems",
  ]);
  let insertAt = els.length;
  for (const [i, el] of els.entries()) {
    if (afterLegacy.has(localName(el))) {
      insertAt = i;
      break;
    }
  }
  els.splice(insertAt, 0, legacy);
}

/** commentsDesc.stringify ignores its context; this satisfies the WriteContext type. */
const STUB_WRITE_CTX = {} as unknown as WriteContext;

/**
 * Append cell comments to a worksheet, merging with any existing comments part.
 * Wires commentsN.xml + vmlDrawingN.vml (reusing the existing pair when present),
 * the worksheet relationships, the `<legacyDrawing>` anchor, and content types.
 * VML text is written to {@link vmlFiles} (not xmlMap) because of its extension.
 */
function appendCommentsToMap(
  xmlMap: Map<string, Element>,
  vmlFiles: Map<string, string>,
  sheetName: string,
  commentOpts: CommentOptions[],
): void {
  const sheetPath = resolveSheetPath(xmlMap, sheetName);
  const wsRelsKey = partPathToRelsPath(sheetPath);
  const wsRels = xmlMap.get(wsRelsKey) ?? createRelationshipFile();
  xmlMap.set(wsRelsKey, wsRels);

  // Reuse the worksheet's existing comments/vmlDrawing relationships when present.
  const existingComments = findRelByType(rootOf(wsRels), COMMENTS_REL_TYPE);
  const existingVml = findRelByType(rootOf(wsRels), VML_REL_TYPE);

  const commentsN = existingComments
    ? Number((existingComments.target.match(/comments(\d+)\.xml$/) ?? [])[1]) ||
      nextCommentsNumber(xmlMap)
    : nextCommentsNumber(xmlMap);
  const commentsPath = `xl/comments${commentsN}.xml`;
  // Reuse the existing vmlDrawing path when present — its index can differ from
  // the comments index in third-party files.
  const vmlPath = existingVml
    ? `xl/drawings/${existingVml.target.slice(existingVml.target.lastIndexOf("/") + 1)}`
    : `xl/drawings/vmlDrawing${commentsN}.vml`;

  // Merge with the existing comments part if it was already in the package.
  const existingPart = rootOf(xmlMap.get(commentsPath));
  let merged = commentOpts;
  if (existingPart) {
    merged = [...commentsDesc.parse(existingPart, STUB_READ_CTX).comments, ...commentOpts];
  }

  const commentsXml = commentsDesc.stringify({ comments: merged }, STUB_WRITE_CTX);
  if (commentsXml) {
    xmlMap.set(commentsPath, toJson(OOXML_XML_DECLARATION + commentsXml));
  }
  const vmlXml = vmlNotesDesc.stringify({ comments: merged }, STUB_WRITE_CTX);
  if (vmlXml) {
    vmlFiles.set(vmlPath, OOXML_XML_DECLARATION + vmlXml);
  }

  // Worksheet relationships — added only when the part is newly introduced.
  if (!existingComments) {
    const n = getNextRelationshipIndex(wsRels);
    appendRelationship(wsRels, n, COMMENTS_REL_TYPE, `../comments${commentsN}.xml`);
  }
  let vmlRidRef: string;
  if (existingVml) {
    vmlRidRef = existingVml.id;
  } else {
    const n = getNextRelationshipIndex(wsRels);
    appendRelationship(wsRels, n, VML_REL_TYPE, `../drawings/vmlDrawing${commentsN}.vml`);
    vmlRidRef = `rId${n}`;
  }

  // `<legacyDrawing>` anchor on the worksheet (deduped).
  const wsRoot = rootOf(xmlMap.get(sheetPath));
  if (wsRoot) insertLegacyDrawing(wsRoot, vmlRidRef);

  // Content types — comments Override (new part only) + vml Default (deduped).
  const contentTypes = xmlMap.get("[Content_Types].xml");
  if (contentTypes) {
    if (!existingPart) {
      appendOverride(contentTypes, `/${commentsPath}`, COMMENTS_CONTENT_TYPE);
    }
    appendContentType(contentTypes, VML_CONTENT_TYPE, "vml");
  }
}
