/**
 * HSL color element for DrawingML.
 *
 * This module provides HSL (Hue, Saturation, Luminance) color support.
 *
 * Reference: ISO/IEC 29500-4, dml-main.xsd, CT_HslColor
 *
 * @module
 */
import { BuilderElement } from "@file/xml-components";
import type { XmlComponent } from "@file/xml-components";

import type { ColorTransformOptions } from "./color-transform";
import { createColorTransforms } from "./color-transform";

/**
 * Options for HSL color.
 */
export interface HslColorOptions {
    /** Hue angle in 60,000ths of a degree (0-21600000) */
    readonly hue: number;
    /** Saturation in 1/1000th of a percent (0-100000) */
    readonly sat: number;
    /** Luminance in 1/1000th of a percent (0-100000) */
    readonly lum: number;
    /** Optional color transforms */
    readonly transforms?: ColorTransformOptions;
}

/**
 * Creates an HSL color element.
 *
 * Specifies a color using Hue, Saturation, and Luminance values.
 *
 * ## XSD Schema
 * ```xml
 * <xsd:complexType name="CT_HslColor">
 *   <xsd:sequence>
 *     <xsd:group ref="EG_ColorTransform" minOccurs="0" maxOccurs="unbounded"/>
 *   </xsd:sequence>
 *   <xsd:attribute name="hue" type="ST_PositiveFixedAngle" use="required"/>
 *   <xsd:attribute name="sat" type="ST_Percentage" use="required"/>
 *   <xsd:attribute name="lum" type="ST_Percentage" use="required"/>
 * </xsd:complexType>
 * ```
 */
export const createHslColor = (options: HslColorOptions): XmlComponent => {
    const transforms = options.transforms ? createColorTransforms(options.transforms) : [];
    return new BuilderElement({
        attributes: {
            hue: { key: "hue", value: options.hue },
            lum: { key: "lum", value: options.lum },
            sat: { key: "sat", value: options.sat },
        },
        children: [...transforms],
        name: "a:hslClr",
    });
};
