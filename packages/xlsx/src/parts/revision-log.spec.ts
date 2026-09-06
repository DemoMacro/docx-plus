import type { ReadContext, WriteContext } from "@office-open/core/descriptor";
import { parse as parseXml } from "@office-open/xml";
import { describe, expect, it } from "vite-plus/test";

import { generateWorkbook } from "../generate";
import { parseWorkbookSync } from "../parse";
import { revisionHeadersDesc, revisionLogDesc, usersDesc } from "./revision-log";
import type {
  RevisionHeadersOptions,
  RevisionLogOptions,
  RevisionNestedChild,
  UsersOptions,
} from "./revision-log";

// revision descriptors ignore their context, so empty stubs suffice.
const writeCtx = {} as unknown as WriteContext;
const readCtx = {} as unknown as ReadContext;

function parseRoot(xml: string) {
  // nativeTypeAttributes mirrors the real xlsx parse path (ParsedArchive.get
  // coerces "1"/"0" to numbers), so boolean reads are exercised under coercion.
  const el = parseXml(xml, { nativeTypeAttributes: true }).elements?.[0];
  if (!el) throw new Error("parsed document has no root element");
  return el;
}

describe("revisionHeadersDesc round-trip", () => {
  it("round-trips headers with one entry and root flags", () => {
    const opts: RevisionHeadersOptions = {
      guid: "{AAA}",
      revisionId: 1,
      version: 2,
      diskRevisions: true,
      trackRevisions: true,
      headers: [
        {
          guid: "{BBB}",
          dateTime: "2026-06-19T10:00:00Z",
          userName: "Alice",
          rId: "rId1",
          maxSheetId: 1,
          sheetIds: [1],
        },
      ],
    };
    const result = revisionHeadersDesc.parse(
      parseRoot(revisionHeadersDesc.stringify(opts, writeCtx)!),
      readCtx,
    );
    expect(result.guid).toBe("{AAA}");
    expect(result.revisionId).toBe(1);
    expect(result.diskRevisions).toBe(true);
    expect(result.headers).toHaveLength(1);
    expect(result.headers[0]).toMatchObject({
      guid: "{BBB}",
      userName: "Alice",
      rId: "rId1",
      maxSheetId: 1,
      sheetIds: [1],
    });
  });

  it("round-trips boolean root flags under nativeTypeAttributes coercion", () => {
    const opts: RevisionHeadersOptions = {
      guid: "{A}",
      diskRevisions: true,
      trackRevisions: true,
      history: true,
      keepChangeHistory: true,
      protected: true,
      headers: [
        { guid: "{B}", dateTime: "t", userName: "U", rId: "rId1", maxSheetId: 1, sheetIds: [1] },
      ],
    };
    const result = revisionHeadersDesc.parse(
      parseRoot(revisionHeadersDesc.stringify(opts, writeCtx)!),
      readCtx,
    );
    // "1" coerces to number 1 on the real parse path; String() guard recovers it
    expect(result.diskRevisions).toBe(true);
    expect(result.trackRevisions).toBe(true);
    expect(result.history).toBe(true);
    expect(result.keepChangeHistory).toBe(true);
    expect(result.protected).toBe(true);
  });

  it("round-trips reviewed revision ids", () => {
    const opts: RevisionHeadersOptions = {
      guid: "{A}",
      headers: [
        {
          guid: "{B}",
          dateTime: "t",
          userName: "U",
          rId: "rId1",
          maxSheetId: 1,
          sheetIds: [1],
          reviewed: [3, 7],
        },
      ],
    };
    const result = revisionHeadersDesc.parse(
      parseRoot(revisionHeadersDesc.stringify(opts, writeCtx)!),
      readCtx,
    );
    expect(result.headers[0]?.reviewed).toEqual([3, 7]);
  });
});

