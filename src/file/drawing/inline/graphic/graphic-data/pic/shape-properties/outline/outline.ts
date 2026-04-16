/**
 * Outline (line) properties for DrawingML shapes.
 *
 * This module provides support for configuring outline properties including
 * width, cap style, compound line types, fill properties, dash, and join.
 *
 * Reference: ISO/IEC 29500-4, dml-main.xsd, CT_LineProperties
 *
 * @module
 */
import { BuilderElement } from "@file/xml-components";
import type { XmlComponent } from "@file/xml-components";

import { createNoFill } from "./no-fill";
import { createSolidFill } from "./solid-fill";
import type { SolidFillOptions } from "./solid-fill";

// <xsd:complexType name="CT_LineProperties">
//     <xsd:sequence>
//         <xsd:group ref="EG_FillProperties" minOccurs="0"/>
//         <xsd:group ref="EG_LineDashProperties" minOccurs="0"/>
//         <xsd:group ref="EG_LineJoinProperties" minOccurs="0"/>
//     </xsd:sequence>
//     <xsd:attribute name="w" use="optional" type="a:ST_LineWidth"/>
//     <xsd:attribute name="cap" use="optional" type="ST_LineCap"/>
//     <xsd:attribute name="cmpd" use="optional" type="ST_CompoundLine"/>
//     <xsd:attribute name="algn" use="optional" type="ST_PenAlignment"/>
// </xsd:complexType>

// <xsd:simpleType name="ST_LineCap">
//     <xsd:restriction base="xsd:string">
//     <xsd:enumeration value="rnd"/>
//     <xsd:enumeration value="sq"/>
//     <xsd:enumeration value="flat"/>
//     </xsd:restriction>
// </xsd:simpleType>

/**
 * Line cap styles for outline endpoints.
 *
 * Defines how the ends of a line are rendered.
 */
export const LineCap = {
    /** Round cap style */
    ROUND: "rnd",
    /** Square cap style */
    SQUARE: "sq",
    /** Flat cap style */
    FLAT: "flat",
} as const;

// <xsd:simpleType name="ST_CompoundLine">
//     <xsd:restriction base="xsd:string">
//     <xsd:enumeration value="sng"/>
//     <xsd:enumeration value="dbl"/>
//     <xsd:enumeration value="thickThin"/>
//     <xsd:enumeration value="thinThick"/>
//     <xsd:enumeration value="tri"/>
//     </xsd:restriction>
// </xsd:simpleType>

/**
 * Compound line types for outlines.
 *
 * Defines the structure of compound lines (single, double, etc.).
 */
export const CompoundLine = {
    /** Single line */
    SINGLE: "sng",
    /** Double line */
    DOUBLE: "dbl",
    /** Thick-thin double line */
    THICK_THIN: "thickThin",
    /** Thin-thick double line */
    THIN_THICK: "thinThick",
    /** Triple line */
    TRI: "tri",
} as const;

// <xsd:simpleType name="ST_PenAlignment">
//     <xsd:restriction base="xsd:string">
//     <xsd:enumeration value="ctr"/>
//     <xsd:enumeration value="in"/>
//     </xsd:restriction>
// </xsd:simpleType>

/**
 * Pen alignment options for outline positioning.
 *
 * Defines how the outline is aligned relative to the shape edge.
 */
export const PenAlignment = {
    /** Center alignment */
    CENTER: "ctr",
    /** Inset alignment */
    INSET: "in",
} as const;

/**
 * Preset dash styles for outlines.
 *
 * ## XSD Schema
 * ```xml
 * <xsd:simpleType name="ST_PresetLineDashVal">
 *   <xsd:restriction base="xsd:token">
 *     <xsd:enumeration value="solid"/>
 *     <xsd:enumeration value="dot"/>
 *     <xsd:enumeration value="dash"/>
 *     <xsd:enumeration value="lgDash"/>
 *     <xsd:enumeration value="dashDot"/>
 *     <xsd:enumeration value="lgDashDot"/>
 *     <xsd:enumeration value="lgDashDotDot"/>
 *     <xsd:enumeration value="sysDash"/>
 *     <xsd:enumeration value="sysDot"/>
 *     <xsd:enumeration value="sysDashDot"/>
 *     <xsd:enumeration value="sysDashDotDot"/>
 *   </xsd:restriction>
 * </xsd:simpleType>
 * ```
 */
export const PresetDash = {
    SOLID: "solid",
    DOT: "dot",
    DASH: "dash",
    LG_DASH: "lgDash",
    DASH_DOT: "dashDot",
    LG_DASH_DOT: "lgDashDot",
    LG_DASH_DOT_DOT: "lgDashDotDot",
    SYS_DASH: "sysDash",
    SYS_DOT: "sysDot",
    SYS_DASH_DOT: "sysDashDot",
    SYS_DASH_DOT_DOT: "sysDashDotDot",
} as const;

