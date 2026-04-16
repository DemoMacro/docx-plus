import { Formatter } from "@export/formatter";
import { ThemeFont } from "@util/values";
import { describe, expect, it } from "vite-plus/test";

import { createRunFonts } from "./run-fonts";

describe("createRunFonts", () => {
    it("uses the font name for both ascii and hAnsi", () => {
        const tree = new Formatter().format(createRunFonts("Times"));
        expect(tree).to.deep.equal({
            "w:rFonts": {
                _attr: {
                    "w:ascii": "Times",
                    "w:cs": "Times",
                    "w:eastAsia": "Times",
                    "w:hAnsi": "Times",
                },
            },
        });
    });

    it("uses hint if given", () => {
        const tree = new Formatter().format(createRunFonts("Times", "default"));
        expect(tree).to.deep.equal({
            "w:rFonts": {
                _attr: {
                    "w:ascii": "Times",
                    "w:cs": "Times",
                    "w:eastAsia": "Times",
                    "w:hAnsi": "Times",
                    "w:hint": "default",
                },
            },
        });
    });

    it("uses the font attrs for ascii and eastAsia", () => {
        const tree = new Formatter().format(createRunFonts({ ascii: "Times", eastAsia: "KaiTi" }));
        expect(tree).to.deep.equal({
            "w:rFonts": { _attr: { "w:ascii": "Times", "w:eastAsia": "KaiTi" } },
        });
    });

    it("should support theme font references", () => {
        const tree = new Formatter().format(
            createRunFonts({
                asciiTheme: ThemeFont.MAJOR_ASCII,
                hAnsiTheme: ThemeFont.MAJOR_H_ANSI,
                eastAsiaTheme: ThemeFont.MAJOR_EAST_ASIA,
                cstheme: ThemeFont.MAJOR_BIDI,
            }),
        );
        expect(tree).to.deep.equal({
            "w:rFonts": {
                _attr: {
                    "w:asciiTheme": "majorAscii",
                    "w:cstheme": "majorBidi",
                    "w:eastAsiaTheme": "majorEastAsia",
                    "w:hAnsiTheme": "majorHAnsi",
                },
            },
        });
    });

    it("should support mixed explicit and theme font references", () => {
        const tree = new Formatter().format(
            createRunFonts({
                ascii: "Arial",
                asciiTheme: ThemeFont.MINOR_ASCII,
                hAnsiTheme: ThemeFont.MINOR_H_ANSI,
            }),
        );
        expect(tree).to.deep.equal({
            "w:rFonts": {
                _attr: {
                    "w:ascii": "Arial",
                    "w:asciiTheme": "minorAscii",
                    "w:hAnsiTheme": "minorHAnsi",
                },
            },
        });
    });
});
