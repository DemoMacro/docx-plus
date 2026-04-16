import { Formatter } from "@export/formatter";
import { BuilderElement } from "@file/xml-components";
import { describe, expect, it } from "vite-plus/test";

import { createColorTransforms } from "./color-transform";

const formatTransforms = (options: Parameters<typeof createColorTransforms>[0]) => {
    const transforms = createColorTransforms(options);
    return new Formatter().format(new BuilderElement({ children: transforms, name: "root" }));
};

describe("createColorTransforms", () => {
    it("should create tint transform", () => {
        const tree = formatTransforms({ tint: 40000 });
        expect(tree).to.deep.equal({ root: [{ "a:tint": { _attr: { val: 40000 } } }] });
    });

    it("should create shade transform", () => {
        const tree = formatTransforms({ shade: 30000 });
        expect(tree).to.deep.equal({ root: [{ "a:shade": { _attr: { val: 30000 } } }] });
    });

    it("should create alpha transform", () => {
        const tree = formatTransforms({ alpha: 50000 });
        expect(tree).to.deep.equal({ root: [{ "a:alpha": { _attr: { val: 50000 } } }] });
    });

    it("should create alphaOff transform", () => {
        const tree = formatTransforms({ alphaOff: -10000 });
        expect(tree).to.deep.equal({ root: [{ "a:alphaOff": { _attr: { val: -10000 } } }] });
    });

    it("should create alphaMod transform", () => {
        const tree = formatTransforms({ alphaMod: 75000 });
        expect(tree).to.deep.equal({ root: [{ "a:alphaMod": { _attr: { val: 75000 } } }] });
    });

    it("should create hue transform", () => {
        const tree = formatTransforms({ hue: 1800000 });
        expect(tree).to.deep.equal({ root: [{ "a:hue": { _attr: { val: 1800000 } } }] });
    });

    it("should create hueOff transform", () => {
        const tree = formatTransforms({ hueOff: 600000 });
        expect(tree).to.deep.equal({ root: [{ "a:hueOff": { _attr: { val: 600000 } } }] });
    });

    it("should create hueMod transform", () => {
        const tree = formatTransforms({ hueMod: 50000 });
        expect(tree).to.deep.equal({ root: [{ "a:hueMod": { _attr: { val: 50000 } } }] });
    });

    it("should create sat transform", () => {
        const tree = formatTransforms({ sat: 80000 });
        expect(tree).to.deep.equal({ root: [{ "a:sat": { _attr: { val: 80000 } } }] });
    });

    it("should create satOff transform", () => {
        const tree = formatTransforms({ satOff: -20000 });
        expect(tree).to.deep.equal({ root: [{ "a:satOff": { _attr: { val: -20000 } } }] });
    });

    it("should create satMod transform", () => {
        const tree = formatTransforms({ satMod: 60000 });
        expect(tree).to.deep.equal({ root: [{ "a:satMod": { _attr: { val: 60000 } } }] });
    });

    it("should create lum transform", () => {
        const tree = formatTransforms({ lum: 40000 });
        expect(tree).to.deep.equal({ root: [{ "a:lum": { _attr: { val: 40000 } } }] });
    });

    it("should create lumOff transform", () => {
        const tree = formatTransforms({ lumOff: -10000 });
        expect(tree).to.deep.equal({ root: [{ "a:lumOff": { _attr: { val: -10000 } } }] });
    });

    it("should create lumMod transform", () => {
        const tree = formatTransforms({ lumMod: 70000 });
        expect(tree).to.deep.equal({ root: [{ "a:lumMod": { _attr: { val: 70000 } } }] });
    });

    it("should create red transform", () => {
        const tree = formatTransforms({ red: 50000 });
        expect(tree).to.deep.equal({ root: [{ "a:red": { _attr: { val: 50000 } } }] });
    });

    it("should create redOff transform", () => {
        const tree = formatTransforms({ redOff: -10000 });
        expect(tree).to.deep.equal({ root: [{ "a:redOff": { _attr: { val: -10000 } } }] });
    });

    it("should create redMod transform", () => {
        const tree = formatTransforms({ redMod: 60000 });
        expect(tree).to.deep.equal({ root: [{ "a:redMod": { _attr: { val: 60000 } } }] });
    });

    it("should create green transform", () => {
        const tree = formatTransforms({ green: 50000 });
        expect(tree).to.deep.equal({ root: [{ "a:green": { _attr: { val: 50000 } } }] });
    });

    it("should create greenOff transform", () => {
        const tree = formatTransforms({ greenOff: -10000 });
        expect(tree).to.deep.equal({ root: [{ "a:greenOff": { _attr: { val: -10000 } } }] });
    });

    it("should create greenMod transform", () => {
        const tree = formatTransforms({ greenMod: 60000 });
        expect(tree).to.deep.equal({ root: [{ "a:greenMod": { _attr: { val: 60000 } } }] });
    });

    it("should create blue transform", () => {
        const tree = formatTransforms({ blue: 50000 });
        expect(tree).to.deep.equal({ root: [{ "a:blue": { _attr: { val: 50000 } } }] });
    });

    it("should create blueOff transform", () => {
        const tree = formatTransforms({ blueOff: -10000 });
        expect(tree).to.deep.equal({ root: [{ "a:blueOff": { _attr: { val: -10000 } } }] });
    });

    it("should create blueMod transform", () => {
        const tree = formatTransforms({ blueMod: 60000 });
        expect(tree).to.deep.equal({ root: [{ "a:blueMod": { _attr: { val: 60000 } } }] });
    });

    it("should create comp transform (no value)", () => {
        const tree = formatTransforms({ comp: true });
        expect(tree).to.deep.equal({ root: [{ "a:comp": {} }] });
    });

    it("should create inv transform (no value)", () => {
        const tree = formatTransforms({ inv: true });
        expect(tree).to.deep.equal({ root: [{ "a:inv": {} }] });
    });

    it("should create gray transform (no value)", () => {
        const tree = formatTransforms({ gray: true });
        expect(tree).to.deep.equal({ root: [{ "a:gray": {} }] });
    });

    it("should create gamma transform (no value)", () => {
        const tree = formatTransforms({ gamma: true });
        expect(tree).to.deep.equal({ root: [{ "a:gamma": {} }] });
    });

    it("should create invGamma transform (no value)", () => {
        const tree = formatTransforms({ invGamma: true });
        expect(tree).to.deep.equal({ root: [{ "a:invGamma": {} }] });
    });

    it("should create empty array when no transforms specified", () => {
        const transforms = createColorTransforms({});
        expect(transforms).to.deep.equal([]);
    });

    it("should create multiple transforms", () => {
        const tree = formatTransforms({ tint: 40000, alpha: 50000 });
        expect(tree).to.deep.equal({
            root: [
                { "a:tint": { _attr: { val: 40000 } } },
                { "a:alpha": { _attr: { val: 50000 } } },
            ],
        });
    });
});
