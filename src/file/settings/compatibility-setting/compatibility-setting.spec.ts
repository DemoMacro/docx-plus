import { Formatter } from "@export/formatter";
import { describe, expect, it } from "vite-plus/test";

import { createCompatibilitySetting } from "./compatibility-setting";

describe("createCompatibilitySetting", () => {
    it("creates a compatibility setting with name and val", () => {
        const compatibilitySetting = createCompatibilitySetting("compatibilityMode", 15);

        const tree = new Formatter().format(compatibilitySetting);
        expect(tree).to.deep.equal({
            "w:compatSetting": {
                _attr: {
                    "w:name": "compatibilityMode",
                    "w:uri": "http://schemas.microsoft.com/office/word",
                    "w:val": 15,
                },
            },
        });
    });

    it("creates a compatibility setting with custom uri", () => {
        const setting = createCompatibilitySetting("overrideTableStyleFontSizeAndJustification", 1);

        const tree = new Formatter().format(setting);
        expect(tree).to.deep.equal({
            "w:compatSetting": {
                _attr: {
                    "w:name": "overrideTableStyleFontSizeAndJustification",
                    "w:uri": "http://schemas.microsoft.com/office/word",
                    "w:val": 1,
                },
            },
        });
    });
});
