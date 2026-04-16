import { Formatter } from "@export/formatter";
import { ThemeColor } from "@util/values";
import { describe, expect, it } from "vite-plus/test";

import { CharacterSpacing, Color } from "./formatting";

describe("CharacterSpacing", () => {
    describe("#constructor()", () => {
        it("should create", () => {
            const element = new CharacterSpacing(32);

            const tree = new Formatter().format(element);
            expect(tree).to.deep.equal({
                "w:spacing": {
                    _attr: {
                        "w:val": 32,
                    },
                },
            });
        });
    });
});

describe("Color", () => {
    describe("#constructor()", () => {
        it("should create with hex string (backward compatible)", () => {
            const element = new Color("#FFFFFF");

            const tree = new Formatter().format(element);
            expect(tree).to.deep.equal({
                "w:color": {
                    _attr: {
                        "w:val": "FFFFFF",
                    },
                },
            });
        });

        it("should create with theme color options", () => {
            const element = new Color({
                themeColor: ThemeColor.ACCENT1,
                themeTint: "99",
                themeShade: "BF",
            });

            const tree = new Formatter().format(element);
            expect(tree).to.deep.equal({
                "w:color": {
                    _attr: {
                        "w:themeColor": "accent1",
                        "w:themeShade": "BF",
                        "w:themeTint": "99",
                    },
                },
            });
        });

        it("should create with theme color only", () => {
            const element = new Color({ themeColor: ThemeColor.DARK1 });

            const tree = new Formatter().format(element);
            expect(tree).to.deep.equal({
                "w:color": {
                    _attr: {
                        "w:themeColor": "dark1",
                    },
                },
            });
        });

        it("should create with explicit val and theme color", () => {
            const element = new Color({ val: "FF0000", themeColor: ThemeColor.ACCENT2 });

            const tree = new Formatter().format(element);
            expect(tree).to.deep.equal({
                "w:color": {
                    _attr: {
                        "w:themeColor": "accent2",
                        "w:val": "FF0000",
                    },
                },
            });
        });
    });
});
