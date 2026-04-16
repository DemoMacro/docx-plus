import { Formatter } from "@export/formatter";
import { describe, expect, it } from "vite-plus/test";

import { createInline } from "./inline";

describe("Inline", () => {
    it("should create with default effect extent", () => {
        const tree = new Formatter().format(
            createInline({
                docProperties: {
                    description: "test",
                    name: "test",
                    title: "test",
                },
                mediaData: {
                    data: Buffer.from(""),
                    fileName: "test.png",
                    transformation: {
                        emus: {
                            x: 0,
                            y: 0,
                        },
                        pixels: {
                            x: 0,
                            y: 0,
                        },
                    },
                    type: "png",
                },
                outline: { type: "solidFill", color: { value: "FFFFFF" } },
                transform: {
                    emus: {
                        x: 100,
                        y: 100,
                    },
                    pixels: {
                        x: 100,
                        y: 100,
                    },
                },
            }),
        );

        expect(tree).toStrictEqual({
            "wp:inline": expect.arrayContaining([
                {
                    "wp:effectExtent": {
                        _attr: {
                            b: 19_050,
                            l: 19_050,
                            r: 19_050,
                            t: 19_050,
                        },
                    },
                },
            ]),
        });
    });
});
