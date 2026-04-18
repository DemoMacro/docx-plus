/**
 * Compatibility setting module for WordprocessingML documents.
 *
 * This module provides the compatibility mode version setting that controls
 * which Word version's behavior the document should emulate.
 *
 * Reference: https://docs.microsoft.com/en-us/openspecs/office_standards/ms-docx/90138c4d-eb18-4edc-aa6c-dfb799cb1d0d
 *
 * @module
 */
import { BuilderElement } from "@file/xml-components";
import type { XmlComponent } from "@file/xml-components";

// Currently, this is hard-coded for Microsoft word compatSettings.
// Theoretically, we could add compatSettings for other programs, but
// Currently there isn't a need.

// <xsd:complexType name="CT_CompatSetting">
//     <xsd:attribute name="name" type="s:ST_String"/>
//     <xsd:attribute name="uri" type="s:ST_String"/>
//     <xsd:attribute name="val" type="s:ST_String"/>
// </xsd:complexType>

interface ICompatibilitySettingAttributes {
    readonly name: string;
    readonly uri: string;
    readonly val: string | number;
}

/**
 * Creates a compatibility setting for a WordprocessingML document.
 *
 * This controls which Word version's formatting and layout behavior the document emulates,
 * as well as other compatibility behaviors.
 *
 * Common version values:
 * - 11: Word 2003
 * - 12: Word 2007
 * - 14: Word 2010
 * - 15: Word 2013+
 *
 * Reference: https://docs.microsoft.com/en-us/openspecs/office_standards/ms-docx/90138c4d-eb18-4edc-aa6c-dfb799cb1d0d
 *
 * ## XSD Schema
 * ```xml
 * <xsd:complexType name="CT_CompatSetting">
 *   <xsd:attribute name="name" type="s:ST_String"/>
 *   <xsd:attribute name="uri" type="s:ST_String"/>
 *   <xsd:attribute name="val" type="s:ST_String"/>
 * </xsd:complexType>
 * ```
 *
 * @example
 * ```typescript
 * // Set compatibility mode to Word 2013+
 * createCompatibilitySetting("compatibilityMode", 15);
 *
 * // Enable OpenType features
 * createCompatibilitySetting("enableOpenTypeFeatures", 1);
 * ```
 */
export const createCompatibilitySetting = (
    name: string,
    val: string | number,
    uri = "http://schemas.microsoft.com/office/word",
): XmlComponent =>
    new BuilderElement<ICompatibilitySettingAttributes>({
        attributes: {
            name: { key: "w:name", value: name },
            uri: { key: "w:uri", value: uri },
            val: { key: "w:val", value: val },
        },
        name: "w:compatSetting",
    });