describe("usersDesc round-trip", () => {
  it("empty users returns undefined from stringify", () => {
    expect(usersDesc.stringify({ users: [] }, writeCtx)).toBeUndefined();
  });

  it("round-trips user entries", () => {
    const opts: UsersOptions = {
      users: [{ guid: "{U1}", name: "Alice", id: 1, dateTime: "2026-06-19T10:00:00Z" }],
    };
    const result = usersDesc.parse(parseRoot(usersDesc.stringify(opts, writeCtx)!), readCtx);
    expect(result.users).toHaveLength(1);
    expect(result.users![0]).toEqual({
      guid: "{U1}",
      name: "Alice",
      id: 1,
      dateTime: "2026-06-19T10:00:00Z",
    });
  });
});

describe("revisionLogDesc round-trip", () => {
  it("empty revisions returns undefined from stringify", () => {
    expect(revisionLogDesc.stringify({ revisions: [] }, writeCtx)).toBeUndefined();
  });

  it("round-trips cellChange with raw new-cell XML", () => {
    const opts: RevisionLogOptions = {
      revisions: [
        {
          type: "cellChange",
          data: {
            rId: 1,
            sheetId: 1,
            newCellXml: `<nc r="A1" t="inlineStr"><is><t>foo</t></is></nc>`,
          },
        },
      ],
    };
    const result = revisionLogDesc.parse(
      parseRoot(revisionLogDesc.stringify(opts, writeCtx)!),
      readCtx,
    );
    expect(result.revisions).toHaveLength(1);
    expect(result.revisions[0]?.type).toBe("cellChange");
    const d = result.revisions[0]?.data as { rId: number; sheetId: number; newCellXml: string };
    expect(d.rId).toBe(1);
    expect(d.sheetId).toBe(1);
    expect(d.newCellXml).toContain("<t>foo</t>");
  });

  it("round-trips rowColumn with structured undo/rcc/rfmt children", () => {
    const opts: RevisionLogOptions = {
      revisions: [
        {
          type: "rowColumn",
          data: {
            rId: 3,
            sheetId: 1,
            ref: "2:2",
            action: "insertRow",
            children: [
              {
                kind: "undo",
                data: {
                  index: 1,
                  expression: "ref",
                  undoRange: "A2:B2",
                  ref3D: true,
                  numberFormat: true,
                },
              },
              {
                kind: "cellChange",
                data: { rId: 4, sheetId: 1, newCellXml: `<nc r="A2"><v>7</v></nc>` },
              },
              { kind: "formatting", data: { sheetId: 1, sqref: "A2" } },
            ],
          },
        },
      ],
    };
    const result = revisionLogDesc.parse(
      parseRoot(revisionLogDesc.stringify(opts, writeCtx)!),
      readCtx,
    );
    const d = result.revisions[0]?.data as { children?: RevisionNestedChild[] };
    expect(d.children).toHaveLength(3);
    expect(d.children![0]).toMatchObject({
      kind: "undo",
      data: { index: 1, expression: "ref", undoRange: "A2:B2", ref3D: true, numberFormat: true },
    });
    expect(d.children![1]?.kind).toBe("cellChange");
    expect(d.children![2]?.kind).toBe("formatting");
  });

  it("round-trips comment (no AG_RevData, no rId)", () => {
    const opts: RevisionLogOptions = {
      revisions: [
        {
          type: "comment",
          data: {
            sheetId: 1,
            cell: "B2",
            guid: "{C}",
            action: "add",
            author: "Alice",
            newLength: 5,
          },
        },
      ],
    };
    const result = revisionLogDesc.parse(
      parseRoot(revisionLogDesc.stringify(opts, writeCtx)!),
      readCtx,
    );
    expect(result.revisions[0]).toMatchObject({
      type: "comment",
      data: { sheetId: 1, cell: "B2", guid: "{C}", action: "add", author: "Alice", newLength: 5 },
    });
  });

  it("round-trips insertSheet, sheetRename, customView, conflict, queryTableField", () => {
    const opts: RevisionLogOptions = {
      revisions: [
        { type: "insertSheet", data: { rId: 2, sheetId: 4, name: "Sheet4", sheetPosition: 3 } },
        { type: "sheetRename", data: { rId: 3, sheetId: 1, oldName: "Old", newName: "New" } },
        { type: "customView", data: { guid: "{V}", action: "add" } },
        { type: "conflict", data: { rId: 4, sheetId: 1, rejected: true } },
        { type: "queryTableField", data: { sheetId: 1, ref: "A1:A3", fieldId: 2 } },
      ],
    };
    const result = revisionLogDesc.parse(
      parseRoot(revisionLogDesc.stringify(opts, writeCtx)!),
      readCtx,
    );
    expect(result.revisions).toHaveLength(5);
    expect(result.revisions[0]).toMatchObject({
      type: "insertSheet",
      data: { sheetId: 4, name: "Sheet4", sheetPosition: 3 },
    });
    expect(result.revisions[1]).toMatchObject({
      type: "sheetRename",
      data: { oldName: "Old", newName: "New" },
    });
    expect(result.revisions[2]).toMatchObject({
      type: "customView",
      data: { guid: "{V}", action: "add" },
    });
    expect(result.revisions[3]).toMatchObject({
      type: "conflict",
      data: { sheetId: 1, rejected: true },
    });
    expect(result.revisions[4]).toMatchObject({
      type: "queryTableField",
      data: { ref: "A1:A3", fieldId: 2 },
    });
  });

  it("round-trips definedName with the full attribute set", () => {
    const opts: RevisionLogOptions = {
      revisions: [
        {
          type: "definedName",
          data: {
            rId: 5,
            name: "MyRange",
            localSheetId: 0,
            hidden: true,
            function: true,
            comment: "a comment",
            formula: "Sheet1!$A$1",
          },
        },
      ],
    };
    const result = revisionLogDesc.parse(
      parseRoot(revisionLogDesc.stringify(opts, writeCtx)!),
      readCtx,
    );
    const entry = result.revisions[0];
    if (!entry) throw new Error("expected definedName revision");
    expect(entry.type).toBe("definedName");
    if (entry.type !== "definedName") return;
    const d = entry.data;
    expect(d.name).toBe("MyRange");
    expect(d.localSheetId).toBe(0);
    expect(d.hidden).toBe(true);
    expect(d.function).toBe(true);
    expect(d.comment).toBe("a comment");
    expect(d.formula).toBe("Sheet1!$A$1");
  });
});

