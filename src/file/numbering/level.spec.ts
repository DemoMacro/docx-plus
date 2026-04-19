import { Formatter } from "@export/formatter";
import { describe, expect, it } from "vite-plus/test";

import { AlignmentType } from "..";
import { Level, LevelFormat, LevelSuffix } from "./level";

describe("Level", () => {
    describe("#constructor", () => {
        it("should clamp level to 9 if exceeds", () => {
            const level = new Level({
                alignment: AlignmentType.BOTH,
                format: LevelFormat.BULLET,
                level: 10,
                start: 3,
                style: { paragraph: {}, run: {} },
                suffix: LevelSuffix.SPACE,
                text: "test",
            });

            const tree = new Formatter().format(level);
            expect(tree["w:lvl"]).to.be.an("array");
            expect(tree["w:lvl"]).to.deep.include({
                _attr: { "w:ilvl": 9, "w15:tentative": 1 },
            });
        });
    });

    describe("isLegalNumberingStyle", () => {
        it("should work", () => {
            const concreteNumbering = new Level({
                isLegalNumberingStyle: true,
                level: 9,
            });
            const tree = new Formatter().format(concreteNumbering);
            expect(tree).to.deep.equal({
                "w:lvl": [
                    {
                        "w:start": {
                            _attr: {
                                "w:val": 1,
                            },
                        },
                    },
                    {
                        "w:isLgl": {},
                    },
                    {
                        "w:lvlJc": {
                            _attr: {
                                "w:val": "start",
                            },
                        },
                    },
                    {
                        _attr: {
                            "w15:tentative": 1,
                            "w:ilvl": 9,
                        },
                    },
                ],
            });
        });
    });
});
