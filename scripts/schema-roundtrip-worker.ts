/**
 * Round-trip worker for schema-validate.ts.
 *
 * Runs with cwd = a format package directory, so tsx resolves that package's
 * tsconfig path aliases (@parts/*, @shared/*, @office-open/core → source).
 * Parses each generated file back into Options JSON and prints one JSON line
 * per file:
 *   {"file": "...", "ok": true, "options": {...}}
 *   {"file": "...", "ok": false, "error": "..."}
 *
 * Usage: tsx schema-roundtrip-worker.ts <docx|pptx|xlsx> <file> [<file> ...]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Binary options fields hold Uint8Array/Buffer in memory; JSON.stringify would
 * turn them into serialization artifacts ({"0":1,...} / {"type":"Buffer"}).
 * The input contract expresses binaries as base64, so encode them back — the
 * round-tripped options then re-enter generate as valid input.
 */
function toJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
      return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
    }
    // Buffer.toJSON runs before the replacer, so Buffers arrive as their
    // {"type":"Buffer","data":[...]} artifact — reverse it here.
    if (v && typeof v === "object" && (v as { type?: unknown }).type === "Buffer") {
      const bytes = (v as { data?: number[] }).data ?? [];
      return Buffer.from(bytes).toString("base64");
    }
    return v;
  });
}

const [format, ...files] = process.argv.slice(2);
if (format !== "docx" && format !== "pptx" && format !== "xlsx") {
  console.error(`unknown format "${format}"`);
  process.exit(2);
}

const mod = (await import(pathToFileURL(resolve("src/parse.ts")).href)) as {
  parseDocument?: (data: unknown) => Promise<unknown>;
  parsePresentation?: (data: unknown) => Promise<unknown>;
  parseWorkbook?: (data: unknown) => Promise<unknown>;
};

for (const file of files) {
  try {
    const data = readFileSync(file);
    const options =
      format === "docx"
        ? await mod.parseDocument!(data)
        : format === "pptx"
          ? await mod.parsePresentation!(data)
          : await mod.parseWorkbook!(data);
    process.stdout.write(toJson({ file, ok: true, options }) + "\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(JSON.stringify({ file, ok: false, error: message }) + "\n");
  }
}
