import { Formatter } from "@export/formatter";
import { FooterWrapper } from "@file/footer-wrapper";
import { HeaderWrapper } from "@file/header-wrapper";
import { Media } from "@file/media";
import { NumberFormat } from "@file/shared/number-format";
import { VerticalAlignSection } from "@file/vertical-align";
import { convertInchesToTwip } from "@util/convenience-functions";
import { describe, expect, it } from "vite-plus/test";

import { PageOrientation } from "./properties";
import { DocumentGridType } from "./properties/doc-grid";
import {
    FootnotePositionType,
    EndnotePositionType,
    NumberRestartType,
} from "./properties/footnote-endnote-properties";
import { LineNumberRestartFormat } from "./properties/line-number";
import { PageBorderOffsetFrom } from "./properties/page-borders";
import { PageTextDirectionType } from "./properties/page-text-direction";
import { SectionType } from "./properties/section-type";
import {
    SectionProperties,
    sectionMarginDefaults,
    sectionPageSizeDefaults,
} from "./section-properties";

const DEFAULT_MARGINS = {
    "w:bottom": sectionMarginDefaults.BOTTOM,
    "w:footer": sectionMarginDefaults.FOOTER,
    "w:gutter": sectionMarginDefaults.GUTTER,
    "w:header": sectionMarginDefaults.HEADER,
    "w:left": sectionMarginDefaults.LEFT,
    "w:right": sectionMarginDefaults.RIGHT,
    "w:top": sectionMarginDefaults.TOP,
};

const PAGE_SIZE_DEFAULTS = {
    "w:h": sectionPageSizeDefaults.HEIGHT,
    "w:orient": sectionPageSizeDefaults.ORIENTATION,
    "w:w": sectionPageSizeDefaults.WIDTH,
};

