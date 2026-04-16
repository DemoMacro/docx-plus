/**
 * System color element for DrawingML.
 *
 * This module provides system color support, referencing OS-level UI colors.
 *
 * Reference: ISO/IEC 29500-4, dml-main.xsd, CT_SystemColor / ST_SystemColorVal
 *
 * @module
 */
import { BuilderElement } from "@file/xml-components";
import type { XmlComponent } from "@file/xml-components";

import type { ColorTransformOptions } from "./color-transform";
import { createColorTransforms } from "./color-transform";

/**
 * System color values referencing OS UI colors.
 *
 * ## XSD Schema
 * ```xml
 * <xsd:simpleType name="ST_SystemColorVal">
 *   <xsd:restriction base="xsd:token">
 *     <xsd:enumeration value="scrollBar"/>
 *     <xsd:enumeration value="background"/>
 *     ...
 *     <xsd:enumeration value="menuBar"/>
 *   </xsd:restriction>
 * </xsd:simpleType>
 * ```
 */
export const SystemColor = {
    SCROLL_BAR: "scrollBar",
    BACKGROUND: "background",
    ACTIVE_CAPTION: "activeCaption",
    INACTIVE_CAPTION: "inactiveCaption",
    MENU: "menu",
    WINDOW: "window",
    WINDOW_FRAME: "windowFrame",
    MENU_TEXT: "menuText",
    WINDOW_TEXT: "windowText",
    CAPTION_TEXT: "captionText",
    ACTIVE_BORDER: "activeBorder",
    INACTIVE_BORDER: "inactiveBorder",
    APP_WORKSPACE: "appWorkspace",
    HIGHLIGHT: "highlight",
    HIGHLIGHT_TEXT: "highlightText",
    BTN_FACE: "btnFace",
    BTN_SHADOW: "btnShadow",
    GRAY_TEXT: "grayText",
    BTN_TEXT: "btnText",
    INACTIVE_CAPTION_TEXT: "inactiveCaptionText",
    BTN_HIGHLIGHT: "btnHighlight",
    THREE_D_DK_SHADOW: "3dDkShadow",
    THREE_D_LIGHT: "3dLight",
    INFO_TEXT: "infoText",
    INFO_BK: "infoBk",
    HOT_LIGHT: "hotLight",
    GRADIENT_ACTIVE_CAPTION: "gradientActiveCaption",
    GRADIENT_INACTIVE_CAPTION: "gradientInactiveCaption",
    MENU_HIGHLIGHT: "menuHighlight",
    MENU_BAR: "menuBar",
} as const;

/**
 * Options for system color.
 */
export interface SystemColorOptions {
    /** System color value */
    readonly value: (typeof SystemColor)[keyof typeof SystemColor];
    /** Last known RGB color value (optional fallback) */
    readonly lastClr?: string;
    /** Optional color transforms */
    readonly transforms?: ColorTransformOptions;
}

/**
 * Creates a system color element.
 *
 * References a system-defined UI color (e.g., window background, button face).
 *
 * ## XSD Schema
 * ```xml
 * <xsd:complexType name="CT_SystemColor">
 *   <xsd:sequence>
 *     <xsd:group ref="EG_ColorTransform" minOccurs="0" maxOccurs="unbounded"/>
 *   </xsd:sequence>
 *   <xsd:attribute name="val" type="ST_SystemColorVal" use="required"/>
 *   <xsd:attribute name="lastClr" type="s:ST_HexColorRGB" use="optional"/>
 * </xsd:complexType>
 * ```
 */
export const createSystemColor = (options: SystemColorOptions): XmlComponent => {
    const transforms = options.transforms ? createColorTransforms(options.transforms) : [];
    return new BuilderElement({
        attributes: {
            lastClr: { key: "lastClr", value: options.lastClr },
            value: { key: "val", value: options.value },
        },
        children: [...transforms],
        name: "a:sysClr",
    });
};
