/**
 * Output type definitions for document generation.
 *
 * This module defines the various output formats supported when generating
 * .docx files. These types correspond to fflate's output formats.
 *
 * @module
 */

import { strFromU8 } from "fflate";

/* V8 ignore start */
// Simply type definitions. Can ignore testing and coverage

/**
 * Maps output type names to their corresponding TypeScript types.
 *
 * This type is used to provide type-safe document generation where the output
 * format determines the return type. Based on fflate's output types.
 *
 * @example
 * ```typescript
 * // Generate as base64 string
 * const doc: OutputByType["base64"] = await packer.toBase64(document);
 *
 * // Generate as Buffer (Node.js)
 * const doc: OutputByType["nodebuffer"] = await packer.toBuffer(document);
 *
 * // Generate as Blob (browser)
 * const doc: OutputByType["blob"] = await packer.toBlob(document);
 * ```
 */
export interface OutputByType {
    /** Base64-encoded string representation */
    readonly base64: string;
    /** UTF-8 string representation */
    readonly string: string;
    /** Text string representation */
    readonly text: string;
    /** Binary string representation */
    readonly binarystring: string;
    /** Array of numbers (0-255) representing bytes */
    readonly array: readonly number[];
    /** Uint8Array (typed array) representation */
    readonly uint8array: Uint8Array;
    /** ArrayBuffer representation */
    readonly arraybuffer: ArrayBuffer;
    /** Blob representation (browser environments) */
    readonly blob: Blob;
    /** Node.js Buffer representation */
    readonly nodebuffer: Buffer;
}

/**
 * Valid output type identifiers.
 *
 * Use these string literals to specify the desired output format when
 * generating documents.
 *
 * @example
 * ```typescript
 * const outputType: OutputType = "base64";
 * const doc = await packer.generate(document, { type: outputType });
 * ```
 */
export type OutputType = keyof OutputByType;

/**
 * Converts a Uint8Array to the specified output type.
 *
 * This is used by both the Packer and patchDocument to convert fflate's
 * raw Uint8Array output into the user's requested format.
 */
export const convertOutput = <T extends OutputType>(data: Uint8Array, type: T): OutputByType[T] => {
    switch (type) {
        case "nodebuffer": {
            return Buffer.from(data) as OutputByType[T];
        }
        case "blob": {
            return new Blob(
                [
                    (data.buffer as ArrayBuffer).slice(
                        data.byteOffset,
                        data.byteOffset + data.byteLength,
                    ),
                ],
                {
                    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                },
            ) as OutputByType[T];
        }
        case "arraybuffer": {
            return data.buffer.slice(
                data.byteOffset,
                data.byteOffset + data.byteLength,
            ) as OutputByType[T];
        }
        case "uint8array": {
            return data as OutputByType[T];
        }
        case "base64": {
            return btoa(strFromU8(data, true)) as OutputByType[T];
        }
        case "string":
        case "text":
        case "binarystring": {
            return strFromU8(data, true) as OutputByType[T];
        }
        case "array": {
            return [...data] as unknown as OutputByType[T];
        }
        /* V8 ignore next */
        default: {
            return data as any;
        }
    }
};
/* V8 ignore stop */
