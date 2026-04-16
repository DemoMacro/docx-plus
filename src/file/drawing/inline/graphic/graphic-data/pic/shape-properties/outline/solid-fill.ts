/**
 * Solid fill element for DrawingML shapes.
 *
 * This module provides solid fill support for outlines and shapes,
 * supporting RGB, scheme, HSL, system, and preset colors.
 *
 * Reference: ISO/IEC 29500-4, dml-main.xsd, CT_SolidColorFillProperties
 *
 * @module
 */
import { BuilderElement } from "@file/xml-components";
import type { XmlComponent } from "@file/xml-components";

import { createHslColor } from "./hsl-color";
import type { HslColorOptions } from "./hsl-color";
import { createPresetColor, PresetColor } from "./preset-color";
import type { PresetColorOptions } from "./preset-color";
import { createRgbColor } from "./rgb-color";
import type { RgbColorOptions } from "./rgb-color";
import { createSchemeColor, SchemeColor } from "./scheme-color";
import type { SchemeColorOptions } from "./scheme-color";
import { createSystemColor, SystemColor } from "./system-color";
import type { SystemColorOptions } from "./system-color";

/**
 * Union type for all color options supported by solid fill.
 *
 * Extends the original pattern with additional color types:
 * RGB, scheme, HSL, system, and preset colors.
 */
export type SolidFillOptions =
    | RgbColorOptions
    | SchemeColorOptions
    | HslColorOptions
    | SystemColorOptions
    | PresetColorOptions;

/**
 * Creates the color child element for a solid fill based on the color type.
 */
const SYSTEM_COLOR_VALUES: ReadonlySet<string> = new Set(Object.values(SystemColor));
const PRESET_COLOR_VALUES: ReadonlySet<string> = new Set(Object.values(PresetColor));
const SCHEME_COLOR_VALUES: ReadonlySet<string> = new Set(Object.values(SchemeColor));

export const createColorElement = (color: SolidFillOptions): XmlComponent => {
    if ("hue" in color && "sat" in color && "lum" in color) {
        return createHslColor(color);
    }
    // At this point, color is guaranteed to have a string value property
    const colorValue = (color as { readonly value: string }).value;
    if (SYSTEM_COLOR_VALUES.has(colorValue)) {
        return createSystemColor(color as SystemColorOptions);
    }
    if (PRESET_COLOR_VALUES.has(colorValue)) {
        return createPresetColor(color as PresetColorOptions);
    }
    if (SCHEME_COLOR_VALUES.has(colorValue)) {
        return createSchemeColor(color as SchemeColorOptions);
    }
    return createRgbColor(color as RgbColorOptions);
};

/**
 * Creates a solid fill element.
 *
 * Specifies a solid color fill using any supported color type.
 *
 * ## XSD Schema
 * ```xml
 * <xsd:complexType name="CT_SolidColorFillProperties">
 *   <xsd:sequence>
 *     <xsd:group ref="EG_ColorChoice" minOccurs="0"/>
 *     <xsd:group ref="EG_EffectProperties" minOccurs="0"/>
 *   </xsd:sequence>
 * </xsd:complexType>
 * ```
 *
 * @example
 * ```typescript
 * // RGB solid fill
 * const fill = createSolidFill({ value: "FF0000" });
 * // Scheme solid fill with tint
 * const schemeFill = createSolidFill({
 *   value: SchemeColor.ACCENT1, transforms: { tint: 40000 },
 * });
 * // HSL solid fill
 * const hslFill = createSolidFill({ hue: 120000, sat: 100000, lum: 50000 });
 * ```
 */
export const createSolidFill = (options: SolidFillOptions): XmlComponent =>
    new BuilderElement({
        children: [createColorElement(options)],
        name: "a:solidFill",
    });
