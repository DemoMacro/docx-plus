/**
 * Paragraph indentation module for WordprocessingML documents.
 *
 * This module provides indentation options for paragraphs including left, right,
 * hanging, and first line indentation.
 *
 * Reference: http://officeopenxml.com/WPindentation.php
 *
 * @module
 */
import { BuilderElement } from "@file/xml-components";
import type { XmlComponent } from "@file/xml-components";
import { decimalNumber, signedTwipsMeasureValue, twipsMeasureValue } from "@util/values";
import type { PositiveUniversalMeasure, UniversalMeasure } from "@util/values";

/**
 * Properties for configuring paragraph indentation.
 *
 * Values can be specified as numbers (in twips) or as universal measures (e.g., "1in", "2.5cm").
 */
export interface IIndentAttributesProperties {
    readonly start?: number | UniversalMeasure;
    readonly startChars?: number;
    readonly end?: number | UniversalMeasure;
    readonly endChars?: number;
    readonly left?: number | UniversalMeasure;
    readonly right?: number | UniversalMeasure;
    readonly hanging?: number | PositiveUniversalMeasure;
    readonly hangingChars?: number;
    readonly firstLine?: number | PositiveUniversalMeasure;
    readonly firstLineChars?: number;
}

/**
 * Creates paragraph indentation element for a WordprocessingML document.
 *
 * The ind element specifies the indentation of the paragraph from the margins.
 *
 * Reference: http://officeopenxml.com/WPindentation.php
 *
 * ## XSD Schema
 * ```xml
 * <xsd:complexType name="CT_Ind">
 *   <xsd:attribute name="start" type="ST_SignedTwipsMeasure" use="optional"/>
 *   <xsd:attribute name="startChars" type="ST_DecimalNumber" use="optional"/>
 *   <xsd:attribute name="end" type="ST_SignedTwipsMeasure" use="optional"/>
 *   <xsd:attribute name="endChars" type="ST_DecimalNumber" use="optional"/>
 *   <xsd:attribute name="left" type="ST_SignedTwipsMeasure" use="optional"/>
 *   <xsd:attribute name="leftChars" type="ST_DecimalNumber" use="optional"/>
 *   <xsd:attribute name="right" type="ST_SignedTwipsMeasure" use="optional"/>
 *   <xsd:attribute name="rightChars" type="ST_DecimalNumber" use="optional"/>
 *   <xsd:attribute name="hanging" type="s:ST_TwipsMeasure" use="optional"/>
 *   <xsd:attribute name="hangingChars" type="ST_DecimalNumber" use="optional"/>
 *   <xsd:attribute name="firstLine" type="s:ST_TwipsMeasure" use="optional"/>
 *   <xsd:attribute name="firstLineChars" type="ST_DecimalNumber" use="optional"/>
 * </xsd:complexType>
 * ```
 */
export const createIndent = ({
    start,
    startChars,
    end,
    endChars,
    left,
    right,
    hanging,
    hangingChars,
    firstLine,
    firstLineChars,
}: IIndentAttributesProperties): XmlComponent =>
    new BuilderElement<IIndentAttributesProperties>({
        attributes: {
            end: {
                key: "w:end",
                value: end === undefined ? undefined : signedTwipsMeasureValue(end),
            },
            endChars: {
                key: "w:endChars",
                value: endChars === undefined ? undefined : decimalNumber(endChars),
            },
            firstLine: {
                key: "w:firstLine",
                value: firstLine === undefined ? undefined : twipsMeasureValue(firstLine),
            },
            firstLineChars: {
                key: "w:firstLineChars",
                value: firstLineChars === undefined ? undefined : decimalNumber(firstLineChars),
            },
            hanging: {
                key: "w:hanging",
                value: hanging === undefined ? undefined : twipsMeasureValue(hanging),
            },
            hangingChars: {
                key: "w:hangingChars",
                value: hangingChars === undefined ? undefined : decimalNumber(hangingChars),
            },
            left: {
                key: "w:left",
                value: left === undefined ? undefined : signedTwipsMeasureValue(left),
            },
            right: {
                key: "w:right",
                value: right === undefined ? undefined : signedTwipsMeasureValue(right),
            },
            start: {
                key: "w:start",
                value: start === undefined ? undefined : signedTwipsMeasureValue(start),
            },
            startChars: {
                key: "w:startChars",
                value: startChars === undefined ? undefined : decimalNumber(startChars),
            },
        },
        name: "w:ind",
    });
