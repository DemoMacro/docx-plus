/**
 * Source rectangle module for blip fills.
 *
 * This module defines the portion of an image to use when filling a shape.
 *
 * Reference: ISO/IEC 29500-4, dml-main.xsd, CT_RelativeRect
 *
 * @module
 */
import { BuilderElement } from "@file/xml-components";

/**
 * Options for source rectangle cropping.
 *
 * Each value is a percentage (0-100000) of the image dimension to crop.
 * The values represent the inset from each edge.
 */
export interface SourceRectangleOptions {
    /** Left inset percentage (0-100000) */
    readonly left?: number;
    /** Top inset percentage (0-100000) */
    readonly top?: number;
    /** Right inset percentage (0-100000) */
    readonly right?: number;
    /** Bottom inset percentage (0-100000) */
    readonly bottom?: number;
}

/**
 * Creates a source rectangle element for blip fill cropping.
 *
 * This element specifies a portion of the blip (image) to use as the fill.
 * When no options are provided, the entire blip is used.
 *
 * Reference: ISO/IEC 29500-4, dml-main.xsd, CT_RelativeRect
 *
 * ## XSD Schema
 * ```xml
 * <xsd:complexType name="CT_RelativeRect">
 *   <xsd:attribute name="l" type="ST_Percentage" use="optional" default="0"/>
 *   <xsd:attribute name="t" type="ST_Percentage" use="optional" default="0"/>
 *   <xsd:attribute name="r" type="ST_Percentage" use="optional" default="0"/>
 *   <xsd:attribute name="b" type="ST_Percentage" use="optional" default="0"/>
 * </xsd:complexType>
 * ```
 *
 * @example
 * ```typescript
 * // Crop 10% from left and right
 * createSourceRectangle({ left: 10000, right: 10000 });
 * ```
 */
export const createSourceRectangle = (options?: SourceRectangleOptions) => {
    if (!options) {
        return new BuilderElement({ name: "a:srcRect" });
    }

    const attributes: Record<string, { readonly key: string; readonly value: number }> = {};

    if (options.left !== undefined) {
        attributes.l = { key: "l", value: options.left };
    }
    if (options.top !== undefined) {
        attributes.t = { key: "t", value: options.top };
    }
    if (options.right !== undefined) {
        attributes.r = { key: "r", value: options.right };
    }
    if (options.bottom !== undefined) {
        attributes.b = { key: "b", value: options.bottom };
    }

    return new BuilderElement({
        attributes: attributes as never,
        name: "a:srcRect",
    });
};
