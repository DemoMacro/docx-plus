// Round-trip demo — one document with all content types, export → parse → verify → re-export.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { generateDocument, parseDocument, parseArchive } from "@office-open/docx";
import type { SectionOptions } from "@office-open/docx";
import { parse, stringify } from "@office-open/xml";
import { strFromU8 } from "fflate";

// ─── Helpers ───────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  if (condition) {
    pass++;
    console.log(`  PASS: ${label}`);
  } else {
    fail++;
    console.log(`  FAIL: ${label}`);
  }
}

function normalizeXml(raw: Uint8Array): string {
  const parsed = parse(strFromU8(raw), {
    nativeTypeAttributes: true,
    captureSpacesBetweenElements: true,
  });
  let xml = stringify(parsed);
  // Normalize non-deterministic values
  xml = xml.replace(/\{[0-9A-F-]{36}\}/g, "{UUID}");
  xml = xml.replace(/afchunk[a-z0-9_-]+/g, "afchunk_NORM");
  xml = xml.replace(/rId[a-z0-9_-]+/g, "rId_NORM");
  // Normalize non-deterministic shape/element IDs (random alphanumeric with hyphens/underscores)
  xml = xml.replace(/ id="([a-z0-9_][a-z0-9_-]{10,})"/g, ' id="ID_NORM"');
  // Normalize wp:docPr id (auto-incremented numeric id)
  xml = xml.replace(/(<wp:docPr[^>]*?) id="\d+"/g, '$1 id="N"');
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
    // Skip afchunks files (random names, content is identical)
    if (path.includes("afchunks/")) continue;

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
      const s1 = normalizeXml(raw1);
      const s2 = normalizeXml(raw2);
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

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const imageData = readFileSync("./demo/images/dog.png");

  // 1. Build a single document with every content type
  const sections: SectionOptions[] = [
    // Section 1: paragraphs, tables, nested tables, SDT, headings, TOC, headers/footers
    {
      headers: {
        default: [{ paragraph: { children: [{ text: "Header", bold: true }] } }],
      },
      footers: {
        default: [{ paragraph: { children: ["Footer text"] } }],
      },
      children: [
        // String paragraph
        { paragraph: "I am a string paragraph" },

        // Paragraph with mixed run children
        {
          paragraph: {
            children: [
              "String child",
              { text: " + bold", bold: true },
              { text: " + italic", italic: true },
            ],
          },
        },

        // Centered paragraph
        {
          paragraph: {
            alignment: "center",
            children: [{ text: "Centered text", bold: true, size: 16 }],
          },
        },

        // Comment
        {
          paragraph: {
            children: [
              "This paragraph has a ",
              { commentRangeStart: { id: 0 } },
              "comment",
              { commentRangeEnd: { id: 0 } },
              { commentReference: 0 },
              " attached.",
            ],
          },
        },

        // Hyperlink
        {
          paragraph: {
            children: [
              "Visit ",
              {
                text: "our website",
                hyperlink: { url: "https://example.com", tooltip: "Example" },
              },
              " for more.",
            ],
          },
        },

        // Bookmark
        {
          paragraph: {
            children: [
              { bookmarkStart: { id: 42, name: "my-bookmark" } },
              "This is a bookmarked paragraph.",
              { bookmarkEnd: { id: 42 } },
            ],
          },
        },

        // Table of Contents
        { toc: { hyperlink: true, headingStyleRange: "1-3" } },

        // Headings
        { paragraph: { heading: "Heading1", children: ["First Heading"] } },
        { paragraph: { children: ["Content under first heading."] } },
        { paragraph: { heading: "Heading2", children: ["Second Heading"] } },
        { paragraph: { children: ["Content under second heading."] } },

        // Table with borders
        {
          table: {
            rows: [
              {
                cells: [
                  { children: [{ paragraph: "A1" }] },
                  { children: [{ paragraph: "B1" }] },
                  { children: [{ paragraph: "C1" }] },
                ],
              },
              {
                cells: [
                  {
                    children: [
                      { paragraph: { children: [{ text: "Underlined", underline: {} }] } },
                    ],
                  },
                  {
                    children: [
                      { paragraph: "Cell with" },
                      {
                        paragraph: { children: ["multiple", { text: " paragraphs", bold: true }] },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },

        // Nested table
        {
          table: {
            rows: [
              {
                cells: [
                  {
                    children: [
                      { paragraph: "Outer cell" },
                      {
                        table: {
                          rows: [
                            {
                              cells: [
                                { children: [{ paragraph: "Inner A" }] },
                                { children: [{ paragraph: "Inner B" }] },
                              ],
                            },
                          ],
                        },
                      },
                    ],
                  },
                  { children: [{ paragraph: "Sibling" }] },
                ],
              },
            ],
          },
        },

        // SDT block (richText)
        {
          sdt: {
            properties: { richText: true, alias: "BlockContent", tag: "block-content" },
            children: [
              { paragraph: { children: ["Block-level content control."] } },
              { paragraph: { children: ["Multiple paragraphs inside SDT."] } },
            ],
          },
        },

        // ComboBox SDT
        {
          sdt: {
            properties: {
              alias: "Color",
              tag: "combo-color",
              comboBox: {
                items: [
                  { displayText: "Red", value: "red" },
                  { displayText: "Blue", value: "blue" },
                ],
                lastValue: "Red",
              },
            },
            children: [{ paragraph: { children: ["Red"] } }],
          },
        },

        // Textbox
        {
          textbox: {
            style: { width: "4in", height: "1in" },
            children: [
              { paragraph: { children: [{ text: "Textbox paragraph", bold: true }] } },
              { paragraph: { children: ["Second line in textbox"] } },
            ],
          },
        },
      ],
    },

    // Section 2: chart
    {
      children: [
        { paragraph: { children: [{ text: "Chart (JSON API)", bold: true, size: 14 }] } },
        {
          paragraph: {
            children: [
              {
                chart: {
                  type: "column",
                  categories: ["Q1", "Q2", "Q3", "Q4"],
                  series: [
                    { name: "2024", values: [120, 150, 180, 200] },
                    { name: "2025", values: [140, 170, 210, 250] },
                  ],
                  title: "Quarterly Revenue",
                  transformation: { width: "13.2cm", height: "7.9cm" },
                },
              },
            ],
          },
        },
      ],
    },

    // Section 3: smartArt
    {
      children: [
        { paragraph: { children: [{ text: "SmartArt (JSON API)", bold: true, size: 14 }] } },
        {
          paragraph: {
            children: [
              {
                smartArt: {
                  nodes: [
                    { text: "Plan", children: [{ text: "Define scope" }] },
                    { text: "Build" },
                    { text: "Deploy" },
                  ],
                  transformation: { width: "11.9cm", height: "6.6cm" },
                  layout: "process1",
                  style: "simple1",
                  color: "accent1_2",
                },
              },
            ],
          },
        },
      ],
    },

    // Section 4: altChunk
    {
      children: [
        { paragraph: { children: [{ text: "AltChunk (JSON API)", bold: true, size: 14 }] } },
        {
          altChunk: {
            data: "<html><body><p>This is <b>embedded HTML</b> via JSON API.</p></body></html>",
            contentType: "text/html",
            extension: "html",
          },
        },
      ],
    },

    // Section 5: image (inline + floating)
    {
      children: [
        { paragraph: { children: [{ text: "Images (JSON API)", bold: true, size: 14 }] } },
        // Inline image
        {
          paragraph: {
            children: [
              {
                picture: {
                  type: "png",
                  data: imageData,
                  transformation: { width: "4.0cm", height: "4.0cm" },
                  altText: { name: "Dog", description: "A dog picture", title: "Dog Image" },
                },
              },
            ],
          },
        },
        // Floating image with wrapping
        {
          paragraph: {
            children: [
              {
                picture: {
                  type: "png",
                  data: imageData,
                  transformation: { width: "2.6cm", height: "2.6cm" },
                  floating: {
                    horizontalPosition: { offset: 2000000 },
                    verticalPosition: { offset: 0 },
                    behindDocument: false,
                  },
                },
              },
              "Text wrapping around a floating image. ",
              "This tests the anchor positioning and text wrapping capabilities.",
            ],
          },
        },
      ],
    },

    // Section 6: math, symbol, breaks, footnote/endnote
    {
      children: [
        {
          paragraph: {
            children: [
              "The formula E=mc",
              { math: { children: [{ text: "2" }] } },
              " uses a ",
              { symbolRun: { char: "F021", symbolFont: "Wingdings" } },
              " symbol.",
            ],
          },
        },
        // Math: fraction
        {
          paragraph: {
            children: [
              {
                math: {
                  children: [
                    "x",
                    " = ",
                    { fraction: { numerator: ["a + b"], denominator: ["c"] } },
                  ],
                },
              },
            ],
          },
        },
        // Math: sum with superScript
        {
          paragraph: {
            children: [
              {
                math: {
                  children: [
                    {
                      sum: {
                        children: [{ superScript: { children: ["x"], superScript: ["2"] } }],
                        subScript: ["i=0"],
                        superScript: ["n"],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
        // Math: integral
        {
          paragraph: {
            children: [
              {
                math: {
                  children: [
                    {
                      integral: {
                        children: ["x"],
                        subScript: ["0"],
                        superScript: ["1"],
                      },
                    },
                    " dx",
                  ],
                },
              },
            ],
          },
        },
        // Math: radical (square root)
        {
          paragraph: {
            children: [
              {
                math: {
                  children: [{ radical: { children: ["x", " + ", "1"] } }],
                },
              },
            ],
          },
        },
        // Math: subScript + subSuperScript
        {
          paragraph: {
            children: [
              {
                math: {
                  children: [
                    { subScript: { children: ["a"], subScript: ["n"] } },
                    { subSuperScript: { children: ["x"], subScript: ["i"], superScript: ["2"] } },
                  ],
                },
              },
            ],
          },
        },
        // Breaks
        {
          paragraph: { children: ["Before page break", { pageBreak: true }, "After page break"] },
        },
        {
          paragraph: { children: ["Column 1", { columnBreak: true }, "Column 2"] },
        },
        // Footnote + endnote references
        {
          paragraph: {
            children: [
              "With footnote",
              { footnoteReference: 1 },
              " and endnote",
              { endnoteReference: 1 },
            ],
          },
        },
      ],
    },

    // Section 7: rich run formatting
    {
      children: [
        { paragraph: { heading: "Heading1", children: ["Run Formatting"] } },
        // doubleStrike, subScript, superScript, smallCaps, allCaps
        {
          paragraph: {
            children: [
              { text: "Double Strike", doubleStrike: true },
              " | ",
              { text: "SubScript", verticalAlign: "subscript" },
              " | ",
              { text: "SuperScript", verticalAlign: "superscript" },
              " | ",
              { text: "SmallCaps", smallCaps: true },
              " | ",
              { text: "AllCaps", allCaps: true },
            ],
          },
        },
        // Highlight, underline with type+color
        {
          paragraph: {
            children: [
              { text: "Highlighted Yellow", highlight: "yellow" },
              " | ",
              { text: "Underline Wave", underline: { type: "wave", color: "FF0000" } },
              " | ",
              { text: "Double Underline", underline: { type: "double" } },
            ],
          },
        },
        // characterSpacing, kern, position, scale
        {
          paragraph: {
            children: [
              { text: "Spaced Out", characterSpacing: 200 },
              " | ",
              { text: "Kerned", kern: 10 },
              " | ",
              { text: "Raised", position: "6pt" },
              " | ",
              { text: "Scaled", scale: 150 },
            ],
          },
        },
        // effect, emboss, imprint, shadow, outline
        {
          paragraph: {
            children: [
              { text: "Shimmer Effect", effect: "shimmer" },
              " | ",
              { text: "Embossed", emboss: true },
              " | ",
              { text: "Shadow", shadow: true },
              " | ",
              { text: "Outline", outline: true },
            ],
          },
        },
        // Run border + shading
        {
          paragraph: {
            children: [
              {
                text: "Bordered + Shaded",
                border: { color: "FF0000", size: 1, space: 1, style: "single" },
                shading: { color: "auto", fill: "FFFF00", type: "clear" },
              },
            ],
          },
        },
        // Multi-property font
        {
          paragraph: {
            children: [
              {
                text: "Multi-font",
                font: { ascii: "Calibri", eastAsia: "SimSun", hAnsi: "Arial" },
                size: 12,
              },
            ],
          },
        },
      ],
    },

    // Section 8: paragraph formatting (indent, spacing, tabStops, border, shading)
    {
      properties: {
        pageMargin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
      },
      children: [
        { paragraph: { heading: "Heading1", children: ["Paragraph Formatting"] } },
        // Indent
        {
          paragraph: {
            indent: { left: 720, firstLine: 360 },
            children: ["Indented paragraph with first-line indent."],
          },
        },
        // Spacing
        {
          paragraph: {
            spacing: { before: 400, after: 400, line: 360, lineRule: "auto" },
            children: ["Paragraph with explicit before/after/line spacing."],
          },
        },
        // Tab stops
        {
          paragraph: {
            tabStops: [{ position: 5000, type: "right" }],
            children: ["Left text\tRight aligned"],
          },
        },
        // Paragraph border
        {
          paragraph: {
            border: {
              bottom: { color: "4472C4", size: 6, space: 1, style: "single" },
              top: { color: "4472C4", size: 6, space: 1, style: "single" },
            },
            children: ["Paragraph with top and bottom borders."],
          },
        },
        // Paragraph shading
        {
          paragraph: {
            shading: { color: "auto", fill: "D9E2F3", type: "clear" },
            children: ["Paragraph with background shading."],
          },
        },
        // keepLines, keepNext, pageBreakBefore
        {
          paragraph: {
            keepLines: true,
            keepNext: true,
            children: ["Keep these lines together, keep with next paragraph."],
          },
        },
        // Thematic break
        {
          paragraph: { thematicBreak: true },
        },
      ],
    },

    // Section 9: enhanced table (rowSpan, shading, verticalAlign, margins)
    {
      children: [
        { paragraph: { heading: "Heading1", children: ["Enhanced Table"] } },
        {
          table: {
            rows: [
              {
                cells: [
                  {
                    children: [{ paragraph: "Header 1" }],
                    shading: { fill: "4472C4", type: "clear" },
                  },
                  {
                    children: [{ paragraph: "Header 2" }],
                    shading: { fill: "4472C4", type: "clear" },
                  },
                  {
                    children: [{ paragraph: "Header 3" }],
                    shading: { fill: "4472C4", type: "clear" },
                  },
                ],
              },
              {
                cells: [
                  {
                    children: [{ paragraph: "RowSpan 2" }],
                    rowSpan: 2,
                    verticalAlign: "center",
                    margins: {
                      top: { size: 200 },
                      bottom: { size: 200 },
                      left: { size: 200 },
                      right: { size: 200 },
                    },
                  },
                  {
                    children: [{ paragraph: "Cell B1" }],
                    shading: { fill: "F2F2F2", type: "clear" },
                  },
                  { children: [{ paragraph: "Cell C1" }] },
                ],
              },
              {
                cells: [
                  // A2 merged with A1 (rowSpan)
                  {
                    children: [{ paragraph: "Cell B2" }],
                    shading: { fill: "F2F2F2", type: "clear" },
                  },
                  { children: [{ paragraph: "Cell C2" }] },
                ],
              },
              {
                cells: [
                  {
                    children: [{ paragraph: "ColSpan 2" }],
                    columnSpan: 2,
                    shading: { fill: "FFF2CC", type: "clear" },
                  },
                  { children: [{ paragraph: "Last" }] },
                ],
              },
            ],
            width: { size: 100, type: "percent" },
          },
        },
      ],
    },

    // Section 10: page setup — landscape orientation + page borders
    {
      properties: {
        pageSize: { orientation: "landscape" },
        pageBorders: {
          top: { color: "4472C4", size: 24, space: 24, style: "single" },
          bottom: { color: "4472C4", size: 24, space: 24, style: "single" },
          left: { color: "4472C4", size: 24, space: 24, style: "single" },
          right: { color: "4472C4", size: 24, space: 24, style: "single" },
        },
      },
      children: [
        { paragraph: { heading: "Heading1", children: ["Landscape + Page Borders"] } },
        { paragraph: { children: ["This section uses landscape orientation with page borders."] } },
      ],
    },

    // Section 11: multiple columns + line numbers
    {
      properties: {
        columns: { count: 2, space: 708 },
        lineNumberType: { countBy: 1 },
      },
      children: [
        { paragraph: { heading: "Heading1", children: ["Columns + Line Numbers"] } },
        {
          paragraph: {
            children: ["First paragraph in column layout. This text flows into two columns."],
          },
        },
        {
          paragraph: {
            children: ["Second paragraph in the column layout. Line numbers are visible."],
          },
        },
        { paragraph: { children: ["Third paragraph continues the multi-column flow."] } },
      ],
    },

    // Section 12: even/odd/first page headers
    {
      headers: {
        default: [{ paragraph: { children: ["Default Header"] } }],
        first: [{ paragraph: { children: [{ text: "First Page Header", bold: true }] } }],
        even: [{ paragraph: { children: ["Even Page Header"] } }],
      },
      footers: {
        default: [{ paragraph: { children: ["Default Footer"] } }],
        first: [{ paragraph: { children: ["First Page Footer"] } }],
        even: [{ paragraph: { children: ["Even Page Footer"] } }],
      },
      properties: {
        titlePage: true,
      },
      children: [
        { paragraph: { heading: "Heading1", children: ["Even/Odd/First Headers"] } },
        {
          paragraph: {
            children: [
              "This section has different headers for first, even, and default (odd) pages.",
            ],
          },
        },
        { paragraph: { children: ["Page break forces a new page to see the different headers."] } },
      ],
    },

    // Section 13: track changes (insertion + deletion)
    {
      children: [
        { paragraph: { heading: "Heading1", children: ["Track Changes"] } },
        {
          paragraph: {
            children: [
              "Normal text, then ",
              {
                insertion: {
                  author: "John Doe",
                  date: "2026-05-28T10:00:00Z",
                  id: 100,
                  children: [{ text: "inserted text" }],
                },
              },
              ", and ",
              {
                deletion: {
                  author: "Jane Smith",
                  date: "2026-05-28T11:00:00Z",
                  id: 101,
                  children: [{ text: "deleted text" }],
                },
              },
              ".",
            ],
          },
        },
      ],
    },

    // Section 14: custom styles + numbering
    {
      children: [
        {
          paragraph: {
            style: "CustomHeading",
            children: ["Custom Heading Style Applied"],
          },
        },
        {
          paragraph: {
            numbering: { reference: "custom-list", level: 0 },
            children: ["First numbered item"],
          },
        },
        {
          paragraph: {
            numbering: { reference: "custom-list", level: 0 },
            children: ["Second numbered item"],
          },
        },
      ],
    },

    // Section 15: customXml block + textDirection
    {
      properties: {
        pageMargin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
        textDirection: "lrTb",
      },
      children: [
        { paragraph: { heading: "Heading1", children: ["Custom XML Block"] } },
        {
          customXml: {
            element: "myElement",
            uri: "http://example.com/ns",
            properties: {
              placeholder: "Enter value",
              attributes: [{ name: "status", val: "draft" }],
            },
            children: [{ paragraph: { children: ["Inside customXml block"] } }],
          },
        },
      ],
    },
  ];

  const sectionCount = sections.length;

  // 2. Create document and export
  const buffer = await generateDocument({
    background: { color: "FFFFFF" },
    footnotes: [{ id: 1, children: ["This is a footnote."] }],
    endnotes: [{ id: 1, children: ["This is an endnote."] }],
    comments: [
      {
        id: 0,
        author: "Demo Author",
        initials: "DA",
        children: ["This is a comment via JSON API."],
      },
    ],
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 11 },
        },
      },
      paragraphStyles: [
        {
          id: "CustomHeading",
          name: "Custom Heading",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { bold: true, size: 16, color: "1F4E79" },
        },
      ],
      characterStyles: [
        {
          id: "CustomHighlight",
          name: "Custom Highlight",
          run: { bold: true, color: "FF0000" },
        },
      ],
    },
    numbering: {
      abstractNumberings: [
        {
          reference: "custom-list",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: "start",
              start: 1,
              suffix: "space",
            },
          ],
        },
      ],
    },
    settings: {
      evenAndOddHeaders: true,
      trackRevisions: true,
    },
    customProperties: [
      { name: "Project", value: "Round-trip Test" },
      { name: "Version", value: "1.0" },
    ],
    webSettings: { optimizeForBrowser: true, allowPNG: true, pixelsPerInch: 96 },
    sections,
  });
  console.log(`Generated DOCX: ${buffer.length} bytes`);

  // 3. Parse it back
  const parsed = await parseDocument(buffer);
  console.log(`Parsed ${parsed.sections!.length} sections`);

  // 4. Basic verification
  console.log("\n--- Verification ---");
  assert(`section count = ${sectionCount}`, parsed.sections!.length === sectionCount);

  // Verify customXml (section 15)
  const sec15 = parsed.sections![14];
  if (!sec15) throw new Error("section 15 not found in parsed document");
  const customXmlChild = sec15.children!.find((c: any) => "customXml" in c) as any;
  assert("customXml element parsed", customXmlChild?.customXml?.element === "myElement");
  assert("customXml uri parsed", customXmlChild?.customXml?.uri === "http://example.com/ns");
  assert(
    "customXml placeholder parsed",
    customXmlChild?.customXml?.properties?.placeholder === "Enter value",
  );
  assert(
    "customXml attributes parsed",
    customXmlChild?.customXml?.properties?.attributes?.[0]?.name === "status",
  );

  // Verify section properties textDirection
  const sec15Props = sec15.properties as any;
  assert("textDirection parsed", sec15Props?.textDirection === "lrTb");

  // Verify webSettings
  assert("webSettings parsed", (parsed as any).webSettings !== undefined);
  assert(
    "webSettings.optimizeForBrowser parsed",
    (parsed as any).webSettings?.optimizeForBrowser === true,
  );
  assert("webSettings.allowPNG parsed", (parsed as any).webSettings?.allowPNG === true);
  assert("webSettings.pixelsPerInch parsed", (parsed as any).webSettings?.pixelsPerInch === 96);

  // 5. Round-trip: re-generate from parsed data → verify structural consistency
  console.log("\n--- Round-trip validation ---");
  const buffer2 = await generateDocument(parsed);
  console.log(`Re-exported DOCX: ${buffer2.length} bytes`);

  // Save files
  mkdirSync(".temp", { recursive: true });
  writeFileSync(".temp/122-round-trip.docx", buffer);
  mkdirSync(".temp", { recursive: true });
  writeFileSync(".temp/122-round-trip (round-trip).docx", buffer2);

  // Compare media counts (filenames are non-deterministic)
  const zip1 = parseArchive(buffer);
  const zip2 = parseArchive(buffer2);
  const mediaCount1 = [...zip1.keys()].filter((p) => p.startsWith("word/media/")).length;
  const mediaCount2 = [...zip2.keys()].filter((p) => p.startsWith("word/media/")).length;
  assert(`media count matches (${mediaCount1} vs ${mediaCount2})`, mediaCount1 === mediaCount2);

  // Compare non-media XML parts (skip timestamps)
  const diffs = compareZips(buffer, buffer2, new Set(["docProps/core.xml"])).filter(
    (d) => !d.path.startsWith("word/media/"),
  );
  if (diffs.length > 0) {
    console.log("\n  ⚠️ Structural differences:");
    printDiffs(diffs);
  }

  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
  console.log("\nSaved .temp/122-round-trip.docx and .temp/122-round-trip (round-trip).docx");
}

main().catch(console.error);
