import type { NumberFormat } from "@file/shared/number-format";
/**
 * Footnote and endnote properties module for WordprocessingML section properties.
 *
 * Specifies footnote/endnote placement and numbering format within a section.
 *
 * Reference: ISO/IEC 29500-4, CT_FtnProps / CT_EdnProps
 *
 * @module
 */
import { BuilderElement, IgnoreIfEmptyXmlComponent, XmlComponent } from "@file/xml-components";
import { decimalNumber } from "@util/values";

/**
 * Footnote position types.
 *
 * ## XSD Schema
 * ```xml
 * <xsd:simpleType name="ST_FtnPos">
 *   <xsd:restriction base="xsd:string">
 *     <xsd:enumeration value="pageBottom"/>
 *     <xsd:enumeration value="beneathText"/>
 *     <xsd:enumeration value="sectEnd"/>
 *     <xsd:enumeration value="docEnd"/>
 *   </xsd:restriction>
 * </xsd:simpleType>
 * ```
 *
 * @publicApi
 */
export const FootnotePositionType = {
    /** Footnotes at bottom of the page */
    PAGE_BOTTOM: "pageBottom",
    /** Footnotes beneath text on the page */
    BENEATH_TEXT: "beneathText",
    /** Footnotes at the end of the section */
    SECT_END: "sectEnd",
    /** Footnotes at the end of the document */
    DOC_END: "docEnd",
} as const;

/**
 * Endnote position types.
 *
 * ## XSD Schema
 * ```xml
 * <xsd:simpleType name="ST_EdnPos">
 *   <xsd:restriction base="xsd:string">
 *     <xsd:enumeration value="sectEnd"/>
 *     <xsd:enumeration value="docEnd"/>
 *   </xsd:restriction>
 * </xsd:simpleType>
 * ```
 *
 * @publicApi
 */
export const EndnotePositionType = {
    /** Endnotes at the end of the section */
    SECT_END: "sectEnd",
    /** Endnotes at the end of the document */
    DOC_END: "docEnd",
} as const;

/**
 * Number restart types for footnotes/endnotes.
 *
 * ## XSD Schema
 * ```xml
 * <xsd:simpleType name="ST_RestartNumber">
 *   <xsd:restriction base="xsd:string">
 *     <xsd:enumeration value="continuous"/>
 *     <xsd:enumeration value="eachSect"/>
 *     <xsd:enumeration value="eachPage"/>
 *   </xsd:restriction>
 * </xsd:simpleType>
 * ```
 *
 * @publicApi
 */
export const NumberRestartType = {
    /** Continuous numbering throughout the document */
    CONTINUOUS: "continuous",
    /** Restart numbering at each section */
    EACH_SECT: "eachSect",
    /** Restart numbering at each page */
    EACH_PAGE: "eachPage",
} as const;

/**
 * Common options for footnote and endnote number properties.
 */
interface NumberPropertiesOptions {
    /** Number format (decimal, roman, letter, etc.) */
    readonly formatType?: (typeof NumberFormat)[keyof typeof NumberFormat];
    /** Custom number format string (overrides formatType when specified) */
    readonly format?: string;
    /** Starting number */
    readonly numStart?: number;
    /** When to restart numbering */
    readonly numRestart?: (typeof NumberRestartType)[keyof typeof NumberRestartType];
}

/**
 * Options for footnote properties.
 */
export interface FootnotePropertiesOptions extends NumberPropertiesOptions {
    /** Footnote placement */
    readonly pos?: (typeof FootnotePositionType)[keyof typeof FootnotePositionType];
}

/**
 * Options for endnote properties.
 */
export interface EndnotePropertiesOptions extends NumberPropertiesOptions {
    /** Endnote placement */
    readonly pos?: (typeof EndnotePositionType)[keyof typeof EndnotePositionType];
}

