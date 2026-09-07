/**
 * sheetData row scanner — the single parse implementation for worksheet rows.
 *
 * `parseWorkbook` requests `deferElements: ["sheetData"]` when reading
 * worksheet parts, so the XML parser captures the container's inner XML
 * verbatim (`Element.raw`) instead of materializing millions of row/cell
 * nodes (~1.75 GB of allocations on a 100k×20 sheet). This scanner walks
 * that string directly into RowOptions. Semantics are field-for-field
 * identical to the former Element-tree walk it replaced.
 *
 * @module
 */

import { unescapeXml } from "@office-open/xml";

import type { CellOptions, FormulaOptions, RichTextOptions, RowOptions } from "./types";

// ── Tag scanning primitives ──

/** Index of the next `<name` whose following char is a tag boundary, or -1. */
function indexOfTag(src: string, name: string, from: number, limit: number): number {
  const open = `<${name}`;
  const nameLen = name.length;
  let p = from;
  for (;;) {
    const idx = src.indexOf(open, p);
    if (idx === -1 || idx >= limit) return -1;
    const after = src.charCodeAt(idx + 1 + nameLen);
    if (
      after === 0x20 ||
      after === 0x09 ||
      after === 0x0a ||
      after === 0x0d ||
      after === 0x2f ||
      after === 0x3e
    ) {
      return idx;
    }
    p = idx + 1 + nameLen;
  }
}

/**
 * Index of the tag's closing `>`, honoring quoted attribute values (a quoted
 * `>` is not a tag end), or -1.
 */
function findTagEnd(src: string, from: number): number {
  let i = from;
  const len = src.length;
  while (i < len) {
    const c = src.charCodeAt(i);
    if (c === 0x22) {
      const close = src.indexOf('"', i + 1);
      if (close === -1) return -1;
      i = close + 1;
      continue;
    }
    if (c === 0x3e) return i;
    i++;
  }
  return -1;
}

/** Visit `name="value"` pairs inside a tag (from = after tag name, to = before `>`/`/>`). */
function scanAttrs(
  src: string,
  from: number,
  to: number,
  visit: (name: string, value: string) => void,
): void {
  let i = from;
  while (i < to) {
    while (i < to) {
      const c = src.charCodeAt(i);
      if (c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) break;
      i++;
    }
    if (i >= to) return;
    const nameStart = i;
    while (i < to && src.charCodeAt(i) !== 0x3d) i++;
    if (i >= to) return;
    const name = src.slice(nameStart, i);
    i++; // '='
    while (i < to) {
      const c = src.charCodeAt(i);
      if (c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) break;
      i++;
    }
    const quote = src.charCodeAt(i);
    if (quote !== 0x22 && quote !== 0x27) return;
    i++;
    const valueStart = i;
    while (i < to && src.charCodeAt(i) !== quote) i++;
    visit(name, unescapeXml(src.slice(valueStart, i)));
    i++;
  }
}

/** parseOnOff truthiness for on/off attribute values ("1"/"true"/"on" plus the
 *  single-letter t/f Word 2007 wrote). */
function isOn(value: string): boolean {
  const lower = value.length <= 5 ? value.toLowerCase() : value;
  return lower === "1" || lower === "true" || lower === "on" || lower === "t";
}

/**
 * Text content of a leaf element's inner XML slice, matching the Element-tree
 * `textOf` semantics: text is unescaped and CDATA sections are skipped
 * (text nodes only). Self-closing / empty content yields "".
 */
function textContent(src: string, from: number, to: number): string {
  if (to <= from) return "";
  let text = src.slice(from, to);
  // CDATA would appear verbatim in the slice; textOf ignores cdata nodes.
  if (text.indexOf("<![CDATA[") !== -1) {
    text = text.replace(/<!\[CDATA\[.*?\]\]>/gs, "");
  }
  return unescapeXml(text);
}

