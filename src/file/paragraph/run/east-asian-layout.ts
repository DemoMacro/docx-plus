/**
 * East Asian layout module for WordprocessingML run properties.
 *
 * Specifies East Asian typography settings for a run, including
 * character combination, vertical text, and compression.
 *
 * Reference: ISO/IEC 29500-4, CT_EastAsianLayout
 *
 * @module
 */
import { BuilderElement } from "@file/xml-components";
import type { XmlComponent } from "@file/xml-components";
import { decimalNumber } from "@util/values";

/**
 * Bracket types for combined characters in East Asian layout.
 *
 * ## XSD Schema
 * ```xml
 * <xsd:simpleType name="ST_CombineBrackets">
 *   <xsd:restriction base="xsd:string">
 *     <xsd:enumeration value="none"/>
 *     <xsd:enumeration value="round"/>
 *     <xsd:enumeration value="square"/>
 *     <xsd:enumeration value="angle"/>
 *     <xsd:enumeration value="curly"/>
 *   </xsd:restriction>
 * </xsd:simpleType>
 * ```
 *
 * @publicApi
 */
export const CombineBracketsType = {
    /** No brackets */
    NONE: "none",
    /** Round brackets (parentheses) */
    ROUND: "round",
    /** Square brackets */
    SQUARE: "square",
    /** Angle brackets */
    ANGLE: "angle",
    /** Curly brackets (braces) */
    CURLY: "curly",
} as const;

/**
 * Options for East Asian layout properties.
 */
export interface EastAsianLayoutOptions {
    /** Character combination ID (referencing a combined character entry) */
    readonly id?: number;
    /** Whether to combine characters */
    readonly combine?: boolean;
    /** Bracket type for combined characters */
    readonly combineBrackets?: (typeof CombineBracketsType)[keyof typeof CombineBracketsType];
    /** Whether to render text vertically */
    readonly vert?: boolean;
    /** Whether to compress characters in vertical text */
    readonly vertCompress?: boolean;
}

/**
 * Creates an East Asian layout element (w:eastAsianLayout) for a run.
 *
 * ## XSD Schema
 * ```xml
 * <xsd:complexType name="CT_EastAsianLayout">
 *   <xsd:attribute name="id" type="ST_DecimalNumber" use="optional"/>
 *   <xsd:attribute name="combine" type="s:ST_OnOff" use="optional"/>
 *   <xsd:attribute name="combineBrackets" type="ST_CombineBrackets" use="optional"/>
 *   <xsd:attribute name="vert" type="s:ST_OnOff" use="optional"/>
 *   <xsd:attribute name="vertCompress" type="s:ST_OnOff" use="optional"/>
 * </xsd:complexType>
 * ```
 */
export const createEastAsianLayout = ({
    id,
    combine,
    combineBrackets,
    vert,
    vertCompress,
}: EastAsianLayoutOptions): XmlComponent =>
    new BuilderElement<EastAsianLayoutOptions>({
        attributes: {
            combine: { key: "w:combine", value: combine },
            combineBrackets: { key: "w:combineBrackets", value: combineBrackets },
            id: { key: "w:id", value: id === undefined ? undefined : decimalNumber(id) },
            vert: { key: "w:vert", value: vert },
            vertCompress: { key: "w:vertCompress", value: vertCompress },
        },
        name: "w:eastAsianLayout",
    });
