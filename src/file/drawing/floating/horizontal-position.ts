/**
 * Horizontal position module for floating drawings in WordprocessingML documents.
 *
 * This module provides horizontal positioning for floating drawing objects,
 * specifying the horizontal placement relative to a base element.
 *
 * Reference: http://officeopenxml.com/drwPicFloating-position.php
 *
 * @module
 */
import { BuilderElement } from "@file/xml-components";
import type { XmlComponent } from "@file/xml-components";

import { createAlign } from "./align";
import { HorizontalPositionRelativeFrom } from "./floating-position";
import type { IHorizontalPositionOptions } from "./floating-position";
import { createPositionOffset } from "./position-offset";

/**
 * Creates a horizontal position element for floating drawings.
 *
 * The positionH element specifies the horizontal positioning of a floating
 * object relative to a base element (page, margin, column, etc.).
 *
 * Reference: https://www.datypic.com/sc/ooxml/e-wp_positionH-1.html
 *
 * ## XSD Schema
 * ```xml
 * <xsd:complexType name="CT_PosH">
 *   <xsd:choice>
 *     <xsd:element name="align" type="ST_AlignH"/>
 *     <xsd:element name="posOffset" type="ST_PositionOffset"/>
 *   </xsd:choice>
 *   <xsd:attribute name="relativeFrom" type="ST_RelFromH" use="required"/>
 * </xsd:complexType>
 * ```
 *
 * @param options - Horizontal position configuration
 * @returns The positionH XML element
 *
 * @example
 * ```typescript
 * // Align to the left of the page
 * createHorizontalPosition({
 *   relative: HorizontalPositionRelativeFrom.PAGE,
 *   align: HorizontalPositionAlign.LEFT,
 * });
 *
 * // Offset from the margin
 * createHorizontalPosition({
 *   relative: HorizontalPositionRelativeFrom.MARGIN,
 *   offset: 914400, // 1 inch in EMUs
 * });
 * ```
 */
export const createHorizontalPosition = ({
    relative,
    align,
    offset,
}: IHorizontalPositionOptions): XmlComponent =>
    new BuilderElement<{
        /** Horizontal Position Relative Base */
        readonly relativeFrom: (typeof HorizontalPositionRelativeFrom)[keyof typeof HorizontalPositionRelativeFrom];
    }>({
        attributes: {
            relativeFrom: {
                key: "relativeFrom",
                value: relative ?? HorizontalPositionRelativeFrom.PAGE,
            },
        },
        children: [
            (() => {
                if (align) {
                    return createAlign(align);
                }
                if (offset !== undefined) {
                    return createPositionOffset(offset);
                }
                return createAlign("LEFT" as const);
            })(),
        ],
        name: "wp:positionH",
    });
