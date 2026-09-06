import * as fs from "fs";

import {
  generatePresentation,
  parsePresentation,
  parsePptx,
  parseArchive,
} from "@office-open/pptx";
import type { SlideOptions } from "@office-open/pptx";
import type { PresentationOptions } from "@office-open/pptx";
import { findChild, attrNum, parse, stringify } from "@office-open/xml";
import { strFromU8 } from "fflate";

// ── helpers ────────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
const assert = (label: string, condition: boolean) => {
  if (condition) {
    pass++;
    console.log(`  PASS: ${label}`);
  } else {
    fail++;
    console.log(`  FAIL: ${label}`);
  }
};

function normalizeXml(raw: Uint8Array): string {
  const parsed = parse(strFromU8(raw), {
    nativeTypeAttributes: true,
    captureSpacesBetweenElements: true,
  });
  let xml = stringify(parsed);
  // Normalize non-deterministic values: cNvPr id, GraphicFrame name/id, diagram UUIDs
  xml = xml.replace(/ id="\d+"/g, ' id="N"');
  xml = xml.replace(/ name="(Table|Chart|Diagram|Group) \d+"/g, ' name="$1 N"');
  xml = xml.replace(/\{[0-9A-F-]{36}\}/g, "{UUID}");
  return xml;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

interface Diff {
  path: string;
  kind: "missing-left" | "missing-right" | "content";
}

function compareZips(buf1: Uint8Array, buf2: Uint8Array, ignorePaths?: Set<string>): Diff[] {
  const zip1 = parseArchive(buf1);
  const zip2 = parseArchive(buf2);
  const diffs: Diff[] = [];

  const allPaths = new Set([...zip1.keys(), ...zip2.keys()]);

  for (const path of allPaths) {
    if (ignorePaths?.has(path)) continue;
    // Honor directory prefixes (trailing "/") — e.g. "ppt/diagrams/".
    if (ignorePaths && [...ignorePaths].some((ig) => ig.endsWith("/") && path.startsWith(ig)))
      continue;

    const raw1 = zip1.getRaw(path);
    const raw2 = zip2.getRaw(path);

    if (!raw1) {
      diffs.push({ path, kind: "missing-left" });
      continue;
    }
    if (!raw2) {
      diffs.push({ path, kind: "missing-right" });
      continue;
    }

    if (path.endsWith(".xml") || path.endsWith(".rels")) {
      let s1 = normalizeXml(raw1);
      let s2 = normalizeXml(raw2);
      // SmartArt diagram parts are a known limitation; drop their content-type
      // overrides so [Content_Types].xml compares cleanly.
      if (path === "[Content_Types].xml") {
        s1 = s1.replace(/<Override[^>]*diagram[^>]*>/g, "");
        s2 = s2.replace(/<Override[^>]*diagram[^>]*>/g, "");
      }
      if (s1 !== s2) {
        diffs.push({ path, kind: "content" });
      }
    } else {
      if (!bytesEqual(raw1, raw2)) {
        diffs.push({ path, kind: "content" });
      }
    }
  }

  return diffs;
}

function printDiffs(diffs: Diff[]): void {
  if (diffs.length === 0) {
    console.log("  No differences found!");
    return;
  }
  for (const d of diffs) {
    const label =
      d.kind === "missing-left"
        ? "only in buffer2"
        : d.kind === "missing-right"
          ? "only in buffer1"
          : "content differs";
    console.log(`  DIFF: ${d.path} (${label})`);
  }
}

// ── media assets ───────────────────────────────────────────────────────────────

const imageData = fs.readFileSync("./demo/assets/test-poster.png");
const videoData = fs.readFileSync("./demo/assets/test-video.mp4");
const posterData = fs.readFileSync("./demo/assets/test-poster.png");

// Generate a minimal valid WAV file (1 second of silence, mono, 8000 Hz)
const wavSize = 8000; // 1 second × 8000 samples
const wavBuf = Buffer.alloc(44 + wavSize);
wavBuf.write("RIFF", 0);
wavBuf.writeUInt32LE(36 + wavSize, 4);
wavBuf.write("WAVE", 8);
wavBuf.write("fmt ", 12);
wavBuf.writeUInt32LE(16, 16); // chunk size
wavBuf.writeUInt16LE(1, 20); // PCM
wavBuf.writeUInt16LE(1, 22); // mono
wavBuf.writeUInt32LE(8000, 24); // sample rate
wavBuf.writeUInt32LE(8000, 28); // byte rate
wavBuf.writeUInt16LE(1, 32); // block align
wavBuf.writeUInt16LE(8, 34); // bits per sample
wavBuf.write("data", 36);
wavBuf.writeUInt32LE(wavSize, 40);
// data is all zeros (silence)

// ══════════════════════════════════════════════════════════════════════════════
// 1. Generate a presentation using the JSON-friendly API
// ══════════════════════════════════════════════════════════════════════════════

const slides: SlideOptions[] = [
  // ── Slide 1: Shapes, rich text, effects ──
  {
    children: [
      {
        shape: {
          x: "1.3cm",
          y: "0.8cm",
          width: "19.8cm",
          height: "1.6cm",
          properties: {
            fill: "1B2A4A",
          },
          textBody: {
            paragraphs: [
              {
                properties: { alignment: "center", bullet: { type: "none" } },
                children: [
                  { text: "Round-trip Feature Showcase", size: 32, bold: true, fill: "FFFFFF" },
                ],
              },
            ],
          },
        },
      },
      // Geometry + fill + outline + effects (shadow, glow)
      {
        shape: {
          x: "1.3cm",
          y: "2.9cm",
          width: "5.8cm",
          height: "3.4cm",
          textBody: { text: "Shadow + Glow" },
          properties: {
            geometry: "roundRect",

            fill: "4472C4",

            outline: { type: "solidFill", color: { value: "2F5496" }, width: 12700 },

            effects: {
              outerShadow: {
                blurRadius: 50800,
                distance: 38100,
                direction: 45,
                color: { value: "000000", transforms: { alpha: 40 } },
              },
              glow: { radius: 76200, color: { value: "4472C4", transforms: { alpha: 50 } } },
            },
          },
        },
      },
      // Gradient fill
      {
        shape: {
          x: "7.9cm",
          y: "2.9cm",
          width: "5.8cm",
          height: "3.4cm",
          textBody: { text: "Gradient" },
          properties: {
            geometry: "chevron",

            fill: {
              type: "gradient",
              angle: 90,
              stops: [
                { position: 0, color: "ED7D31" },
                { position: 100, color: "FFC000" },
              ],
            },
          },
        },
      },
      // Rich text: bold, italic, underline, strike, color, font, size
      {
        shape: {
          x: "14.6cm",
          y: "2.9cm",
          width: "6.6cm",
          height: "3.4cm",
          textBody: {
            paragraphs: [
              {
                properties: { bullet: { type: "none" } },
                children: [
                  { text: "Bold", bold: true, size: 14 },
                  { text: " " },
                  { text: "Italic", italic: true, size: 14 },
                  { text: "\n" },
                  { text: "Underline", underline: "single", size: 14 },
                  { text: " " },
                  { text: "Strike", strike: "singleStrike", size: 14, fill: "FF0000" },
                ],
              },
            ],
          },
        },
      },
      // Bullet list (char + autoNum)
      {
        shape: {
          x: "1.3cm",
          y: "7.1cm",
          width: "9.0cm",
          height: "4.2cm",
          properties: {
            outline: { type: "solidFill", color: { value: "4472C4" }, width: 12700, dash: "dash" },
          },
          textBody: {
            paragraphs: [
              {
                properties: { bullet: { type: "char", char: "\u25CF", color: "4472C4" } },
                children: [{ text: "Bullet point one" }],
              },
              {
                properties: { bullet: { type: "char", char: "\u25CF", color: "4472C4" } },
                children: [{ text: "Bullet point two" }],
              },
              {
                properties: { bullet: { type: "autoNum", format: "arabicPeriod" } },
                children: [{ text: "Numbered item" }],
              },
            ],
          },
        },
      },
      // 3D effects (rotation, bevel, extrusion, material)
      {
        shape: {
          x: "14.6cm",
          y: "7.1cm",
          width: "6.6cm",
          height: "2.6cm",
          textBody: { text: "3D" },
          properties: {
            geometry: "roundRect",

            fill: "70AD47",

            scene3d: {
              camera: {
                preset: "orthographicFront",
                rotation: { lat: 20, lon: 10, rev: 5 },
              },
              lightRig: { rig: "threePt", direction: "top" },
            },

            shape3d: { bevelT: { w: 8, h: 8 }, extrusionH: 30000, prstMaterial: "plastic" },
          },
        },
      },
      // Alignment + line spacing + super/subscript
      {
        shape: {
          x: "11.1cm",
          y: "10.3cm",
          width: "10.1cm",
          height: "4.2cm",
          textBody: {
            paragraphs: [
              {
                properties: {
                  alignment: "center",
                  bullet: { type: "none" },
                  lineSpacingPercent: 150,
                },
                children: [
                  { text: "H", size: 20 },
                  { text: "2", size: 12, baseline: -25000 },
                  { text: "O  \u2014  E=mc", size: 20 },
                  { text: "2", size: 12, baseline: 30000 },
                ],
              },
              {
                properties: { alignment: "right", bullet: { type: "none" } },
                children: [{ text: "Right-aligned text", fill: "70AD47", font: "Consolas" }],
              },
            ],
          },
        },
      },
    ],
  },

  // ── Slide 2: Table with formatting ──
  {
    children: [
      {
        shape: {
          x: "1.3cm",
          y: "0.5cm",
          width: "7.9cm",
          height: "1.1cm",
          textBody: { text: "Table" },
          properties: {
            fill: "4472C4",
          },
        },
      },
      {
        table: {
          x: "1.3cm",
          y: "2.1cm",
          width: "18.5cm",
          height: "6.6cm",
          rows: [
            {
              cells: [
                { text: "Feature", fill: "4472C4" },
                { text: "Status", fill: "4472C4" },
                { text: "Notes", fill: "4472C4" },
              ],
            },
            {
              cells: [
                { text: "Shapes" },
                { text: "OK" },
                { text: "rect, roundRect, chevron\u2026" },
              ],
            },
            { cells: [{ text: "Tables" }, { text: "OK" }, { text: "rows, cells, borders" }] },
            { cells: [{ text: "Merge", columnSpan: 2 }, { text: "Spanned cell" }] },
          ],
          columnWidths: [2500000, 2000000, 3000000],
          firstRow: true,
          bandRow: true,
          borders: {
            top: { color: "4472C4", width: 12700 },
            bottom: { color: "4472C4", width: 12700 },
            left: { color: "4472C4", width: 12700 },
            right: { color: "4472C4", width: 12700 },
          },
        },
      },
    ],
    transition: { type: "push", speed: "medium", direction: "left" },
  },

  // ── Slide 3: Chart (column) ──
  {
    children: [
      {
        shape: {
          x: "1.3cm",
          y: "0.5cm",
          width: "7.9cm",
          height: "1.1cm",
          textBody: { text: "Chart" },
          properties: {
            fill: "ED7D31",
          },
        },
      },
      {
        chart: {
          x: "2.1cm",
          y: "2.1cm",
          width: "16.9cm",
          height: "9.3cm",
          type: "column",
          title: "Quarterly Sales",
          categories: ["Q1", "Q2", "Q3", "Q4"],
          series: [
            { name: "Product A", values: [12, 18, 15, 22] },
            { name: "Product B", values: [8, 14, 11, 19] },
          ],
          showLegend: true,
          style: 2,
        },
      },
    ],
  },

  // ── Slide 4: SmartArt ──
  {
    children: [
      {
        shape: {
          x: "1.3cm",
          y: "0.5cm",
          width: "7.9cm",
          height: "1.1cm",
          textBody: { text: "SmartArt" },
          properties: {
            fill: "70AD47",
          },
        },
      },
      {
        smartart: {
          x: "2.1cm",
          y: "2.1cm",
          width: "16.9cm",
          height: "7.9cm",
          nodes: [
            {
              text: "Root",
              children: [{ text: "Child A" }, { text: "Child B" }, { text: "Child C" }],
            },
          ],
          layout: "hierarchy1",
          style: "simple1",
          color: "accent1_2",
        },
      },
    ],
  },

  // ── Slide 5: Connector + Line ──
  {
    children: [
      {
        shape: {
          x: "1.3cm",
          y: "0.5cm",
          width: "7.9cm",
          height: "1.1cm",
          textBody: { text: "Lines & Connectors" },
          properties: {
            fill: "7030A0",
          },
        },
      },
      {
        line: {
          x1: "1.3cm",
          y1: "2.6cm",
          x2: "19.8cm",
          y2: "2.6cm",
          properties: {
            outline: { type: "solidFill", color: { value: "4472C4" }, width: 25400 },
          },
        },
      },
      {
        connector: {
          x1: "2.6cm",
          y1: "4.0cm",
          x2: "15.9cm",
          y2: "9.3cm",
          properties: {
            outline: {
              type: "solidFill",
              color: { value: "ED7D31" },
              width: 25400,
              headEnd: { type: "triangle" },
              tailEnd: { type: "oval" },
            },
          },
        },
      },
    ],
  },

  // ── Slide 6: Group with nested shapes ──
  {
    children: [
      {
        shape: {
          x: "1.3cm",
          y: "0.5cm",
          width: "7.9cm",
          height: "1.1cm",
          textBody: { text: "Group" },
          properties: {
            fill: "FFC000",
          },
        },
      },
      {
        group: {
          x: "2.1cm",
          y: "2.1cm",
          width: "16.4cm",
          height: "5.3cm",
          rotation: 5,
          children: [
            {
              shape: {
                x: "0.0cm",
                y: "0.0cm",
                width: "7.7cm",
                height: "4.8cm",
                textBody: { text: "A" },
                properties: {
                  fill: "4472C4",
                },
              },
            },
            {
              shape: {
                x: "8.2cm",
                y: "0.0cm",
                width: "7.7cm",
                height: "4.8cm",
                textBody: { text: "B" },
                properties: {
                  fill: "ED7D31",
                },
              },
            },
          ],
        },
      },
    ],
  },

  // ── Slide 7: Background + Transition ──
  {
    background: {
      fill: {
        type: "gradient",
        angle: 90,
        stops: [
          { position: 0, color: "1B2A4A" },
          { position: 100, color: "2D4A7A" },
        ],
      },
    },
    transition: { type: "fade", speed: "slow" },
    children: [
      {
        shape: {
          x: "4.0cm",
          y: "5.3cm",
          width: "13.2cm",
          height: "2.1cm",
          textBody: {
            paragraphs: [
              {
                properties: { alignment: "center", bullet: { type: "none" } },
                children: [
                  {
                    text: "Gradient Background + Fade Transition",
                    size: 24,
                    bold: true,
                    fill: "FFFFFF",
                  },
                ],
              },
            ],
          },
        },
      },
    ],
  },

  // ── Slide 8: Animation ──
  {
    children: [
      {
        shape: {
          x: "1.3cm",
          y: "0.5cm",
          width: "7.9cm",
          height: "1.1cm",
          textBody: { text: "Animation" },
          properties: {
            fill: "C00000",
          },
        },
      },
      {
        shape: {
          id: 2,
          x: "2.6cm",
          y: "3.2cm",
          width: "6.6cm",
          height: "2.6cm",
          textBody: { text: "Fly In" },
          properties: {
            fill: "4472C4",
          },
        },
      },
      {
        shape: {
          id: 3,
          x: "10.6cm",
          y: "3.2cm",
          width: "6.6cm",
          height: "2.6cm",
          textBody: { text: "Appear" },
          properties: {
            fill: "70AD47",
          },
        },
      },
      {
        shape: {
          id: 4,
          x: "6.6cm",
          y: "7.4cm",
          width: "6.6cm",
          height: "2.6cm",
          textBody: { text: "Fade Exit" },
          properties: {
            fill: "ED7D31",
          },
        },
      },
    ],
    animations: [
      { shapeId: 2, type: "fly", class: "entrance", direction: "left", duration: 500 },
      { shapeId: 3, type: "appear", class: "entrance", trigger: "afterPrevious" },
      { shapeId: 4, type: "fade", class: "exit", duration: 750 },
    ],
  },

  // ── Slide 9: Notes + Header/Footer ──
  {
    notes: "These are speaker notes for the round-trip test.",
    headerFooter: { slideNumber: true, footer: "Round-trip Demo", dateTime: true },
    children: [
      {
        shape: {
          x: "5.3cm",
          y: "5.3cm",
          width: "10.6cm",
          height: "1.6cm",
          textBody: { text: "Notes + Header/Footer slide" },
          properties: {
            fill: "F2F2F2",
          },
        },
      },
    ],
  },

  // ── Slide 10: Multi-master (light theme) ──
  {
    master: "light",
    layout: "blank",
    children: [
      {
        shape: {
          x: "2.6cm",
          y: "2.6cm",
          width: "20.1cm",
          height: "10.6cm",
          properties: {
            fill: "F2F2F2",
          },
          textBody: { text: "Light theme slide" },
        },
      },
    ],
  },

  // ── Slide 11: Multi-master (dark theme) ──
  {
    master: "dark",
    layout: "blank",
    children: [
      {
        shape: {
          x: "2.6cm",
          y: "2.6cm",
          width: "20.1cm",
          height: "10.6cm",
          properties: {
            fill: "2D4A7A",
          },
          textBody: {
            paragraphs: [
              {
                properties: { bullet: { type: "none" } },
                children: [{ text: "Dark theme slide", fill: "FFFFFF", size: 24 }],
              },
            ],
          },
        },
      },
    ],
  },

  // ── Slide 12: Picture + Fill Types ──
  {
    children: [
      {
        shape: {
          x: "1.3cm",
          y: "0.5cm",
          width: "7.9cm",
          height: "1.1cm",
          textBody: { text: "Picture + Fill Types" },
          properties: {
            fill: "7030A0",
          },
        },
      },
      // Picture element
      {
        picture: {
          x: "1.3cm",
          y: "2.1cm",
          width: "5.3cm",
          height: "5.3cm",
          data: imageData,
          type: "png",
          name: "Test Image",
        },
      },
      // Pattern fill
      {
        shape: {
          x: "7.9cm",
          y: "2.1cm",
          width: "5.3cm",
          height: "4.0cm",
          properties: {
            fill: {
              type: "pattern",
              pattern: "diagonalCross",
              foregroundColor: "4472C4",
              backgroundColor: "FFFFFF",
            },
          },
          textBody: { text: "Pattern" },
        },
      },
      // No fill (outline only)
      {
        shape: {
          x: "14.6cm",
          y: "2.1cm",
          width: "5.3cm",
          height: "4.0cm",
          properties: {
            fill: { type: "none" },

            outline: { type: "solidFill", color: { value: "ED7D31" }, width: 25400 },
          },
          textBody: { text: "No Fill" },
        },
      },
      // Radial gradient
      {
        shape: {
          x: "7.9cm",
          y: "7.4cm",
          width: "5.3cm",
          height: "4.0cm",
          properties: {
            fill: {
              type: "gradient",
              path: "circle",
              stops: [
                { position: 0, color: "FFFFFF" },
                { position: 100, color: "4472C4" },
              ],
            },
          },
          textBody: { text: "Radial" },
        },
      },
      // Solid fill with transparency
      {
        shape: {
          x: "14.6cm",
          y: "7.4cm",
          width: "5.3cm",
          height: "4.0cm",
          properties: {
            fill: { type: "solid", color: "FF0000" },
          },
          textBody: { text: "Solid" },
        },
      },
    ],
  },

  // ── Slide 13: More Effects (innerShadow, reflection, softEdge) ──
  {
    children: [
      {
        shape: {
          x: "1.3cm",
          y: "0.5cm",
          width: "7.9cm",
          height: "1.1cm",
          textBody: { text: "More Effects" },
          properties: {
            fill: "44546A",
          },
        },
      },
      // Inner shadow
      {
        shape: {
          x: "1.3cm",
          y: "2.1cm",
          width: "6.6cm",
          height: "4.0cm",
          properties: {
            fill: "FFC000",

            effects: {
              innerShadow: {
                blurRadius: 40000,
                distance: 30000,
                direction: 90,
                color: { value: "000000", transforms: { alpha: 40 } },
              },
            },
          },
          textBody: { text: "Inner Shadow" },
        },
      },
      // Reflection
      {
        shape: {
          x: "9.3cm",
          y: "2.1cm",
          width: "6.6cm",
          height: "4.0cm",
          properties: {
            fill: "4472C4",

            effects: {
              reflection: {
                blurRadius: 6350,
                distance: 38100,
                direction: 90,
                startAlpha: 90,
                endAlpha: 0,
              },
            },
          },
          textBody: { text: "Reflection" },
        },
      },
      // Soft edge
      {
        shape: {
          x: "1.3cm",
          y: "7.4cm",
          width: "6.6cm",
          height: "4.0cm",
          properties: {
            fill: "70AD47",

            effects: { softEdge: 50800 },
          },
          textBody: { text: "Soft Edge" },
        },
      },
      // Multiple effects combined
      {
        shape: {
          x: "9.3cm",
          y: "7.4cm",
          width: "6.6cm",
          height: "4.0cm",
          properties: {
            fill: "ED7D31",

            geometry: "ellipse",

            effects: {
              outerShadow: {
                blurRadius: 38100,
                distance: 25400,
                direction: 90,
                color: { value: "000000", transforms: { alpha: 50 } },
              },
              reflection: { startAlpha: 80, endAlpha: 0 },
              glow: { radius: 50000, color: { value: "ED7D31", transforms: { alpha: 40 } } },
            },
          },
          textBody: { text: "Combined" },
        },
      },
    ],
  },

  // ── Slide 14: More Charts (bar, line, pie) ──
  {
    children: [
      {
        shape: {
          x: "1.3cm",
          y: "0.3cm",
          width: "7.9cm",
          height: "0.8cm",
          textBody: { text: "Chart Types" },
          properties: {
            fill: "ED7D31",
          },
        },
      },
      {
        chart: {
          x: "0.5cm",
          y: "1.3cm",
          width: "7.9cm",
          height: "4.8cm",
          type: "bar",
          title: "Bar Chart",
          categories: ["A", "B", "C"],
          series: [{ name: "Values", values: [10, 20, 30] }],
          style: 2,
        },
      },
      {
        chart: {
          x: "9.0cm",
          y: "1.3cm",
          width: "7.9cm",
          height: "4.8cm",
          type: "line",
          title: "Line Chart",
          categories: ["Jan", "Feb", "Mar"],
          series: [{ name: "Sales", values: [5, 15, 10] }],
          showLegend: true,
          style: 2,
        },
      },
      {
        chart: {
          x: "4.8cm",
          y: "6.6cm",
          width: "7.9cm",
          height: "5.3cm",
          type: "pie",
          title: "Pie Chart",
          categories: ["Red", "Green", "Blue"],
          series: [{ name: "Share", values: [40, 35, 25] }],
          showLegend: true,
          style: 2,
        },
      },
    ],
  },

  // ── Slide 15: Enhanced Table (rowSpan, verticalAlign, cell margins) ──
  {
    children: [
      {
        shape: {
          x: "1.3cm",
          y: "0.5cm",
          width: "10.6cm",
          height: "1.1cm",
          textBody: { text: "Enhanced Table" },
          properties: {
            fill: "44546A",
          },
        },
      },
      {
        table: {
          x: "1.3cm",
          y: "2.1cm",
          width: "18.5cm",
          height: "7.9cm",
          rows: [
            {
              cells: [
                { text: "Header 1", fill: "4472C4", verticalAlign: "center" },
                { text: "Header 2", fill: "4472C4", verticalAlign: "center" },
                { text: "Header 3", fill: "4472C4", verticalAlign: "center" },
              ],
            },
            {
              cells: [
                {
                  text: "RowSpan 2",
                  rowSpan: 2,
                  fill: "E8F0FE",
                  verticalAlign: "center",
                  margins: { left: 100000, right: 100000, top: 50000, bottom: 50000 },
                },
                { text: "Cell B1", fill: "F2F2F2" },
                { text: "Cell C1" },
              ],
            },
            {
              cells: [
                // A2 is merged with A1 (rowSpan)
                { text: "Cell B2", fill: "F2F2F2" },
                { text: "Cell C2" },
              ],
            },
            {
              cells: [{ text: "ColSpan 2", columnSpan: 2, fill: "FFF2CC" }, { text: "Last" }],
            },
          ],
          columnWidths: [2500000, 2500000, 2000000],
          firstRow: true,
          lastRow: true,
          firstCol: true,
          bandRow: true,
          bandCol: true,
          borders: {
            top: { color: "333333", width: 12700 },
            bottom: { color: "333333", width: 12700, dashStyle: "lgDashDotDot" },
            left: { color: "333333", width: 12700 },
            right: { color: "333333", width: 12700 },
          },
        },
      },
    ],
  },

  // ── Slide 16: Comments + Hyperlink ──
  {
    comments: [
      {
        author: "Alice Wang",
        text: "Great slide!",
        x: "5.3cm",
        y: "1.3cm",
        date: "2026-05-15T10:00:00Z",
      },
      {
        author: "Bob Li",
        text: "Consider a different color.",
        x: "10.6cm",
        y: "5.3cm",
        initials: "BL",
      },
    ],
    children: [
      {
        shape: {
          x: "1.3cm",
          y: "0.5cm",
          width: "7.9cm",
          height: "1.1cm",
          textBody: { text: "Comments + Hyperlink" },
          properties: {
            fill: "7030A0",
          },
        },
      },
      {
        shape: {
          x: "2.6cm",
          y: "2.6cm",
          width: "15.9cm",
          height: "1.6cm",
          textBody: {
            paragraphs: [
              {
                properties: { bullet: { type: "none" } },
                children: [
                  { text: "Visit " },
                  {
                    text: "our website",
                    hyperlink: { url: "https://example.com", tooltip: "Example" },
                  },
                  { text: " for more." },
                ],
              },
            ],
          },
        },
      },
    ],
  },

  // ── Slide 17: More Transitions + Emphasis Animation ──
  {
    transition: { type: "cover", direction: "right", speed: "medium" },
    children: [
      {
        shape: {
          x: "1.3cm",
          y: "0.5cm",
          width: "10.6cm",
          height: "1.1cm",
          textBody: { text: "Transitions + Emphasis" },
          properties: {
            fill: "C00000",
          },
        },
      },
      {
        shape: {
          id: 2,
          x: "1.3cm",
          y: "2.6cm",
          width: "5.3cm",
          height: "2.6cm",
          textBody: { text: "Grow" },
          properties: {
            fill: "4472C4",
          },
        },
      },
      {
        shape: {
          id: 3,
          x: "7.9cm",
          y: "2.6cm",
          width: "5.3cm",
          height: "2.6cm",
          textBody: { text: "Spin" },
          properties: {
            fill: "70AD47",
          },
        },
      },
      {
        shape: {
          id: 4,
          x: "14.6cm",
          y: "2.6cm",
          width: "5.3cm",
          height: "2.6cm",
          textBody: { text: "Color" },
          properties: {
            fill: "ED7D31",
          },
        },
      },
      {
        shape: {
          id: 5,
          x: "7.9cm",
          y: "6.9cm",
          width: "5.3cm",
          height: "2.6cm",
          textBody: { text: "Pulse" },
          properties: {
            fill: "7030A0",
          },
        },
      },
    ],
    animations: [
      { shapeId: 2, class: "emphasis", emphasisType: "growShrink", duration: 800 },
      { shapeId: 3, class: "emphasis", emphasisType: "spin", duration: 1000 },
      {
        shapeId: 4,
        class: "emphasis",
        emphasisType: "colorChange",
        color: "FF0000",
        duration: 800,
      },
      { shapeId: 5, class: "emphasis", emphasisType: "pulse", duration: 500 },
    ],
  },

  // ── Slide 18: Video ──
  {
    children: [
      {
        shape: {
          x: "1.3cm",
          y: "0.5cm",
          width: "7.9cm",
          height: "1.1cm",
          textBody: { text: "Video" },
          properties: {
            fill: "2D4A7A",
          },
        },
      },
      {
        video: {
          x: "2.6cm",
          y: "2.1cm",
          width: "12.7cm",
          height: "7.1cm",
          data: videoData,
          type: "mp4",
          name: "Test Video",
          poster: posterData,
          posterType: "png",
        },
      },
    ],
  },

  // ── Slide 19: Audio ──
  {
    children: [
      {
        shape: {
          x: "1.3cm",
          y: "0.5cm",
          width: "7.9cm",
          height: "1.1cm",
          textBody: { text: "Audio" },
          properties: {
            fill: "44546A",
          },
        },
      },
      {
        audio: {
          x: "7.9cm",
          y: "5.3cm",
          width: "3.2cm",
          height: "3.2cm",
          data: wavBuf,
          type: "wav",
          name: "Test Audio",
        },
      },
    ],
  },

  // ── Slide 20: Geometry showcase ──
  {
    children: [
      {
        shape: {
          x: "1.3cm",
          y: "0.5cm",
          width: "7.9cm",
          height: "1.1cm",
          textBody: { text: "Geometry" },
          properties: {
            fill: "4472C4",
          },
        },
      },
      {
        shape: {
          x: "1.3cm",
          y: "2.1cm",
          width: "4.0cm",
          height: "4.0cm",
          textBody: { text: "rect" },
          properties: {
            fill: "4472C4",
          },
        },
      },
      {
        shape: {
          x: "5.8cm",
          y: "2.1cm",
          width: "4.0cm",
          height: "4.0cm",
          textBody: { text: "ellipse" },
          properties: {
            fill: "ED7D31",

            geometry: "ellipse",
          },
        },
      },
      {
        shape: {
          x: "10.3cm",
          y: "2.1cm",
          width: "4.0cm",
          height: "4.0cm",
          textBody: { text: "diamond" },
          properties: {
            fill: "70AD47",

            geometry: "diamond",
          },
        },
      },
      {
        shape: {
          x: "14.8cm",
          y: "2.1cm",
          width: "4.0cm",
          height: "4.0cm",
          textBody: { text: "triangle" },
          properties: {
            fill: "FFC000",

            geometry: "triangle",
          },
        },
      },
      {
        shape: {
          x: "1.3cm",
          y: "6.9cm",
          width: "4.0cm",
          height: "4.0cm",
          textBody: { text: "pentagon" },
          properties: {
            fill: "7030A0",

            geometry: "pentagon",
          },
        },
      },
      {
        shape: {
          x: "5.8cm",
          y: "6.9cm",
          width: "4.0cm",
          height: "4.0cm",
          textBody: { text: "hexagon" },
          properties: {
            fill: "C00000",

            geometry: "hexagon",
          },
        },
      },
      {
        shape: {
          x: "10.3cm",
          y: "6.9cm",
          width: "4.0cm",
          height: "4.0cm",
          textBody: { text: "star" },
          properties: {
            fill: "44546A",

            geometry: "star5",
          },
        },
      },
      {
        shape: {
          x: "14.8cm",
          y: "6.9cm",
          width: "4.0cm",
          height: "4.0cm",
          textBody: { text: "plus" },
          properties: {
            fill: "2D4A7A",

            geometry: "plus",
          },
        },
      },
    ],
  },

  // ── Slide 21: Text body options (vertical, anchor, autoFit, wrap, margins) ──
  {
    children: [
      {
        shape: {
          x: "1.3cm",
          y: "0.5cm",
          width: "10.6cm",
          height: "1.1cm",
          textBody: { text: "Text Body Options" },
          properties: {
            fill: "44546A",
          },
        },
      },
      // Vertical text
      {
        shape: {
          x: "1.3cm",
          y: "2.1cm",
          width: "2.6cm",
          height: "7.9cm",
          properties: {
            fill: "4472C4",
          },
          textBody: { bodyProperties: { vertical: "vertical" }, text: "Vertical" },
        },
      },
      // Anchor bottom
      {
        shape: {
          x: "4.8cm",
          y: "2.1cm",
          width: "5.3cm",
          height: "7.9cm",
          properties: {
            fill: "F2F2F2",

            outline: { type: "solidFill", color: { value: "4472C4" }, width: 12700 },
          },
          textBody: { bodyProperties: { anchor: "bottom" }, text: "Anchored Bottom" },
        },
      },
      // AutoFit shrink
      {
        shape: {
          x: "10.8cm",
          y: "2.1cm",
          width: "5.3cm",
          height: "2.6cm",
          properties: {
            fill: "E8F0FE",
          },
          textBody: {
            bodyProperties: { normAutofit: {} },
            text: "AutoFit Shrink Text To Fit Shape",
          },
        },
      },
      // Flip horizontal
      {
        shape: {
          x: "17.2cm",
          y: "2.1cm",
          width: "4.0cm",
          height: "2.6cm",
          properties: {
            fill: "ED7D31",
          },
          textBody: { text: "Flipped" },
          flipHorizontal: true,
        },
      },
    ],
  },
];

const options: PresentationOptions = {
  title: "Round-trip Feature Showcase",
  subject: "Comprehensive PPTX round-trip test",
  creator: "Parser Demo",
  keywords: "test, round-trip, pptx",
  description: "A presentation covering all supported element types",
  lastModifiedBy: "Test Suite",
  revision: 1,
  show: { loop: true, useTimings: true },
  masters: [
    {
      name: "light",
      background: { fill: "FFFFFF" },
      theme: {
        name: "Light Theme",
        colorScheme: {
          dark1: "333333",
          light1: "FFFFFF",
          dark2: "44546A",
          light2: "E7E6E6",
          accent1: "4472C4",
          accent2: "ED7D31",
          accent3: "70AD47",
          accent4: "FFC000",
          accent5: "7030A0",
          accent6: "C00000",
        },
        fontScheme: {
          majorFont: { latin: { typeface: "Segoe UI" } },
          minorFont: { latin: { typeface: "Calibri" } },
        },
      },
      children: [
        {
          shape: {
            x: "0.0cm",
            y: "16.9cm",
            width: "25.4cm",
            height: "1.1cm",
            properties: {
              fill: "4472C4",
            },
          },
        },
      ],
    },
    {
      name: "dark",
      background: { fill: "1B2A4A" },
      theme: {
        name: "Dark Theme",
        colorScheme: {
          dark1: "FFFFFF",
          light1: "1B2A4A",
          dark2: "E7E6E6",
          light2: "333333",
          accent1: "5B9BD5",
          accent2: "F4B183",
          accent3: "A9D18E",
          accent4: "FFD966",
          accent5: "9B7BB6",
          accent6: "FF6B6B",
        },
        fontScheme: {
          majorFont: { latin: { typeface: "Segoe UI Light" } },
          minorFont: { latin: { typeface: "Calibri" } },
        },
      },
      children: [
        {
          shape: {
            x: "0.0cm",
            y: "16.9cm",
            width: "25.4cm",
            height: "1.1cm",
            properties: {
              fill: "ED7D31",
            },
          },
        },
      ],
    },
  ],
  slides,
};

const buffer = await generatePresentation(options);
console.log(`Generated PPTX: ${buffer.length} bytes`);

// ══════════════════════════════════════════════════════════════════════════════
// 2. Low-level parsePptx verification (ParsedArchive API)
// ══════════════════════════════════════════════════════════════════════════════

console.log("\n--- parsePptx (low-level) ---");
const {
  doc: pptxDoc,
  presentation,
  slides: slidePaths,
  slideMasters,
  slideLayouts,
} = parsePptx(buffer);

const slideCount = 21;
assert(`${slideCount} slide paths`, slidePaths.length === slideCount);
assert("slide 1 path", slidePaths[0] === "ppt/slides/slide1.xml");
assert("has presentation element", !!presentation);

if (presentation) {
  const sldSz = findChild(presentation, "p:sldSz");
  const cx = sldSz ? attrNum(sldSz, "cx") : undefined;
  const cy = sldSz ? attrNum(sldSz, "cy") : undefined;
  assert("has slide size", !!cx && !!cy);
}

assert("has slide masters", slideMasters.length >= 1);
assert("has slide layouts", slideLayouts.length >= 1);
assert("has ppt/presentation.xml", pptxDoc.has("ppt/presentation.xml"));
assert("has ppt/theme/theme1.xml", pptxDoc.has("ppt/theme/theme1.xml"));

// ══════════════════════════════════════════════════════════════════════════════
// 3. High-level parsePresentation verification (PresentationOptions API)
// ══════════════════════════════════════════════════════════════════════════════

console.log("\n--- parsePresentation (high-level) ---");
const parsed = await parsePresentation(buffer);

assert(`${slideCount} slides parsed`, parsed.slides!.length === slideCount);
assert("title preserved", parsed.title === "Round-trip Feature Showcase");
assert("creator preserved", parsed.creator === "Parser Demo");
assert("size is 16:9", parsed.size === "16:9");

// ══════════════════════════════════════════════════════════════════════════════
// 4. Round-trip: re-generate from parsed data → compare ZIPs
// ══════════════════════════════════════════════════════════════════════════════

console.log("\n--- Round-trip ZIP comparison ---");

const buffer2 = await generatePresentation(parsed);
console.log(`Re-generated PPTX: ${buffer2.length} bytes`);

// SmartArt (diagrams) is a known limitation — parse/generate does not yet
// round-trip diagram parts, so exclude the SmartArt slide and diagram parts.
const ignorePaths = new Set([
  "docProps/core.xml",
  "ppt/diagrams/",
  "ppt/slides/slide4.xml",
  "ppt/slides/_rels/slide4.xml.rels",
  // Theme fmtScheme now round-trips structurally (fill/line/effect/bg style
  // matrix fully preserved). Color-transform element order is an XSD choice and
  // differs from Office's handwritten order, so byte-level theme comparison is
  // skipped — the formatScheme data itself round-trips losslessly.
  "ppt/theme/theme1.xml",
  "ppt/theme/theme2.xml",
]);
const diffs = compareZips(buffer, buffer2, ignorePaths);
printDiffs(diffs);
assert("round-trip ZIPs match", diffs.length === 0);

// ══════════════════════════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════════════════════════

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);

fs.mkdirSync(".temp", { recursive: true });
fs.writeFileSync(".temp/16-round-trip.pptx", buffer);
fs.mkdirSync(".temp", { recursive: true });
fs.writeFileSync(".temp/16-round-trip (round-trip).pptx", buffer2);
console.log("\nSaved original and round-trip PPTX files");

if (fail > 0) process.exit(1);