/** Inner span of the first `<t>` that is a direct child of an `<is>` slice. */
function inlineStringText(src: string, from: number, to: number): string | undefined {
  let q = from;
  while (q < to) {
    const lt = src.indexOf("<", q);
    if (lt === -1 || lt >= to) break;
    const tEnd = findTagEnd(src, lt + 1);
    if (tEnd === -1 || tEnd >= to) break;
    const afterLt = lt + 1;
    let nameEnd = afterLt;
    while (nameEnd < tEnd) {
      const c = src.charCodeAt(nameEnd);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x2f) break;
      nameEnd++;
    }
    const name = src.slice(afterLt, nameEnd);
    if (name === "t") {
      if (src.charCodeAt(tEnd - 1) === 0x2f) return "";
      const close = src.indexOf("</t>", tEnd + 1);
      return close === -1 ? "" : textContent(src, tEnd + 1, close);
    }
    if (name === "r") {
      // Rich-text run: its <t> is nested, not a direct child — skip the run.
      const close = src.indexOf("</r>", tEnd + 1);
      if (close === -1) break;
      q = close + 4;
      continue;
    }
    q = tEnd + 1;
  }
  return undefined;
}

// ── Row scanner ──

/**
 * Scan `sheetData` inner XML into RowOptions. Cell/row styles stay as raw
 * cellXfs indices (the SDK's StyleIndex model) — the style table travels
 * alongside on WorkbookOptions and the compiler adopts it wholesale, so the
 * indices resolve exactly as they did in the source file.
 */