describe("revision end-to-end round-trip", () => {
  it("generate → parse preserves revisionLog", async () => {
    const buffer = await generateWorkbook({
      worksheets: [{ name: "Data", rows: [{ cells: [{ value: "Product" }] }] }],
      revisionLog: {
        headers: {
          guid: "{HDR}",
          revisionId: 1,
          version: 2,
          headers: [
            {
              guid: "{H1}",
              dateTime: "2026-06-19T10:00:00Z",
              userName: "Alice",
              rId: "rId1",
              maxSheetId: 1,
              sheetIds: [1],
            },
          ],
        },
        logs: [
          {
            revisions: [
              {
                type: "cellChange",
                data: {
                  rId: 1,
                  sheetId: 1,
                  newCellXml: `<nc r="A1" t="inlineStr"><is><t>foo</t></is></nc>`,
                },
              },
              {
                type: "comment",
                data: {
                  sheetId: 1,
                  cell: "B2",
                  guid: "{CMT}",
                  action: "add",
                  author: "Alice",
                  newLength: 5,
                },
              },
            ],
          },
        ],
        users: { users: [{ guid: "{U}", name: "Alice", id: 1, dateTime: "2026-06-19T10:00:00Z" }] },
      },
    });
    const parsed = parseWorkbookSync(buffer);
    expect(parsed.revisionLog).toBeDefined();
    expect(parsed.revisionLog!.headers.headers[0]?.userName).toBe("Alice");
    expect(parsed.revisionLog!.headers.headers[0]?.rId).toBe("rId1");
    expect(parsed.revisionLog!.logs).toHaveLength(1);
    expect(parsed.revisionLog!.logs[0]?.revisions).toHaveLength(2);
    expect(parsed.revisionLog!.logs[0]?.revisions[0]?.type).toBe("cellChange");
    expect(parsed.revisionLog!.logs[0]?.revisions[1]?.type).toBe("comment");
    expect(parsed.revisionLog!.users?.users?.[0]?.name).toBe("Alice");
  });
});
