/**
 * Gradient fill element for DrawingML shapes.
 *
 * This module provides gradient fill support with linear and path shading.
 *
 * Reference: ISO/IEC 29500-4, dml-main.xsd, CT_GradientFillProperties
 *
 * @module
 */
import { BuilderElement } from "@file/xml-components";
import type { XmlComponent } from "@file/xml-components";

import type { SolidFillOptions } from "../outline/solid-fill";
import { createColorElement } from "../outline/solid-fill";

/**
 * Gradient stop position (0-100000, representing 0%-100%).
 */
export interface IGradientStop {
    /** Position of the color stop (0-100000) */
    readonly position: number;
    /** Color at this stop */
    readonly color: SolidFillOptions;
}

/**
 * Path shade type for radial gradients.
 */
export const PathShadeType = {
    /** Follow shape path */
    SHAPE: "shape",
    /** Circular gradient */
    CIRCLE: "circle",
    /** Rectangular gradient */
    RECT: "rect",
} as const;

/**
 * Options for linear gradient shading.
 */
export interface LinearShadeOptions {
    /** Angle in 60,000ths of a degree (e.g., 5400000 = 90°) */
    readonly angle?: number;
    /** Whether the angle scales with the shape */
    readonly scaled?: boolean;
}

/**
 * Options for path (radial) gradient shading.
 */
export interface PathShadeOptions {
    /** Path type */
    readonly path?: keyof typeof PathShadeType;
}

/**
 * Gradient shade options (linear or path).
 */
export type GradientShadeOptions = LinearShadeOptions | PathShadeOptions;

/**
 * Options for gradient fill.
 *
 * ## XSD Schema
 * ```xml
 * <xsd:complexType name="CT_GradientFillProperties">
 *   <xsd:sequence>
 *     <xsd:element name="gsLst" type="CT_GradientStopList" minOccurs="0"/>
 *     <xsd:group ref="EG_ShadeProperties" minOccurs="0"/>
 *     <xsd:element name="tileRect" type="CT_RelativeRect" minOccurs="0"/>
 *   </xsd:sequence>
 *   <xsd:attribute name="flip" type="ST_TileFlipMode" use="optional"/>
 *   <xsd:attribute name="rotWithShape" type="xsd:boolean" use="optional"/>
 * </xsd:complexType>
 * ```
 */
export interface GradientFillOptions {
    /** Gradient color stops (minimum 2) */
    readonly stops: readonly IGradientStop[];
    /** Shade type (linear or path) */
    readonly shade?: GradientShadeOptions;
    /** Whether gradient rotates with the shape */
    readonly rotateWithShape?: boolean;
}

/**
 * Creates a gradient stop element (a:gs).
 *
 * @example
 * ```typescript
 * createGradientStop({ position: 0, color: { value: "FF0000" } });
 * createGradientStop({ position: 100000, color: { value: "0000FF" } });
 * ```
 */
export const createGradientStop = (stop: IGradientStop): XmlComponent =>
    new BuilderElement<{ readonly pos: number }>({
        attributes: {
            pos: { key: "pos", value: stop.position },
        },
        children: [createColorElement(stop.color)],
        name: "a:gs",
    });

/**
 * Creates the shade element (a:lin or a:path).
 */
const createShadeElement = (shade: GradientShadeOptions): XmlComponent => {
    if ("angle" in shade) {
        return new BuilderElement<{ readonly ang?: number; readonly scaled?: boolean }>({
            attributes: {
                ang: { key: "ang", value: shade.angle },
                scaled: { key: "scaled", value: shade.scaled },
            },
            name: "a:lin",
        });
    }
    const pathShade = shade as PathShadeOptions;
    return new BuilderElement<{ readonly path?: string }>({
        attributes: {
            path: {
                key: "path",
                value: pathShade.path ? PathShadeType[pathShade.path] : undefined,
            },
        },
        name: "a:path",
    });
};

/**
 * Creates a gradient fill element.
 *
 * ## XSD Schema
 * ```xml
 * <xsd:complexType name="CT_GradientFillProperties">
 *   <xsd:sequence>
 *     <xsd:element name="gsLst" type="CT_GradientStopList" minOccurs="0"/>
 *     <xsd:group ref="EG_ShadeProperties" minOccurs="0"/>
 *   </xsd:sequence>
 *   <xsd:attribute name="rotWithShape" type="xsd:boolean" use="optional"/>
 * </xsd:complexType>
 * ```
 *
 * @example
 * ```typescript
 * // Linear gradient from red to blue
 * createGradientFill({
 *   stops: [
 *     { position: 0, color: { value: "FF0000" } },
 *     { position: 100000, color: { value: "0000FF" } },
 *   ],
 *   shade: { angle: 5400000 },
 * });
 * ```
 */
export const createGradientFill = (options: GradientFillOptions): XmlComponent => {
    const children: XmlComponent[] = [];

    // Gradient stop list
    children.push(
        new BuilderElement({
            children: options.stops.map(createGradientStop),
            name: "a:gsLst",
        }),
    );

    // Shade properties
    if (options.shade) {
        children.push(createShadeElement(options.shade));
    }

    return new BuilderElement<{
        readonly rotWithShape?: boolean;
    }>({
        attributes: {
            rotWithShape: { key: "rotWithShape", value: options.rotateWithShape },
        },
        children,
        name: "a:gradFill",
    });
};
