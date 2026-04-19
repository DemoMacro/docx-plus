import { Formatter } from "@export/formatter";
import { describe, expect, it } from "vite-plus/test";

import { NumberProperties } from "./unordered-list";

describe("NumberProperties", () => {
    describe("#constructor()", () => {
        it("should create a Number Properties with correct root key", () => {
            const numberProperties = new NumberProperties(5, 9);

            const tree = new Formatter().format(numberProperties);
            expect(tree).to.deep.equal({
                "w:numPr": [
                    {
                        "w:ilvl": {
                            _attr: {
                                "w:val": 9,
                            },
                        },
                    },
                    {
                        "w:numId": {
                            _attr: {
                                "w:val": 5,
                            },
                        },
                    },
                ],
            });
        });

        it("should clamp level to 9 if exceeds", () => {
            const numberProperties = new NumberProperties(5, 10);

            const tree = new Formatter().format(numberProperties);
            expect(tree["w:numPr"][0]).to.deep.equal({
                "w:ilvl": {
                    _attr: {
                        "w:val": 9,
                    },
                },
            });
        });
    });
});
