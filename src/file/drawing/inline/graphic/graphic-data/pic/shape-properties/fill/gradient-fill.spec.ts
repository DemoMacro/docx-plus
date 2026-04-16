import { Formatter } from "@export/formatter";
import { describe, expect, it } from "vite-plus/test";

import { createGradientFill, createGradientStop } from "./gradient-fill";

describe("createGradientStop", () => {
    it("should create gradient stop with RGB color", () => {
        const tree = new Formatter().format(
            createGradientStop({ position: 0, color: { value: "FF0000" } }),
        );
        expect(tree).to.deep.equal({
            "a:gs": [{ _attr: { pos: 0 } }, { "a:srgbClr": { _attr: { val: "FF0000" } } }],
        });
    });

    it("should create gradient stop with scheme color and transforms", () => {
        const tree = new Formatter().format(
            createGradientStop({
                position: 50000,
                color: { value: "accent1" as const, transforms: { alpha: 80000 } },
            }),
        );
        expect(tree).to.deep.equal({
            "a:gs": [
                { _attr: { pos: 50000 } },
                {
                    "a:schemeClr": [
                        { _attr: { val: "accent1" } },
                        { "a:alpha": { _attr: { val: 80000 } } },
                    ],
                },
            ],
        });
    });
});

describe("createGradientFill", () => {
    it("should create linear gradient fill", () => {
        const tree = new Formatter().format(
            createGradientFill({
                stops: [
                    { position: 0, color: { value: "FF0000" } },
                    { position: 100000, color: { value: "0000FF" } },
                ],
                shade: { angle: 5400000 },
            }),
        );
        expect(tree).to.deep.equal({
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
        });
    });

    it("should create path gradient fill with circle", () => {
        const tree = new Formatter().format(
            createGradientFill({
                stops: [
                    { position: 0, color: { value: "FFFFFF" } },
                    { position: 100000, color: { value: "000000" } },
                ],
                shade: { path: "CIRCLE" },
            }),
        );
        expect(tree).to.deep.equal({
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
                { "a:path": { _attr: { path: "circle" } } },
            ],
        });
    });

    it("should create gradient with rotateWithShape", () => {
        const tree = new Formatter().format(
            createGradientFill({
                stops: [
                    { position: 0, color: { value: "FF0000" } },
                    { position: 100000, color: { value: "0000FF" } },
                ],
                rotateWithShape: true,
            }),
        );
        expect(tree).to.deep.equal({
            "a:gradFill": [
                { _attr: { rotWithShape: true } },
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
            ],
        });
    });

    it("should create path gradient with shape path type", () => {
        const tree = new Formatter().format(
            createGradientFill({
                stops: [
                    { position: 0, color: { value: "FF0000" } },
                    { position: 100000, color: { value: "0000FF" } },
                ],
                shade: { path: "SHAPE" },
            }),
        );
        expect(tree).to.deep.equal({
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
                { "a:path": { _attr: { path: "shape" } } },
            ],
        });
    });

    it("should create path gradient without path type", () => {
        const tree = new Formatter().format(
            createGradientFill({
                stops: [
                    { position: 0, color: { value: "FF0000" } },
                    { position: 100000, color: { value: "0000FF" } },
                ],
                shade: {} as import("./gradient-fill").PathShadeOptions,
            }),
        );
        expect(tree).to.deep.equal({
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
                { "a:path": { _attr: {} } },
            ],
        });
    });
});
