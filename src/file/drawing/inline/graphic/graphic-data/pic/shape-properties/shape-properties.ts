/**
 * Shape properties for DrawingML pictures.
 *
 * This module provides the shape properties element which defines visual
 * characteristics of a picture including transformation, geometry, fill, and outline.
 *
 * Reference: ISO/IEC 29500-4, dml-main.xsd, CT_ShapeProperties
 *
 * @module
 */
import type { IMediaDataTransformation } from "@file/media";
import { XmlComponent } from "@file/xml-components";

import { createGradientFill } from "./fill/gradient-fill";
import type { IGradientFillOptions } from "./fill/gradient-fill";
import { Form } from "./form";
import { createNoFill } from "./outline/no-fill";
import { createOutline } from "./outline/outline";
import type { OutlineOptions } from "./outline/outline";
import { createSolidFill } from "./outline/solid-fill";
import type { SolidFillOptions } from "./outline/solid-fill";
import { PresetGeometry } from "./preset-geometry/preset-geometry";
import { ShapePropertiesAttributes } from "./shape-properties-attributes";

/**
 * Represents shape properties for a DrawingML picture.
 *
 * This element defines the visual formatting of a picture, including
 * its transform (size, position, rotation, flip), geometry preset,
 * fill, and outline properties.
 *
 * ## XSD Schema
 * ```xml
 * <xsd:complexType name="CT_ShapeProperties">
 *   <xsd:sequence>
 *     <xsd:element name="xfrm" type="CT_Transform2D" minOccurs="0"/>
 *     <xsd:group ref="EG_Geometry" minOccurs="0"/>
 *     <xsd:group ref="EG_FillProperties" minOccurs="0"/>
 *     <xsd:element name="ln" type="CT_LineProperties" minOccurs="0"/>
 *     <xsd:group ref="EG_EffectProperties" minOccurs="0"/>
 *   </xsd:sequence>
 *   <xsd:attribute name="bwMode" type="ST_BlackWhiteMode" use="optional"/>
 * </xsd:complexType>
 * ```
 *
 * @example
 * ```typescript
 * const shapeProps = new ShapeProperties({
 *   element: "pic",
 *   transform: { emus: { x: 914400, y: 914400 } },
 *   solidFill: { color: { value: "FF0000" } },
 * });
 * ```
 */
export class ShapeProperties extends XmlComponent {
    private readonly form: Form;

    public constructor({
        element,
        gradientFill,
        noFill,
        outline,
        solidFill,
        transform,
    }: {
        readonly element: string;
        readonly outline?: OutlineOptions;
        readonly solidFill?: SolidFillOptions;
        readonly gradientFill?: IGradientFillOptions;
        readonly noFill?: boolean;
        readonly transform: IMediaDataTransformation;
    }) {
        super(`${element}:spPr`);

        this.root.push(
            new ShapePropertiesAttributes({
                bwMode: "auto",
            }),
        );

        this.form = new Form(transform);

        this.root.push(this.form);
        this.root.push(new PresetGeometry());

        if (noFill) {
            this.root.push(createNoFill());
        } else if (solidFill) {
            this.root.push(createSolidFill(solidFill));
        } else if (gradientFill) {
            this.root.push(createGradientFill(gradientFill));
        } else if (outline) {
            // Default to no fill when outline is specified without explicit fill
            this.root.push(createNoFill());
        }

        if (outline) {
            this.root.push(createOutline(outline));
        }
    }
}
