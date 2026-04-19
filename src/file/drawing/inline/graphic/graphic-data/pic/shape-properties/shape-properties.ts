/**
 * Shape properties for DrawingML pictures.
 *
 * This module provides the shape properties element which defines visual
 * characteristics of a picture including transformation, geometry, fill, outline,
 * effects, and 3D properties.
 *
 * Reference: ISO/IEC 29500-4, dml-main.xsd, CT_ShapeProperties
 *
 * @module
 */
import type { IMediaDataTransformation } from "@file/media";
import { XmlComponent } from "@file/xml-components";

import { createEffectList } from "./effects/effect-list";
import type { EffectListOptions } from "./effects/effect-list";
import { createGradientFill } from "./fill/gradient-fill";
import type { GradientFillOptions } from "./fill/gradient-fill";
import { Form } from "./form";
import { createNoFill } from "./outline/no-fill";
import { createOutline } from "./outline/outline";
import type { OutlineOptions } from "./outline/outline";
import { createSolidFill } from "./outline/solid-fill";
import type { SolidFillOptions } from "./outline/solid-fill";
import { PresetGeometry } from "./preset-geometry/preset-geometry";
import { ShapePropertiesAttributes } from "./shape-properties-attributes";
import { createShape3D } from "./three-d/shape-3d";
import type { Shape3DOptions } from "./three-d/shape-3d";

/**
 * Represents shape properties for a DrawingML picture.
 *
 * This element defines the visual formatting of a picture, including
 * its transform (size, position, rotation, flip), geometry preset,
 * fill, outline, effects, and 3D properties.
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
 *     <xsd:element name="scene3d" type="CT_Scene3D" minOccurs="0"/>
 *     <xsd:element name="sp3d" type="CT_Shape3D" minOccurs="0"/>
 *     <xsd:element name="extLst" type="CT_OfficeArtExtensionList" minOccurs="0"/>
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
 *   effects: {
 *     glow: { rad: 50800, color: { value: "FF0000" } },
 *   },
 * });
 * ```
 */
export class ShapeProperties extends XmlComponent {
    private readonly form: Form;

    public constructor({
        element,
        effects,
        gradientFill,
        noFill,
        outline,
        shape3d,
        solidFill,
        transform,
    }: {
        readonly element: string;
        readonly outline?: OutlineOptions;
        readonly solidFill?: SolidFillOptions;
        readonly gradientFill?: GradientFillOptions;
        readonly noFill?: boolean;
        readonly effects?: EffectListOptions;
        readonly shape3d?: Shape3DOptions;
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
        }

        if (outline) {
            this.root.push(createOutline(outline));
        }

        if (effects) {
            this.root.push(createEffectList(effects));
        }

        if (shape3d) {
            this.root.push(createShape3D(shape3d));
        }
    }
}
