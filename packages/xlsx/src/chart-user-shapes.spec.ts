/**
 * Chart user-shapes wiring: fresh authoring emits the companion part, the
 * chart part's own rels entry, and the content-type Override; parse reads
 * the body back through that rels entry.
 *
 * @module
 */
import { unzipSync } from "@office-open/core";
import { describe, expect, it } from "vite-plus/test";

import { generateWorkbook } from "./index";
import { parseWorkbookSync } from "./parse";
import type { WorkbookOptions } from "./parts/file";

const WORKBOOK: WorkbookOptions = {
  worksheets: [
    {
      name: "Data",
      rows: [{ cells: [{ value: "A" }, { value: 1 }] }],
      charts: [
        {
          type: "column",
          title: "Annotated",
          categories: ["A"],
          series: [{ name: "S", values: [1] }],
          col: 4,
          row: 1,
          userShapes: {
            anchors: [
              {
                from: { x: 0.1, y: 0.1 },
                to: { x: 0.4, y: 0.3 },
                object: {
                  type: "shape",
                  id: 1,
                  shapeProperties: { geometry: "rect", fill: { type: "solid", color: "FF0000" } },
                },
              },
            ],
          },
        },
      ],
    },
  ],
};

function fileText(entries: Record<string, Uint8Array>, name: string): string {
  const data = entries[name];
  if (!data) throw new Error(`missing part: ${name}`);
  return new TextDecoder().decode(data);
}

describe("chart userShapes companion part", () => {
  it("emits the part, chart rels entry, and content-type Override", async () => {
    const bytes = await generateWorkbook(WORKBOOK);
    const entries = unzipSync(new Uint8Array(bytes));

    const chart = fileText(entries, "xl/charts/chart1.xml");
    expect(chart).toContain('<c:userShapes r:id="rId1"/>');

    const shapes = fileText(entries, "xl/charts/userShapes1.xml");
    expect(shapes).toContain("<cdr:relSizeAnchor>");
    expect(shapes).toContain("<cdr:sp>");
    expect(shapes).toContain('<a:prstGeom prst="rect">');

    const rels = fileText(entries, "xl/charts/_rels/chart1.xml.rels");
    expect(rels).toContain('Id="rId1"');
    expect(rels).toContain(
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartUserShapes"',
    );
    expect(rels).toContain('Target="userShapes1.xml"');

    const contentTypes = fileText(entries, "[Content_Types].xml");
    expect(contentTypes).toContain(
      'PartName="/xl/charts/userShapes1.xml"' +
        ' ContentType="application/vnd.openxmlformats-officedocument.drawingml.chartUserShapes+xml"',
    );
  });

  it("round-trips the anchors through the chart part rels", async () => {
    const bytes = await generateWorkbook(WORKBOOK);
    const parsed = parseWorkbookSync(bytes);
    const chart = parsed.worksheets?.[0]?.charts?.[0];
    expect(chart?.userShapes?.relationshipId).toBe("rId1");
    expect(chart?.userShapes?.anchors).toHaveLength(1);
    const anchor = chart?.userShapes?.anchors?.[0];
    if (!anchor || !("to" in anchor)) throw new Error("expected a relative anchor");
    expect(anchor.from).toEqual({ x: 0.1, y: 0.1 });
    expect(anchor.object.type).toBe("shape");
    if (anchor.object.type !== "shape") throw new Error("expected a shape object");
    expect(anchor.object.shapeProperties.geometry).toEqual({ preset: "rect" });
  });
});
