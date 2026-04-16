/**
 * Color transform elements for DrawingML colors.
 *
 * This module provides color transformation elements defined in EG_ColorTransform,
 * which can be applied as child elements to any color type (srgbClr, schemeClr, etc.).
 *
 * Reference: ISO/IEC 29500-4, dml-main.xsd, EG_ColorTransform
 *
 * @module
 */
import { BuilderElement } from "@file/xml-components";
import type { XmlComponent } from "@file/xml-components";

/**
 * Options for color transforms.
 *
 * All percentage values are in 1/1000th of a percent (e.g., 50000 = 50%).
 * Angle values are in 60,000ths of a degree.
 *
 * Reference: ISO/IEC 29500-4, dml-main.xsd, EG_ColorTransform
 */
export interface ColorTransformOptions {
    /** Tint: moves color toward white (0-100000) */
    readonly tint?: number;
    /** Shade: moves color toward black (0-100000) */
    readonly shade?: number;
    /** Complement: inverts the color (no value) */
    readonly comp?: boolean;
    /** Inverse: inverts the color (no value) */
    readonly inv?: boolean;
    /** Grayscale: converts to grayscale (no value) */
    readonly gray?: boolean;
    /** Alpha: sets transparency (0-100000) */
    readonly alpha?: number;
    /** Alpha offset: adjusts alpha by fixed amount (-100000 to 100000) */
    readonly alphaOff?: number;
    /** Alpha modulation: scales alpha by percentage (0-100000) */
    readonly alphaMod?: number;
    /** Hue: sets hue angle (0-21600000) */
    readonly hue?: number;
    /** Hue offset: adjusts hue by angle (-5400000 to 5400000) */
    readonly hueOff?: number;
    /** Hue modulation: scales hue by percentage (0-100000) */
    readonly hueMod?: number;
    /** Saturation: sets saturation (-100000 to 100000) */
    readonly sat?: number;
    /** Saturation offset: adjusts saturation (-100000 to 100000) */
    readonly satOff?: number;
    /** Saturation modulation: scales saturation (0-100000) */
    readonly satMod?: number;
    /** Luminance: sets luminance (-100000 to 100000) */
    readonly lum?: number;
    /** Luminance offset: adjusts luminance (-100000 to 100000) */
    readonly lumOff?: number;
    /** Luminance modulation: scales luminance (0-100000) */
    readonly lumMod?: number;
    /** Red: sets red channel (-100000 to 100000) */
    readonly red?: number;
    /** Red offset: adjusts red channel (-100000 to 100000) */
    readonly redOff?: number;
    /** Red modulation: scales red channel (0-100000) */
    readonly redMod?: number;
    /** Green: sets green channel (-100000 to 100000) */
    readonly green?: number;
    /** Green offset: adjusts green channel (-100000 to 100000) */
    readonly greenOff?: number;
    /** Green modulation: scales green channel (0-100000) */
    readonly greenMod?: number;
    /** Blue: sets blue channel (-100000 to 100000) */
    readonly blue?: number;
    /** Blue offset: adjusts blue channel (-100000 to 100000) */
    readonly blueOff?: number;
    /** Blue modulation: scales blue channel (0-100000) */
    readonly blueMod?: number;
    /** Gamma correction (no value) */
    readonly gamma?: boolean;
    /** Inverse gamma correction (no value) */
    readonly invGamma?: boolean;
}

/**
 * Creates color transform child elements.
 *
 * These elements modify the parent color according to OOXML color transform rules.
 * Multiple transforms can be applied in sequence.
 *
 * @example
 * ```typescript
 * // Lighten accent1 by 40%
 * createColorTransforms({ tint: 40000 });
 * // Semi-transparent red with 50% alpha
 * createColorTransforms({ alpha: 50000 });
 * ```
 */
