import { Formatter } from "@export/formatter";
import { describe, expect, it } from "vite-plus/test";

import { ShapeProperties } from "./shape-properties";

const TRANSFORM = {
    emus: { x: 914400, y: 914400 },
    pixels: { x: 100, y: 100 },
};

describe("ShapeProperties", () => {
    it("should create with no fill", () => {
        const props = new ShapeProperties({
            element: "pic",
            transform: TRANSFORM,
            noFill: true,
        });
        const tree = new Formatter().format(props);
        expect(tree["pic:spPr"]).to.include.deep.members([{ "a:noFill": {} }]);
    });

    it("should create with solid fill", () => {
        const props = new ShapeProperties({
            element: "pic",
            transform: TRANSFORM,
            solidFill: { value: "FF0000" },
        });
        const tree = new Formatter().format(props);
        expect(tree["pic:spPr"]).to.include.deep.members([
            { "a:solidFill": [{ "a:srgbClr": { _attr: { val: "FF0000" } } }] },
        ]);
    });

    it("should create with gradient fill", () => {
        const props = new ShapeProperties({
            element: "pic",
            transform: TRANSFORM,
            gradientFill: {
                stops: [
                    { position: 0, color: { value: "FF0000" } },
                    { position: 100000, color: { value: "0000FF" } },
                ],
                shade: { angle: 5400000 },
            },
        });
        const tree = new Formatter().format(props);
        expect(tree["pic:spPr"]).to.include.deep.members([
            {
                "a:gradFill": [
                    { _attr: {} },
                    {
                        "a:gsLst": [
                            {
                                "a:gs": [
                                    { _attr: { pos: 0 } },
                                    { "a:srgbClr": { _attr: { val: "FF0000" } } },
                                ],
                            },
                            {
                                "a:gs": [
                                    { _attr: { pos: 100000 } },
                                    { "a:srgbClr": { _attr: { val: "0000FF" } } },
                                ],
                            },
                        ],
                    },
                    { "a:lin": { _attr: { ang: 5400000 } } },
                ],
            },
        ]);
    });

    it("should create with outline and default no fill", () => {
        const props = new ShapeProperties({
            element: "pic",
            transform: TRANSFORM,
            outline: { type: "solidFill", color: { value: "000000" }, width: 12700 },
        });
        const tree = new Formatter().format(props);
        expect(tree["pic:spPr"]).to.include.deep.members([
            { "a:noFill": {} },
            {
                "a:ln": [
                    { _attr: { w: 12700 } },
                    { "a:solidFill": [{ "a:srgbClr": { _attr: { val: "000000" } } }] },
                ],
            },
        ]);
    });

    it("should create with gradient fill and outline", () => {
        const props = new ShapeProperties({
            element: "pic",
            transform: TRANSFORM,
            gradientFill: {
                stops: [
                    { position: 0, color: { value: "FFFFFF" } },
                    { position: 100000, color: { value: "000000" } },
                ],
            },
            outline: { type: "solidFill", color: { value: "000000" } },
        });
        const tree = new Formatter().format(props);
        expect(tree["pic:spPr"]).to.include.deep.members([
            {
                "a:gradFill": [
                    { _attr: {} },
                    {
                        "a:gsLst": [
                            {
                                "a:gs": [
                                    { _attr: { pos: 0 } },
                                    { "a:srgbClr": { _attr: { val: "FFFFFF" } } },
                                ],
                            },
                            {
                                "a:gs": [
                                    { _attr: { pos: 100000 } },
                                    { "a:srgbClr": { _attr: { val: "000000" } } },
                                ],
                            },
                        ],
                    },
                ],
            },
            {
                "a:ln": [
                    { _attr: {} },
                    { "a:solidFill": [{ "a:srgbClr": { _attr: { val: "000000" } } }] },
                ],
            },
        ]);
    });
});
