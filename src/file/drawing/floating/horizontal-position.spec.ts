import { Formatter } from "@export/formatter";
import { HorizontalPositionAlign } from "@file/shared/alignment";
import { describe, expect, it } from "vite-plus/test";

import { HorizontalPositionRelativeFrom } from "./floating-position";
import { createHorizontalPosition } from "./horizontal-position";

describe("HorizontalPosition", () => {
    describe("#constructor()", () => {
        it("should create a element with position align", () => {
            const tree = new Formatter().format(
                createHorizontalPosition({
                    align: HorizontalPositionAlign.CENTER,
                    relative: HorizontalPositionRelativeFrom.MARGIN,
                }),
            );
            expect(tree).to.deep.equal({
                "wp:positionH": [
                    {
                        _attr: {
                            relativeFrom: "margin",
                        },
                    },
                    {
                        "wp:align": ["center"],
                    },
                ],
            });
        });

        it("should create a element with offset", () => {
            const tree = new Formatter().format(
                createHorizontalPosition({
                    offset: 40,
                    relative: HorizontalPositionRelativeFrom.MARGIN,
                }),
            );
            expect(tree).to.deep.equal({
                "wp:positionH": [
                    {
                        _attr: {
                            relativeFrom: "margin",
                        },
                    },
                    {
                        "wp:posOffset": ["40"],
                    },
                ],
            });
        });

        it("should default to LEFT align when neither align nor offset is specified", () => {
            const tree = new Formatter().format(createHorizontalPosition({}));
            expect(tree).to.deep.equal({
                "wp:positionH": [
                    {
                        _attr: {
                            relativeFrom: "page",
                        },
                    },
                    {
                        "wp:align": ["LEFT"],
                    },
                ],
            });
        });
    });
});