export const createColorTransforms = (options: ColorTransformOptions): readonly XmlComponent[] => {
    const transforms: XmlComponent[] = [];

    if (options.tint !== undefined) {
        transforms.push(
            new BuilderElement<{ readonly val: number }>({
                attributes: { val: { key: "val", value: options.tint } },
                name: "a:tint",
            }),
        );
    }

    if (options.shade !== undefined) {
        transforms.push(
            new BuilderElement<{ readonly val: number }>({
                attributes: { val: { key: "val", value: options.shade } },
                name: "a:shade",
            }),
        );
    }

    if (options.comp) {
        transforms.push(new BuilderElement({ name: "a:comp" }));
    }

    if (options.inv) {
        transforms.push(new BuilderElement({ name: "a:inv" }));
    }

    if (options.gray) {
        transforms.push(new BuilderElement({ name: "a:gray" }));
    }

    if (options.alpha !== undefined) {
        transforms.push(
            new BuilderElement<{ readonly val: number }>({
                attributes: { val: { key: "val", value: options.alpha } },
                name: "a:alpha",
            }),
        );
    }

    if (options.alphaOff !== undefined) {
        transforms.push(
            new BuilderElement<{ readonly val: number }>({
                attributes: { val: { key: "val", value: options.alphaOff } },
                name: "a:alphaOff",
            }),
        );
    }

    if (options.alphaMod !== undefined) {
        transforms.push(
            new BuilderElement<{ readonly val: number }>({
                attributes: { val: { key: "val", value: options.alphaMod } },
                name: "a:alphaMod",
            }),
        );
    }

    if (options.hue !== undefined) {
        transforms.push(
            new BuilderElement<{ readonly val: number }>({
                attributes: { val: { key: "val", value: options.hue } },
                name: "a:hue",
            }),
        );
    }

    if (options.hueOff !== undefined) {
        transforms.push(
            new BuilderElement<{ readonly val: number }>({
                attributes: { val: { key: "val", value: options.hueOff } },
                name: "a:hueOff",
            }),
        );
    }

    if (options.hueMod !== undefined) {
        transforms.push(
            new BuilderElement<{ readonly val: number }>({
                attributes: { val: { key: "val", value: options.hueMod } },
                name: "a:hueMod",
            }),
        );
    }

    if (options.sat !== undefined) {
        transforms.push(
            new BuilderElement<{ readonly val: number }>({
                attributes: { val: { key: "val", value: options.sat } },
                name: "a:sat",
            }),
        );
    }

    if (options.satOff !== undefined) {
        transforms.push(
            new BuilderElement<{ readonly val: number }>({
                attributes: { val: { key: "val", value: options.satOff } },
                name: "a:satOff",
            }),
        );
    }

    if (options.satMod !== undefined) {
        transforms.push(
            new BuilderElement<{ readonly val: number }>({
                attributes: { val: { key: "val", value: options.satMod } },
                name: "a:satMod",
            }),
        );
    }

    if (options.lum !== undefined) {
        transforms.push(
            new BuilderElement<{ readonly val: number }>({
                attributes: { val: { key: "val", value: options.lum } },
                name: "a:lum",
            }),
        );
    }

    if (options.lumOff !== undefined) {
        transforms.push(
            new BuilderElement<{ readonly val: number }>({
                attributes: { val: { key: "val", value: options.lumOff } },
                name: "a:lumOff",
            }),
        );
    }

    if (options.lumMod !== undefined) {
        transforms.push(
            new BuilderElement<{ readonly val: number }>({
                attributes: { val: { key: "val", value: options.lumMod } },
                name: "a:lumMod",
            }),
        );
    }

    if (options.red !== undefined) {
        transforms.push(
            new BuilderElement<{ readonly val: number }>({
                attributes: { val: { key: "val", value: options.red } },
                name: "a:red",
            }),
        );
    }

    if (options.redOff !== undefined) {
        transforms.push(
            new BuilderElement<{ readonly val: number }>({
                attributes: { val: { key: "val", value: options.redOff } },
                name: "a:redOff",
            }),
        );
    }

    if (options.redMod !== undefined) {
        transforms.push(
            new BuilderElement<{ readonly val: number }>({
                attributes: { val: { key: "val", value: options.redMod } },
                name: "a:redMod",
            }),
        );
    }

    if (options.green !== undefined) {
        transforms.push(
            new BuilderElement<{ readonly val: number }>({
                attributes: { val: { key: "val", value: options.green } },
                name: "a:green",
            }),
        );
    }

    if (options.greenOff !== undefined) {
        transforms.push(
            new BuilderElement<{ readonly val: number }>({
                attributes: { val: { key: "val", value: options.greenOff } },
                name: "a:greenOff",
            }),
        );
    }

    if (options.greenMod !== undefined) {
        transforms.push(
            new BuilderElement<{ readonly val: number }>({
                attributes: { val: { key: "val", value: options.greenMod } },
                name: "a:greenMod",
            }),
        );
    }

    if (options.blue !== undefined) {
        transforms.push(
            new BuilderElement<{ readonly val: number }>({
                attributes: { val: { key: "val", value: options.blue } },
                name: "a:blue",
            }),
        );
    }

    if (options.blueOff !== undefined) {
        transforms.push(
            new BuilderElement<{ readonly val: number }>({
                attributes: { val: { key: "val", value: options.blueOff } },
                name: "a:blueOff",
            }),
        );
    }

    if (options.blueMod !== undefined) {
        transforms.push(
            new BuilderElement<{ readonly val: number }>({
                attributes: { val: { key: "val", value: options.blueMod } },
                name: "a:blueMod",
            }),
        );
    }

    if (options.gamma) {
        transforms.push(new BuilderElement({ name: "a:gamma" }));
    }

    if (options.invGamma) {
        transforms.push(new BuilderElement({ name: "a:invGamma" }));
    }

    return transforms;
};
