import { unzipSync } from "@office-open/core";
import { describe, expect, it } from "vite-plus/test";

import { generatePresentation } from "./generate";
import { parsePresentationSync } from "./parse";
import { patchPresentation } from "./patch";
import type { PresentationOptions, SlideOptions } from "./shared/file";

const decodeEntry = (buffer: Uint8Array, path: string): string => {
  const unzipped = unzipSync(buffer);
  const entry = unzipped[path];
  if (!entry) throw new Error(`missing zip entry: ${path}`);
  return new TextDecoder().decode(entry);
};

const slide = (text: string): SlideOptions => ({
  children: [{ shape: { x: 0, y: 0, width: 200, height: 100, textBody: { text } } }],
});

const template = (slides: SlideOptions[]): PresentationOptions => ({ slides });

describe("patchPresentation slides", () => {
  it("appends a slide and wires sldIdLst, rels, and content types", async () => {
    const buffer = await generatePresentation(template([slide("A"), slide("B")]));
    const patched = await patchPresentation({
      data: buffer,
      outputType: "uint8array",
      slides: { append: [slide("APPENDED_SLIDE")] },
    });

    // Parser must accept the new file and see three slides.
    const parsed = parsePresentationSync(patched);
    expect(parsed.slides?.length).toBe(3);

    // New slide part carries the appended text.
    expect(decodeEntry(patched, "ppt/slides/slide3.xml")).toContain("APPENDED_SLIDE");

    // sldIdLst grew to three entries.
    const pres = decodeEntry(patched, "ppt/presentation.xml");
    expect((pres.match(/<p:sldId /g) ?? []).length).toBe(3);

    // presentation.xml.rels references the new slide; content types declares it.
    expect(decodeEntry(patched, "ppt/_rels/presentation.xml.rels")).toContain("slides/slide3.xml");
    expect(decodeEntry(patched, "[Content_Types].xml")).toContain("/ppt/slides/slide3.xml");

    // Slide rels points at an existing layout.
    expect(decodeEntry(patched, "ppt/slides/_rels/slide3.xml.rels")).toContain("slideLayout1.xml");
  });

  it("replaces a slide by index without changing the slide count", async () => {
    const buffer = await generatePresentation(template([slide("ORIGINAL"), slide("B")]));
    const patched = await patchPresentation({
      data: buffer,
      outputType: "uint8array",
      slides: { replace: { 0: slide("REPLACED_SLIDE") } },
    });

    const parsed = parsePresentationSync(patched);
    expect(parsed.slides?.length).toBe(2);

    const slide1 = decodeEntry(patched, "ppt/slides/slide1.xml");
    expect(slide1).toContain("REPLACED_SLIDE");
    expect(slide1).not.toContain("<a:t>ORIGINAL</a:t>");
  });

  it("throws when replacing a non-existent index", async () => {
    const buffer = await generatePresentation(template([slide("A")]));
    await expect(
      patchPresentation({
        data: buffer,
        outputType: "uint8array",
        slides: { replace: { 5: slide("X") } },
      }),
    ).rejects.toThrow(/index 5/);
  });

  it("replaces every occurrence of a placeholder, not just the first", async () => {
    const twice = (text: string): SlideOptions => ({
      children: [
        { shape: { x: 0, y: 0, width: 200, height: 100, textBody: { text } } },
        { shape: { x: 0, y: 120, width: 200, height: 100, textBody: { text } } },
      ],
    });
    const buffer = await generatePresentation(template([twice("{{name}}")]));
    const patched = await patchPresentation({
      data: buffer,
      outputType: "uint8array",
      placeholders: { name: "Alice" },
    });

    const slide1 = decodeEntry(patched, "ppt/slides/slide1.xml");
    expect((slide1.match(/<a:t>Alice<\/a:t>/g) ?? []).length).toBe(2);
    expect(slide1).not.toContain("{{name}}");
  });

  it("removes slides and unwires sldIdLst, rels, and content types", async () => {
    const buffer = await generatePresentation(template([slide("A"), slide("B"), slide("C")]));
    const patched = await patchPresentation({
      data: buffer,
      outputType: "uint8array",
      slides: { remove: [0, 2] },
    });

    // Only the middle slide survives, first in the deck.
    const parsed = parsePresentationSync(patched);
    expect(parsed.slides?.length).toBe(1);
    expect(decodeEntry(patched, "ppt/slides/slide2.xml")).toContain("<a:t>B</a:t>");

    // sldIdLst shrank to one entry pointing at the surviving slide.
    const pres = decodeEntry(patched, "ppt/presentation.xml");
    expect((pres.match(/<p:sldId /g) ?? []).length).toBe(1);

    // Removed parts, their rels, and their Overrides are gone.
    const unzipped = unzipSync(patched);
    expect(unzipped["ppt/slides/slide1.xml"]).toBeUndefined();
    expect(unzipped["ppt/slides/slide3.xml"]).toBeUndefined();
    expect(unzipped["ppt/slides/_rels/slide1.xml.rels"]).toBeUndefined();
    expect(decodeEntry(patched, "ppt/_rels/presentation.xml.rels")).not.toContain(
      "slides/slide1.xml",
    );
    expect(decodeEntry(patched, "[Content_Types].xml")).not.toContain("/ppt/slides/slide1.xml");
  });

  it("throws when removing a non-existent index", async () => {
    const buffer = await generatePresentation(template([slide("A")]));
    await expect(
      patchPresentation({
        data: buffer,
        outputType: "uint8array",
        slides: { remove: [9] },
      }),
    ).rejects.toThrow(/index 9/);
  });
});

