import { unzipSync } from "@office-open/core";
import { describe, expect, it } from "vite-plus/test";

import { generateWorkbook } from "./generate";
import { parseWorkbookSync } from "./parse";
import { patchWorkbook } from "./patch";

const decodeEntry = (buffer: Uint8Array, path: string): string => {
  const unzipped = unzipSync(buffer);
  const entry = unzipped[path];
  if (!entry) throw new Error(`missing zip entry: ${path}`);
  return new TextDecoder().decode(entry);
};

const cellValue = (buf: Uint8Array, sheetIndex: number): string => {
  const parsed = parseWorkbookSync(buf);
  const cell = parsed.worksheets?.[sheetIndex]?.rows?.[0]?.cells?.[0];
  return typeof cell?.value === "string" ? cell.value : "";
};

describe("patchWorkbook worksheets", () => {
  it("appends a worksheet, continuing shared-strings indexing correctly", async () => {
    const template = (await generateWorkbook(
      {
        worksheets: [
          { name: "First", rows: [{ cells: [{ reference: "A1", value: "TEMPLATE_STRING" }] }] },
        ],
      },
      { type: "uint8array" },
    )) as Uint8Array;

    const patched = await patchWorkbook({
      data: template,
      outputType: "uint8array",
      worksheets: {
        append: [
          { name: "Appended", rows: [{ cells: [{ reference: "A1", value: "APPENDED_STRING" }] }] },
        ],
      },
    });

    const parsed = parseWorkbookSync(patched);
    expect(parsed.worksheets?.length).toBe(2);
    expect(parsed.worksheets?.[1]?.name).toBe("Appended");

    // New part exists; it references the shared string by continued index (1).
    const sheet2 = decodeEntry(patched, "xl/worksheets/sheet2.xml");
    expect(sheet2).toContain('<c r="A1" t="s">');
    expect(sheet2).toContain("<v>1</v>");
    expect(decodeEntry(patched, "[Content_Types].xml")).toContain("/xl/worksheets/sheet2.xml");
    expect(decodeEntry(patched, "xl/_rels/workbook.xml.rels")).toContain("worksheets/sheet2.xml");

    // The critical check: continued indexing keeps BOTH strings correct.
    expect(cellValue(patched, 0)).toBe("TEMPLATE_STRING");
    expect(cellValue(patched, 1)).toBe("APPENDED_STRING");

    // sharedStrings grew by exactly one unique string.
    const sst = decodeEntry(patched, "xl/sharedStrings.xml");
    expect(sst).toContain("TEMPLATE_STRING");
    expect(sst).toContain("APPENDED_STRING");
    expect(sst).toMatch(/uniqueCount="2"/);
  });

  it("replaces a worksheet by name without changing the sheet count", async () => {
    const template = (await generateWorkbook(
      {
        worksheets: [
          { name: "Keep", rows: [{ cells: [{ reference: "A1", value: "KEPT" }] }] },
          { name: "Swap", rows: [{ cells: [{ reference: "A1", value: "ORIGINAL" }] }] },
        ],
      },
      { type: "uint8array" },
    )) as Uint8Array;

    const patched = await patchWorkbook({
      data: template,
      outputType: "uint8array",
      worksheets: {
        replace: {
          Swap: { rows: [{ cells: [{ reference: "A1", value: "REPLACED" }] }] },
        },
      },
    });

    const parsed = parseWorkbookSync(patched);
    expect(parsed.worksheets?.length).toBe(2);
    expect(cellValue(patched, 0)).toBe("KEPT");
    expect(cellValue(patched, 1)).toBe("REPLACED");
  });

  it("throws when replacing a non-existent worksheet name", async () => {
    const template = (await generateWorkbook(
      { worksheets: [{ name: "Only", rows: [{ cells: [{ reference: "A1", value: "x" }] }] }] },
      { type: "uint8array" },
    )) as Uint8Array;

    await expect(
      patchWorkbook({
        data: template,
        outputType: "uint8array",
        worksheets: { replace: { Missing: { rows: [] } } },
      }),
    ).rejects.toThrow(/Missing/);
  });

  it("removes worksheets and unwires sheets, rels, and content types", async () => {
    const template = (await generateWorkbook(
      {
        worksheets: [
          { name: "Keep", rows: [{ cells: [{ reference: "A1", value: "KEPT" }] }] },
          { name: "Drop", rows: [{ cells: [{ reference: "A1", value: "DROPPED" }] }] },
        ],
      },
      { type: "uint8array" },
    )) as Uint8Array;

    const patched = await patchWorkbook({
      data: template,
      outputType: "uint8array",
      worksheets: { remove: ["Drop"] },
    });

    const parsed = parseWorkbookSync(patched);
    expect(parsed.worksheets?.length).toBe(1);
    expect(cellValue(patched, 0)).toBe("KEPT");

    // The part, its rels, and its Override are gone from the package.
    const unzipped = unzipSync(patched);
    expect(unzipped["xl/worksheets/sheet2.xml"]).toBeUndefined();
    expect(decodeEntry(patched, "xl/workbook.xml")).not.toContain('name="Drop"');
    expect(decodeEntry(patched, "xl/_rels/workbook.xml.rels")).not.toContain(
      "worksheets/sheet2.xml",
    );
    expect(decodeEntry(patched, "[Content_Types].xml")).not.toContain("/xl/worksheets/sheet2.xml");
  });

  it("renumbers definedName localSheetId and drops names scoped to removed sheets", async () => {
    const template = (await generateWorkbook(
      {
        worksheets: [
          { name: "First", rows: [{ cells: [{ reference: "A1", value: "a" }] }] },
          { name: "Second", rows: [{ cells: [{ reference: "A1", value: "b" }] }] },
          { name: "Third", rows: [{ cells: [{ reference: "A1", value: "c" }] }] },
        ],
        definedNames: [
          { name: "OnThird", value: "Third!A1", localSheetId: 2 },
          { name: "OnFirst", value: "First!A1", localSheetId: 0 },
        ],
      },
      { type: "uint8array" },
    )) as Uint8Array;

    const patched = await patchWorkbook({
      data: template,
      outputType: "uint8array",
      worksheets: { remove: ["First"] },
    });

    const wb = decodeEntry(patched, "xl/workbook.xml");
    // Scoped to a removed sheet — dropped; the survivor renumbers 2 → 1.
    expect(wb).not.toContain("OnFirst");
    expect(wb).toContain('name="OnThird" localSheetId="1"');
  });

  it("throws when removing a non-existent worksheet name", async () => {
    const template = (await generateWorkbook(
      { worksheets: [{ name: "Only", rows: [] }] },
      { type: "uint8array" },
    )) as Uint8Array;

    await expect(
      patchWorkbook({
        data: template,
        outputType: "uint8array",
        worksheets: { remove: ["Nope"] },
      }),
    ).rejects.toThrow(/Nope/);
  });
});

