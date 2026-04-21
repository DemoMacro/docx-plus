import { Formatter } from "@export/formatter";
import { describe, expect, it } from "vite-plus/test";

import { createSourceRectangle } from "./source-rectangle";

describe("SourceRectangle", () => {
    describe("createSourceRectangle", () => {
        it("should create empty source rectangle with no options", () => {
            const tree = new Formatter().format(createSourceRectangle());
            expect(tree).to.deep.equal({
                "a:srcRect": {},
            });
        });

        it("should create source rectangle with left crop", () => {
            const tree = new Formatter().format(createSourceRectangle({ left: 10000 }));
            expect(tree).to.deep.equal({
                "a:srcRect": {
                    _attr: {
                        l: 10000,
                    },
                },
            });
        });

        it("should create source rectangle with all crop values", () => {
            const tree = new Formatter().format(
                createSourceRectangle({ left: 10000, top: 5000, right: 10000, bottom: 5000 }),
            );
            expect(tree).to.deep.equal({
                "a:srcRect": {
                    _attr: {
                        b: 5000,
                        l: 10000,
                        r: 10000,
                        t: 5000,
                    },
                },
            });
        });

        it("should create source rectangle with only right and bottom", () => {
            const tree = new Formatter().format(
                createSourceRectangle({ right: 20000, bottom: 15000 }),
            );
            expect(tree).to.deep.equal({
                "a:srcRect": {
                    _attr: {
                        b: 15000,
                        r: 20000,
                    },
                },
            });
        });
    });
});
