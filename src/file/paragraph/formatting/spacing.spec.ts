import { Formatter } from "@export/formatter";
import { describe, expect, it } from "vite-plus/test";

import { createSpacing } from "./spacing";

describe("Spacing", () => {
    describe("#createSpacing", () => {
        it("should set the properties given", () => {
            const spacing = createSpacing({ after: 120, before: 100, line: 150 });
            const tree = new Formatter().format(spacing);
            expect(tree).to.deep.equal({
                "w:spacing": { _attr: { "w:after": 120, "w:before": 100, "w:line": 150 } },
            });
        });

        it("should only set the given properties", () => {
            const spacing = createSpacing({ before: 100 });
            const tree = new Formatter().format(spacing);
            expect(tree).to.deep.equal({
                "w:spacing": { _attr: { "w:before": 100 } },
            });
        });

        it("should support beforeLines and afterLines", () => {
            const spacing = createSpacing({ beforeLines: 2, afterLines: 1 });
            const tree = new Formatter().format(spacing);
            expect(tree).to.deep.equal({
                "w:spacing": { _attr: { "w:afterLines": 1, "w:beforeLines": 2 } },
            });
        });

        it("should convert beforeLines and afterLines to integers", () => {
            const spacing = createSpacing({ beforeLines: 2.7, afterLines: 1.3 });
            const tree = new Formatter().format(spacing);
            expect(tree).to.deep.equal({
                "w:spacing": { _attr: { "w:afterLines": 1, "w:beforeLines": 2 } },
            });
        });
    });
});
