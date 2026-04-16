import { Formatter } from "@export/formatter";
import { ThemeColor } from "@util/values";
import { describe, expect, it } from "vite-plus/test";

import { ShadingType, createShading } from "./shading";

describe("Shading", () => {
    describe("#createShading", () => {
        it("should create", () => {
            const shading = createShading({});
            const tree = new Formatter().format(shading);
            expect(tree).to.deep.equal({
                "w:shd": {
                    _attr: {},
                },
            });
        });

        it("should create with params", () => {
            const shading = createShading({
                color: "FF0000",
                fill: "555555",
                type: ShadingType.PERCENT_40,
            });
            const tree = new Formatter().format(shading);
            expect(tree).to.deep.equal({
                "w:shd": {
                    _attr: {
                        "w:color": "FF0000",
                        "w:fill": "555555",
                        "w:val": "pct40",
                    },
                },
            });
        });

        it("should support theme color and fill attributes", () => {
            const shading = createShading({
                type: ShadingType.CLEAR,
                themeColor: ThemeColor.ACCENT1,
                themeTint: "99",
                themeShade: "BF",
                themeFill: ThemeColor.DARK1,
                themeFillTint: "AA",
                themeFillShade: "CC",
            });
            const tree = new Formatter().format(shading);
            expect(tree).to.deep.equal({
                "w:shd": {
                    _attr: {
                        "w:themeColor": "accent1",
                        "w:themeFill": "dark1",
                        "w:themeFillShade": "CC",
                        "w:themeFillTint": "AA",
                        "w:themeShade": "BF",
                        "w:themeTint": "99",
                        "w:val": "clear",
                    },
                },
            });
        });
    });
});
