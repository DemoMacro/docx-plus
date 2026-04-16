import { Formatter } from "@export/formatter";
import { describe, expect, it } from "vite-plus/test";

import { createHslColor } from "./hsl-color";
import { createPresetColor, PresetColor } from "./preset-color";
import { SchemeColor } from "./scheme-color";
import { createSolidFill } from "./solid-fill";
import { createSystemColor, SystemColor } from "./system-color";

describe("createSolidFill", () => {
    it("should create rgb fill", () => {
        const tree = new Formatter().format(createSolidFill({ value: "FFFFFF" }));
        expect(tree).to.deep.equal({
            "a:solidFill": [
                {
                    "a:srgbClr": {
                        _attr: {
                            val: "FFFFFF",
                        },
                    },
                },
            ],
        });
    });

    it("should create scheme fill", () => {
        const tree = new Formatter().format(createSolidFill({ value: SchemeColor.TX1 }));
        expect(tree).to.deep.equal({
            "a:solidFill": [
                {
                    "a:schemeClr": {
                        _attr: {
                            val: "tx1",
                        },
                    },
                },
            ],
        });
    });

    it("should create hsl fill", () => {
        const tree = new Formatter().format(
            createSolidFill({ hue: 120000, sat: 100000, lum: 50000 }),
        );
        expect(tree).to.deep.equal({
            "a:solidFill": [
                {
                    "a:hslClr": {
                        _attr: {
                            hue: 120000,
                            lum: 50000,
                            sat: 100000,
                        },
                    },
                },
            ],
        });
    });

    it("should create system color fill", () => {
        const tree = new Formatter().format(
            createSolidFill({ value: SystemColor.WINDOW, lastClr: "FFFFFF" }),
        );
        expect(tree).to.deep.equal({
            "a:solidFill": [
                {
                    "a:sysClr": {
                        _attr: {
                            lastClr: "FFFFFF",
                            val: "window",
                        },
                    },
                },
            ],
        });
    });

    it("should create preset color fill", () => {
        const tree = new Formatter().format(createSolidFill({ value: PresetColor.RED }));
        expect(tree).to.deep.equal({
            "a:solidFill": [
                {
                    "a:prstClr": {
                        _attr: {
                            val: "red",
                        },
                    },
                },
            ],
        });
    });

    it("should create rgb fill with alpha transform", () => {
        const tree = new Formatter().format(
            createSolidFill({ value: "FF0000", transforms: { alpha: 50000 } }),
        );
        expect(tree).to.deep.equal({
            "a:solidFill": [
                {
                    "a:srgbClr": [
                        { _attr: { val: "FF0000" } },
                        { "a:alpha": { _attr: { val: 50000 } } },
                    ],
                },
            ],
        });
    });

    it("should create scheme fill with tint transform", () => {
        const tree = new Formatter().format(
            createSolidFill({ value: SchemeColor.ACCENT1, transforms: { tint: 40000 } }),
        );
        expect(tree).to.deep.equal({
            "a:solidFill": [
                {
                    "a:schemeClr": [
                        { _attr: { val: "accent1" } },
                        { "a:tint": { _attr: { val: 40000 } } },
                    ],
                },
            ],
        });
    });
});

describe("createHslColor", () => {
    it("should create HSL color element", () => {
        const tree = new Formatter().format(
            createHslColor({ hue: 240000, sat: 100000, lum: 50000 }),
        );
        expect(tree).to.deep.equal({
            "a:hslClr": { _attr: { hue: 240000, lum: 50000, sat: 100000 } },
        });
    });

    it("should create HSL color with transforms", () => {
        const tree = new Formatter().format(
            createHslColor({ hue: 240000, sat: 100000, lum: 50000, transforms: { shade: 30000 } }),
        );
        expect(tree).to.deep.equal({
            "a:hslClr": [
                { _attr: { hue: 240000, lum: 50000, sat: 100000 } },
                { "a:shade": { _attr: { val: 30000 } } },
            ],
        });
    });
});

describe("createSystemColor", () => {
    it("should create system color element", () => {
        const tree = new Formatter().format(createSystemColor({ value: SystemColor.WINDOW }));
        expect(tree).to.deep.equal({
            "a:sysClr": { _attr: { val: "window" } },
        });
    });

    it("should create system color with lastClr", () => {
        const tree = new Formatter().format(
            createSystemColor({ value: SystemColor.WINDOW_TEXT, lastClr: "000000" }),
        );
        expect(tree).to.deep.equal({
            "a:sysClr": { _attr: { lastClr: "000000", val: "windowText" } },
        });
    });

    it("should create system color with transforms", () => {
        const tree = new Formatter().format(
            createSystemColor({ value: SystemColor.WINDOW, transforms: { alpha: 50000 } }),
        );
        expect(tree).to.deep.equal({
            "a:sysClr": [{ _attr: { val: "window" } }, { "a:alpha": { _attr: { val: 50000 } } }],
        });
    });
});

describe("createPresetColor", () => {
    it("should create preset color element", () => {
        const tree = new Formatter().format(createPresetColor({ value: PresetColor.DARK_BLUE }));
        expect(tree).to.deep.equal({
            "a:prstClr": { _attr: { val: "darkBlue" } },
        });
    });

    it("should create preset color with transforms", () => {
        const tree = new Formatter().format(
            createPresetColor({ value: PresetColor.GOLD, transforms: { lumMod: 75000 } }),
        );
        expect(tree).to.deep.equal({
            "a:prstClr": [{ _attr: { val: "gold" } }, { "a:lumMod": { _attr: { val: 75000 } } }],
        });
    });
});