describe("SectionProperties", () => {
    describe("#constructor()", () => {
        it("should create section properties with options", () => {
            const media = new Media();

            const properties = new SectionProperties({
                column: {
                    count: 2,
                    separate: true,
                    space: 208,
                },
                footerWrapperGroup: {
                    even: new FooterWrapper(media, 200),
                },
                grid: {
                    linePitch: convertInchesToTwip(0.25),
                    type: DocumentGridType.LINES,
                },
                headerWrapperGroup: {
                    default: new HeaderWrapper(media, 100),
                },
                page: {
                    margin: {
                        bottom: "2in",
                        footer: 808,
                        gutter: 10,
                        header: 808,
                        left: "2in",
                        right: "2in",
                        top: "2in",
                    },
                    pageNumbers: {
                        formatType: NumberFormat.CARDINAL_TEXT,
                        start: 10,
                    },
                    size: {
                        height: 1680,
                        orientation: PageOrientation.PORTRAIT,
                        width: 1190,
                    },
                },
                titlePage: true,
                verticalAlign: VerticalAlignSection.TOP,
            });

            const tree = new Formatter().format(properties);

            expect(Object.keys(tree)).to.deep.equal(["w:sectPr"]);
            expect(tree["w:sectPr"]).to.be.an.instanceof(Array);
            expect(tree["w:sectPr"][0]).to.deep.equal({
                "w:headerReference": { _attr: { "r:id": "rId100", "w:type": "default" } },
            });
            expect(tree["w:sectPr"][1]).to.deep.equal({
                "w:footerReference": { _attr: { "r:id": "rId200", "w:type": "even" } },
            });
            expect(tree["w:sectPr"][2]).to.deep.equal({
                "w:pgSz": { _attr: { "w:h": 1680, "w:orient": "portrait", "w:w": 1190 } },
            });
            expect(tree["w:sectPr"][3]).to.deep.equal({
                "w:pgMar": {
                    _attr: {
                        "w:bottom": "2in",
                        "w:footer": 808,
                        "w:gutter": 10,
                        "w:header": 808,
                        "w:left": "2in",
                        "w:right": "2in",
                        "w:top": "2in",
                    },
                },
            });

            expect(tree["w:sectPr"][4]).to.deep.equal({
                "w:pgNumType": { _attr: { "w:fmt": "cardinalText", "w:start": 10 } },
            });
            expect(tree["w:sectPr"][5]).to.deep.equal({
                "w:cols": { _attr: { "w:num": 2, "w:sep": true, "w:space": 208 } },
            });
            expect(tree["w:sectPr"][6]).to.deep.equal({
                "w:vAlign": { _attr: { "w:val": "top" } },
            });
            expect(tree["w:sectPr"][7]).to.deep.equal({ "w:titlePg": {} });
            expect(tree["w:sectPr"][8]).to.deep.equal({
                "w:docGrid": { _attr: { "w:linePitch": 360, "w:type": "lines" } },
            });
        });

        it("should create section properties with no options", () => {
            const properties = new SectionProperties();
            const tree = new Formatter().format(properties);
            expect(Object.keys(tree)).to.deep.equal(["w:sectPr"]);
            expect(tree["w:sectPr"]).to.be.an.instanceof(Array);
            expect(tree["w:sectPr"][0]).to.deep.equal({ "w:pgSz": { _attr: PAGE_SIZE_DEFAULTS } });
            expect(tree["w:sectPr"][1]).to.deep.equal({
                "w:pgMar": { _attr: DEFAULT_MARGINS },
            });
            // Expect(tree["w:sectPr"][3]).to.deep.equal({ "w:cols": { _attr: { "w:space": 708, "w:sep": false, "w:num": 1 } } });
            expect(tree["w:sectPr"][3]).to.deep.equal({
                "w:docGrid": { _attr: { "w:linePitch": 312, "w:type": "lines" } },
            });
        });

        it("should create section properties with changed options", () => {
            const properties = new SectionProperties({
                page: {
                    margin: {
                        top: 0,
                    },
                },
            });
            const tree = new Formatter().format(properties);
            expect(Object.keys(tree)).to.deep.equal(["w:sectPr"]);
            expect(tree["w:sectPr"]).to.be.an.instanceof(Array);
            expect(tree["w:sectPr"][0]).to.deep.equal({ "w:pgSz": { _attr: PAGE_SIZE_DEFAULTS } });
            expect(tree["w:sectPr"][1]).to.deep.equal({
                "w:pgMar": {
                    _attr: {
                        ...DEFAULT_MARGINS,
                        "w:top": 0,
                    },
                },
            });
        });

        it("should create section properties with changed options", () => {
            const properties = new SectionProperties({
                page: {
                    margin: {
                        bottom: 0,
                    },
                },
            });
            const tree = new Formatter().format(properties);
            expect(Object.keys(tree)).to.deep.equal(["w:sectPr"]);
            expect(tree["w:sectPr"]).to.be.an.instanceof(Array);
            expect(tree["w:sectPr"][0]).to.deep.equal({ "w:pgSz": { _attr: PAGE_SIZE_DEFAULTS } });
            expect(tree["w:sectPr"][1]).to.deep.equal({
                "w:pgMar": {
                    _attr: {
                        ...DEFAULT_MARGINS,
                        "w:bottom": 0,
                    },
                },
            });
        });

        it("should create section properties with changed options", () => {
            const properties = new SectionProperties({
                page: {
                    size: {
                        height: 0,
                        orientation: PageOrientation.LANDSCAPE,
                        width: 0,
                    },
                },
            });
            const tree = new Formatter().format(properties);
            expect(Object.keys(tree)).to.deep.equal(["w:sectPr"]);
            expect(tree["w:sectPr"]).to.be.an.instanceof(Array);
            expect(tree["w:sectPr"][0]).to.deep.equal({
                "w:pgSz": {
                    _attr: {
                        "w:h": 0,
                        "w:orient": PageOrientation.LANDSCAPE,
                        "w:w": 0,
                    },
                },
            });
            expect(tree["w:sectPr"][1]).to.deep.equal({
                "w:pgMar": {
                    _attr: DEFAULT_MARGINS,
                },
            });
        });

        it("should create section properties with page borders", () => {
            const properties = new SectionProperties({
                page: {
                    borders: {
                        pageBorders: {
                            offsetFrom: PageBorderOffsetFrom.PAGE,
                        },
                    },
                },
            });
            const tree = new Formatter().format(properties);
            expect(Object.keys(tree)).to.deep.equal(["w:sectPr"]);
            const pgBorders = tree["w:sectPr"].find(
                (item: any) => item["w:pgBorders"] !== undefined,
            );
            expect(pgBorders).to.deep.equal({
                "w:pgBorders": { _attr: { "w:offsetFrom": "page" } },
            });
        });

        it("should create section properties with page number type, but without start attribute", () => {
            const properties = new SectionProperties({
                page: {
                    pageNumbers: {
                        formatType: NumberFormat.UPPER_ROMAN,
                    },
                },
            });
            const tree = new Formatter().format(properties);
            expect(Object.keys(tree)).to.deep.equal(["w:sectPr"]);
            const pgNumType = tree["w:sectPr"].find(
                (item: any) => item["w:pgNumType"] !== undefined,
            );
            expect(pgNumType).to.deep.equal({
                "w:pgNumType": { _attr: { "w:fmt": "upperRoman" } },
            });
        });

        it("should create section properties with a page number type by default", () => {
            const properties = new SectionProperties({});
            const tree = new Formatter().format(properties);
            expect(Object.keys(tree)).to.deep.equal(["w:sectPr"]);
            const pgNumType = tree["w:sectPr"].find(
                (item: any) => item["w:pgNumType"] !== undefined,
            );
            expect(pgNumType).to.deep.equal({ "w:pgNumType": { _attr: {} } });
        });

        it("should create section properties with page number chapStyle", () => {
            const properties = new SectionProperties({
                page: {
                    pageNumbers: {
                        chapStyle: 1,
                        start: 10,
                    },
                },
            });
            const tree = new Formatter().format(properties);
            const pgNumType = tree["w:sectPr"].find(
                (item: any) => item["w:pgNumType"] !== undefined,
            );
            expect(pgNumType).to.deep.equal({
                "w:pgNumType": { _attr: { "w:chapStyle": 1, "w:start": 10 } },
            });
        });

        it("should create section properties with section type", () => {
            const properties = new SectionProperties({
                type: SectionType.CONTINUOUS,
            });
            const tree = new Formatter().format(properties);
            expect(Object.keys(tree)).to.deep.equal(["w:sectPr"]);
            const type = tree["w:sectPr"].find((item: any) => item["w:type"] !== undefined);
            expect(type).to.deep.equal({
                "w:type": { _attr: { "w:val": "continuous" } },
            });
        });

        it("should create section properties line number type", () => {
            const properties = new SectionProperties({
                lineNumbers: {
                    countBy: 2,
                    distance: 4,
                    restart: LineNumberRestartFormat.CONTINUOUS,
                    start: 2,
                },
            });
            const tree = new Formatter().format(properties);
            expect(Object.keys(tree)).to.deep.equal(["w:sectPr"]);
            const type = tree["w:sectPr"].find((item: any) => item["w:lnNumType"] !== undefined);
            expect(type).to.deep.equal({
                "w:lnNumType": {
                    _attr: {
                        "w:countBy": 2,
                        "w:distance": 4,
                        "w:restart": "continuous",
                        "w:start": 2,
                    },
                },
            });
        });

        it("should create section properties with text flow direction", () => {
            const properties = new SectionProperties({
                page: {
                    textDirection: PageTextDirectionType.TOP_TO_BOTTOM_RIGHT_TO_LEFT,
                },
            });
            const tree = new Formatter().format(properties);
            expect(Object.keys(tree)).to.deep.equal(["w:sectPr"]);
            const type = tree["w:sectPr"].find(
                (item: any) => item["w:textDirection"] !== undefined,
            );
            expect(type).to.deep.equal({
                "w:textDirection": { _attr: { "w:val": "tbRl" } },
            });
        });

        it("should create section properties with revision", () => {
            const properties = new SectionProperties({
                page: {
                    textDirection: PageTextDirectionType.TOP_TO_BOTTOM_RIGHT_TO_LEFT,
                },
                revision: {
                    author: "Firstname Lastname",
                    date: "123",
                    id: 1,
                    page: {
                        textDirection: PageTextDirectionType.LEFT_TO_RIGHT_TOP_TO_BOTTOM,
                    },
                },
            });
            const tree = new Formatter().format(properties);
            expect(Object.keys(tree)).to.deep.equal(["w:sectPr"]);
            const prChange = tree["w:sectPr"].find(
                (item: any) => item["w:sectPrChange"] !== undefined,
            );
            expect(prChange).toBeDefined();
            const sectPrInChange = prChange["w:sectPrChange"].find(
                (item: any) => item["w:sectPr"] !== undefined,
            );
            expect(sectPrInChange).toBeDefined();
            const textDirection = sectPrInChange["w:sectPr"].find(
                (item: any) => item["w:textDirection"] !== undefined,
            );
            expect(textDirection).to.deep.equal({
                "w:textDirection": { _attr: { "w:val": "lrTb" } },
            });
        });

        it("should create section properties with noEndnote", () => {
            const properties = new SectionProperties({ noEndnote: true });
            const tree = new Formatter().format(properties);
            const noEndnote = tree["w:sectPr"].find(
                (item: any) => item["w:noEndnote"] !== undefined,
            );
            expect(noEndnote).to.deep.equal({ "w:noEndnote": {} });
        });

        it("should create section properties with bidi", () => {
            const properties = new SectionProperties({ bidi: true });
            const tree = new Formatter().format(properties);
            const bidi = tree["w:sectPr"].find((item: any) => item["w:bidi"] !== undefined);
            expect(bidi).to.deep.equal({ "w:bidi": {} });
        });

        it("should create section properties with rtlGutter", () => {
            const properties = new SectionProperties({ rtlGutter: true });
            const tree = new Formatter().format(properties);
            const rtlGutter = tree["w:sectPr"].find(
                (item: any) => item["w:rtlGutter"] !== undefined,
            );
            expect(rtlGutter).to.deep.equal({ "w:rtlGutter": {} });
        });

        it("should create section properties with paperSrc", () => {
            const properties = new SectionProperties({ paperSrc: { first: 1, other: 2 } });
            const tree = new Formatter().format(properties);
            const paperSrc = tree["w:sectPr"].find((item: any) => item["w:paperSrc"] !== undefined);
            expect(paperSrc).to.deep.equal({
                "w:paperSrc": { _attr: { "w:first": 1, "w:other": 2 } },
            });
        });

        it("should create section properties with paperSrc first only", () => {
            const properties = new SectionProperties({ paperSrc: { first: 1 } });
            const tree = new Formatter().format(properties);
            const paperSrc = tree["w:sectPr"].find((item: any) => item["w:paperSrc"] !== undefined);
            expect(paperSrc).to.deep.equal({
                "w:paperSrc": { _attr: { "w:first": 1 } },
            });
        });

        it("should create section properties with paperSrc other only", () => {
            const properties = new SectionProperties({ paperSrc: { other: 2 } });
            const tree = new Formatter().format(properties);
            const paperSrc = tree["w:sectPr"].find((item: any) => item["w:paperSrc"] !== undefined);
            expect(paperSrc).to.deep.equal({
                "w:paperSrc": { _attr: { "w:other": 2 } },
            });
        });

        it("should create section properties with footnotePr", () => {
            const properties = new SectionProperties({
                footnotePr: {
                    pos: FootnotePositionType.BENEATH_TEXT,
                    numStart: 1,
                    numRestart: NumberRestartType.EACH_PAGE,
                },
            });
            const tree = new Formatter().format(properties);
            const footnotePr = tree["w:sectPr"].find(
                (item: any) => item["w:footnotePr"] !== undefined,
            );
            expect(footnotePr).to.deep.equal({
                "w:footnotePr": [
                    { "w:pos": { _attr: { "w:val": "beneathText" } } },
                    { "w:numStart": { _attr: { "w:val": 1 } } },
                    { "w:numRestart": { _attr: { "w:val": "eachPage" } } },
                ],
            });
        });

        it("should create section properties with endnotePr", () => {
            const properties = new SectionProperties({
                endnotePr: {
                    pos: EndnotePositionType.SECT_END,
                },
            });
            const tree = new Formatter().format(properties);
            const endnotePr = tree["w:sectPr"].find(
                (item: any) => item["w:endnotePr"] !== undefined,
            );
            expect(endnotePr).to.deep.equal({
                "w:endnotePr": [{ "w:pos": { _attr: { "w:val": "sectEnd" } } }],
            });
        });
    });
});
