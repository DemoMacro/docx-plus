/**
 * ImageRun module for WordprocessingML documents.
 *
 * This module provides support for inserting images into documents.
 *
 * Reference: http://officeopenxml.com/drwPicInline.php
 *
 * @module
 */
import type { DocPropertiesOptions } from "@file/drawing/doc-properties/doc-properties";
import type { IContext, IXmlableObject } from "@file/xml-components";
import { hashedId } from "@util/convenience-functions";
import type { DataType } from "undio";
import { toUint8Array } from "undio";

import { Drawing } from "../../drawing";
import type { IFloating } from "../../drawing";
import type { BlipEffectsOptions } from "../../drawing/inline/graphic/graphic-data/pic/blip/blip-effects";
import type { SourceRectangleOptions } from "../../drawing/inline/graphic/graphic-data/pic/blip/source-rectangle";
import type { TileOptions } from "../../drawing/inline/graphic/graphic-data/pic/blip/tile";
import type { EffectListOptions } from "../../drawing/inline/graphic/graphic-data/pic/shape-properties/effects/effect-list";
import type { OutlineOptions } from "../../drawing/inline/graphic/graphic-data/pic/shape-properties/outline/outline";
import type { SolidFillOptions } from "../../drawing/inline/graphic/graphic-data/pic/shape-properties/outline/solid-fill";
import type { IMediaTransformation } from "../../media";
import { createTransformation } from "../../media";
import type { IMediaData } from "../../media/data";
import { Run } from "../run";

/**
 * Core options for image configuration.
 */
interface CoreImageOptions {
    readonly transformation: IMediaTransformation;
    readonly floating?: IFloating;
    readonly altText?: DocPropertiesOptions;
    readonly outline?: OutlineOptions;
    readonly solidFill?: SolidFillOptions;
    readonly effects?: EffectListOptions;
    readonly blipEffects?: BlipEffectsOptions;
    readonly srcRect?: SourceRectangleOptions;
    readonly tile?: TileOptions;
}

interface RegularImageOptions {
    readonly type: "jpg" | "png" | "gif" | "bmp" | "tif" | "ico" | "emf" | "wmf";
    readonly data: DataType;
}

interface SvgMediaOptions {
    readonly type: "svg";
    readonly data: DataType;
    /**
     * Required in case the Word processor does not support SVG.
     */
    readonly fallback: RegularImageOptions;
}

/**
 * Options for creating an ImageRun.
 *
 * @see {@link ImageRun}
 */
export type IImageOptions = (RegularImageOptions | SvgMediaOptions) & CoreImageOptions;

const createImageData = (
    data: Uint8Array,
    transformation: IMediaTransformation,
    key: string,
    srcRect?: SourceRectangleOptions,
): Pick<IMediaData, "data" | "fileName" | "transformation" | "srcRect"> => ({
    data,
    fileName: key,
    srcRect,
    transformation: createTransformation(transformation),
});

/**
 * Represents an image in a WordprocessingML document.
 *
 * ImageRun embeds an image within a run, supporting various formats
 * including JPG, PNG, GIF, BMP, and SVG.
 *
 * Reference: http://officeopenxml.com/drwPicInline.php
 *
 * @publicApi
 *
 * @example
 * ```typescript
 * new ImageRun({
 *   data: fs.readFileSync("./image.png"),
 *   transformation: {
 *     width: 100,
 *     height: 100,
 *   },
 *   type: "png",
 * });
 * ```
 */
export class ImageRun extends Run {
    private readonly imageData: IMediaData;

    public constructor(options: IImageOptions) {
        super({});

        const rawData = toUint8Array(options.data) as Uint8Array;
        const hash = hashedId(rawData);
        const key = `${hash}.${options.type}`;

        if (options.type === "svg") {
            const fallbackData = toUint8Array(options.fallback.data) as Uint8Array;
            this.imageData = {
                type: options.type,
                ...createImageData(rawData, options.transformation, key, options.srcRect),
                fallback: {
                    type: options.fallback.type,
                    ...createImageData(
                        fallbackData,
                        options.transformation,
                        `${hashedId(fallbackData)}.${options.fallback.type}`,
                    ),
                },
            };
        } else {
            this.imageData = {
                type: options.type,
                ...createImageData(rawData, options.transformation, key, options.srcRect),
            };
        }
        const drawing = new Drawing(this.imageData, {
            blipEffects: options.blipEffects,
            docProperties: options.altText,
            floating: options.floating,
            outline: options.outline,
            solidFill: options.solidFill,
            effects: options.effects,
            tile: options.tile,
        });

        this.root.push(drawing);
    }

    public prepForXml(context: IContext): IXmlableObject | undefined {
        context.file.Media.addImage(this.imageData.fileName, this.imageData);

        if (this.imageData.type === "svg") {
            context.file.Media.addImage(this.imageData.fallback.fileName, this.imageData.fallback);
        }

        return super.prepForXml(context);
    }
}
