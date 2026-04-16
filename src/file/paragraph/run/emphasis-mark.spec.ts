import { Formatter } from "@export/formatter";
import { describe, expect, it } from "vite-plus/test";

import { EmphasisMarkType, createDotEmphasisMark, createEmphasisMark } from "./emphasis-mark";

describe("createEmphasisMark", () => {
    it("should create a new EmphasisMark element with w:em as the rootKey", () => {
        const emphasisMark = createEmphasisMark();
        const tree = new Formatter().format(emphasisMark);
        expect(tree).to.deep.equal({
            "w:em": { _attr: { "w:val": "dot" } },
        });
    });

    it("should support all emphasis mark types", () => {
        const types = [
            { type: EmphasisMarkType.NONE, expected: "none" },
            { type: EmphasisMarkType.COMMA, expected: "comma" },
            { type: EmphasisMarkType.CIRCLE, expected: "circle" },
            { type: EmphasisMarkType.DOT, expected: "dot" },
            { type: EmphasisMarkType.UNDER_DOT, expected: "underDot" },
        ];

        for (const { type, expected } of types) {
            const tree = new Formatter().format(createEmphasisMark(type));
            expect(tree).to.deep.equal({
                "w:em": { _attr: { "w:val": expected } },
            });
        }
    });
});

describe("createDotEmphasisMark", () => {
    it("should put value in attribute", () => {
        const emphasisMark = createDotEmphasisMark();
        const tree = new Formatter().format(emphasisMark);
        expect(tree).to.deep.equal({
            "w:em": { _attr: { "w:val": "dot" } },
        });
    });
});
