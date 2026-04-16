import { Formatter } from "@export/formatter";
import { ThemeColor } from "@util/values";
import { describe, expect, it } from "vite-plus/test";

import { UnderlineType, createUnderline } from "./underline";

describe("createUnderline", () => {
    it("should create a new Underline element with w:u as the rootKey", () => {
        const underline = createUnderline();
        const tree = new Formatter().format(underline);
        expect(tree).to.deep.equal({
            "w:u": {
                _attr: {
                    "w:val": "single",
                },
            },
        });
    });

    it("should default to 'single' and no color", () => {
        const underline = createUnderline();
        const tree = new Formatter().format(underline);
        expect(tree).to.deep.equal({
            "w:u": { _attr: { "w:val": "single" } },
        });
    });

    it("should use the given style type and color", () => {
        const underline = createUnderline(UnderlineType.DOUBLE, "FF00CC");
        const tree = new Formatter().format(underline);
        expect(tree).to.deep.equal({
            "w:u": { _attr: { "w:color": "FF00CC", "w:val": "double" } },
        });
    });

    it("should support theme color with tint and shade", () => {
        const underline = createUnderline(
            UnderlineType.WAVE,
            undefined,
            ThemeColor.ACCENT1,
            "99",
            "BF",
        );
        const tree = new Formatter().format(underline);
        expect(tree).to.deep.equal({
            "w:u": {
                _attr: {
                    "w:themeColor": "accent1",
                    "w:themeShade": "BF",
                    "w:themeTint": "99",
                    "w:val": "wave",
                },
            },
        });
    });
});