describe("patchWorkbook comments", () => {
  it("appends comments to a worksheet, wiring parts + rels + content types", async () => {
    const template = (await generateWorkbook(
      { worksheets: [{ name: "Data", rows: [{ cells: [{ reference: "A1", value: "hello" }] }] }] },
      { type: "uint8array" },
    )) as Uint8Array;

    const patched = await patchWorkbook({
      data: template,
      outputType: "uint8array",
      comments: {
        Data: [{ cell: "A1", author: "Alice", text: "needs review" }],
      },
    });

    // comments part carries the note + author + cell ref
    const commentsXml = decodeEntry(patched, "xl/comments1.xml");
    expect(commentsXml).toContain("Alice");
    expect(commentsXml).toContain("needs review");
    expect(commentsXml).toContain('ref="A1"');

    // vmlDrawing part exists (legacy note shape)
    expect(decodeEntry(patched, "xl/drawings/vmlDrawing1.vml")).toContain("<v:shape");

    // worksheet anchors the vmlDrawing
    expect(decodeEntry(patched, "xl/worksheets/sheet1.xml")).toContain("<legacyDrawing");

    // worksheet rels wire comments + vmlDrawing
    const wsRels = decodeEntry(patched, "xl/worksheets/_rels/sheet1.xml.rels");
    expect(wsRels).toContain("comments1.xml");
    expect(wsRels).toContain("vmlDrawing1.vml");

    // content types registered
    const types = decodeEntry(patched, "[Content_Types].xml");
    expect(types).toContain("/xl/comments1.xml");
    expect(types).toContain('Extension="vml"');
  });

  it("merges with existing comments on the worksheet", async () => {
    const template = (await generateWorkbook(
      {
        worksheets: [
          {
            name: "Data",
            rows: [{ cells: [{ reference: "A1", value: "x" }] }],
            comments: [{ cell: "A1", author: "Alice", text: "original note" }],
          },
        ],
      },
      { type: "uint8array" },
    )) as Uint8Array;

    const patched = await patchWorkbook({
      data: template,
      outputType: "uint8array",
      comments: {
        Data: [{ cell: "B2", author: "Bob", text: "appended note" }],
      },
    });

    // Both authors present (merged), both notes present
    const commentsXml = decodeEntry(patched, "xl/comments1.xml");
    expect(commentsXml).toContain("original note");
    expect(commentsXml).toContain("appended note");
    expect(commentsXml).toContain("Alice");
    expect(commentsXml).toContain("Bob");

    // Reuses the same comments1.xml — no duplicate override, single vml default
    const types = decodeEntry(patched, "[Content_Types].xml");
    expect((types.match(/\/xl\/comments1\.xml/g) ?? []).length).toBe(1);
    expect((types.match(/Extension="vml"/g) ?? []).length).toBe(1);

    // No duplicate legacyDrawing anchor or duplicate comments rel
    const sheet = decodeEntry(patched, "xl/worksheets/sheet1.xml");
    expect((sheet.match(/<legacyDrawing/g) ?? []).length).toBe(1);
    const wsRels = decodeEntry(patched, "xl/worksheets/_rels/sheet1.xml.rels");
    expect((wsRels.match(/comments1\.xml/g) ?? []).length).toBe(1);
  });

  it("throws when commenting a non-existent worksheet name", async () => {
    const template = (await generateWorkbook(
      { worksheets: [{ name: "Only", rows: [] }] },
      { type: "uint8array" },
    )) as Uint8Array;

    await expect(
      patchWorkbook({
        data: template,
        outputType: "uint8array",
        comments: { Missing: [{ cell: "A1", author: "X", text: "y" }] },
      }),
    ).rejects.toThrow(/Missing/);
  });
});
