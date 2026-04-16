/**
 * Preset color element for DrawingML.
 *
 * This module provides named preset colors (CSS named colors).
 *
 * Reference: ISO/IEC 29500-4, dml-main.xsd, CT_PresetColor / ST_PresetColorVal
 *
 * @module
 */
import { BuilderElement } from "@file/xml-components";
import type { XmlComponent } from "@file/xml-components";

import type { ColorTransformOptions } from "./color-transform";
import { createColorTransforms } from "./color-transform";

/**
 * Preset color values (CSS named colors).
 *
 * ## XSD Schema
 * ```xml
 * <xsd:simpleType name="ST_PresetColorVal">
 *   <xsd:restriction base="xsd:token">
 *     <xsd:enumeration value="aliceBlue"/>
 *     ...
 *     <xsd:enumeration value="yellowGreen"/>
 *   </xsd:restriction>
 * </xsd:simpleType>
 * ```
 */
export const PresetColor = {
    ALICE_BLUE: "aliceBlue",
    ANTIQUE_WHITE: "antiqueWhite",
    AQUA: "aqua",
    AQUAMARINE: "aquamarine",
    AZURE: "azure",
    BEIGE: "beige",
    BISQUE: "bisque",
    BLACK: "black",
    BLANCHED_ALMOND: "blanchedAlmond",
    BLUE: "blue",
    BLUE_VIOLET: "blueViolet",
    BROWN: "brown",
    BURLY_WOOD: "burlyWood",
    CADET_BLUE: "cadetBlue",
    CHARTREUSE: "chartreuse",
    CHOCOLATE: "chocolate",
    CORAL: "coral",
    CORNFLOWER_BLUE: "cornflowerBlue",
    CORNSILK: "cornsilk",
    CRIMSON: "crimson",
    CYAN: "cyan",
    DARK_BLUE: "darkBlue",
    DARK_CYAN: "darkCyan",
    DARK_GOLDENROD: "darkGoldenrod",
    DARK_GRAY: "darkGray",
    DARK_GREY: "darkGrey",
    DARK_GREEN: "darkGreen",
    DARK_KHAKI: "darkKhaki",
    DARK_MAGENTA: "darkMagenta",
    DARK_OLIVE_GREEN: "darkOliveGreen",
    DARK_ORANGE: "darkOrange",
    DARK_ORCHID: "darkOrchid",
    DARK_RED: "darkRed",
    DARK_SALMON: "darkSalmon",
    DARK_SEA_GREEN: "darkSeaGreen",
    DARK_SLATE_BLUE: "darkSlateBlue",
    DARK_SLATE_GRAY: "darkSlateGray",
    DARK_SLATE_GREY: "darkSlateGrey",
    DARK_TURQUOISE: "darkTurquoise",
    DARK_VIOLET: "darkViolet",
    DEEP_PINK: "deepPink",
    DEEP_SKY_BLUE: "deepSkyBlue",
    DIM_GRAY: "dimGray",
    DIM_GREY: "dimGrey",
    DODGER_BLUE: "dodgerBlue",
    FIREBRICK: "firebrick",
    FLORAL_WHITE: "floralWhite",
    FOREST_GREEN: "forestGreen",
    FUCHSIA: "fuchsia",
    GAINSBORO: "gainsboro",
    GHOST_WHITE: "ghostWhite",
    GOLD: "gold",
    GOLDENROD: "goldenrod",
    GRAY: "gray",
    GREY: "grey",
    GREEN: "green",
    GREEN_YELLOW: "greenYellow",
    HONEYDEW: "honeydew",
    HOT_PINK: "hotPink",
    INDIAN_RED: "indianRed",
    INDIGO: "indigo",
    IVORY: "ivory",
    KHAKI: "khaki",
    LAVENDER: "lavender",
    LAVENDER_BLUSH: "lavenderBlush",
    LAWN_GREEN: "lawnGreen",
    LEMON_CHIFFON: "lemonChiffon",
    LIGHT_BLUE: "lightBlue",
    LIGHT_CORAL: "lightCoral",
    LIGHT_CYAN: "lightCyan",
    LIGHT_GOLDENROD_YELLOW: "lightGoldenrodYellow",
    LIGHT_GRAY: "lightGray",
    LIGHT_GREY: "lightGrey",
    LIGHT_GREEN: "lightGreen",
    LIGHT_PINK: "lightPink",
    LIGHT_SALMON: "lightSalmon",
    LIGHT_SEA_GREEN: "lightSeaGreen",
    LIGHT_SKY_BLUE: "lightSkyBlue",
    LIGHT_SLATE_GRAY: "lightSlateGray",
    LIGHT_SLATE_GREY: "lightSlateGrey",
    LIGHT_STEEL_BLUE: "lightSteelBlue",
    LIGHT_YELLOW: "lightYellow",
    LIME: "lime",
    LIME_GREEN: "limeGreen",
    LINEN: "linen",
    MAGENTA: "magenta",
    MAROON: "maroon",
    MEDIUM_AQUAMARINE: "mediumAquamarine",
    MEDIUM_BLUE: "mediumBlue",
    MEDIUM_ORCHID: "mediumOrchid",
    MEDIUM_PURPLE: "mediumPurple",
    MEDIUM_SEA_GREEN: "mediumSeaGreen",
    MEDIUM_SLATE_BLUE: "mediumSlateBlue",
    MEDIUM_SPRING_GREEN: "mediumSpringGreen",
    MEDIUM_TURQUOISE: "mediumTurquoise",
    MEDIUM_VIOLET_RED: "mediumVioletRed",
    MIDNIGHT_BLUE: "midnightBlue",
    MINT_CREAM: "mintCream",
    MISTY_ROSE: "mistyRose",
    MOCCASIN: "moccasin",
    NAVAJO_WHITE: "navajoWhite",
    NAVY: "navy",
    OLD_LACE: "oldLace",
    OLIVE: "olive",
    OLIVE_DRAB: "oliveDrab",
    ORANGE: "orange",
    ORANGE_RED: "orangeRed",
    ORCHID: "orchid",
    PALE_GOLDENROD: "paleGoldenrod",
    PALE_GREEN: "paleGreen",
    PALE_TURQUOISE: "paleTurquoise",
    PALE_VIOLET_RED: "paleVioletRed",
    PAPAYA_WHIP: "papayaWhip",
    PEACH_PUFF: "peachPuff",
    PERU: "peru",
    PINK: "pink",
    PLUM: "plum",
    POWDER_BLUE: "powderBlue",
    PURPLE: "purple",
    RED: "red",
    ROSY_BROWN: "rosyBrown",
    ROYAL_BLUE: "royalBlue",
    SADDLE_BROWN: "saddleBrown",
    SALMON: "salmon",
    SANDY_BROWN: "sandyBrown",
    SEA_GREEN: "seaGreen",
    SEA_SHELL: "seaShell",
    SIENNA: "sienna",
    SILVER: "silver",
    SKY_BLUE: "skyBlue",
    SLATE_BLUE: "slateBlue",
    SLATE_GRAY: "slateGray",
    SLATE_GREY: "slateGrey",
    SNOW: "snow",
    SPRING_GREEN: "springGreen",
    STEEL_BLUE: "steelBlue",
    TAN: "tan",
    TEAL: "teal",
    THISTLE: "thistle",
    TOMATO: "tomato",
    TURQUOISE: "turquoise",
    VIOLET: "violet",
    WHEAT: "wheat",
    WHITE: "white",
    WHITE_SMOKE: "whiteSmoke",
    YELLOW: "yellow",
    YELLOW_GREEN: "yellowGreen",
} as const;

/**
 * Options for preset color.
 */
export interface PresetColorOptions {
    /** Preset color value */
    readonly value: (typeof PresetColor)[keyof typeof PresetColor];
    /** Optional color transforms */
    readonly transforms?: ColorTransformOptions;
}

/**
 * Creates a preset color element.
 *
 * Specifies a color using a named preset (CSS named color).
 *
 * ## XSD Schema
 * ```xml
 * <xsd:complexType name="CT_PresetColor">
 *   <xsd:sequence>
 *     <xsd:group ref="EG_ColorTransform" minOccurs="0" maxOccurs="unbounded"/>
 *   </xsd:sequence>
 *   <xsd:attribute name="val" type="ST_PresetColorVal" use="required"/>
 * </xsd:complexType>
 * ```
 */
export const createPresetColor = (options: PresetColorOptions): XmlComponent => {
    const transforms = options.transforms ? createColorTransforms(options.transforms) : [];
    return new BuilderElement({
        attributes: {
            value: { key: "val", value: options.value },
        },
        children: [...transforms],
        name: "a:prstClr",
    });
};
