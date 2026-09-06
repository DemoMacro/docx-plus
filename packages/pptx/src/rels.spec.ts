import { unzipSync } from "@office-open/core";
import { describe, expect, it } from "vite-plus/test";

import { generatePresentation } from "./generate";
import type { PresentationOptions } from "./shared/file";

// Slide rels mix model allocations (layout, media, …) with passthrough
// re-emission at source ids (verbatim slide islands reference them). The
// source id space is reserved up front, so a media batch on an edited
// round-trip slide can never take an id a source re-use needs — a collision
// would either duplicate the id (package refused by Office) or force the
// claim to renumber (the verbatim r:id reference dangles).

const CHART_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";
const LAYOUT_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout";
const THEME_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme";

const decodeEntry = (buffer: Uint8Array, path: string): string => {
  const unzipped = unzipSync(buffer);
  const entry = unzipped[path];
  if (!entry) throw new Error(`missing zip entry: ${path}`);
  return new TextDecoder().decode(entry);
};

// Source slide1.xml.rels: rId1 layout, rId2 a chart part the verbatim island
// still references by r:id. The edit adds a modeled picture — without the
// reserve the media batch takes rId2 and the chart claim renumbers.
describe("slide rels with passthrough source ids and a modeled picture", () => {
  it("keeps source ids for re-used rels and allocates the picture above them", async () => {
    const options: PresentationOptions = {
      slides: [
        {
          children: [
            {
              picture: {
                type: "png",
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
              },
            },
          ],
        },
      ],
      passthroughRelationships: [
        {
          source: "ppt/slides/slide1.xml",
          relationshipType: LAYOUT_REL,
          target: "../slideLayouts/slideLayout1.xml",
          rId: "rId1",
        },
        {
          source: "ppt/slides/slide1.xml",
          relationshipType: CHART_REL,
          target: "../charts/chart1.xml",
          rId: "rId2",
        },
      ],
      rawParts: [{ path: "ppt/charts/chart1.xml", data: "<c:chartSpace/>" }],
    };

    const buffer = await generatePresentation(options);
    const rels = decodeEntry(buffer, "ppt/slides/_rels/slide1.xml.rels");

    const ids = [...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    // The verbatim chart reference keeps its source id
    expect(rels).toMatch(new RegExp(`Id="rId2"[^>]*Type="${CHART_REL}"`));
    // The fresh picture lands above the source id space
    const imageId = Number(/Id="rId(\d+)"[^>]*relationships\/image"/.exec(rels)?.[1]);
    expect(imageId).toBeGreaterThan(2);
  });
});

// Captured rels whose kind the model re-registers (the master theme, say)
// are absorbed — the claim skips them as owned, so their ids must not be
// reserved: a reservation opens a hole the round-trip then reports as drift
// (theme re-registered above the reserved id, the captured slot unused).
describe("captured rels absorbed by the model", () => {
  it("does not reserve ids for kinds the compiler re-emits, keeping round-trip stable", async () => {
    const options: PresentationOptions = {
      slides: [{ children: [] }],
      passthroughRelationships: [
        {
          source: "ppt/slideMasters/slideMaster1.xml",
          relationshipType: THEME_REL,
          target: "../theme/theme1.xml",
          rId: "rId2",
        },
      ],
    };

    const buffer = await generatePresentation(options);
    const rels = decodeEntry(buffer, "ppt/slideMasters/_rels/slideMaster1.xml.rels");

    const ids = [...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    // The model's theme registration lands at the captured source id — no
    // rId2 hole pushing it to rId3
    expect(rels).toMatch(new RegExp(`Id="rId2"[^>]*Type="${THEME_REL}"`));
    expect(rels).not.toMatch(/Id="rId3"/);
  });
});
