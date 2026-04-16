import { Formatter } from "@export/formatter";
import { BorderStyle } from "@file/border";
import { ThemeColor } from "@util/values";
import { describe, expect, it } from "vite-plus/test";

import { createBorderElement } from "./border";

describe("BorderElement", () => {
    describe("#createBorderElement", () => {
        it("should create a simple border element", () => {
            const border = createBorderElement("w:top", {
                style: BorderStyle.SINGLE,
            });
            const tree = new Formatter().format(border);
            expect(tree).to.deep.equal({
                "w:top": {
                    _attr: {
                        "w:val": "single",
                    },
                },
            });
        });
        it("should create a simple border element with a size", () => {
            const border = createBorderElement("w:top", {
                size: 22,
                style: BorderStyle.SINGLE,
            });
            const tree = new Formatter().format(border);
            expect(tree).to.deep.equal({
                "w:top": {
                    _attr: {
                        "w:sz": 22,
                        "w:val": "single",
                    },
                },
            });
        });
        it("should create a simple border element with space", () => {
            const border = createBorderElement("w:top", {
                space: 22,
                style: BorderStyle.SINGLE,
            });
            const tree = new Formatter().format(border);
            expect(tree).to.deep.equal({
                "w:top": {
                    _attr: {
                        "w:space": 22,
                        "w:val": "single",
                    },
                },
            });
        });
        it("should support theme color with tint and shade", () => {
            const border = createBorderElement("w:bottom", {
                style: BorderStyle.SINGLE,
                themeColor: ThemeColor.ACCENT2,
                themeTint: "99",
                themeShade: "BF",
            });
            const tree = new Formatter().format(border);
            expect(tree).to.deep.equal({
                "w:bottom": {
                    _attr: {
                        "w:themeColor": "accent2",
                        "w:themeShade": "BF",
                        "w:themeTint": "99",
                        "w:val": "single",
                    },
                },
            });
        });
        it("should support shadow and frame attributes", () => {
            const border = createBorderElement("w:top", {
                style: BorderStyle.SINGLE,
                shadow: true,
                frame: true,
            });
            const tree = new Formatter().format(border);
            expect(tree).to.deep.equal({
                "w:top": {
                    _attr: {
                        "w:frame": true,
                        "w:shadow": true,
                        "w:val": "single",
                    },
                },
            });
        });
    });
});