/**
 * Line join styles.
 */
export const LineJoin = {
    ROUND: "round",
    BEVEL: "bevel",
    MITER: "miter",
} as const;

/**
 * Attributes for configuring outline properties.
 */
export interface OutlineAttributes {
    /** Line width in EMUs (English Metric Units) */
    readonly width?: number;
    /** Line cap style */
    readonly cap?: keyof typeof LineCap;
    /** Compound line type */
    readonly compoundLine?: keyof typeof CompoundLine;
    /** Pen alignment */
    readonly align?: keyof typeof PenAlignment;
    /** Preset dash style */
    readonly dash?: keyof typeof PresetDash;
    /** Line join style */
    readonly join?: keyof typeof LineJoin;
    /** Miter limit (only when join is MITER) */
    readonly miterLimit?: number;
}

/**
 * No fill option for outline.
 */
interface OutlineNoFill {
    /** No fill type */
    readonly type: "noFill";
}

/**
 * Solid fill for outline.
 */
interface OutlineSolidFill {
    /** Solid fill type */
    readonly type: "solidFill";
    /** Color definition */
    readonly color: SolidFillOptions;
}

/**
 * Fill properties for outline.
 */
type OutlineFillProperties = OutlineNoFill | OutlineSolidFill;

/**
 * Complete outline configuration options.
 *
 * Combines outline attributes with fill properties.
 */
export type OutlineOptions = OutlineAttributes & OutlineFillProperties;

/**
 * Creates the fill child element for an outline.
 */
const createOutlineFill = (options: OutlineFillProperties): XmlComponent => {
    if (options.type === "noFill") {
        return createNoFill();
    }
    return createSolidFill(options.color);
};

/**
 * Creates an outline element for DrawingML shapes.
 *
 * The outline element specifies the line properties for the shape border,
 * including width, cap style, compound line type, alignment, dash, join, and fill.
 *
 * ## XSD Schema
 * ```xml
 * <xsd:complexType name="CT_LineProperties">
 *   <xsd:sequence>
 *     <xsd:group ref="EG_FillProperties" minOccurs="0"/>
 *     <xsd:group ref="EG_LineDashProperties" minOccurs="0"/>
 *     <xsd:group ref="EG_LineJoinProperties" minOccurs="0"/>
 *   </xsd:sequence>
 *   <xsd:attribute name="w" use="optional" type="a:ST_LineWidth"/>
 *   <xsd:attribute name="cap" use="optional" type="ST_LineCap"/>
 *   <xsd:attribute name="cmpd" use="optional" type="ST_CompoundLine"/>
 *   <xsd:attribute name="algn" use="optional" type="ST_PenAlignment"/>
 * </xsd:complexType>
 * ```
 *
 * @example
 * ```typescript
 * // Outline with RGB color and dash
 * const outline = createOutline({
 *   width: 9525,
 *   type: "solidFill",
 *   color: { value: "FF0000" },
 *   dash: "DASH",
 * });
 * ```
 */
export const createOutline = (options: OutlineOptions): XmlComponent => {
    const children: XmlComponent[] = [];

    // Fill
    children.push(createOutlineFill(options));

    // Dash
    if (options.dash !== undefined) {
        children.push(
            new BuilderElement<{ readonly val: string }>({
                attributes: {
                    val: { key: "val", value: PresetDash[options.dash] },
                },
                name: "a:prstDash",
            }),
        );
    }

    // Join
    if (options.join !== undefined) {
        if (options.join === "MITER" && options.miterLimit !== undefined) {
            children.push(
                new BuilderElement<{ readonly lim: number }>({
                    attributes: {
                        lim: { key: "lim", value: options.miterLimit },
                    },
                    name: "a:miter",
                }),
            );
        } else {
            children.push(
                new BuilderElement({
                    name: `a:${LineJoin[options.join]}`,
                }),
            );
        }
    }

    return new BuilderElement<OutlineAttributes>({
        attributes: {
            align: {
                key: "algn",
                value: options.align
                    ? (PenAlignment[options.align] as typeof options.align)
                    : undefined,
            },
            cap: {
                key: "cap",
                value: options.cap ? (LineCap[options.cap] as typeof options.cap) : undefined,
            },
            compoundLine: {
                key: "cmpd",
                value: options.compoundLine
                    ? (CompoundLine[options.compoundLine] as typeof options.compoundLine)
                    : undefined,
            },
            width: {
                key: "w",
                value: options.width,
            },
        },
        children,
        name: "a:ln",
    });
};
