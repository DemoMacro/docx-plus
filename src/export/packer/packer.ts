import { Readable } from "stream";

import type { File } from "@file/file";
import { convertOutput } from "@util/output-type";
import type { OutputByType, OutputType } from "@util/output-type";
/**
 * Packer module for exporting documents to various output formats.
 *
 * @module
 */
import { type ZipOptions, Zip, ZipDeflate, ZipPassThrough, zipSync } from "fflate";

import { Compiler } from "./next-compiler";
import type { IXmlifyedFile } from "./next-compiler";

/**
 * Prettify options for formatting XML output.
 *
 * Controls the indentation style used when formatting the generated XML.
 * Prettified output is more human-readable but results in larger file sizes.
 *
 * @publicApi
 */
export const PrettifyType = {
    /** No prettification (smallest file size) */
    NONE: "",
    /** Indent with 2 spaces */
    WITH_2_BLANKS: "  ",
    /** Indent with 4 spaces */
    WITH_4_BLANKS: "    ",
    /** Indent with tab character */
    WITH_TAB: "\t",
} as const;

const convertPrettifyType = (
    prettify?: boolean | (typeof PrettifyType)[keyof typeof PrettifyType],
): (typeof PrettifyType)[keyof typeof PrettifyType] | undefined =>
    prettify === true ? PrettifyType.WITH_2_BLANKS : prettify === false ? undefined : prettify;

/**
 * Exports documents to various output formats.
 *
 * The Packer class provides static methods to convert a File object into different
 * output formats such as Buffer, Blob, or string. It handles the compilation
 * of the document structure into OOXML format and compression into a .docx ZIP archive.
 *
 * @publicApi
 *
 * @example
 * ```typescript
 * // Export to buffer (Node.js)
 * const buffer = await Packer.toBuffer(doc);
 *
 * // Export to blob (browser)
 * const blob = await Packer.toBlob(doc);
 *
 * // Export with prettified XML
 * const buffer = await Packer.toBuffer(doc, PrettifyType.WITH_2_BLANKS);
 * ```
 */
export class Packer {
    /**
     * Exports a document to the specified output format.
     *
     * @param file - The document to export
     * @param type - The output format type (e.g., "nodebuffer", "blob", "string")
     * @param prettify - Whether to prettify the XML output (boolean or PrettifyType)
     * @param overrides - Optional array of file overrides for custom XML content
     * @returns A promise resolving to the exported document in the specified format
     */
    public static async pack<T extends OutputType>(
        file: File,
        type: T,
        prettify?: boolean | (typeof PrettifyType)[keyof typeof PrettifyType],
        overrides: readonly IXmlifyedFile[] = [],
    ): Promise<OutputByType[T]> {
        const files = this.compiler.compile(file, convertPrettifyType(prettify), overrides);
        const zipped = zipSync(files, { level: 6 });
        return convertOutput(zipped, type);
    }

    /**
     * Exports a document to a string representation.
     *
     * @param file - The document to export
     * @param prettify - Whether to prettify the XML output
     * @param overrides - Optional array of file overrides
     * @returns A promise resolving to the document as a string
     */
    public static toString(
        file: File,
        prettify?: boolean | (typeof PrettifyType)[keyof typeof PrettifyType],
        overrides: readonly IXmlifyedFile[] = [],
    ): Promise<string> {
        return Packer.pack(file, "string", prettify, overrides);
    }

    /**
     * Exports a document to a Node.js Buffer.
     *
     * @param file - The document to export
     * @param prettify - Whether to prettify the XML output
     * @param overrides - Optional array of file overrides
     * @returns A promise resolving to the document as a Buffer
     */
    public static toBuffer(
        file: File,
        prettify?: boolean | (typeof PrettifyType)[keyof typeof PrettifyType],
        overrides: readonly IXmlifyedFile[] = [],
    ): Promise<Buffer> {
        return Packer.pack(file, "nodebuffer", prettify, overrides);
    }

    /**
     * Exports a document to a base64-encoded string.
     *
     * @param file - The document to export
     * @param prettify - Whether to prettify the XML output
     * @param overrides - Optional array of file overrides
     * @returns A promise resolving to the document as a base64 string
     */
    public static toBase64String(
        file: File,
        prettify?: boolean | (typeof PrettifyType)[keyof typeof PrettifyType],
        overrides: readonly IXmlifyedFile[] = [],
    ): Promise<string> {
        return Packer.pack(file, "base64", prettify, overrides);
    }

    /**
     * Exports a document to a Blob (for browser environments).
     *
     * @param file - The document to export
     * @param prettify - Whether to prettify the XML output
     * @param overrides - Optional array of file overrides
     * @returns A promise resolving to the document as a Blob
     */
    public static toBlob(
        file: File,
        prettify?: boolean | (typeof PrettifyType)[keyof typeof PrettifyType],
        overrides: readonly IXmlifyedFile[] = [],
    ): Promise<Blob> {
        return Packer.pack(file, "blob", prettify, overrides);
    }

    /**
     * Exports a document to an ArrayBuffer.
     *
     * @param file - The document to export
     * @param prettify - Whether to prettify the XML output
     * @param overrides - Optional array of file overrides
     * @returns A promise resolving to the document as an ArrayBuffer
     */
    public static toArrayBuffer(
        file: File,
        prettify?: boolean | (typeof PrettifyType)[keyof typeof PrettifyType],
        overrides: readonly IXmlifyedFile[] = [],
    ): Promise<ArrayBuffer> {
        return Packer.pack(file, "arraybuffer", prettify, overrides);
    }

    /**
     * Exports a document to a Node.js Readable stream.
     *
     * Uses fflate's streaming Zip API to emit compressed chunks incrementally,
     * avoiding buffering the entire archive in memory before the first byte
     * is available to the consumer.
     *
     * @param file - The document to export
     * @param prettify - Whether to prettify the XML output
     * @param overrides - Optional array of file overrides
     * @returns A readable stream containing the compressed .docx data
     *
     * @example
     * ```typescript
     * import { createWriteStream } from "fs";
     * Packer.toStream(doc).pipe(createWriteStream("output.docx"));
     * ```
     */
    public static toStream(
        file: File,
        prettify?: boolean | (typeof PrettifyType)[keyof typeof PrettifyType],
        overrides: readonly IXmlifyedFile[] = [],
    ): Readable {
        /* v8 ignore start */
        const stream = new Readable({ read() {} });
        /* v8 ignore stop */

        try {
            const files = this.compiler.compile(file, convertPrettifyType(prettify), overrides);

            const zip = new Zip((err, chunk, final) => {
                /* v8 ignore start */
                if (err) {
                    stream.destroy(err);
                    return;
                }
                /* v8 ignore stop */
                if (!stream.destroyed) {
                    stream.push(chunk);
                }
                if (final) {
                    stream.push(null);
                }
            });

            for (const [name, data] of Object.entries(files)) {
                const raw = Array.isArray(data) ? (data[0] as Uint8Array) : (data as Uint8Array);
                const level = Array.isArray(data) ? ((data[1] as ZipOptions).level ?? 6) : 6;
                const entry =
                    level === 0 ? new ZipPassThrough(name) : new ZipDeflate(name, { level });
                zip.add(entry);
                entry.push(raw, true);
            }

            zip.end();
        } catch (err) {
            stream.destroy(err instanceof Error ? err : new Error(String(err)));
        }

        return stream;
    }

    private static readonly compiler = new Compiler();
}
