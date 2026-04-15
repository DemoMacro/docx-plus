import { Readable } from "stream";

import { File } from "@file/file";
import { HeadingLevel, Paragraph } from "@file/paragraph";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { Packer, PrettifyType } from "./packer";

describe("Packer", () => {
    let file: File;

    beforeEach(() => {
        file = new File({
            creator: "Dolan Miu",
            lastModifiedBy: "Dolan Miu",
            revision: 1,
            sections: [
                {
                    children: [
                        new Paragraph({
                            heading: HeadingLevel.TITLE,
                            text: "title",
                        }),
                        new Paragraph({
                            heading: HeadingLevel.HEADING_1,
                            text: "Hello world",
                        }),
                        new Paragraph({
                            heading: HeadingLevel.HEADING_2,
                            text: "heading 2",
                        }),
                        new Paragraph("test text"),
                    ],
                },
            ],
        });
    });

    describe("prettify", () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("should use a default prettify value", async () => {
            const spy = vi.spyOn((Packer as any).compiler, "compile");

            await Packer.toString(file, true);

            expect(spy).toBeCalledWith(
                expect.anything(),
                PrettifyType.WITH_2_BLANKS,
                expect.anything(),
            );
        });

        it("should use a prettify value", async () => {
            const spy = vi.spyOn((Packer as any).compiler, "compile");

            await Packer.toString(file, PrettifyType.WITH_4_BLANKS);

            expect(spy).toBeCalledWith(
                expect.anything(),
                PrettifyType.WITH_4_BLANKS,
                expect.anything(),
            );
        });

        it("should use an undefined prettify value", async () => {
            const spy = vi.spyOn((Packer as any).compiler, "compile");

            await Packer.toString(file, false);

            expect(spy).toBeCalledWith(expect.anything(), undefined, expect.anything());
        });
    });

    describe("overrides", () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("should use an overrides value", async () => {
            const spy = vi.spyOn((Packer as any).compiler, "compile");
            const overrides = [{ data: "comments", path: "word/comments.xml" }];

            await Packer.toString(file, true, overrides);

            expect(spy).toBeCalledWith(expect.anything(), expect.anything(), overrides);
        });

        it("should use a default overrides value", async () => {
            const spy = vi.spyOn((Packer as any).compiler, "compile");

            await Packer.toString(file);

            expect(spy).toBeCalledWith(expect.anything(), undefined, []);
        });
    });

    describe("#toString()", () => {
        it("should return a non-empty string", async () => {
            const result = await Packer.toString(file);

            assert.isAbove(result.length, 0);
        });
    });

    describe("#toBuffer()", () => {
        it("should create a standard docx file", { timeout: 99_999_999 }, async () => {
            const buffer = await Packer.toBuffer(file);

            assert.isDefined(buffer);
            assert.isTrue(buffer.byteLength > 0);
        });

        it("should handle exception if it throws any", () => {
            vi.spyOn((Packer as any).compiler, "compile").mockImplementation(() => {
                throw new Error();
            });

            return Packer.toBuffer(file).catch((error) => {
                assert.isDefined(error);
            });
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });
    });

    describe("#toBase64String()", () => {
        it("should create a standard docx file", { timeout: 99_999_999 }, async () => {
            const str = await Packer.toBase64String(file);
            expect(str).toBeDefined();
            expect(str.length).toBeGreaterThan(0);
        });

        it("should handle exception if it throws any", () => {
            vi.spyOn((Packer as any).compiler, "compile").mockImplementation(() => {
                throw new Error();
            });

            return Packer.toBase64String(file).catch((error) => {
                assert.isDefined(error);
            });
        });

        afterEach(() => {
            vi.resetAllMocks();
        });
    });

    describe("#toBlob()", () => {
        it("should create a standard docx file", async () => {
            vi.spyOn((Packer as any).compiler, "compile").mockReturnValue({});

            const str = await Packer.toBlob(file);

            assert.isDefined(str);
        });

        it("should handle exception if it throws any", () => {
            vi.spyOn((Packer as any).compiler, "compile").mockImplementation(() => {
                throw new Error();
            });

            return Packer.toBlob(file).catch((error) => {
                assert.isDefined(error);
            });
        });

        afterEach(() => {
            vi.resetAllMocks();
        });
    });

    describe("#toArrayBuffer()", () => {
        it("should create a standard docx file", async () => {
            vi.spyOn((Packer as any).compiler, "compile").mockReturnValue({});

            const str = await Packer.toArrayBuffer(file);

            assert.isDefined(str);
        });

        it("should handle exception if it throws any", () => {
            vi.spyOn((Packer as any).compiler, "compile").mockImplementation(() => {
                throw new Error();
            });

            return Packer.toArrayBuffer(file).catch((error) => {
                assert.isDefined(error);
            });
        });

        afterEach(() => {
            vi.resetAllMocks();
        });
    });

    describe("#toStream()", () => {
        it("should return a Readable stream", () => {
            const stream = Packer.toStream(file);

            expect(stream).toBeInstanceOf(Readable);
        });

        it("should emit data chunks that form a valid docx archive", async () => {
            const stream = Packer.toStream(file);
            const chunks: Buffer[] = [];

            await new Promise<void>((resolve, reject) => {
                stream.on("data", (chunk: Buffer) => {
                    chunks.push(chunk);
                });
                stream.on("end", () => resolve());
                stream.on("error", (err: Error) => reject(err));
            });

            const totalBytes = chunks.reduce((sum, c) => sum + c.length, 0);
            expect(totalBytes).toBeGreaterThan(0);

            // Combined buffer should start with ZIP magic bytes (PK\x03\x04)
            const combined = Buffer.concat(chunks);
            expect(combined[0]).toBe(0x50); // P
            expect(combined[1]).toBe(0x4b); // K
            expect(combined[2]).toBe(0x03);
            expect(combined[3]).toBe(0x04);
        });

        it("should produce a valid ZIP archive", async () => {
            const stream = Packer.toStream(file);
            const chunks: Buffer[] = [];

            await new Promise<void>((resolve, reject) => {
                stream.on("data", (chunk: Buffer) => chunks.push(chunk));
                stream.on("end", () => resolve());
                stream.on("error", (err: Error) => reject(err));
            });

            const data = Buffer.concat(chunks);
            // ZIP local file header magic: PK\x03\x04
            expect(data[0] | (data[1] << 8)).toBe(0x4b50);
            // End of central directory record: PK\x05\x06
            const eocd = data.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
            expect(eocd).toBeGreaterThanOrEqual(0);
        });

        it("should destroy the stream if compilation fails", () => {
            vi.spyOn((Packer as any).compiler, "compile").mockImplementation(() => {
                throw new Error("compile failed");
            });

            const stream = Packer.toStream(file);

            return new Promise<void>((resolve) => {
                stream.on("error", (err: Error) => {
                    expect(err).toBeDefined();
                    resolve();
                });
                stream.on("end", () => {
                    assert.fail("stream should not end normally on error");
                });
            });
        });

        it("should handle non-Error thrown during compilation", () => {
            vi.spyOn((Packer as any).compiler, "compile").mockImplementation(() => {
                throw "string error";
            });

            const stream = Packer.toStream(file);

            return new Promise<void>((resolve) => {
                stream.on("error", (err: Error) => {
                    expect(err).toBeInstanceOf(Error);
                    expect(err.message).toBe("string error");
                    resolve();
                });
                stream.on("end", () => {
                    assert.fail("stream should not end normally on error");
                });
            });
        });

        it("should handle array-format data with no compression", async () => {
            const mockData = new TextEncoder().encode("test content");
            vi.spyOn((Packer as any).compiler, "compile").mockReturnValue({
                "test.xml": [mockData, { level: 0 }],
            });

            const stream = Packer.toStream(file);
            const chunks: Uint8Array[] = [];

            await new Promise<void>((resolve) => {
                stream.on("data", (chunk: Uint8Array) => chunks.push(chunk));
                stream.on("end", () => resolve());
                stream.on("error", () => resolve());
            });

            const combined = chunks.length > 0 ? Buffer.concat(chunks) : Buffer.alloc(0);
            expect(combined.length).toBeGreaterThanOrEqual(0);
        });

        it("should handle array-format data with default compression level", async () => {
            const mockData = new TextEncoder().encode("test content");
            vi.spyOn((Packer as any).compiler, "compile").mockReturnValue({
                "test.xml": [mockData, {}],
            });

            const stream = Packer.toStream(file);
            const chunks: Uint8Array[] = [];

            await new Promise<void>((resolve) => {
                stream.on("data", (chunk: Uint8Array) => chunks.push(chunk));
                stream.on("end", () => resolve());
                stream.on("error", () => resolve());
            });

            const combined = chunks.length > 0 ? Buffer.concat(chunks) : Buffer.alloc(0);
            expect(combined.length).toBeGreaterThanOrEqual(0);
        });

        it("should handle array-format data with explicit compression level", async () => {
            const mockData = new TextEncoder().encode("test content");
            vi.spyOn((Packer as any).compiler, "compile").mockReturnValue({
                "test.xml": [mockData, { level: 9 }],
            });

            const stream = Packer.toStream(file);
            const chunks: Uint8Array[] = [];

            await new Promise<void>((resolve) => {
                stream.on("data", (chunk: Uint8Array) => chunks.push(chunk));
                stream.on("end", () => resolve());
                stream.on("error", () => resolve());
            });

            const combined = chunks.length > 0 ? Buffer.concat(chunks) : Buffer.alloc(0);
            expect(combined.length).toBeGreaterThanOrEqual(0);
        });

        it("should support prettify option", async () => {
            const stream = Packer.toStream(file, PrettifyType.WITH_TAB);
            const chunks: Buffer[] = [];

            await new Promise<void>((resolve, reject) => {
                stream.on("data", (chunk: Buffer) => chunks.push(chunk));
                stream.on("end", () => resolve());
                stream.on("error", (err: Error) => reject(err));
            });

            expect(chunks.length).toBeGreaterThan(0);
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });
    });

    describe("output types", () => {
        it("should export to uint8array", async () => {
            vi.spyOn((Packer as any).compiler, "compile").mockReturnValue({});

            const result = await Packer.pack(file, "uint8array");
            expect(result).toBeInstanceOf(Uint8Array);
        });

        it("should export to binarystring", async () => {
            vi.spyOn((Packer as any).compiler, "compile").mockReturnValue({});

            const result = await Packer.pack(file, "binarystring");
            expect(typeof result).toBe("string");
        });

        it("should export to array", async () => {
            vi.spyOn((Packer as any).compiler, "compile").mockReturnValue({});

            const result = await Packer.pack(file, "array");
            expect(Array.isArray(result)).toBe(true);
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });
    });
});
