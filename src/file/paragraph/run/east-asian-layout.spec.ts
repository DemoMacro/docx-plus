import { Formatter } from "@export/formatter";
import { describe, expect, it } from "vite-plus/test";

import { CombineBracketsType, createEastAsianLayout } from "./east-asian-layout";

describe("createEastAsianLayout", () => {
    it("should create with combine only", () => {
        const tree = new Formatter().format(createEastAsianLayout({ combine: true }));
        expect(tree).to.deep.equal({
            "w:eastAsianLayout": { _attr: { "w:combine": true } },
        });
    });

    it("should create with combine and brackets", () => {
        const tree = new Formatter().format(
            createEastAsianLayout({
                combine: true,
                combineBrackets: CombineBracketsType.SQUARE,
            }),
        );
        expect(tree).to.deep.equal({
            "w:eastAsianLayout": {
                _attr: { "w:combine": true, "w:combineBrackets": "square" },
            },
        });
    });

    it("should create with all options", () => {
        const tree = new Formatter().format(
            createEastAsianLayout({
                combine: true,
                combineBrackets: CombineBracketsType.ROUND,
                id: 42,
                vert: true,
                vertCompress: true,
            }),
        );
        expect(tree).to.deep.equal({
            "w:eastAsianLayout": {
                _attr: {
                    "w:combine": true,
                    "w:combineBrackets": "round",
                    "w:id": 42,
                    "w:vert": true,
                    "w:vertCompress": true,
                },
            },
        });
    });

    it("should create with vert only", () => {
        const tree = new Formatter().format(createEastAsianLayout({ vert: true }));
        expect(tree).to.deep.equal({
            "w:eastAsianLayout": { _attr: { "w:vert": true } },
        });
    });
});
