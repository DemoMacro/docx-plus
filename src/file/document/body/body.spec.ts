import { Formatter } from "@export/formatter";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { Body } from "./body";
import { sectionMarginDefaults } from "./section-properties";

describe("Body", () => {
    let body: Body;

    beforeEach(() => {
        body = new Body();
    });

    describe("#addSection", () => {
        it("should add section with default parameters", () => {
            body.addSection({
                page: {
                    size: {
                        height: 10_000,
                        width: 10_000,
                    },
                },
            });

            const tree = new Formatter().format(body);

            expect(tree).to.deep.equal({
                "w:body": [
                    {
                        "w:sectPr": [
                            {
                                "w:pgSz": {
                                    _attr: { "w:h": 10_000, "w:orient": "portrait", "w:w": 10_000 },
                                },
                            },
                            {
                                "w:pgMar": {
                                    _attr: {
                                        "w:bottom": sectionMarginDefaults.BOTTOM,
                                        "w:footer": sectionMarginDefaults.FOOTER,
                                        "w:gutter": sectionMarginDefaults.GUTTER,
                                        "w:header": sectionMarginDefaults.HEADER,
                                        "w:left": sectionMarginDefaults.LEFT,
                                        "w:right": sectionMarginDefaults.RIGHT,
                                        "w:top": sectionMarginDefaults.TOP,
                                    },
                                },
                            },
                            {
                                "w:pgNumType": {
                                    _attr: {},
                                },
                            },
                            // { "w:cols": { _attr: { "w:space": 708, "w:sep": false, "w:num": 1 } } },
                            { "w:docGrid": { _attr: { "w:linePitch": 312, "w:type": "lines" } } },
                        ],
                    },
                ],
            });
        });
    });
});