export function parseSheetDataRows(
  raw: string,
  strings: (string | RichTextOptions)[],
): RowOptions[] {
  const rows: RowOptions[] = [];
  const len = raw.length;
  let pos = 0;

  for (;;) {
    const rowOpen = indexOfTag(raw, "row", pos, len);
    if (rowOpen === -1) break;
    const tagEnd = findTagEnd(raw, rowOpen + 4);
    if (tagEnd === -1) break;
    const selfClosing = raw.charCodeAt(tagEnd - 1) === 0x2f;
    const attrEnd = selfClosing ? tagEnd - 1 : tagEnd;

    const row: RowOptions = {};
    let rowClose = tagEnd;
    let rowStyleIdx: number | undefined;
    scanAttrs(raw, rowOpen + 4, attrEnd, (name, value) => {
      switch (name) {
        case "r": {
          const n = Number(value);
          if (!isNaN(n)) row.rowNumber = n;
          break;
        }
        case "ht": {
          const n = Number(value);
          if (!isNaN(n)) row.height = n;
          break;
        }
        case "hidden":
          if (isOn(value)) row.hidden = true;
          break;
        case "spans":
          row.spans = value;
          break;
        case "customFormat":
          if (isOn(value)) row.customFormat = true;
          break;
        case "thickTop":
          if (isOn(value)) row.thickTop = true;
          break;
        case "thickBot":
          if (isOn(value)) row.thickBot = true;
          break;
        case "ph":
          if (isOn(value)) row.phonetic = true;
          break;
        case "outlineLevel": {
          const n = Number(value);
          if (!isNaN(n)) row.outlineLevel = n;
          break;
        }
        case "collapsed":
          if (isOn(value)) row.collapsed = true;
          break;
        case "s": {
          const n = Number(value);
          if (!isNaN(n)) rowStyleIdx = n;
          break;
        }
      }
    });
    if (rowStyleIdx !== undefined) {
      row.style = rowStyleIdx;
    }

    const cells: CellOptions[] = [];
    if (!selfClosing) {
      rowClose = raw.indexOf("</row>", tagEnd + 1);
      if (rowClose === -1) break;
      let cp = tagEnd + 1;
      for (;;) {
        const cellOpen = indexOfTag(raw, "c", cp, rowClose);
        if (cellOpen === -1) break;
        const cellTagEnd = findTagEnd(raw, cellOpen + 2);
        if (cellTagEnd === -1) break;
        const cellSelfClosing = raw.charCodeAt(cellTagEnd - 1) === 0x2f;
        const cell: CellOptions = {};
        let type: string | undefined;
        let styleIdx: number | undefined;

        // Inline attribute scan for the five cell attributes (r/t/s/cm/vm).
        // scanAttrs + closure costs one closure allocation and one name-string
        // slice per attribute on a 2M-cell sheet; dispatching on name length +
        // first char keeps the hot attributes allocation-free (other names are
        // skipped, same as the switch default they replace).
        let ap = cellOpen + 2;
        const attrLimit = cellSelfClosing ? cellTagEnd - 1 : cellTagEnd;
        while (ap < attrLimit) {
          while (ap < attrLimit) {
            const c = raw.charCodeAt(ap);
            if (c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) break;
            ap++;
          }
          if (ap >= attrLimit) break;
          const aNameStart = ap;
          while (ap < attrLimit && raw.charCodeAt(ap) !== 0x3d) ap++;
          if (ap >= attrLimit) break;
          const aNameLen = ap - aNameStart;
          ap++; // '='
          while (ap < attrLimit) {
            const c = raw.charCodeAt(ap);
            if (c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) break;
            ap++;
          }
          const aQuote = raw.charCodeAt(ap);
          if (aQuote !== 0x22 && aQuote !== 0x27) break;
          ap++;
          const aValueStart = ap;
          while (ap < attrLimit && raw.charCodeAt(ap) !== aQuote) ap++;
          const aFirst = raw.charCodeAt(aNameStart);
          if (aNameLen === 1) {
            if (aFirst === 0x72 /* r */) {
              cell.reference = unescapeXml(raw.slice(aValueStart, ap));
            } else if (aFirst === 0x74 /* t */) {
              type = unescapeXml(raw.slice(aValueStart, ap));
            } else if (aFirst === 0x73 /* s */) {
              const n = Number(unescapeXml(raw.slice(aValueStart, ap)));
              if (!isNaN(n)) styleIdx = n;
            }
          } else if (aNameLen === 2 && aFirst === 0x63 /* cm */) {
            const n = Number(unescapeXml(raw.slice(aValueStart, ap)));
            if (!isNaN(n)) cell.cellMetadataId = n;
          } else if (aNameLen === 2 && aFirst === 0x76 /* vm */) {
            const n = Number(unescapeXml(raw.slice(aValueStart, ap)));
            if (!isNaN(n)) cell.valueMetadataId = n;
          }
          ap++;
        }

        if (styleIdx !== undefined) {
          cell.style = styleIdx;
        }

        let cellEnd = cellTagEnd + 1;
        if (!cellSelfClosing) {
          const cellClose = raw.indexOf("</c>", cellTagEnd + 1);
          if (cellClose === -1) break;
          cellEnd = cellClose + 4;
          let vText: string | undefined;
          let vNum: number | undefined;
          let inlineText: string | undefined;
          let hasInline = false;
          let formula: FormulaOptions | undefined;

          let p = cellTagEnd + 1;
          while (p < cellClose) {
            const lt = raw.indexOf("<", p);
            if (lt === -1 || lt >= cellClose) break;
            const tEnd = findTagEnd(raw, lt + 1);
            if (tEnd === -1) break;
            let nameEnd = lt + 2;
            while (nameEnd < tEnd) {
              const c = raw.charCodeAt(nameEnd);
              if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x2f) break;
              nameEnd++;
            }
            // Dispatch on tag-name length + first char: v/is/f cover the
            // children of virtually every cell, so the common path never
            // allocates a name string.
            const nameLen = nameEnd - (lt + 1);
            const first = raw.charCodeAt(lt + 1);
            if (nameLen === 1 && first === 0x76 /* v */) {
              if (raw.charCodeAt(tEnd - 1) === 0x2f) {
                if (vText === undefined) vText = "";
              } else {
                const close = raw.indexOf("</v>", tEnd + 1);
                if (close === -1) break;
                if (vText === undefined && vNum === undefined) {
                  // Fast path: pure-digit <v> content (about half the cells in
                  // data-heavy sheets) parses straight from char codes — no
                  // slice, no entity scan, no Number() re-scan. Up to 15
                  // digits is always exact in float64 (same bound as
                  // nativeTypeValue); anything else takes the string path.
                  const vStart = tEnd + 1;
                  const vLen = close - vStart;
                  let n = 0;
                  let allDigits = vLen > 0 && vLen <= 15;
                  if (allDigits) {
                    for (let q = vStart; q < close; q++) {
                      const d = raw.charCodeAt(q) - 0x30;
                      if (d < 0 || d > 9) {
                        allDigits = false;
                        break;
                      }
                      n = n * 10 + d;
                    }
                  }
                  if (allDigits) vNum = n;
                  else vText = textContent(raw, vStart, close);
                }
                p = close + 4;
                continue;
              }
            } else if (nameLen === 2 && first === 0x69 /* is */) {
              hasInline = true;
              const close = raw.indexOf("</is>", tEnd + 1);
              const isEnd = close === -1 ? cellClose : close;
              if (inlineText === undefined) inlineText = inlineStringText(raw, tEnd + 1, isEnd);
              if (close === -1) break;
              p = close + 5;
              continue;
            } else if (nameLen === 1 && first === 0x66 /* f */) {
              const fSelfClosing = raw.charCodeAt(tEnd - 1) === 0x2f;
              const f: FormulaOptions = { formula: "" };
              scanAttrs(raw, nameEnd, fSelfClosing ? tEnd - 1 : tEnd, (n3, v3) => {
                switch (n3) {
                  case "t":
                    if (v3 !== "normal") f.type = v3 as FormulaOptions["type"];
                    break;
                  case "ref":
                    f.reference = v3;
                    break;
                  case "si": {
                    const n = Number(v3);
                    if (!isNaN(n)) f.sharedIndex = n;
                    break;
                  }
                  case "aca":
                    if (isOn(v3)) f.aca = true;
                    break;
                  case "ca":
                    if (isOn(v3)) f.calculateCell = true;
                    break;
                  case "bx":
                    if (isOn(v3)) f.arrayContext = true;
                    break;
                }
              });
              if (fSelfClosing) {
                p = tEnd + 1;
              } else {
                const close = raw.indexOf("</f>", tEnd + 1);
                if (close === -1) break;
                f.formula = textContent(raw, tEnd + 1, close);
                p = close + 4;
              }
              if (formula === undefined) formula = f;
              continue;
            }
            p = tEnd + 1;
          }

          // Cell value — resolution order matches the former tree walk.
          if (type === "s" && (vText !== undefined || vNum !== undefined)) {
            const idx = vNum !== undefined ? vNum : parseInt(vText!, 10);
            cell.value = strings[idx] ?? "";
          } else if (type === "b" && (vText !== undefined || vNum !== undefined)) {
            cell.value = vNum !== undefined ? vNum === 1 : vText === "1";
          } else if (type === "e" && (vText !== undefined || vNum !== undefined)) {
            cell.error = vNum !== undefined ? String(vNum) : vText!;
          } else if (type === "inlineStr" && hasInline) {
            cell.value = inlineText ?? "";
          } else if (vNum !== undefined) {
            cell.value = vNum;
          } else if (vText !== undefined) {
            const num = Number(vText);
            cell.value = isNaN(num) ? vText : num;
          }
          if (formula !== undefined) cell.formula = formula;
        }

        cells.push(cell);
        cp = cellEnd;
      }
    }

    row.cells = cells;
    rows.push(row);
    pos = selfClosing ? tagEnd + 1 : rowClose + 6;
  }

  return rows;
}