/**
 * Creates footnote properties element (w:footnotePr) for a section.
 *
 * ## XSD Schema
 * ```xml
 * <xsd:complexType name="CT_FtnProps">
 *   <xsd:sequence>
 *     <xsd:element name="pos" type="CT_FtnPos" minOccurs="0"/>
 *     <xsd:element name="numFmt" type="CT_NumFmt" minOccurs="0"/>
 *     <xsd:group ref="EG_FtnEdnNumProps" minOccurs="0"/>
 *   </xsd:sequence>
 * </xsd:complexType>
 * ```
 */
export const createFootnoteProperties = ({
    pos,
    formatType,
    format,
    numStart,
    numRestart,
}: FootnotePropertiesOptions): XmlComponent => {
    const container = new FootnoteProperties();

    if (pos !== undefined) {
        container.addChildElement(
            new BuilderElement<{ readonly val: string }>({
                attributes: { val: { key: "w:val", value: pos } },
                name: "w:pos",
            }),
        );
    }

    if (formatType !== undefined || format !== undefined) {
        container.addChildElement(
            new BuilderElement<{ readonly val?: string; readonly format?: string }>({
                attributes: {
                    format: { key: "w:format", value: format },
                    val: { key: "w:fmt", value: formatType },
                },
                name: "w:numFmt",
            }),
        );
    }

    if (numStart !== undefined) {
        container.addChildElement(
            new BuilderElement<{ readonly val: number }>({
                attributes: {
                    val: { key: "w:val", value: decimalNumber(numStart) },
                },
                name: "w:numStart",
            }),
        );
    }

    if (numRestart !== undefined) {
        container.addChildElement(
            new BuilderElement<{ readonly val: string }>({
                attributes: { val: { key: "w:val", value: numRestart } },
                name: "w:numRestart",
            }),
        );
    }

    return container;
};

/**
 * Footnote properties container element.
 */
class FootnoteProperties extends IgnoreIfEmptyXmlComponent {
    public constructor() {
        super("w:footnotePr", true);
    }
}

/**
 * Creates endnote properties element (w:endnotePr) for a section.
 *
 * ## XSD Schema
 * ```xml
 * <xsd:complexType name="CT_EdnProps">
 *   <xsd:sequence>
 *     <xsd:element name="pos" type="CT_EdnPos" minOccurs="0"/>
 *     <xsd:element name="numFmt" type="CT_NumFmt" minOccurs="0"/>
 *     <xsd:group ref="EG_FtnEdnNumProps" minOccurs="0"/>
 *   </xsd:sequence>
 * </xsd:complexType>
 * ```
 */
export const createEndnoteProperties = ({
    pos,
    formatType,
    format,
    numStart,
    numRestart,
}: EndnotePropertiesOptions): XmlComponent => {
    const container = new EndnoteProperties();

    if (pos !== undefined) {
        container.addChildElement(
            new BuilderElement<{ readonly val: string }>({
                attributes: { val: { key: "w:val", value: pos } },
                name: "w:pos",
            }),
        );
    }

    if (formatType !== undefined || format !== undefined) {
        container.addChildElement(
            new BuilderElement<{ readonly val?: string; readonly format?: string }>({
                attributes: {
                    format: { key: "w:format", value: format },
                    val: { key: "w:fmt", value: formatType },
                },
                name: "w:numFmt",
            }),
        );
    }

    if (numStart !== undefined) {
        container.addChildElement(
            new BuilderElement<{ readonly val: number }>({
                attributes: {
                    val: { key: "w:val", value: decimalNumber(numStart) },
                },
                name: "w:numStart",
            }),
        );
    }

    if (numRestart !== undefined) {
        container.addChildElement(
            new BuilderElement<{ readonly val: string }>({
                attributes: { val: { key: "w:val", value: numRestart } },
                name: "w:numRestart",
            }),
        );
    }

    return container;
};

/**
 * Endnote properties container element.
 */
class EndnoteProperties extends IgnoreIfEmptyXmlComponent {
    public constructor() {
        super("w:endnotePr", true);
    }
}
