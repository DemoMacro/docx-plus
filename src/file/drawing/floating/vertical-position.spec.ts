import { Formatter } from "@export/formatter";
import { VerticalPositionAlign } from "@file/shared/alignment";
import { describe, expect, it } from "vite-plus/test";

import { VerticalPositionRelativeFrom } from "./floating-position";
import { createVerticalPosition } from "./vertical-position";

describe("VerticalPosition", () => {
    describe("#constructor()", () => {
        it("should create a element with position align", () => {
            const tree = new Formatter().format(
                createVerticalPosition({
                    align: VerticalPositionAlign.INSIDE,
                    relative: VerticalPositionRelativeFrom.MARGIN,
                }),
            );
            expect(tree).to.deep.equal({
                "wp:positionV": [
                    {
                        _attr: {
                            relativeFrom: "margin",
                        },
                    },
                    {
                        "wp:align": ["inside"],
                    },
                ],
            });
        });

        it("should create a element with offset", () => {
            const tree = new Formatter().format(
                createVerticalPosition({
                    offset: 40,
                    relative: VerticalPositionRelativeFrom.MARGIN,
                }),
            );
            expect(tree).to.deep.equal({
                "wp:positionV": [
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

        it("should default to TOP align when neither align nor offset is specified", () => {
            const tree = new Formatter().format(createVerticalPosition({}));
            expect(tree).to.deep.equal({
                "wp:positionV": [
                    {
                        _attr: {
                            relativeFrom: "page",
                        },
                    },
                    {
                        "wp:align": ["TOP"],
                    },
                ],
            });
        });
    });
});
