import { Formatter } from "@export/formatter";
import { describe, expect, it } from "vite-plus/test";

import { createIndent } from "./indent";

describe("Indent", () => {
    it("should create", () => {
        const indent = createIndent({
            end: 10,
            firstLine: 10,
            hanging: 10,
            left: 10,
            right: 10,
            start: 10,
        });
        const tree = new Formatter().format(indent);
        expect(tree).to.deep.equal({
            "w:ind": {
                _attr: {
                    "w:end": 10,
                    "w:firstLine": 10,
                    "w:hanging": 10,
                    "w:left": 10,
                    "w:right": 10,
                    "w:start": 10,
                },
            },
        });
    });

    it("should create with no indent values", () => {
        const indent = createIndent({});

        const tree = new Formatter().format(indent);
        expect(tree).to.deep.equal({
            "w:ind": {
                _attr: {},
            },
        });
    });

    it("should create with character-based indent values", () => {
        const indent = createIndent({
            startChars: 5,
            endChars: 3,
            hangingChars: 2,
            firstLineChars: 4,
        });
        const tree = new Formatter().format(indent);
        expect(tree).to.deep.equal({
            "w:ind": {
                _attr: {
                    "w:startChars": 5,
                    "w:endChars": 3,
                    "w:hangingChars": 2,
                    "w:firstLineChars": 4,
                },
            },
        });
    });
});
