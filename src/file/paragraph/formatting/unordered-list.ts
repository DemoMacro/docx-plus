/**
 * Numbering properties module for WordprocessingML documents.
 *
 * This module provides numbering and list properties for paragraphs.
 *
 * @module
 */
import { Attributes, XmlComponent } from "@file/xml-components";

/**
 * Represents numbering properties for a paragraph.
 *
 * The numPr element specifies the numbering definition instance and level
 * for the paragraph, enabling numbered and bulleted lists.
 *
 * Reference: http://officeopenxml.com/WPnumbering.php
 *
 * ## XSD Schema
 * ```xml
 * <xsd:complexType name="CT_NumPr">
 *   <xsd:sequence>
 *     <xsd:element name="ilvl" type="CT_DecimalNumber" minOccurs="0"/>
 *     <xsd:element name="numId" type="CT_DecimalNumber" minOccurs="0"/>
 *     <xsd:element name="numberingChange" type="CT_TrackChangeNumbering" minOccurs="0"/>
 *     <xsd:element name="ins" type="CT_TrackChange" minOccurs="0"/>
 *   </xsd:sequence>
 * </xsd:complexType>
 * ```
 *
 * @example
 * ```typescript
 * // Create a bulleted list item at level 0
 * new Paragraph({
 *   numbering: {
 *     reference: "my-bullet-list",
 *     level: 0,
 *   },
 *   children: [new TextRun("First item")],
 * });
 *
 * // Create a numbered list item at level 1
 * new Paragraph({
 *   numbering: {
 *     reference: "my-numbered-list",
 *     level: 1,
 *   },
 *   children: [new TextRun("Nested item")],
 * });
 * ```
 */
export class NumberProperties extends XmlComponent {
    public constructor(numberId: number | string, indentLevel: number) {
        super("w:numPr");
        this.root.push(new IndentLevel(indentLevel));
        this.root.push(new NumberId(numberId));
    }
}

/**
 * Represents the indentation level (ilvl) for a numbered or bulleted list.
 *
 * The ilvl element specifies the list level (0-9) for the paragraph.
 *
 * @internal
 */
class IndentLevel extends XmlComponent {
    public constructor(level: number) {
        super("w:ilvl");

        this.root.push(
            new Attributes({
                val: Math.min(level, 9),
            }),
        );
    }
}

/**
 * Represents the numbering definition ID (numId) for a numbered or bulleted list.
 *
 * The numId element specifies which numbering definition to use for the paragraph.
 *
 * @internal
 */
class NumberId extends XmlComponent {
    public constructor(id: number | string) {
        super("w:numId");
        this.root.push(
            new Attributes({
                val: typeof id === "string" ? `{${id}}` : id,
            }),
        );
    }
}
