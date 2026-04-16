import { Formatter } from "@export/formatter";
import { NumberFormat } from "@file/shared/number-format";
import { describe, expect, it } from "vite-plus/test";

import {
    createFootnoteProperties,
    createEndnoteProperties,
    FootnotePositionType,
    EndnotePositionType,
    NumberRestartType,
} from "./footnote-endnote-properties";

describe("createFootnoteProperties", () => {
    it("should create with position only", () => {
        const tree = new Formatter().format(
            createFootnoteProperties({ pos: FootnotePositionType.PAGE_BOTTOM }),
        );
        expect(tree).to.deep.equal({
            "w:footnotePr": [{ "w:pos": { _attr: { "w:val": "pageBottom" } } }],
        });
    });

    it("should create with position and format", () => {
        const tree = new Formatter().format(
            createFootnoteProperties({
                formatType: NumberFormat.LOWER_ROMAN,
                pos: FootnotePositionType.SECT_END,
            }),
        );
        expect(tree).to.deep.equal({
            "w:footnotePr": [
                { "w:pos": { _attr: { "w:val": "sectEnd" } } },
                { "w:numFmt": { _attr: { "w:fmt": "lowerRoman" } } },
            ],
        });
    });

    it("should create with all options", () => {
        const tree = new Formatter().format(
            createFootnoteProperties({
                formatType: NumberFormat.DECIMAL,
                numRestart: NumberRestartType.EACH_SECT,
                numStart: 5,
                pos: FootnotePositionType.DOC_END,
            }),
        );
        expect(tree).to.deep.equal({
            "w:footnotePr": [
                { "w:pos": { _attr: { "w:val": "docEnd" } } },
                { "w:numFmt": { _attr: { "w:fmt": "decimal" } } },
                { "w:numStart": { _attr: { "w:val": 5 } } },
                { "w:numRestart": { _attr: { "w:val": "eachSect" } } },
            ],
        });
    });

    it("should create with custom format string", () => {
        const tree = new Formatter().format(createFootnoteProperties({ format: "- %1 -" }));
        expect(tree).to.deep.equal({
            "w:footnotePr": [{ "w:numFmt": { _attr: { "w:format": "- %1 -" } } }],
        });
    });
});

describe("createEndnoteProperties", () => {
    it("should create with position only", () => {
        const tree = new Formatter().format(
            createEndnoteProperties({ pos: EndnotePositionType.DOC_END }),
        );
        expect(tree).to.deep.equal({
            "w:endnotePr": [{ "w:pos": { _attr: { "w:val": "docEnd" } } }],
        });
    });

    it("should create with position and format", () => {
        const tree = new Formatter().format(
            createEndnoteProperties({
                formatType: NumberFormat.UPPER_ROMAN,
                pos: EndnotePositionType.SECT_END,
            }),
        );
        expect(tree).to.deep.equal({
            "w:endnotePr": [
                { "w:pos": { _attr: { "w:val": "sectEnd" } } },
                { "w:numFmt": { _attr: { "w:fmt": "upperRoman" } } },
            ],
        });
    });

    it("should create with all options", () => {
        const tree = new Formatter().format(
            createEndnoteProperties({
                formatType: NumberFormat.LOWER_LETTER,
                numRestart: NumberRestartType.CONTINUOUS,
                numStart: 1,
                pos: EndnotePositionType.DOC_END,
            }),
        );
        expect(tree).to.deep.equal({
            "w:endnotePr": [
                { "w:pos": { _attr: { "w:val": "docEnd" } } },
                { "w:numFmt": { _attr: { "w:fmt": "lowerLetter" } } },
                { "w:numStart": { _attr: { "w:val": 1 } } },
                { "w:numRestart": { _attr: { "w:val": "continuous" } } },
            ],
        });
    });
});