describe("patchPresentation comments", () => {
  it("appends comments, wiring authors + comments + rels + content types", async () => {
    const buffer = await generatePresentation(template([slide("Hello"), slide("World")]));
    const patched = await patchPresentation({
      data: buffer,
      outputType: "uint8array",
      comments: {
        0: [{ author: "Alice", text: "check this", x: 10, y: 20 }],
      },
    });

    // commentAuthors.xml carries Alice
    expect(decodeEntry(patched, "ppt/commentAuthors.xml")).toContain("Alice");

    // comment1.xml (slide 1) carries the note
    expect(decodeEntry(patched, "ppt/comments/comment1.xml")).toContain("check this");

    // slide rels + presentation rels wire the parts
    expect(decodeEntry(patched, "ppt/slides/_rels/slide1.xml.rels")).toContain(
      "comments/comment1.xml",
    );
    expect(decodeEntry(patched, "ppt/_rels/presentation.xml.rels")).toContain("commentAuthors.xml");

    // content types
    const types = decodeEntry(patched, "[Content_Types].xml");
    expect(types).toContain("/ppt/commentAuthors.xml");
    expect(types).toContain("/ppt/comments/comment1.xml");
  });

  it("merges authors + entries with existing comments", async () => {
    const buffer = await generatePresentation({
      slides: [
        { ...slide("One"), comments: [{ author: "Alice", text: "original", x: 1, y: 1 }] },
        slide("Two"),
      ],
    });
    const patched = await patchPresentation({
      data: buffer,
      outputType: "uint8array",
      comments: {
        0: [{ author: "Bob", text: "appended", x: 2, y: 2 }],
      },
    });

    // Both authors present — Bob's id continues after Alice (id 0 → id 1).
    const authors = decodeEntry(patched, "ppt/commentAuthors.xml");
    expect(authors).toContain("Alice");
    expect(authors).toContain("Bob");

    // comment1.xml has both notes (merged entries).
    const comments = decodeEntry(patched, "ppt/comments/comment1.xml");
    expect(comments).toContain("original");
    expect(comments).toContain("appended");

    // No duplicate content-type overrides.
    const types = decodeEntry(patched, "[Content_Types].xml");
    expect((types.match(/\/ppt\/commentAuthors\.xml/g) ?? []).length).toBe(1);
    expect((types.match(/\/ppt\/comments\/comment1\.xml/g) ?? []).length).toBe(1);
  });

  it("throws when commenting a non-existent slide index", async () => {
    const buffer = await generatePresentation(template([slide("A")]));
    await expect(
      patchPresentation({
        data: buffer,
        outputType: "uint8array",
        comments: { 5: [{ author: "X", text: "y", x: 0, y: 0 }] },
      }),
    ).rejects.toThrow(/index 5/);
  });
});
