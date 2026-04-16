/**
 * RGB color element for DrawingML shapes.
 *
 * This module provides RGB color support for solid fills.
 *
 * Reference: ISO/IEC 29500-4, dml-main.xsd, CT_SRgbColor
 *
 * @module
 */
import { BuilderElement } from "@file/xml-components";
import type { XmlComponent } from "@file/xml-components";

import type { ColorTransformOptions } from "./color-transform";
import { createColorTransforms } from "./color-transform";

/**
 * Options for RGB color.
 */
export interface RgbColorOptions {
    /** Hex color value (e.g., "FF0000" for red) */
    readonly value: string;
    /** Optional color transforms */
    readonly transforms?: ColorTransformOptions;
}

/**
 * Creates an sRGB color element.
 *
 * Specifies a color using RGB hex values.
 *
 * ## XSD Schema
 * ```xml
 * <xsd:complexType name="CT_SRgbColor">
 *   <xsd:sequence>
 *     <xsd:group ref="EG_ColorTransform" minOccurs="0" maxOccurs="unbounded"/>
 *   </xsd:sequence>
 *   <xsd:attribute name="val" type="s:ST_HexColorRGB" use="required"/>
 * </xsd:complexType>
 * ```
 *
 * @example
 * ```typescript
 * const redColor = createRgbColor({ value: "FF0000" });
 * // With alpha transform
 * const semiRed = createRgbColor({ value: "FF0000", transforms: { alpha: 50000 } });
 * ```
 */
export const createRgbColor = (options: RgbColorOptions): XmlComponent => {
    const transforms = options.transforms ? createColorTransforms(options.transforms) : [];
    return new BuilderElement<RgbColorOptions>({
        attributes: {
            value: {
                key: "val",
                value: options.value,
            },
        },
        children: [...transforms],
        name: "a:srgbClr",
    });
};
