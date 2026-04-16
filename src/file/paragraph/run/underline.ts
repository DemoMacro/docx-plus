/**
 * Underline module for WordprocessingML documents.
 *
 * This module provides support for underlining text with various styles and colors.
 *
 * Reference: http://officeopenxml.com/WPrun.php
 *
 * @module
 */
import { BuilderElement } from "@file/xml-components";
import type { XmlComponent } from "@file/xml-components";
import { hexColorValue, uCharHexNumber } from "@util/values";
import type { ThemeColor } from "@util/values";

/**
 * Underline style types for text.
 *
 * Defines the various underline patterns that can be applied to text runs.
 *
 * Reference: http://officeopenxml.com/WPrun.php
 *
 * ## XSD Schema
 * ```xml
 * <xsd:simpleType name="ST_Underline">
 *   <xsd:restriction base="xsd:string">
 *     <xsd:enumeration value="single"/>
 *     <xsd:enumeration value="words"/>
 *     <xsd:enumeration value="double"/>
 *     <xsd:enumeration value="thick"/>
 *     <xsd:enumeration value="dotted"/>
 *     <xsd:enumeration value="dottedHeavy"/>
 *     <xsd:enumeration value="dash"/>
 *     <xsd:enumeration value="dashedHeavy"/>
 *     <xsd:enumeration value="dashLong"/>
 *     <xsd:enumeration value="dashLongHeavy"/>
 *     <xsd:enumeration value="dotDash"/>
 *     <xsd:enumeration value="dashDotHeavy"/>
 *     <xsd:enumeration value="dotDotDash"/>
 *     <xsd:enumeration value="dashDotDotHeavy"/>
 *     <xsd:enumeration value="wave"/>
 *     <xsd:enumeration value="wavyHeavy"/>
 *     <xsd:enumeration value="wavyDouble"/>
 *     <xsd:enumeration value="none"/>
 *   </xsd:restriction>
 * </xsd:simpleType>
 * ```
 *
 * @publicApi
 */
export const UnderlineType = {
    /** Single underline */
    SINGLE: "single",
    /** Underline words only (not spaces) */
    WORDS: "words",
    /** Double underline */
    DOUBLE: "double",
    /** Thick single underline */
    THICK: "thick",
    /** Dotted underline */
    DOTTED: "dotted",
    /** Heavy dotted underline */
    DOTTEDHEAVY: "dottedHeavy",
    /** Dashed underline */
    DASH: "dash",
    /** Heavy dashed underline */
    DASHEDHEAVY: "dashedHeavy",
    /** Long dashed underline */
    DASHLONG: "dashLong",
    /** Heavy long dashed underline */
    DASHLONGHEAVY: "dashLongHeavy",
    /** Dot-dash underline */
    DOTDASH: "dotDash",
    /** Heavy dot-dash underline */
    DASHDOTHEAVY: "dashDotHeavy",
    /** Dot-dot-dash underline */
    DOTDOTDASH: "dotDotDash",
    /** Heavy dot-dot-dash underline */
    DASHDOTDOTHEAVY: "dashDotDotHeavy",
    /** Wave underline */
    WAVE: "wave",
    /** Heavy wave underline */
    WAVYHEAVY: "wavyHeavy",
    /** Double wave underline */
    WAVYDOUBLE: "wavyDouble",
    /** No underline */
    NONE: "none",
} as const;

interface IUnderlineAttributes {
    readonly val: (typeof UnderlineType)[keyof typeof UnderlineType];
    readonly color?: string;
    readonly themeColor?: (typeof ThemeColor)[keyof typeof ThemeColor];
    readonly themeTint?: string;
    readonly themeShade?: string;
}

/**
 * Creates underline formatting for a run in a WordprocessingML document.
 *
 * The u element specifies the style and optional color of underline
 * formatting applied to text.
 *
 * Reference: http://officeopenxml.com/WPrun.php
 *
 * ## XSD Schema
 * ```xml
 * <xsd:complexType name="CT_Underline">
 *   <xsd:attribute name="val" type="ST_Underline" use="required"/>
 *   <xsd:attribute name="color" type="ST_HexColor"/>
 *   <xsd:attribute name="themeColor" type="ST_ThemeColor"/>
 *   <xsd:attribute name="themeTint" type="ST_UcharHexNumber"/>
 *   <xsd:attribute name="themeShade" type="ST_UcharHexNumber"/>
 * </xsd:complexType>
 * ```
 *
 * @example
 * ```typescript
 * // Simple single underline
 * createUnderline();
 *
 * // Double underline
 * createUnderline(UnderlineType.DOUBLE);
 *
 * // Red wavy underline
 * createUnderline(UnderlineType.WAVE, "FF0000");
 * ```
 */
export const createUnderline = (
    underlineType: (typeof UnderlineType)[keyof typeof UnderlineType] = UnderlineType.SINGLE,
    color?: string,
    themeColor?: (typeof ThemeColor)[keyof typeof ThemeColor],
    themeTint?: string,
    themeShade?: string,
): XmlComponent =>
    new BuilderElement<IUnderlineAttributes>({
        attributes: {
            color: {
                key: "w:color",
                value: color === undefined ? undefined : hexColorValue(color),
            },
            themeColor: { key: "w:themeColor", value: themeColor },
            themeShade: {
                key: "w:themeShade",
                value: themeShade === undefined ? undefined : uCharHexNumber(themeShade),
            },
            themeTint: {
                key: "w:themeTint",
                value: themeTint === undefined ? undefined : uCharHexNumber(themeTint),
            },
            val: { key: "w:val", value: underlineType },
        },
        name: "w:u",
    });
